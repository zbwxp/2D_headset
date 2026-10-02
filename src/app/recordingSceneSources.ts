export {recordingSceneSources,resolveRecordingSceneSource} from '../domain/recordingScene/sources';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {legacyAppearanceTracks} from '../domain/recordingScene/migration';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {DrawingDocument,StrokeDisplayIntervals} from '../domain/drawing/model';
import {displayPath} from '../domain/drawing/displayIntervals';
import {transportDeformedIntervals} from '../domain/drawing/deform';
import {applyIntervalOverrides,validateIntervalOverrides} from '../domain/vectorRecording/intervals';
import {drawingSignature,sourceIntervalFrames} from '../domain/vectorRecording/model';
import {sourceStructureSignature} from '../domain/vectorRecording/sourceCompatibility';
import type {RecordingScenes,SceneIntervalValue,SceneIntervalTrack} from '../domain/recordingScene/model';

export function remapWorkingSceneSource(recording:RecordingScenes|undefined,artworkId:string):RecordingScenes|undefined{
 if(!recording||!recording.scenes.some(s=>s.instances.some(i=>i.artworkId==='$working')))return recording;
 return {...recording,scenes:recording.scenes.map(s=>({...s,instances:s.instances.map(i=>i.artworkId==='$working'?{...i,artworkId}:i)}))};
}

function moveAppearance(value:SceneIntervalValue,before:DrawingDocument,after:DrawingDocument,sourceTrackId:string):SceneIntervalValue{
 const oldBase=before.displayIntervals?.find(t=>t.id===sourceTrackId),newBase=after.displayIntervals?.find(t=>t.id===sourceTrackId);
 if(!oldBase||!newBase)throw Error('The canonical source interval track is missing.');
 if(JSON.stringify(oldBase.ranges.map(r=>r.id).sort())!==JSON.stringify(newBase.ranges.map(r=>r.id).sort()))throw Error('The canonical source interval range identities changed.');
 if(!value.appearance)return value;
 const appearance=value.appearance;
 validateIntervalOverrides([appearance],before);validateIntervalOverrides([appearance],after);
 const oldPath=displayPath(before,appearance.anchor.id),newPath=displayPath(after,appearance.anchor.id);
 if(JSON.stringify(oldPath)!==JSON.stringify(newPath))throw Error('The source display traversal changed.');
 const old={...applyIntervalOverrides(before,[appearance]),displayIntervals:[appearance]},moved=transportDeformedIntervals(old,{...after,displayIntervals:[appearance]}),next=moved.displayIntervals?.find(t=>t.id===appearance.id);
 if(!next)throw Error('The interval material track disappeared.');
 const roundtrip=transportDeformedIntervals(moved,{...before,displayIntervals:moved.displayIntervals}).displayIntervals?.find(t=>t.id===appearance.id);
 const closed=oldPath.closed&&appearance.scope!=='CURVE';
 for(const range of appearance.ranges){const returned=roundtrip?.ranges.find(r=>r.id===range.id);if(!returned)throw Error('The source edit removed interval material.');for(const side of ['start','end'] as const){const delta=Math.abs(range[side]-returned[side]);if((closed?Math.min(delta,Math.abs(1-delta)):delta)>1e-8)throw Error('An interval cut was trimmed away by the source edit.');}}
 validateIntervalOverrides([next],after);
 return JSON.stringify(next)===JSON.stringify(appearance)?value:{...value,appearance:next};
}

/** Called with the source commit in the same history transaction. All instances
 * resolve fresh source geometry; only their affected interval material channels
 * migrate. Failed channels retain every key and can reconnect after source Undo. */
export function syncRecordingSceneSources(project:LandmarkProject,beforeProject?:LandmarkProject):LandmarkProject{
 const recording=project.recordingScenes;if(!recording)return project;
 const currentSources=recordingSceneSources(project),beforeSources=recordingSceneSources(beforeProject??project);
 const candidates=[...Object.values(beforeSources),...Object.values(currentSources),...Object.values(beforeProject?.drawingWorkingCopies??{}),...Object.values(project.drawingWorkingCopies??{}),...(beforeProject?.drawingSnapshots?.items.map(a=>a.drawing)??[]),...(project.drawingSnapshots?.items.map(a=>a.drawing)??[])],bySignature=new Map(candidates.map(d=>[drawingSignature(d),d]));
 const scenes=recording.scenes.map(original=>{
  let scene=original;
  if(scene.legacy?.appearancePending){
   const rig=project.vectorRecording?.rigs.find(r=>r.id===scene.legacy!.rigId),instance=scene.instances[0],source=instance&&Object.hasOwn(currentSources,instance.artworkId)?currentSources[instance.artworkId]:undefined;
   if(rig&&instance&&source){const migrated=legacyAppearanceTracks(rig,instance.id,source);scene={...scene,visibilityTracks:[...scene.visibilityTracks,...migrated.visibilityTracks.filter(t=>!scene.visibilityTracks.some(existing=>existing.id===t.id))],intervalTracks:[...scene.intervalTracks,...migrated.intervalTracks.filter(t=>!scene.intervalTracks.some(existing=>existing.id===t.id))],legacy:{rigId:scene.legacy.rigId,...(migrated.pending?{appearancePending:true}:{})}};}
  }
  let intervalTracks=scene.intervalTracks;
  const instances=scene.instances.map(instance=>{
   const source=Object.hasOwn(currentSources,instance.artworkId)?currentSources[instance.artworkId]:undefined;if(!source)return instance;
   const signature=drawingSignature(source);
   intervalTracks=intervalTracks.map(track=>{
    if(track.instanceId!==instance.id)return track;
    const baselineSignature=track.materialIssue?.sourceSignature??instance.sourceSignature;
    if(baselineSignature===signature){if(!track.materialIssue)return track;const {materialIssue,...rest}=track;void materialIssue;return rest;}
    const baseline=baselineSignature?bySignature.get(baselineSignature):undefined;
    const authored=[...track.keys.map(k=>k.value),...(track.draft?[track.draft.value]:[])].some(v=>!!v.appearance||Object.keys(v.enabled).length>0);
    if(!authored)return track;
    let next:SceneIntervalTrack;
    try{
     if(!baseline)throw Error('The last valid source material baseline is unavailable.');
     const keys=track.keys.map(k=>({...k,value:moveAppearance(k.value,baseline,source,track.sourceTrackId)})),draft=track.draft?{...track.draft,value:moveAppearance(track.draft.value,baseline,source,track.sourceTrackId)}:undefined;
     const {materialIssue,...rest}=track;void materialIssue;next={...rest,keys,...(draft?{draft}:{})};
    }catch(error){next={...track,materialIssue:{sourceSignature:baselineSignature??'unknown-legacy-baseline',message:error instanceof Error?error.message:String(error)}};}
    return JSON.stringify(next)===JSON.stringify(track)?track:next;
   });
   if(instance.sourceSignature===signature)return instance;
   return {...instance,sourceSignature:signature,sourceStructureSignature:sourceStructureSignature(source),sourceIntervalFrames:sourceIntervalFrames(source)};
  });
  if(instances.some((v,i)=>v!==scene.instances[i])||intervalTracks.some((v,i)=>v!==scene.intervalTracks[i]))scene={...scene,instances,intervalTracks};
  return JSON.stringify(scene)===JSON.stringify(original)?original:scene;
 });
 return scenes.every((s,i)=>s===recording.scenes[i])?project:{...project,recordingScenes:{...recording,scenes}};
}
