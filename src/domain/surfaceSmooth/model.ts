import type { Vec3 } from "../project/types";
import type { ControlPoints } from "../curves/geometry";
export interface CurveHalfEdgeRef {
  curveId: string;
  endpoint: "start" | "end";
}
export interface SurfaceSmoothDefaults {
  enabled: boolean;
  extent: number;
}
export interface SurfaceSmoothNodeOverride {
  enabled?: boolean;
  extent?: number;
  excludedHalfEdges?: CurveHalfEdgeRef[];
}
export interface NodeConfig extends SurfaceSmoothDefaults {
  excludedHalfEdges: CurveHalfEdgeRef[];
}
export interface HalfResult {
  half: CurveHalfEdgeRef;
  tangent: Vec3;
  target: Vec3;
  trimPoint: Vec3;
  trimT: number;
  angle: number;
  fairing?: ControlPoints;
}
export interface ResolvedNode {
  landmarkId: string;
  state: "VALID" | "INVALID" | "NO_OP" | "OFF";
  stress: "NORMAL" | "HIGH_STRESS";
  reason?: string;
  normal?: Vec3;
  halves: HalfResult[];
  participants: CurveHalfEdgeRef[];
}
export interface ResolvedSpan {
  kind: "outer" | "blend";
  curveId: string;
  controls: ControlPoints;
  sourceRange: [number, number];
  landmarkId?: string;
  junctionId?: string;
}
export interface ResolvedNetwork {
  nodes: ResolvedNode[];
  spans: ResolvedSpan[];
}
