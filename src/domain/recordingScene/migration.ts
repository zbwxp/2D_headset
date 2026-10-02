import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import type {DrawingSnapshotState} from '../drawing/snapshots';
import {drawingSignature,type ArtworkRig,type VectorPose,type VectorRecording} from '../vectorRecording/model';
import {synchronizeCompatibleSource} from '../vectorRecording/sourceCompatibility';
import {recordingSceneSources} from './sources';
import {emptyRecordingScene,type RecordingScene,type RecordingScenes,type SceneIntervalTrack,type SceneIntervalValue,type SceneVisibilityTrack} from './model';

type SceneProject=DrawingSnapshotState&{vectorRecording?:VectorRecording;recordingScenes?:RecordingScenes};
const legacyId=(kind:string,...parts:string[])=>`legacy-${kind}:${JSON.stringify(parts)}`;
const clone=<T,>(value:T):T=>structuredClone(value);

/** Every old angle is retained, including repeated values: the old global
 * lattice participates in interpolation even when one object's value repeats. */
export function legacyAppearanceTracks(rig:ArtworkRig,instanceId:string,source:DrawingDocument|undefined){
 const poses=[...rig.keys,...(rig.draft?[rig.draft]:[])],visibilityTracks:SceneVisibilityTrack[]=[],intervalTracks:SceneIntervalTrack[]=[];let pending=false;
 const visibilityIds=new Set(poses.flatMap(p=>Object.keys(p.visibility)));
 for(const objectId of visibilityIds){
  const layer=source?.layers.find(l=>l.items.includes(objectId));
  if(!layer){pending=true;continue;}
  const id=legacyId('visibility',rig.id,objectId),value=(p:VectorPose)=>Object.hasOwn(p.visibility,objectId)?p.visibility[objectId]:null;
  visibilityTracks.push({id,target:{instanceId,sourceLayerId:layer.id,sourceObjectId:objectId},interpolation:'legacy',keys:rig.keys.map(k=>({id:legacyId('key',id,k.id),name:k.name,angle:clone(k.angle),value:value(k)})),...(rig.draft?{draft:{angle:clone(rig.angle),value:value(rig.draft)}}:{})});
 }
 const trackIds=new Set([...(source?.displayIntervals??[]).map(t=>t.id),...Object.keys(rig.sourceIntervalFrames??{}),...poses.flatMap(p=>(p.intervalOverrides??[]).map(t=>t.id))]);
 const accountedFlags=new Set<string>();
 for(const sourceTrackId of trackIds){
  const base=source?.displayIntervals?.find(t=>t.id===sourceTrackId);
  const knownTracks=[...(base?[base]:[]),...poses.flatMap(p=>p.intervalOverrides?.filter(t=>t.id===sourceTrackId)??[])];
  const rangeIds=new Set([...(rig.sourceIntervalFrames?.[sourceTrackId]?.rangeIds??[]),...knownTracks.flatMap(t=>t.ranges.flatMap(r=>[r.id,...(r.originId?[r.originId]:[])]))]);
  rangeIds.forEach(id=>accountedFlags.add(id));
  // A source track with no authored appearance has no per-object animation to
  // migrate. It continues to inherit the live source without redundant keys.
  if(!poses.some(p=>p.intervalOverrides?.some(t=>t.id===sourceTrackId)||Object.keys(p.intervals).some(id=>rangeIds.has(id))))continue;
  const id=legacyId('interval',rig.id,sourceTrackId);
  const value=(p:VectorPose):SceneIntervalValue=>({appearance:clone(p.intervalOverrides?.find(t=>t.id===sourceTrackId)??null),enabled:Object.fromEntries(Object.entries(p.intervals).filter(([id])=>rangeIds.has(id)))});
  intervalTracks.push({id,instanceId,sourceTrackId,interpolation:'legacy',keys:rig.keys.map(k=>({id:legacyId('key',id,k.id),name:k.name,angle:clone(k.angle),value:value(k)})),...(rig.draft?{draft:{angle:clone(rig.angle),value:value(rig.draft)}}:{}),...(source&&rig.sourceSignature&&rig.sourceSignature!==drawingSignature(source)?{materialIssue:{sourceSignature:rig.sourceSignature,message:'Legacy interval baseline does not match the current live source; authored data is retained.'}}:{})});
 }
 if(poses.some(p=>Object.keys(p.intervals).some(id=>!accountedFlags.has(id))))pending=true;
 return {visibilityTracks,intervalTracks,pending};
}

export function migrateLegacyRig(rig:ArtworkRig,source:DrawingDocument|undefined,name:string,tolerance:number):RecordingScene{
 const scene=emptyRecordingScene(legacyId('scene',rig.id),name),instanceId=legacyId('instance',rig.id),appearance=legacyAppearanceTracks(rig,instanceId,source);
 const warpIds=new Map(rig.deformers.map(d=>[d.id,legacyId('warp',rig.id,d.id)]));
 return {...scene,angle:clone(rig.angle),tolerance,legacy:{rigId:rig.id,...(appearance.pending?{appearancePending:true}:{})},
  instances:[{id:instanceId,artworkId:rig.artworkId,name,...(rig.sourceSignature?{sourceSignature:rig.sourceSignature}:{}),...(rig.sourceStructureSignature?{sourceStructureSignature:rig.sourceStructureSignature}:{}),...(rig.sourceIntervalFrames?{sourceIntervalFrames:clone(rig.sourceIntervalFrames)}:{})}],
  warps:rig.deformers.map(d=>{const id=warpIds.get(d.id)!;return {id,name:d.name,...(d.parentId?{parentId:warpIds.get(d.parentId)!}:{}),restGrid:clone(d.grid),interpolation:'legacy' as const,keys:rig.keys.map(k=>({id:legacyId('key',id,k.id),name:k.name,angle:clone(k.angle),value:clone(k.grids[d.id]??d.grid)})),...(rig.draft?{draft:{angle:clone(rig.angle),value:clone(rig.draft.grids[d.id]??d.grid)}}:{})};}),
  bindings:Object.entries(rig.bindings).map(([sourceLayerId,id])=>({instanceId,sourceLayerId,warpId:warpIds.get(id)!})),
  visibilityTracks:appearance.visibilityTracks,intervalTracks:appearance.intervalTracks,
 };
}

/** A missing new field triggers a single deterministic compatibility migration.
 * Existing scenes, legacy bytes, source library and unsaved source stay intact.
 * Missing sources keep their exact artwork reference rather than guessing. */
export function migrateLegacyRecordingScenes<T extends SceneProject>(project:T):T{
 if(project.recordingScenes!==undefined||!project.vectorRecording?.rigs.length)return project;
 const sources=recordingSceneSources(project),baselines=[...(project.drawing?[project.drawing]:[]),...Object.values(project.drawingWorkingCopies??{}),...(project.drawingSnapshots?.items.map(a=>a.drawing)??[])];
 const scenes=project.vectorRecording.rigs.map(original=>{
  const source=Object.hasOwn(sources,original.artworkId)?sources[original.artworkId]:undefined;
  const baseline=original.sourceSignature&&baselines.find(d=>drawingSignature(d)===original.sourceSignature);
  const rig=source&&baseline?synchronizeCompatibleSource(original,baseline,source)??original:original;
  const name=project.drawingSnapshots?.items.find(a=>a.id===rig.artworkId)?.name??(rig.artworkId==='$working'?'未命名源稿':'缺失来源画稿');
  return migrateLegacyRig(rig,source,`${name} · 兼容场景`,project.vectorRecording!.tolerance);
 });
 const active=project.drawingSnapshots?.activeId??'$working',index=project.vectorRecording.rigs.findIndex(r=>r.artworkId===active);
 return {...project,recordingScenes:{version:1,activeSceneId:scenes[Math.max(0,index)].id,scenes}};
}
