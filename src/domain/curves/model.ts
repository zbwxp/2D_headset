import type { Vec3 } from "../project/types";
export interface CurveHandle {
  along: number;
  offset: number;
}
export interface PlanarShape {
  planeNormal: Vec3;
  startHandle: CurveHandle;
  endHandle: CurveHandle;
}
interface CurveIdentity {
  id: string;
  name: string;
  startLandmarkId: string;
  endLandmarkId: string;
  mirrorPartnerCurveId?: string;
}
export type BezierCurve = CurveIdentity &
  (
    | { role: "canonical"; shape: PlanarShape }
    | { role: "mirror"; canonicalCurveId: string }
  );
export type CanonicalCurve = Extract<BezierCurve, { role: "canonical" }>;

/** Normalized Loomis plane; reference is the persisted theta=0 direction. */
export interface LoomisSectionGeometry {
 hostFrameId: 'head'; planeNormal: Vec3; planeOffset: number; reference: Vec3;
}
export type SectionCurve = {
 id:string; name:string; geometryType:'LOOMIS_SECTION';
 systemRole?:string;logicalEndpoints?:[string,string];logicalRing?:'COMPOSITE'|'SYMMETRIC';
 startLandmarkId?:never; endLandmarkId?:never; shape?:never;
 side:'LEFT'|'RIGHT'|'CENTERLINE'; mirrorPartnerCurveId?:string;
} & ({role:'canonical';section:LoomisSectionGeometry}|{role:'mirror';canonicalCurveId:string;section?:never});
export type HelmetRimCurve = CurveIdentity & {geometryType:'HELMET_RIM';systemRole:'RIM_R'|'RIM_L';shape?:never} & ({role:'canonical'}|{role:'mirror';canonicalCurveId:string});
export type CurveEdge = BezierCurve | SectionCurve | HelmetRimCurve;
export function isRim(c:CurveEdge):c is HelmetRimCurve {return 'geometryType' in c&&c.geometryType==='HELMET_RIM';}
export function isAnalytic(c:CurveEdge):c is SectionCurve|HelmetRimCurve {return isSection(c)||isRim(c);}
export function isSection(c:CurveEdge):c is SectionCurve {return 'geometryType' in c && c.geometryType==='LOOMIS_SECTION';}
