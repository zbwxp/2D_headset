import { it, expect } from "vitest";
import { createLandmarkProject } from "../domain/landmarks/presets";
import {
  allowedBasis,
  captureLock,
  dragPosition,
  mirror,
} from "../domain/landmarks/model";
import { parseLandmarks } from "../domain/landmarks/persistence";
import { project, dot } from "../domain/geometry/core";
const setup = () => {
  const p = createLandmarkProject();
  return {
    p,
    l: p.landmarks.find((l) => l.name === "左外眼角点")!,
    front: p.views[0],
    side: p.views.find((v) => v.id === "side")!,
    yaw: p.views.find((v) => v.id === "right45")!,
  };
};
it("20 stable UUID landmarks, six centers, seven mirror pairs; no surface geometry", () => {
  const { p } = setup();
  expect(p.landmarks).toHaveLength(20);
  expect(p.landmarks.filter((l) => l.type === "CENTERLINE")).toHaveLength(6);
  expect(new Set(p.landmarks.map((l) => l.id)).size).toBe(20);
  expect(p).not.toHaveProperty("surface");
  expect(parseLandmarks(JSON.stringify(p))).toEqual(p);
});
it("unlocked drag preserves camera depth and changes only selected position", () => {
  const { p, l, yaw } = setup();
  const before = structuredClone(p);
  const q = dragPosition(p, l.id, yaw, [0.2, -0.1]);
  const a = project(l.position, yaw),
    b = project(q, yaw);
  expect(b[0] - a[0]).toBeCloseTo(0.2, 12);
  expect(b[1] - a[1]).toBeCloseTo(-0.1, 12);
  expect(dot(q, [Math.SQRT1_2, 0, Math.SQRT1_2])).toBeCloseTo(
    dot(l.position, [Math.SQRT1_2, 0, Math.SQRT1_2]),
    12,
  );
  expect(p).toEqual(before);
});
it("front lock allows ray movement, side second lock fixes point, unlock restores freedom", () => {
  const { p, l, front, side, yaw } = setup();
  l.viewLocks.front = captureLock(l.position, front);
  expect(allowedBasis(p, l.id)).toHaveLength(1);
  const old = project(l.position, front);
  l.position = dragPosition(p, l.id, side, [0.3, 0.4]);
  expect(project(l.position, front)).toEqual(old);
  l.viewLocks.side = captureLock(l.position, side);
  expect(allowedBasis(p, l.id)).toHaveLength(0);
  expect(dragPosition(p, l.id, yaw, [4, 4])).toEqual(l.position);
  delete l.viewLocks.front;
  expect(allowedBasis(p, l.id)).toHaveLength(1);
});
it("centerline intersects locks: side locks all DOFs; front leaves depth only", () => {
  const { p, side, front } = setup();
  const l = p.landmarks.find((x) => x.name === "鼻尖点")!;
  expect(allowedBasis(p, l.id)).toHaveLength(2);
  expect(dragPosition(p, l.id, front, [10, 0.1])[0]).toBe(0);
  l.viewLocks.front = captureLock(l.position, front);
  expect(allowedBasis(p, l.id)).toHaveLength(1);
  delete l.viewLocks.front;
  l.viewLocks.side = captureLock(l.position, side);
  expect(allowedBasis(p, l.id)).toHaveLength(0);
});
it("switching the driver inherits explicit view directions without reflection", () => {
  const { p, l, front, side } = setup();
  const partner = p.landmarks.find((x) => x.id === l.mirrorPartnerId)!;
  partner.viewLocks.front = captureLock(partner.position, front);
  expect(allowedBasis(p, l.id)).toHaveLength(1);
  const q = dragPosition(p, l.id, side, [0.2, 0.9]);
  expect(project(mirror(q), front)).toEqual(project(partner.position, front));
  l.viewLocks.side = captureLock(l.position, side);
  expect(allowedBasis(p, l.id)).toHaveLength(0);
});
it("duplicate parallel locks do not remove additional DOFs and snapshots ignore camera/pan/zoom", () => {
  const { p, l, front, side } = setup();
  l.viewLocks.front = captureLock(l.position, front);
  l.viewLocks.side = captureLock(l.position, front);
  expect(allowedBasis(p, l.id)).toHaveLength(1);
  front.canvas = { zoom: 4, pan: [123, 89] };
  front.camera.position = [3, 2, 1];
  expect(allowedBasis(p, l.id)).toHaveLength(1);
  const q = dragPosition(p, l.id, side, [1, 1]);
  expect(q[0]).toBe(l.position[0]);
  expect(q[1]).toBe(l.position[1]);
});
it("repeated mixed drags maintain every hard lock within floating point tolerance", () => {
  const { p, l, yaw, side } = setup();
  const partner = p.landmarks.find((x) => x.id === l.mirrorPartnerId)!;
  l.viewLocks.right45 = captureLock(l.position, yaw);
  for (let i = 0; i < 1000; i++) {
    l.position = dragPosition(p, l.id, side, [
      Math.sin(i) * 0.001,
      Math.cos(i) * 0.01,
    ]);
    partner.position = mirror(l.position);
  }
  const k = l.viewLocks.right45;
  expect(dot(l.position, k.right)).toBeCloseTo(k.coordinates[0], 10);
  expect(dot(l.position, k.up)).toBeCloseTo(k.coordinates[1], 10);
  expect(() => parseLandmarks(JSON.stringify(p))).not.toThrow();
});
it("rejects inconsistent hard constraints and broken mirror identity on load", () => {
  const { p, l, front } = setup();
  l.viewLocks.front = captureLock(l.position, front);
  l.viewLocks.front.coordinates[0] += 0.01;
  expect(() => parseLandmarks(JSON.stringify(p))).toThrow();
  delete l.viewLocks.front;
  l.mirrorPartnerId = l.id;
  expect(() => parseLandmarks(JSON.stringify(p))).toThrow();
});

it("unlocked centerline drag also preserves the current camera depth", () => {
  const { p, yaw } = setup();
  const l = p.landmarks.find((x) => x.name === "鼻尖点")!;
  const q = dragPosition(p, l.id, yaw, [0.3, 0.2]);
  expect(q[0]).toBe(0);
  expect(q[2]).toBeCloseTo(l.position[2], 12);
  expect(q[1] - l.position[1]).toBeCloseTo(0.2, 12);
});

it("whole-view lock/unlock affects all points atomically and leaves positions unchanged", async () => {
  const { setGlobalViewLock, viewIsLocked } = await import(
    "../domain/landmarks/model"
  );
  const { p } = setup();
  const locked = setGlobalViewLock(p, "front", true);
  expect(viewIsLocked(locked, "front")).toBe(true);
  expect(locked.landmarks.filter((l) => !!l.viewLocks.front)).toHaveLength(13);
  expect(locked.landmarks.map((l) => l.position)).toEqual(
    p.landmarks.map((l) => l.position),
  );
  expect(setGlobalViewLock(locked, "front", false)).toEqual(p);
});
it("single driver observations survive load without adding follower constraints", () => {
  const { p, l, front } = setup();
  l.viewLocks.front = captureLock(l.position, front);
  const upgraded = parseLandmarks(JSON.stringify(p));
  expect(upgraded.landmarks.filter((l) => !!l.viewLocks.front)).toHaveLength(1);
  expect(upgraded.landmarks.map((l) => l.position)).toEqual(
    p.landmarks.map((l) => l.position),
  );
  expect(upgraded.landmarks.find((x) => x.id === l.id)!.viewLocks).toEqual(
    l.viewLocks,
  );
});
it("45 degree mirror projects around the projected sagittal midpoint, not the screen origin", () => {
  const { p, l } = setup();
  for (const view of p.views.filter((v) =>
    ["left45", "right45"].includes(v.id),
  )) {
    const q = dragPosition(p, l.id, view, [0.15, 0.1]),
      r = mirror(q);
    const a = project(q, view),
      b = project(r, view),
      c = project([0, q[1], q[2]], view);
    expect(a[0] - c[0]).toBeCloseTo(-(b[0] - c[0]), 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(q[0]).toBe(-r[0]);
    expect(q.slice(1)).toEqual(r.slice(1));
  }
});
it("status distinguishes invisible ray motion from no feasible motion", async () => {
  const { motionState, setGlobalViewLock } = await import(
    "../domain/landmarks/model"
  );
  const { p, l, front, side } = setup();
  const locked = setGlobalViewLock(p, "front", true);
  expect(motionState(locked, l.id, front)).toMatchObject({
    spatialDof: 1,
    screenDof: 0,
    track: null,
  });
  expect(motionState(locked, l.id, side)).toMatchObject({
    spatialDof: 1,
    screenDof: 1,
  });
  expect(
    motionState(setGlobalViewLock(locked, "side", true), l.id, side),
  ).toMatchObject({ spatialDof: 0, screenDof: 0 });
});

it("unlocked yaw horizontal drag follows the camera 45-degree axis, never pure Z", () => {
  const { p, l } = setup();
  for (const id of ["left45", "right45"]) {
    const v = p.views.find((v) => v.id === id)!;
    const q = dragPosition(p, l.id, v, [0.2, 0]);
    expect(q[0] - l.position[0]).toBeCloseTo(0.2 * Math.SQRT1_2, 12);
    expect(q[1] - l.position[1]).toBeCloseTo(0, 12);
    expect(q[2] - l.position[2]).toBeCloseTo(
      (id === "left45" ? 1 : -1) * 0.2 * Math.SQRT1_2,
      12,
    );
    const before = project(mirror(l.position), v),
      after = project(mirror(q), v);
    // Mirroring this camera-plane displacement makes it parallel to the viewing ray.
    expect(after[0] - before[0]).toBeCloseTo(0, 12);
  }
});
it("unlocked pitch vertical drag follows the camera 45-degree axis; partner is projected independently", () => {
  const { p, l } = setup();
  for (const id of ["high45", "low45"]) {
    const v = p.views.find((v) => v.id === id)!;
    const q = dragPosition(p, l.id, v, [0.1, 0.2]);
    expect(q[0] - l.position[0]).toBeCloseTo(0.1, 12);
    expect(q[1] - l.position[1]).toBeCloseTo(0.2 * Math.SQRT1_2, 12);
    expect(q[2] - l.position[2]).toBeCloseTo(
      (id === "high45" ? -1 : 1) * 0.2 * Math.SQRT1_2,
      12,
    );
    const before = project(mirror(l.position), v),
      after = project(mirror(q), v);
    expect(after[0] - before[0]).toBeCloseTo(-0.1, 12);
    expect(after[1] - before[1]).toBeCloseTo(0.2, 12);
  }
});
it("front hard lock forces all four oblique editors to preserve X/Y and edit only Z", async () => {
  const { setGlobalViewLock } = await import("../domain/landmarks/model");
  const { p, l } = setup(),
    locked = setGlobalViewLock(p, "front", true);
  for (const id of ["left45", "right45", "high45", "low45"]) {
    const v = p.views.find((v) => v.id === id)!;
    const q = dragPosition(locked, l.id, v, [0.1, 0.2]);
    expect(q.slice(0, 2)).toEqual(l.position.slice(0, 2));
    expect(q[2]).not.toBe(l.position[2]);
  }
});
it("state comparison ignores portrait/landscape canvas changes, but detects geometry and locks", async () => {
  const { modelStateCode, setGlobalViewLock } = await import(
    "../domain/landmarks/model"
  );
  const { p } = setup(),
    code = modelStateCode(p);
  const portrait = structuredClone(p);
  portrait.views[0].canvas = { zoom: 0.44, pan: [30, -50] };
  expect(modelStateCode(portrait)).toBe(code);
  expect(modelStateCode(setGlobalViewLock(p, "front", true))).not.toBe(code);
  portrait.landmarks[0].position[1] += 0.1;
  expect(modelStateCode(portrait)).not.toBe(code);
});

it("A-E: driver oblique lock keeps a world ray, reprojects in top/front/side, second lock alone removes it", async () => {
  const { setGlobalViewLock, motionState } = await import(
    "../domain/landmarks/model"
  );
  const p = createLandmarkProject(),
    l = p.landmarks.find((l) => l.name === "右外眼角点")!;
  for (const [lockedId, activeId] of [
    ["right45", "top"],
    ["right30", "front"],
    ["right15", "side"],
  ]) {
    const v = p.views.find((v) => v.id === lockedId)!,
      active = p.views.find((v) => v.id === activeId)!;
    const locked = setGlobalViewLock(p, lockedId, true, l.id);
    expect(allowedBasis(locked, l.id)).toHaveLength(1);
    const m = motionState(locked, l.id, active);
    expect(m.screenDof).toBe(1);
    if (activeId === "top") {
      expect(Math.abs(m.track![0])).toBeCloseTo(Math.SQRT1_2, 12);
      expect(Math.abs(m.track![1])).toBeCloseTo(Math.SQRT1_2, 12);
    }
    const q = dragPosition(locked, l.id, active, [
      m.track![0] * 0.2,
      m.track![1] * 0.2,
    ]);
    const old = project(l.position, v),
      now = project(q, v);
    expect(now[0]).toBeCloseTo(old[0], 12);
    expect(now[1]).toBeCloseTo(old[1], 12);
    expect(Math.hypot(...q.map((x, i) => x - l.position[i]))).toBeGreaterThan(
      0.1,
    );
    expect(project(mirror(q), v)[0]).not.toBeCloseTo(
      project(mirror(l.position), v)[0],
      8,
    );
    expect(motionState(locked, l.id, v)).toMatchObject({
      spatialDof: 1,
      screenDof: 0,
      track: null,
    });
    expect(
      allowedBasis(setGlobalViewLock(locked, activeId, true, l.id), l.id),
    ).toHaveLength(0);
  }
});
it("driver handoff reanchors at current coordinates and follower remains unconstrained through roundtrip", async () => {
  const { setGlobalViewLock, activateDriver } = await import(
    "../domain/landmarks/model"
  );
  let p = createLandmarkProject();
  const right = p.landmarks.find((l) => l.name === "右外眼角点")!,
    left = p.landmarks.find((l) => l.id === right.mirrorPartnerId)!,
    top = p.views.find((v) => v.id === "top")!;
  p = setGlobalViewLock(p, "right45", true, right.id);
  const q = dragPosition(p, right.id, top, [0.2, -0.2]);
  p = {
    ...p,
    landmarks: p.landmarks.map((l) =>
      l.id === right.id
        ? { ...l, position: q }
        : l.id === left.id
          ? { ...l, position: mirror(q) }
          : l,
    ),
  };
  expect(p.landmarks.find((l) => l.id === left.id)!.viewLocks).toEqual({});
  const saved = parseLandmarks(JSON.stringify(p));
  expect(saved).toEqual(JSON.parse(JSON.stringify(p)));
  const switched = activateDriver(saved, left.id);
  expect(switched.landmarks.map((l) => l.position)).toEqual(
    saved.landmarks.map((l) => l.position),
  );
  expect(switched.landmarks.find((l) => l.id === right.id)!.viewLocks).toEqual(
    {},
  );
  expect(allowedBasis(switched, left.id)).toHaveLength(1);
  expect(parseLandmarks(JSON.stringify(switched))).toEqual(switched);
});
it("legacy double observations migrate to one driver without losing the explicit oblique view", () => {
  const p = createLandmarkProject(),
    right = p.landmarks.find((l) => l.name === "右外眼角点")!,
    left = p.landmarks.find((l) => l.id === right.mirrorPartnerId)!,
    v = p.views.find((v) => v.id === "right45")!;
  right.viewLocks.right45 = captureLock(right.position, v);
  left.viewLocks.right45 = captureLock(left.position, v);
  const migrated = parseLandmarks(JSON.stringify(p));
  expect(allowedBasis(migrated, right.id)).toHaveLength(1);
  expect(migrated.landmarks.find((l) => l.id === left.id)!.viewLocks).toEqual(
    {},
  );
  expect(migrated.landmarks.map((l) => l.position)).toEqual(
    p.landmarks.map((l) => l.position),
  );
});
