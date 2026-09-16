import { create } from "zustand";
import { useEditor } from "../app/store";
export type Entity = { kind: "landmark" | "curve" | "patch"; id: string };
export function activeSelection(): Entity | null {
  const s = useEditor.getState();
  if(s.selectedPatchId)return s.project.patches?.some(p=>p.id===s.selectedPatchId)?{kind:"patch",id:s.selectedPatchId}:null;
  if (s.selectedCurveId)
    return s.project.curves.some((c) => c.id === s.selectedCurveId)
      ? { kind: "curve", id: s.selectedCurveId }
      : null;
  return s.selectedId && s.project.landmarks.some((l) => l.id === s.selectedId)
    ? { kind: "landmark", id: s.selectedId }
    : null;
}
export const useUI = create<{
  continuityHover: import("../domain/patches/boundary").PatchBoundaryUse | null;
  landmarkCollapsed: boolean;
  curveCollapsed: boolean;
  patchCollapsed: boolean;
  duplicateId: string | null;
  deleteTarget: Entity | null;
  renameTarget: Entity | null;
  menu: { target: Entity; x: number; y: number } | null;
  positions: Record<string, { x: number; y: number }>;
}>(() => ({
  continuityHover: null,
  landmarkCollapsed: false,
  curveCollapsed: false,
  patchCollapsed: false,
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
