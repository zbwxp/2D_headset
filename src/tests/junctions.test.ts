import { describe, it, expect } from "vitest";
import data from "./fixtures/ear-eye.json";
import { createLandmarkProject } from "../domain/landmarks/presets";
import { mirror, type LandmarkProject } from "../domain/landmarks/model";
import { createCurve, deleteCurve } from "../domain/curves/management";
import {
  controls,
  followEndpoints,
  type ControlPoints,
} from "../domain/curves/geometry";
import { parseLandmarks } from "../domain/landmarks/persistence";
import {
  createJunction,
  changeExtent,
  removeJunction,
} from "../domain/junctions/management";
import {
  resolveNetwork,
  junctionPath,
  subCubic,
} from "../domain/junctions/resolve";
import {
  evaluate,
  derivative,
  curvature,
  norm,
  sphereExit,
  roots01,
  flatten,
  regular,
  selfCrossing,
  spansCross,
  chooseTransition,
} from "../domain/junctions/spatial";
import { sub, scale, normalize } from "../domain/geometry/core";
import { occupiedHalves, halfKey } from "../domain/junctions/topology";
import {
  deleteLandmark,
  duplicateLandmark,
  renameLandmark,
} from "../domain/landmarks/management";
import type { Vec3 } from "../domain/project/types";
const near = (a: Vec3, b: Vec3, tol = 1e-8) =>
  expect(norm(sub(a, b))).toBeLessThan(tol);
function fixture(ra = false, rb = false) {
  let p = createLandmarkProject();
  const ids = p.centerlineOrder,
    ps: Vec3[] = [
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
      ids.includes(l.id) ? { ...l, position: ps[ids.indexOf(l.id)] } : l,
    ),
  };
  p = createCurve(p, ids[ra ? 1 : 0], ids[ra ? 0 : 1], p.views[0], "A").project;
  p = createCurve(p, ids[rb ? 2 : 1], ids[rb ? 1 : 2], p.views[0], "B").project;
  const a = {
      curveId: p.curves[0].id,
      endpoint: ra ? ("start" as const) : ("end" as const),
    },
    b = {
      curveId: p.curves[1].id,
      endpoint: rb ? ("end" as const) : ("start" as const),
    };
  return { p, ids, a, b };
}
function check(p: LandmarkProject) {
  for (const j of resolveNetwork(p).junctions) {
    expect(j.state, j.reason).toBe("VALID");
    const cp = j.transition!,
      r = j.distance!;
    for (const [h, t, end] of [
      [j.sideA, j.tA!, 0],
      [j.sideB, j.tB!, 1],
    ] as const) {
      const src = controls(p, p.curves.find((c) => c.id === h.curveId)!);
      near(evaluate(cp, end), evaluate(src, t), r * 1e-8);
      near(
        normalize(derivative(cp, end)),
        scale(
          normalize(derivative(src, t)),
          h.endpoint === (end === 0 ? "end" : "start") ? 1 : -1,
        ),
      );
      near(scale(curvature(cp, end), r), scale(curvature(src, t), r), 1e-7);
      const v = p.landmarks.find((l) => l.id === j.landmarkId)!.position;
      expect(norm(sub(evaluate(cp, end), v)) / r).toBeCloseTo(1, 8);
    }
  }
}
describe("spatial curvature-matched junctions", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("matches geometric 2-jets for endpoint directions %s/%s", (ra, rb) => {
    const f = fixture(ra, rb),
      p = createJunction(f.p, f.ids[1], f.a, f.b);
    check(p);
    expect(resolveNetwork(p).spans.length).toBe(3);
    const path = junctionPath(p, resolveNetwork(p).junctions[0])!.spans;
    for (let i = 1; i < path.length; i++) {
      near(path[i - 1].at(-1)!, path[i][0]);
      near(
        normalize(derivative(path[i - 1], 1)),
        normalize(derivative(path[i], 0)),
      );
      near(curvature(path[i - 1], 1), curvature(path[i], 0));
    }
    for (const s of resolveNetwork(p).spans.filter((s) => s.kind === "outer")) {
      const cp = controls(p, p.curves.find((c) => c.id === s.curveId)!);
      for (let t = 0; t <= 1; t += 0.125)
        near(
          evaluate(s.controls, t),
          evaluate(
            cp,
            s.sourceRange![0] + t * (s.sourceRange![1] - s.sourceRange![0]),
          ),
        );
    }
    expect(removeJunction(p, p.smoothJunctions[0].id).curves).toBe(f.p.curves);
  });
  it("sphere root isolation handles tangency, multiple exits, no exit and reversed traversal", () => {
    expect(roots01([0.16, -1, 1])).toEqual(
      expect.arrayContaining([expect.closeTo(0.2, 8), expect.closeTo(0.8, 8)]),
    );
    expect(roots01([0.25, -1, 1])).toEqual([0.5]);
    const cp: ControlPoints = [
      [0, 0, 0],
      [3, 0, 0],
      [-3, 0, 0],
      [0, 0, 0],
    ];
    const t = sphereExit(cp, cp[0], 0.5, "start");
    expect(t).toBeLessThan(0.2);
    expect(norm(evaluate(cp, t))).toBeCloseTo(0.5, 8);
    expect(sphereExit([...cp].reverse(), cp[0], 0.5, "end")).toBeCloseTo(
      1 - t,
      8,
    );
    const touch: ControlPoints = [
      [0, 0, 0],
      [4 / 3, 0, 0],
      [4 / 3, 0, 0],
      [0, 0, 0],
    ];
    expect(() => sphereExit(touch, touch[0], 1, "start")).toThrow(/相切/);
    expect(() => sphereExit(touch, touch[0], 2, "start")).toThrow(/未离开/);
  });
  it("actual ear and eye keep exact jets, mirror, no new crossings and improve peak curvature", () => {
    const p = parseLandmarks(JSON.stringify(data));
    check(p);
    const js = resolveNetwork(p).junctions;
    for (let i = 0; i < js.length; i += 2)
      expect(js[i + 1].transition).toEqual(js[i].transition!.map(mirror));
    const ear = js[0],
      eye = js[2];
    expect(ear.quality!.peakCurvature / ear.distance!).toBeLessThan(8); // prior ear V peak 16.66
    expect(eye.quality!.peakCurvature / eye.distance!).toBeLessThan(9); // prior eye V peak 11.36
    for (const j of [ear, eye]) {
      expect(j.warning).toBeUndefined();
      expect(
        regular(
          j.transition!.map((p) =>
            scale(sub(p, j.transition![0]), 1 / j.distance!),
          ),
        ),
      ).toBe(true);
    }
  });
  it("actual extent sweep is deterministic and does not jump between shapes", () => {
    const base = parseLandmarks(JSON.stringify(data));
    let prev: LandmarkProject | null = null;
    for (let i = 1; i <= 45; i++) {
      const p = {
        ...base,
        smoothJunctions: base.smoothJunctions.map((j) => ({
          ...j,
          extent: i / 100,
        })),
      };
      check(p);
      if (prev) {
        const old = resolveNetwork(prev).junctions;
        for (const [k, j] of resolveNetwork(p).junctions.entries())
          for (let t = 0; t <= 1; t += 0.1)
            expect(
              norm(
                sub(
                  evaluate(j.transition!, t),
                  evaluate(old[k].transition!, t),
                ),
              ) / j.distance!,
            ).toBeLessThan(Math.max(0.25, 2 / i));
      }
      prev = p;
    }
    expect(resolveNetwork(parseLandmarks(JSON.stringify(base)))).toEqual(
      resolveNetwork(base),
    );
  }, 20000);
  it.each([1e-4, 1e4])(
    "shape selection and continuity tolerances are scale invariant: %s",
    (factor) => {
      const p = parseLandmarks(JSON.stringify(data));
      const scaled = {
        ...p,
        landmarks: p.landmarks.map((l) => ({
          ...l,
          position: scale(l.position, factor),
        })),
      };
      check(scaled);
      for (const [i, j] of resolveNetwork(p).junctions.entries()) {
        const scaledJ = resolveNetwork(scaled).junctions[i];
        for (let t = 0; t <= 1; t += 0.1)
          near(
            evaluate(j.transition!, t),
            scale(evaluate(scaledJ.transition!, t), 1 / factor),
            2e-6,
          );
      }
    },
  );
  it("invalid source stays occupied, range editable and restores without deleting intent", () => {
    const f = fixture(),
      p = createJunction(f.p, f.ids[1], f.a, f.b);
    const invalid = followEndpoints(p, {
      ...p,
      landmarks: p.landmarks.map((l) =>
        l.id === f.ids[2] ? { ...l, position: [0, 1, 0] as Vec3 } : l,
      ),
    });
    expect(resolveNetwork(invalid).junctions[0].state).toBe("INVALID");
    expect(occupiedHalves(invalid).has(halfKey(f.a))).toBe(true);
    expect(() => createJunction(invalid, f.ids[1], f.a, f.b)).toThrow(/占用/);
    const adjusted = changeExtent(invalid, p.smoothJunctions[0].id, 0.2);
    expect(adjusted.smoothJunctions.length).toBe(1);
    const restored = followEndpoints(adjusted, {
      ...adjusted,
      landmarks: p.landmarks,
    });
    check(restored);
    expect(restored.smoothJunctions[0].id).toBe(p.smoothJunctions[0].id);
  });
  it("self-symmetric spatial curve has one shape without plane-intersection restriction", () => {
    let p = createLandmarkProject();
    const v = p.landmarks[0],
      r = p.landmarks.find((l) => l.type === "RIGHT")!;
    p = {
      ...p,
      landmarks: p.landmarks.map((l) =>
        l.id === v.id
          ? { ...l, position: [0, 0, 0] as Vec3 }
          : l.id === r.id
            ? { ...l, position: [-1, 1, 1] as Vec3 }
            : l.id === r.mirrorPartnerId
              ? { ...l, position: [1, 1, 1] as Vec3 }
              : l,
      ),
    };
    p = createCurve(p, v.id, r.id, p.views[0], "self").project;
    p = createJunction(
      p,
      v.id,
      { curveId: p.curves[0].id, endpoint: "start" },
      { curveId: p.curves[1].id, endpoint: "start" },
    );
    check(p);
    const cp = resolveNetwork(p).junctions[0].transition!;
    expect(cp).toEqual([...cp].reverse().map(mirror));
  });
  it("both ends compare actual trim parameters, not arc-length assumptions", () => {
    let { p, ids, a, b } = fixture();
    p = createCurve(p, ids[2], ids[3], p.views[0], "C").project;
    p = createJunction(p, ids[1], a, b);
    p = createJunction(
      p,
      ids[2],
      { curveId: b.curveId, endpoint: "end" },
      { curveId: p.curves[2].id, endpoint: "start" },
    );
    check(p);
    const overlap = {
      ...p,
      smoothJunctions: p.smoothJunctions.map((j) => ({ ...j, extent: 0.6 })),
    };
    expect(
      resolveNetwork(overlap).junctions.every((j) => j.state === "INVALID"),
    ).toBe(true);
  });
  it("closed ear test boundary keeps its closure and has no transition crossings", () => {
    let p = parseLandmarks(JSON.stringify(data));
    const lower = p.landmarks.find((l) => l.name === "右下耳根点")!,
      upper = p.landmarks.find((l) => l.name === "右上耳根点")!;
    p = createCurve(p, lower.id, upper.id, p.views[0], "测试闭合耳根").project;
    check(p);
    const n = resolveNetwork(p),
      blend = n.spans.find((s) => s.junctionId === p.smoothJunctions[0].id)!;
    for (const s of n.spans)
      if (s !== blend)
        expect(spansCross(blend.controls, s.controls)).toBe(false);
    expect(p.curves.at(-2)!.startLandmarkId).toBe(lower.id);
    expect(p.curves.at(-2)!.endLandmarkId).toBe(upper.id);
  });
  it("poor quality is a warning rather than a geometry failure", () => {
    const c = chooseTransition(
      [-1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [0, 40, 0],
      [0, 40, 0],
      [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
      false,
    );
    expect(c.warning).toBeTruthy();
    expect(c.cp.length).toBe(6);
  });
  it("delete/rename/duplicate, source-only persistence, old-mode migration and exclusivity", () => {
    const f = fixture(),
      p = createJunction(f.p, f.ids[1], f.a, f.b),
      j = p.smoothJunctions[0];
    expect(deleteCurve(p, f.a.curveId).smoothJunctions).toEqual([]);
    expect(deleteLandmark(p, f.ids[1]).smoothJunctions).toEqual([]);
    expect(renameLandmark(p, f.ids[1], "name").smoothJunctions).toBe(
      p.smoothJunctions,
    );
    expect(duplicateLandmark(p, f.ids[1], "copy").project.smoothJunctions).toBe(
      p.smoothJunctions,
    );
    const loaded = parseLandmarks(
      JSON.stringify({
        ...p,
        smoothJunctions: [
          { ...j, mode: "G1", transition: [], warning: "stale" },
        ],
      }),
    );
    expect(loaded.smoothJunctions[0]).toEqual(j);
    expect(JSON.stringify(loaded.smoothJunctions)).not.toMatch(
      /transition|warning|quality|INVALID/,
    );
    expect(() =>
      parseLandmarks(
        JSON.stringify({
          ...p,
          smoothJunctions: [j, { ...j, id: crypto.randomUUID() }],
        }),
      ),
    ).toThrow();
  });
  it("bounded tessellation, zero derivative and crossing checks include entire spans", () => {
    const cp: ControlPoints = [
      [0, 0, 0],
      [1, 2, 0],
      [2, -2, 0],
      [3, 0, 0],
    ];
    expect(flatten(cp, 1e-4).length).toBeGreaterThan(10);
    expect(
      regular([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toBe(false);
    expect(
      spansCross(
        [
          [0, 0, 0],
          [1, 1, 0],
        ],
        [
          [0, 1, 0],
          [1, 0, 0],
        ],
      ),
    ).toBe(true);
    expect(
      spansCross(
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        [
          [1, 0, 0],
          [2, 0, 0],
        ],
      ),
    ).toBe(false);
    expect(
      selfCrossing([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    ).toBe(false);
    near(evaluate(subCubic(cp, 0.2, 0.8), 0.5), evaluate(cp, 0.5));
  });
});
