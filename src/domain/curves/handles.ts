import type { HeadProject, ViewConstraint, Vec2 } from "../project/types";
import { project } from "../geometry/core";
export function handleIndices(c: ViewConstraint): number[] {
  if (c.entityKind === "midline") return [];
  return c.curve.handles ?? c.curve.points.map((_, i) => i);
}
export function sparseHandles(p: HeadProject, c: ViewConstraint): number[] {
  if (c.entityKind === "midline") return [];
  const pts = c.curve.points,
    view = p.views.find((v) => v.id === c.viewId)!;
  const nearest = (q: Vec2) =>
    pts.reduce(
      (best, a, i) =>
        Math.hypot(a[0] - q[0], a[1] - q[1]) <
        Math.hypot(pts[best][0] - q[0], pts[best][1] - q[1])
          ? i
          : best,
      0,
    );
  if (c.entityKind !== "silhouette") {
    const left = pts.reduce(
        (best, a, i) => (a[0] < pts[best][0] ? i : best),
        0,
      ),
      right = pts.reduce((best, a, i) => (a[0] > pts[best][0] ? i : best), 0);
    if (Math.abs(pts[right][0] - pts[left][0]) < 0.01) {
      const top = pts.reduce(
          (best, a, i) => (a[1] > pts[best][1] ? i : best),
          0,
        ),
        bottom = pts.reduce(
          (best, a, i) => (a[1] < pts[best][1] ? i : best),
          0,
        );
      return [
        ...new Set([
          top,
          bottom,
          nearest([
            (pts[top][0] + pts[bottom][0]) / 2,
            (pts[top][1] + pts[bottom][1]) / 2,
          ]),
        ]),
      ].sort((a, b) => a - b);
    }
    return [
      ...new Set([
        left,
        right,
        nearest([
          (pts[left][0] + pts[right][0]) / 2,
          (pts[left][1] + pts[right][1]) / 2,
        ]),
      ]),
    ].sort((a, b) => a - b);
  }
  const levels = p.semanticModel.rings
    .filter((r) => r.kind !== "midline")
    .map(
      (r) =>
        r.samples.reduce(
          (sum, s) => sum + project(p.surface.vertices[s.vertexId], view)[1],
          0,
        ) / r.samples.length,
    )
    .sort((a, b) => b - a);
  const ys = [...levels, ...levels.slice(1).map((y, i) => (y + levels[i]) / 2)];
  const selected = new Set<number>();
  for (const y of ys) {
    const hits: Vec2[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if ((a[1] - y) * (b[1] - y) <= 0 && Math.abs(a[1] - b[1]) > 1e-9) {
        const t = (y - a[1]) / (b[1] - a[1]);
        hits.push([a[0] + t * (b[0] - a[0]), y]);
      }
    });
    hits.sort((a, b) => a[0] - b[0]);
    if (hits.length) {
      selected.add(nearest(hits[0]));
      selected.add(nearest(hits.at(-1)!));
    }
  }
  selected.add(pts.reduce((best, a, i) => (a[1] > pts[best][1] ? i : best), 0));
  selected.add(pts.reduce((best, a, i) => (a[1] < pts[best][1] ? i : best), 0));
  return [...selected].sort((a, b) => a - b);
}
export function initializeHandles(p: HeadProject) {
  for (const c of p.constraints)
    if (!c.curve.handles) c.curve.handles = sparseHandles(p, c);
  return p;
}
