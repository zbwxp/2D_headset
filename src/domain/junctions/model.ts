import type { ControlPoints } from "../curves/geometry";
export interface CurveHalfEdgeRef {
  curveId: string;
  endpoint: "start" | "end";
}
export interface SmoothJunction {
  id: string;
  landmarkId: string;
  sideA: CurveHalfEdgeRef;
  sideB: CurveHalfEdgeRef;
  extent: number;
  mode: "G1";
  symmetry: "paired" | "self";
}
export interface ResolvedSpan {
  kind: "outer" | "blend";
  curveId: string;
  controls: ControlPoints;
  sourceRange?: [number, number];
  junctionId?: string;
  landmarkId?: string;
}
export interface ResolvedJunction {
  sourceId: string;
  landmarkId: string;
  sideA: CurveHalfEdgeRef;
  sideB: CurveHalfEdgeRef;
  mirrored: boolean;
  state: "VALID" | "INVALID";
  reason?: string;
  blendA?: ControlPoints;
  blendB?: ControlPoints;
  tA?: number;
  tB?: number;
  distance?: number;
}
export interface ResolvedNetwork {
  spans: ResolvedSpan[];
  junctions: ResolvedJunction[];
}
