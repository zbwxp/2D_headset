import type {
  HeadProject,
  Vec3,
  Vec2,
  SolverDiagnostics,
  ViewConstraint,
  ConstraintDiagnostic,
} from "../project/types";
import { PIXELS_PER_UNIT } from "../project/types";
import {
  adjacency,
  basis,
  project,
  silhouette,
  normals,
  centroid,
  sub,
  cross,
  normalize,
  dot,
} from "../geometry/core";
import { sampleCurve, closestPoint } from "../curves/polyline";
export interface SolverInput {
  project: HeadProject;
  quality: "preview" | "refine";
}
export interface SolverResult {
  vertices: Vec3[];
  normals: Vec3[];
  diagnostics: SolverDiagnostics;
}
export interface SurfaceSolver {
  solve(input: SolverInput): Promise<SolverResult>;
}
type Row = {
  ids: number[];
  coeff: number[];
  target: number;
  weight: number;
  kind: "view" | "fair" | "anchor" | "temporal";
};
export const strengthWeights = { locked: 100, strong: 20, weak: 2, guide: 0 };
function observations(p: HeadProject, c: ViewConstraint, vertices: Vec3[]) {
  const view = p.views.find((v) => v.id === c.viewId)!;
  if (c.entityKind === "silhouette") {
    const ids = silhouette(vertices, p.surface.faces, view);
    return ids.map((id) => ({
      id,
      target: closestPoint(project(vertices[id], view), c.curve).point,
    }));
  }
  return p.semanticModel.rings
    .find((r) => r.id === c.entityId)!
    .samples.map((s) => ({
      id: s.vertexId,
      target: sampleCurve(c.curve, s.u),
    }));
}
function reduction(p: HeadProject) {
  const n = p.surface.vertices.length;
  const index = new Int32Array(n * 3).fill(-1),
    sign = new Float64Array(n * 3).fill(1);
  let size = 0;
  if (!p.solver.symmetry) {
    for (let i = 0; i < n * 3; i++) index[i] = size++;
    return { index, sign, size };
  }
  for (const [a, b] of p.surface.symmetryPairs)
    for (let d = 0; d < 3; d++) {
      if (a === b && d === 0) continue;
      index[a * 3 + d] = size;
      index[b * 3 + d] = size++;
      sign[b * 3 + d] = d === 0 ? -1 : 1;
    }
  return { index, sign, size };
}
export function solveSurface({
  project: p,
  quality,
}: SolverInput): SolverResult {
  const start = performance.now(),
    n = p.surface.vertices.length,
    adj = adjacency(n, p.surface.faces),
    prev = p.surface.vertices,
    base = p.surface.baseVertices;
  const red = reduction(p);
  const x = new Float64Array(red.size),
    counts = new Uint16Array(red.size);
  for (let i = 0; i < n; i++)
    for (let d = 0; d < 3; d++) {
      const j = red.index[i * 3 + d];
      if (j >= 0) {
        x[j] += prev[i][d] * red.sign[i * 3 + d];
        counts[j]++;
      }
    }
  for (let j = 0; j < x.length; j++) x[j] /= counts[j] || 1;
  let vertices = structuredClone(prev),
    rows: Row[] = [];
  let iterations = 0;
  const addRow = (
    terms: [number, number][],
    target: number,
    weight: number,
    kind: Row["kind"],
  ) => {
    const combined = new Map<number, number>();
    for (const [k, c] of terms) {
      const id = red.index[k];
      if (id >= 0) combined.set(id, (combined.get(id) || 0) + c * red.sign[k]);
    }
    const ids: number[] = [],
      coeff: number[] = [];
    for (const [id, c] of combined)
      if (Math.abs(c) > 1e-12) {
        ids.push(id);
        coeff.push(c);
      }
    if (ids.length && weight > 0)
      rows.push({ ids, coeff, target, weight, kind });
  };
  const outer = quality === "preview" ? 2 : 5;
  for (let step = 0; step < outer; step++) {
    rows = [];
    for (let i = 0; i < n; i++)
      for (let d = 0; d < 3; d++) {
        const terms: [number, number][] = [
          [i * 3 + d, 1],
          ...adj[i].map(
            (j) => [j * 3 + d, -1 / adj[i].length] as [number, number],
          ),
        ];
        const rest =
          base[i][d] -
          adj[i].reduce((sum, j) => sum + base[j][d], 0) / adj[i].length;
        addRow(terms, rest, p.solver.fairness, "fair");
        addRow(
          [[i * 3 + d, 1]],
          prev[i][d],
          p.solver.temporal * (quality === "preview" ? 3 : 1),
          "temporal",
        );
      }
    for (const id of p.surface.anchorVertexIds)
      for (let d = 0; d < 3; d++)
        addRow([[id * 3 + d, 1]], base[id][d], 0.08, "anchor");
    const center = centroid(base);
    for (let d = 0; d < 3; d++)
      addRow(
        Array.from(
          { length: n },
          (_, i) => [i * 3 + d, 1 / n] as [number, number],
        ),
        center[d],
        1000,
        "anchor",
      );
    for (const c of p.constraints) {
      if (!c.enabled || c.strength === "guide") continue;
      const view = p.views.find((v) => v.id === c.viewId)!;
      const weight = strengthWeights[view.locked ? "locked" : c.strength];
      // Unauthored curves are predictions, not frozen observations. They follow the surface.
      if (!c.userAuthored && !view.locked && c.strength !== "locked") continue;
      const b = basis(view);
      for (const { id, target } of observations(p, c, vertices))
        for (let d = 0; d < 2; d++) {
          const axis = d === 0 ? b.right : b.up;
          addRow(
            axis.map((co, k) => [id * 3 + k, co]),
            target[d] + dot(view.camera.target, axis),
            weight,
            "view",
          );
        }
    }
    const rhs = new Float64Array(x.length),
      diag = new Float64Array(x.length).fill(1e-10);
    for (const row of rows)
      for (let k = 0; k < row.ids.length; k++) {
        rhs[row.ids[k]] += row.weight * row.coeff[k] * row.target;
        diag[row.ids[k]] += row.weight * row.coeff[k] ** 2;
      }
    const multiply = (v: Float64Array) => {
      const out = new Float64Array(v.length);
      for (const row of rows) {
        let s = 0;
        for (let k = 0; k < row.ids.length; k++)
          s += row.coeff[k] * v[row.ids[k]];
        s *= row.weight;
        for (let k = 0; k < row.ids.length; k++)
          out[row.ids[k]] += row.coeff[k] * s;
      }
      return out;
    };
    const ax = multiply(x),
      r = rhs.map((b, i) => b - ax[i]),
      z = r.map((v, i) => v / diag[i]),
      direction = z.slice();
    let rz = r.reduce((sum, v, i) => sum + v * z[i], 0);
    const max =
      quality === "preview"
        ? p.solver.previewIterations
        : p.solver.refineIterations;
    for (let iter = 0; iter < max && rz > 1e-12; iter++) {
      const ad = multiply(direction);
      const denom = direction.reduce((s, v, i) => s + v * ad[i], 0);
      if (denom <= 1e-20) break;
      const alpha = rz / denom;
      for (let j = 0; j < x.length; j++) {
        x[j] += alpha * direction[j];
        r[j] -= alpha * ad[j];
        z[j] = r[j] / diag[j];
      }
      const next = r.reduce((s, v, i) => s + v * z[i], 0);
      for (let j = 0; j < x.length; j++)
        direction[j] = z[j] + (next / rz) * direction[j];
      rz = next;
      iterations++;
    }
    vertices = Array.from(
      { length: n },
      (_, i) =>
        [0, 1, 2].map((d) =>
          red.index[i * 3 + d] < 0
            ? 0
            : x[red.index[i * 3 + d]] * red.sign[i * 3 + d],
        ) as Vec3,
    );
  }
  if (vertices.some((v) => v.some((x) => !Number.isFinite(x))))
    throw new Error("求解未收敛，已保留上次有效曲面。");
  // Bound one solve's displacement for temporal stability; report remaining residuals honestly.
  let largest = 0;
  for (let i = 0; i < n; i++)
    largest = Math.max(largest, Math.hypot(...sub(vertices[i], prev[i])));
  const bound = 0.12;
  if (largest > bound) {
    const t = bound / largest;
    vertices = vertices.map(
      (v, i) => v.map((a, d) => prev[i][d] + t * (a - prev[i][d])) as Vec3,
    );
    for (let i = 0; i < n; i++)
      for (let d = 0; d < 3; d++) {
        const id = red.index[i * 3 + d];
        if (id >= 0) x[id] = vertices[i][d] * red.sign[i * 3 + d];
      }
  }
  const ns = normals(vertices, p.surface.faces);
  const diagnostics = measure(p, vertices, ns);
  const energies = { view: 0, fair: 0, anchor: 0, temporal: 0 };
  for (const row of rows) {
    let residual = -row.target;
    for (let k = 0; k < row.ids.length; k++)
      residual += row.coeff[k] * x[row.ids[k]];
    energies[row.kind] += row.weight * residual ** 2;
  }
  Object.assign(diagnostics, {
    viewEnergy: energies.view,
    fairEnergy: energies.fair,
    anchorEnergy: energies.anchor,
    temporalEnergy: energies.temporal,
    totalEnergy: Object.values(energies).reduce((a, b) => a + b, 0),
    iterations,
    solveTimeMs: performance.now() - start,
  });
  return { vertices, normals: ns, diagnostics };
}
export function measure(
  p: HeadProject,
  vertices = p.surface.vertices,
  ns = normals(vertices, p.surface.faces),
): SolverDiagnostics {
  const constraints: ConstraintDiagnostic[] = [],
    warnings: string[] = [];
  for (const c of p.constraints) {
    if (!c.enabled || c.strength === "guide") continue;
    const view = p.views.find((v) => v.id === c.viewId)!;
    if (!c.userAuthored && !view.locked && c.strength !== "locked") continue;
    let errors: number[] = [];
    for (const { id, target } of observations(p, c, vertices)) {
      const q = project(vertices[id], view);
      errors.push(
        Math.hypot(q[0] - target[0], q[1] - target[1]) * PIXELS_PER_UNIT,
      );
    }
    // Bidirectional silhouette distance catches impossible protrusions that a one-way fit misses.
    if (c.entityKind === "silhouette") {
      const pts = silhouette(vertices, p.surface.faces, view).map((i) =>
        project(vertices[i], view),
      );
      const curve = {
        kind: "polyline" as const,
        points: pts,
        closed: true,
        parameters: pts.map((_, i) => i / pts.length),
      };
      errors.push(
        ...c.curve.points.map(
          (q) => closestPoint(q, curve).distance * PIXELS_PER_UNIT,
        ),
      );
    }
    const rms = Math.sqrt(
        errors.reduce((s, e) => s + e * e, 0) / (errors.length || 1),
      ),
      max = Math.max(0, ...errors),
      locked = view.locked || c.strength === "locked";
    const limit = locked ? 2 : 4,
      maxLimit = locked ? 6 : 12;
    constraints.push({
      id: c.id,
      viewId: c.viewId,
      rmsErrorPx: rms,
      maxErrorPx: max,
      count: errors.length,
      conflictScore: Math.max(rms / limit, max / maxLimit),
    });
    if (rms > limit || max > maxLimit)
      warnings.push(
        `${view.label} · ${c.entityId === "silhouette" ? "外轮廓" : p.semanticModel.rings.find((r) => r.id === c.entityId)!.label}${locked ? "（锁定）" : ""}：RMS ${rms.toFixed(1)} px / 最大 ${max.toFixed(1)} px，超过 ${limit} / ${maxLimit} px。`,
      );
  }
  const adj = adjacency(vertices.length, p.surface.faces);
  const angles: number[] = [];
  for (let i = 0; i < vertices.length; i++)
    if (vertices[i][1] > -0.65)
      for (const j of adj[i])
        if (j > i)
          angles.push(
            (Math.acos(Math.max(-1, Math.min(1, dot(ns[i], ns[j])))) * 180) /
              Math.PI,
          );
  angles.sort((a, b) => a - b);
  const drift = Math.hypot(
      ...sub(centroid(vertices), centroid(p.surface.baseVertices)),
    ),
    jump = Math.max(
      ...vertices.map((v, i) => Math.hypot(...sub(v, p.surface.vertices[i]))),
    );
  if (drift > 0.0122)
    warnings.push(
      `曲面中心偏移 ${((100 * drift) / 2.44).toFixed(2)}%，超过 0.5%。`,
    );
  const meanAngle = angles.reduce((a, b) => a + b, 0) / (angles.length || 1),
    p95Angle = angles[Math.floor(angles.length * 0.95)] || 0;
  if (meanAngle > 12 || p95Angle > 35)
    warnings.push(
      `曲面光顺度需检查：平均法线夹角 ${meanAngle.toFixed(1)}°，P95 ${p95Angle.toFixed(1)}°。`,
    );
  let symmetryEnergy = 0;
  for (const [a, b] of p.surface.symmetryPairs)
    symmetryEnergy +=
      (vertices[a][0] + vertices[b][0]) ** 2 +
      (vertices[a][1] - vertices[b][1]) ** 2 +
      (vertices[a][2] - vertices[b][2]) ** 2;
  return {
    constraints,
    warnings,
    totalEnergy: 0,
    viewEnergy: 0,
    fairEnergy: 0,
    anchorEnergy: 0,
    temporalEnergy: 0,
    symmetryEnergy,
    solveTimeMs: 0,
    iterations: 0,
    centroidDrift: drift,
    maxDisplacement: jump,
    meanNormalAngle: angles.reduce((a, b) => a + b, 0) / (angles.length || 1),
    p95NormalAngle: angles[Math.floor(angles.length * 0.95)] || 0,
  };
}
export class LocalSurfaceSolver implements SurfaceSolver {
  async solve(input: SolverInput) {
    return solveSurface(input);
  }
}
