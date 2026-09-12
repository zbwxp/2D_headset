import type { LandmarkProject, LandmarkView } from "../landmarks/model";
import { normalize, sub } from "../geometry/core";
import { defaultNormal, CURVE_EPS } from "./geometry";
import type { CurveEdge } from "./model";
const nameValue = (value: string) => {
  const n = value.trim();
  if (!n || n.length > 80) throw new Error("结构线名称需为 1–80 个字符。");
  return n;
};
export function createCurve(
  p: LandmarkProject,
  aId: string,
  bId: string,
  v: LandmarkView,
  name: string,
): { project: LandmarkProject; selectedId: string } {
  const a = p.landmarks.find((l) => l.id === aId),
    b = p.landmarks.find((l) => l.id === bId);
  if (!a || !b || aId === bId) throw new Error("请选择两个不同的语义点。");
  if (a.type === "FREE" || b.type === "FREE")
    throw new Error("结构线仅支持中心线点与左右对称点。");
  if (
    (a.type === "LEFT" && b.type === "RIGHT") ||
    (a.type === "RIGHT" && b.type === "LEFT")
  )
    throw new Error("跨中线结构请增加 CENTERLINE 点，再分成两条曲线。");
  const chord = sub(b.position, a.position);
  if (Math.hypot(...chord) < CURVE_EPS)
    throw new Error("两个点位置重合，请先分开端点再创建曲线。");
  const center = a.type === "CENTERLINE" && b.type === "CENTERLINE",
    id = crypto.randomUUID(),
    otherId = center ? undefined : crypto.randomUUID();
  const side = a.type === "CENTERLINE" ? b.type : a.type,
    base = nameValue(name);
  const c: CurveEdge = {
    id,
    name: center ? base : (side === "LEFT" ? "左" : "右") + base,
    startLandmarkId: aId,
    endLandmarkId: bId,
    mirrorPartnerCurveId: otherId,
    role: "canonical",
    shape: {
      planeNormal: center ? [1, 0, 0] : defaultNormal(normalize(chord), v),
      startHandle: { along: 1 / 3, offset: 0 },
      endHandle: { along: 1 / 3, offset: 0 },
    },
  };
  const curves = [...p.curves, c];
  if (otherId)
    curves.push({
      id: otherId,
      name: (side === "LEFT" ? "右" : "左") + base,
      startLandmarkId: a.mirrorPartnerId ?? a.id,
      endLandmarkId: b.mirrorPartnerId ?? b.id,
      mirrorPartnerCurveId: id,
      role: "mirror",
      canonicalCurveId: id,
    });
  return { project: { ...p, curves }, selectedId: id };
}
export function renameCurve(
  p: LandmarkProject,
  id: string,
  value: string,
): LandmarkProject {
  const c = p.curves.find((c) => c.id === id);
  if (!c) return p;
  const name = nameValue(value);
  return {
    ...p,
    curves: p.curves.map((x) => {
      if (x.id !== id && x.id !== c.mirrorPartnerCurveId) return x;
      const side = [x.startLandmarkId, x.endLandmarkId]
        .map((id) => p.landmarks.find((l) => l.id === id)!)
        .find((l) => l.type !== "CENTERLINE")?.type;
      return {
        ...x,
        name: x.mirrorPartnerCurveId
          ? (side === "LEFT" ? "左" : "右") + name
          : name,
      };
    }),
  };
}
export function deleteCurve(p: LandmarkProject, id: string): LandmarkProject {
  const c = p.curves.find((c) => c.id === id);
  return {
    ...p,
    curves: p.curves.filter(
      (x) => x.id !== id && x.id !== c?.mirrorPartnerCurveId,
    ),
  };
}
export function incidentCurveIds(
  p: LandmarkProject,
  landmarkId: string,
): Set<string> {
  const l = p.landmarks.find((l) => l.id === landmarkId),
    points = new Set([landmarkId, l?.mirrorPartnerId]);
  const ids = new Set<string>();
  for (const c of p.curves)
    if (points.has(c.startLandmarkId) || points.has(c.endLandmarkId)) {
      ids.add(c.id);
      if (c.mirrorPartnerCurveId) ids.add(c.mirrorPartnerCurveId);
    }
  return ids;
}
