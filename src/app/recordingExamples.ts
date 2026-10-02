import {planArtworkImport,sourceForExampleImport} from './artworkExamples';
import {parseDrawing,uid,type DrawingDocument} from '../domain/drawing/model';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
import {parseDrawingSnapshots,snapshotDrawing,snapshotMatches,type DrawingSnapshotState} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';
import {applyIntervalOverrides,validateIntervalOverrides} from '../domain/vectorRecording/intervals';
import {drawingSignature,sourceIntervalFrames,type ArtworkRig,type VectorPose,type VectorRecording} from '../domain/vectorRecording/model';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';

export const RECORDING_EXAMPLE_NAME='转头 · 0—90° 参数工作稿';
export const THREE_PIECE_EXAMPLE_NAME='三片脸 · 90°下巴对齐（起步稿）';
const FRONT_REFERENCE_NAME='正面参考·镜像';
const SIDE_REFERENCE_NAME='右侧90°参考';

/** Loading is read-only. The explicit import action uses the plan below; a
 * bundled project is never assigned to the user's current project wholesale. */
export async function loadRecordingExample(load=async()=>{
 const response=await fetch(new URL('../assets/yaw-turning-example.json',import.meta.url),{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('转头录制示例载入失败');
 return response.text();
}):Promise<LandmarkProject>{return parseLandmarks(await load());}

/** Independent three-piece starter: +90 stores chin-alignment translation only. */
export async function loadThreePieceExample(load=async()=>{
 const response=await fetch(new URL('../assets/three-piece-starting-example.json',import.meta.url),{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('三片脸起步稿载入失败');
 return response.text();
}):Promise<LandmarkProject>{return parseLandmarks(await load());}

function validateSourceRig(source:DrawingDocument,rig:ArtworkRig){
 if(rig.sourceSignature!==drawingSignature(source))throw Error('示例录制与源稿版本不匹配，请先检查源稿');
 if(rig.sourceIntervalFrames!==undefined&&JSON.stringify(rig.sourceIntervalFrames)!==JSON.stringify(sourceIntervalFrames(source)))throw Error('示例录制的区间坐标框架已过期');
 const layers=new Set(source.layers.map(l=>l.id)),items=new Set([...source.curves,...source.fills,...source.offsets].map(x=>x.id));
 if(Object.keys(rig.bindings).some(id=>!layers.has(id)))throw Error('示例录制引用了不存在的源稿图层');
 for(const pose of [...rig.keys,...(rig.draft?[rig.draft]:[])]){
  validateIntervalOverrides(pose.intervalOverrides,source);
  const appearance=applyIntervalOverrides(source,pose.intervalOverrides),ranges=new Set((appearance.displayIntervals??[]).flatMap(t=>t.ranges.map(r=>r.id)));
  if(Object.keys(pose.visibility).some(id=>!items.has(id))||Object.keys(pose.intervals).some(id=>!ranges.has(id)))throw Error('示例姿态引用了不存在的显隐对象或区间');
 }
}

function recordingIds(recording:VectorRecording|undefined){return recording?.rigs.flatMap(r=>[r.id,r.artworkId,...r.deformers.map(d=>d.id),...r.keys.map(k=>k.id)])??[];}

/** Prepare every change before opening the store transaction. Apply ALL steps
 * in order, then append rig to the CURRENT recording, in one beginEdit/endEdit.
 * The first step can migrate a $working rig to the preserved unsaved artwork.
 * Existing tolerance, rigs and project settings belong to the caller and are
 * deliberately absent from the returned mutation payload. */
export function planRecordingExampleImport(state:DrawingSnapshotState,exampleProject:LandmarkProject,existingRecording?:VectorRecording,options:{name?:string}={}){
 const example=parseLandmarks(JSON.stringify(exampleProject)),library=example.drawingSnapshots;
 if(!library?.activeId||!example.drawing||!snapshotMatches(example.drawing,library,library.activeId))throw Error('示例必须具有已保存且未修改的活动源稿');
 const reference=(name:string)=>{const found=library.items.filter(a=>a.name===name&&a.id!==library.activeId);if(found.length!==1)throw Error(`示例参考画稿缺失或不唯一：${name}`);return found[0];};
 const front=reference(FRONT_REFERENCE_NAME),side=reference(SIDE_REFERENCE_NAME),active=library.items.find(a=>a.id===library.activeId)!;
 const candidates=example.vectorRecording?.rigs.filter(r=>r.artworkId===active.id)??[];
 if(candidates.length!==1)throw Error('示例必须具有唯一的活动源稿录制');
 const originalRig=candidates[0];validateSourceRig(example.drawing,originalRig);
 if(state.drawing)parseDrawing(state.drawing);
 if(state.drawingSnapshots)parseDrawingSnapshots(state.drawingSnapshots);
 if(existingRecording)parseVectorRecording(existingRecording);

 const reserved=new Set([...recordingIds(existingRecording),...recordingIds(example.vectorRecording),...(state.drawingSnapshots?.items.map(a=>a.id)??[]),...(state.drawingSnapshots?.images.map(a=>a.id)??[]),...library.items.map(a=>a.id),...library.images.map(a=>a.id)]);
 const freshId=()=>{for(let i=0;i<32;i++){const id=uid();if(!reserved.has(id)){reserved.add(id);return id;}}throw Error('无法生成无冲突的示例标识，请重试');};
 const steps:DrawingSnapshotState[]=[],artworkMap=new Map<string,string>();let preservedDraftId:string|undefined;
 let next:DrawingSnapshotState={drawing:sourceForExampleImport(state.drawing,!!existingRecording?.rigs.some(r=>r.artworkId==='$working')),drawingSnapshots:state.drawingSnapshots,drawingWorkingCopies:state.drawingWorkingCopies};
 // planArtworkImport owns snapshot/reference-image allocation. Check all new
 // identities before accepting a plan, including collisions with rig IDs.
 const importArtwork=(oldId:string,name:string)=>{
  for(let attempt=0;attempt<32;attempt++){
   const plan=planArtworkImport(next,snapshotDrawing(library,oldId),name);
   const oldIds=new Set([...(next.drawingSnapshots?.items??[]),...(next.drawingSnapshots?.images??[])].map(x=>x.id));
   const added=[...(plan.state.drawingSnapshots?.items??[]),...(plan.state.drawingSnapshots?.images??[])].filter(x=>!oldIds.has(x.id)).map(x=>x.id);
   const expectedItems=(next.drawingSnapshots?.items.length??0)+plan.steps.length;
   if(plan.state.drawingSnapshots!.items.length!==expectedItems||added.length<plan.steps.length||new Set(added).size!==added.length||added.some(id=>reserved.has(id)))continue;
   // This also catches a generated identity colliding with an existing item,
   // even when the duplicate was filtered out of the list above.
   try{parseDrawingSnapshots(plan.state.drawingSnapshots);}catch{continue;}
   added.forEach(id=>reserved.add(id));steps.push(...plan.steps);next=plan.state;preservedDraftId??=plan.preservedDraftId;artworkMap.set(oldId,plan.artworkId);return plan.artworkId;
  }
  throw Error('无法生成无冲突的画稿标识，请重试');
 };
 const frontArtworkId=importArtwork(front.id,FRONT_REFERENCE_NAME),sideArtworkId=importArtwork(side.id,SIDE_REFERENCE_NAME),artworkId=importArtwork(active.id,options.name??RECORDING_EXAMPLE_NAME);
 const deformerMap=new Map(originalRig.deformers.map(d=>[d.id,freshId()])),keyMap=new Map(originalRig.keys.map(k=>[k.id,freshId()])),rigId=freshId();
 const pose=(p:VectorPose):VectorPose=>({...structuredClone(p),grids:Object.fromEntries(Object.entries(p.grids).map(([id,g])=>[deformerMap.get(id)!,structuredClone(g)]))});
 const rig:ArtworkRig={...structuredClone(originalRig),id:rigId,artworkId,
  deformers:originalRig.deformers.map(d=>({...structuredClone(d),id:deformerMap.get(d.id)!,...(d.parentId?{parentId:deformerMap.get(d.parentId)!}:{})})),
  bindings:Object.fromEntries(Object.entries(originalRig.bindings).map(([id,target])=>[id,deformerMap.get(target)!])),
  keys:originalRig.keys.map(k=>({...pose(k),id:keyMap.get(k.id)!,name:k.name,angle:{...k.angle}})),
  ...(originalRig.draft?{draft:pose(originalRig.draft)}:{}),
 };
 parseVectorRecording({version:1,tolerance:existingRecording?.tolerance??example.vectorRecording!.tolerance,rigs:[...(existingRecording?.rigs??[]),rig]});
 validateSourceRig(next.drawing!,rig);
 // Match the store's stronger brush-compilation guard for EVERY intermediate
 // source, including preserved drafts and references, before any setter runs.
 for(const step of steps)if(step.drawing)assertDisplayRouteSupport(step.drawing);
 return {steps,state:next,rig,artworkId,frontArtworkId,sideArtworkId,preservedDraftId,idMaps:{artworks:Object.fromEntries(artworkMap),rigs:{[originalRig.id]:rigId},deformers:Object.fromEntries(deformerMap),keyforms:Object.fromEntries(keyMap)}};
}
