import type { CurveEdge } from "../curves/model";
import type { Vec3, Vec2, ViewState } from "../project/types";
import { basis, dot, add, scale, sub } from "../geometry/core";
export type LandmarkView = Omit<ViewState, "locked" | "defaultStrength">;
export interface ViewLock {
  right: Vec3;
  up: Vec3;
  coordinates: Vec2;
}
export interface SemanticLandmark {
  id: string;
  name: string;
  position: Vec3;
  type: "CENTERLINE" | "LEFT" | "RIGHT" | "FREE";
  mirrorPartnerId?: string;
  viewLocks: Record<string, ViewLock>;
}
export interface LandmarkProject {
  surfaceSmooth?: import("../smooth/model").SurfaceSmoothSettings;
  patches?: import("../patches/model").SurfacePatch[];
  patchDisplay?: import("../patches/model").PatchDisplay;
  version:
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
  const rows: Vec3[] = [...extraRows];
  if (l.type === "CENTERLINE") rows.push([1, 0, 0]);
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
  if (trace < 1e-12) return l.position;
  let x: number, y: number;
  if (det > 1e-10) {
    x = (c * delta[0] - b * delta[1]) / det;
    y = (a * delta[1] - b * delta[0]) / det;
  } else {
    x = (a * delta[0] + b * delta[1]) / (trace * trace);
    y = (b * delta[0] + c * delta[1]) / (trace * trace);
  }
  return add(l.position, add(scale(r, x), scale(u, y)));
}

/** Inspect the same feasible space used by dragging, including invisible depth motion. */
export function motionState(p: LandmarkProject, id: string, v: LandmarkView) {
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
  const points = new Map(p.landmarks.map((l) => [l.id, l]));
  return p.centerlineOrder.map((id) => points.get(id)!.position);
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
  return { ...partner?.viewLocks, ...l.viewLocks };
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
  if (!l || !partner || !Object.keys(partner.viewLocks).length) return p;
  const viewLocks = Object.fromEntries(
    Object.entries(driverLocks(p, id)).map(([viewId, k]) => [
      viewId,
      {
        right: [...k.right] as Vec3,
        up: [...k.up] as Vec3,
        coordinates: [dot(l.position, k.right), dot(l.position, k.up)] as Vec2,
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
        viewLocks[viewId] = captureLock(l.position, v);
      else delete viewLocks[viewId];
      return { ...l, viewLocks };
    }),
  };
}

/** Compare model/camera/lock state across browser-local saves, independently of layout and canvas zoom. */
export function modelStateCode(p: LandmarkProject): string {
  const data = JSON.stringify({
    curves: p.curves,
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
