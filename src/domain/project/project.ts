import type {
  HeadProject,
  ViewConstraint,
  ViewState,
  Vec2,
  Vec3,
  Strength,
} from "./types";
import { ellipsoid, project, silhouette } from "../geometry/core";
import { defaultRings } from "../semantics/rings";
import { curveFromPoints } from "../curves/polyline";
import { sparseHandles } from "../curves/handles";
const projectionCache = new WeakMap<Vec3[], Map<string, Vec2[]>>();
export function entityProjection(
  p: HeadProject,
  viewId: string,
  entityId: string,
): Vec2[] {
  let cache = projectionCache.get(p.surface.vertices);
  if (!cache) {
    cache = new Map();
    projectionCache.set(p.surface.vertices, cache);
  }
  const v = p.views.find((v) => v.id === viewId)!,
    key = `${viewId}:${entityId}:${v.camera.position.join(",")}:${v.camera.target.join(",")}:${v.camera.up.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ids =
    entityId === "silhouette"
      ? silhouette(p.surface.vertices, p.surface.faces, v)
      : p.semanticModel.rings
          .find((r) => r.id === entityId)!
          .samples.map((s) => s.vertexId);
  const result = ids.map((i) => project(p.surface.vertices[i], v));
  cache.set(key, result);
  return result;
}
export function createConstraint(
  p: HeadProject,
  viewId: string,
  entityId: string,
  strength: Strength = "weak",
): ViewConstraint {
  const pts = entityProjection(p, viewId, entityId);
  const constraint: ViewConstraint = {
    id: `${viewId}:${entityId}`,
    viewId,
    entityId,
    entityKind:
      entityId === "silhouette"
        ? "silhouette"
        : entityId === "midline_curve"
          ? "midline"
          : "semantic_ring",
    curve: curveFromPoints(pts, entityId !== "midline_curve"),
    strength: entityId === "midline_curve" ? "guide" : strength,
    userAuthored: false,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  constraint.curve.handles = sparseHandles(p, constraint);
  return constraint;
}
export function createProject(): HeadProject {
  const defs: [string, string, string, [number, number, number]][] = [
    ["front", "正面", "Front", [0, 0, 4]],
    ["left45", "左 45°", "L 45°", [-3, 0, 3]],
    ["right45", "右 45°", "R 45°", [3, 0, 3]],
    ["side", "侧面", "Side", [4, 0, 0]],
    ["high45", "俯 45°", "High", [0, 3, 3]],
    ["low45", "仰 45°", "Low", [0, -3, 3]],
  ];
  const views: ViewState[] = defs.map(([id, label, shortLabel, position]) => ({
    id,
    label,
    shortLabel,
    camera: {
      projection: "orthographic",
      position,
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
    },
    locked: false,
    defaultStrength: "weak",
    canvas: { zoom: 1, pan: [0, 0] },
  }));
  const p: HeadProject = {
    version: "0.0.1",
    meta: {
      name: "Untitled head",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    surface: ellipsoid(),
    semanticModel: { rings: defaultRings() },
    views,
    constraints: [],
    solver: {
      fairness: 3,
      temporal: 0.025,
      symmetry: true,
      previewIterations: 30,
      refineIterations: 160,
    },
  };
  for (const v of views)
    for (const id of ["silhouette", ...p.semanticModel.rings.map((r) => r.id)])
      p.constraints.push(createConstraint(p, v.id, id));
  return p;
}
export function refreshAutomatic(p: HeadProject) {
  p.constraints = p.constraints.map((c) =>
    c.entityKind === "midline"
      ? createConstraint(p, c.viewId, c.entityId, "guide")
      : c.userAuthored ||
          c.strength === "locked" ||
          p.views.find((v) => v.id === c.viewId)!.locked
        ? c
        : {
            ...createConstraint(p, c.viewId, c.entityId, c.strength),
            enabled: c.enabled,
          },
  );
  return p;
}
