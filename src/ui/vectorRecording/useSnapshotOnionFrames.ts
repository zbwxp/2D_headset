import {useEffect,useMemo,useState} from 'react';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import type {Angle} from '../../domain/vectorRecording/interpolation';
import {createSceneOnionSweepQueue,markSceneOnionHighlights,normalizeSceneOnionSettings,sampleSceneOnionAngles,sceneOnionSweepAnchor,snapshotOnionInspectionSignature,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';

const EMPTY_FRAMES:SceneOnionFrame[]=[];
/** The workspace is the canvas's live preview workspace. Only current-angle
 * drafts become temporary interpolation keys in a detached evaluation copy. */
export function useSnapshotOnionFrames(workspace:RecordingSnapshotWorkspace,recordingId:string,angle:Angle,settings:SceneOnionSettings,stopAtWarpId?:string){
 const signature=useMemo(()=>snapshotOnionInspectionSignature(workspace,recordingId,angle),[workspace,recordingId,angle.x,angle.y]);
 const inspection=useMemo(()=>JSON.parse(signature) as RecordingSnapshotWorkspace,[signature]);
 const {enabled,axis,step,min,max}=normalizeSceneOnionSettings(settings),fixed=sceneOnionSweepAnchor(angle,axis)[axis==='x'?'y':'x'];
 const scope=JSON.stringify([recordingId,stopAtWarpId,axis,step,min,max,fixed]);
 const request=useMemo(()=>({scope,workspace:inspection,recordingId,stopAtWarpId,settings:{enabled:true,axis,step,min,max,opacity:1},angles:sampleSceneOnionAngles(axis==='x'?{x:0,y:fixed}:{x:fixed,y:0},{enabled:true,axis,step,min,max,opacity:1},true)}),[scope,inspection,recordingId,stopAtWarpId,axis,step,min,max,fixed]);
 const [result,setResult]=useState<{request:typeof request;frames:SceneOnionFrame[];error?:string}|null>(null);
 const queue=useMemo(()=>createSceneOnionSweepQueue<typeof request,SceneOnionFrame>(
  item=>item.angles.length,
  (item,index)=>{
   const evaluated=evaluateRecordingSnapshot(item.workspace,item.recordingId,{angle:item.angles[index],useDraft:false,diagnostics:'preview',...(item.stopAtWarpId?{stopAtWarpId:item.stopAtWarpId}:{})});
   return {angle:evaluated.angle,drawing:evaluated.drawing,paintBatches:evaluated.paintBatches};
  },
  (item,frames,error)=>setResult({request:item,frames:markSceneOnionHighlights(frames,item.settings),error}),
 ),[scope]);
 // Finish a coherent sweep before taking the newest drag input. Repeated
 // pointer moves cannot indefinitely cancel all work. Changing the coordinate
 // space/range cancels the queue and immediately hides incompatible contours.
 useEffect(()=>{if(enabled)queue.update(request);else queue.cancel();},[queue,request,enabled]);
 useEffect(()=>()=>queue.cancel(),[queue]);
 const ready=enabled&&result?.request===request,compatible=enabled&&result?.request.scope===scope;
 return {frames:compatible?result.frames:EMPTY_FRAMES,preparing:enabled&&!ready,error:ready?result.error:undefined};
}
