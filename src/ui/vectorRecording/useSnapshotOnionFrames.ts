import {useMemo} from 'react';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import type {Angle} from '../../domain/vectorRecording/interpolation';
import type {SceneOnionFrame,SceneOnionSettings} from './angleInspection';
import {createEndpointOnionCache,defaultSceneOnionEndpoints,interpolateEndpointOnion,type SceneOnionEndpoints} from './endpointOnion';
export type {SceneOnionEndpoints} from './endpointOnion';

const EMPTY_FRAMES:SceneOnionFrame[]=[];
/** Ghosts blend two final endpoint Béziers with the target's response asset. Intermediate Recording
 * keys and the runtime interpolation solver never participate in this view. */
export function useSnapshotOnionFrames(workspace:RecordingSnapshotWorkspace,recordingId:string,angle:Angle,settings:SceneOnionSettings,stopAtWarpId?:string,endpoints?:SceneOnionEndpoints,currentEvaluation?:SnapshotEvaluation){
 const cache=useMemo(()=>createEndpointOnionCache(),[]);
 const recording=workspace.recordings.find(value=>value.id===recordingId),views=recording?.snapshotIds.flatMap(id=>{const view=workspace.snapshots.find(value=>value.id===id);return view?[view]:[];})??[];
 const selected=endpoints??defaultSceneOnionEndpoints(views);
 const result=useMemo(()=>{
  if(!settings.enabled)return {frames:EMPTY_FRAMES,diagnostics:[] as string[],error:undefined};
  try{
   if(!selected.startSnapshotId||selected.startSnapshotId===selected.endSnapshotId)throw Error('Choose two different endpoint snapshots.');
   if(!recording?.snapshotIds.includes(selected.startSnapshotId)||!recording.snapshotIds.includes(selected.endSnapshotId))throw Error('Choose endpoint snapshots from this Recording.');
   const start=cache.resolve(workspace,recordingId,selected.startSnapshotId,angle,stopAtWarpId,currentEvaluation),end=cache.resolve(workspace,recordingId,selected.endSnapshotId,angle,stopAtWarpId,currentEvaluation);
   return {...interpolateEndpointOnion(start,end,settings.step,recording),error:undefined};
  }catch(error){return {frames:EMPTY_FRAMES,diagnostics:[] as string[],error:error instanceof Error?error.message:String(error)};}
 },[cache,workspace,recordingId,recording?.interpolationWeights,angle.x,angle.y,settings.enabled,settings.step,stopAtWarpId,selected.startSnapshotId,selected.endSnapshotId,currentEvaluation]);
 return {...result,preparing:false};
}
