import { describe, it, expect } from "vitest";
import { createLandmarkProject } from "../domain/landmarks/presets";
import { mirror, type LandmarkProject } from "../domain/landmarks/model";
import { createCurve, deleteCurve } from "../domain/curves/management";
import {
  controls,
  canonical,
  bezier,
  followEndpoints,
  bodyShape,
  handleShape,
  rotate,
} from "../domain/curves/geometry";
import {
  createJunction,
  changeExtent,
  removeJunction,
} from "../domain/junctions/management";
import {
  resolveNetwork,
  commonTangent,
  splitCubic,
  arcTable,
  arcParameter,
  derivative,
  junctionPath,
  SAME_PLANE_TOLERANCE,
  INTERSECTION_STABILITY_TOLERANCE,
} from "../domain/junctions/resolve";
import { occupiedHalves, halfKey } from "../domain/junctions/topology";
import type { CurveHalfEdgeRef } from "../domain/junctions/model";
import type { Vec3 } from "../domain/project/types";
import {
  add,
  sub,
  scale,
  dot,
  normalize,
  cross,
} from "../domain/geometry/core";
import {
  deleteLandmark,
  duplicateLandmark,
  renameLandmark,
} from "../domain/landmarks/management";
import { parseLandmarks } from "../domain/landmarks/persistence";
const near = (a: Vec3, b: Vec3) =>
  expect(Math.hypot(...sub(a, b))).toBeLessThan(1e-9);
function fixture(reverseA = false, reverseB = false) {
  let p = createLandmarkProject();
  const ids = p.centerlineOrder;
  const positions: Vec3[] = [
    [0, 1, 0],
    [0, 0, 0],
    [0, 0, 1],
    [0, -1, 1],
    [0, -1, 0],
    [0, 0, -1],
  ];
  p = {
    ...p,
    landmarks: p.landmarks.map((l) =>
      ids.includes(l.id) ? { ...l, position: positions[ids.indexOf(l.id)] } : l,
    ),
  };
  p = createCurve(
    p,
    ids[reverseA ? 1 : 0],
    ids[reverseA ? 0 : 1],
    p.views[0],
    "A",
  ).project;
  p = createCurve(
    p,
    ids[reverseB ? 2 : 1],
    ids[reverseB ? 1 : 2],
    p.views[0],
    "B",
  ).project;
  const a: CurveHalfEdgeRef = {
      curveId: p.curves[0].id,
      endpoint: reverseA ? "start" : "end",
    },
    b: CurveHalfEdgeRef = {
      curveId: p.curves[1].id,
      endpoint: reverseB ? "end" : "start",
    };
  return { p, ids, a, b };
}
function checkG1(p: LandmarkProject) {
  for (const j of resolveNetwork(p).junctions) {
    expect(j.state).toBe("VALID");
    const ca = p.curves.find((c) => c.id === j.sideA.curveId)!,
      cb = p.curves.find((c) => c.id === j.sideB.curveId)!;
    near(
      normalize(derivative(j.blendA!, 1)),
      normalize(derivative(j.blendB!, 0)),
    );
    near(
      normalize(derivative(j.blendA!, 0)),
      scale(
        normalize(derivative(controls(p, ca), j.tA!)),
        j.sideA.endpoint === "start" ? -1 : 1,
      ),
    );
    near(
      normalize(derivative(j.blendB!, 1)),
      scale(
        normalize(derivative(controls(p, cb), j.tB!)),
        j.sideB.endpoint === "start" ? 1 : -1,
      ),
    );
    for (const [curve, blend] of [
      [ca, j.blendA!],
      [cb, j.blendB!],
    ] as const) {
      const n =
        curve.role === "mirror"
          ? mirror(canonical(p, curve).shape.planeNormal)
          : canonical(p, curve).shape.planeNormal;
      for (const q of blend)
        expect(Math.abs(dot(sub(q, blend[0]), n))).toBeLessThan(3e-10);
    }
  }
}
describe("local G1 resolve", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("exact outside spans and G1 for endpoint orientations %s/%s", (ra, rb) => {
    const { p, ids, a, b } = fixture(ra, rb),
      q = createJunction(p, ids[1], a, b),
      net = resolveNetwork(q);
    expect(net.spans.length).toBe(4);
    expect(q.curves).toBe(p.curves);
    expect(q.landmarks).toBe(p.landmarks);
    checkG1(q);
    const path = junctionPath(q, net.junctions[0])!.spans;
    for (let i = 1; i < path.length; i++) {
      near(path[i - 1][3], path[i][0]);
      near(
        normalize(derivative(path[i - 1], 1)),
        normalize(derivative(path[i], 0)),
      );
    }
    for (const s of net.spans.filter((s) => s.kind === "outer")) {
      const c = p.curves.find((c) => c.id === s.curveId)!,
        r = s.sourceRange!;
      for (let t = 0; t <= 1; t += 0.125)
        near(
          bezier(s.controls, t),
          bezier(controls(p, c), r[0] + t * (r[1] - r[0])),
        );
    }
    expect(removeJunction(q, q.smoothJunctions[0].id).curves).toBe(p.curves);
  });
  it("de Casteljau split and deterministic arc inversion preserve cubic", () => {
    const { p } = fixture(),
      cp = controls(p, p.curves[0]),
      [a, b] = splitCubic(cp, 0.37);
    near(a[3], b[0]);
    near(bezier(a, 0.5), bezier(cp, 0.185));
    const table = arcTable(cp);
    expect(arcParameter(table, 0.15)).toBeCloseTo(0.15, 10);
    expect(table).toEqual(arcTable(cp));
  });
  it("separates stable intersection, exact same plane, unsafe near-parallel, and cusp", () => {
    const a: Vec3 = [0, 0, 1],
      uA: Vec3 = [1, 0, 0],
      uB: Vec3 = [1, 0, 0];
    const stable = normalize([0, INTERSECTION_STABILITY_TOLERANCE * 2, 1]);
    const t = commonTangent(a, stable, uA, uB);
    expect(Math.abs(dot(t, a))).toBeLessThan(1e-12);
    expect(Math.abs(dot(t, stable))).toBeLessThan(1e-12);
    near(
      commonTangent(a, [0, 0, -1], [1, 0, 0], [0, 1, 0]),
      normalize([1, 1, 0]),
    );
    expect(() => commonTangent(a, normalize([0, 1e-7, 1]), uA, uB)).toThrow(
      /接近平行/,
    );
    near(
      commonTangent(a, normalize([0, SAME_PLANE_TOLERANCE * 0.1, 1]), uA, uB),
      uA,
    );
    expect(() => commonTangent(a, a, [1, 0, 0], [-1, 0, 0])).toThrow(/尖点/);
  });
  it("noncoplanar blends stay in their own planes and paired geometry is exact mirror", () => {
    let p = createLandmarkProject();
    const rs = p.landmarks.filter((l) => l.type === "RIGHT").slice(0, 3),
      coords: Vec3[] = [
        [-1, 1, 0],
        [-1, 0, 0],
        [0, 0, 1],
      ];
    p = {
      ...p,
      landmarks: p.landmarks.map((l) => {
        const i = rs.findIndex(
          (r) => r.id === l.id || r.mirrorPartnerId === l.id,
        );
        return i < 0
          ? l
          : {
              ...l,
              position: l.type === "RIGHT" ? coords[i] : mirror(coords[i]),
            };
      }),
    };
    p = createCurve(p, rs[0].id, rs[1].id, p.views[0], "A").project;
    p = createCurve(p, rs[1].id, rs[2].id, p.views[0], "B").project;
    const a = { curveId: p.curves[0].id, endpoint: "end" as const },
      b = { curveId: p.curves[2].id, endpoint: "start" as const };
    p = createJunction(p, rs[1].id, a, b);
    checkG1(p);
    const rows = resolveNetwork(p).junctions;
    expect(rows.length).toBe(2);
    expect(rows[1].blendA).toEqual(rows[0].blendA!.map(mirror));
    const source = canonical(p, p.curves[2]);
    const changed = {
      ...p,
      curves: p.curves.map((c) =>
        c.id === source.id
          ? {
              ...source,
              shape: {
                ...source.shape,
                planeNormal: rotate(
                  source.shape.planeNormal,
                  normalize([1, 0, 1]),
                  0.2,
                ),
              },
            }
          : c,
      ),
    };
    checkG1(changed);
    expect(resolveNetwork(changed).junctions).not.toEqual(rows);
    expect(changed.smoothJunctions).toBe(p.smoothJunctions);
  });
  it("source body and handle edits recompute trims without changing junction intent or other curve", () => {
    const f = fixture();
    const original = createJunction(f.p, f.ids[1], f.a, f.b);
    let p = original;
    for (const mode of ["body", "handle"] as const) {
      const c = canonical(p, p.curves[0]);
      const before = resolveNetwork(p);
      const shape =
        mode === "body"
          ? bodyShape(p, c, 0.5, add(bezier(controls(p, c), 0.5), [0, 0, 0.2]))
          : handleShape(p, c, 2, add(controls(p, c)[2], [0, 0, 0.15]));
      p = {
        ...p,
        curves: p.curves.map((x) => (x.id === c.id ? { ...c, shape } : x)),
      };
      expect(resolveNetwork(p)).not.toBe(before);
      expect(resolveNetwork(p).junctions[0].blendA).not.toEqual(
        before.junctions[0].blendA,
      );
      expect(p.smoothJunctions).toBe(original.smoothJunctions);
      expect(p.landmarks).toBe(original.landmarks);
      expect(p.curves[1]).toBe(original.curves[1]);
      checkG1(p);
    }
    expect(resolveNetwork(parseLandmarks(JSON.stringify(p)))).toEqual(
      resolveNetwork(p),
    );
    expect(resolveNetwork(original).junctions[0].blendA).not.toEqual(
      resolveNetwork(p).junctions[0].blendA,
    );
  });
  it("invalid intentions remain occupied, serialize without validity, and auto recover", () => {
    const f = fixture();
    let p = createJunction(f.p, f.ids[1], f.a, f.b);
    const j = p.smoothJunctions[0];
    // Moving outer endpoint to same ray creates a true coplanar U-turn.
    const moved = {
      ...p,
      landmarks: p.landmarks.map((l) =>
        l.id === f.ids[2] ? { ...l, position: [0, 2, 0] as Vec3 } : l,
      ),
    };
    let invalid = followEndpoints(p, moved);
    expect(resolveNetwork(invalid).junctions[0].state).toBe("INVALID");
    expect(resolveNetwork(invalid).spans.every((s) => s.kind === "outer")).toBe(
      true,
    );
    expect(occupiedHalves(invalid).has(halfKey(f.a))).toBe(true);
    expect(() => createJunction(invalid, f.ids[1], f.a, f.b)).toThrow(/占用/);
    invalid = changeExtent(invalid, j.id, 0.2);
    expect(invalid.smoothJunctions[0].extent).toBe(0.2);
    expect(resolveNetwork(invalid).junctions[0].state).toBe("INVALID");
    const loaded = parseLandmarks(JSON.stringify(invalid));
    expect(loaded.smoothJunctions).toEqual(invalid.smoothJunctions);
    expect(JSON.stringify(loaded.smoothJunctions)).not.toMatch(
      /INVALID|reason|blend|tA/,
    );
    const restored = followEndpoints(invalid, {
      ...invalid,
      landmarks: p.landmarks,
    });
    expect(resolveNetwork(restored).junctions[0].state).toBe("VALID");
    expect(restored.smoothJunctions[0].id).toBe(j.id);
  });
  it("self-symmetric mirror pair uses X or rejects incompatible original planes", () => {
    let p = createLandmarkProject();
    const v = p.landmarks[0],
      r = p.landmarks.find((l) => l.type === "RIGHT")!;
    p = {
      ...p,
      landmarks: p.landmarks.map((l) =>
        l.id === v.id
          ? { ...l, position: [0, 0, 0] as Vec3 }
          : l.id === r.id
            ? { ...l, position: [-1, 0, 0] as Vec3 }
            : l.id === r.mirrorPartnerId
              ? { ...l, position: [1, 0, 0] as Vec3 }
              : l,
      ),
    };
    p = createCurve(p, v.id, r.id, p.views[0], "左右").project;
    const a = { curveId: p.curves[0].id, endpoint: "start" as const },
      b = { curveId: p.curves[1].id, endpoint: "start" as const };
    const smooth = createJunction(p, v.id, a, b),
      j = resolveNetwork(smooth).junctions[0];
    expect(smooth.smoothJunctions[0].symmetry).toBe("self");
    expect(resolveNetwork(smooth).junctions.length).toBe(1);
    expect(j.blendB).toEqual(j.blendA!.map(mirror).reverse());
    checkG1(smooth);
    expect(() =>
      commonTangent(
        normalize([1, 0, 1]),
        normalize([-1, 0, 1]),
        [1, 0, 0],
        [1, 0, 0],
        true,
      ),
    ).toThrow(/左右对称/);
  });
  it("high valence allows disjoint pairs, rejects occupied half-edges and asymmetric branches", () => {
    let { p, ids, a, b } = fixture();
    p = createCurve(p, ids[4], ids[1], p.views[0], "C").project;
    p = createCurve(p, ids[1], ids[5], p.views[0], "D").project;
    const c = { curveId: p.curves[2].id, endpoint: "end" as const },
      d = { curveId: p.curves[3].id, endpoint: "start" as const };
    p = createJunction(p, ids[1], a, b);
    p = createJunction(p, ids[1], c, d);
    expect(p.smoothJunctions.length).toBe(2);
    expect(() => createJunction(p, ids[1], a, c)).toThrow(/占用/);
    const right = p.landmarks.find((l) => l.type === "RIGHT")!;
    p = createCurve(p, ids[1], right.id, p.views[0], "分支").project;
    expect(() =>
      createJunction({ ...p, smoothJunctions: [] }, ids[1], a, {
        curveId: p.curves.at(-2)!.id,
        endpoint: "start",
      }),
    ).toThrow(/对称/);
  });
  it("two ends share curve without trim reversal and explicit overlap rejects both ends", () => {
    let { p, ids, a, b } = fixture();
    p = createCurve(p, ids[2], ids[3], p.views[0], "C").project;
    const c = { curveId: p.curves[2].id, endpoint: "start" as const };
    p = createJunction(p, ids[1], a, b);
    p = createJunction(p, ids[2], { curveId: b.curveId, endpoint: "end" }, c);
    for (const j of p.smoothJunctions) p = changeExtent(p, j.id, 0.45);
    checkG1(p);
    // Defensive resolver test beyond UI limits; such state is rejected by JSON parser.
    const overlap = {
      ...p,
      smoothJunctions: p.smoothJunctions.map((j) => ({ ...j, extent: 0.6 })),
    };
    expect(
      resolveNetwork(overlap).junctions.every(
        (j) => j.state === "INVALID" && j.reason?.includes("重叠"),
      ),
    ).toBe(true);
    expect(() => parseLandmarks(JSON.stringify(overlap))).toThrow();
  });
  it("rename preserves refs, duplicate doesn't copy topology, deletion prunes and load validates occupancy", () => {
    const f = fixture(),
      p = createJunction(f.p, f.ids[1], f.a, f.b);
    expect(renameLandmark(p, f.ids[1], "改名").smoothJunctions).toBe(
      p.smoothJunctions,
    );
    expect(duplicateLandmark(p, f.ids[1], "副本").project.smoothJunctions).toBe(
      p.smoothJunctions,
    );
    expect(deleteCurve(p, f.a.curveId).smoothJunctions).toEqual([]);
    expect(deleteLandmark(p, f.ids[1]).smoothJunctions).toEqual([]);
    expect(parseLandmarks(JSON.stringify(p)).smoothJunctions).toEqual(
      p.smoothJunctions,
    );
    expect(() =>
      parseLandmarks(
        JSON.stringify({
          ...p,
          smoothJunctions: [
            ...p.smoothJunctions,
            { ...p.smoothJunctions[0], id: crypto.randomUUID() },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseLandmarks(
        JSON.stringify({
          ...p,
          smoothJunctions: [
            { ...p.smoothJunctions[0], sideA: { ...f.a, endpoint: "start" } },
          ],
        }),
      ),
    ).toThrow();
  });
});
