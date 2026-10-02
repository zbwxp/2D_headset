import {planArtworkImport,sourceForExampleImport} from './artworkExamples';
import {parseDrawing,uid,type DrawingDocument} from '../domain/drawing/model';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
import {parseDrawingSnapshots,parseDrawingWorkingCopies,snapshotDrawing,snapshotMatches,type DrawingSnapshotState} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';
import {drawingSignature,sourceIntervalFrames,type VectorRecording} from '../domain/vectorRecording/model';
import {sourceStructureSignature} from '../domain/vectorRecording/sourceCompatibility';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import type {RecordingScene,RecordingScenes,SceneTrack} from '../domain/recordingScene/model';

export const SCENE_EXAMPLE_NAME='三片脸 · 双源场景起步稿';
const STARTER_SCENE_ID='6c4f5193-7a82-50e2-8079-b70c87387ee8';

/** Read-only loading: a full example project is never assigned to current work. */
export async function loadSceneExample(load=async()=>{
 const response=await fetch(new URL('../assets/three-piece-scene-example.json',import.meta.url),{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('双源场景起步稿载入失败');
 return response.text();
}):Promise<LandmarkProject>{
 const project=parseLandmarks(await load()),library=project.drawingSnapshots,container=project.recordingScenes;
 if(!library||!container?.scenes.length)throw Error('示例场景缺少来源画稿');
 const sources=new Map(library.items.map(item=>[item.id,snapshotDrawing(library,item.id)]));
 const scenes=container.scenes.map(scene=>{
  validateSources(scene,sources);
  return {...scene,instances:scene.instances.map(instance=>({...instance,...sourceEvidence(sources.get(instance.artworkId)!)}))};
 });
 return {...project,recordingScenes:parseRecordingScenes({...container,scenes})};
}

function sourceEvidence(source:DrawingDocument){return {sourceSignature:drawingSignature(source),sourceStructureSignature:sourceStructureSignature(source),sourceIntervalFrames:sourceIntervalFrames(source)};}

const sceneTracks=(scene:RecordingScene)=>[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[])];
const sceneIds=(recording:RecordingScenes|undefined)=>recording?.scenes.flatMap(scene=>[scene.id,...scene.instances.flatMap(i=>[i.id,i.artworkId]),...sceneTracks(scene).flatMap(t=>[t.id,...t.keys.map(k=>k.id)])])??[];
const recordingIds=(recording:VectorRecording|undefined)=>recording?.rigs.flatMap(r=>[r.id,r.artworkId,...r.deformers.map(d=>d.id),...r.keys.map(k=>k.id)])??[];

/** Match the complete authored ID graph, never display names or coordinates.
 * This identifies these starter sources while retaining compatible user edits
 * to geometry, materials, labels, reference images and Drawing visibility. */
function sourceLineage(source:DrawingDocument):string{
 const sorted=<T extends {id:string},>(items:readonly T[],value:(item:T)=>unknown)=>[...items].sort((a,b)=>a.id.localeCompare(b.id)).map(item=>[item.id,value(item)]);
 return JSON.stringify({nodes:source.nodes.map(n=>n.id).sort(),curves:sorted(source.curves,c=>c.nodes),layers:sorted(source.layers,l=>[...l.items].sort()),
  fills:sorted(source.fills,f=>f.boundary),offsets:sorted(source.offsets,o=>o.source),joins:sorted(source.joins,j=>[j.a,j.b]),links:sorted(source.endpointLinks??[],l=>[l.a,l.b]),
  groups:sorted(source.groups??[],g=>[...g.curveIds].sort()),intervals:sorted(source.displayIntervals??[],t=>[t.anchor,t.displayRoute??null,t.ranges.map(r=>r.id).sort()])});
}
const sameIds=(a:readonly string[],b:readonly string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));

/** An authored starter remains the same scene after editing its keys or drafts.
 * Its two source instances, selected layers and binding relationships identify
 * it; activation must leave every authored scene field untouched. */
function matchStarterScene(scene:RecordingScene,original:RecordingScene,candidates:Map<string,string[]>){
 if(scene.legacy||scene.instances.length!==original.instances.length||scene.bindings.length!==original.bindings.length)return;
 const instances=new Map<string,string>(),artworks=new Map<string,string>(),warps=new Map<string,string>();
 for(const expected of original.instances){
  const instance=scene.instances.find(i=>candidates.get(expected.artworkId)?.includes(i.artworkId)&&sameIds(i.layerIds??[],expected.layerIds??[]));
  if(!instance||[...instances.values()].includes(instance.id))return;
  instances.set(expected.id,instance.id);artworks.set(expected.artworkId,instance.artworkId);
 }
 for(const expected of original.bindings){
  const binding=scene.bindings.find(b=>b.instanceId===instances.get(expected.instanceId)&&b.sourceLayerId===expected.sourceLayerId);
  if(!binding||!scene.warps.some(w=>w.id===binding.warpId)||warps.has(expected.warpId)&&warps.get(expected.warpId)!==binding.warpId)return;
  warps.set(expected.warpId,binding.warpId);
 }
 if(new Set(warps.values()).size!==warps.size)return;
 return {instances,artworks,warps};
}

/** All source, route and scene checks finish before any store setter runs. */
function validateSources(scene:RecordingScene,sources:Map<string,DrawingDocument>){
 for(const instance of scene.instances){
  const source=sources.get(instance.artworkId);if(!source)throw Error('示例场景缺少来源画稿');
  if(instance.sourceSignature!==undefined&&instance.sourceSignature!==drawingSignature(source))throw Error('示例场景与来源画稿版本不匹配');
  if(instance.sourceStructureSignature!==undefined&&instance.sourceStructureSignature!==sourceStructureSignature(source))throw Error('示例场景的来源结构已过期');
  if(instance.sourceIntervalFrames!==undefined&&JSON.stringify(instance.sourceIntervalFrames)!==JSON.stringify(sourceIntervalFrames(source)))throw Error('示例场景的来源区间框架已过期');
  assertDisplayRouteSupport(source);
 }
 const angles=new Map([scene.angle,...sceneTracks(scene).flatMap(t=>[...t.keys.map(k=>k.angle),...(t.draft?[t.draft.angle]:[])])].map(a=>[JSON.stringify(a),a]));
 for(const angle of angles.values()){
  const result=evaluateScene(scene,id=>sources.get(id),{angle});
  if(result.diagnostics.length||result.intervalTransportErrors.length||result.conflictingNodeIds.length)throw Error(`示例场景无法完整解析：${result.diagnostics.map(d=>d.message).join('；')||'区间或端点冲突'}`);
  assertDisplayRouteSupport(result.drawing);
 }
}

/** Apply every returned step, then append scene to the CURRENT recordingScenes,
 * inside one beginEdit/endEdit transaction. The first snapshot step can migrate
 * existing $working scenes/rigs to their preserved drawing before activation.
 * The bundled starter first reuses its existing source identities and authored
 * scene. A repeated menu action may return no steps and reused:true; callers
 * activate that scene instead of appending it again. */
export function planSceneExampleImport(state:DrawingSnapshotState,exampleProject:LandmarkProject,existingScenes?:RecordingScenes,existingRecording?:VectorRecording){
 const example=parseLandmarks(JSON.stringify(exampleProject)),library=example.drawingSnapshots,container=example.recordingScenes;
 if(!library?.activeId||!example.drawing||!snapshotMatches(example.drawing,library,library.activeId))throw Error('示例必须具有已保存且未修改的活动源稿');
 if(!container||container.scenes.length!==1||container.scenes[0].legacy)throw Error('示例必须具有一个独立组装场景');
 const original=container.scenes[0],sourceIds=[...new Set(original.instances.map(i=>i.artworkId))];
 if(!sourceIds.length||sourceIds.some(id=>!library.items.some(a=>a.id===id)))throw Error('示例场景缺少来源画稿');
 const sources=new Map(sourceIds.map(id=>[id,snapshotDrawing(library,id)]));
 validateSources(original,sources);
 if(state.drawing)parseDrawing(state.drawing);
 if(state.drawingSnapshots)parseDrawingSnapshots(state.drawingSnapshots);
 if(state.drawingWorkingCopies!==undefined)for(const source of Object.values(parseDrawingWorkingCopies(state.drawingWorkingCopies,state.drawingSnapshots)))assertDisplayRouteSupport(source);
 if(existingScenes)parseRecordingScenes(existingScenes);
 if(existingRecording)parseVectorRecording(existingRecording);
 const currentSources=recordingSceneSources(state),candidates=new Map<string,string[]>();
 if(original.id===STARTER_SCENE_ID){
  for(const sourceId of sourceIds){
   const lineage=sourceLineage(sources.get(sourceId)!);
   candidates.set(sourceId,(state.drawingSnapshots?.items??[]).filter(item=>currentSources[item.id]&&sourceLineage(currentSources[item.id])===lineage).map(item=>item.id));
  }
  const preferred=[...(existingScenes?.scenes??[])].reverse().sort((a,b)=>Number(b.id===existingScenes?.activeSceneId)-Number(a.id===existingScenes?.activeSceneId));
  for(const scene of preferred){
   const matched=matchStarterScene(scene,original,candidates);if(!matched)continue;
   return {steps:[] as DrawingSnapshotState[],state,scene,sourceArtworkIds:sourceIds.map(id=>matched.artworks.get(id)!),preservedDraftId:undefined,reused:true,reusedSources:true,
    idMaps:{artworks:Object.fromEntries(matched.artworks),scenes:{[original.id]:scene.id},instances:Object.fromEntries(matched.instances),warps:Object.fromEntries(matched.warps),tracks:{} as Record<string,string>,keys:{} as Record<string,string>}};
  }
 }
 const reserved=new Set([...sceneIds(existingScenes),...sceneIds(container),...recordingIds(existingRecording),...recordingIds(example.vectorRecording),...(state.drawingSnapshots?.items.map(a=>a.id)??[]),...(state.drawingSnapshots?.images.map(a=>a.id)??[]),...library.items.map(a=>a.id),...library.images.map(a=>a.id)]);
 const freshId=()=>{for(let attempt=0;attempt<32;attempt++){const id=uid();if(!reserved.has(id)){reserved.add(id);return id;}}throw Error('无法生成无冲突的场景标识，请重试');};
 const steps:DrawingSnapshotState[]=[],artworkMap=new Map<string,string>(),resolvedSources=new Map(sources);let preservedDraftId:string|undefined,reusedSources=false;
 const hasWorking=!!existingScenes?.scenes.some(s=>s.instances.some(i=>i.artworkId==='$working'))||!!existingRecording?.rigs.some(r=>r.artworkId==='$working');
 let next:DrawingSnapshotState={drawing:sourceForExampleImport(state.drawing,hasWorking),drawingSnapshots:state.drawingSnapshots,...(state.drawingWorkingCopies?{drawingWorkingCopies:state.drawingWorkingCopies}:{})};
 for(const sourceId of sourceIds){
  const available=candidates.get(sourceId)??[],existingId=available.find(id=>id===state.drawingSnapshots?.activeId)??available.at(-1);
  if(existingId){artworkMap.set(sourceId,existingId);resolvedSources.set(sourceId,currentSources[existingId]);reusedSources=true;continue;}
  let accepted=false;
  for(let attempt=0;attempt<32;attempt++){
   const plan=planArtworkImport(next,sources.get(sourceId)!,library.items.find(a=>a.id===sourceId)!.name);
   const priorIds=new Set([...(next.drawingSnapshots?.items??[]),...(next.drawingSnapshots?.images??[])].map(a=>a.id));
   const added=[...(plan.state.drawingSnapshots?.items??[]),...(plan.state.drawingSnapshots?.images??[])].filter(a=>!priorIds.has(a.id)).map(a=>a.id);
   if(plan.state.drawingSnapshots!.items.length!==(next.drawingSnapshots?.items.length??0)+plan.steps.length||added.length<plan.steps.length||new Set(added).size!==added.length||added.some(id=>reserved.has(id)))continue;
   try{parseDrawingSnapshots(plan.state.drawingSnapshots);}catch{continue;}
   added.forEach(id=>reserved.add(id));steps.push(...plan.steps);next=plan.state;preservedDraftId??=plan.preservedDraftId;artworkMap.set(sourceId,plan.artworkId);accepted=true;break;
  }
  if(!accepted)throw Error('无法生成无冲突的画稿标识，请重试');
 }
 const sceneId=freshId(),instanceMap=new Map(original.instances.map(i=>[i.id,freshId()])),warpMap=new Map(original.warps.map(w=>[w.id,freshId()]));
 const trackMap=new Map([...original.visibilityTracks,...original.intervalTracks,...(original.depthTracks??[])].map(t=>[t.id,freshId()]));
 // Key IDs need only be unique within each object in external scene JSON. The
 // composite lookup also handles projects that reuse a key ID across tracks.
 const keyMap=new Map(sceneTracks(original).flatMap(t=>t.keys.map(k=>[JSON.stringify([t.id,k.id]),freshId()] as const)));
 const track=<T,>(id:string,value:SceneTrack<T>):SceneTrack<T>=>({...structuredClone(value),keys:value.keys.map(k=>({...structuredClone(k),id:keyMap.get(JSON.stringify([id,k.id]))!}))});
 const reference=<T extends {instanceId:string}>(ref:T):T=>({...ref,instanceId:instanceMap.get(ref.instanceId)!});
 const scene:RecordingScene={...structuredClone(original),id:sceneId,
  instances:original.instances.map(i=>({...structuredClone(i),id:instanceMap.get(i.id)!,artworkId:artworkMap.get(i.artworkId)!,...sourceEvidence(resolvedSources.get(i.artworkId)!)})),
  warps:original.warps.map(w=>({...w,...track(w.id,w),id:warpMap.get(w.id)!,...(w.parentId?{parentId:warpMap.get(w.parentId)!}:{})})),
  bindings:original.bindings.map(b=>({...reference(b),warpId:warpMap.get(b.warpId)!})),
  visibilityTracks:original.visibilityTracks.map(t=>({...t,...track(t.id,t),id:trackMap.get(t.id)!,target:reference(t.target)})),
  intervalTracks:original.intervalTracks.map(t=>({...reference(t),...track(t.id,t),id:trackMap.get(t.id)!,instanceId:instanceMap.get(t.instanceId)!})),
  ...(original.depthTracks?{depthTracks:original.depthTracks.map(t=>({...t,...track(t.id,t),id:trackMap.get(t.id)!,target:reference(t.target)}))}:{}),
 };
 parseRecordingScenes({version:1,activeSceneId:scene.id,scenes:[...(existingScenes?.scenes??[]),scene]});
 validateSources(scene,new Map(sourceIds.map(id=>[artworkMap.get(id)!,resolvedSources.get(id)!])));
 for(const step of steps){if(step.drawing){parseDrawing(step.drawing);assertDisplayRouteSupport(step.drawing);}if(step.drawingSnapshots)parseDrawingSnapshots(step.drawingSnapshots);if(step.drawingWorkingCopies!==undefined)for(const source of Object.values(parseDrawingWorkingCopies(step.drawingWorkingCopies,step.drawingSnapshots)))assertDisplayRouteSupport(source);}
 return {steps,state:steps.length?next:state,scene,sourceArtworkIds:sourceIds.map(id=>artworkMap.get(id)!),preservedDraftId,reused:false,reusedSources,idMaps:{artworks:Object.fromEntries(artworkMap),scenes:{[original.id]:sceneId},instances:Object.fromEntries(instanceMap),warps:Object.fromEntries(warpMap),tracks:Object.fromEntries(trackMap),keys:Object.fromEntries(keyMap)}};
}
