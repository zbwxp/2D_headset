import {handleToLocal} from './free3d';
import type {GeometryModule} from '../modules/ownership';
import {isClosedSource} from './model';
import {migrateHeadFrame,symmetryNormal} from '../head/frame';
import {dependencyGraph,deleteClosure} from "../geometry/dependencies";
import {pointPosition} from "../geometry/evaluation";
import type { LandmarkProject, LandmarkView } from "../landmarks/model";
import { normalize, sub, scale } from "../geometry/core";
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
  module: GeometryModule = 'HEADSET',
): { project: LandmarkProject; selectedId: string } {
  if(module==='HEADSET'&&!p.headFrame)p=migrateHeadFrame(p);
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
  const chord = sub(pointPosition(p,b.id), pointPosition(p,a.id));
  if (Math.hypot(...chord) < CURVE_EPS)
    throw new Error("两个点位置重合，请先分开端点再创建曲线。");
  const center = a.type === "CENTERLINE" && b.type === "CENTERLINE",
    id = crypto.randomUUID(),
    otherId = center ? undefined : crypto.randomUUID();
  const side = a.type === "CENTERLINE" ? b.type : a.type,
    base = nameValue(name);
  const startHandleOffset=handleToLocal(p,scale(chord,1/3)),endHandleOffset=handleToLocal(p,scale(chord,-1/3));
  if(center){startHandleOffset[0]=0;endHandleOffset[0]=0;}
  const c: CurveEdge = {
    id,
    name: center ? base : (side === "LEFT" ? "左" : "右") + base,
    startLandmarkId: aId,
    endLandmarkId: bId,
    mirrorPartnerCurveId: otherId,
    role: "canonical",
    shape: module==='HEADSET' ? {kind:'FREE_3D',startHandleOffset,endHandleOffset} : {
      planeNormal: center ? symmetryNormal(p) : defaultNormal(normalize(chord), v),
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
  const next:LandmarkProject={...p,curves,version:module==='HEADSET'?'landmarks-0.9.2':p.version};dependencyGraph(next);
  return { project: next, selectedId: id };
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
      const side = isClosedSource(x)?x.side:[x.startLandmarkId, x.endLandmarkId]
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
  return deleteClosure(p,[`curve:${id}`]);
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
