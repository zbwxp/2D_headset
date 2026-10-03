import {useMemo} from 'react';
import {evaluateRecordingSnapshot,resolveEndpointPairBasis,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import {interpolateSnapshotSurfaceOnion} from './surfaceOnion';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import type {SceneOnionFrame,SceneOnionSettings} from './angleInspection';
import {createEndpointOnionCache,defaultSceneOnionEndpoints,interpolateEndpointOnion,interpolateEndpointPairOnion,type SceneOnionEndpoints} from './endpointOnion';
export type {SceneOnionEndpoints} from './endpointOnion';

const EMPTY_FRAMES:SceneOnionFrame[]=[];
/** Explicit pair ghosts use the same final-space sampler and fixed basis as
 * the canvas. Both modes draw complete source cubics without visibility masks. */
export function useSnapshotOnionFrames(workspace:RecordingSnapshotWorkspace,recordingId:string,angle:Angle,settings:SceneOnionSettings,stopAtWarpId?:string,endpoints?:SceneOnionEndpoints,currentEvaluation?:SnapshotEvaluation){
 const cache=useMemo(()=>createEndpointOnionCache(),[]);
 const recording=workspace.recordings.find(value=>value.id===recordingId),views=recording?.snapshotIds.flatMap(id=>{const view=workspace.snapshots.find(value=>value.id===id);return view?[view]:[];})??[];
 const selected=endpoints??defaultSceneOnionEndpoints(views);
 const result=useMemo(()=>{
  if(!settings.enabled)return {frames:EMPTY_FRAMES,diagnostics:[] as string[],error:undefined};
  try{
   if(recording?.mode==='triangulated'){
    const current=currentEvaluation?.angleSurface?currentEvaluation:evaluateRecordingSnapshot(workspace,recordingId,{angle,useDraft:true,immutableInputs:true,diagnostics:'preview'});
    return {...interpolateSnapshotSurfaceOnion(recording,current,selected,settings.step),error:undefined};
   }
   if(recording?.mode==='endpoint-pair'){
    const pair=recording.endpointPair;if(!pair)throw Error('Choose the two endpoint bases for this Recording.');
    const canvas=currentEvaluation?.endpointPair,reused=canvas&&sameAngle(currentEvaluation!.angle,angle)&&canvas.startSnapshotId===pair.startSnapshotId&&canvas.endSnapshotId===pair.endSnapshotId?canvas:undefined;
    const basis=reused??resolveEndpointPairBasis(workspace,recordingId,{angle,diagnostics:'preview',immutableInputs:true,...(stopAtWarpId?{stopAtWarpId}:{})});
    const responses=reused?reused.responses:pair.draft?.responses??pair.responses;
    return {...interpolateEndpointPairOnion(basis.start,basis.end,settings.step,responses),error:undefined};
   }
   if(!selected.startSnapshotId||selected.startSnapshotId===selected.endSnapshotId)throw Error('Choose two different endpoint snapshots.');
   if(!recording?.snapshotIds.includes(selected.startSnapshotId)||!recording.snapshotIds.includes(selected.endSnapshotId))throw Error('Choose endpoint snapshots from this Recording.');
   const start=cache.resolve(workspace,recordingId,selected.startSnapshotId,angle,stopAtWarpId,currentEvaluation),end=cache.resolve(workspace,recordingId,selected.endSnapshotId,angle,stopAtWarpId,currentEvaluation);
   return {...interpolateEndpointOnion(start,end,settings.step),error:undefined};
  }catch(error){return {frames:EMPTY_FRAMES,diagnostics:[] as string[],error:error instanceof Error?error.message:String(error)};}
 },[cache,workspace,recordingId,recording?.mode,recording?.endpointPair,angle.x,angle.y,settings.enabled,settings.step,stopAtWarpId,selected.startSnapshotId,selected.endSnapshotId,currentEvaluation]);
 return {...result,preparing:false};
}
