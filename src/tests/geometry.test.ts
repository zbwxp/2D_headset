import { describe, it, expect } from "vitest";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Box3 } from "three";
import {
  ellipsoid,
  project,
  basis,
  dot,
  cross,
  sub,
  silhouette,
  subdivide,
} from "../domain/geometry/core";
import { createProject } from "../domain/project/project";
import {
  sampleCurve,
  closestPoint,
  curveFromPoints,
} from "../domain/curves/polyline";
import {
  parseProject,
  serializeProject,
  exportOBJ,
} from "../domain/project/persistence";
describe("canonical geometry", () => {
  it("generates a closed outward manifold with exact symmetry and unit normals", () => {
    const m = ellipsoid();
    expect(m.vertices.length).toBe(994);
    expect(m.faces.length).toBe(1984);
    const edges = new Map<string, number>();
    for (const [a, b, c] of m.faces) {
      expect(
        dot(
          cross(
            sub(m.vertices[b], m.vertices[a]),
            sub(m.vertices[c], m.vertices[a]),
          ),
          m.vertices[a],
        ),
      ).toBeGreaterThan(0);
      for (const [i, j] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const k = i < j ? `${i}:${j}` : `${j}:${i}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    expect([...edges.values()].every((v) => v === 2)).toBe(true);
    expect(m.vertices.length - edges.size + m.faces.length).toBe(2);
    for (const [a, b] of m.symmetryPairs) {
      expect(m.vertices[a][0]).toBeCloseTo(-m.vertices[b][0], 9);
      expect(m.vertices[a][1]).toBeCloseTo(m.vertices[b][1], 9);
      expect(m.vertices[a][2]).toBeCloseTo(m.vertices[b][2], 9);
    }
    for (const n of m.normals) expect(Math.hypot(...n)).toBeCloseTo(1, 9);
  });
  it("uses orthonormal cameras and independent front/side projections", () => {
    const p = createProject();
    for (const v of p.views) {
      const b = basis(v);
      expect(dot(b.right, b.up)).toBeCloseTo(0);
      expect(Math.hypot(...b.right)).toBeCloseTo(1);
    }
    expect(project([1, 2, 3], p.views[0])).toEqual([1, 2]);
    expect(project([1, 2, 3], p.views[3])[0]).toBeCloseTo(-3);
  });
  it("extracts cyclic silhouette candidates and subdivides without holes", () => {
    const p = createProject();
    for (const v of p.views) {
      const ids = silhouette(p.surface.vertices, p.surface.faces, v);
      expect(ids.length).toBeGreaterThan(30);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const fine = subdivide(p.surface.vertices, p.surface.faces);
    expect(fine.vertices.length).toBe(3970);
    expect(fine.faces.length).toBe(7936);
  });
});
describe("curves and persistence", () => {
  it("samples open and closed curves and finds nearest segment points", () => {
    const c = curveFromPoints(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      true,
    );
    expect(sampleCurve(c, 0.125)).toEqual([1, 0]);
    expect(sampleCurve(c, 0.875)).toEqual([0, 1]);
    expect(closestPoint([1, -1], c).point).toEqual([1, 0]);
    expect(sampleCurve({ ...c, closed: false }, 1)).toEqual([0, 2]);
  });
  it("round trips all project state and rejects malformed or unsafe input", () => {
    const p = createProject();
    expect(parseProject(serializeProject(p))).toEqual(p);
    const bad = structuredClone(p);
    bad.surface.faces[0][0] = 100000;
    expect(() => parseProject(JSON.stringify(bad))).toThrow();
    const malicious = structuredClone(p);
    malicious.constraints[0].curve.points[0][0] = Infinity;
    expect(() => parseProject(JSON.stringify(malicious))).toThrow();
    const dup = structuredClone(p);
    dup.surface.symmetryPairs.push(dup.surface.symmetryPairs[0]);
    expect(() => parseProject(JSON.stringify(dup))).toThrow();
    expect(() => parseProject("{}")).toThrow();
  });
  it("exports valid indexed OBJ with normals", () => {
    const p = createProject(),
      obj = exportOBJ(p);
    expect(obj.match(/^v /gm)?.length).toBe(994);
    expect(obj.match(/^vn /gm)?.length).toBe(994);
    expect(obj.match(/^f /gm)?.length).toBe(1984);
    expect(obj).not.toMatch(/NaN|Infinity/);
    const loaded = new OBJLoader().parse(obj),
      box = new Box3().setFromObject(loaded);
    expect(loaded.children.length).toBeGreaterThan(0);
    expect(box.max.y - box.min.y).toBeCloseTo(2.44);
    expect(box.max.x - box.min.x).toBeCloseTo(1.72);
  });
});
