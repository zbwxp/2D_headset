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
export type ContourRole = "NONE" | "OPEN_EDGE";
/** Endpoint-relative, dimensionless HeadFrame-local vectors; no curve plane. */
export interface Free3DShape {
  kind: "FREE_3D";
  startHandleOffset: Vec3;
  endHandleOffset: Vec3;
}
export type CurveShape = PlanarShape | Free3DShape;
export function isFree3DShape(shape: CurveShape): shape is Free3DShape {
  return 'kind' in shape && shape.kind === 'FREE_3D';
}
interface CurveIdentity {
  contourRole?: ContourRole;
  id: string;
  name: string;
  startLandmarkId: string;
  endLandmarkId: string;
  mirrorPartnerCurveId?: string;
}
export type BezierCurve = CurveIdentity &
  (
    | { role: "canonical"; shape: CurveShape }
    | { role: "mirror"; canonicalCurveId: string }
  );
export type CanonicalCurve = Extract<BezierCurve, { role: "canonical" }>;

/** Normalized Loomis plane; reference is the persisted theta=0 direction. */
export interface LoomisSectionGeometry {
 hostFrameId: 'head'; planeNormal: Vec3; planeOffset: number; reference: Vec3;
}
export type SectionCurve = {
 id:string; name:string; contourRole?:ContourRole; geometryType:'LOOMIS_SECTION';
 systemRole?:string;logicalEndpoints?:[string,string];logicalRing?:'COMPOSITE'|'SYMMETRIC';
 startLandmarkId?:never; endLandmarkId?:never; shape?:never;
 side:'LEFT'|'RIGHT'|'CENTERLINE'; mirrorPartnerCurveId?:string;
} & ({role:'canonical';section:LoomisSectionGeometry}|{role:'mirror';canonicalCurveId:string;section?:never});
export type HelmetRimCurve = CurveIdentity & {geometryType:'HELMET_RIM';systemRole:'RIM_R'|'RIM_L';shape?:never} & ({role:'canonical'}|{role:'mirror';canonicalCurveId:string});
/** A closed use of the horizontal ring's front/back arcs and both side rims. */
export interface HelmetLoopCurve {
 id:string;name:string;contourRole?:ContourRole;geometryType:'HELMET_LOOP';systemRole:'HELMET_LOOP';
 role:'canonical';side:'CENTERLINE';logicalRing:'SYMMETRIC';logicalEndpoints:[string,string];
 sourceCurveIds:[string,string,string];
 startLandmarkId?:never;endLandmarkId?:never;shape?:never;mirrorPartnerCurveId?:never;
}
/** Boundary occurrence >= 0, or -1 for a hosted ON_PATCH landmark. */
export interface SurfacePath { startBoundary:number; endBoundary:number; winding:number; referenceU?:[number,number]; handleOffsets?:[[number,number],[number,number]] }
export type OnPatchCurve = CurveIdentity & {geometryType:'ON_PATCH';systemRole?:never;hostPatchId:string;shape?:never} & ({role:'canonical';path:SurfacePath}|{role:'mirror';canonicalCurveId:string;path?:never});
export type ControlPointCurve = CurveIdentity & {systemRole?:never; geometryType:"CONTROL_POINTS";role:"canonical";controlPointIds:[string,string];shape?:never};
export type ChinCurve = CurveIdentity & {geometryType:"CHIN_SEAM";systemRole:string;slot:import("../chin/model").ChinSlot;shape?:never} & ({role:"canonical"}|{role:"mirror";canonicalCurveId:string});
export function isChin(c:CurveEdge):c is ChinCurve{return "geometryType" in c&&c.geometryType==="CHIN_SEAM";}
export type CurveEdge = ChinCurve | ControlPointCurve | BezierCurve | SectionCurve | HelmetRimCurve | HelmetLoopCurve | OnPatchCurve;
export function isHelmetLoop(c:CurveEdge):c is HelmetLoopCurve {return 'geometryType' in c&&c.geometryType==='HELMET_LOOP';}
export function isClosedSource(c:CurveEdge):c is SectionCurve|HelmetLoopCurve {return isSection(c)||isHelmetLoop(c);}
export function isLogicalRing(c:CurveEdge):c is (SectionCurve|HelmetLoopCurve)&{logicalRing:NonNullable<SectionCurve['logicalRing']>} {return isClosedSource(c)&&!!c.logicalRing;}
export function isOnPatch(c:CurveEdge):c is OnPatchCurve {return 'geometryType' in c&&c.geometryType==='ON_PATCH';}
export function isRim(c:CurveEdge):c is HelmetRimCurve {return 'geometryType' in c&&c.geometryType==='HELMET_RIM';}
export function isDerived(c:CurveEdge):c is ChinCurve|SectionCurve|HelmetRimCurve|HelmetLoopCurve|OnPatchCurve|ControlPointCurve {return isChin(c)|| ("geometryType" in c&&c.geometryType==="CONTROL_POINTS")|| isClosedSource(c)||isRim(c)||isOnPatch(c);}
export function isSection(c:CurveEdge):c is SectionCurve {return 'geometryType' in c && c.geometryType==='LOOMIS_SECTION';}

export function isAnalytic(c:CurveEdge):c is SectionCurve|HelmetRimCurve|HelmetLoopCurve {return isClosedSource(c)||isRim(c);}
