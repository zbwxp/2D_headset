import type { LandmarkProject, SemanticLandmark } from "./model";

// Preserve valid explicit entries; append missing IDs in legacy UI order.
// Legacy UI used landmarks[] directly; no separate display-order field existed.
export function repairCenterlineOrder(
  landmarks: SemanticLandmark[],
  input: unknown,
): string[] {
  const remaining = new Set(
    landmarks.filter((l) => l.type === "CENTERLINE").map((l) => l.id),
  );
  const order: string[] = [];
  for (const id of Array.isArray(input) ? input : []) {
    if (typeof id === "string" && remaining.delete(id)) order.push(id);
  }
  return [...order, ...remaining];
}

export function reorderCenterline(
  p: LandmarkProject,
  id: string,
  targetId: string,
  after: boolean,
): LandmarkProject {
  if (
    id === targetId ||
    !p.centerlineOrder.includes(id) ||
    !p.centerlineOrder.includes(targetId)
  )
    return p;
  const order = p.centerlineOrder.filter((x) => x !== id);
  order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, id);
  if (order.every((x, i) => x === p.centerlineOrder[i])) return p;
  return { ...p, centerlineOrder: order };
}
