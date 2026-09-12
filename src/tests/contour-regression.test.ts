import { it, expect } from "vitest";
import { createProject, createConstraint } from "../domain/project/project";
import { silhouette, project, sub } from "../domain/geometry/core";
import { sparseHandles } from "../domain/curves/handles";
import { parseProject, serializeProject } from "../domain/project/persistence";
it("traces complete closed boundaries under tangent noise and lower-jaw deformation", () => {
  const p = createProject();
  for (let seed = 0; seed < 18; seed++) {
    const vertices = p.surface.vertices.map(
      ([x, y, z], i) =>
        [
          x * (1 + 0.18 * Math.exp(-(((y + 0.75) / 0.11) ** 2))),
          y +
            0.025 *
              Math.sin(i * 0.19 + seed) *
              Math.exp(-(((y + 0.9) / 0.2) ** 2)),
          z + 1e-13 * Math.sin(i + seed),
        ] as [number, number, number],
    );
    for (const view of p.views) {
      const ids = silhouette(vertices, p.surface.faces, view),
        pts = ids.map((i) => project(vertices[i], view));
      expect(ids.length).toBeGreaterThan(30);
      const jumps = pts.map((q, i) =>
        Math.hypot(
          q[0] - pts[(i + 1) % pts.length][0],
          q[1] - pts[(i + 1) % pts.length][1],
        ),
      );
      expect(Math.max(...jumps)).toBeLessThan(0.3);
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.5);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
    }
  }
});
it("uses semantic levels for sparse handles without discarding authored target samples", () => {
  const p = createProject(),
    c = p.constraints.find((c) => c.id === "front:silhouette")!;
  expect(c.curve.points.length).toBe(64);
  expect(c.curve.handles!.length).toBeGreaterThanOrEqual(24);
  expect(c.curve.handles!.length).toBeLessThanOrEqual(28);
  const original = structuredClone(c.curve.points);
  c.curve.points[5][0] -= 0.08;
  c.userAuthored = true;
  const edited = structuredClone(c.curve.points);
  delete c.curve.handles;
  const loaded = parseProject(serializeProject(p));
  const lc = loaded.constraints.find((c) => c.id === "front:silhouette")!;
  expect(lc.curve.handles!.length).toBeLessThan(32);
  expect(lc.curve.points).toEqual(edited);
  expect(lc.curve.points).not.toEqual(original);
  expect(
    p.constraints.find((c) => c.id === "front:jaw_ring")!.curve.handles,
  ).toHaveLength(3);
});
it("round trips per-view reference images and rejects remote or invalid image metadata", () => {
  const p = createProject();
  p.views[0].reference = {
    name: "photo.jpg",
    dataUrl: "data:image/jpeg;base64,YWJj",
    width: 300,
    height: 400,
    opacity: 0.4,
    visible: true,
    locked: true,
    scale: 1.5,
    offset: [0.2, -0.1],
    rotation: 5,
  };
  expect(parseProject(serializeProject(p)).views[0].reference).toEqual(
    p.views[0].reference,
  );
  p.views[0].reference.dataUrl = "https://example.com/tracker.svg";
  expect(() => parseProject(serializeProject(p))).toThrow();
});
