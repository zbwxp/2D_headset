import type { LandmarkProject } from "../landmarks/model";
import type { CurveHalfEdgeRef, SmoothJunction } from "./model";
export const halfKey = (h: CurveHalfEdgeRef) => `${h.curveId}:${h.endpoint}`;
export function incidentHalves(
  p: LandmarkProject,
  id: string,
): CurveHalfEdgeRef[] {
  return p.curves.flatMap((c) => [
    ...(c.startLandmarkId === id
      ? [{ curveId: c.id, endpoint: "start" as const }]
      : []),
    ...(c.endLandmarkId === id
      ? [{ curveId: c.id, endpoint: "end" as const }]
      : []),
  ]);
}
export function mirrorHalf(
  p: LandmarkProject,
  h: CurveHalfEdgeRef,
): CurveHalfEdgeRef {
  const c = p.curves.find((c) => c.id === h.curveId)!;
  return { ...h, curveId: c.mirrorPartnerCurveId ?? c.id };
}
export function junctionInstances(p: LandmarkProject, j: SmoothJunction) {
  const first = {
    landmarkId: j.landmarkId,
    sideA: j.sideA,
    sideB: j.sideB,
    mirrored: false,
  };
  if (j.symmetry === "self") return [first];
  return [
    first,
    {
      landmarkId:
        p.landmarks.find((l) => l.id === j.landmarkId)!.mirrorPartnerId ??
        j.landmarkId,
      sideA: mirrorHalf(p, j.sideA),
      sideB: mirrorHalf(p, j.sideB),
      mirrored: true,
    },
  ];
}
export function occupiedHalves(p: LandmarkProject): Set<string> {
  return new Set(
    p.smoothJunctions.flatMap((j) =>
      junctionInstances(p, j).flatMap((i) => [
        halfKey(i.sideA),
        halfKey(i.sideB),
      ]),
    ),
  );
}
export function normalizePair(
  p: LandmarkProject,
  landmarkId: string,
  a: CurveHalfEdgeRef,
  b: CurveHalfEdgeRef,
): Pick<SmoothJunction, "landmarkId" | "sideA" | "sideB" | "symmetry"> {
  const point = p.landmarks.find((l) => l.id === landmarkId);
  const incident = new Set(incidentHalves(p, landmarkId).map(halfKey));
  if (
    !point ||
    !incident.has(halfKey(a)) ||
    !incident.has(halfKey(b)) ||
    halfKey(a) === halfKey(b) ||
    a.curveId === b.curveId
  )
    throw new Error("请选择共同语义点上的两条不同结构线端点。");
  const mirrorA = mirrorHalf(p, a),
    mirrorB = mirrorHalf(p, b),
    keys = [halfKey(a), halfKey(b)],
    mirrorKeys = [halfKey(mirrorA), halfKey(mirrorB)];
  const overlap = keys.filter((k) => mirrorKeys.includes(k)).length;
  if (overlap === 1)
    throw new Error("此配对无法保持左右对称：中心线 half-edge 会被重复占用。");
  const self = overlap === 2;
  if (self && point.type !== "CENTERLINE")
    throw new Error("自对称平滑必须位于中心线点。");
  if (
    point.type === "LEFT" ||
    (point.type === "CENTERLINE" &&
      !self &&
      mirrorKeys.slice().sort().join("|") < keys.slice().sort().join("|"))
  ) {
    a = mirrorA;
    b = mirrorB;
    landmarkId = point.mirrorPartnerId ?? landmarkId;
  }
  if (halfKey(a) > halfKey(b)) [a, b] = [b, a];
  return {
    landmarkId,
    sideA: { ...a },
    sideB: { ...b },
    symmetry: self ? "self" : "paired",
  };
}
export function pruneJunctions(p: LandmarkProject): LandmarkProject {
  const ids = new Set(p.curves.map((c) => c.id)),
    points = new Set(p.landmarks.map((l) => l.id));
  return {
    ...p,
    smoothJunctions: p.smoothJunctions.filter(
      (j) =>
        points.has(j.landmarkId) &&
        ids.has(j.sideA.curveId) &&
        ids.has(j.sideB.curveId),
    ),
  };
}
