import {isSection} from './model';
import {validateSection} from './section';
import {symmetryNormal} from '../head/frame';
import type {Vec3} from "../project/types";
import {pointPosition} from "../geometry/evaluation";
import type { LandmarkProject } from "../landmarks/model";
import type { CurveEdge } from "./model";
import { dot, sub } from "../geometry/core";
import { CURVE_EPS } from "./geometry";
export function parseCurves(input: unknown, p: LandmarkProject, geometryCheck=true): CurveEdge[] {
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
    if(c.geometryType==='LOOMIS_SECTION'){
      if(!p.headFrame||!['LEFT','RIGHT','CENTERLINE'].includes(c.side)||c.startLandmarkId!==undefined||c.endLandmarkId!==undefined||c.shape!==undefined)return fail();
      const common={id:c.id,name:c.name,geometryType:'LOOMIS_SECTION' as const,side:c.side,mirrorPartnerCurveId:c.mirrorPartnerCurveId,systemRole:c.systemRole,logicalRing:c.logicalRing,logicalEndpoints:c.logicalEndpoints};
      if(c.role==='mirror'){if(typeof c.canonicalCurveId!=='string'||c.section!==undefined)return fail();return {...common,role:'mirror',canonicalCurveId:c.canonicalCurveId};}
      if(c.role!=='canonical')return fail();validateSection(c.section);
      if(c.logicalRing&&(!Array.isArray(c.logicalEndpoints)||c.logicalEndpoints.length!==2||c.logicalEndpoints[0]===c.logicalEndpoints[1]||c.logicalEndpoints.some((id:string)=>!p.landmarks.some(l=>l.id===id&&l.type==='CENTERLINE'))))return fail();
      if(c.logicalRing&&!['COMPOSITE','SYMMETRIC'].includes(c.logicalRing))return fail();
      if(c.logicalRing&&(c.role!=='canonical'||c.mirrorPartnerCurveId||Math.abs(c.section.planeNormal[0])>1e-10||Math.abs(c.section.reference[0])>1e-10))return fail();
      if(c.logicalRing==='COMPOSITE'&&(Math.abs(c.section.planeNormal[1]-1)>1e-10||Math.abs(c.section.reference[2]-1)>1e-10))return fail();
      if(!c.logicalRing&&c.side==='CENTERLINE'&&(c.mirrorPartnerCurveId||c.section.planeOffset!==0||Math.abs(c.section.planeNormal[0])!==1))return fail();
      if(c.side!=='CENTERLINE'&&typeof c.mirrorPartnerCurveId!=='string')return fail();
      return {...common,role:'canonical',section:{hostFrameId:'head',planeNormal:[...c.section.planeNormal],planeOffset:c.section.planeOffset,reference:[...c.section.reference]}} as CurveEdge;
    }
    if(c.geometryType==='HELMET_RIM'){
      if(!p.headFrame||!['RIM_R','RIM_L'].includes(c.systemRole)||!p.landmarks.some(l=>l.id===c.startLandmarkId)||!p.landmarks.some(l=>l.id===c.endLandmarkId)||c.startLandmarkId===c.endLandmarkId||!c.mirrorPartnerCurveId)return fail();
      if(c.role!=='canonical'&&c.role!=='mirror')return fail();
      return {id:c.id,name:c.name,geometryType:'HELMET_RIM',systemRole:c.systemRole,startLandmarkId:c.startLandmarkId,endLandmarkId:c.endLandmarkId,mirrorPartnerCurveId:c.mirrorPartnerCurveId,role:c.role,...(c.role==='mirror'?{canonicalCurveId:c.canonicalCurveId}:{})} as CurveEdge;
    }
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
      chord = geometryCheck?sub(pointPosition(p,b.id), pointPosition(p,a.id)):[0,0,0] as Vec3,
      L = Math.hypot(...chord);
    if (
      Math.abs(Math.hypot(...normal) - 1) > 1e-7 ||
      (L > CURVE_EPS && Math.abs(dot(normal, chord) / L) > 1e-7) ||
      (center && Math.hypot(...sub(normal,symmetryNormal(p))) > 1e-7)
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
    if(isSection(c)||isSection(other)){if(!isSection(c)||!isSection(other)||c.side===other.side||c.side==='CENTERLINE'||other.side==='CENTERLINE')return fail();continue;}
    for (const key of ["startLandmarkId", "endLandmarkId"] as const) {
      const l = p.landmarks.find((l) => l.id === c[key])!;
      if (other[key] !== (l.mirrorPartnerId ?? l.id)) return fail();
    }
  }
  return curves;
}
