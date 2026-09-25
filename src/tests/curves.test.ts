import {createCurve,canonical,bodyShape,handleShape} from './planar-fixture';
import {world} from './world-fixture';
import { describe, it, expect } from "vitest";
import { createLandmarkProject } from "../domain/landmarks/presets";
import {
  mirror,
  setGlobalViewLock,
  type LandmarkProject,
} from "../domain/landmarks/model";
import {
  deleteCurve,
  renameCurve,
  incidentCurveIds,
} from "../domain/curves/management";
import {
  controls,
  frame,
  bezier,
  defaultNormal,
  transportNormal,
  followEndpoints,
  rotate,
  sampleCurve,
  planeTarget,
} from "../domain/curves/geometry";
import {
  dot,
  sub,
  normalize,
  cross,
  scale,
  add,
  project,
} from "../domain/geometry/core";
import { parseLandmarks } from "../domain/landmarks/persistence";
import {
  deleteLandmark,
  duplicateLandmark,
} from "../domain/landmarks/management";
const id = (p: LandmarkProject, n: string) =>
  p.landmarks.find((l) => l.name === n)!.id;
function setup(a = "右眉头点", b = "右眉尾点") {
  const p = createLandmarkProject();
  const r = createCurve(p, id(p, a), id(p, b), p.views[0], "眉弓");
  return { p: r.project, c: r.project.curves[0] };
}
function planar(p: LandmarkProject) {
  for (const c of p.curves) {
    const cp = controls(p, c),
      owner = canonical(p, c),
      n =
        c.role === "mirror"
          ? mirror(owner.shape.planeNormal)
          : owner.shape.planeNormal;
    for (const q of sampleCurve(p, c))
      expect(Math.abs(dot(sub(q, cp[0]), n))).toBeLessThan(1e-10);
  }
}
describe("planar curve kernel", () => {
  it("creates exact straight cubic and dependent reflected controls, shared center and sagittal cases", () => {
    for (const [a, b, count] of [
      ["右眉头点", "右眉尾点", 2],
      ["鼻尖点", "右嘴角点", 2],
      ["山根点", "鼻尖点", 1],
    ] as const) {
      const { p, c } = setup(a, b),
        cp = controls(p, c);
      expect(p.curves.length).toBe(count);
      for (let t = 0; t <= 1; t += 0.1)
        expect(
          Math.hypot(
            ...sub(bezier(cp, t), add(cp[0], scale(sub(cp[3], cp[0]), t))),
          ),
        ).toBeLessThan(1e-12);
      if (count === 2) {
        expect(p.curves[1].role).toBe("mirror");
        expect("shape" in p.curves[1]).toBe(false);
        expect(controls(p, p.curves[1])).toEqual(cp.map(mirror));
      } else expect(canonical(p, c).shape.planeNormal).toEqual([1, 0, 0]);
      planar(p);
    }
  });
  it("body updates offsets only using weights, endpoints and locked anchors stay fixed", () => {
    let { p, c } = setup();
    p = setGlobalViewLock(p, "front", true);
    const base = canonical(p, c),
      f = frame(p, base),
      cp = controls(p, c),
      target = add(bezier(cp, 0.5), scale(f.b, 0.2));
    const shape = bodyShape(p, base, 0.5, target);
    const q = {
      ...p,
      curves: p.curves.map((x) => (x.id === base.id ? { ...base, shape } : x)),
    };
    expect(shape.startHandle.along).toBe(1 / 3);
    expect(shape.endHandle.along).toBe(1 / 3);
    expect(shape.startHandle.offset).toBeGreaterThan(0);
    expect(shape.endHandle.offset).toBeGreaterThan(0);
    expect(
      Math.hypot(...sub(bezier(controls(q, q.curves[0]), 0.5), target)),
    ).toBeLessThan(1e-12);
    expect(q.landmarks).toBe(p.landmarks);
    expect(q.lockedViews).toBe(p.lockedViews);
    planar(q);
  });
  it("handle edit makes S shape; mirror ray targets map to canonical coordinates", () => {
    const { p, c } = setup(),
      base = canonical(p, c),
      f = frame(p, base);
    const s1 = handleShape(
      p,
      base,
      1,
      add(f.a, add(scale(f.d, f.length / 3), scale(f.b, 0.2))),
    );
    const q = {
      ...p,
      curves: p.curves.map((x) => (x.id === c.id ? { ...base, shape: s1 } : x)),
    };
    const s2 = handleShape(
      q,
      canonical(q, q.curves[0]),
      2,
      add(f.z, add(scale(f.d, -f.length / 3), scale(f.b, -0.2))),
    );
    const r = {
      ...q,
      curves: q.curves.map((x) => (x.id === c.id ? { ...base, shape: s2 } : x)),
    };
    expect(s2.startHandle.offset * s2.endHandle.offset).toBeLessThan(0);
    planar(r);
    const follower = r.curves[1],
      target = controls(r, r.curves[0])[1],
      view = r.views[0];
    const ray = planeTarget(r, follower, view, project(mirror(target), view))!;
    expect(Math.hypot(...sub(ray, target))).toBeLessThan(1e-12);
  });
  it("plane rotates around chord without modifying endpoints or handle parameters", () => {
    const { p, c } = setup(),
      base = canonical(p, c),
      f = frame(p, base);
    const shape = {
      ...base.shape,
      startHandle: { along: 0.2, offset: 0.3 },
      endHandle: { along: 0.4, offset: -0.2 },
      planeNormal: rotate(f.n, f.d, 0.7),
    };
    const q = {
      ...p,
      curves: p.curves.map((x) => (x.id === c.id ? { ...base, shape } : x)),
    };
    planar(q);
    expect(q.landmarks).toBe(p.landmarks);
    const cp = controls(q, q.curves[0]);
    expect(cp[0]).toEqual(f.a);
    expect(cp[3]).toEqual(f.z);
    expect(shape.startHandle).toEqual({ along: 0.2, offset: 0.3 });
  });
  it("endpoint follows shortest arc, preserves shape and mirror geometry", () => {
    const { p, c } = setup(),
      base = canonical(p, c),
      f = frame(p, base);
    const next = {
      ...p,
      landmarks: p.landmarks.map((l) =>
        l.id === c.endLandmarkId!
          ? { ...l, placement: {kind:'WORLD' as const,position:add(world(l).position, [0.05, 0.13, -0.2])} }
          : l.id ===
              p.landmarks.find((l) => l.id === c.endLandmarkId!)!.mirrorPartnerId
            ? {
                ...l,
                placement: {kind:'WORLD' as const,position:mirror(add(mirror(world(l).position), [0.05, 0.13, -0.2]))},
              }
            : l,
      ),
    };
    const q = followEndpoints(p, next),
      owner = canonical(q, q.curves[0]),
      newD = normalize(sub(controls(q, q.curves[0])[3], f.a));
    const axis = normalize(cross(f.d, newD)),
      angle = Math.acos(dot(f.d, newD));
    expect(
      Math.hypot(...sub(owner.shape.planeNormal, rotate(f.n, axis, angle))),
    ).toBeLessThan(1e-12);
    expect(owner.shape.startHandle).toBe(base.shape.startHandle);
    expect(owner.shape.endHandle).toBe(base.shape.endHandle);
    expect(controls(q, q.curves[1])).toEqual(
      controls(q, q.curves[0]).map(mirror),
    );
    planar(q);
  });
  it("deterministic camera fallback and 180 degree reversal remain finite", () => {
    const p = createLandmarkProject(),
      d: [number, number, number] = [0, 0, 1];
    expect(defaultNormal(d, p.views[0])).toEqual(defaultNormal(d, p.views[0]));
    expect(dot(defaultNormal(d, p.views[0]), d)).toBe(0);
    const n: [number, number, number] = [0, 1, 0];
    expect(transportNormal(n, d, [0, 0, -1])).toEqual(n);
    const { p: q, c } = setup();
    const a = world(q.landmarks.find((l) => l.id === c.startLandmarkId!)!).position;
    const collapsed = followEndpoints(q, {
      ...q,
      landmarks: q.landmarks.map((l) =>
        l.id === c.endLandmarkId! ? { ...l, placement: {kind:'WORLD' as const,position:a} } : l,
      ),
    });
    expect(
      controls(collapsed, collapsed.curves[0]).every((x) =>
        x.every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      planeTarget(collapsed, collapsed.curves[0], q.views[0], [0, 0]),
    ).toBeNull();
  });
  it("multiple edges, pair CRUD, cascade and duplicate-point topology", () => {
    const { p, c } = setup(),
      next = createCurve(
        p,
        c.startLandmarkId!,
        c.endLandmarkId!,
        p.views[0],
        "下缘",
      ).project;
    expect(next.curves.length).toBe(4);
    expect(new Set(next.curves.map((c) => c.id)).size).toBe(4);
    const renamed = renameCurve(next, next.curves[1].id, "上缘");
    expect(
      renamed.curves
        .slice(0, 2)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["右上缘", "左上缘"].sort());
    expect(deleteCurve(next, next.curves[1].id).curves.length).toBe(2);
    expect(incidentCurveIds(next, c.startLandmarkId!).size).toBe(4);
    expect(deleteLandmark(next, c.startLandmarkId!).curves).toEqual([]);
    expect(
      duplicateLandmark(next, c.startLandmarkId!, "复制").project.curves,
    ).toBe(next.curves);
    expect(next.centerlineOrder).toBe(p.centerlineOrder);
  });
  it("rejects cross-side and coincident creation", () => {
    const p = createLandmarkProject();
    expect(() =>
      createCurve(p, id(p, "左嘴角点"), id(p, "右嘴角点"), p.views[0], "跨线"),
    ).toThrow();
    const duplicate = duplicateLandmark(p, p.landmarks[0].id, "重合");
    expect(() =>
      createCurve(
        duplicate.project,
        p.landmarks[0].id,
        duplicate.selectedId,
        p.views[0],
        "重合线",
      ),
    ).toThrow();
  });
  it("round trips canonical shape and rejects dangling or independently shaped mirror records", () => {
    const { p, c } = setup(),
      base = canonical(p, c),
      q = {
        ...p,
        curves: p.curves.map((x) =>
          x.id === c.id
            ? {
                ...base,
                shape: {
                  ...base.shape,
                  startHandle: { along: 0.4, offset: 0.3 },
                },
              }
            : x,
        ),
      };
    const migrated=parseLandmarks(JSON.stringify(q));
    for(const curve of q.curves)controls(migrated,curve).forEach((v,i)=>v.forEach((x,k)=>expect(x).toBeCloseTo(controls(q,curve)[i][k],12)));
    expect(
      parseLandmarks(
        JSON.stringify({ ...q, curves: undefined, version: "landmarks-0.2" }),
      ).curves,
    ).toEqual([]);
    expect(() =>
      parseLandmarks(JSON.stringify({ ...q, curves: [q.curves[0]] })),
    ).toThrow();
    expect(() =>
      parseLandmarks(
        JSON.stringify({
          ...q,
          curves: q.curves.map((x) =>
            x.role === "mirror" ? { ...x, shape: base.shape } : x,
          ),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseLandmarks(
        JSON.stringify({
          ...q,
          curves: q.curves.map((x) => ({ ...x, startLandmarkId: "missing" })),
        }),
      ),
    ).toThrow();
  });
});

it("tiny nonzero chords remain planar and collapsed chords recover deterministically", () => {
  const { p, c } = setup(),
    a = world(p.landmarks.find((l) => l.id === c.startLandmarkId!)!).position;
  const move = (old: LandmarkProject, position: [number, number, number]) =>
    followEndpoints(old, {
      ...old,
      landmarks: old.landmarks.map((l) =>
        l.id === c.endLandmarkId! ? { ...l, placement: {kind:'WORLD' as const,position:position} } : l,
      ),
    });
  const tiny = move(p, add(a, [1e-10, 2e-10, -3e-10]));
  const f = frame(tiny, canonical(tiny, tiny.curves[0]));
  expect(Math.abs(dot(f.d, f.n))).toBeLessThan(1e-12);
  const zero = move(p, a),
    recovered = move(zero, add(a, [0.1, 0.2, -0.3]));
  expect(recovered.curves).toEqual(move(zero, add(a, [0.1, 0.2, -0.3])).curves);
  expect(
    Math.abs(
      dot(
        frame(recovered, canonical(recovered, recovered.curves[0])).d,
        canonical(recovered, recovered.curves[0]).shape.planeNormal,
      ),
    ),
  ).toBeLessThan(1e-12);
});
