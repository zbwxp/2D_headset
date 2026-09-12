import { it, expect } from "vitest";
import { createProject, entityProjection } from "../domain/project/project";
import { moveControl, rebuildFromControls } from "../domain/curves/rebuild";
import { parseProject, serializeProject } from "../domain/project/persistence";
import { solveSurface } from "../domain/solver/solver";
import { project } from "../domain/geometry/core";
it("three level semantic controls generate an exactly straight entire ring on both hemispheres", () => {
  const p = createProject(),
    c = p.constraints.find((c) => c.id === "front:brow_ring")!;
  c.curve.points.forEach((q, i) => {
    if (!c.curve.handles!.includes(i)) q[1] += 0.2 * Math.sin(i * 0.5);
  });
  for (const i of c.curve.handles!)
    moveControl(p, c, i, [c.curve.points[i][0], 0.4]);
  expect(
    Math.max(...c.curve.points.map((q) => Math.abs(q[1] - 0.4))),
  ).toBeLessThan(1e-10);
  c.userAuthored = true;
  c.strength = "strong";
  const result = solveSurface({ project: p, quality: "refine" });
  const ring = p.semanticModel.rings.find((r) => r.id === "brow_ring")!;
  expect(
    Math.max(
      ...ring.samples.map((s) =>
        Math.abs(project(result.vertices[s.vertexId], p.views[0])[1] - 0.4),
      ),
    ),
  ).toBeLessThan(0.015);
});
it("only the two segments between visible semantic controls define a front or 45-degree target", () => {
  for (const viewId of ["front", "left45", "right45", "side"]) {
    const p = createProject(),
      c = p.constraints.find((c) => c.id === `${viewId}:brow_ring`)!;
    p.solver.symmetry = false;
    const ids = c.curve
      .handles!.slice()
      .sort((a, b) => c.curve.points[a][0] - c.curve.points[b][0]);
    c.curve.points[ids[0]][1] = 0.3;
    c.curve.points[ids[1]][1] = 0.55;
    c.curve.points[ids[2]][1] = 0.35;
    rebuildFromControls(p, c);
    const [a, m, b] = ids.map((i) => c.curve.points[i]);
    for (const q of c.curve.points) {
      const [start, end] = q[0] <= m[0] ? [a, m] : [m, b];
      const t = (q[0] - start[0]) / (end[0] - start[0]);
      expect(q[1]).toBeCloseTo(start[1] + t * (end[1] - start[1]), 9);
    }
  }
});
it("pitched views retain the canonical projected ellipse with untouched controls", () => {
  const p = createProject(),
    c = p.constraints.find((c) => c.id === "high45:brow_ring")!,
    before = structuredClone(c.curve.points);
  rebuildFromControls(p, c);
  c.curve.points.forEach((q, i) => {
    expect(q[0]).toBeCloseTo(before[i][0], 9);
    expect(q[1]).toBeCloseTo(before[i][1], 9);
  });
});
it("front midline is an open fixed meridian with correct side under camera rotation", () => {
  const p = createProject(),
    r = p.semanticModel.rings.find((r) => r.kind === "midline")!;
  expect(r.closed).toBe(false);
  expect(r.editable).toBe(false);
  expect(r.samples).toHaveLength(33);
  r.samples.forEach((s) => {
    expect(p.surface.baseVertices[s.vertexId][0]).toBeCloseTo(0, 9);
    expect(p.surface.baseVertices[s.vertexId][2]).toBeGreaterThanOrEqual(0);
  });
  expect(
    entityProjection(p, "front", r.id).every((q) => Math.abs(q[0]) < 1e-8),
  ).toBe(true);
  expect(
    Math.min(...entityProjection(p, "right45", r.id).map((q) => q[0])),
  ).toBeLessThan(-0.6);
  expect(
    Math.max(...entityProjection(p, "right45", r.id).map((q) => q[0])),
  ).toBeLessThan(1e-8);
  expect(
    Math.max(...entityProjection(p, "left45", r.id).map((q) => q[0])),
  ).toBeGreaterThan(0.6);
});
it("old bumpy targets upgrade using existing controls without changing the saved mesh", () => {
  const p = createProject(),
    c = p.constraints.find((c) => c.id === "front:brow_ring")!;
  c.userAuthored = true;
  c.curve.points[4][1] += 0.3;
  const control = c.curve.handles!.map((i) => [...c.curve.points[i]]),
    vertices = structuredClone(p.surface.vertices);
  const loaded = parseProject(serializeProject(p)),
    up = loaded.constraints.find((x) => x.id === c.id)!;
  expect(up.curve.handles!.map((i) => up.curve.points[i])).toEqual(control);
  expect(up.curve.points[4][1]).toBeCloseTo(control[0][1]);
  expect(loaded.surface.vertices).toEqual(vertices);
});
