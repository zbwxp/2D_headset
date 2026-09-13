import type { BezierPoints, Quality } from "./spatial";
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
  mode: "G1" | "spatial-G2";
  symmetry: "paired" | "self";
}
export interface ResolvedSpan {
  kind: "outer" | "blend";
  curveId: string;
  controls: BezierPoints;
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
  transition?: BezierPoints;
  quality?: Quality;
  warning?: string;
  tA?: number;
  tB?: number;
  distance?: number;
}
export interface ResolvedNetwork {
  spans: ResolvedSpan[];
  junctions: ResolvedJunction[];
}
