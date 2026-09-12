import type { Curve2D, Vec2 } from "../project/types";
export function sampleCurve(curve: Curve2D, u: number): Vec2 {
  const { points: p, parameters: t, closed } = curve;
  u = closed ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u));
  let i = t.length - 1;
  for (let j = 0; j < t.length - 1; j++)
    if (u >= t[j] && u < t[j + 1]) {
      i = j;
      break;
    }
  const next = (i + 1) % p.length;
  if (!closed && i === p.length - 1) return p[i];
  const end = next === 0 ? 1 : t[next];
  const f = Math.max(0, Math.min(1, (u - t[i]) / (end - t[i] || 1)));
  return [
    p[i][0] * (1 - f) + p[next][0] * f,
    p[i][1] * (1 - f) + p[next][1] * f,
  ];
}
export function closestPoint(point: Vec2, curve: Curve2D) {
  let distance = Infinity,
    found: Vec2 = curve.points[0],
    parameter = 0;
  const n = curve.points.length;
  for (let i = 0; i < (curve.closed ? n : n - 1); i++) {
    const j = (i + 1) % n,
      a = curve.points[i],
      b = curve.points[j];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = (q[0] - point[0]) ** 2 + (q[1] - point[1]) ** 2;
    if (d < distance) {
      distance = d;
      found = q;
      parameter =
        curve.parameters[i] +
        t * ((j === 0 ? 1 : curve.parameters[j]) - curve.parameters[i]);
    }
  }
  return { point: found, distance: Math.sqrt(distance), u: parameter };
}
export function curveFromPoints(points: Vec2[], closed: boolean): Curve2D {
  return {
    kind: "polyline",
    points,
    closed,
    parameters: points.map(
      (_, i) => i / (closed ? points.length : points.length - 1),
    ),
  };
}
