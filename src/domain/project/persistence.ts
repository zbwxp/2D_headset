import { rebuildFromControls } from "../curves/rebuild";
import type { HeadProject, Vec3, Triangle } from "./types";
import { normals, sub, cross, dot } from "../geometry/core";
import { normalizeMidline } from "../semantics/midline";
import { initializeHandles } from "../curves/handles";
export function serializeProject(p: HeadProject) {
  return JSON.stringify(p);
}
export function parseProject(text: string): HeadProject {
  if (text.length > 20_000_000) throw new Error("项目文件过大（上限 20 MB）。");
  const p = JSON.parse(text) as HeadProject;
  const fail = () => {
    throw new Error("项目格式无效或版本不兼容。请载入 Contour 导出的 JSON。");
  };
  if (
    !p ||
    p.version !== "0.0.1" ||
    !p.meta ||
    typeof p.meta.name !== "string" ||
    !p.surface ||
    !Array.isArray(p.surface.vertices) ||
    p.surface.vertices.length < 4 ||
    p.surface.vertices.length > 15000
  )
    fail();
  const v3 = (v: unknown) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every(
      (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 100,
    );
  for (const key of ["vertices", "baseVertices", "previousVertices"] as const)
    if (
      !Array.isArray(p.surface[key]) ||
      p.surface[key].length !== p.surface.vertices.length ||
      !p.surface[key].every(v3)
    )
      fail();
  const n = p.surface.vertices.length,
    id = (i: unknown) => Number.isInteger(i) && Number(i) >= 0 && Number(i) < n;
  if (
    !Array.isArray(p.surface.faces) ||
    p.surface.faces.length > 60000 ||
    !p.surface.faces.length ||
    !p.surface.faces.every(
      (f) =>
        Array.isArray(f) &&
        f.length === 3 &&
        f.every(id) &&
        new Set(f).size === 3,
    )
  )
    fail();
  if (
    !Array.isArray(p.surface.symmetryPairs) ||
    !p.surface.symmetryPairs.every(
      (s) => Array.isArray(s) && s.length === 2 && s.every(id),
    )
  )
    fail();
  const covered = p.surface.symmetryPairs.flatMap(([a, b]) =>
    a === b ? [a] : [a, b],
  );
  if (covered.length !== n || new Set(covered).size !== n) fail();
  if (
    !Array.isArray(p.surface.anchorVertexIds) ||
    !p.surface.anchorVertexIds.every(id)
  )
    fail();
  if (
    !Array.isArray(p.views) ||
    p.views.length < 1 ||
    p.views.length > 12 ||
    !p.views.every(
      (v) =>
        typeof v.id === "string" &&
        typeof v.label === "string" &&
        typeof v.shortLabel === "string" &&
        v.camera?.projection === "orthographic" &&
        v3(v.camera.position) &&
        v3(v.camera.target) &&
        v3(v.camera.up) &&
        Math.hypot(...sub(v.camera.position, v.camera.target)) > 0.01 &&
        Math.hypot(
          ...cross(sub(v.camera.position, v.camera.target), v.camera.up),
        ) > 0.01 &&
        typeof v.locked === "boolean",
    )
  )
    fail();
  for (const v of p.views) {
    if (v.reference) {
      const r = v.reference;
      if (r.locked === undefined) r.locked = false;
      if (
        typeof r.name !== "string" ||
        typeof r.dataUrl !== "string" ||
        r.dataUrl.length > 3_000_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          r.dataUrl,
        ) ||
        ![r.width, r.height].every(
          (n) => Number.isFinite(n) && n > 0 && n <= 2048,
        ) ||
        !Number.isFinite(r.opacity) ||
        r.opacity < 0 ||
        r.opacity > 1 ||
        typeof r.visible !== "boolean" ||
        typeof r.locked !== "boolean" ||
        !Array.isArray(r.offset) ||
        r.offset.length !== 2 ||
        !r.offset.every((n) => Number.isFinite(n) && Math.abs(n) < 100) ||
        !Number.isFinite(r.scale) ||
        r.scale < 0.1 ||
        r.scale > 10 ||
        !Number.isFinite(r.rotation) ||
        Math.abs(r.rotation) > 180
      )
        fail();
    }
    if (!v.canvas) v.canvas = { zoom: 1, pan: [0, 0] };
    if (
      !Number.isFinite(v.canvas.zoom) ||
      v.canvas.zoom < 0.5 ||
      v.canvas.zoom > 3 ||
      !Array.isArray(v.canvas.pan) ||
      v.canvas.pan.length !== 2 ||
      !v.canvas.pan.every((x) => Number.isFinite(x) && Math.abs(x) < 100000)
    )
      fail();
  }
  if (new Set(p.views.map((v) => v.id)).size !== p.views.length) fail();
  if (
    !p.semanticModel ||
    !Array.isArray(p.semanticModel.rings) ||
    p.semanticModel.rings.length > 30 ||
    !p.semanticModel.rings.every(
      (r) =>
        typeof r.id === "string" &&
        typeof r.label === "string" &&
        typeof r.kind === "string" &&
        typeof r.editable === "boolean" &&
        typeof r.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(r.color) &&
        typeof r.closed === "boolean" &&
        Array.isArray(r.samples) &&
        r.samples.length >= 2 &&
        r.samples.length < 1000 &&
        r.samples.every(
          (s) => id(s.vertexId) && Number.isFinite(s.u) && s.u >= 0 && s.u <= 1,
        ),
    )
  )
    fail();
  if (
    new Set(p.semanticModel.rings.map((r) => r.id)).size !==
    p.semanticModel.rings.length
  )
    fail();
  const entities = ["silhouette", ...p.semanticModel.rings.map((r) => r.id)];
  if (
    !Array.isArray(p.constraints) ||
    p.constraints.length > 400 ||
    !p.constraints.every(
      (c) =>
        c.id === `${c.viewId}:${c.entityId}` &&
        p.views.some((v) => v.id === c.viewId) &&
        entities.includes(c.entityId) &&
        c.entityKind ===
          (c.entityId === "silhouette"
            ? "silhouette"
            : c.entityId === "midline_curve"
              ? "midline"
              : "semantic_ring") &&
        ["weak", "strong", "locked", "guide"].includes(c.strength) &&
        typeof c.enabled === "boolean" &&
        typeof c.userAuthored === "boolean" &&
        c.curve?.kind === "polyline" &&
        typeof c.curve.closed === "boolean" &&
        Array.isArray(c.curve.points) &&
        c.curve.points.length >= 3 &&
        c.curve.points.length <= 512 &&
        c.curve.points.every(
          (q) =>
            Array.isArray(q) &&
            q.length === 2 &&
            q.every((x) => Number.isFinite(x) && Math.abs(x) <= 10),
        ) &&
        Array.isArray(c.curve.parameters) &&
        c.curve.parameters.length === c.curve.points.length &&
        c.curve.parameters.every(
          (u, i) =>
            Number.isFinite(u) &&
            u >= 0 &&
            u <= 1 &&
            (i === 0 ? u === 0 : u > c.curve.parameters[i - 1]),
        ),
    )
  )
    fail();
  if (
    new Set(p.constraints.map((c) => c.id)).size !== p.constraints.length ||
    !p.views.every((v) =>
      entities.every(
        (e) =>
          p.constraints.filter((c) => c.viewId === v.id && c.entityId === e)
            .length === 1,
      ),
    )
  )
    fail();
  if (
    !p.solver ||
    !Number.isFinite(p.solver.fairness) ||
    p.solver.fairness < 0.1 ||
    p.solver.fairness > 30 ||
    !Number.isFinite(p.solver.temporal) ||
    p.solver.temporal < 0.001 ||
    p.solver.temporal > 1 ||
    typeof p.solver.symmetry !== "boolean" ||
    ![p.solver.previewIterations, p.solver.refineIterations].every(
      (x) => Number.isInteger(x) && x >= 1 && x <= 500,
    )
  )
    fail();
  for (const c of p.constraints)
    if (
      c.curve.handles &&
      (!Array.isArray(c.curve.handles) ||
        (!c.curve.handles.length && c.entityKind !== "midline") ||
        new Set(c.curve.handles).size !== c.curve.handles.length ||
        !c.curve.handles.every(
          (i) => Number.isInteger(i) && i >= 0 && i < c.curve.points.length,
        ))
    )
      fail();
  normalizeMidline(p);
  initializeHandles(p);
  for (const c of p.constraints)
    if (
      c.userAuthored &&
      c.entityKind === "semantic_ring" &&
      c.curve.controlModel !== "semantic-linear-v1"
    )
      rebuildFromControls(p, c);
  p.surface.normals = normals(p.surface.vertices, p.surface.faces);
  return p;
}
export function exportOBJ(p: HeadProject) {
  const { vertices, faces } = p.surface;
  if (!vertices.every((v) => v.every(Number.isFinite)))
    throw new Error("曲面包含无效坐标，无法导出。");
  const ns = normals(vertices, faces);
  const lines = ["# Contour · Semantic Head Surface", "o Head"];
  for (const v of vertices)
    lines.push(`v ${v.map((x) => x.toFixed(8)).join(" ")}`);
  for (const n of ns) lines.push(`vn ${n.map((x) => x.toFixed(8)).join(" ")}`);
  for (const f of faces)
    lines.push(`f ${f.map((i) => `${i + 1}//${i + 1}`).join(" ")}`);
  return lines.join("\n") + "\n";
}
export function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
