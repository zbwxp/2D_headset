import type { LandmarkProject } from "../landmarks/model";
import type { CurveEdge } from "./model";
import { dot, sub } from "../geometry/core";
import { CURVE_EPS } from "./geometry";
export function parseCurves(input: unknown, p: LandmarkProject): CurveEdge[] {
  if (input === undefined) return [];
  const fail = () => {
    throw new Error("结构线数据无效：请检查端点、平面或镜像关系。");
  };
  if (!Array.isArray(input)) return fail();
  const ids = new Set<string>();
  const curves: CurveEdge[] = input.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(c.id) ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 80
    )
      return fail();
    ids.add(c.id);
    const a = p.landmarks.find((l) => l.id === c.startLandmarkId),
      b = p.landmarks.find((l) => l.id === c.endLandmarkId);
    if (
      !a ||
      !b ||
      a.id === b.id ||
      a.type === "FREE" ||
      b.type === "FREE" ||
      (a.type !== "CENTERLINE" && b.type !== "CENTERLINE" && a.type !== b.type)
    )
      return fail();
    const center = a.type === "CENTERLINE" && b.type === "CENTERLINE";
    if (
      center
        ? c.role !== "canonical" || c.mirrorPartnerCurveId !== undefined
        : typeof c.mirrorPartnerCurveId !== "string"
    )
      return fail();
    const common = {
      id: c.id,
      name: c.name,
      startLandmarkId: a.id,
      endLandmarkId: b.id,
      mirrorPartnerCurveId: c.mirrorPartnerCurveId,
    };
    if (c.role === "mirror") {
      if (typeof c.canonicalCurveId !== "string" || c.shape !== undefined)
        return fail();
      return {
        ...common,
        role: "mirror",
        canonicalCurveId: c.canonicalCurveId,
      };
    }
    if (c.role !== "canonical" || c.canonicalCurveId !== undefined)
      return fail();
    const s = c.shape,
      n = s?.planeNormal;
    if (
      !Array.isArray(n) ||
      n.length !== 3 ||
      !n.every((x: unknown) => typeof x === "number" && Number.isFinite(x))
    )
      return fail();
    const normal = n as [number, number, number],
      chord = sub(b.position, a.position),
      L = Math.hypot(...chord);
    if (
      Math.abs(Math.hypot(...normal) - 1) > 1e-7 ||
      (L > CURVE_EPS && Math.abs(dot(normal, chord) / L) > 1e-7) ||
      (center && Math.hypot(normal[0] - 1, normal[1], normal[2]) > 1e-7)
    )
      return fail();
    for (const h of [s.startHandle, s.endHandle])
      if (
        !h ||
        !Number.isFinite(h.along) ||
        h.along < 0 ||
        h.along > 1 ||
        !Number.isFinite(h.offset)
      )
        return fail();
    return {
      ...common,
      role: "canonical",
      shape: {
        planeNormal: normal,
        startHandle: {
          along: s.startHandle.along,
          offset: s.startHandle.offset,
        },
        endHandle: { along: s.endHandle.along, offset: s.endHandle.offset },
      },
    };
  });
  for (const c of curves) {
    if (!c.mirrorPartnerCurveId) continue;
    const other = curves.find((x) => x.id === c.mirrorPartnerCurveId);
    if (
      !other ||
      other.id === c.id ||
      other.mirrorPartnerCurveId !== c.id ||
      other.role === c.role
    )
      return fail();
    const follower = c.role === "mirror" ? c : other;
    const owner = c.role === "canonical" ? c : other;
    if (follower.role !== "mirror" || follower.canonicalCurveId !== owner.id)
      return fail();
    for (const key of ["startLandmarkId", "endLandmarkId"] as const) {
      const l = p.landmarks.find((l) => l.id === c[key])!;
      if (other[key] !== (l.mirrorPartnerId ?? l.id)) return fail();
    }
  }
  return curves;
}
