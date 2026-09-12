import {
  duplicateLandmark,
  renameLandmark,
  deleteLandmark,
} from "../domain/landmarks/management";
import { reorderCenterline } from "../domain/landmarks/order";
import { create } from "zustand";
import type { ReferenceImage, Vec2 } from "../domain/project/types";
import type { LandmarkProject } from "../domain/landmarks/model";
import {
  allowedBasis,
  activateDriver,
  viewIsLocked,
  setGlobalViewLock,
  dragPosition,
  mirror,
} from "../domain/landmarks/model";
import { createLandmarkProject } from "../domain/landmarks/presets";
import { parseLandmarks } from "../domain/landmarks/persistence";
import { project } from "../domain/geometry/core";
export const HISTORY_LIMIT = 100;
const KEY = "contour.landmarks.v02";
let initial = createLandmarkProject(),
  message = "";
try {
  const saved =
    localStorage.getItem(KEY) ?? localStorage.getItem("contour.landmarks.v01");
  if (saved) {
    initial = parseLandmarks(saved);
    // Persist migration/repair immediately, before any user interaction.
    try {
      localStorage.setItem(KEY, JSON.stringify(initial));
    } catch {
      message = "迁移已完成，但本机存储已满，请下载 JSON 保存。";
    }
  } else {
    const old = localStorage.getItem("contour.project.v1");
    if (old) {
      const legacy = JSON.parse(old);
      initial.views = initial.views.map((v) => {
        const oldView = legacy.views?.find(
          (x: { id: string }) => x.id === v.id,
        );
        return {
          ...v,
          reference: oldView?.reference,
          canvas: oldView?.canvas ?? v.canvas,
        };
      });
      initial = parseLandmarks(JSON.stringify(initial));
      message =
        "已保留旧参考图，初始化语义点；旧曲面自动保存仍保留在原存储中。";
    }
  }
} catch {
  message = "自动保存无法读取，已打开新语义点项目；原存储未删除。";
}
interface State {
  project: LandmarkProject;
  viewId: string;
  selectedId: string | null;
  past: LandmarkProject[];
  future: LandmarkProject[];
  message: string;
  referenceMoving: boolean;
  beginEdit: () => void;
  selectView: (id: string) => void;
  selectLandmark: (id: string) => void;
  movePoint: (id: string, target: Vec2) => void;
  lockView: () => void;
  setViewLock: (viewId: string, locked: boolean) => void;
  setCanvas: (c: { zoom: number; pan: Vec2 }) => void;
  setReference: (id: string, r: ReferenceImage | undefined) => void;
  setReferenceMoving: (b: boolean) => void;
  notify: (m: string) => void;
  undo: () => void;
  redo: () => void;
  load: (p: LandmarkProject) => void;
  reset: () => void;
  rename: (n: string) => void;
  duplicateSelected: (name: string) => void;
  renameSelected: (name: string) => void;
  deleteSelected: () => void;
  reorderCenterline: (id: string, targetId: string, after: boolean) => void;
}
function persist(p: LandmarkProject) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    useEditor.setState({ message: "本机存储已满，请下载 JSON 保存。" });
  }
}
export const useEditor = create<State>((set, get) => {
  const commit = (p: LandmarkProject) => {
    set({ project: p });
    persist(p);
  };
  return {
    project: initial,
    viewId: initial.views[0].id,
    selectedId: initial.landmarks[0]?.id ?? null,
    past: [],
    future: [],
    message,
    referenceMoving: false,
    beginEdit: () =>
      set((s) => ({
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
        future: [],
      })),
    selectView: (id) => set({ viewId: id, referenceMoving: false }),
    selectLandmark: (id) => {
      if (!get().project.landmarks.some((l) => l.id === id)) return;
      const p = activateDriver(get().project, id);
      set({ project: p, selectedId: id, message: "" });
      persist(p);
    },
    notify: (message) => set({ message }),
    setReferenceMoving: (referenceMoving) => set({ referenceMoving }),
    setCanvas: (canvas) => {
      const s = get();
      commit({
        ...s.project,
        views: s.project.views.map((v) =>
          v.id === s.viewId ? { ...v, canvas } : v,
        ),
      });
    },
    setReference: (id, reference) => {
      const s = get();
      commit({
        ...s.project,
        views: s.project.views.map((v) =>
          v.id === id ? { ...v, reference } : v,
        ),
      });
    },
    movePoint: (id, target) => {
      const current = get(),
        s = { ...current, project: activateDriver(current.project, id) },
        l = s.project.landmarks.find((l) => l.id === id)!;
      if (!l) return;
      if (!allowedBasis(s.project, id).length) {
        set({ message: "此点被硬约束固定，请解除上方列出的视图锁。" });
        return;
      }
      const v = s.project.views.find((v) => v.id === s.viewId)!,
        old = project(l.position, v),
        position = dragPosition(s.project, id, v, [
          target[0] - old[0],
          target[1] - old[1],
        ]);
      if (!position.every(Number.isFinite)) return;
      commit({
        ...s.project,
        landmarks: s.project.landmarks.map((x) =>
          x.id === id
            ? { ...x, position }
            : x.id === l.mirrorPartnerId
              ? { ...x, position: mirror(position) }
              : x,
        ),
      });
    },
    lockView: () => {
      const s = get();
      s.setViewLock(s.viewId, !viewIsLocked(s.project, s.viewId));
    },
    setViewLock: (viewId, locked) => {
      const s = get(),
        v = s.project.views.find((v) => v.id === viewId);
      if (!v || viewIsLocked(s.project, viewId) === locked) return;
      s.beginEdit();
      commit(
        setGlobalViewLock(s.project, viewId, locked, s.selectedId ?? undefined),
      );
      set({
        message: `${v.label}：${locked ? "已启用视图锁；成对点仅约束 driver" : "已解除该视图锁"}`,
      });
    },
    undo: () => {
      const s = get(),
        p = s.past.at(-1);
      if (!p) return;
      set({
        project: p,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        selectedId: p.landmarks.some((l) => l.id === s.selectedId)
          ? s.selectedId
          : (p.landmarks[0]?.id ?? null),
        viewId: p.views.some((v) => v.id === s.viewId)
          ? s.viewId
          : p.views[0].id,
        referenceMoving: false,
      });
      commit(p);
    },
    redo: () => {
      const s = get(),
        p = s.future[0];
      if (!p) return;
      set({
        project: p,
        future: s.future.slice(1),
        past: [...s.past, s.project],
        selectedId: p.landmarks.some((l) => l.id === s.selectedId)
          ? s.selectedId
          : (p.landmarks[0]?.id ?? null),
        viewId: p.views.some((v) => v.id === s.viewId)
          ? s.viewId
          : p.views[0].id,
        referenceMoving: false,
      });
      commit(p);
    },
    load: (p) => {
      get().beginEdit();
      set({
        project: p,
        viewId: p.views[0].id,
        selectedId: p.landmarks[0]?.id ?? null,
        referenceMoving: false,
        message: "已载入语义点项目",
      });
      persist(p);
    },
    duplicateSelected: (name) => {
      const s = get();
      if (!s.selectedId) return;
      const result = duplicateLandmark(s.project, s.selectedId, name);
      s.beginEdit();
      set({
        project: result.project,
        selectedId: result.selectedId,
        message: "已复制；新点立即遵循当前视图锁。",
      });
      persist(result.project);
    },
    renameSelected: (name) => {
      const s = get();
      if (!s.selectedId) return;
      const p = renameLandmark(s.project, s.selectedId, name);
      s.beginEdit();
      commit(p);
    },
    reorderCenterline: (id, targetId, after) => {
      const s = get(),
        p = reorderCenterline(s.project, id, targetId, after);
      if (p === s.project) return;
      s.beginEdit();
      commit(p);
    },
    deleteSelected: () => {
      const s = get();
      if (!s.selectedId) return;
      const p = deleteLandmark(s.project, s.selectedId);
      s.beginEdit();
      set({
        project: p,
        selectedId: p.landmarks[0]?.id ?? null,
        message: p.landmarks.length
          ? "已删除，可撤销恢复。"
          : "所有点已删除，可通过撤销或打开项目恢复。",
      });
      persist(p);
    },
    reset: () => get().load(createLandmarkProject()),
    rename: (name) => {
      get().beginEdit();
      commit({ ...get().project, meta: { ...get().project.meta, name } });
    },
  };
});
