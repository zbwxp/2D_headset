import { create } from "zustand";
import { useEditor } from "../app/store";
export type Entity = { kind: "landmark" | "curve"; id: string };
export function activeSelection(): Entity | null {
  const s = useEditor.getState();
  if (s.selectedCurveId)
    return s.project.curves.some((c) => c.id === s.selectedCurveId)
      ? { kind: "curve", id: s.selectedCurveId }
      : null;
  return s.selectedId && s.project.landmarks.some((l) => l.id === s.selectedId)
    ? { kind: "landmark", id: s.selectedId }
    : null;
}
export const useUI = create<{
  junctionLandmarkId: string | null;
  hoverJunctionId: string | null;
  smoothDebug: boolean;
  landmarkCollapsed: boolean;
  curveCollapsed: boolean;
  duplicateId: string | null;
  deleteTarget: Entity | null;
  renameTarget: Entity | null;
  menu: { target: Entity; x: number; y: number } | null;
  positions: Record<string, { x: number; y: number }>;
}>(() => ({
  junctionLandmarkId: null,
  hoverJunctionId: null,
  smoothDebug: false,
  landmarkCollapsed: false,
  curveCollapsed: false,
  duplicateId: null,
  deleteTarget: null,
  renameTarget: null,
  menu: null,
  positions: {},
}));
export const focusWorkspace = () =>
  document
    .querySelector<HTMLElement>(".point-workspace")
    ?.focus({ preventScroll: true });
