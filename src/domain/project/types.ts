export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];
export type Strength = "weak" | "strong" | "locked" | "guide";
export interface SurfaceState {
  vertices: Vec3[];
  faces: Triangle[];
  normals: Vec3[];
  baseVertices: Vec3[];
  previousVertices: Vec3[];
  symmetryPairs: [number, number][];
  anchorVertexIds: number[];
}
export interface SemanticRing {
  id: string;
  label: string;
  kind: string;
  samples: { vertexId: number; u: number }[];
  closed: boolean;
  editable: boolean;
  color: string;
}
export interface ViewState {
  id: string;
  label: string;
  shortLabel: string;
  camera: {
    projection: "orthographic";
    position: Vec3;
    target: Vec3;
    up: Vec3;
    zoom: number;
  };
  locked: boolean;
  defaultStrength: Strength;
  canvas: { zoom: number; pan: Vec2 };
  reference?: ReferenceImage;
}
export interface ReferenceImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  offset: Vec2;
  scale: number;
  rotation: number;
}
export interface Curve2D {
  controlModel?: "semantic-linear-v1" | "silhouette-spline-v1";
  handles?: number[];
  kind: "polyline";
  closed: boolean;
  points: Vec2[];
  parameters: number[];
}
export interface ViewConstraint {
  id: string;
  viewId: string;
  entityId: string;
  entityKind: "silhouette" | "semantic_ring" | "midline";
  curve: Curve2D;
  strength: Strength;
  userAuthored: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface ConstraintDiagnostic {
  id: string;
  viewId: string;
  rmsErrorPx: number;
  maxErrorPx: number;
  count: number;
  conflictScore: number;
}
export interface SolverDiagnostics {
  totalEnergy: number;
  viewEnergy: number;
  fairEnergy: number;
  anchorEnergy: number;
  symmetryEnergy: number;
  temporalEnergy: number;
  iterations: number;
  solveTimeMs: number;
  constraints: ConstraintDiagnostic[];
  warnings: string[];
  centroidDrift: number;
  maxDisplacement: number;
  meanNormalAngle: number;
  p95NormalAngle: number;
}
export interface SolverSettings {
  fairness: number;
  temporal: number;
  symmetry: boolean;
  previewIterations: number;
  refineIterations: number;
}
export interface HeadProject {
  version: "0.0.1";
  meta: { name: string; createdAt: number; updatedAt: number };
  surface: SurfaceState;
  semanticModel: { rings: SemanticRing[] };
  views: ViewState[];
  constraints: ViewConstraint[];
  solver: SolverSettings;
}
export const PIXELS_PER_UNIT = 160;
