import { describe, it, expect } from "vitest";
import { createLandmarkProject } from "../domain/landmarks/presets";
import { parseLandmarks } from "../domain/landmarks/persistence";
import { centerlineGuide, setGlobalViewLock } from "../domain/landmarks/model";
import { reorderCenterline } from "../domain/landmarks/order";
import {
  duplicateLandmark,
  deleteLandmark,
  renameLandmark,
} from "../domain/landmarks/management";

describe("explicit centerline sequence", () => {
  it("migrates legacy UI order once and repairs invalid entries deterministically", () => {
    const p = createLandmarkProject();
    const legacy = {
      ...p,
      centerlineOrder: undefined,
      landmarks: [...p.landmarks].reverse(),
    };
    const migrated = parseLandmarks(JSON.stringify(legacy));
    expect(migrated.centerlineOrder).toEqual([...p.centerlineOrder].reverse());
    const [a, b] = p.centerlineOrder;
    const repaired = parseLandmarks(
      JSON.stringify({
        ...p,
        centerlineOrder: [b, b, "deleted", p.landmarks.at(-1)!.id, 17, a],
      }),
    );
    expect(repaired.centerlineOrder).toEqual([
      b,
      a,
      ...p.centerlineOrder.slice(2),
    ]);
    repaired.landmarks.reverse();
    expect(parseLandmarks(JSON.stringify(repaired)).centerlineOrder).toEqual(
      repaired.centerlineOrder,
    );
  });
  it("reorders only metadata, preserves locked geometry, and drives one open guide", () => {
    const p = setGlobalViewLock(createLandmarkProject(), "right45", true);
    const [a, b, c] = p.centerlineOrder;
    const q = reorderCenterline(p, a, c, true);
    expect(q.centerlineOrder.slice(0, 3)).toEqual([b, c, a]);
    expect(q.landmarks).toBe(p.landmarks);
    expect(q.views).toBe(p.views);
    expect(q.lockedViews).toBe(p.lockedViews);
    expect(centerlineGuide(q)).toEqual(
      q.centerlineOrder.map(
        (id) => p.landmarks.find((l) => l.id === id)!.position,
      ),
    );
    expect(centerlineGuide(q)).toHaveLength(p.centerlineOrder.length);
    expect(reorderCenterline(q, a, a, true)).toBe(q);
    expect(reorderCenterline(q, "invalid", a, true)).toBe(q);
  });
  it("inserts after source, rename preserves order, deletion reconnects neighbors", () => {
    const p = createLandmarkProject(),
      source = p.centerlineOrder[1];
    const { project: q, selectedId: id } = duplicateLandmark(p, source, "眉心");
    expect(q.centerlineOrder).toEqual([
      p.centerlineOrder[0],
      source,
      id,
      ...p.centerlineOrder.slice(2),
    ]);
    const renamed = renameLandmark(q, id, "新眉心");
    expect(renamed.centerlineOrder).toBe(q.centerlineOrder);
    expect(deleteLandmark(renamed, id).centerlineOrder).toEqual(
      p.centerlineOrder,
    );
    expect(parseLandmarks(JSON.stringify(renamed)).centerlineOrder).toEqual(
      q.centerlineOrder,
    );
    let empty = p;
    for (const id of p.centerlineOrder) empty = deleteLandmark(empty, id);
    expect(centerlineGuide(empty)).toEqual([]);
    expect(parseLandmarks(JSON.stringify(empty)).centerlineOrder).toEqual([]);
  });
});
