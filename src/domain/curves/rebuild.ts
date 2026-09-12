import type { HeadProject, ViewConstraint, Vec2 } from "../project/types";
import { project } from "../geometry/core";
import { curveFromPoints, sampleCurve } from "./polyline";
import { handleIndices } from "./handles";

/** Dense samples are derived data. Only visible controls carry authored freedom. */
export function rebuildFromControls(p: HeadProject, c: ViewConstraint) {
  const ids = handleIndices(c);
  if (ids.length < 2 || c.entityKind === "midline") return;
  c.curve.controlModel =
    c.entityKind === "semantic_ring"
      ? "semantic-linear-v1"
      : "silhouette-spline-v1";
  const controls = c.curve.points.map((q) => [...q] as Vec2);
  if (c.entityKind === "semantic_ring") {
    const ring = p.semanticModel.rings.find((r) => r.id === c.entityId)!;
    const view = p.views.find((v) => v.id === c.viewId)!;
    const restCurve = curveFromPoints(
      ring.samples.map((s) =>
        project(p.surface.baseVertices[s.vertexId], view),
      ),
      ring.closed,
    );
    restCurve.parameters = ring.samples.map((s) => s.u);
    const rest = c.curve.parameters.map((u) => sampleCurve(restCurve, u));
    const sorted = ids.slice().sort((a, b) => rest[a][0] - rest[b][0]);
    c.curve.points = rest.map((q, j) => {
      let a = sorted[0],
        b = sorted.at(-1)!;
      for (let k = 0; k < sorted.length - 1; k++)
        if (q[0] <= rest[sorted[k + 1]][0] + 1e-10) {
          a = sorted[k];
          b = sorted[k + 1];
          break;
        }
      const span = rest[b][0] - rest[a][0],
        t = Math.max(
          0,
          Math.min(1, span > 1e-10 ? (q[0] - rest[a][0]) / span : 0),
        );
      // Rest abscissa preserves ring correspondence on BOTH hemispheres. In a
      // level view the rest ordinate is constant, so this is exactly a polyline
      // through the visible controls. Pitched cameras retain their true ellipse.
      return [0, 1].map(
        (d) =>
          q[d] +
          (1 - t) * (controls[a][d] - rest[a][d]) +
          t * (controls[b][d] - rest[b][d]),
      ) as Vec2;
    });
  } else {
    // Closed, interpolating Catmull-Rom spline for the outer contour. No hidden
    // sample retains an independent bump when a visible control is moved.
    const ts = c.curve.parameters;
    c.curve.points = ts.map((u) => {
      let k = ids.length - 1;
      for (let i = 0; i < ids.length - 1; i++)
        if (u >= ts[ids[i]] && u < ts[ids[i + 1]]) {
          k = i;
          break;
        }
      const a = ids[k],
        b = ids[(k + 1) % ids.length],
        prev = ids[(k - 1 + ids.length) % ids.length],
        next = ids[(k + 2) % ids.length];
      const start = ts[a],
        end = b === ids[0] ? ts[b] + 1 : ts[b];
      const wrapped = u < start ? u + 1 : u,
        t = (wrapped - start) / (end - start);
      return [0, 1].map(
        (d) =>
          0.5 *
          (2 * controls[a][d] +
            (-controls[prev][d] + controls[b][d]) * t +
            (2 * controls[prev][d] -
              5 * controls[a][d] +
              4 * controls[b][d] -
              controls[next][d]) *
              t *
              t +
            (-controls[prev][d] +
              3 * controls[a][d] -
              3 * controls[b][d] +
              controls[next][d]) *
              t *
              t *
              t),
      ) as Vec2;
    });
  }
  for (const i of ids) c.curve.points[i] = controls[i];
}
export function moveControl(
  p: HeadProject,
  c: ViewConstraint,
  index: number,
  point: Vec2,
) {
  const ids = handleIndices(c);
  if (!ids.includes(index)) return;
  const origin = c.curve.points[index],
    mirror =
      p.solver.symmetry && ["front", "high45", "low45"].includes(c.viewId);
  const partner = mirror
    ? ids.find(
        (j) =>
          j !== index &&
          Math.hypot(
            c.curve.points[j][0] + origin[0],
            c.curve.points[j][1] - origin[1],
          ) < 1e-5,
      )
    : undefined;
  c.curve.points[index] =
    mirror && Math.abs(origin[0]) < 1e-7 ? [0, point[1]] : point;
  if (partner !== undefined) c.curve.points[partner] = [-point[0], point[1]];
  rebuildFromControls(p, c);
}
