import {symmetryNormal} from '../head/frame';
import {pointPosition} from "../geometry/evaluation";
import type { CurveEdge } from "../curves/model";
import type { Vec3, Vec2, ViewState } from "../project/types";
import { basis, dot, add, scale, sub } from "../geometry/core";
export type LandmarkView = Omit<ViewState, "locked" | "defaultStrength">;
export interface ViewLock {
  right: Vec3;
  up: Vec3;
  coordinates: Vec2;
}
export interface LoomisOffset { offsetX?:number; offsetY?:number; offsetZ?:number }
export type PointPlacement = LoomisOffset & (
 | {kind:"CHIN_SURFACE";direction:Vec3}
 | {kind:"LOOMIS_SCAFFOLD";role:import("../head/scaffold").ScaffoldPointRole}
 | {kind:"EYE_LOCAL";side:"left"|"right";local:Vec3}
 | {kind:"ON_PATCH";hostPatchId:string;u:number;v:number}
 | {kind:"ON_SECTION_CAP";hostSurfaceId:string;u:number;v:number}
 | {kind:"ON_LOOMIS_SURFACE";hostFrameId:"head";direction:Vec3}
 | {kind:"WORLD";position:Vec3}
 | {kind:"FRAME_RELATIVE";position:Vec3}
 | {kind:"ON_CURVE";role:"canonical";hostCurveId:string;s:number;ringEndpoint?:true}
 | {kind:"ON_CURVE";role:"mirror";hostCurveId:string;canonicalPointId:string});
export interface SemanticLandmark {
  systemRole?: import("../head/scaffold").ScaffoldPointRole | import("../chin/model").ChinPointRole;
  id: string;
  name: string;
  placement: PointPlacement;
  type: "CENTERLINE" | "LEFT" | "RIGHT" | "FREE";
  mirrorPartnerId?: string;
  viewLocks: Record<string, ViewLock>;
}
export interface LandmarkProject {
  drawingWorkingCopies?: Record<string,import("../drawing/model").DrawingDocument>;
  recordingScenes?: import("../recordingScene/model").RecordingScenes;
  vectorRecording?: import("../vectorRecording/model").VectorRecording;
  /** Read-only archive of retired workspace payloads, retained on round trip. */
  legacyWorkspaces?: {recording?:unknown;hairstyle?:unknown;poseRecording?:unknown;assembly?:unknown};
  assembly?: import("../assembly/model").AssemblyDocument;
  hairstyle?: import("../hairstyle/model").Hairstyle;
  /** Authored view list; skip legacy preset insertion when loading. */
  viewsCustomized?: boolean;
  gazeEyeball?:import("../eyes/gaze").GazeEyeball;
  eyeScaffold?:import("../eyes/scaffold").EyeScaffold;
  geometryModules?:Record<string,import("../modules/ownership").GeometryModule>;
  poseRecording?: import("../recording/poses").PoseRecording;
  /** Retired authoring data; ignored on load/save. */
  recording?: import("../recording/model").Recording;
  drawing?: import("../drawing/model").DrawingDocument;
  drawingSnapshots?: import("../drawing/snapshots").DrawingSnapshots;
  curveSmoothJoins?: import("../curves/smoothJoin/model").CurveSmoothJoin[];
  loomisScaffold?: import("../head/scaffold").LoomisScaffold;
  inspectionBackground?: import("../head/inspectionBackground").InspectionBackground;
  loomisLocks?: string[];
  loomisCaps?: import("../head/caps").LoomisSectionCap[];
  loomisRegions?: import("../head/regions").LoomisRegion[];
  chinScaffold?: import("../chin/model").ChinScaffold;
  headPerspective?: import("../head/perspective").HeadPerspective;
  headFrame?: import("../head/frame").HeadFrame;
  surfaceContinuity?: import("../continuity/model").ContinuitySettings;
  surfaceSmooth?: import("../smooth/model").SurfaceSmoothSettings;
  patches?: import("../patches/model").SurfacePatch[];
  patchDisplay?: import("../patches/model").PatchDisplay;
  version:
    | "landmarks-0.9.7"
    | "landmarks-0.9.5"
    | "landmarks-0.9.3"
    | "landmarks-0.9.2"
    | "landmarks-0.6.3"
    | "landmarks-0.5.5"
    | "landmarks-0.5.4"
    | "landmarks-0.5.3"
    | "landmarks-0.5.2"
    | "landmarks-0.5"
    | "landmarks-0.5.1"
    | "landmarks-0.4.9.1"
    | "landmarks-0.4.9"
    | "landmarks-0.4.5"
    | "landmarks-0.1"
    | "landmarks-0.2"
    | "landmarks-0.3"
    | "landmarks-0.3.5"
    | "landmarks-0.3.6"
    | "landmarks-0.3.8"
    | "landmarks-0.3.9"
    | "landmarks-0.4.0"
    | "landmarks-0.4.1"
    | "landmarks-0.4.2";
  meta: { name: string; createdAt: number; updatedAt: number };
  lockedViews?: string[];
  curves: CurveEdge[];
  centerlineOrder: string[];
  landmarks: SemanticLandmark[];
  views: LandmarkView[];
}
export const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
export function captureLock(p: Vec3, v: LandmarkView): ViewLock {
  const { right, up } = basis(v);
  return { right, up, coordinates: [dot(p, right), dot(p, up)] };
}
export function allowedBasis(
  p: LandmarkProject,
  id: string,
  extraRows: Vec3[] = [],
): Vec3[] {
  const l = p.landmarks.find((l) => l.id === id)!;
  if(l.placement.kind==="CHIN_SURFACE"||l.placement.kind==="ON_CURVE"||(l.placement.kind==="ON_LOOMIS_SURFACE"||(l.placement.kind==="LOOMIS_SCAFFOLD"||(l.placement.kind==="ON_SECTION_CAP"||l.placement.kind==="ON_PATCH"))))return [];
  const rows: Vec3[] = [...extraRows];
  if (l.type === "CENTERLINE") rows.push(symmetryNormal(p));
  // A symmetric pair has one observation per explicit view. The selected side
  // interprets those camera directions as driver; the partner adds no rows.
  for (const lock of Object.values(driverLocks(p, id)))
    rows.push(lock.right, lock.up);
  const normals: Vec3[] = [];
  for (const row of rows) {
    let r: Vec3 = [...row];
    for (const n of normals) r = sub(r, scale(n, dot(r, n)));
    const len = Math.hypot(...r);
    if (len > 1e-8) normals.push(scale(r, 1 / len));
  }
  const result: Vec3[] = [];
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as Vec3[]) {
    let r: Vec3 = axis;
    for (const n of [...normals, ...result]) r = sub(r, scale(n, dot(r, n)));
    const len = Math.hypot(...r);
    if (len > 1e-8) result.push(scale(r, 1 / len));
  }
  return result;
}
// With no authored locks, the drag plane is an additional transient constraint.
// It must intersect the centerline plane, rather than push a centerline point in depth.
export function editingBasis(
  p: LandmarkProject,
  id: string,
  v: LandmarkView,
): Vec3[] {
  const l = p.landmarks.find((x) => x.id === id)!;
  if(l.placement.kind==="CHIN_SURFACE"||l.placement.kind==="ON_CURVE"||(l.placement.kind==="ON_LOOMIS_SURFACE"||(l.placement.kind==="LOOMIS_SCAFFOLD"||(l.placement.kind==="ON_SECTION_CAP"||l.placement.kind==="ON_PATCH"))))return [];
  const partner = p.landmarks.find((x) => x.id === l.mirrorPartnerId);
  const hasLocks =
    Object.keys(l.viewLocks).length > 0 ||
    (!!partner && Object.keys(partner.viewLocks).length > 0);
  return allowedBasis(p, id, hasLocks ? [] : [basis(v).forward]);
}
export function dragPosition(
  p: LandmarkProject,
  id: string,
  v: LandmarkView,
  delta: Vec2,
): Vec3 {
  const l = p.landmarks.find((l) => l.id === id)!;
  if(l.placement.kind==="CHIN_SURFACE"||l.placement.kind==="ON_CURVE"||(l.placement.kind==="ON_LOOMIS_SURFACE"||(l.placement.kind==="LOOMIS_SCAFFOLD"||(l.placement.kind==="ON_SECTION_CAP"||l.placement.kind==="ON_PATCH"))))throw Error("结构线定位点只能调整在线位置。");
  const free = editingBasis(p, id, v),
    { right, up } = basis(v);
  const projected = (a: Vec3) =>
    free.reduce<Vec3>((r, n) => add(r, scale(n, dot(a, n))), [0, 0, 0]);
  const r = projected(right),
    u = projected(up),
    a = dot(r, r),
    b = dot(r, u),
    c = dot(u, u),
    det = a * c - b * b,
    trace = a + c;
  if (trace < 1e-12) return pointPosition(p,l.id);
  let x: number, y: number;
  if (det > 1e-10) {
    x = (c * delta[0] - b * delta[1]) / det;
    y = (a * delta[1] - b * delta[0]) / det;
  } else {
    x = (a * delta[0] + b * delta[1]) / (trace * trace);
    y = (b * delta[0] + c * delta[1]) / (trace * trace);
  }
  return add(pointPosition(p,l.id), add(scale(r, x), scale(u, y)));
}

/** Inspect the same feasible space used by dragging, including invisible depth motion. */
export function motionState(p: LandmarkProject, id: string, v: LandmarkView) {
  if(p.landmarks.find(l=>l.id===id)?.placement.kind==="ON_SECTION_CAP")return {spatialDof:2,screenDof:0,track:null};
  if(p.landmarks.find(l=>l.id===id)?.placement.kind==="ON_LOOMIS_SURFACE")return {spatialDof:p.landmarks.find(l=>l.id===id)?.type==="CENTERLINE"?1:2,screenDof:0,track:null};
  if(p.landmarks.find(l=>l.id===id)?.placement.kind==="ON_CURVE")return {spatialDof:1,screenDof:0,track:null};
  const spatial = allowedBasis(p, id);
  const editable = editingBasis(p, id, v);
  const { right, up } = basis(v);
  const screenAxes: Vec2[] = [];
  for (const n of editable) {
    let q: Vec2 = [dot(n, right), dot(n, up)];
    for (const a of screenAxes) {
      const t = q[0] * a[0] + q[1] * a[1];
      q = [q[0] - t * a[0], q[1] - t * a[1]];
    }
    const length = Math.hypot(...q);
    if (length > 1e-8) screenAxes.push([q[0] / length, q[1] / length]);
  }
  return {
    spatialDof: spatial.length,
    screenDof: screenAxes.length,
    track: screenAxes.length === 1 ? screenAxes[0] : null,
  };
}

// Read-only render guide: connects existing centerline landmarks, never creates geometry state.
export function centerlineGuide(p: LandmarkProject): Vec3[] {
  return p.centerlineOrder.map((id) => pointPosition(p,id));
}

export const viewIsLocked = (p: LandmarkProject, viewId: string) =>
  p.lockedViews
    ? p.lockedViews.includes(viewId)
    : p.landmarks.some((l) => Boolean(l.viewLocks[viewId]));

/** Locks belong to the pair's driver. Reading from the other side previews a role swap. */
export function driverLocks(
  p: LandmarkProject,
  id: string,
): Record<string, ViewLock> {
  const l = p.landmarks.find((l) => l.id === id)!;
  const partner = p.landmarks.find((x) => x.id === l.mirrorPartnerId);
  return (l.placement.kind!=="ON_CURVE"&&l.placement.kind!=="ON_LOOMIS_SURFACE"&&l.placement.kind!=="ON_SECTION_CAP")?{ ...partner?.viewLocks, ...l.viewLocks }:{};
}

/** Exchange driver/follower at the current positions, retaining explicit camera frames.
 * Old anchors belonged to the previous driver; they are not observations of the new one.
 */
export function activateDriver(
  p: LandmarkProject,
  id: string,
): LandmarkProject {
  const l = p.landmarks.find((l) => l.id === id);
  const partner = p.landmarks.find((x) => x.id === l?.mirrorPartnerId);
  if (!l || (l.placement.kind==="ON_CURVE"||(l.placement.kind==="ON_LOOMIS_SURFACE"||(l.placement.kind==="LOOMIS_SCAFFOLD"||(l.placement.kind==="ON_SECTION_CAP"||l.placement.kind==="ON_PATCH")))) || !partner || !Object.keys(partner.viewLocks).length) return p;
  const viewLocks = Object.fromEntries(
    Object.entries(driverLocks(p, id)).map(([viewId, k]) => [
      viewId,
      {
        right: [...k.right] as Vec3,
        up: [...k.up] as Vec3,
        coordinates: [dot(pointPosition(p,l.id), k.right), dot(pointPosition(p,l.id), k.up)] as Vec2,
      },
    ]),
  );
  return {
    ...p,
    landmarks: p.landmarks.map((x) =>
      x.id === id
        ? { ...x, viewLocks }
        : x.id === partner.id
          ? { ...x, viewLocks: {} }
          : x,
    ),
  };
}

/** Global view toggle, with only one projection observation per symmetric pair. */
export function setGlobalViewLock(
  p: LandmarkProject,
  viewId: string,
  locked: boolean,
  selectedId?: string,
): LandmarkProject {
  const v = p.views.find((v) => v.id === viewId);
  if (!v) return p;
  let result = selectedId ? activateDriver(p, selectedId) : p;
  const drivers = new Set<string>();
  for (const l of result.landmarks) {
    if(l.placement.kind==="EYE_LOCAL"||l.placement.kind==="ON_CURVE"||(l.placement.kind==="ON_LOOMIS_SURFACE"||(l.placement.kind==="LOOMIS_SCAFFOLD"||(l.placement.kind==="ON_SECTION_CAP"||l.placement.kind==="ON_PATCH"))))continue;
    const partner = result.landmarks.find((x) => x.id === l.mirrorPartnerId);
    if (!partner) {
      drivers.add(l.id);
      continue;
    }
    const driver =
      selectedId === l.id || selectedId === partner.id
        ? selectedId
        : Object.keys(l.viewLocks).length
          ? l.id
          : Object.keys(partner.viewLocks).length
            ? partner.id
            : l.type === "RIGHT"
              ? l.id
              : partner.id;
    drivers.add(driver!);
  }
  return {
    ...result,
    lockedViews: result.views
      .filter((v) => (v.id === viewId ? locked : viewIsLocked(result, v.id)))
      .map((v) => v.id),
    landmarks: result.landmarks.map((l) => {
      const viewLocks = { ...l.viewLocks };
      if (locked && drivers.has(l.id))
        viewLocks[viewId] = captureLock(pointPosition(result,l.id), v);
      else delete viewLocks[viewId];
      return { ...l, viewLocks };
    }),
  };
}

/** Compare model/camera/lock state across browser-local saves, independently of layout and canvas zoom. */
export function modelStateCode(p: LandmarkProject): string {
  const data = JSON.stringify({
    headFrame: p.headFrame,
    loomisRegions:p.loomisRegions,loomisCaps:p.loomisCaps,
    curves: p.curves,
    ...(p.curveSmoothJoins?.length?{curveSmoothJoins:p.curveSmoothJoins}:{}),
    ...(p.patches?.length ? {patches:p.patches} : {}),
    centerlineOrder: p.centerlineOrder,
    lockedViews: p.lockedViews,
    landmarks: p.landmarks,
    views: p.views.map((v) => ({ id: v.id, camera: v.camera })),
  });
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++)
    hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
