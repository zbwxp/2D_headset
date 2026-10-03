import type {DrawingDocument} from '../drawing/model';
import {evaluateWarpTrack,evaluateVisibilityTrack,evaluateIntervalTrack,evaluateDepthTrack,evaluatePlacementTrack,evaluateShapeTrack,type SceneProgressMapper} from '../recordingScene/tracks';
import type {SceneShapeValue} from '../recordingScene/model';
import {snapshotChannelKey,type RecordingSnapshotWorkspace,type SnapshotRecording,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotPoseTrack,type SnapshotPoseTrackIndex,type SnapshotDiagnostic,type SnapshotMaterialIssue} from './model';
import {snapshotTrackProgressMapper,snapshotWeightNodeOwners,snapshotWeightLayerOwners} from './weights';

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
 for(const [id,value] of Object.entries(own.layers))layers[id]={...layers[id],...structuredClone(value),...(layers[id]?.visibility||value.visibility?{visibility:{...layers[id]?.visibility,...structuredClone(value.visibility??{})}}:{}),...(layers[id]?.intervals||value.intervals?{intervals:{...layers[id]?.intervals,...structuredClone(value.intervals??{})}}:{}),...(layers[id]?.elementPlacements||value.elementPlacements?{elementPlacements:{...layers[id]?.elementPlacements,...structuredClone(value.elementPlacements??{})}}:{})};
 return {warps:[...new Map([...fallback.warps,...own.warps].map(w=>[w.id,structuredClone(w)])).values()],bindings:[...new Map([...fallback.bindings,...own.bindings].map(b=>[b.layerId,{...b}])).values()],layers,relationPositions:{...structuredClone(fallback.relationPositions),...structuredClone(own.relationPositions)},...(fallback.intervalMaterialIssues||own.intervalMaterialIssues?{intervalMaterialIssues:{...structuredClone(fallback.intervalMaterialIssues??{}),...structuredClone(own.intervalMaterialIssues??{})}}:{})};
}
/** The old interpolation implementation is reused channel by channel. Its
 * authored lattice, empty keys, drafts, and exact zero scales stay unchanged. */
export function evaluateSnapshotState(snapshot:RecordingSnapshot,recording:SnapshotRecording|undefined,source:DrawingDocument,angle=snapshot.angle,useDraft=true,omitTrackIds:ReadonlySet<string>=new Set(),material?:{signature:(snapshotId:string)=>string|undefined;diagnostics:SnapshotDiagnostic[]},snapshots:readonly RecordingSnapshot[]=[snapshot]):SnapshotDeformationState {
 let state=mergeSnapshotDeformation(snapshot.inheritedState,snapshot.deformation);
 if(useDraft&&snapshot.draft&&snapshot.draft.angle.x===angle.x&&snapshot.draft.angle.y===angle.y)state=mergeSnapshotDeformation(state,snapshot.draft.deformation);
 const suspended=(issue:SnapshotMaterialIssue|undefined,channelId:string)=>{if(!issue||!material||material.signature(issue.sourceSnapshotId)===issue.sourceSignature)return false;material.diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,channelId,message:issue.message});return true;};
 for(const [id,issue] of Object.entries(state.intervalMaterialIssues??{}))if(suspended(issue,id))for(const layer of Object.values(state.layers))if(layer.intervals)delete layer.intervals[id];
 // Graph snapshots own their saved residual channels. Copy migration resolves
 // old keys once; keeping those keys is recovery evidence, not another live
 // authority which could affect a later view or overwrite a local draft.
 if(!recording||recording.mode==='triangulated')return state;
 const layerIds=new Set(snapshot.layers.map(l=>l.id)),dummy='snapshot';
 for(const asset of recording.interpolationWeights??[]){
  if(!layerIds.has(asset.target.layerId))continue;const start=snapshots.find(view=>view.id===asset.startSnapshotId),end=snapshots.find(view=>view.id===asset.endSnapshotId);
  if(start&&end&&start.angle.x!==end.angle.x&&start.angle.y!==end.angle.y)material?.diagnostics.push({code:'POSE',snapshotId:snapshot.id,layerId:asset.target.layerId,elementId:asset.target.curveId,message:'This interpolation weight pair changes both angle axes. Its endpoint onion response is available; runtime weighting requires an X-only or Y-only view pair.'});
 }
 const owners=recording.interpolationWeights?.length?snapshotWeightNodeOwners(source):undefined,layerOwners=owners?snapshotWeightLayerOwners(source):undefined,progress=new Map<string,SceneProgressMapper|undefined>();
 const mapper=(layerId:string,curveId?:string)=>{const key=JSON.stringify([layerId,curveId]);if(!progress.has(key))progress.set(key,snapshotTrackProgressMapper(recording,snapshots,layerId,curveId));return progress.get(key);};
 const curves=new Map(source.curves.map(curve=>[curve.id,curve]));
 const layerName=(id:string)=>source.layers.find(layer=>layer.id===id)?.name??id;
 for(const [layerId,authority] of layerOwners??[])if(layerId!==authority&&recording.tracks.some(track=>track.channel==='placement'&&track.targetId===layerId)&&recording.interpolationWeights?.some(asset=>asset.target.layerId===layerId&&!asset.target.curveId))material?.diagnostics.push({code:'POSE',snapshotId:snapshot.id,layerId,message:`Layer ${layerName(layerId)} uses ${layerName(authority)} as its placement response authority to preserve linked endpoints. Its own layer response still controls direct shape offsets.`});
 for(const track of recording.tracks){
  if(omitTrackIds.has(track.id))continue;
  if(!track.keys.length&&!(useDraft&&track.draft))continue;
  if(track.channel==='warp'){
   const warp=state.warps.find(w=>w.id===track.targetId);if(warp){
    const domains=new Set(state.bindings.filter(binding=>{let id:string|undefined=binding.warpId;const seen=new Set<string>();while(id&&!seen.has(id)){if(id===track.targetId)return true;seen.add(id);id=state.warps.find(value=>value.id===id)?.parentId;}return false;}).map(binding=>binding.layerId));
    // A Warp shared by layers remains one domain and one evaluation. It cannot
    // acquire one layer's timing without changing every other bound layer.
    warp.grid=evaluateWarpTrack({...track,...warp},angle,useDraft,domains.size===1?mapper([...domains][0]):undefined);
    if(domains.size>1&&recording.interpolationWeights?.some(asset=>domains.has(asset.target.layerId)&&!asset.target.curveId))material?.diagnostics.push({code:'POSE',snapshotId:snapshot.id,channelId:track.id,message:`Warp ${warp.name} is shared by ${[...domains].map(layerName).join(', ')} and keeps its original angle timing. Layer responses control placement and direct shape offsets.`});
   }
   continue;
  }
  if(track.channel==='relationPosition'){
   const relation=state.relationPositions[track.targetId];if(!relation)continue;
   const layer=source.endpointLinks?.filter(link=>relation.sourceLinkIds.includes(link.id)).flatMap(link=>[link.a,link.b].map(end=>owners?.get(curves.get(end.curveId)?.nodes[end.end]??'')?.layerId)).filter((id):id is string=>!!id).sort()[0];
   const value:SceneShapeValue=evaluateShapeTrack({id:track.id,interpolation:track.interpolation,instanceId:dummy,keys:track.keys.map(k=>({...k,value:{nodes:{point:k.value},handles:{}}})),...(track.draft?{draft:{angle:track.draft.angle,value:{nodes:{point:track.draft.value},handles:{}}}}:{})},angle,useDraft,layer?mapper(layer):undefined);
   relation.offset=value.nodes.point??[0,0];continue;
  }
  if(!layerIds.has(track.targetId))continue;
  const layer=state.layers[track.targetId]??(state.layers[track.targetId]={});
  switch(track.channel){
   case 'placement':{const value=evaluatePlacementTrack({...track,instanceId:dummy},angle,useDraft,mapper(track.elementId?track.targetId:layerOwners?.get(track.targetId)??track.targetId,track.elementId));if(track.elementId){if(curves.has(track.elementId))(layer.elementPlacements??={})[track.elementId]=value;}else layer.placement=value;break;}
   case 'shape':{
    const sampled=evaluateShapeTrack({...track,instanceId:dummy},angle,useDraft,mapper(track.targetId)),value=owners?{nodes:{...sampled.nodes},handles:{...sampled.handles}}:sampled;
    if(owners){
     // Only sparse entry values are resampled for overrides; geometry and Warp
     // fitting still run once. Shared/linked nodes always use their one layer
     // authority, while each curve owns its direct handle-vector deltas.
     const groups=new Map<string,{layerId:string;curveId?:string;nodes:Set<string>;handles:Set<string>}>();
     const group=(layerId:string,curveId?:string)=>{const key=JSON.stringify([layerId,curveId]);let value=groups.get(key);if(!value){value={layerId,curveId,nodes:new Set(),handles:new Set()};groups.set(key,value);}return value;};
     for(const id of Object.keys(value.nodes)){const owner=owners.get(id);if(owner&&(owner.layerId!==track.targetId||owner.curveId&&recording.interpolationWeights?.some(asset=>asset.target.layerId===owner.layerId&&asset.target.curveId===owner.curveId)))group(owner.layerId,owner.curveId).nodes.add(id);}
     for(const id of Object.keys(value.handles))if(recording.interpolationWeights?.some(asset=>asset.target.layerId===track.targetId&&asset.target.curveId===id))group(track.targetId,id).handles.add(id);
     for(const entry of groups.values()){
      const select=(value:SceneShapeValue):SceneShapeValue=>({nodes:Object.fromEntries(Object.entries(value.nodes).filter(([id])=>entry.nodes.has(id))),handles:Object.fromEntries(Object.entries(value.handles).filter(([id])=>entry.handles.has(id)))});
      const picked=evaluateShapeTrack({...track,instanceId:dummy,keys:track.keys.map(key=>({...key,value:select(key.value)})),...(track.draft?{draft:{...track.draft,value:select(track.draft.value)}}:{})},angle,useDraft,mapper(entry.layerId,entry.curveId));
      Object.assign(value.nodes,picked.nodes);Object.assign(value.handles,picked.handles);
     }
    }
    layer.shape=value;break;
   }
   case 'depth':layer.depth=evaluateDepthTrack({...track,target:{instanceId:dummy,sourceLayerId:track.targetId}},angle,useDraft);break;
   case 'visibility':(layer.visibility??={})[track.elementId??track.targetId]=evaluateVisibilityTrack({...track,target:{instanceId:dummy,sourceLayerId:track.targetId,...(track.elementId?{sourceObjectId:track.elementId}:{})}},angle,useDraft);break;
   case 'interval':if(suspended(track.materialIssue,track.id)){if(layer.intervals)delete layer.intervals[track.sourceTrackId];break;}if(source.displayIntervals?.some(t=>t.id===track.sourceTrackId))try{(layer.intervals??={})[track.sourceTrackId]=evaluateIntervalTrack({...track,instanceId:dummy},source,angle,useDraft);}catch(error){material?.diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,channelId:track.id,message:error instanceof Error?error.message:String(error)});}break;
  }
 }
 return state;
}
export const snapshotTrackTargetKey=(track:SnapshotPoseTrack)=>snapshotChannelKey(track.channel,track.targetId,track.channel==='interval'?track.sourceTrackId:track.elementId);
