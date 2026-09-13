import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseLandmarks } from "../domain/landmarks/persistence";
import { controls, bezier } from "../domain/curves/geometry";
import { mirror, modelStateCode } from "../domain/landmarks/model";
import { dot, sub, project } from "../domain/geometry/core";
import {
  split,
  evaluate,
  derivative,
  arcLengthLUT,
} from "../domain/geometry/bezier";
const old = JSON.parse(
  readFileSync("artifacts/head-neck-refinement/refined.json", "utf8"),
);
const prepared = parseLandmarks(
  readFileSync("artifacts/patch-prep/cheek-cage.json", "utf8"),
);
it.each([null, "broken", { arbitrary: true }])(
  "legacy Smooth data is ignored even when malformed: %j",
  (junk) => {
    const p = parseLandmarks(
      JSON.stringify({
        ...old,
        smoothJunctions: junk,
        surfaceSmoothNodes: junk,
        surfaceSmoothDefaults: junk,
      }),
    );
    expect(p.version).toBe("landmarks-0.3.9");
    expect(JSON.stringify(p)).not.toMatch(
      /smoothJunctions|surfaceSmoothNodes|surfaceSmoothDefaults/,
    );
    expect(p.landmarks).toEqual(parseLandmarks(JSON.stringify(old)).landmarks);
    expect(p.curves).toEqual(parseLandmarks(JSON.stringify(old)).curves);
  },
);
it("adds exactly two ordinary landmarks and four curves; original objects and AC unchanged", () => {
  const source = parseLandmarks(JSON.stringify(old));
  expect(prepared.landmarks.length).toBe(49);
  expect(prepared.curves.length).toBe(66);
  expect(prepared.landmarks.slice(0, 47)).toEqual(source.landmarks);
  expect(prepared.curves.slice(0, 62)).toEqual(source.curves);
  const added = prepared.landmarks.slice(47);
  expect(added.map((l) => l.name)).toEqual(["左颊峰点", "右颊峰点"]);
  expect(added[1].position).toEqual(mirror(added[0].position));
  expect(Object.keys(added[0]).sort()).toEqual(
    Object.keys(source.landmarks.find((l) => l.type === "LEFT")!).sort(),
  );
});
it("B is inside AC in front and forward of the corresponding AC boundary height", () => {
  const edge = prepared.curves.find(
      (c) => c.name === "左面壳前边界·颧颊至下颊",
    )!,
    cp = controls(prepared, edge),
    B = prepared.landmarks.find((l) => l.name === "左颊峰点")!.position;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 50; i++) {
    let m = (lo + hi) / 2;
    if (bezier(cp, m)[1] > B[1]) lo = m;
    else hi = m;
  }
  const boundary = bezier(cp, (lo + hi) / 2);
  expect(B[0]).toBeLessThan(boundary[0]);
  expect(B[2]).toBeGreaterThan(boundary[2]);
  for (const id of ["front", "left30", "right30", "left45", "right45", "side"])
    expect(
      project(B, prepared.views.find((v) => v.id === id)!).every(
        Number.isFinite,
      ),
    ).toBe(true);
});
it("new curves are normal planar mirrored cubics with exact endpoints and default handles", () => {
  for (const c of prepared.curves.slice(62)) {
    const cp = controls(prepared, c);
    expect(cp[0]).toEqual(
      prepared.landmarks.find((l) => l.id === c.startLandmarkId)!.position,
    );
    expect(cp[3]).toEqual(
      prepared.landmarks.find((l) => l.id === c.endLandmarkId)!.position,
    );
    if (c.role === "canonical") {
      for (const p of cp)
        expect(Math.abs(dot(sub(p, cp[0]), c.shape.planeNormal))).toBeLessThan(
          1e-10,
        );
      expect(c.shape.startHandle).toEqual({ along: 1 / 3, offset: 0 });
      expect(
        controls(
          prepared,
          prepared.curves.find((x) => x.id === c.mirrorPartnerCurveId)!,
        ),
      ).toEqual(cp.map(mirror));
    }
  }
});
it("prepared source save/load is stable and preserves centerline and locks", () => {
  expect(parseLandmarks(JSON.stringify(prepared))).toEqual(prepared);
  expect(modelStateCode(prepared)).toBe("F85E4E58");
  expect(prepared.centerlineOrder).toEqual(old.centerlineOrder);
  expect(prepared.lockedViews).toEqual(old.lockedViews);
});
it("general Bezier derivative, de Casteljau and arc-length helpers remain available", () => {
  const cp = controls(prepared, prepared.curves[62]),
    [a, b] = split(cp, 0.4);
  expect(evaluate(a, 1)).toEqual(evaluate(b, 0));
  const actual = evaluate(a, 0.5),
    source = evaluate(cp, 0.2);
  actual.forEach((x, i) => expect(x).toBeCloseTo(source[i], 12));
  expect(derivative(cp, 0)).toEqual(cp[1].map((x, i) => 3 * (x - cp[0][i])));
  expect(arcLengthLUT(cp).at(-1)).toBeCloseTo(
    Math.hypot(...sub(cp[3], cp[0])),
    10,
  );
});
