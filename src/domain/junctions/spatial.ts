import type { Vec3 } from "../project/types";
import { add, sub, scale, dot } from "../geometry/core";
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
const polynomial = (c: number[], t: number) =>
  c.reduceRight((a, x) => a * t + x, 0);
/** Derivative-root isolation partitions a degree-six polynomial into monotone intervals.
 * Includes even-multiplicity contacts; no assumption about distance monotonicity. */
export function roots01(input: number[]): number[] {
  const c = [...input];
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-14) c.pop();
  if (c.length <= 1) return [];
  const critical = roots01(c.slice(1).map((x, i) => x * (i + 1))),
    breaks = [0, ...critical, 1],
    roots: number[] = [];
  for (const t of breaks) if (Math.abs(polynomial(c, t)) < 1e-11) roots.push(t);
  for (let i = 1; i < breaks.length; i++) {
    let a = breaks[i - 1],
      b = breaks[i],
      fa = polynomial(c, a),
      fb = polynomial(c, b);
    if (fa * fb >= 0) continue;
    for (let k = 0; k < 55; k++) {
      const m = (a + b) / 2,
        f = polynomial(c, m);
      if (f * fa > 0) {
        a = m;
        fa = f;
      } else {
        b = m;
        fb = f;
      }
    }
    roots.push((a + b) / 2);
  }
  return roots
    .sort((a, b) => a - b)
    .filter((t, i, a) => i === 0 || t - a[i - 1] > 1e-8);
}
export function sphereExit(
  cp: BezierPoints,
  v: Vec3,
  r: number,
  endpoint: "start" | "end",
): number {
  if (!(r > 0)) throw new Error("裁剪球半径退化。");
  const q = (endpoint === "end" ? [...cp].reverse() : cp).map((p) =>
    scale(sub(p, v), 1 / r),
  );
  const power = [
    q[0],
    scale(sub(q[1], q[0]), 3),
    scale(add(sub(q[2], scale(q[1], 2)), q[0]), 3),
    add(sub(q[3], scale(q[2], 3)), sub(scale(q[1], 3), q[0])),
  ];
  const f = Array(7).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) f[i + j] += dot(power[i], power[j]);
  f[0] -= 1;
  const roots = roots01(f);
  for (let i = 0; i < roots.length; i++) {
    const t = roots[i],
      next = roots[i + 1] ?? 1;
    if (t < 1 - 1e-9 && polynomial(f, (t + next) / 2) > 1e-10)
      return endpoint === "end" ? 1 - t : t;
  }
  throw new Error(
    roots.length
      ? "球面仅相切或没有可保留的首次出界段。"
      : "源曲线未离开裁剪球，请减小平滑范围。",
  );
}
export function quintic(
  a: Vec3,
  b: Vec3,
  u: Vec3,
  w: Vec3,
  k: Vec3,
  l: Vec3,
  h: number,
  g: number,
): BezierPoints {
  return [
    a,
    add(a, scale(u, h / 5)),
    add(add(a, scale(u, (2 * h) / 5)), scale(k, (h * h) / 20)),
    add(sub(b, scale(w, (2 * g) / 5)), scale(l, (g * g) / 20)),
    sub(b, scale(w, g / 5)),
    b,
  ];
}
/** Positive projection of each derivative hull certifies nonzero derivative locally. */
export function regular(cp: BezierPoints, depth = 16): boolean {
  const ds = derivativePoints(cp),
    middle = evaluate(ds, 0.5),
    m = norm(middle);
  if (m < 1e-7) return false;
  const u = scale(middle, 1 / m);
  if (ds.every((d) => dot(d, u) > 1e-7)) return true;
  if (!depth) return false;
  const [a, b] = split(cp);
  return regular(a, depth - 1) && regular(b, depth - 1);
}
export function segmentDistance(p: Vec3, q: Vec3, a: Vec3, b: Vec3): number {
  const u = sub(q, p),
    v = sub(b, a),
    w = sub(p, a),
    aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w),
    den = aa * cc - bb * bb;
  let s = den > 1e-30 ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / den)) : 0;
  let t = cc ? (bb * s + ee) / cc : 0;
  if (t < 0) {
    t = 0;
    s = aa ? Math.max(0, Math.min(1, -dd / aa)) : 0;
  } else if (t > 1) {
    t = 1;
    s = aa ? Math.max(0, Math.min(1, (bb - dd) / aa)) : 0;
  }
  return norm(sub(add(p, scale(u, s)), add(a, scale(v, t))));
}
export function selfCrossing(cp: BezierPoints): boolean {
  const pts = flatten(cp, 1e-4);
  for (let i = 1; i < pts.length; i++)
    for (let j = i + 2; j < pts.length; j++)
      if (segmentDistance(pts[i - 1], pts[i], pts[j - 1], pts[j]) < 2e-4)
        return true;
  return false;
}
export interface Quality {
  score: number;
  peakCurvature: number;
  length: number;
  overshoot: number;
  hA: number;
  hB: number;
}
export function chooseTransition(
  a: Vec3,
  b: Vec3,
  u: Vec3,
  w: Vec3,
  k: Vec3,
  l: Vec3,
  reference: Vec3[],
  symmetric: boolean,
): { cp: BezierPoints; quality: Quality; warning?: string } {
  const chord = norm(sub(b, a));
  if (chord < 1e-5) throw new Error("两个截点过于接近，当前构造无法稳定连接。");
  const cost = (h: number, g: number) => {
    const cp = quintic(a, b, u, w, k, l, h, g);
    let length = 0,
      energy = 0,
      variation = 0,
      peak = 0,
      over = 0,
      shape = 0,
      prev = a,
      prevK: Vec3 | null = null,
      minForward = 1;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40,
        p = evaluate(cp, t),
        d = derivative(cp, t),
        speed = norm(d);
      minForward = Math.min(minForward, dot(d, sub(b, a)) / (speed * chord));
      if (speed < 1e-5) return { cost: Infinity, cp, quality: null };
      const K = curvature(cp, t),
        km = norm(K),
        ds = norm(sub(p, prev));
      length += ds;
      energy += km * km * ds;
      peak = Math.max(peak, km);
      if (prevK) variation += dot(sub(K, prevK), sub(K, prevK)) / (ds + 1e-8);
      over += Math.max(0, norm(p) - 1) ** 2 / 41;
      shape +=
        Math.min(...reference.map((r) => dot(sub(p, r), sub(p, r)))) / 41;
      prev = p;
      prevK = K;
    }
    const score =
      2 * Math.max(0, -minForward) ** 2 +
      0.035 * energy +
      0.0015 * variation +
      0.003 * peak * peak +
      0.5 * (length / chord - 1) ** 2 +
      2 * over +
      1.5 * shape;
    return {
      cost: score,
      cp,
      quality: {
        score,
        peakCurvature: peak,
        length,
        overshoot: Math.sqrt(over),
        hA: h,
        hB: g,
      },
    };
  };
  // All quantities are normalized by the sphere radius. Stable grid + bounded log-space refinement.
  const low = Math.log(Math.max(0.08, chord * 0.15)),
    high = Math.log(Math.min(8, Math.max(0.8, chord * 4)));
  const candidates: ReturnType<typeof cost>[] = [];
  let best = cost(Math.exp(low), Math.exp(low)),
    x = low,
    y = low;
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) {
      if (symmetric && i !== j) continue;
      const xx = low + ((high - low) * i) / 8,
        yy = low + ((high - low) * j) / 8,
        c = cost(Math.exp(xx), Math.exp(yy));
      candidates.push(c);
      if (c.cost < best.cost) {
        best = c;
        x = xx;
        y = yy;
      }
    }
  let step = (high - low) / 8;
  for (let it = 0; it < 22; it++) {
    let improved = false;
    for (const [dx, dy] of symmetric
      ? [
          [1, 1],
          [-1, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
      const xx = Math.max(low, Math.min(high, x + dx * step)),
        yy = Math.max(low, Math.min(high, y + dy * step)),
        c = cost(Math.exp(xx), Math.exp(yy));
      if (c.cost < best.cost - 1e-10) {
        best = c;
        x = xx;
        y = yy;
        improved = true;
      }
    }
    if (!improved) step *= 0.5;
  }
  candidates.push(best);
  const feasible = candidates
    .sort((a, b) => a.cost - b.cost)
    .find((c) => c.quality && regular(c.cp) && !selfCrossing(c.cp));
  if (feasible) best = feasible;
  if (!feasible || !best.quality)
    throw new Error(
      "当前构造未找到通过零导数／自交检查的结果，请调整范围或源曲线。",
    );
  return {
    cp: best.cp,
    quality: best.quality,
    warning:
      best.quality.peakCurvature > 35 ||
      best.quality.overshoot > 0.25 ||
      best.quality.length / chord > 2.5
        ? "当前构造合法，但存在急弯或较大过冲；可调整平滑范围。"
        : undefined,
  };
}
/** Conservative proximity test on bounded-error polylines, with only shared endpoint contacts exempt. */
export function spansCross(a: BezierPoints, b: BezierPoints): boolean {
  const size = Math.max(...a.map((p) => norm(sub(p, a[0]))));
  if (size <= 0) return false;
  const tol = size * 1e-5,
    boxA = bounds(a),
    boxB = bounds(b);
  if (
    [0, 1, 2].some(
      (k) =>
        boxA.max[k] + 3 * tol < boxB.min[k] ||
        boxB.max[k] + 3 * tol < boxA.min[k],
    )
  )
    return false;
  const shared = [a[0], a.at(-1)!].filter((p) =>
    [b[0], b.at(-1)!].some((q) => norm(sub(p, q)) < tol),
  );
  const aa = flatten(a, tol),
    bb = flatten(b, tol);
  for (let i = 1; i < aa.length; i++)
    for (let j = 1; j < bb.length; j++) {
      if (
        shared.some(
          (p) =>
            Math.min(norm(sub(aa[i - 1], p)), norm(sub(aa[i], p))) < 4 * tol &&
            Math.min(norm(sub(bb[j - 1], p)), norm(sub(bb[j], p))) < 4 * tol,
        )
      )
        continue;
      if (
        [0, 1, 2].some(
          (k) =>
            Math.max(aa[i - 1][k], aa[i][k]) + 3 * tol <
              Math.min(bb[j - 1][k], bb[j][k]) ||
            Math.max(bb[j - 1][k], bb[j][k]) + 3 * tol <
              Math.min(aa[i - 1][k], aa[i][k]),
        )
      )
        continue;
      if (segmentDistance(aa[i - 1], aa[i], bb[j - 1], bb[j]) < 3 * tol)
        return true;
    }
  return false;
}
