import { parseCurves } from "../curves/persistence";
import { repairCenterlineOrder } from "./order";
import { ensureObliqueViews } from "./views";
import type { LandmarkProject } from "./model";
import { mirror, activateDriver } from "./model";
import { dot, cross, sub } from "../geometry/core";
import type { Vec3 } from "../project/types";
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const vec = (a: unknown, n: number): a is number[] =>
  Array.isArray(a) && a.length === n && a.every(finite);
export function parseLandmarks(text: string): LandmarkProject {
  const p = JSON.parse(text) as LandmarkProject;
  const check = (ok: unknown) => {
    if (!ok)
      throw new Error("文件不是有效的语义点项目；旧曲面项目请保留备份。");
  };
  check(
    ["landmarks-0.1", "landmarks-0.2", "landmarks-0.3"].includes(p?.version) &&
      p.meta &&
      typeof p.meta.name === "string" &&
      finite(p.meta.createdAt) &&
      finite(p.meta.updatedAt),
  );
  check(
    Array.isArray(p.views) &&
      p.views.length > 0 &&
      p.views.length <= 30 &&
      Array.isArray(p.landmarks),
  );
  const viewIds = new Set<string>();
  for (const v of p.views) {
    check(typeof v.id === "string" && !viewIds.has(v.id));
    viewIds.add(v.id);
    check(
      typeof v.label === "string" &&
        v.camera?.projection === "orthographic" &&
        vec(v.camera.position, 3) &&
        vec(v.camera.target, 3) &&
        vec(v.camera.up, 3) &&
        v.canvas &&
        vec(v.canvas.pan, 2) &&
        finite(v.canvas.zoom) &&
        v.canvas.zoom > 0,
    );
    check(
      Math.hypot(
        ...cross(sub(v.camera.position, v.camera.target), v.camera.up),
      ) > 1e-8,
    );
    if (v.reference) {
      const r = v.reference;
      check(
        typeof r.name === "string" &&
          typeof r.dataUrl === "string" &&
          /^data:image\/(png|jpeg|webp);base64,/.test(r.dataUrl) &&
          r.dataUrl.length < 1000000 &&
          finite(r.width) &&
          r.width > 0 &&
          finite(r.height) &&
          r.height > 0 &&
          finite(r.opacity) &&
          r.opacity >= 0 &&
          r.opacity <= 1 &&
          finite(r.scale) &&
          r.scale > 0 &&
          finite(r.rotation) &&
          vec(r.offset, 2) &&
          typeof r.locked === "boolean" &&
          typeof r.visible === "boolean",
      );
    }
  }
  if (p.lockedViews !== undefined)
    check(
      Array.isArray(p.lockedViews) &&
        new Set(p.lockedViews).size === p.lockedViews.length &&
        p.lockedViews.every((id) => viewIds.has(id)),
    );
  const ids = new Set<string>();
  for (const l of p.landmarks) {
    check(
      typeof l.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          l.id,
        ) &&
        !ids.has(l.id),
    );
    ids.add(l.id);
    check(
      typeof l.name === "string" &&
        vec(l.position, 3) &&
        ["CENTERLINE", "LEFT", "RIGHT", "FREE"].includes(l.type) &&
        l.viewLocks &&
        typeof l.viewLocks === "object" &&
        !Array.isArray(l.viewLocks),
    );
    check(l.type !== "CENTERLINE" || Math.abs(l.position[0]) < 1e-9);
    for (const [id, k] of Object.entries(l.viewLocks)) {
      check(
        viewIds.has(id) &&
          k &&
          vec(k.right, 3) &&
          vec(k.up, 3) &&
          vec(k.coordinates, 2),
      );
      check(
        Math.abs(dot(k.right, k.up)) < 1e-8 &&
          Math.abs(dot(k.right, k.right) - 1) < 1e-8 &&
          Math.abs(dot(k.up, k.up) - 1) < 1e-8,
      );
      check(
        Math.abs(dot(l.position, k.right) - k.coordinates[0]) < 1e-8 &&
          Math.abs(dot(l.position, k.up) - k.coordinates[1]) < 1e-8,
      );
    }
  }
  for (const l of p.landmarks) {
    if (l.type === "LEFT" || l.type === "RIGHT") check(l.mirrorPartnerId);
    if (l.mirrorPartnerId) {
      const r = p.landmarks.find((x) => x.id === l.mirrorPartnerId);
      check(
        r &&
          r.id !== l.id &&
          r.mirrorPartnerId === l.id &&
          ((l.type === "LEFT" && r.type === "RIGHT") ||
            (l.type === "RIGHT" && r.type === "LEFT")),
      );
      check(Math.hypot(...sub(mirror(l.position), r!.position as Vec3)) < 1e-8);
    }
  }
  // Whitelist source data; never import legacy geometry or derived render objects.
  let result: LandmarkProject = {
    version: "landmarks-0.3",
    curves: [],
    centerlineOrder: repairCenterlineOrder(p.landmarks, p.centerlineOrder),
    lockedViews:
      p.lockedViews ??
      p.views
        .filter((v) => p.landmarks.some((l) => l.viewLocks[v.id]))
        .map((v) => v.id),
    meta: p.meta,
    views: ensureObliqueViews(
      p.views.map((v) => ({
        id: v.id,
        label: v.label,
        shortLabel: v.shortLabel,
        camera: v.camera,
        canvas: v.canvas,
        reference: v.reference,
      })),
    ),
    landmarks: p.landmarks.map((l) => ({
      id: l.id,
      name: l.name,
      position: l.position,
      type: l.type,
      mirrorPartnerId: l.mirrorPartnerId,
      viewLocks: l.viewLocks,
    })),
  };
  // Old files may contain both observations. Migrate each pair to one driver;
  // never retain the reflected partner as a second independent constraint.
  for (const l of result.landmarks)
    if (l.type === "RIGHT") {
      const partner = result.landmarks.find((x) => x.id === l.mirrorPartnerId);
      if (
        Object.keys(l.viewLocks).length &&
        partner &&
        Object.keys(partner.viewLocks).length
      )
        result = activateDriver(result, l.id);
    }
  result.curves = parseCurves(p.curves, result);
  return result;
}
