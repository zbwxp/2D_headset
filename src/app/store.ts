import {addPatch,prunePatches,defaultDisplay,type PatchDisplay} from "../domain/patches/model";
import {
  duplicateLandmark,
  renameLandmark,
  deleteLandmark,
} from "../domain/landmarks/management";
import {
  createCurve,
  renameCurve,
  deleteCurve,
} from "../domain/curves/management";
import { followEndpoints } from "../domain/curves/geometry";
import type { PlanarShape } from "../domain/curves/model";
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
const KEY = "contour.landmarks.v039";
let initial = createLandmarkProject(),
  message = "";
try {
  const saved =
    localStorage.getItem(KEY) ??
    localStorage.getItem("contour.landmarks.v038") ??
    localStorage.getItem("contour.landmarks.v036") ??
    localStorage.getItem("contour.landmarks.v035") ??
    localStorage.getItem("contour.landmarks.v03") ??
    localStorage.getItem("contour.landmarks.v02") ??
    localStorage.getItem("contour.landmarks.v01");
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
  patchCreation: string[] | null;
  selectedPatchId: string | null;
  selectPatch: (id:string) => void;
  startPatch: () => void;
  cancelPatch: () => void;
  pickPatchEdge: (id:string) => void;
  deletePatch: (id:string) => void;
  setPatchDisplay: (key:keyof PatchDisplay,value:number) => void;
  project: LandmarkProject;
  selectedCurveId: string | null;
  curveCreation: { startId: string | null } | null;
  startCurve: () => void;
  cancelCurve: () => void;
  pickCurveEndpoint: (id: string) => void;
  selectCurve: (id: string) => void;
  setCurveShape: (canonicalId: string, shape: PlanarShape) => void;
  renameCurve: (id: string, name: string) => void;
  deleteCurve: (id: string) => void;
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
  duplicateSelected: (name: string, sourceId?: string) => void;
  renameSelected: (name: string, sourceId?: string) => void;
  deleteSelected: (sourceId?: string) => void;
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
    p=prunePatches(p);
    set({ project: p });
    persist(p);
  };
  return {
    patchCreation:null, selectedPatchId:null,
    selectPatch:(id)=>{if(get().patchCreation || !get().project.patches?.some(p=>p.id===id))return;set({selectedPatchId:id,selectedCurveId:null,selectedId:null,curveCreation:null,message:""});},
    startPatch:()=>set({patchCreation:[],curveCreation:null,selectedCurveId:null,message:'选择 3 / 4 条边形成闭环；再次点击取消选择，Esc 退出。'}),
    cancelPatch:()=>set({patchCreation:null,message:''}),
    pickPatchEdge:(id)=>{
      const s=get();if(!s.patchCreation)return;
      let ids=s.patchCreation.includes(id)?s.patchCreation.filter(x=>x!==id):[...s.patchCreation,id];
      if(ids.length>4){set({message:'最多四条边，请先取消一条。'});return;}
      set({patchCreation:ids});
      if(ids.length<3)return;
      try{const p=addPatch(s.project,ids);s.beginEdit();commit(p);set({patchCreation:[],selectedPatchId:p.patches!.at(-1)!.id,message:'已创建 Patch，可继续选择下一组边。'});}
      catch(e){set({message:ids.length===3&&(e as Error).message.includes('未组成')?'三条尚未闭合，可继续选择第四条。':(e as Error).message});}
    },
    deletePatch:(id)=>{const s=get(),x=s.project.patches?.find(x=>x.id===id);if(!x)return;s.beginEdit();commit({...s.project,patches:s.project.patches!.filter(y=>y.id!==id&&y.id!==x.mirrorPartnerId)});set({selectedPatchId:null});},
    setPatchDisplay:(key,value)=>{if(!Number.isFinite(value))return;commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,[key]:Math.max(0,Math.min(1,value))}});},
    project: initial,
    selectedCurveId: null,
    curveCreation: null,
    startCurve: () =>
      set({
        patchCreation:null,
        curveCreation: { startId: null },
        selectedCurveId: null,
        message: "请选择起点 A，再选择终点 B。",
      }),
    cancelCurve: () => set({ curveCreation: null, message: "" }),
    pickCurveEndpoint: (id) => {
      const s = get();
      if (!s.curveCreation) return;
      if (!s.curveCreation.startId) {
        set({
          curveCreation: { startId: id },
          message: "已选起点 A，请选择终点 B。",
        });
        return;
      }
      try {
        const result = createCurve(
          s.project,
          s.curveCreation.startId,
          id,
          s.project.views.find((v) => v.id === s.viewId)!,
          `结构线 ${s.project.curves.length + 1}`,
        );
        s.beginEdit();
        commit(result.project);
        set({
          selectedCurveId: result.selectedId,
          curveCreation: null,
          message: "已创建直线。拖动曲线弯曲，或调整两个控制柄。",
        });
      } catch (e) {
        set({ message: (e as Error).message });
      }
    },
    selectCurve: (id) => { if(get().patchCreation){get().pickPatchEdge(id);return;} set({selectedPatchId:null, selectedCurveId: id, curveCreation: null, message: "" }); },
    setCurveShape: (id, shape) => {
      if (
        ![
          ...shape.planeNormal,
          shape.startHandle.along,
          shape.startHandle.offset,
          shape.endHandle.along,
          shape.endHandle.offset,
        ].every(Number.isFinite)
      )
        return;
      commit({
        ...get().project,
        curves: get().project.curves.map((c) =>
          c.id === id && c.role === "canonical" ? { ...c, shape } : c,
        ),
      });
    },
    renameCurve: (id, name) => {
      const p = renameCurve(get().project, id, name);
      get().beginEdit();
      commit(p);
    },
    deleteCurve: (id) => {
      get().beginEdit();
      commit(deleteCurve(get().project, id));
      set({ selectedCurveId: null, selectedPatchId:null });
    },
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
      if (get().curveCreation) {
        get().pickCurveEndpoint(id);
        return;
      }
      set({ selectedCurveId: null, selectedPatchId:null });
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
      commit(
        followEndpoints(s.project, {
          ...s.project,
          landmarks: s.project.landmarks.map((x) =>
            x.id === id
              ? { ...x, position }
              : x.id === l.mirrorPartnerId
                ? { ...x, position: mirror(position) }
                : x,
          ),
        }),
      );
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
        selectedCurveId: null,
        curveCreation: null, patchCreation:null,selectedPatchId:null,
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
      commit({...p,patchDisplay:s.project.patchDisplay});
    },
    redo: () => {
      const s = get(),
        p = s.future[0];
      if (!p) return;
      set({
        project: p,
        selectedCurveId: null,
        curveCreation: null, patchCreation:null,selectedPatchId:null,
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
      commit({...p,patchDisplay:s.project.patchDisplay});
    },
    load: (p) => {
      get().beginEdit();
      set({
        project: p,
        selectedCurveId: null,
        curveCreation: null, patchCreation:null,selectedPatchId:null,
        viewId: p.views[0].id,
        selectedId: p.landmarks[0]?.id ?? null,
        referenceMoving: false,
        message: "已载入语义点项目",
      });
      persist(p);
    },
    duplicateSelected: (name, sourceId) => {
      const s = { ...get(), selectedId: sourceId ?? get().selectedId };
      if (!s.selectedId) return;
      const result = duplicateLandmark(s.project, s.selectedId, name);
      s.beginEdit();
      set({
        project: result.project,
        selectedId: result.selectedId,
        selectedCurveId: null,
        message: "已复制；新点立即遵循当前视图锁。",
      });
      persist(result.project);
    },
    renameSelected: (name, sourceId) => {
      const s = { ...get(), selectedId: sourceId ?? get().selectedId };
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
    deleteSelected: (sourceId) => {
      const s = { ...get(), selectedId: sourceId ?? get().selectedId };
      if (!s.selectedId) return;
      const p = prunePatches(deleteLandmark(s.project, s.selectedId));
      s.beginEdit();
      set({
        project: p,
        selectedCurveId: null,
        curveCreation: null,
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
