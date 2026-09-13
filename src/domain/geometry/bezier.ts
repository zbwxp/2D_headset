import type { Vec3 } from "../project/types";
import { add, sub, scale, dot } from "./core";
export type BezierPoints = Vec3[];
export const norm = (v: Vec3) => Math.hypot(...v);
export function evaluate(cp: BezierPoints, t: number): Vec3 {
  let row = cp;
  while (row.length > 1)
    row = row.slice(1).map((p, i) => add(scale(row[i], 1 - t), scale(p, t)));
  return row[0];
}
export function derivativePoints(cp: BezierPoints): BezierPoints {
  return cp.slice(1).map((p, i) => scale(sub(p, cp[i]), cp.length - 1));
}
export const derivative = (cp: BezierPoints, t: number): Vec3 =>
  evaluate(derivativePoints(cp), t);
export function curvature(cp: BezierPoints, t: number): Vec3 {
  const d = derivative(cp, t),
    dd = derivative(derivativePoints(cp), t),
    speed2 = dot(d, d);
  if (speed2 < 1e-28) throw new Error("截点切线退化。");
  return scale(sub(dd, scale(d, dot(d, dd) / speed2)), 1 / speed2);
}
export function split(cp: BezierPoints, t = 0.5): [BezierPoints, BezierPoints] {
  let row = cp;
  const a = [row[0]],
    b = [row.at(-1)!];
  while (row.length > 1) {
    row = row.slice(1).map((p, i) => add(scale(row[i], 1 - t), scale(p, t)));
    a.push(row[0]);
    b.unshift(row.at(-1)!);
  }
  return [a, b];
}
export function bounds(cp: BezierPoints) {
  return {
    min: [0, 1, 2].map((k) => Math.min(...cp.map((p) => p[k]))),
    max: [0, 1, 2].map((k) => Math.max(...cp.map((p) => p[k]))),
  };
}
const pointSegment = (p: Vec3, a: Vec3, b: Vec3) => {
  const d = sub(b, a),
    t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (dot(d, d) || 1)));
  return norm(sub(p, add(a, scale(d, t))));
};
/** Convex-hull distance to the chord bounds the tessellation error; never fits a cubic. */
export function flatten(
  cp: BezierPoints,
  tolerance: number,
  maxDepth = 20,
): Vec3[] {
  const out = [cp[0]];
  const visit = (q: BezierPoints, depth: number) => {
    const err = Math.max(...q.map((p) => pointSegment(p, q[0], q.at(-1)!)));
    if (err <= tolerance) {
      out.push(q.at(-1)!);
      return;
    }
    if (depth === 0) throw new Error("曲线采样未达到误差界限。");
    const [a, b] = split(q);
    visit(a, depth - 1);
    visit(b, depth - 1);
  };
  visit(cp, maxDepth);
  return out;
}

/** Deterministic chord-length table for general Bezier utilities. */
export function arcLengthLUT(cp: BezierPoints, segments = 512): number[] {
  const distances = [0];
  let previous = cp[0];
  for (let i = 1; i <= segments; i++) {
    const p = evaluate(cp, i / segments);
    distances.push(distances[i - 1] + norm(sub(p, previous)));
    previous = p;
  }
  return distances;
}
