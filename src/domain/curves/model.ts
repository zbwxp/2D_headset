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
export type CurveEdge = CurveIdentity &
  (
    | { role: "canonical"; shape: PlanarShape }
    | { role: "mirror"; canonicalCurveId: string }
  );
export type CanonicalCurve = Extract<CurveEdge, { role: "canonical" }>;
