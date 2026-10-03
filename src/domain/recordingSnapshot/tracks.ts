import {mergeSnapshotCurveAppearance} from './curveAppearance';
import {mergeLayerDomains} from './layerDomains';
import type {DrawingDocument} from '../drawing/model';
import {evaluateWarpTrack,evaluateVisibilityTrack,evaluateIntervalTrack,evaluateDepthTrack,evaluatePlacementTrack,evaluateShapeTrack} from '../recordingScene/tracks';
import type {SceneShapeValue} from '../recordingScene/model';
import {snapshotChannelKey,type RecordingSnapshotWorkspace,type SnapshotRecording,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotPoseTrack,type SnapshotPoseTrackIndex,type SnapshotDiagnostic,type SnapshotMaterialIssue} from './model';

export function recordingForSnapshot(workspace:RecordingSnapshotWorkspace,snapshotId:string):SnapshotRecording|undefined {
 return workspace.recordings.find(r=>r.snapshotIds.includes(snapshotId));
}
/** An index is a projection of recording tracks. It never adds authored samples. */
export function recordingPoseTrackIndex(recording:SnapshotRecording,workspace?:RecordingSnapshotWorkspace):SnapshotPoseTrackIndex[]{
 return recording.tracks.map(track=>({channel:track.channel,targetId:track.targetId,...(track.elementId?{elementId:track.elementId}:{}),interpolation:track.interpolation??'independent',keys:track.keys.map(key=>{const owner=workspace?.snapshots.find(s=>recording.snapshotIds.includes(s.id)&&s.authored.some(ref=>ref.trackId===track.id&&ref.keyId===key.id));return {...(owner?{snapshotId:owner.id}:{}),channelId:track.id,keyId:key.id,angle:{...key.angle},...(key.name?{name:key.name}:{})};})}));
}
export function snapshotAuthoredKeyCount(recording:SnapshotRecording,channel?:SnapshotPoseTrack['channel'],targetId?:string):number {
 return recording.tracks.filter(t=>(!channel||t.channel===channel)&&(!targetId||t.targetId===targetId)).reduce((n,t)=>n+t.keys.length,0);
}
export function mergeSnapshotDeformation(fallback:SnapshotDeformationState|undefined,own:SnapshotDeformationState):SnapshotDeformationState {
 if(!fallback)return structuredClone(own);
 const layers=structuredClone(fallback.layers);
 for(const [id,value] of Object.entries(own.layers))layers[id]={...layers[id],...structuredClone(value),...(layers[id]?.curveAppearance||value.curveAppearance?{curveAppearance:mergeSnapshotCurveAppearance(layers[id]?.curveAppearance,value.curveAppearance)}:{}),...(layers[id]?.visibility||value.visibility?{visibility:{...layers[id]?.visibility,...structuredClone(value.visibility??{})}}:{}),...(layers[id]?.intervals||value.intervals?{intervals:{...layers[id]?.intervals,...structuredClone(value.intervals??{})}}:{}),...(layers[id]?.elementPlacements||value.elementPlacements?{elementPlacements:{...layers[id]?.elementPlacements,...structuredClone(value.elementPlacements??{})}}:{})};
 return {...(fallback.layerDomains||own.layerDomains?{layerDomains:mergeLayerDomains(fallback.layerDomains,own.layerDomains)}:{}),warps:[...new Map([...fallback.warps,...own.warps].map(w=>[w.id,structuredClone(w)])).values()],bindings:[...new Map([...fallback.bindings,...own.bindings].map(b=>[b.layerId,{...b}])).values()],layers,relationPositions:{...structuredClone(fallback.relationPositions),...structuredClone(own.relationPositions)},...(fallback.intervalMaterialIssues||own.intervalMaterialIssues?{intervalMaterialIssues:{...structuredClone(fallback.intervalMaterialIssues??{}),...structuredClone(own.intervalMaterialIssues??{})}}:{})};
}
/** The old interpolation implementation is reused channel by channel. Its
 * authored lattice, empty keys, drafts, and exact zero scales stay unchanged. */
export function evaluateSnapshotState(snapshot:RecordingSnapshot,recording:SnapshotRecording|undefined,source:DrawingDocument,angle=snapshot.angle,useDraft=true,omitTrackIds:ReadonlySet<string>=new Set(),material?:{signature:(snapshotId:string)=>string|undefined;diagnostics:SnapshotDiagnostic[]}):SnapshotDeformationState {
 let state=mergeSnapshotDeformation(snapshot.inheritedState,snapshot.deformation);
 if(useDraft&&snapshot.draft&&snapshot.draft.angle.x===angle.x&&snapshot.draft.angle.y===angle.y)state=mergeSnapshotDeformation(state,snapshot.draft.deformation);
 const suspended=(issue:SnapshotMaterialIssue|undefined,channelId:string)=>{if(!issue||!material||material.signature(issue.sourceSnapshotId)===issue.sourceSignature)return false;material.diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,channelId,message:issue.message});return true;};
 for(const [id,issue] of Object.entries(state.intervalMaterialIssues??{}))if(suspended(issue,id))for(const layer of Object.values(state.layers))if(layer.intervals)delete layer.intervals[id];
 // Graph snapshots own their saved residual channels. Copy migration resolves
 // old keys once; keeping those keys is recovery evidence, not another live
 // authority which could affect a later view or overwrite a local draft.
 if(!recording||recording.mode==='triangulated')return state;
 const layerIds=new Set(snapshot.layers.map(l=>l.id)),dummy='snapshot';
 const curves=new Map(source.curves.map(curve=>[curve.id,curve]));
 for(const track of recording.tracks){
  if(omitTrackIds.has(track.id))continue;
  if(!track.keys.length&&!(useDraft&&track.draft))continue;
  if(track.channel==='warp'){
   const warp=state.warps.find(w=>w.id===track.targetId);if(warp)warp.grid=evaluateWarpTrack({...track,...warp},angle,useDraft);
   continue;
  }
  if(track.channel==='relationPosition'){
   const relation=state.relationPositions[track.targetId];if(!relation)continue;
   const value:SceneShapeValue=evaluateShapeTrack({id:track.id,interpolation:track.interpolation,instanceId:dummy,keys:track.keys.map(k=>({...k,value:{nodes:{point:k.value},handles:{}}})),...(track.draft?{draft:{angle:track.draft.angle,value:{nodes:{point:track.draft.value},handles:{}}}}:{})},angle,useDraft);
   relation.offset=value.nodes.point??[0,0];continue;
  }
  if(!layerIds.has(track.targetId))continue;
  const layer=state.layers[track.targetId]??(state.layers[track.targetId]={});
  switch(track.channel){
   case 'placement':{const value=evaluatePlacementTrack({...track,instanceId:dummy},angle,useDraft);if(track.elementId){if(curves.has(track.elementId))(layer.elementPlacements??={})[track.elementId]=value;}else layer.placement=value;break;}
   case 'shape':layer.shape=evaluateShapeTrack({...track,instanceId:dummy},angle,useDraft);break;
   case 'depth':layer.depth=evaluateDepthTrack({...track,target:{instanceId:dummy,sourceLayerId:track.targetId}},angle,useDraft);break;
   case 'visibility':(layer.visibility??={})[track.elementId??track.targetId]=evaluateVisibilityTrack({...track,target:{instanceId:dummy,sourceLayerId:track.targetId,...(track.elementId?{sourceObjectId:track.elementId}:{})}},angle,useDraft);break;
   case 'interval':if(suspended(track.materialIssue,track.id)){if(layer.intervals)delete layer.intervals[track.sourceTrackId];break;}if(source.displayIntervals?.some(t=>t.id===track.sourceTrackId))try{(layer.intervals??={})[track.sourceTrackId]=evaluateIntervalTrack({...track,instanceId:dummy},source,angle,useDraft);}catch(error){material?.diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,channelId:track.id,message:error instanceof Error?error.message:String(error)});}break;
  }
 }
 return state;
}
export const snapshotTrackTargetKey=(track:SnapshotPoseTrack)=>snapshotChannelKey(track.channel,track.targetId,track.channel==='interval'?track.sourceTrackId:track.elementId);
