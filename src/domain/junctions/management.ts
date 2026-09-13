import type { LandmarkProject } from "../landmarks/model";
import type { CurveHalfEdgeRef, SmoothJunction } from "./model";
import {
  halfKey,
  junctionInstances,
  normalizePair,
  occupiedHalves,
} from "./topology";
import { resolveNetwork } from "./resolve";
export function createJunction(
  p: LandmarkProject,
  landmarkId: string,
  a: CurveHalfEdgeRef,
  b: CurveHalfEdgeRef,
): LandmarkProject {
  const j: SmoothJunction = {
    id: crypto.randomUUID(),
    ...normalizePair(p, landmarkId, a, b),
    extent: 0.15,
    mode: "spatial-G2",
  };
  const occupied = occupiedHalves(p);
  if (
    junctionInstances(p, j).some((i) =>
      [i.sideA, i.sideB].some((h) => occupied.has(halfKey(h))),
    )
  )
    throw new Error(
      "该结构线端点已被平滑配对占用；请先取消原平滑（包括当前无效的配对）。",
    );
  const next = { ...p, smoothJunctions: [...(p.smoothJunctions ?? []), j] },
    network = resolveNetwork(next),
    invalid = network.junctions.find(
      (x) => x.sourceId === j.id && x.state === "INVALID",
    );
  if (invalid) throw new Error(invalid.reason);
  const oldValid = new Set(
    resolveNetwork(p)
      .junctions.filter((x) => x.state === "VALID")
      .map((x) => x.sourceId),
  );
  if (
    network.junctions.some(
      (x) => x.state === "INVALID" && oldValid.has(x.sourceId),
    )
  )
    throw new Error("此配对会与另一端平滑范围重叠。");
  return next;
}
export function changeExtent(
  p: LandmarkProject,
  id: string,
  extent: number,
): LandmarkProject {
  if (!Number.isFinite(extent) || extent < 0.01 || extent > 0.45)
    throw new Error("平滑范围必须在 1%–45% 之间。");
  const source = (p.smoothJunctions ?? []).find((j) => j.id === id);
  if (!source || source.extent === extent) return p;
  const next = {
    ...p,
    smoothJunctions: (p.smoothJunctions ?? []).map((j) =>
      j.id === id ? { ...j, extent } : j,
    ),
  };
  const oldValid = new Set(
    resolveNetwork(p)
      .junctions.filter((x) => x.state === "VALID")
      .map((x) => x.sourceId),
  );
  const invalid = resolveNetwork(next).junctions.find(
    (x) => x.state === "INVALID" && oldValid.has(x.sourceId),
  );
  if (invalid) throw new Error(invalid.reason);
  return next;
}
export const removeJunction = (
  p: LandmarkProject,
  id: string,
): LandmarkProject => ({
  ...p,
  smoothJunctions: (p.smoothJunctions ?? []).filter((j) => j.id !== id),
});
