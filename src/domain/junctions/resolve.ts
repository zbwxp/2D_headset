import {
  derivative,
  curvature,
  sphereExit,
  chooseTransition,
  norm,
  type BezierPoints,
  spansCross,
} from "./spatial";
export { derivative } from "./spatial";
import { add, sub, scale, normalize } from "../geometry/core";
import { controls, bezier, type ControlPoints } from "../curves/geometry";
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
      cb = p.curves.find((c) => c.id === j.sideB.curveId)!;
    const a = controls(p, ca),
      b = controls(p, cb),
      v = p.landmarks.find((l) => l.id === j.landmarkId)!.position;
    const length = Math.min(
      tables.get(ca.id)!.at(-1)!,
      tables.get(cb.id)!.at(-1)!,
    );
    if (!Number.isFinite(length) || length <= 0)
      throw new Error("源曲线长度退化。");
    const r = j.extent * length,
      tA = sphereExit(a, v, r, j.sideA.endpoint),
      tB = sphereExit(b, v, r, j.sideB.endpoint);
    const A = bezier(a, tA),
      B = bezier(b, tB),
      da = derivative(a, tA),
      db = derivative(b, tB);
    if (Math.min(norm(da), norm(db)) / length < 1e-8)
      throw new Error("截点切线退化。");
    const u = scale(normalize(da), j.sideA.endpoint === "end" ? 1 : -1),
      w = scale(normalize(db), j.sideB.endpoint === "start" ? 1 : -1);
    const local = (q: Vec3) => scale(sub(q, v), 1 / r),
      world = (q: Vec3) => add(v, scale(q, r));
    const reference: Vec3[] = [];
    for (let i = 0; i <= 16; i++) {
      reference.push(
        local(
          bezier(
            a,
            tA + (((j.sideA.endpoint === "end" ? 1 : 0) - tA) * i) / 16,
          ),
        ),
      );
      reference.push(
        local(
          bezier(
            b,
            tB + (((j.sideB.endpoint === "end" ? 1 : 0) - tB) * i) / 16,
          ),
        ),
      );
    }
    const symmetric =
      j.symmetry === "self" && ca.mirrorPartnerCurveId === cb.id;
    const chosen = chooseTransition(
      local(A),
      local(B),
      u,
      w,
      scale(curvature(a, tA), r),
      scale(curvature(b, tB), r),
      reference,
      symmetric,
    );
    const transition = chosen.cp.map(world);
    if (symmetric)
      for (let i = 0; i < 3; i++) transition[5 - i] = mirror(transition[i]);
    return {
      ...result,
      state: "VALID",
      transition,
      tA,
      tB,
      distance: r,
      quality: chosen.quality,
      warning: chosen.warning,
    };
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
  for (const j of (p.smoothJunctions ?? [])) {
    const result = resolveOne(p, j, tables);
    junctions.push(result);
    const other = junctionInstances(p, j)[1];
    if (other)
      junctions.push({
        ...result,
        ...other,
        mirrored: true,
        transition: result.transition?.map(mirror),
      });
  }
  const invalidate = (ids: Set<string>, reason: string) => {
    for (const j of junctions)
      if (ids.has(j.sourceId)) {
        j.state = "INVALID";
        j.reason = reason;
        delete j.transition;
      }
  };
  const claims = new Map<
    string,
    { start?: number; end?: number; ids: string[] }
  >();
  for (const j of junctions)
    if (j.state === "VALID")
      for (const [h, t] of [
        [j.sideA, j.tA!],
        [j.sideB, j.tB!],
      ] as [CurveHalfEdgeRef, number][]) {
        const c = claims.get(h.curveId) ?? { ids: [] };
        c[h.endpoint] = t;
        c.ids.push(j.sourceId);
        claims.set(h.curveId, c);
      }
  for (const c of claims.values())
    if ((c.start ?? 0) >= (c.end ?? 1) - 1e-8)
      invalidate(new Set(c.ids), "两端球体裁剪范围发生重叠，或剩余外围过小。");
  const assemble = () => {
    const ranges = new Map(
        p.curves.map((c) => [c.id, [0, 1] as [number, number]]),
      ),
      spans: ResolvedSpan[] = [];
    for (const j of junctions)
      if (j.state === "VALID") {
        ranges.get(j.sideA.curveId)![j.sideA.endpoint === "start" ? 0 : 1] =
          j.tA!;
        ranges.get(j.sideB.curveId)![j.sideB.endpoint === "start" ? 0 : 1] =
          j.tB!;
        spans.push({
          kind: "blend",
          curveId: j.sideA.curveId,
          controls: j.transition!,
          junctionId: j.sourceId,
          landmarkId: j.landmarkId,
        });
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
    return spans;
  };
  let spans = assemble();
  // Validate transitions against the actual retained network, including other curves.
  // If reverting one junction exposes a source span, recheck until the network stabilizes.
  for (let pass = 0; pass <= (p.smoothJunctions ?? []).length; pass++) {
    const bad = new Set<string>();
    for (let i = 0; i < spans.length; i++)
      if (spans[i].kind === "blend")
        for (let k = i + 1; k < spans.length; k++) {
          if (spansCross(spans[i].controls, spans[k].controls)) {
            bad.add(spans[i].junctionId!);
            if (spans[k].junctionId) bad.add(spans[k].junctionId!);
          }
        }
    if (!bad.size) break;
    invalidate(
      bad,
      "过渡与其他保留边界相交或接近误差界限；当前构造未找到可接受结果。",
    );
    spans = assemble();
  }
  const result = { spans, junctions };
  cache.set(p, result);
  return result;
}
export function junctionPath(
  p: LandmarkProject,
  j: ResolvedJunction,
): { spans: BezierPoints[] } | null {
  if (j.state !== "VALID") return null;
  const n = resolveNetwork(p),
    a = n.spans.find(
      (s) => s.kind === "outer" && s.curveId === j.sideA.curveId,
    )!,
    b = n.spans.find(
      (s) => s.kind === "outer" && s.curveId === j.sideB.curveId,
    )!;
  return {
    spans: [
      j.sideA.endpoint === "start" ? [...a.controls].reverse() : a.controls,
      j.transition!,
      j.sideB.endpoint === "end" ? [...b.controls].reverse() : b.controls,
    ],
  };
}
