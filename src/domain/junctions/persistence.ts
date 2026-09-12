import type { LandmarkProject } from "../landmarks/model";
import type { SmoothJunction, CurveHalfEdgeRef } from "./model";
import { normalizePair, halfKey, junctionInstances } from "./topology";
export function parseJunctions(
  input: unknown,
  p: LandmarkProject,
): SmoothJunction[] {
  if (input === undefined) return [];
  const fail = () => {
    throw new Error(
      "平滑连接数据无效：请检查 UUID、端点引用、对称关系或重复占用。",
    );
  };
  if (!Array.isArray(input)) return fail();
  const ids = new Set<string>(),
    occupied = new Set<string>();
  return input.map((j) => {
    if (
      !j ||
      typeof j.id !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(j.id) ||
      ids.has(j.id) ||
      j.mode !== "G1" ||
      !Number.isFinite(j.extent) ||
      j.extent < 0.01 ||
      j.extent > 0.45
    )
      return fail();
    ids.add(j.id);
    for (const h of [j.sideA, j.sideB])
      if (
        !h ||
        typeof h.curveId !== "string" ||
        !["start", "end"].includes(h.endpoint)
      )
        return fail();
    let pair;
    try {
      pair = normalizePair(
        p,
        j.landmarkId,
        j.sideA as CurveHalfEdgeRef,
        j.sideB as CurveHalfEdgeRef,
      );
    } catch {
      return fail();
    }
    if (j.symmetry !== pair.symmetry) return fail();
    const clean: SmoothJunction = {
      id: j.id,
      ...pair,
      extent: j.extent,
      mode: "G1",
    };
    for (const i of junctionInstances(p, clean))
      for (const h of [i.sideA, i.sideB]) {
        const k = halfKey(h);
        if (occupied.has(k)) return fail();
        occupied.add(k);
      }
    // Geometry validity is intentionally not a load criterion; it is resolved from current source geometry.
    return clean;
  });
}
