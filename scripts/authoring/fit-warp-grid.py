#!/usr/bin/env python3
"""One-shot, explicit-correspondence Warp authoring; never edits source curves.

Usage: python scripts/authoring/fit-warp-grid.py INPUT.json --output OUTPUT.json
Input is {"jobs": [{"name", "grid", "curvePairs": [{"sourceId", "source", "target"}],
"pins": [{"sourcePoint", "targetPoint"}], "options": {"samplesPerCurve": 65,
"regularization": 1e-7, "endpointTangentWeight": 0}}]}. A bare jobs list is accepted too.

Minimize sum of sampled squared forward errors + lambda * sum of squared
control displacement from the supplied grid, subject to exact landmark pins.
Optional soft endpoint-velocity observations help retain the target tangent rays
used by the app's one-cubic fitter; they are reported, not imposed as exact pins.
Controls are absolute position/U/V handles and cell-unit Hermite twist. Bounds,
topology, source/target correspondences and the pin coordinate frame are fixed.
No inverse, topology matching, subdivision or fold rejection is performed.
The independent dense diagnostics concern the continuous FIELD, not the app's
one-output-cubic approximation. That must be checked with the production mapper.
"""

import argparse
import copy
import json
import math
import os
from pathlib import Path

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import numpy as np
from scipy import linalg


CONTROL_KEYS = ("position", "handleU", "handleV", "twist")


def finite_array(value, shape, label):
    a = np.asarray(value, dtype=float)
    if a.shape != shape or not np.isfinite(a).all():
        raise ValueError(f"{label} must contain finite numbers with shape {shape}")
    return a


def grid_data(grid):
    rows, columns = grid["rows"], grid["columns"]
    if isinstance(rows, bool) or isinstance(columns, bool) or not isinstance(rows, int) or not isinstance(columns, int) or not (1 <= rows <= 100 and 1 <= columns <= 100):
        raise ValueError("grid rows/columns must be integer cell counts in 1..100")
    lo = finite_array(grid["bounds"]["min"], (2,), "bounds.min")
    hi = finite_array(grid["bounds"]["max"], (2,), "bounds.max")
    if not (hi > lo).all() or not np.isfinite(hi-lo).all():
        raise ValueError("grid rest bounds must have finite positive extents")
    count = (rows+1)*(columns+1)
    if len(grid["nodes"]) != count or count*4 > 4096:
        raise ValueError("invalid node count, or grid exceeds this bounded dense author's 4096 controls")
    values = np.array([finite_array(node[key], (2,), key) for node in grid["nodes"] for key in CONTROL_KEYS])
    return rows, columns, lo, hi, values


def basis_matrix(grid, points, directions=None):
    """Independent tensor-Hermite basis, converted to absolute UI controls."""
    rows, columns, lo, hi, base = grid_data(grid)
    points = np.asarray(points, dtype=float).reshape((-1, 2))
    if not np.isfinite(points).all() or ((points < lo) | (points > hi)).any():
        raise ValueError("source samples/pins lie outside immutable rest bounds; extrapolation is unsupported")
    coordinates = (points-lo)*np.array([columns, rows])/(hi-lo)
    cell = np.minimum(np.floor(coordinates).astype(int), [columns-1, rows-1])
    u, v = (coordinates-cell).T
    def h(t):
        return ((1-t)**2*(1+2*t), t*t*(3-2*t), t*(1-t)**2, t*t*(t-1))
    hu, hv = h(u), h(v)
    if directions is not None:
        velocity = finite_array(directions, points.shape, "source velocities")*np.array([columns, rows])/(hi-lo)
        def dh(t):
            return (6*t*(t-1), 6*t*(1-t), 3*t*t-4*t+1, 3*t*t-2*t)
        dhu, dhv = dh(u), dh(v)
    def product(i, j):
        return hu[i]*hv[j] if directions is None else dhu[i]*hv[j]*velocity[:, 0]+hu[i]*dhv[j]*velocity[:, 1]
    result = np.zeros((len(points), len(base)))
    obs = np.arange(len(points))
    for j in range(2):
        for i in range(2):
            index = ((cell[:, 1]+j)*(columns+1)+cell[:, 0]+i)*4
            p, du, dv, twist = product(i,j), product(i+2,j), product(i,j+2), product(i+2,j+2)
            # dF/du=3(handleU-position), dF/dv=3(handleV-position).
            result[obs, index] = p-3*du-3*dv
            result[obs, index+1] = 3*du
            result[obs, index+2] = 3*dv
            result[obs, index+3] = twist
    return result


def cubic_samples(cubic, ts):
    p = finite_array(cubic, (4, 2), "cubic")
    t = np.asarray(ts)[:, None]
    # de Casteljau is independent of the production power-basis evaluation.
    a = (1-t)*p[0]+t*p[1]
    b = (1-t)*p[1]+t*p[2]
    c = (1-t)*p[2]+t*p[3]
    return (1-t)*((1-t)*a+t*b)+t*((1-t)*b+t*c)


def rank_info(matrix):
    if not matrix.size:
        return {"rank": 0, "columns": matrix.shape[1], "fullColumnRank": matrix.shape[1] == 0, "condition": None, "observedCondition": None}
    s = linalg.svdvals(matrix)
    tolerance = max(matrix.shape)*np.finfo(float).eps*s[0]
    rank = int(np.sum(s > tolerance))
    condition = float(s[0]/s[rank-1]) if rank else None
    return {"rank": rank, "columns": matrix.shape[1], "fullColumnRank": rank == matrix.shape[1], "condition": condition if rank == matrix.shape[1] else None, "observedCondition": condition}


def fit_job(job):
    grid = job["grid"]
    _, _, _, _, base = grid_data(grid)
    options = job.get("options", {})
    count = options.get("samplesPerCurve", 65)
    validation_count = options.get("validationSamplesPerCurve", 1024)
    regularization = options.get("regularization", 1e-7)
    tangent_weight = options.get("endpointTangentWeight", 0.)
    if isinstance(count, bool) or not isinstance(count, int) or not 4 <= count <= 4097:
        raise ValueError("samplesPerCurve must be an integer in 4..4097")
    if isinstance(validation_count, bool) or not isinstance(validation_count, int) or not 128 <= validation_count <= 16384:
        raise ValueError("validationSamplesPerCurve must be an integer in 128..16384")
    if isinstance(regularization,bool) or not isinstance(regularization, (int, float)) or not math.isfinite(regularization) or regularization <= 0:
        raise ValueError("regularization must be finite and positive")
    if isinstance(tangent_weight,bool) or not isinstance(tangent_weight, (int,float)) or not math.isfinite(tangent_weight) or tangent_weight < 0:
        raise ValueError("endpointTangentWeight must be finite and nonnegative")
    pairs = job["curvePairs"]
    if not pairs:
        raise ValueError("at least one explicit source/target cubic pair is required")
    ts = np.linspace(0, 1, count)
    points = np.concatenate([cubic_samples(pair["source"], ts) for pair in pairs])
    targets = np.concatenate([cubic_samples(pair["target"], ts) for pair in pairs])
    position_matrix, position_targets = basis_matrix(grid, points), targets
    a = position_matrix
    if tangent_weight:
        sources = [np.asarray(pair["source"]) for pair in pairs]
        desired = [np.asarray(pair["target"]) for pair in pairs]
        endpoint_points = np.array([s[i] for s in sources for i in [0,3]])
        velocities = np.array([v for s in sources for v in [3*(s[1]-s[0]),3*(s[3]-s[2])]])
        target_velocities = np.array([v for s in desired for v in [3*(s[1]-s[0]),3*(s[3]-s[2])]])
        tangent_matrix = basis_matrix(grid, endpoint_points, velocities)
        # These are SOFT observations: adjacent source G1 pieces may use different
        # parameter speeds from their target G1 pieces. Exact velocities can then
        # be inconsistent even though a common target tangent ray is feasible.
        a = np.vstack((a, math.sqrt(tangent_weight)*tangent_matrix))
        targets = np.vstack((targets, math.sqrt(tangent_weight)*target_velocities))
    b = targets-a@base
    pins = job.get("pins", [])
    if pins:
        pin_points = np.array([finite_array(p["sourcePoint"], (2,), "pin source") for p in pins])
        pin_targets = np.array([finite_array(p["targetPoint"], (2,), "pin target") for p in pins])
        c = basis_matrix(grid, pin_points)
        d = pin_targets-c@base
        u, singular, vh = linalg.svd(c, full_matrices=True)
        rank = int(np.sum(singular > max(c.shape)*np.finfo(float).eps*singular[0]))
        particular = vh[:rank].T@((u[:, :rank].T@d)/singular[:rank, None])
        infeasible = float(np.max(np.linalg.norm(c@particular-d, axis=1)))
        if infeasible > 1e-10:
            raise ValueError(f"contradictory exact landmark pins (residual {infeasible})")
        null = vh[rank:].T
    else:
        c, d = np.zeros((0, len(base))), np.zeros((0, 2))
        particular, null = np.zeros_like(base), np.eye(len(base))
    reduced = a@null
    augmented = np.vstack((reduced, math.sqrt(regularization)*null))
    rhs = np.vstack((b-a@particular, -math.sqrt(regularization)*particular))
    solution, _, solved_rank, singular = linalg.lstsq(augmented, rhs, lapack_driver="gelsd")
    correction = particular+null@solution
    controls = base+correction
    if not np.isfinite(controls).all():
        raise ValueError("forward fit generated nonfinite controls")
    # Refine only numerical equality error, staying in the constraint row space.
    if pins:
        for _ in range(2):
            controls += linalg.lstsq(c, pin_targets-c@controls, lapack_driver="gelsd")[0]
    result = copy.deepcopy(grid)
    for i, node in enumerate(result["nodes"]):
        for j, key in enumerate(CONTROL_KEYS):
            node[key] = controls[4*i+j].tolist()
    training_errors = np.linalg.norm(position_matrix@controls-position_targets, axis=1)
    # Offset lattice avoids merely replaying the fitting observations.
    validation_ts = np.r_[0., (np.arange(validation_count)+.5)/validation_count, 1.]
    per_curve = []
    squared, observations, max_error = 0., 0, 0.
    for pair in pairs:
        source = cubic_samples(pair["source"], validation_ts)
        target = cubic_samples(pair["target"], validation_ts)
        mapped = basis_matrix(grid, source)@controls
        errors = np.linalg.norm(mapped-target, axis=1)
        peak = int(np.argmax(errors))
        max_error = max(max_error, float(errors[peak]))
        squared += float(errors@errors)
        observations += len(errors)
        per_curve.append({"sourceId": pair.get("sourceId"), "referenceId": pair.get("referenceId"), "maxError": float(errors[peak]), "rmsError": float(np.sqrt(np.mean(errors**2))), "peakT": float(validation_ts[peak]), "peakActual": mapped[peak].tolist(), "peakTarget": target[peak].tolist()})
    pin_errors = np.linalg.norm(c@controls-pin_targets, axis=1) if pins else np.array([])
    displacement = np.linalg.norm(controls-base, axis=1)
    diagnostics = {
        "kind": "sampled-forward-field-calibration-not-one-cubic-render-validation",
        "coordinateUnits": "logical Drawing units; multiply by 250 for nominal pixels",
        "objective": "sum(sample error squared) + tangentWeight * sum(endpoint velocity error squared) + lambda * sum(control displacement squared)",
        "regularization": regularization, "samplesPerCurve": count,
        "endpointTangentWeight": tangent_weight,
        "endpointVelocityRmsError": float(np.sqrt(np.mean(np.sum((tangent_matrix@controls-target_velocities)**2, axis=1)))) if tangent_weight else None,
        "validationSamplesPerCurve": len(validation_ts), "trainingRmsError": float(np.sqrt(np.mean(training_errors**2))),
        "trainingMaxError": float(np.max(training_errors)), "maxError": max_error,
        "rmsError": math.sqrt(squared/observations), "curves": per_curve,
        "pinResiduals": pin_errors.tolist(), "maxPinResidual": float(np.max(pin_errors)) if pins else 0.,
        "data": rank_info(reduced), "regularizedRank": int(solved_rank),
        "regularizedCondition": float(singular[0]/singular[-1]) if len(singular) else 1.,
        "maxControlDisplacement": float(np.max(displacement)), "controlDisplacementL2": float(np.linalg.norm(controls-base)),
        "maxAbsoluteControlComponent": float(np.max(np.abs(controls))),
        "maxTwistMagnitude": float(np.max(np.linalg.norm(controls[3::4], axis=1))),
        "foldPolicy": "allowed; no inverse or injectivity assumption",
        "requiresProductionOneCubicValidation": True,
    }
    return {"name": job["name"], "grid": result, "diagnostics": diagnostics}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    raw = json.loads(args.input.read_text())
    jobs = raw["jobs"] if isinstance(raw, dict) else raw
    results = []
    for job in jobs:
        try:
            results.append(fit_job(job))
        except (ValueError, KeyError, TypeError, linalg.LinAlgError) as error:
            raise SystemExit(f"{job.get('name', '<unnamed>')}: {error}") from error
    text = json.dumps({"schemaVersion": 1, "jobs": results}, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
