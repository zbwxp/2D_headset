import {closedBoundary} from '../domain/patches/boundary';
import {customView} from '../domain/landmarks/views';
import {nudgePoint} from '../domain/landmarks/nudge';
import {ensureScaffold,SCAFFOLD_DEFAULTS,HELMET,RING_X,RING_Y,RING_Z,SIDE_R,SIDE_L} from '../domain/head/scaffold';
import {duplicateRing} from '../domain/head/duplicateRing';
import {blockedLoomisEdit,toggleLoomisLock} from '../domain/head/locks';
import {setLoomisOffset} from '../domain/head/offset';
import {addCap,addCapPoint,setCapPoint} from '../domain/head/caps';
import type {Vec3} from '../domain/project/types';
import {addSurfacePoint,setSurfaceDirection} from '../domain/head/surfacePoint';
import {mirroredRegion,sectionPlane,regionMesh,type LoomisRegion} from '../domain/head/regions';
import {createSection,validateSection,sectionFromAngles} from '../domain/curves/section';
import type {LoomisSectionGeometry} from '../domain/curves/model';
import {isSection,isAnalytic} from '../domain/curves/model';
import {migrateHeadFrame,spatialPlacement,mirrorPoint} from '../domain/head/frame';
import type {PatchCreation} from '../ui/patches/authoring';
import {wholeBoundary,boundaryKey,boundaryGeometry,eligibleAnchors,type PatchBoundaryUse} from '../domain/patches/boundary';
import {createAutosave,writeAutosave} from './autosave';
import {dirtyDescendants,deleteClosure} from '../domain/geometry/dependencies';
import {count,timed} from '../domain/geometry/diagnostics';
import {addOnCurvePoint,setOnCurveS} from "../domain/landmarks/placement";
import {GeometryEvaluationContext,pointPosition} from "../domain/geometry/evaluation";
import {repairContinuity,setRelationship,type Relationship} from "../domain/continuity/model";
import {addLoopPatch,orientLoopUses,renamePatch,addPatch,prunePatches,defaultDisplay,patchQualityLevels,type PatchQuality} from "../domain/patches/model";
import {
  addDefaultLandmark,
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
const freshHead=()=>{const p=migrateHeadFrame(createLandmarkProject());return ensureScaffold({...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]});};
let initial = freshHead(),
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
    initial = ensureScaffold(parseLandmarks(saved));
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
  setHeadRadius: (axis:"radiusX"|"radiusY"|"radiusZ",value:number)=>void;
  addOnCurvePoint:(id:string)=>void;
  setOnCurveS:(id:string,s:number)=>void;
  endEdit:()=>void;
  beginDisplayEdit:()=>void;
  selectionTick:number;
  patchCreation: PatchCreation | null;
  setPatchMode:(mode:'whole'|'span'|'loop')=>void;
  createLoopPatch:()=>void;
  completeLensPatch:()=>void;
  flipLoopTraversal:()=>void;
  pickPatchAnchor:(id:string)=>void;
  hoverPatchAnchor:(id:string|undefined)=>void;
  addPatchBoundary:(use:PatchBoundaryUse)=>void;
  removePatchBoundary:(index:number)=>void;
  selectedPatchId: string | null;
  selectPatch: (id:string) => void;
  startPatch: () => void;
  cancelPatch: () => void;
  pickPatchEdge: (id:string) => void;
  deletePatch: (id:string) => void;
  renamePatch: (id:string,name:string) => void;
  setContinuity:(key:string,value:Relationship|undefined)=>void;
  setFullness: (id:string,value:number) => void;
  setPatchQuality: (quality:PatchQuality) => void;
  setPatchVisible: (visible:boolean) => void;
  setPatchDisplay: (key:"opacity2d"|"opacity3d",value:number) => void;
  project: LandmarkProject;
  selectedCurveId: string | null;
  curveCreation: { startId: string | null } | null;
  createLoomisSection:(centerline?:boolean,sidePreset?:boolean)=>void;
  renameLoomisRegion:(id:string,name:string)=>void;
  setSection:(id:string,section:LoomisSectionGeometry)=>void;
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
  beginEdit: (continuous?:boolean) => void;
  addView:(name:string,yaw:number,pitch:number)=>boolean;
  selectView: (id: string) => void;
  selectLandmark: (id: string) => void;
  nudgePoint: (id:string,axis:0|1|2,amount:number)=>void;
  movePoint: (id: string, target: Vec2) => void;
  lockView: () => void;
  setViewLock: (viewId: string, locked: boolean) => void;
  setCanvas: (c: { zoom: number; pan: Vec2 }) => void;
  setReference: (id: string, r: ReferenceImage | undefined) => void;
  createSurfacePoint:(direction:Vec3,centerline?:boolean)=>void;
  setSurfacePoint:(id:string,direction:Vec3)=>void;
  addLoomisRegion:(r:LoomisRegion)=>void;
  deleteLoomisRegion:(id:string)=>void;
  setReferenceMoving: (b: boolean) => void;
  notify: (m: string) => void;
  undo: () => void;
  redo: () => void;
  load: (p: LandmarkProject) => void;
  reset: () => void;
  rename: (n: string) => void;
  closeSection:(id:string)=>void;
  deleteCap:(id:string)=>void;
  createCapPoint:(id:string,u:number,v:number,center?:boolean)=>void;
  setLoomisOffset:(id:string,axis:0|1|2,value:number)=>void;
  setInspectionBackground:(background:NonNullable<LandmarkProject["inspectionBackground"]>)=>void;
  toggleLoomisLock:(id:string)=>void;
  setScaffold:(key:"sidePosition"|"roundness"|"rimSag"|"apexHeight"|"visible",value:number|boolean)=>void;
  duplicateRing:(id:string)=>void;
  setCapPoint:(id:string,u:number,v:number)=>void;
  addDefaultPoint:(centerline:boolean)=>void;
  duplicateSelected: (name: string, sourceId?: string) => void;
  renameSelected: (name: string, sourceId?: string) => void;
  deleteSelected: (sourceId?: string) => void;
  reorderCenterline: (id: string, targetId: string, after: boolean) => void;
}
const autosave=createAutosave(p=>{try{writeAutosave(KEY,p);}catch{useEditor.setState({message:'本机存储已满，请下载 JSON 保存。'});}});
const persist=(p:LandmarkProject)=>autosave.request(p);
if(typeof window!=='undefined'){window.addEventListener('pagehide',()=>autosave.flush());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave.flush();});}
export const useEditor = create<State>((set, get) => {
  let editBase:LandmarkProject|null=null;
  const propagate=(next:LandmarkProject,directCurve?:string)=>{
    const end=timed('dependencyPropagation');const base=editBase??get().project;
    const affected=dirtyDescendants(base,next).curves;
    const curves=next.curves.map(c=>{const old=base.curves.find(x=>x.id===c.id);return affected.has(c.id)&&c.id!==directCurve&&c.role==='canonical'&&old?.role==='canonical'&&!isAnalytic(c)&&!isAnalytic(old)&&c.shape.planeNormal!==old.shape.planeNormal?{...c,shape:{...c.shape,planeNormal:old.shape.planeNormal}}:c;});
    const prepared=curves.some((c,i)=>c!==next.curves[i])?{...next,curves}:next;
    const result=followEndpoints(base,prepared),ctx=new GeometryEvaluationContext(result);
    for(const id of dirtyDescendants(base,result).points)ctx.pointPosition(id);end();return result;
  };
  const commit = (p: LandmarkProject, protect=true) => {if(protect&&blockedLoomisEdit(get().project,p)){get().notify("该操作会修改或删除已锁定的 Loomis 对象，请先解锁。");return;}count('sourceUpdates');const dirty=dirtyDescendants(get().project,p);count('dirtyPoints',dirty.points.size);count('dirtyCurves',dirty.curves.size);count('dirtyPatches',dirty.patches.size);
    p={...prunePatches(p),version:"landmarks-0.5.5"};
    p=repairContinuity(p);
    if(p.loomisRegions)p={...p,loomisRegions:p.loomisRegions.filter(r=>r.cuts.every(c=>p.curves.some(x=>x.id===c.curveId)))};
    set({ project: p,selectedId:p.landmarks.some(l=>l.id===get().selectedId)?get().selectedId:null,selectedCurveId:p.curves.some(c=>c.id===get().selectedCurveId)?get().selectedCurveId:null,selectedPatchId:(get().selectedPatchId===HELMET||p.patches?.some(x=>x.id===get().selectedPatchId))?get().selectedPatchId:null });
    persist(p);
  };
  return {
    setInspectionBackground:inspectionBackground=>{const project={...get().project,inspectionBackground};set({project});persist(project);},
    toggleLoomisLock:id=>{get().beginEdit();commit(toggleLoomisLock(get().project,id));get().endEdit();},
    setScaffold:(key,value)=>{try{const p=get().project;commit(propagate(ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,[key]:value}})));}catch(e){get().notify((e as Error).message);}},
    duplicateRing:id=>{try{const r=duplicateRing(get().project,id);get().beginEdit();commit(r.project);get().endEdit();get().selectCurve(r.selectedId);}catch(e){get().notify((e as Error).message);}},
    closeSection:id=>{try{const p=addCap(get().project,id);get().beginEdit();commit(p);get().endEdit();get().selectCurve(id);}catch(e){get().notify((e as Error).message);}},
    deleteCap:id=>{get().beginEdit();commit(deleteClosure(get().project,[`cap:${id}`]));get().endEdit();},
    createCapPoint:(id,u,v,center=false)=>{try{const r=addCapPoint(get().project,id,u,v,center);get().beginEdit();commit(r.project);get().endEdit();get().selectLandmark(r.selectedId);}catch(e){get().notify((e as Error).message);}},
    setLoomisOffset:(id,axis,value)=>{try{commit(propagate(setLoomisOffset(get().project,id,axis,value)));}catch(e){get().notify((e as Error).message);}},
    setCapPoint:(id,u,v)=>{try{commit(propagate(setCapPoint(get().project,id,u,v)));}catch(e){get().notify((e as Error).message);}},
    createSurfacePoint:(direction,centerline=false)=>{try{const r=addSurfacePoint(get().project,direction,centerline);get().beginEdit();commit(r.project);get().endEdit();set({selectedId:r.selectedId,selectedCurveId:null,selectedPatchId:null,selectionTick:get().selectionTick+1});}catch(e){get().notify((e as Error).message);}},
    setSurfacePoint:(id,direction)=>{try{commit(propagate(setSurfaceDirection(get().project,id,direction)));}catch(e){get().notify((e as Error).message);}},
    addLoomisRegion:r=>{const p=get().project;
      const signature=(r:LoomisRegion)=>JSON.stringify([...new Set(r.cuts.map(c=>{const p1=sectionPlane(p,c.curveId);return [...p1.n.map(x=>x*c.side),p1.d*c.side].map(x=>+x.toFixed(8)).join(',');}))].sort());
      if((p.loomisRegions??[]).some(x=>signature(x)===signature(r)&&regionMesh(p,x)===regionMesh(p,{...x,seed:r.seed}))){get().notify('该球面区域已存在');return;}
      const mirror=mirroredRegion(p,r),regions=[...(p.loomisRegions??[])];
      for(const item of [r,...(mirror?[{...mirror,id:r.id+':mirror'}]:[])])if(!regions.some(x=>signature(x)===signature(item)&&regionMesh(p,x)===regionMesh(p,{...x,seed:item.seed})))regions.push(item);
      if(regions.length===(p.loomisRegions??[]).length){get().notify('该球面区域已存在');return;}
      get().beginEdit();commit({...p,loomisRegions:regions});get().endEdit();get().notify('已建立 Loomis 球面区域');
    },
    renameLoomisRegion:(id,name)=>{name=name.trim();if(!name)return;const base=id.replace(/:mirror$/, '');get().beginEdit();commit({...get().project,loomisRegions:get().project.loomisRegions?.map(r=>r.id===base||r.id===base+':mirror'?{...r,name}:r)});get().endEdit();},
    deleteLoomisRegion:id=>{const base=id.replace(/:mirror$/,'');get().beginEdit();commit({...get().project,loomisRegions:get().project.loomisRegions?.filter(r=>r.id!==base&&r.id!==base+':mirror')});get().endEdit();},
    setHeadRadius:(axis,value)=>{const s=get();if(!Number.isFinite(value)||value<=1e-6)return;if(s.project.lockedViews?.length||s.project.landmarks.some(l=>Object.keys(l.viewLocks).length)){set({message:'调整 Loomis 尺寸前请先 Unlock 视图锁。'});return;}try{const p=migrateHeadFrame(s.project);commit(propagate({...p,headFrame:{...p.headFrame!,[axis]:value}}));}catch(e){set({message:(e as Error).message});}},
    beginDisplayEdit:()=>autosave.begin(),
    endEdit:()=>{editBase=null;autosave.end();},
    addOnCurvePoint:(id)=>{try{const result=addOnCurvePoint(get().project,id);get().beginEdit();commit(result.project);editBase=null;set({selectedId:result.selectedId,selectedCurveId:null,selectedPatchId:null,selectionTick:get().selectionTick+1,message:'已添加结构线定位点，使用在线位置调整。'});}catch(e){set({message:(e as Error).message});}},
    setOnCurveS:(id,value)=>{try{commit(propagate(setOnCurveS(get().project,id,value)));}catch(e){set({message:(e as Error).message});}},
    selectionTick:0, patchCreation:null, selectedPatchId:null,
    selectPatch:(id)=>{if(get().patchCreation || (id!==HELMET&&!get().project.patches?.some(p=>p.id===id)))return;set({selectionTick:get().selectionTick+1,selectedPatchId:id,selectedCurveId:null,selectedId:null,curveCreation:null,message:""});},
    startPatch:()=>set({patchCreation:{mode:'whole',uses:[]},curveCreation:null,selectedCurveId:null,message:'选择 2 / 3 / 4 条边形成闭环；整线或区间均可。'}),
    cancelPatch:()=>{const t=get().patchCreation;set({patchCreation:t?.host?{mode:t.mode,uses:t.uses}:null,message:''});},
    setPatchMode:(mode)=>{const t=get().patchCreation;if(t)set({patchCreation:{mode,uses:(t.mode==='loop')!==(mode==='loop')?[]:t.uses},message:''});},
    completeLensPatch:()=>{const s=get(),t=s.patchCreation;if(!t||t.mode==='loop'||t.uses.length!==2)return;try{const p=addPatch(s.project,t.uses);s.beginEdit();commit(p);s.endEdit();set({patchCreation:{mode:t.mode,uses:[]},selectedPatchId:p.patches!.at(-1)!.id,message:'已生成两边面，可继续绘制。'});}catch(e){set({message:(e as Error).message});}},
    createLoopPatch:()=>{const s=get(),t=s.patchCreation;if(t?.mode!=='loop')return;try{const p=addLoopPatch(s.project,t.uses);s.beginEdit();commit(p);s.endEdit();set({patchCreation:{mode:'loop',uses:[]},selectedPatchId:p.patches!.at(-1)!.id,message:'已创建环形 Patch，可继续选择两条闭合线。'});}catch(e){set({message:(e as Error).message});}},
    flipLoopTraversal:()=>{const t=get().patchCreation;if(t?.mode==='loop'&&t.uses.length===2)set({patchCreation:{...t,uses:[t.uses[0],{...t.uses[1],reversed:!t.uses[1].reversed}]}});},
    removePatchBoundary:(index)=>{const t=get().patchCreation;if(t)set({patchCreation:{...t,uses:t.uses.filter((_,i)=>i!==index)},message:''});},
    hoverPatchAnchor:(id)=>{const t=get().patchCreation;if(t?.host&&t.hover!==id)set({patchCreation:{...t,hover:id}});},
    pickPatchAnchor:(id)=>{
      const s=get(),t=s.patchCreation;if(!t?.host||!eligibleAnchors(s.project,t.host).some(l=>l.id===id))return;
      if(!t.start){set({patchCreation:{...t,start:id,hover:undefined},message:'请选择第二个定位点。'});return;}
      const use={curveId:t.host,startLandmarkId:t.start,endLandmarkId:id};
      try{boundaryGeometry(s.project,use);s.addPatchBoundary(use);}catch(e){set({message:(e as Error).message});}
    },
    pickPatchEdge:(id)=>{
      const s=get(),t=s.patchCreation;if(!t)return;
      if(t.mode==='loop'){
       try{const b=closedBoundary(s.project,id),index=t.uses.findIndex(x=>x.curveId===id);if(index>=0){s.removePatchBoundary(index);return;}
       if(t.uses.length>=2){set({message:'已选择两条闭环，请创建或先取消一条。'});return;}
       const uses=[...t.uses,b];set({patchCreation:{mode:'loop',uses:uses.length===2?orientLoopUses(s.project,uses):uses},message:uses.length===2?'检查对应连线，可翻转第二条环方向，然后创建。':'请选择第二条闭合线。'});
       }catch(e){set({message:(e as Error).message});}return;
      }
      if(t.mode==='span'){if(!t.host)set({patchCreation:{...t,host:id},message:'选择宿主上的两个合法定位点。'});return;}
      if(isSection(s.project.curves.find(c=>c.id===id)!)){set({message:'闭合 Section 请切换到区间模式，选择两个定位点。'});return;}
      const b=wholeBoundary(s.project,id),index=t.uses.findIndex(x=>boundaryKey(s.project,x)===boundaryKey(s.project,b));
      if(index>=0)s.removePatchBoundary(index);else s.addPatchBoundary(b);
    },
    addPatchBoundary:(use)=>{
      const s=get(),t=s.patchCreation;if(!t)return;
      if(t.uses.length>=4){set({message:'最多四条边界，请先取消一条。'});return;}
      if(t.uses.some(b=>boundaryKey(s.project,b)===boundaryKey(s.project,use))){set({message:'该边界已选中。'});return;}
      const uses=[...t.uses,use];set({patchCreation:{mode:t.mode,uses},message:''});if(uses.length<2)return;
      try{const p=addPatch(s.project,uses);s.beginEdit();commit(p);s.endEdit();set({patchCreation:{mode:t.mode,uses:[]},selectedPatchId:p.patches!.at(-1)!.id,message:'已创建 Patch，可继续选择下一组边。'});}
      catch(e){set({message:uses.length===2?'两条边尚未围合，可继续选择第三条。':uses.length===3&&(e as Error).message.includes('未组成')?'三条尚未闭合，可继续选择第四条。':(e as Error).message});}
    },
    renamePatch:(id,name)=>{const s=get(),p=renamePatch(s.project,id,name);s.beginEdit();commit(p);},
    deletePatch:(id)=>{const s=get(),x=s.project.patches?.find(x=>x.id===id);if(!x)return;s.beginEdit();commit({...s.project,patches:s.project.patches!.filter(y=>y.id!==id&&y.id!==x.mirrorPartnerId)});set({selectedPatchId:null});},
    setContinuity:(key,value)=>{try{const p=setRelationship(get().project,key,value);get().beginEdit();commit(p);get().endEdit();}catch(e){set({message:(e as Error).message});}},
    setFullness:(id,value)=>{const p=get().project,x=p.patches?.find(x=>x.id===id);if(!x||!Number.isFinite(value))return;const owner=x.canonicalId??x.id;commit({...p,version:'landmarks-0.4.9.1',patches:p.patches!.map(x=>x.id===owner?{...x,fullness:Math.max(-1,Math.min(1,value))}:x)});},
    setPatchQuality:(quality)=>{if(!Object.hasOwn(patchQualityLevels,quality))return;commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,quality}});},
    setPatchVisible:(visible)=>commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,visible}}),
    setPatchDisplay:(key,value)=>{if(!Number.isFinite(value))return;commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,[key]:Math.max(0,Math.min(1,value))}});},
    project: initial,
    selectedCurveId: null,
    curveCreation: null,
    createLoomisSection:(centerline=false,sidePreset=false)=>{try{const r=createSection(get().project,centerline);if(sidePreset)r.project={...r.project,curves:r.project.curves.map(c=>c.id===r.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:sectionFromAngles(0,90,.25)}:c)};get().beginEdit();commit(r.project);set({selectedCurveId:r.selectedId,selectedPatchId:null,curveCreation:null,selectionTick:get().selectionTick+1});get().endEdit();}catch(e){set({message:(e as Error).message});}},
    setSection:(id,section)=>{try{validateSection(section);const c=get().project.curves.find(c=>c.id===id);if(!c||!isSection(c)||c.role!=='canonical'||c.systemRole||(c.side==='CENTERLINE'&&!c.logicalRing))return;if(c.logicalRing==='COMPOSITE'&&(section.planeNormal.some((v,i)=>v!==c.section.planeNormal[i])||section.reference.some((v,i)=>v!==c.section.reference[i])))return;commit(propagate({...get().project,curves:get().project.curves.map(x=>x.id===id?{...c,section}:x)},id));}catch(e){set({message:(e as Error).message});}},
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
    selectCurve: (id) => { if(get().patchCreation){get().pickPatchEdge(id);return;} set({selectionTick:get().selectionTick+1,selectedPatchId:null, selectedCurveId: id, curveCreation: null, message: "" }); },
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
      try{commit(propagate({
        ...get().project,
        curves: get().project.curves.map((c) =>
          c.id === id && c.role === "canonical" && !isAnalytic(c) ? { ...c, shape } : c,
        ),
      },id));}catch(e){set({message:(e as Error).message});}
    },
    renameCurve: (id, name) => {
      const p = renameCurve(get().project, id, name);
      get().beginEdit();
      commit(p);
    },
    deleteCurve: (id) => {
      if(get().project.curves.some(c=>c.id===id&&isAnalytic(c)&&c.systemRole)){get().notify("系统 Default Ring 不可删除，可复制为用户 Ring。");return;}
      const p=deleteCurve(get().project,id);if(blockedLoomisEdit(get().project,p)){get().notify("该操作会删除已锁定的 Loomis 对象，请先解锁。");return;}
      get().beginEdit();
      commit(p);
      set({ selectedCurveId: null, selectedPatchId:null });
    },
    viewId: initial.views[0].id,
    selectedId: initial.landmarks[0]?.id ?? null,
    past: [],
    future: [],
    message,
    referenceMoving: false,
    beginEdit: (continuous=false) => {if(continuous)autosave.begin();editBase=get().project;
      set((s) => ({
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
        future: [],
      }));},
    addView:(name,yaw,pitch)=>{try{const view=customView(name,yaw,pitch);get().beginEdit();commit({...get().project,views:[...get().project.views,view]});get().endEdit();set({viewId:view.id,referenceMoving:false});return true;}catch(e){get().notify((e as Error).message);return false;}},
    selectView: (id) => set({ viewId: id, referenceMoving: false }),
    selectLandmark: (id) => {
      if(get().patchCreation){get().pickPatchAnchor(id);return;}
      if (get().curveCreation) {
        get().pickCurveEndpoint(id);
        return;
      }
      set({ selectedCurveId: null, selectedPatchId:null });
      if (!get().project.landmarks.some((l) => l.id === id)) return;
      const p = activateDriver(get().project, id);
      set({ selectionTick:get().selectionTick+1, project: p, selectedId: id, message: "" });
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
    nudgePoint:(id,axis,amount)=>{try{commit(propagate(nudgePoint(get().project,id,axis,amount)));}catch(e){get().notify((e as Error).message);}},
    movePoint: (id, target) => {
      const current = get(),
        s = { ...current, project: activateDriver(current.project, id) },
        l = s.project.landmarks.find((l) => l.id === id)!;
      if (!l || (l.placement.kind==="ON_CURVE"||l.placement.kind==="ON_LOOMIS_SURFACE")) return;
      if (!allowedBasis(s.project, id).length) {
        set({ message: "此点被硬约束固定，请解除上方列出的视图锁。" });
        return;
      }
      const v = s.project.views.find((v) => v.id === s.viewId)!,
        old = project(pointPosition(s.project,l.id), v),
        position = dragPosition(s.project, id, v, [
          target[0] - old[0],
          target[1] - old[1],
        ]);
      if (!position.every(Number.isFinite)) return;
      try{commit(
        propagate({
          ...s.project,
          landmarks: s.project.landmarks.map((x) =>
            x.id === id
              ? { ...x, placement:spatialPlacement(s.project,position) }
              : x.id === l.mirrorPartnerId
                ? { ...x, placement:spatialPlacement(s.project,mirrorPoint(s.project,position)) }
                : x,
          ),
        }),
      );}catch(e){set({message:(e as Error).message});}
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
    undo: () => {editBase=null;autosave.end();
      const s = get(),
        p = s.past.at(-1);
      if (!p) return;
      set({
        project: p,
        selectedCurveId: null,
        curveCreation: null, patchCreation:null,selectedPatchId:p.patches?.some(x=>x.id===s.selectedPatchId)?s.selectedPatchId:null,
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
      commit({...p,patchDisplay:s.project.patchDisplay,inspectionBackground:s.project.inspectionBackground},false);
    },
    redo: () => {editBase=null;autosave.end();
      const s = get(),
        p = s.future[0];
      if (!p) return;
      set({
        project: p,
        selectedCurveId: null,
        curveCreation: null, patchCreation:null,selectedPatchId:p.patches?.some(x=>x.id===s.selectedPatchId)?s.selectedPatchId:null,
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
      commit({...p,patchDisplay:s.project.patchDisplay,inspectionBackground:s.project.inspectionBackground},false);
    },
    load: (p) => {p=ensureScaffold(migrateHeadFrame(p));editBase=null;autosave.cancel();
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
    addDefaultPoint:centerline=>{const r=addDefaultLandmark(get().project,centerline);get().beginEdit();commit(r.project);get().endEdit();set({selectedId:r.selectedId,selectedCurveId:null,selectedPatchId:null,curveCreation:null,patchCreation:null,selectionTick:get().selectionTick+1});},
    duplicateSelected: (name, sourceId) => {
      const s = { ...get(), selectedId: sourceId ?? get().selectedId };
      if (!s.selectedId) return;
      const result = duplicateLandmark(s.project, s.selectedId, name);
      s.beginEdit();
      set({
        project: result.project,
        selectedId: result.selectedId,
        selectedCurveId: null,
        message: "已复制语义点。",
        selectedPatchId:null,
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
      if(s.project.landmarks.find(l=>l.id===s.selectedId)?.systemRole){s.notify("系统定位点不可删除。");return;}
      const p = prunePatches(deleteLandmark(s.project, s.selectedId));
      if(blockedLoomisEdit(s.project,p)){s.notify("该操作会删除已锁定的 Loomis 对象，请先解锁。");return;}
      s.beginEdit();
      set({
        project: p,
        selectedCurveId: null,
        selectedPatchId:null,
        curveCreation: null,
        selectedId: p.landmarks[0]?.id ?? null,
        message: p.landmarks.length
          ? "已删除，可撤销恢复。"
          : "所有点已删除，可通过撤销或打开项目恢复。",
      });
      persist(p);
    },
    reset: () => get().load(freshHead()),
    rename: (name) => {
      get().beginEdit();
      commit({ ...get().project, meta: { ...get().project.meta, name } });
    },
  };
});

if(import.meta.env.DEV)(globalThis as typeof globalThis & {__editorPerfStore?:typeof useEditor}).__editorPerfStore=useEditor;
