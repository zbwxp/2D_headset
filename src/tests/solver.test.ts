import { describe, it, expect } from "vitest";
import {
  createProject,
  refreshAutomatic,
  createConstraint,
} from "../domain/project/project";
import { solveSurface, measure } from "../domain/solver/solver";
import { sub, centroid } from "../domain/geometry/core";
import type { HeadProject } from "../domain/project/types";
function apply(p: HeadProject) {
  const r = solveSurface({ project: p, quality: "refine" });
  p.surface.previousVertices = p.surface.vertices;
  p.surface.vertices = r.vertices;
  p.surface.normals = r.normals;
  refreshAutomatic(p);
  return r;
}
function author(
  p: HeadProject,
  viewId: string,
  entityId: string,
  fn: (x: number, y: number) => [number, number],
) {
  const c = p.constraints.find(
    (c) => c.viewId === viewId && c.entityId === entityId,
  )!;
  c.userAuthored = true;
  c.strength = "strong";
  c.curve.points = c.curve.points.map(([x, y]) => fn(x, y));
  return c;
}
describe("global least-squares deformation", () => {
  it("preserves the default rest surface, centering, normals, and topology", () => {
    const p = createProject(),
      r = apply(p);
    expect(
      Math.max(
        ...r.vertices.map((v, i) =>
          Math.hypot(...sub(v, p.surface.baseVertices[i])),
        ),
      ),
    ).toBeLessThan(0.0001);
    expect(r.diagnostics.warnings).toEqual([]);
    expect(r.diagnostics.meanNormalAngle).toBeLessThan(12);
    expect(r.diagnostics.p95NormalAngle).toBeLessThan(35);
  });
  it("moves front jaw and retains locked front while editing side cranial volume", () => {
    const p = createProject();
    author(p, "front", "jaw_ring", (x, y) => [x * 1.12, y - 0.055]);
    const a = apply(p);
    const jaw = a.diagnostics.constraints.find(
      (d) => d.id === "front:jaw_ring",
    )!;
    expect(jaw.rmsErrorPx).toBeLessThan(4);
    expect(jaw.maxErrorPx).toBeLessThan(12);
    expect(
      Math.max(
        ...a.vertices.map((v, i) =>
          Math.hypot(...sub(v, p.surface.baseVertices[i])),
        ),
      ),
    ).toBeGreaterThan(0.04);
    const front = p.views.find((v) => v.id === "front")!;
    front.locked = true;
    p.constraints = p.constraints.map((c) =>
      c.viewId === "front" && !c.userAuthored
        ? { ...createConstraint(p, "front", c.entityId, c.strength) }
        : c,
    );
    author(p, "side", "cranial_ring", (x, y) => [x * 1.08, y]);
    const b = apply(p);
    const frontDs = b.diagnostics.constraints.filter(
      (d) => d.viewId === "front",
    );
    expect(frontDs.length).toBe(8); // The fixed midline is a guide, not a deformation constraint.
    expect(Math.max(...frontDs.map((d) => d.rmsErrorPx))).toBeLessThan(2);
    expect(Math.max(...frontDs.map((d) => d.maxErrorPx))).toBeLessThan(6);
    expect(
      b.diagnostics.constraints.find((d) => d.id === "side:cranial_ring")!
        .rmsErrorPx,
    ).toBeLessThan(4);
    expect(b.diagnostics.centroidDrift).toBeLessThan(0.0122);
    expect(b.diagnostics.symmetryEnergy).toBeLessThan(1e-12);
    expect(b.diagnostics.meanNormalAngle).toBeLessThan(12);
    expect(b.diagnostics.p95NormalAngle).toBeLessThan(35);
    console.log(
      "MULTIVIEW_METRICS",
      JSON.stringify({
        frontRms: Math.max(...frontDs.map((d) => d.rmsErrorPx)),
        frontMax: Math.max(...frontDs.map((d) => d.maxErrorPx)),
        sideRms: b.diagnostics.constraints.find(
          (d) => d.id === "side:cranial_ring",
        )!.rmsErrorPx,
        ms: b.diagnostics.solveTimeMs,
        meanNormal: b.diagnostics.meanNormalAngle,
        p95Normal: b.diagnostics.p95NormalAngle,
        drift: b.diagnostics.centroidDrift,
      }),
    );
  });
  it("fits silhouettes and reports conflicting locked observations honestly", () => {
    const p = createProject();
    author(p, "front", "silhouette", (x, y) => [x * 1.07, y]);
    let r = apply(p);
    expect(r.diagnostics.constraints[0].rmsErrorPx).toBeLessThan(4);
    expect(r.diagnostics.constraints[0].maxErrorPx).toBeLessThan(12);
    const c = author(p, "front", "jaw_ring", (x, y) => [x, y + 0.3]);
    c.strength = "locked";
    const side = author(p, "side", "jaw_ring", (x, y) => [x, y - 0.3]);
    side.strength = "locked";
    r = apply(p);
    expect(r.diagnostics.warnings.some((w) => w.includes("锁定"))).toBe(true);
    expect(r.vertices.every((v) => v.every(Number.isFinite))).toBe(true);
  });
  it("ignores disabled and guide constraints and limits preview jumps", () => {
    const p = createProject();
    const c = author(p, "front", "jaw_ring", (x, y) => [x * 1.8, y]);
    c.enabled = false;
    let r = solveSurface({ project: p, quality: "preview" });
    expect(r.diagnostics.constraints).toHaveLength(0);
    c.enabled = true;
    c.strength = "guide";
    r = solveSurface({ project: p, quality: "preview" });
    expect(r.diagnostics.constraints).toHaveLength(0);
    c.strength = "strong";
    r = solveSurface({ project: p, quality: "preview" });
    expect(r.diagnostics.maxDisplacement).toBeLessThanOrEqual(0.12000001);
    expect(r.diagnostics.symmetryEnergy).toBeLessThan(1e-12);
  });
});
