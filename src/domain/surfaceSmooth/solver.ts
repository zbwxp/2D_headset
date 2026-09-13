import { add, sub, scale, dot, cross, normalize } from "../geometry/core";
import { controls, canonical, type ControlPoints } from "../curves/geometry";
import { mirror, type LandmarkProject } from "../landmarks/model";
import type { Vec3 } from "../project/types";
import {
  evaluate,
  derivative,
  regular,
  selfCrossing,
  spansCross,
  norm,
} from "../junctions/spatial";
import { config, incident, key, mirrorHalf } from "./config";
import type {
  ResolvedNode,
  ResolvedNetwork,
  HalfResult,
  ResolvedSpan,
} from "./model";
export const SAME_PLANE = 1e-12,
  INTERSECTION_STABILITY = 1e-7,
  TANGENT_TOLERANCE = 1e-8;
// Symmetric Jacobi eigensolver: fixed pivot ordering, fixed iteration cap.
export function eigen(M: number[][]) {
  const a = M.map((r) => [...r]),
    v = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  for (let it = 0; it < 40; it++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) {
        p = i;
        q = j;
      }
    if (Math.abs(a[p][q]) < 1e-15) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
      c = Math.cos(angle),
      s = Math.sin(angle);
    const J = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    J[p][p] = c;
    J[q][q] = c;
    J[p][q] = s;
    J[q][p] = -s;
    const mul = (x: number[][], y: number[][]) =>
      x.map((r) =>
        y[0].map((_, j) => r.reduce((n, z, k) => n + z * y[k][j], 0)),
      );
    const b = mul(
        mul(
          J[0].map((_, i) => J.map((r) => r[i])),
          a,
        ),
        J,
      ),
      w = mul(v, J);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        a[i][j] = b[i][j];
        v[i][j] = w[i][j];
      }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i][i], vector: v.map((r) => r[i]) as Vec3 }))
    .sort((a, b) => a.value - b.value);
}
const sign = (n: Vec3): Vec3 => {
  let i = 0;
  for (let j = 1; j < 3; j++) if (Math.abs(n[j]) > Math.abs(n[i])) i = j;
  return n[i] < 0 ? scale(n, -1) : n;
};
export function plane(t: Vec3[], normals: Vec3[], symmetric: boolean): Vec3 {
  const M = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => t.reduce((s, v) => s + v[i] * v[j], 0)),
  );
  if (symmetric) M[0][1] = M[1][0] = M[0][2] = M[2][0] = 0;
  let es = eigen(M);
  const tol = 1e-10 * Math.max(1, t.length);
  // Restrict centerline eigenvectors explicitly to X or YZ, even in repeated eigenspaces.
  if (symmetric) {
    const yz = eigen([
      [1e6, 0, 0],
      [0, M[1][1], M[1][2]],
      [0, M[2][1], M[2][2]],
    ]).filter((e) => Math.abs(e.vector[0]) < 0.5);
    es = [{ value: M[0][0], vector: [1, 0, 0] as Vec3 }, ...yz].sort(
      (a, b) => a.value - b.value,
    );
  }
  const tied = es.filter((e) => e.value - es[0].value <= tol);
  if (tied.length === 1) return sign(normalize(tied[0].vector));
  const ns = normals.map(sign),
    preferred = normalize(ns.reduce(add, [0, 0, 0] as Vec3));
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  axes.sort((a, b) => Math.abs(dot(a, t[0])) - Math.abs(dot(b, t[0])));
  for (const hint of [preferred, ...axes]) {
    if (symmetric) {
      const x = tied.find((e) => Math.abs(e.vector[0]) > 0.5);
      const yz = tied.filter((e) => Math.abs(e.vector[0]) < 0.5);
      const py = yz.reduce(
        (s, e) => add(s, scale(e.vector, dot(hint, e.vector))),
        [0, 0, 0] as Vec3,
      );
      if (x && Math.abs(hint[0]) >= norm(py) && Math.abs(hint[0]) > 1e-10)
        return [1, 0, 0];
      if (norm(py) > 1e-10) return sign(normalize([0, py[1], py[2]]));
    } else {
      const n = tied.reduce(
        (s, e) => add(s, scale(e.vector, dot(hint, e.vector))),
        [0, 0, 0] as Vec3,
      );
      if (norm(n) > 1e-10) return sign(normalize(n));
    }
  }
  throw Error("切平面退化，无法稳定确定方向");
}
export function split(
  cp: ControlPoints,
  t: number,
): [ControlPoints, ControlPoints] {
  const lerp = (a: Vec3, b: Vec3) => add(scale(a, 1 - t), scale(b, t));
  const a = lerp(cp[0], cp[1]),
    b = lerp(cp[1], cp[2]),
    c = lerp(cp[2], cp[3]),
    d = lerp(a, b),
    e = lerp(b, c),
    f = lerp(d, e);
  return [
    [cp[0], a, d, f],
    [f, e, c, cp[3]],
  ];
}
export function exact(cp: ControlPoints, a: number, b: number): ControlPoints {
  if (a === 0 && b === 1) return cp;
  const left = b === 1 ? cp : split(cp, b)[0];
  return a === 0 ? left : split(left, a / b)[1];
}
function table(cp: ControlPoints) {
  let prev = cp[0];
  const a = [0];
  for (let i = 1; i <= 512; i++) {
    const q = evaluate(cp, i / 512);
    a.push(a[i - 1] + norm(sub(q, prev)));
    prev = q;
  }
  return a;
}
function parameter(a: number[], distance: number) {
  let lo = 0,
    hi = 512;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m] < distance) lo = m;
    else hi = m;
  }
  return (lo + (distance - a[lo]) / (a[hi] - a[lo])) / 512;
}
function tangent(cp: ControlPoints, t: number, outward: number): Vec3 {
  let d = scale(derivative(cp, t), outward);
  const L = Math.max(...cp.map((p) => norm(sub(p, cp[0]))));
  if (norm(d) < L * 1e-10) {
    const h = t === 1 ? -1e-5 : 1e-5;
    d = scale(sub(evaluate(cp, t + h), evaluate(cp, t)), outward / h);
  }
  if (!Number.isFinite(norm(d)) || norm(d) < L * 1e-10 || !L)
    throw Error("端点切线无法稳定确定");
  return normalize(d);
}
export function targetTangent(t: Vec3, m: Vec3, n: Vec3): Vec3 {
  const axis = cross(m, n),
    len = norm(axis);
  if (len <= SAME_PLANE) return t;
  if (len < INTERSECTION_STABILITY)
    throw Error("曲线平面与切平面交线数值不稳定");
  let q = scale(axis, 1 / len);
  const orientation = dot(q, t);
  if (Math.abs(orientation) < 1e-8)
    throw Error("目标切线与原切线差异过大，方向选择不稳定");
  if (orientation < 0) q = scale(q, -1);
  return q;
}
function solve(
  p: LandmarkProject,
  id: string,
  cps: Map<string, ControlPoints>,
  tables: Map<string, number[]>,
): ResolvedNode {
  const l = p.landmarks.find((l) => l.id === id)!,
    cfg = config(p, id),
    excluded = new Set(cfg.excludedHalfEdges.map(key)),
    participants = incident(p, id).filter((h) => !excluded.has(key(h)));
  const node: ResolvedNode = {
    landmarkId: id,
    state: !cfg.enabled ? "OFF" : participants.length < 2 ? "NO_OP" : "VALID",
    stress: "NORMAL",
    participants,
    halves: [],
  };
  if (node.state !== "VALID") return node;
  try {
    const ts = participants.map((h) =>
      tangent(
        cps.get(h.curveId)!,
        h.endpoint === "start" ? 0 : 1,
        h.endpoint === "start" ? 1 : -1,
      ),
    );
    const ms = participants.map((h) => {
      const c = p.curves.find((c) => c.id === h.curveId)!,
        m = canonical(p, c).shape.planeNormal;
      return c.role === "mirror" ? mirror(m) : m;
    });
    const n = plane(ts, ms, l.type === "CENTERLINE");
    node.normal = n;
    const support =
      cfg.extent *
      Math.min(...participants.map((h) => tables.get(h.curveId)!.at(-1)!));
    if (!Number.isFinite(support) || support <= 0) throw Error("裁剪弧长退化");
    const halves: HalfResult[] = [];
    for (let i = 0; i < participants.length; i++) {
      const half = participants[i],
        cp = cps.get(half.curveId)!,
        a = tables.get(half.curveId)!,
        start = half.endpoint === "start",
        t = ts[i],
        m = ms[i],
        q = targetTangent(t, m, n);
      const angle = Math.atan2(norm(cross(t, q)), dot(t, q));
      if (angle > Math.PI / 4) node.stress = "HIGH_STRESS";
      const trimT = parameter(a, start ? support : a[512] - support),
        Pi = evaluate(cp, trimT),
        D = norm(sub(Pi, l.position));
      const h: HalfResult = {
        half,
        tangent: t,
        target: q,
        angle,
        trimPoint: Pi,
        trimT,
      };
      if (angle > TANGENT_TOLERANCE) {
        if (D <= a[512] * 1e-10) throw Error("裁剪点与顶点重合");
        if (norm(derivative(cp, trimT)) <= a[512] * 1e-10)
          throw Error("裁剪点切线无法稳定确定");
        const u = tangent(cp, trimT, start ? 1 : -1);
        const cubic: ControlPoints = [
          l.position,
          add(l.position, scale(q, D / 3)),
          sub(Pi, scale(u, D / 3)),
          Pi,
        ];
        if (
          !cubic.flat().every(Number.isFinite) ||
          !regular(cubic.map((v) => scale(sub(v, l.position), 1 / D))) ||
          selfCrossing(cubic.map((v) => scale(sub(v, l.position), 1 / D)))
        )
          throw Error("局部曲线退化或自交");
        const outside = exact(cp, start ? trimT : 0, start ? 1 : trimT);
        if (spansCross(cubic, outside))
          throw Error("局部曲线与外侧 source 相交");
        h.fairing = start ? cubic : ([...cubic].reverse() as ControlPoints);
      }
      halves.push(h);
    }
    // All participants commit together; failed nodes never leak partial fairings.
    for (let i = 0; i < halves.length; i++)
      for (let j = i + 1; j < halves.length; j++) {
        const a = halves[i],
          b = halves[j];
        if (!a.fairing && !b.fairing) continue;
        const ca =
          a.fairing ??
          exact(
            cps.get(a.half.curveId)!,
            a.half.endpoint === "start" ? 0 : a.trimT,
            a.half.endpoint === "start" ? a.trimT : 1,
          );
        const cb =
          b.fairing ??
          exact(
            cps.get(b.half.curveId)!,
            b.half.endpoint === "start" ? 0 : b.trimT,
            b.half.endpoint === "start" ? b.trimT : 1,
          );
        if (spansCross(ca, cb))
          throw Error("局部参与曲线相交，可能发生拓扑翻转");
      }
    node.halves = halves;
  } catch (e) {
    node.state = "INVALID";
    node.reason = (e as Error).message;
    node.halves = [];
  }
  return node;
}
const cache = new WeakMap<LandmarkProject, ResolvedNetwork>();
export function resolveNetwork(p: LandmarkProject): ResolvedNetwork {
  const hit = cache.get(p);
  if (hit) return hit;
  const cps = new Map(p.curves.map((c) => [c.id, controls(p, c)])),
    tables = new Map([...cps].map(([id, cp]) => [id, table(cp)]));
  const nodes: ResolvedNode[] = [];
  for (const l of [...p.landmarks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (l.type === "RIGHT" && l.mirrorPartnerId) continue;
    const node = solve(p, l.id, cps, tables);
    nodes.push(node);
    if (l.type === "CENTERLINE" && node.state === "VALID") {
      for (const h of node.halves) {
        const c = p.curves.find((c) => c.id === h.half.curveId)!;
        if (c.role !== "mirror") continue;
        const source = node.halves.find(
          (x) =>
            x.half.curveId === c.canonicalCurveId &&
            x.half.endpoint === h.half.endpoint,
        );
        if (source) {
          h.target = mirror(source.target);
          h.tangent = mirror(source.tangent);
          h.trimPoint = mirror(source.trimPoint);
          h.trimT = source.trimT;
          h.fairing = source.fairing?.map(mirror) as ControlPoints | undefined;
        }
      }
    }
    if (l.type === "LEFT" && l.mirrorPartnerId)
      nodes.push({
        ...node,
        landmarkId: l.mirrorPartnerId,
        normal: node.normal ? mirror(node.normal) : undefined,
        participants: node.participants.map((h) => mirrorHalf(p, h)),
        halves: node.halves.map((h) => ({
          ...h,
          half: mirrorHalf(p, h.half),
          tangent: mirror(h.tangent),
          target: mirror(h.target),
          trimPoint: mirror(h.trimPoint),
          fairing: h.fairing?.map(mirror) as ControlPoints | undefined,
        })),
      });
  }
  const at = (id: string, end: "start" | "end") =>
    nodes.find(
      (n) =>
        n.state === "VALID" &&
        n.halves.some((h) => h.half.curveId === id && h.half.endpoint === end),
    );
  const overlapping = new Set<string>();
  for (const c of p.curves) {
    const a = at(c.id, "start"),
      b = at(c.id, "end"),
      ha = a?.halves.find(
        (h) => h.half.curveId === c.id && h.half.endpoint === "start",
      ),
      hb = b?.halves.find(
        (h) => h.half.curveId === c.id && h.half.endpoint === "end",
      );
    if (ha?.fairing && hb?.fairing && ha.trimT >= hb.trimT - 1e-10)
      for (const n of [a!, b!]) {
        overlapping.add(n.landmarkId);
        const partner = p.landmarks.find(
          (l) => l.id === n.landmarkId,
        )?.mirrorPartnerId;
        if (partner) overlapping.add(partner);
      }
  }
  for (const n of nodes)
    if (overlapping.has(n.landmarkId)) {
      n.state = "INVALID";
      n.reason = "两端裁剪范围重叠";
      n.halves = [];
    }
  const spans: ResolvedSpan[] = [];
  for (const c of p.curves) {
    const a = at(c.id, "start"),
      b = at(c.id, "end"),
      ha = a?.halves.find(
        (h) => h.half.curveId === c.id && h.half.endpoint === "start",
      ),
      hb = b?.halves.find(
        (h) => h.half.curveId === c.id && h.half.endpoint === "end",
      ),
      lo = ha?.fairing ? ha.trimT : 0,
      hi = hb?.fairing ? hb.trimT : 1;
    if (ha?.fairing)
      spans.push({
        kind: "blend",
        curveId: c.id,
        controls: ha.fairing,
        sourceRange: [0, lo],
        landmarkId: a!.landmarkId,
        junctionId: a!.landmarkId,
      });
    spans.push({
      kind: "outer",
      curveId: c.id,
      controls: exact(cps.get(c.id)!, lo, hi),
      sourceRange: [lo, hi],
    });
    if (hb?.fairing)
      spans.push({
        kind: "blend",
        curveId: c.id,
        controls: hb.fairing,
        sourceRange: [hi, 1],
        landmarkId: b!.landmarkId,
        junctionId: b!.landmarkId,
      });
  }
  const result = { nodes, spans };
  cache.set(p, result);
  return result;
}
