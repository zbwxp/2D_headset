import { incidentCurveIds } from "../curves/management";
import type { LandmarkProject, SemanticLandmark } from "./model";
import { captureLock, viewIsLocked } from "./model";

function nameInput(value: string) {
  const name = value.trim();
  if (!name) throw new Error("请输入名称。");
  if (name.length > 80) throw new Error("名称请不超过 80 个字符。");
  return name;
}
export function landmarkBaseName(l: SemanticLandmark) {
  return l.type === "LEFT" || l.type === "RIGHT"
    ? l.name.replace(/^[左右]/, "")
    : l.name;
}
export function duplicateLandmark(
  p: LandmarkProject,
  id: string,
  value: string,
): { project: LandmarkProject; selectedId: string } {
  const source = p.landmarks.find((l) => l.id === id);
  if (!source) throw new Error("请先选择要复制的点。");
  const name = nameInput(value),
    partner = p.landmarks.find((l) => l.id === source.mirrorPartnerId);
  const copy = (l: SemanticLandmark): SemanticLandmark => ({
    id: crypto.randomUUID(),
    name: partner ? (l.type === "LEFT" ? "左" : "右") + name : name,
    position: [...l.position],
    type: l.type,
    viewLocks: {},
  });
  const driver = copy(source),
    follower = partner ? copy(partner) : undefined;
  if (follower) {
    driver.mirrorPartnerId = follower.id;
    follower.mirrorPartnerId = driver.id;
  }
  for (const v of p.views)
    if (viewIsLocked(p, v.id))
      driver.viewLocks[v.id] = captureLock(driver.position, v);
  const added = follower
    ? [driver, follower].sort((a, b) =>
        a.type === "LEFT" ? -1 : b.type === "LEFT" ? 1 : 0,
      )
    : [driver];
  return {
    project: {
      ...p,
      landmarks: [...p.landmarks, ...added],
      centerlineOrder:
        source.type === "CENTERLINE"
          ? p.centerlineOrder.flatMap((id) =>
              id === source.id ? [id, driver.id] : [id],
            )
          : p.centerlineOrder,
    },
    selectedId: driver.id,
  };
}
export function renameLandmark(
  p: LandmarkProject,
  id: string,
  value: string,
): LandmarkProject {
  const source = p.landmarks.find((l) => l.id === id);
  if (!source) throw new Error("请先选择要重命名的点。");
  const name = nameInput(value);
  return {
    ...p,
    landmarks: p.landmarks.map((l) =>
      l.id === id || l.id === source.mirrorPartnerId
        ? {
            ...l,
            name: source.mirrorPartnerId
              ? (l.type === "LEFT" ? "左" : "右") + name
              : name,
          }
        : l,
    ),
  };
}
export function deleteLandmark(
  p: LandmarkProject,
  id: string,
): LandmarkProject {
  const source = p.landmarks.find((l) => l.id === id);
  if (!source) return p;
  const incident = incidentCurveIds(p, id);
  return {
    ...p,
    curves: p.curves.filter((c) => !incident.has(c.id)),
    smoothJunctions: p.smoothJunctions.filter(
      (j) => !incident.has(j.sideA.curveId) && !incident.has(j.sideB.curveId),
    ),
    centerlineOrder: p.centerlineOrder.filter(
      (x) => x !== id && x !== source.mirrorPartnerId,
    ),
    landmarks: p.landmarks.filter(
      (l) => l.id !== id && l.id !== source.mirrorPartnerId,
    ),
  };
}
