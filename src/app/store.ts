import {prepareDrawingWorkingCopyTransition} from './drawingWorkingCopies';
import {parseDrawingSnapshots,parseDrawingWorkingCopies} from '../domain/drawing/snapshots';
import {migrateLegacyRecordingScenes} from '../domain/recordingScene/migration';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {syncRecordingSceneSources,remapWorkingSceneSource} from './recordingSceneSources';
import {syncVectorRecordingSources,recordingSourceBaselines,loadKnownRecordingSourceBaselines} from './vectorSourceSync';
import {validateMirrorEditing} from '../domain/drawing/mirrorEditing';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
import {getInitialAutosave,getStorageStatus,markInitialAutosaveUnreadable} from './projectStorage';
import {assertSourceEditable,canEditSource} from './workspaceMode';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import {syncPoseSnapshots} from '../domain/recording/poses';
import {getStarterProject} from './starterProject';
import {createEmptyProject} from './emptyProject';
import {CHIN,ensureChin,parameterRanges,pointId,type ChinArm,type ChinParameters,type ChinSlot} from '../domain/chin/model';
import {bindChinCurve,createChinControl} from '../domain/chin/management';
import {migrateFree3D} from '../domain/curves/free3d';
import {isFree3DShape} from '../domain/curves/model';
import {independentEyeFrames,migrateEyeCoord,moveEyeLocal,setEyeLocal,type EyeCoord} from '../domain/eyes/coord';
import {setOnPatchHandle} from '../domain/curves/onPatch';
import {setPatchPoint} from '../domain/patches/point';
import {addEyeFrontPatches} from '../domain/eyes/frontPatches';
import {createEyeScaffold,rebuildEyeScaffold,eyeSide,type EyeParameters} from '../domain/eyes/scaffold';
import {assignModules,canPickModule,canEditModule,moduleEditAllowed,type GeometryModule} from '../domain/modules/ownership';
import {mergeCurvePoints,mergePointReason} from '../domain/landmarks/merge';
import {nextCurveName,repairCurveNames} from '../domain/curves/naming';
import {isOnPatch} from '../domain/curves/model';
import {addSmoothJoin,setJoinRadius,removeSmoothJoin} from '../domain/curves/smoothJoin/commands';
import {validateJoins,type JoinEndpoint} from '../domain/curves/smoothJoin/model';
import {validateOnPatch} from '../domain/curves/onPatch';
import {dependencyGraph} from '../domain/geometry/dependencies';
import {materializeToolDraft} from '../ui/authoring/draft';
import {normalizeEditorUpdate,validRef,surfaceRef,undoToolStep,type ObjectRef,type ToolSession} from '../ui/authoring/state';
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
import {isSection,isDerived,isClosedSource,isHelmetLoop} from '../domain/curves/model';
import {migrateHeadFrame,spatialPlacement,mirrorPoint} from '../domain/head/frame';
import type {PatchCreation} from '../ui/patches/authoring';
import {wholeBoundary,boundaryKey,boundaryGeometry,eligibleAnchors,type PatchBoundaryUse} from '../domain/patches/boundary';
import {createAutosave,writeAutosave} from './autosave';
import {dirtyDescendants,deleteClosure} from '../domain/geometry/dependencies';
import {count,timed} from '../domain/geometry/diagnostics';
import {addOnCurvePoint,setOnCurveS} from "../domain/landmarks/placement";
import {GeometryEvaluationContext,pointPosition} from "../domain/geometry/evaluation";
import {repairContinuity,relations,setRelationship,type Relationship} from "../domain/continuity/model";
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
import type { CurveShape } from "../domain/curves/model";
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
const freshHead=createEmptyProject;
/** Legacy data is an archive once scenes exist. Compatibility recovery feeds a
 * temporary migration copy; only the new scene becomes the active recording. */
function prepareSceneProject(project:LandmarkProject):LandmarkProject{
 if(project.recordingScenes)return syncRecordingSceneSources(project);
 const compatible=syncVectorRecordingSources(project),migrated=migrateLegacyRecordingScenes(compatible);
 return migrated.recordingScenes?{...migrated,vectorRecording:project.vectorRecording}:compatible;
}
function synchronizeDrawingSources(project:LandmarkProject,before:LandmarkProject){
 return syncRecordingSceneSources(project.recordingScenes?project:syncVectorRecordingSources(project,recordingSourceBaselines(before)),before);
}

let initial = getStarterProject() ?? freshHead(),
  message = "";
try {
  const saved = getStarterProject() ? null : (
    getInitialAutosave() ?? localStorage.getItem(KEY) ??
    localStorage.getItem("contour.landmarks.v038") ??
    localStorage.getItem("contour.landmarks.v036") ??
    localStorage.getItem("contour.landmarks.v035") ??
    localStorage.getItem("contour.landmarks.v03") ??
    localStorage.getItem("contour.landmarks.v02") ??
    localStorage.getItem("contour.landmarks.v01"));
  if (saved) {
    initial = prepareSceneProject(ensureScaffold(parseLandmarks(saved)));
    // Persist migration/repair immediately, before any user interaction.
    void writeAutosave(KEY,initial).catch(()=>useEditor.getState().notify('自动保存失败；修改仍保留在本页，请保存 JSON 并保持页面打开。'));
  } else {
    const old = getStarterProject() ? null : localStorage.getItem("contour.project.v1");
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
    // Keep even an untouched new project identity stable across reloads.
    void writeAutosave(KEY,initial).catch(()=>useEditor.getState().notify('自动保存失败；修改仍保留在本页，请保存 JSON 并保持页面打开。'));
  }
} catch {
  if(getInitialAutosave()!==undefined)markInitialAutosaveUnreadable();
  message = "自动保存无法读取，已打开新语义点项目；原存储未删除。";
}
interface State {
  setRecordingScenes:(value:import("../domain/recordingScene/model").RecordingScenes)=>void;
  commitRecordingScenes:(value:import("../domain/recordingScene/model").RecordingScenes)=>void;
  commitArtworkCleanup:(expected:LandmarkProject,next:LandmarkProject)=>void;
  setVectorRecording:(recording:import("../domain/vectorRecording/model").VectorRecording)=>void;
  commitVectorRecording:(recording:import("../domain/vectorRecording/model").VectorRecording)=>void;
  setAssembly:(assembly:import("../domain/assembly/model").AssemblyDocument)=>void;
  setHairstyle:(hairstyle:import("../domain/hairstyle/model").Hairstyle)=>void;
  setDrawing:(drawing:import("../domain/drawing/model").DrawingDocument)=>void;
  recoverVectorRecordingSource:(load?:()=>Promise<import("../domain/drawing/model").DrawingDocument[]>)=>Promise<boolean>;
  setDrawingSnapshotState:(state:import("../domain/drawing/snapshots").DrawingSnapshotState)=>void;
  setPoseRecording:(recording:import("../domain/recording/poses").PoseRecording)=>void;
  renameCap:(id:string,name:string)=>void;
  setGazeTracking:(enabled:boolean)=>void;createGaze:()=>void;setGazeParameter:(key:'irisScale'|'recessDepth'|'viewDistance'|'followStrength',value:number)=>void;
  createChin:()=>void;
  setChinRange:(arm:ChinArm,value:number)=>void;
  setChinParameter:(key:keyof ChinParameters,value:number)=>void;
  setChinVisible:(visible:boolean)=>void;
  bindChin:(slot:ChinSlot,id?:string)=>void;
  editChinSeam:(slot:ChinSlot)=>void;
  setHeadPerspective:(axis:'x'|'y',value:number)=>void;
  setEyePerspective:(axis:'x'|'y',value:number)=>void;
  addEyeFrontSurfaces:()=>void;
  upgradeEyes:()=>void;setEyeLocal:(id:string,v:Vec3)=>void;setEyeOrientation:(value:Vec3)=>void;setEyeCoord:(key:'position'|'width'|'height'|'tilt'|'orientation',value:number|Vec3)=>void;createEyes:()=>void;setEyeParameter:(side:'left'|'right',key:keyof EyeParameters,value:number)=>void;
  activeModule:GeometryModule;setActiveModule:(module:GeometryModule)=>void;
  selection:ObjectRef|null; tool:ToolSession;
  selectObject:(ref:ObjectRef|null)=>void;
  setContourRole:(id:string,role:'NONE'|'OPEN_EDGE')=>void;
  commitToolDraft:()=>void; setTool:(tool:ToolSession)=>void; cancelTool:()=>void; undoToolStep:()=>void;
  setHeadRadius: (axis:"radiusX"|"radiusY"|"radiusZ",value:number)=>void;
  addOnCurvePoint:(id:string)=>void;
  startPointMerge:(keepId?:string)=>void;
  pickMergePoint:(id:string)=>void;
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
  addSmoothJoin:(pointId:string,a:JoinEndpoint,b:JoinEndpoint,radius:number)=>void;
  setJoinRadius:(id:string,value:number)=>void;
  removeSmoothJoin:(id:string)=>void;
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
  setCurveShape: (canonicalId: string, shape: CurveShape) => void;
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
  updateView:(id:string,name:string,yaw:number,pitch:number)=>boolean;
  deleteView:(id:string)=>void;
  selectView: (id: string) => void;
  selectLandmark: (id: string) => void;
  nudgePoint: (id:string,axis:0|1|2,amount:number)=>void;
  movePoint: (id: string, target: Vec2) => void;
  lockView: () => void;
  setViewLock: (viewId: string, locked: boolean) => void;
  setCanvas: (c: { zoom: number; pan: Vec2 }, viewId?:string) => void;
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
  setScaffold:(key:"horizontalOffset"|"sideTilt"|"sidePosition"|"roundness"|"rimSag"|"apexHeight"|"visible",value:number|boolean)=>void;
  duplicateRing:(id:string)=>void;
  setCapPoint:(id:string,u:number,v:number)=>void;
  setPatchPoint:(id:string,u:number,v:number)=>void;
  setOnPatchHandle:(id:string,index:0|1,uv:[number,number])=>void;
  addDefaultPoint:(centerline:boolean)=>void;
  duplicateSelected: (name: string, sourceId?: string) => void;
  renameSelected: (name: string, sourceId?: string) => void;
  deleteSelected: (sourceId?: string) => void;
  reorderCenterline: (id: string, targetId: string, after: boolean) => void;
}
const autosave=createAutosave(p=>{void writeAutosave(KEY,p).catch(()=>useEditor.setState({message:'自动保存失败；修改仍保留在本页，请保存 JSON 并保持页面打开。'}));});
const persist=(p:LandmarkProject)=>autosave.request(p);
if(typeof window!=='undefined'){window.addEventListener('beforeunload',e=>{autosave.flush();const state=getStorageStatus().state;if(state==='saving'||state==='error'){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>autosave.flush());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave.flush();});}
export const useEditor = create<State>((rawSet, get, api) => {
  const set:typeof rawSet=(update:any)=>rawSet(normalizeEditorUpdate(get(),typeof update==="function"?update(get()):update),true);
  api.setState=set;
  let editBase:LandmarkProject|null=null;
  const propagate=(next:LandmarkProject,directCurve?:string)=>{
    const end=timed('dependencyPropagation');const base=editBase??get().project;
    const affected=dirtyDescendants(base,next).curves;
    const curves=next.curves.map(c=>{const old=base.curves.find(x=>x.id===c.id);return affected.has(c.id)&&c.id!==directCurve&&c.role==='canonical'&&old?.role==='canonical'&&!isDerived(c)&&!isDerived(old)&&!isFree3DShape(c.shape)&&!isFree3DShape(old.shape)&&c.shape.planeNormal!==old.shape.planeNormal?{...c,shape:{...c.shape,planeNormal:old.shape.planeNormal}}:c;});
    const prepared=curves.some((c,i)=>c!==next.curves[i])?{...next,curves}:next;
    const result=followEndpoints(base,prepared),ctx=new GeometryEvaluationContext(result);
    for(const id of dirtyDescendants(base,result).points)ctx.pointPosition(id);end();return result;
  };
  const commit = (p: LandmarkProject, protect=true) => {if(protect&&!moduleEditAllowed(get().project,p,get().activeModule)){get().notify('其它模块的对象仅供参考，不能编辑。');return;}if(p.eyeScaffold&&(p.eyeScaffold!==get().project.eyeScaffold||p.headFrame!==get().project.headFrame))p=rebuildEyeScaffold(p);p=assignModules(p,get().project,get().activeModule);if(protect&&blockedLoomisEdit(get().project,p)){get().notify("该操作会修改或删除已锁定的 Loomis 对象，请先解锁。");return;}validateJoins(p);dependencyGraph(p);if(p.curves.some(isOnPatch)||p.curveSmoothJoins?.length||get().project.curveSmoothJoins?.length)p=followEndpoints(editBase??get().project,p);validateOnPatch(p);count('sourceUpdates');const dirty=dirtyDescendants(get().project,p);count('dirtyPoints',dirty.points.size);count('dirtyCurves',dirty.curves.size);count('dirtyPatches',dirty.patches.size);
    p={...prunePatches(p),version:p.chinScaffold?.version===3?'landmarks-0.9.7':p.chinScaffold?'landmarks-0.9.5':p.curves.some(isHelmetLoop)?'landmarks-0.9.3':p.curves.some(c=>c.role==='canonical'&&!isDerived(c)&&isFree3DShape(c.shape))?'landmarks-0.9.2':p.curveSmoothJoins!==undefined?"landmarks-0.6.3":"landmarks-0.5.5"};
    p=repairContinuity(p);
    if(p.loomisRegions)p={...p,loomisRegions:p.loomisRegions.filter(r=>r.cuts.every(c=>p.curves.some(x=>x.id===c.curveId)))};
    set({project:p});
    persist(p);
  };
  return normalizeEditorUpdate(undefined,{
    commitArtworkCleanup:(expected,next)=>{
      assertSourceEditable();if(get().project!==expected)throw Error('工程在预览后已变更，请重新检查整理清单。');
      const allowed=new Set(['drawing','drawingSnapshots','drawingWorkingCopies','recordingScenes','vectorRecording']);
      if(Object.keys({...expected,...next}).some(key=>!allowed.has(key)&&(expected as any)[key]!== (next as any)[key]))throw Error('整理只能归档配件库和对应旧录制，不可修改画布。');
      if(next.drawing){assertDisplayRouteSupport(next.drawing);validateMirrorEditing(next.drawing);}
      if(next.drawingSnapshots)parseDrawingSnapshots(next.drawingSnapshots);
      if(next.drawingWorkingCopies)parseDrawingWorkingCopies(next.drawingWorkingCopies,next.drawingSnapshots);
      if(next.recordingScenes)parseRecordingScenes(next.recordingScenes);
      if(next.vectorRecording)parseVectorRecording(next.vectorRecording);
      if(next===expected)return;get().beginEdit();try{set({project:next});persist(next);}finally{get().endEdit();}
    },
    setRecordingScenes:(recordingScenes)=>{const before=get().project,next={...before,recordingScenes},p=recordingScenes.scenes.some(scene=>scene.instances.some(instance=>!instance.sourceSignature))?syncRecordingSceneSources(next,before):next;set({project:p});persist(p);},
    commitRecordingScenes:(value)=>{const recordingScenes=parseRecordingScenes(value);get().beginEdit();try{get().setRecordingScenes(recordingScenes);}finally{get().endEdit();}},
    setVectorRecording:(vectorRecording)=>{const p={...get().project,vectorRecording};set({project:p});persist(p);},
    commitVectorRecording:(value)=>{const vectorRecording=parseVectorRecording(value);get().beginEdit();try{get().setVectorRecording(vectorRecording);}finally{get().endEdit();}},
    setPoseRecording:(poseRecording)=>{const {recording,...rest}=get().project;void recording;const p={...rest,poseRecording:syncPoseSnapshots(poseRecording,rest.drawingSnapshots)};set({project:p});persist(p);},
    setAssembly:(assembly)=>{const {hairstyle,...rest}=get().project;void hairstyle;const p={...rest,assembly};set({project:p});persist(p);},
    setHairstyle:(hairstyle)=>{const p={...get().project,hairstyle};set({project:p});persist(p);},
    setDrawing:(drawing)=>{assertSourceEditable();const before=get().project;drawing=finalizeGeometryEdit(before.drawing,drawing);assertDisplayRouteSupport(drawing);validateMirrorEditing(drawing);const next=prepareDrawingWorkingCopyTransition(before,{drawing,drawingSnapshots:before.drawingSnapshots}).state,p=synchronizeDrawingSources({...before,...next},before);set({project:p});persist(p);},
    recoverVectorRecordingSource:async(load=loadKnownRecordingSourceBaselines)=>{
      const before=get().project;if(before.recordingScenes)return false;const history=get().past.flatMap(recordingSourceBaselines),known=syncVectorRecordingSources(before,history);
      if(known!==before){set({project:known});persist(known);return true;}
      if(!before.vectorRecording)return false;
      const sources=await load();if(get().project!==before)return false;
      const next=syncVectorRecordingSources(before,sources);if(next===before)return false;
      set({project:next});persist(next);return true;
    },
    setDrawingSnapshotState:(incoming)=>{assertSourceEditable();const current=get().project,prepared=prepareDrawingWorkingCopyTransition(current,incoming),{drawing,drawingSnapshots,drawingWorkingCopies}=prepared.state,promotion=prepared.promotedWorkingArtworkId;if(drawing){assertDisplayRouteSupport(drawing);validateMirrorEditing(drawing);}const vectorRecording=promotion&&current.vectorRecording?{...current.vectorRecording,rigs:current.vectorRecording.rigs.map(r=>r.artworkId==='$working'?{...r,artworkId:promotion}:r)}:current.vectorRecording;
      const p=synchronizeDrawingSources({...current,drawing,drawingSnapshots,drawingWorkingCopies,...(vectorRecording?{vectorRecording}:{}),...(promotion&&current.recordingScenes?{recordingScenes:remapWorkingSceneSource(current.recordingScenes,promotion)}:{}),...(current.poseRecording?{poseRecording:syncPoseSnapshots(syncPoseSnapshots(current.poseRecording,current.drawingSnapshots),drawingSnapshots)}:{})},current);set({project:p});persist(p);},
    setGazeTracking:(tracking)=>{const s=get(),g=s.project.gazeEyeball;if(s.activeModule!=='EYES'||!g)return;s.beginEdit();commit({...s.project,gazeEyeball:{...g,tracking}});s.endEdit();},
    createGaze:()=>{const s=get();if(s.activeModule!=='EYES'||!s.project.eyeScaffold||s.project.gazeEyeball)return;s.beginEdit();const g={version:1 as const,leftId:crypto.randomUUID(),rightId:crypto.randomUUID(),irisScale:.3,recessDepth:.12,tracking:false};commit({...s.project,gazeEyeball:g});s.endEdit();s.selectObject({kind:'surface',source:'IRIS',id:g.rightId});},
    setGazeParameter:(key,value)=>{const s=get(),g=s.project.gazeEyeball;if(s.activeModule!=='EYES'||!g||!Number.isFinite(value))return;const [lo,hi]=key==='followStrength'?[0,1]:key==='viewDistance'?[10,200]:key==='irisScale'?[.05,.95]:[0,.5];commit({...s.project,gazeEyeball:{...g,[key]:Math.max(lo,Math.min(hi,value))}});},
    addEyeFrontSurfaces:()=>{const s=get();if(s.activeModule!=='EYES')return;try{const p=addEyeFrontPatches(s.project);if(p===s.project)return;s.beginEdit();commit(p);s.endEdit();}catch(e){s.notify((e as Error).message);}},
    createEyes:()=>{const s=get();if(s.activeModule!=='EYES'||s.project.eyeScaffold)return;s.beginEdit();commit(rebuildEyeScaffold(migrateEyeCoord(createEyeScaffold(s.project))));s.endEdit();},
    createChin:()=>{const s=get();if(s.activeModule!=='HEADSET'||s.project.chinScaffold)return;try{const p=ensureChin(s.project);s.beginEdit();commit(p);s.endEdit();s.selectObject({kind:'point',id:pointId('CHIN_M')});}catch(e){s.notify((e as Error).message);}},
    setChinRange:(arm,value)=>{const s=get(),c=s.project.chinScaffold;if(s.activeModule!=='HEADSET'||c?.version!==3||!c.ranges||!Number.isFinite(value))return;try{commit(propagate({...s.project,chinScaffold:{...c,ranges:{...c.ranges,[arm]:Math.max(.01,Math.min(.1,value))}}}));}catch(e){s.notify((e as Error).message);}},
    setChinParameter:(key,value)=>{const s=get(),c=s.project.chinScaffold;if(s.activeModule!=='HEADSET'||!c||!Number.isFinite(value))return;const [lo,hi]=c.version===3&&(key==='y'||key==='z')?[-2,2]:parameterRanges[key];try{commit(propagate({...s.project,chinScaffold:{...c,parameters:{...c.parameters,[key]:Math.max(lo,Math.min(hi,value))}}}));}catch(e){s.notify((e as Error).message);}},
    setChinVisible:visible=>{const s=get(),c=s.project.chinScaffold;if(!c||s.activeModule!=='HEADSET')return;s.beginEdit();commit({...s.project,chinScaffold:{...c,visible}});s.endEdit();},
    bindChin:(slot,id)=>{const s=get();if(s.activeModule!=='HEADSET')return;try{const p=bindChinCurve(s.project,slot,id);s.beginEdit();commit(p);s.endEdit();}catch(e){s.notify((e as Error).message);}},
    editChinSeam:slot=>{const s=get();if(s.activeModule!=='HEADSET')return;try{const r=createChinControl(s.project,slot);if(r.project!==s.project){s.beginEdit();commit(r.project);s.endEdit();}s.selectCurve(r.selectedId);}catch(e){s.notify((e as Error).message);}},
    setHeadPerspective:(axis,value)=>{if(get().activeModule!=='HEADSET'||!Number.isFinite(value))return;commit({...get().project,headPerspective:{x:0,y:0,...get().project.headPerspective,[axis]:Math.max(0,Math.min(1,value))}});},
    setEyePerspective:(axis,value)=>{const s=get(),e=s.project.eyeScaffold;if(s.activeModule!=='EYES'||!e||!Number.isFinite(value))return;commit({...s.project,eyeScaffold:{...e,perspective:{x:e.perspective?.x??0,y:e.perspective?.y??0,[axis]:Math.max(0,Math.min(1,value))}}});},
    upgradeEyes:()=>{const s=get();if(s.activeModule!=='EYES')return;s.beginEdit();commit(rebuildEyeScaffold(migrateEyeCoord(s.project)),false);s.endEdit();},
    setEyeLocal:(id,v)=>{const s=get();if(s.activeModule==='EYES')commit(propagate(setEyeLocal(s.project,id,v)));},
    setEyeOrientation:value=>{const s=get(),p=independentEyeFrames(s.project),e=p.eyeScaffold;if(s.activeModule!=='EYES'||!e||!value.every(Number.isFinite))return;commit(propagate(rebuildEyeScaffold({...p,eyeScaffold:{...e,ballOrientation:value}})));},
    setEyeCoord:(key,value)=>{const s=get(),p=independentEyeFrames(s.project),e=p.eyeScaffold;if(s.activeModule!=='EYES'||!e?.coord)return;const coord={...e.coord,[key]:value} as EyeCoord;if(![coord.width,coord.height,coord.tilt,...coord.orientation,...(coord.position??[])].every(Number.isFinite)||coord.width<=0||coord.height<=0)return;commit(propagate(rebuildEyeScaffold({...s.project,eyeScaffold:{...e,coord}})));},
    setEyeParameter:(_side,key,value)=>{const s=get(),p=independentEyeFrames(s.project),e=p.eyeScaffold;if(s.activeModule!=='EYES'||!e||!Number.isFinite(value)||(key==='x'&&value<0)||(!['x','y','z','ballOffsetX'].includes(key)&&value<=.001))return;commit(propagate(rebuildEyeScaffold({...s.project,eyeScaffold:{...e,parameters:{...e.parameters,[key]:value}}})));},
    activeModule:'HEADSET',setActiveModule:activeModule=>{get().endEdit();set({activeModule,selection:null,tool:{kind:'select'},message:''});},
    selection:null,tool:{kind:"select"},
    selectObject:(ref:ObjectRef|null)=>{if(get().tool.kind==='mergePoint'){if(ref?.kind==='point')get().pickMergePoint(ref.id);return;}if(validRef(get().project,ref)&&(!ref||canPickModule(get().project,ref.id,get().activeModule))){const tool=get().tool;set({selection:ref,selectionTick:get().selectionTick+1,...(tool.kind==='onPatch'&&!tool.hostId&&ref?.kind==='surface'&&ref.source==='PATCH'?{tool:{...tool,hostId:ref.id}}:{})});}},
    setTool:(tool:ToolSession)=>{get().endEdit();set({tool,message:""});},
    setContourRole:(id,role)=>{if(!canEditModule(get().project,id,get().activeModule))return;const s=get(),c=s.project.curves.find(c=>c.id===id);if(!c)return;s.beginEdit();commit({...s.project,curves:s.project.curves.map(x=>x.id===id||x.id===c.mirrorPartnerCurveId?{...x,contourRole:role}:x)});s.endEdit();},
    commitToolDraft:()=>{const draft=get().tool.draft;if(!draft)return;try{const p=materializeToolDraft(get().project,draft);dependencyGraph(p);validateOnPatch(p);get().beginEdit();commit(p);get().endEdit();set({tool:{kind:'select'}});}catch(e){get().notify((e as Error).message);}},
    cancelTool:()=>{get().endEdit();set({tool:{kind:"select"},message:""});},
    undoToolStep:()=>set({tool:undoToolStep(get().tool),message:""}),
    renameCap:(id,name)=>{if(!canEditModule(get().project,id,get().activeModule))return;name=name.trim();if(!name||name.length>80)return;const cap=get().project.loomisCaps?.find(c=>c.id===id);if(!cap)return;const partner=get().project.curves.find(c=>c.id===cap.hostSectionCurveId)?.mirrorPartnerCurveId;get().beginEdit();commit({...get().project,loomisCaps:get().project.loomisCaps?.map(c=>c.id===id||c.hostSectionCurveId===partner?{...c,name}:c)});get().endEdit();},
    setInspectionBackground:inspectionBackground=>{const project={...get().project,inspectionBackground};set({project});persist(project);},
    toggleLoomisLock:id=>{get().beginEdit();commit(toggleLoomisLock(get().project,id));get().endEdit();},
    setScaffold:(key,value)=>{if(get().activeModule!=='HEADSET')return;try{const p=get().project;commit(propagate(ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,[key]:value}})));}catch(e){get().notify((e as Error).message);}},
    duplicateRing:id=>{if(!canPickModule(get().project,id,get().activeModule))return;try{const r=duplicateRing(get().project,id);get().beginEdit();commit(r.project);get().endEdit();get().selectCurve(r.selectedId);}catch(e){get().notify((e as Error).message);}},
    closeSection:id=>{if(!canPickModule(get().project,id,get().activeModule))return;try{const p=addCap(get().project,id);get().beginEdit();commit(p);get().endEdit();get().selectCurve(id);}catch(e){get().notify((e as Error).message);}},
    deleteCap:id=>{if(!canEditModule(get().project,id,get().activeModule))return;get().beginEdit();commit(deleteClosure(get().project,[`cap:${id}`]));get().endEdit();},
    createCapPoint:(id,u,v,center=false)=>{if(!canPickModule(get().project,id,get().activeModule))return;try{const r=addCapPoint(get().project,id,u,v,center);get().beginEdit();commit(r.project);get().endEdit();get().selectLandmark(r.selectedId);}catch(e){get().notify((e as Error).message);}},
    setLoomisOffset:(id,axis,value)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setLoomisOffset(get().project,id,axis,value)));}catch(e){get().notify((e as Error).message);}},
    setOnPatchHandle:(id,index,uv)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setOnPatchHandle(get().project,id,index,uv)));}catch(e){get().notify((e as Error).message);}},
    setPatchPoint:(id,u,v)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setPatchPoint(get().project,id,u,v)));}catch(e){get().notify((e as Error).message);}},
    setCapPoint:(id,u,v)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setCapPoint(get().project,id,u,v)));}catch(e){get().notify((e as Error).message);}},
    createSurfacePoint:(direction,centerline=false)=>{try{const r=addSurfacePoint(get().project,direction,centerline);get().beginEdit();commit(r.project);get().endEdit();set({selectedId:r.selectedId,selectedCurveId:null,selectedPatchId:null,selectionTick:get().selectionTick+1});}catch(e){get().notify((e as Error).message);}},
    setSurfacePoint:(id,direction)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setSurfaceDirection(get().project,id,direction)));}catch(e){get().notify((e as Error).message);}},
    addLoomisRegion:r=>{const p=get().project;
      const signature=(r:LoomisRegion)=>JSON.stringify([...new Set(r.cuts.map(c=>{const p1=sectionPlane(p,c.curveId);return [...p1.n.map(x=>x*c.side),p1.d*c.side].map(x=>+x.toFixed(8)).join(',');}))].sort());
      if((p.loomisRegions??[]).some(x=>signature(x)===signature(r)&&regionMesh(p,x)===regionMesh(p,{...x,seed:r.seed}))){get().notify('该球面区域已存在');return;}
      const mirror=mirroredRegion(p,r),regions=[...(p.loomisRegions??[])];
      for(const item of [r,...(mirror?[{...mirror,id:r.id+':mirror'}]:[])])if(!regions.some(x=>signature(x)===signature(item)&&regionMesh(p,x)===regionMesh(p,{...x,seed:item.seed})))regions.push(item);
      if(regions.length===(p.loomisRegions??[]).length){get().notify('该球面区域已存在');return;}
      get().beginEdit();commit({...p,loomisRegions:regions});get().endEdit();get().notify('已建立 Loomis 球面区域');
    },
    renameLoomisRegion:(id,name)=>{if(!canEditModule(get().project,id,get().activeModule))return;name=name.trim();if(!name)return;const base=id.replace(/:mirror$/, '');get().beginEdit();commit({...get().project,loomisRegions:get().project.loomisRegions?.map(r=>r.id===base||r.id===base+':mirror'?{...r,name}:r)});get().endEdit();},
    deleteLoomisRegion:id=>{if(!canEditModule(get().project,id,get().activeModule))return;const base=id.replace(/:mirror$/,'');get().beginEdit();commit({...get().project,loomisRegions:get().project.loomisRegions?.filter(r=>r.id!==base&&r.id!==base+':mirror')});get().endEdit();},
    setHeadRadius:(axis,value)=>{if(get().activeModule!=='HEADSET')return;const s=get();if(!Number.isFinite(value)||value<=1e-6)return;if(s.project.lockedViews?.length||s.project.landmarks.some(l=>Object.keys(l.viewLocks).length)){set({message:'调整 Loomis 尺寸前请先 Unlock 视图锁。'});return;}try{const p=migrateHeadFrame(s.project);commit(propagate({...p,headFrame:{...p.headFrame!,[axis]:value}}));}catch(e){set({message:(e as Error).message});}},
    beginDisplayEdit:()=>autosave.begin(),
    endEdit:()=>{editBase=null;autosave.end();},
    startPointMerge:keepId=>{get().setTool({kind:'mergePoint'});if(keepId)get().pickMergePoint(keepId);},
    pickMergePoint:id=>{
      const s=get(),t=s.tool;if(t.kind!=='mergePoint')return;
      try{
        if(!canEditModule(s.project,id,s.activeModule))throw Error('其它模块的对象仅供参考，不能编辑。');
        const reason=mergePointReason(s.project,id);if(reason)throw Error(reason);
        if(!t.keepId){set({tool:{kind:'mergePoint',keepId:id},selection:{kind:'point',id},selectionTick:s.selectionTick+1,message:''});return;}
        const next=mergeCurvePoints(s.project,t.keepId,id);
        if(!moduleEditAllowed(s.project,next,s.activeModule))throw Error('其它模块的对象仅供参考，不能编辑。');
        s.beginEdit();commit(next);s.endEdit();
        set({tool:{kind:'select'},selection:{kind:'point',id:t.keepId},selectionTick:s.selectionTick+1,message:'定位点已合并，相连曲线已接到保留点；可撤销。'});
      }catch(e){get().notify((e as Error).message);}
    },
    addOnCurvePoint:(id)=>{if(!canPickModule(get().project,id,get().activeModule))return;try{const result=addOnCurvePoint(get().project,id);get().beginEdit();commit(result.project);editBase=null;set({selectedId:result.selectedId,selectedCurveId:null,selectedPatchId:null,selectionTick:get().selectionTick+1,message:'已添加结构线定位点，使用在线位置调整。'});}catch(e){set({message:(e as Error).message});}},
    setOnCurveS:(id,value)=>{if(!canEditModule(get().project,id,get().activeModule))return;try{commit(propagate(setOnCurveS(get().project,id,value)));}catch(e){set({message:(e as Error).message});}},
    selectionTick:0, patchCreation:null, selectedPatchId:null,
    selectPatch:(id)=>get().selectObject(surfaceRef(get().project,id)),
    startPatch:()=>set({patchCreation:{mode:'whole',uses:[]},curveCreation:null,selectedCurveId:null,message:'选择 2 / 3 / 4 条边形成闭环；整线或区间均可。'}),
    cancelPatch:()=>get().cancelTool(),
    setPatchMode:(mode)=>{const t=get().patchCreation;if(t)set({patchCreation:{mode,uses:(t.mode==='loop')!==(mode==='loop')?[]:t.uses},message:''});},
    completeLensPatch:()=>{const s=get(),t=s.patchCreation;if(!t||t.mode==='loop'||t.uses.length!==2)return;try{const p=addPatch(s.project,t.uses);s.beginEdit();commit(p);s.endEdit();set({patchCreation:{mode:t.mode,uses:[]},selectedPatchId:p.patches!.at(-1)!.id,message:'已生成两边面，可继续绘制。'});}catch(e){set({message:(e as Error).message});}},
    createLoopPatch:()=>{const s=get(),t=s.patchCreation;if(t?.mode!=='loop')return;try{const p=addLoopPatch(s.project,t.uses);s.beginEdit();commit(p);s.endEdit();set({patchCreation:{mode:'loop',uses:[]},selectedPatchId:p.patches!.at(-1)!.id,message:'已创建环形 Patch，可继续选择两条闭合线。'});}catch(e){set({message:(e as Error).message});}},
    flipLoopTraversal:()=>{const t=get().patchCreation;if(t?.mode==='loop'&&t.uses.length===2)set({patchCreation:{...t,uses:[t.uses[0],{...t.uses[1],reversed:!t.uses[1].reversed}]}});},
    removePatchBoundary:(index)=>{const t=get().patchCreation;if(t)set({patchCreation:{...t,uses:t.uses.filter((_,i)=>i!==index)},message:''});},
    hoverPatchAnchor:(id)=>{const t=get().patchCreation;if(t?.host&&t.hover!==id)set({patchCreation:{...t,hover:id}});},
    pickPatchAnchor:(id)=>{if(!canPickModule(get().project,id,get().activeModule))return;
      const s=get(),t=s.patchCreation;if(!t?.host||!eligibleAnchors(s.project,t.host).some(l=>l.id===id))return;
      if(!t.start){set({patchCreation:{...t,start:id,hover:undefined},message:'请选择第二个定位点。'});return;}
      const use={curveId:t.host,startLandmarkId:t.start,endLandmarkId:id};
      try{boundaryGeometry(s.project,use);s.addPatchBoundary(use);}catch(e){set({message:(e as Error).message});}
    },
    pickPatchEdge:(id)=>{if(!canPickModule(get().project,id,get().activeModule))return;
      const s=get(),t=s.patchCreation;if(!t)return;
      if(t.mode==='loop'){
       try{const b=closedBoundary(s.project,id),index=t.uses.findIndex(x=>x.curveId===id);if(index>=0){s.removePatchBoundary(index);return;}
       if(t.uses.length>=2){set({message:'已选择两条闭环，请创建或先取消一条。'});return;}
       const uses=[...t.uses,b];set({patchCreation:{mode:'loop',uses:uses.length===2?orientLoopUses(s.project,uses):uses},message:uses.length===2?'检查对应连线，可翻转第二条环方向，然后创建。':'请选择第二条闭合线。'});
       }catch(e){set({message:(e as Error).message});}return;
      }
      if(t.mode==='span'){if(!t.host)set({patchCreation:{...t,host:id},message:'选择宿主上的两个合法定位点。'});return;}
      if(isClosedSource(s.project.curves.find(c=>c.id===id)!)){set({message:'闭合曲线请切换到区间模式，选择两个定位点。'});return;}
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
    renamePatch:(id,name)=>{if(!canEditModule(get().project,id,get().activeModule))return;const s=get(),p=renamePatch(s.project,id,name);s.beginEdit();commit(p);},
    deletePatch:(id)=>{if(!canEditModule(get().project,id,get().activeModule))return;const s=get(),x=s.project.patches?.find(x=>x.id===id);if(!x)return;s.beginEdit();commit(deleteClosure(s.project,[`patch:${id}`]));set({selectedPatchId:null});},
    setContinuity:(key,value)=>{if(relations(get().project).find(r=>r.key===key)?.patchIds.some(id=>!canEditModule(get().project,id,get().activeModule)))return;try{const p=setRelationship(get().project,key,value);get().beginEdit();commit(p);get().endEdit();}catch(e){set({message:(e as Error).message});}},
    addSmoothJoin:(pointId,a,b,radius)=>{try{const p=addSmoothJoin(get().project,pointId,a,b,radius);get().beginEdit();try{commit(p);}finally{get().endEdit();}}catch(e){get().notify((e as Error).message);}},
    removeSmoothJoin:id=>{get().beginEdit();try{commit(removeSmoothJoin(get().project,id));}catch(e){get().notify((e as Error).message);}finally{get().endEdit();}},
    setJoinRadius:(id,value)=>{try{commit(setJoinRadius(get().project,id,value));}catch(e){get().notify((e as Error).message);}},
    setFullness:(id,value)=>{try{const p=get().project,x=p.patches?.find(x=>x.id===id);if(!x||!Number.isFinite(value))return;const owner=x.canonicalId??x.id;commit({...p,version:'landmarks-0.4.9.1',patches:p.patches!.map(x=>x.id===owner?{...x,fullness:Math.max(-1,Math.min(1,value))}:x)});}catch(e){get().notify((e as Error).message);}},
    setPatchQuality:(quality)=>{if(!Object.hasOwn(patchQualityLevels,quality))return;commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,quality}});},
    setPatchVisible:(visible)=>commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,visible}}),
    setPatchDisplay:(key,value)=>{if(!Number.isFinite(value))return;commit({...get().project,patchDisplay:{...defaultDisplay,...get().project.patchDisplay,[key]:Math.max(0,Math.min(1,value))}});},
    project: prepareSceneProject(assignModules(initial)),
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
    pickCurveEndpoint: (id) => {if(!canPickModule(get().project,id,get().activeModule))return;
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
          nextCurveName(s.project),
          s.activeModule,
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
    selectCurve: (id) => get().selectObject({kind:'curve',id}),
    setCurveShape: (id, shape) => {if(eyeSide(get().project,id))return;if(!canEditModule(get().project,id,get().activeModule))return;
      if (
        !(isFree3DShape(shape)?[...shape.startHandleOffset,...shape.endHandleOffset]:[
          ...shape.planeNormal,
          shape.startHandle.along,
          shape.startHandle.offset,
          shape.endHandle.along,
          shape.endHandle.offset,
        ]).every(Number.isFinite)
      )
        return;
      try{commit(propagate({
        ...get().project,
        curves: get().project.curves.map((c) =>
          c.id === id && c.role === "canonical" && !isDerived(c) ? { ...c, shape } : c,
        ),
      },id));}catch(e){set({message:(e as Error).message});}
    },
    renameCurve: (id, name) => {
      const p = renameCurve(get().project, id, name);
      get().beginEdit();
      commit(p);
    },
    deleteCurve: (id) => {if(eyeSide(get().project,id))return;if(!canEditModule(get().project,id,get().activeModule))return;
      if(get().project.curves.some(c=>c.id===id&&isDerived(c)&&c.systemRole)){get().notify("系统 Default Ring 不可删除，可复制为用户 Ring。");return;}
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
    updateView:(id,name,yaw,pitch)=>{try{
      const s=get(),old=s.project.views.find(v=>v.id===id);if(!old)return false;
      const next=customView(name,yaw,pitch,id),locked=viewIsLocked(s.project,id);
      let p:LandmarkProject={...s.project,viewsCustomized:true,views:s.project.views.map(v=>v.id===id?{...v,label:next.label,shortLabel:next.shortLabel,camera:{...next.camera,zoom:v.camera.zoom}}:v)};
      if(locked)p=setGlobalViewLock(p,id,true);
      s.beginEdit();commit(p);s.endEdit();return true;
    }catch(e){get().notify((e as Error).message);return false;}},
    deleteView:(id)=>{const s=get();if(!s.project.views.some(v=>v.id===id)||s.project.views.length<2)return;
      const p={...s.project,viewsCustomized:true,views:s.project.views.filter(v=>v.id!==id),lockedViews:s.project.lockedViews?.filter(v=>v!==id),landmarks:s.project.landmarks.map(l=>{const viewLocks={...l.viewLocks};delete viewLocks[id];return {...l,viewLocks};})};
      s.beginEdit();commit(p);set({viewId:s.viewId===id?p.views[0].id:s.viewId,referenceMoving:false});s.endEdit();
    },
    selectView: (id) => set({ viewId: id, referenceMoving: false }),
    selectLandmark: (id) => get().selectObject({kind:'point',id}),
    notify: (message) => set({ message }),
    setReferenceMoving: (referenceMoving) => set({ referenceMoving }),
    setCanvas: (canvas, viewId) => {
      const s = get();
      commit({
        ...s.project,
        views: s.project.views.map((v) =>
          v.id === (viewId??s.viewId) ? { ...v, canvas } : v,
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
    nudgePoint:(id,axis,amount)=>{if(eyeSide(get().project,id))return;try{commit(propagate(nudgePoint(get().project,id,axis,amount)));}catch(e){get().notify((e as Error).message);}},
    movePoint: (id, target) => {if(eyeSide(get().project,id))return;if(!canEditModule(get().project,id,get().activeModule))return;
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
      if(l.placement.kind==='EYE_LOCAL'){commit(propagate(moveEyeLocal(s.project,id,position)));return;}
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
    undo: () => {if(typeof window!=='undefined')window.dispatchEvent(new Event('contour:cancel-recording-gesture'));editBase=null;autosave.end();
      const s = get(),
        p = s.past.at(-1);
      if (!p) return;
      if(!canEditSource()&&(p.drawing!==s.project.drawing||p.drawingSnapshots!==s.project.drawingSnapshots||p.drawingWorkingCopies!==s.project.drawingWorkingCopies)){s.notify('此历史步骤会修改源画稿，请返回绘制模式后撤销/重做。');return;}
      set({
        project: p, tool:{kind:"select"},
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
      // Recording/Drawing history changes no modeling geometry; skip modeling propagation.
      if(Object.keys({...s.project,...p}).every(key=>key==='recording'||key==='drawing'||key==='drawingSnapshots'||key==='drawingWorkingCopies'||key==='poseRecording'||key==='hairstyle'||key==='assembly'||key==='vectorRecording'||key==='recordingScenes'||key==='legacyWorkspaces'||(p as any)[key]===(s.project as any)[key]))persist(p);
      else commit({...p,patchDisplay:s.project.patchDisplay,inspectionBackground:s.project.inspectionBackground},false);
    },
    redo: () => {if(typeof window!=='undefined')window.dispatchEvent(new Event('contour:cancel-recording-gesture'));editBase=null;autosave.end();
      const s = get(),
        p = s.future[0];
      if (!p) return;
      if(!canEditSource()&&(p.drawing!==s.project.drawing||p.drawingSnapshots!==s.project.drawingSnapshots||p.drawingWorkingCopies!==s.project.drawingWorkingCopies)){s.notify('此历史步骤会修改源画稿，请返回绘制模式后撤销/重做。');return;}
      set({
        project: p, tool:{kind:"select"},
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
      // Recording/Drawing history changes no modeling geometry; skip modeling propagation.
      if(Object.keys({...s.project,...p}).every(key=>key==='recording'||key==='drawing'||key==='drawingSnapshots'||key==='drawingWorkingCopies'||key==='poseRecording'||key==='hairstyle'||key==='assembly'||key==='vectorRecording'||key==='recordingScenes'||key==='legacyWorkspaces'||(p as any)[key]===(s.project as any)[key]))persist(p);
      else commit({...p,patchDisplay:s.project.patchDisplay,inspectionBackground:s.project.inspectionBackground},false);
    },
    load: (p) => {const {recording,hairstyle,...withoutLegacy}=p;void recording;void hairstyle;p={...withoutLegacy,...(withoutLegacy.poseRecording?{poseRecording:syncPoseSnapshots(withoutLegacy.poseRecording,withoutLegacy.drawingSnapshots)}:{})};p=prepareSceneProject(migrateFree3D(assignModules(repairCurveNames(ensureScaffold(migrateHeadFrame(p))))));editBase=null;autosave.cancel();
      get().beginEdit();
      set({
        project: p, tool:{kind:"select"},
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
      if (!s.selectedId||eyeSide(s.project,s.selectedId)) return;
      if(!canEditModule(s.project,s.selectedId,s.activeModule))return;
      const result = duplicateLandmark(s.project, s.selectedId, name);
      result.project=assignModules(result.project,s.project,s.activeModule);
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
      if (!s.selectedId||eyeSide(s.project,s.selectedId)) return;
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
      if (!s.selectedId||eyeSide(s.project,s.selectedId)) return;
      if(!canEditModule(s.project,s.selectedId,s.activeModule))return;
      if(s.project.landmarks.find(l=>l.id===s.selectedId)?.systemRole){s.notify("系统定位点不可删除。");return;}
      const p = prunePatches(deleteLandmark(s.project, s.selectedId));
      if(!moduleEditAllowed(s.project,p,s.activeModule))return;
      if(blockedLoomisEdit(s.project,p)){s.notify("该操作会删除已锁定的 Loomis 对象，请先解锁。");return;}
      s.beginEdit();
      set({
        project: p, tool:{kind:"select"},
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
  } satisfies State);
});

if(import.meta.env.DEV)(globalThis as typeof globalThis & {__editorPerfStore?:typeof useEditor}).__editorPerfStore=useEditor;
