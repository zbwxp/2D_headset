import {world} from './world-fixture';
import { it, expect } from "vitest";
import { createLandmarkProject } from "../domain/landmarks/presets";
import {
  duplicateLandmark,
  renameLandmark,
  deleteLandmark,
} from "../domain/landmarks/management";
import {
  allowedBasis,
  dragPosition,
  mirror,
  setGlobalViewLock,
  viewIsLocked,
  motionState,
} from "../domain/landmarks/model";
import { parseLandmarks } from "../domain/landmarks/persistence";

it("A: copies a centerline point with independent UUID and position storage", () => {
  const p = createLandmarkProject(),
    source = p.landmarks.find((l) => l.name === "鼻尖点")!,
    before = structuredClone(p);
  const { project: q, selectedId } = duplicateLandmark(
      p,
      source.id,
      "测试中心点",
    ),
    copy = q.landmarks.find((l) => l.id === selectedId)!;
  expect(copy.id).not.toBe(source.id);
  expect(copy.name).toBe("测试中心点");
  expect(copy.type).toBe("CENTERLINE");
  expect(world(copy).position).toEqual(world(source).position);
  expect(world(copy).position).not.toBe(world(source).position);
  expect(p).toEqual(before);
  expect(dragPosition(q, copy.id, p.views[0], [0.2, 0.2])[0]).toBe(0);
});
it.each(["LEFT", "RIGHT"])(
  "B: copies entire pair, selects source side %s, and leaves original pair independent",
  (type) => {
    const p = createLandmarkProject(),
      source = p.landmarks.find((l) => l.type === type)!,
      sourcePair = p.landmarks.find((l) => l.id === source.mirrorPartnerId)!;
    const { project: q, selectedId } = duplicateLandmark(
        p,
        source.id,
        "颧骨点",
      ),
      l = q.landmarks.find((l) => l.id === selectedId)!,
      partner = q.landmarks.find((x) => x.id === l.mirrorPartnerId)!;
    expect(q.landmarks).toHaveLength(22);
    expect(l.type).toBe(type);
    expect(world(l).position).toEqual(world(source).position);
    expect(world(partner).position).toEqual(world(sourcePair).position);
    expect(partner.mirrorPartnerId).toBe(l.id);
    expect(l.id).not.toBe(source.id);
    expect(partner.id).not.toBe(sourcePair.id);
    expect(q.landmarks.slice(0, 20)).toEqual(p.landmarks);
    expect(world(partner).position).toEqual(mirror(world(l).position));
  },
);
it("C/D: original points are renameable/deletable, rename changes only names, pair deletion is atomic", () => {
  const p = createLandmarkProject(),
    center = p.landmarks[0],
    source = p.landmarks.find((l) => l.name === "右眉尾点")!;
  const renamed = renameLandmark(p, source.id, "新的眉尾点");
  for (const l of p.landmarks) {
    const changed = renamed.landmarks.find((x) => x.id === l.id)!;
    expect({ ...changed, name: l.name }).toEqual(l);
  }
  expect(
    renamed.landmarks.find((l) => l.id === source.mirrorPartnerId)!.name,
  ).toBe("左新的眉尾点");
  expect(renameLandmark(p, center.id, "新颅顶点").landmarks[0]).toEqual({
    ...center,
    name: "新颅顶点",
  });
  const removed = deleteLandmark(p, source.id);
  expect(removed.landmarks).toHaveLength(18);
  expect(removed.landmarks.some((l) => l.id === source.mirrorPartnerId)).toBe(
    false,
  );
});
it.each(["front", "right45"])(
  "E/F: duplicated pair owns exactly one %s anchor, inheriting global lock and 1DOF",
  (id) => {
    const p = createLandmarkProject(),
      source = p.landmarks.find((l) => l.name === "右外眼角点")!,
      locked = setGlobalViewLock(p, id, true, source.id);
    const { project: q, selectedId } = duplicateLandmark(
        locked,
        source.id,
        "颧骨点",
      ),
      driver = q.landmarks.find((l) => l.id === selectedId)!,
      follower = q.landmarks.find((l) => l.id === driver.mirrorPartnerId)!;
    expect(Object.keys(driver.viewLocks)).toEqual([id]);
    expect(follower.viewLocks).toEqual({});
    expect(allowedBasis(q, driver.id)).toHaveLength(1);
    expect(driver.viewLocks[id]).not.toBe(
      locked.landmarks.find((l) => l.id === source.id)!.viewLocks[id],
    );
    expect(
      motionState(q, driver.id, q.views.find((v) => v.id === "top")!).screenDof,
    ).toBe(1);
    expect(q.landmarks.slice(0, 20)).toEqual(locked.landmarks);
  },
);
it("G: duplicated pair under Front+Side is immediately fixed", () => {
  const p = createLandmarkProject(),
    source = p.landmarks.find((l) => l.type === "RIGHT")!,
    locked = setGlobalViewLock(
      setGlobalViewLock(p, "front", true),
      "side",
      true,
    );
  const { project: q, selectedId } = duplicateLandmark(
    locked,
    source.id,
    "测试点",
  );
  expect(allowedBasis(q, selectedId)).toHaveLength(0);
});
it("H: mixed management operations roundtrip UUIDs, custom names, positions, mirrors and anchors", () => {
  let p = createLandmarkProject();
  const center = p.landmarks[0],
    right = p.landmarks.find((l) => l.type === "RIGHT")!;
  p = setGlobalViewLock(p, "right45", true, right.id);
  p = duplicateLandmark(p, center.id, "中心测试").project;
  p = duplicateLandmark(p, right.id, "颧骨点").project;
  p = renameLandmark(p, center.id, "新颅顶");
  p = deleteLandmark(p, right.id);
  expect(parseLandmarks(JSON.stringify(p))).toEqual(
    JSON.parse(JSON.stringify(p)),
  );
});
it("all landmarks can be deleted, explicit locks survive empty save/load and can be unlocked", () => {
  let p = setGlobalViewLock(createLandmarkProject(), "front", true);
  while (p.landmarks.length) p = deleteLandmark(p, p.landmarks[0].id);
  expect(p.landmarks).toEqual([]);
  expect(viewIsLocked(p, "front")).toBe(true);
  const loaded = parseLandmarks(JSON.stringify(p));
  expect(loaded.landmarks).toEqual([]);
  expect(loaded.lockedViews).toEqual(["front"]);
  expect(viewIsLocked(setGlobalViewLock(loaded, "front", false), "front")).toBe(
    false,
  );
  expect(() => duplicateLandmark(loaded, "missing", "点")).toThrow();
});
it("old V0.1 snapshots migrate to explicit global lock state", () => {
  const p = setGlobalViewLock(createLandmarkProject(), "right45", true);
  delete p.lockedViews;
  expect(parseLandmarks(JSON.stringify(p)).lockedViews).toEqual(["right45"]);
});
it("empty names are rejected without altering source state", () => {
  const p = createLandmarkProject();
  expect(() => duplicateLandmark(p, p.landmarks[0].id, " ")).toThrow();
  expect(() => renameLandmark(p, p.landmarks[0].id, " ")).toThrow();
  expect(p.landmarks).toHaveLength(20);
});
