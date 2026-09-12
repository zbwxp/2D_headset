import { add, sub, dot, cross, scale, normalize } from "../geometry/core";
import {
  controls,
  canonical,
  bezier,
  type ControlPoints,
} from "../curves/geometry";
import { mirror, type LandmarkProject } from "../landmarks/model";
import type { Vec3 } from "../project/types";
import type {
  CurveHalfEdgeRef,
  SmoothJunction,
  ResolvedJunction,
  ResolvedNetwork,
  ResolvedSpan,
} from "./model";
import { junctionInstances } from "./topology";
export const SAME_PLANE_TOLERANCE = 1e-10;
export const INTERSECTION_STABILITY_TOLERANCE = 1e-5;
export const TANGENT_TOLERANCE = 1e-10;
export const MIN_ARC_LENGTH = 1e-8;
export const ARC_STEPS = 512;
const lerp = (a: Vec3, b: Vec3, t: number) => add(scale(a, 1 - t), scale(b, t));
export function splitCubic(
  cp: ControlPoints,
  t: number,
): [ControlPoints, ControlPoints] {
  const a = lerp(cp[0], cp[1], t),
    b = lerp(cp[1], cp[2], t),
    c = lerp(cp[2], cp[3], t),
    d = lerp(a, b, t),
    e = lerp(b, c, t),
    q = lerp(d, e, t);
  return [
    [cp[0], a, d, q],
    [q, e, c, cp[3]],
  ];
}
export function subCubic(
  cp: ControlPoints,
  start: number,
  end: number,
): ControlPoints {
  if (start === 0 && end === 1) return cp;
  const left = end === 1 ? cp : splitCubic(cp, end)[0];
  return start === 0 ? left : splitCubic(left, start / end)[1];
}
export function derivative(cp: ControlPoints, t: number): Vec3 {
  return add(
    add(
      scale(sub(cp[1], cp[0]), 3 * (1 - t) ** 2),
      scale(sub(cp[2], cp[1]), 6 * (1 - t) * t),
    ),
    scale(sub(cp[3], cp[2]), 3 * t * t),
  );
}
export function arcTable(cp: ControlPoints): number[] {
  const table = [0];
  let previous = cp[0];
  for (let i = 1; i <= ARC_STEPS; i++) {
    const q = bezier(cp, i / ARC_STEPS);
    table.push(table[i - 1] + Math.hypot(...sub(q, previous)));
    previous = q;
  }
  return table;
}
export function arcParameter(table: number[], distance: number): number {
  const total = table.at(-1)!;
  distance = Math.max(0, Math.min(total, distance));
  let lo = 0,
    hi = table.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (table[m] < distance) lo = m;
    else hi = m;
  }
  const delta = table[hi] - table[lo];
  return (
    (lo + (delta > 0 ? (distance - table[lo]) / delta : 0)) / (table.length - 1)
  );
}
function planeNormal(p: LandmarkProject, curveId: string): Vec3 {
  const c = p.curves.find((c) => c.id === curveId)!,
    n = canonical(p, c).shape.planeNormal;
  return c.role === "mirror" ? mirror(n) : n;
}
function orient(t: Vec3, a: Vec3, b: Vec3): Vec3 {
  const score = dot(t, a) + dot(t, b);
  if (score < 0) return scale(t, -1);
  if (Math.abs(score) < TANGENT_TOLERANCE) {
    const first = t.find((x) => Math.abs(x) > TANGENT_TOLERANCE) ?? 1;
    return first < 0 ? scale(t, -1) : t;
  }
  return t;
}
export function commonTangent(
  nA: Vec3,
  nB: Vec3,
  uA: Vec3,
  uB: Vec3,
  selfMirror = false,
): Vec3 {
  let t: Vec3;
  if (selfMirror) {
    if (
      Math.abs(nA[0]) > SAME_PLANE_TOLERANCE ||
      Math.abs(nB[0]) > SAME_PLANE_TOLERANCE
    )
      throw new Error(
        "当前两侧曲线平面无法在保持原平面时形成左右对称 G1 连接。",
      );
    if (Math.abs(uA[0] + uB[0]) < TANGENT_TOLERANCE)
      throw new Error(
        "当前两条结构线形成尖点或 U-turn，无法稳定生成平滑连接。",
      );
    t = [1, 0, 0];
  } else {
    const raw = cross(nA, nB),
      length = Math.hypot(...raw);
    if (length >= INTERSECTION_STABILITY_TOLERANCE) t = scale(raw, 1 / length);
    else if (length <= SAME_PLANE_TOLERANCE) {
      const sum = add(uA, uB),
        projected = sub(sum, scale(nA, dot(sum, nA)));
      if (Math.hypot(...projected) < TANGENT_TOLERANCE)
        throw new Error(
          "当前两条结构线形成尖点或 U-turn，无法稳定生成平滑连接。",
        );
      t = normalize(projected);
    } else
      throw new Error(
        "曲线平面过于接近平行，但不属于同一平面，无法形成稳定共同切线。",
      );
  }
  t = orient(t, uA, uB);
  if (
    Math.abs(dot(t, nA)) > 2 * SAME_PLANE_TOLERANCE ||
    Math.abs(dot(t, nB)) > 2 * SAME_PLANE_TOLERANCE
  )
    throw new Error("共同切线不能同时保持两侧曲线平面。");
  return t;
}
function resolveOne(
  p: LandmarkProject,
  j: SmoothJunction,
  tables: Map<string, number[]>,
): ResolvedJunction {
  const result: ResolvedJunction = {
    sourceId: j.id,
    landmarkId: j.landmarkId,
    sideA: j.sideA,
    sideB: j.sideB,
    mirrored: false,
    state: "INVALID",
  };
  try {
    const ca = p.curves.find((c) => c.id === j.sideA.curveId)!,
      cb = p.curves.find((c) => c.id === j.sideB.curveId)!,
      a = controls(p, ca),
      b = controls(p, cb),
      v = p.landmarks.find((l) => l.id === j.landmarkId)!.position;
    const ta = tables.get(ca.id)!,
      tb = tables.get(cb.id)!,
      la = ta.at(-1)!,
      lb = tb.at(-1)!;
    if (!Number.isFinite(la + lb) || Math.min(la, lb) < MIN_ARC_LENGTH)
      throw new Error("结构线长度退化，无法确定平滑范围。");
    const distance = j.extent * Math.min(la, lb);
    const tA = arcParameter(
        ta,
        j.sideA.endpoint === "start" ? distance : la - distance,
      ),
      tB = arcParameter(
        tb,
        j.sideB.endpoint === "start" ? distance : lb - distance,
      );
    const q1 = bezier(a, tA),
      q2 = bezier(b, tB),
      dA = Math.hypot(...sub(v, q1)),
      dB = Math.hypot(...sub(q2, v));
    const rawA = scale(
        derivative(a, tA),
        j.sideA.endpoint === "start" ? -1 : 1,
      ),
      rawB = scale(derivative(b, tB), j.sideB.endpoint === "start" ? 1 : -1);
    if (
      Math.min(dA, dB, Math.hypot(...rawA), Math.hypot(...rawB)) <
      MIN_ARC_LENGTH
    )
      throw new Error("平滑边界位置或切线退化，无法稳定生成连接。");
    const uA = normalize(rawA),
      uB = normalize(rawB),
      selfMirror = j.symmetry === "self" && ca.mirrorPartnerCurveId === cb.id;
    const t = commonTangent(
      planeNormal(p, ca.id),
      planeNormal(p, cb.id),
      uA,
      uB,
      selfMirror,
    );
    const blendA: ControlPoints = [
      q1,
      add(q1, scale(uA, dA / 3)),
      sub(v, scale(t, dA / 3)),
      v,
    ];
    let blendB: ControlPoints = [
      v,
      add(v, scale(t, dB / 3)),
      sub(q2, scale(uB, dB / 3)),
      q2,
    ];
    if (selfMirror) blendB = blendA.map(mirror).reverse() as ControlPoints;
    return { ...result, state: "VALID", blendA, blendB, tA, tB, distance };
  } catch (e) {
    return { ...result, reason: (e as Error).message };
  }
}
const cache = new WeakMap<LandmarkProject, ResolvedNetwork>();
export function resolveNetwork(p: LandmarkProject): ResolvedNetwork {
  const cached = cache.get(p);
  if (cached) return cached;
  const tables = new Map(p.curves.map((c) => [c.id, arcTable(controls(p, c))]));
  const junctions: ResolvedJunction[] = [];
  for (const j of p.smoothJunctions) {
    const result = resolveOne(p, j, tables);
    junctions.push(result);
    const other = junctionInstances(p, j)[1];
    if (other)
      junctions.push({
        ...result,
        ...other,
        mirrored: true,
        blendA: result.blendA?.map(mirror) as ControlPoints | undefined,
        blendB: result.blendB?.map(mirror) as ControlPoints | undefined,
      });
  }
  // Check both ends together, before applying any trims. Invalid intentions still own half-edges.
  const claims = new Map<
    string,
    { start?: ResolvedJunction; end?: ResolvedJunction }
  >();
  for (const j of junctions)
    if (j.state === "VALID")
      for (const h of [j.sideA, j.sideB]) {
        const c = claims.get(h.curveId) ?? {};
        c[h.endpoint] = j;
        claims.set(h.curveId, c);
      }
  const invalid = new Set<string>();
  for (const [id, c] of claims) {
    const L = tables.get(id)!.at(-1)!;
    if (
      (c.start?.distance ?? 0) + (c.end?.distance ?? 0) >=
      L - Math.max(1e-10, L * 1e-8)
    ) {
      if (c.start) invalid.add(c.start.sourceId);
      if (c.end) invalid.add(c.end.sourceId);
    }
  }
  for (const j of junctions)
    if (invalid.has(j.sourceId)) {
      j.state = "INVALID";
      j.reason = "两端平滑范围发生重叠，或剩余外侧范围过小。";
      delete j.blendA;
      delete j.blendB;
    }
  const ranges = new Map(
      p.curves.map((c) => [c.id, [0, 1] as [number, number]]),
    ),
    spans: ResolvedSpan[] = [];
  for (const j of junctions)
    if (j.state === "VALID") {
      for (const [h, t, cp] of [
        [j.sideA, j.tA!, j.blendA!],
        [j.sideB, j.tB!, j.blendB!],
      ] as [CurveHalfEdgeRef, number, ControlPoints][]) {
        ranges.get(h.curveId)![h.endpoint === "start" ? 0 : 1] = t;
        spans.push({
          kind: "blend",
          curveId: h.curveId,
          controls: cp,
          junctionId: j.sourceId,
          landmarkId: j.landmarkId,
        });
      }
    }
  for (const c of p.curves) {
    const range = ranges.get(c.id)!;
    spans.push({
      kind: "outer",
      curveId: c.id,
      controls: subCubic(controls(p, c), ...range),
      sourceRange: range,
    });
  }
  const result = { spans, junctions };
  cache.set(p, result);
  return result;
}

/** Ordered local composite, not a new edge identity. Render the shared network only once. */
export function junctionPath(
  p: LandmarkProject,
  j: ResolvedJunction,
): { spans: ControlPoints[] } | null {
  if (j.state !== "VALID") return null;
  const network = resolveNetwork(p),
    a = network.spans.find(
      (s) => s.kind === "outer" && s.curveId === j.sideA.curveId,
    )!,
    b = network.spans.find(
      (s) => s.kind === "outer" && s.curveId === j.sideB.curveId,
    )!;
  return {
    spans: [
      j.sideA.endpoint === "start"
        ? ([...a.controls].reverse() as ControlPoints)
        : a.controls,
      j.blendA!,
      j.blendB!,
      j.sideB.endpoint === "end"
        ? ([...b.controls].reverse() as ControlPoints)
        : b.controls,
    ],
  };
}
