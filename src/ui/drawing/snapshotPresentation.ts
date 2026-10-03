import type {DrawingDocument} from '../../domain/drawing/model';
import {resolveSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {drawingIdentityIds,drawingSnapshotForArtwork,drawingSourceOwns,remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';

export interface DrawingSnapshotLayerOwner {
 snapshotId:string;
 layerId:string;
 /** Source-original writes go through the Drawing adapter; every other layer
  * writes local snapshot state and must never enter setDrawing. */
 kind:'source-original'|'snapshot-local';
}
export interface DrawingSnapshotPresentation {
 snapshotId:string;
 drawing:DrawingDocument;
 evaluation:SnapshotEvaluation;
 layerOwners:ReadonlyMap<string,DrawingSnapshotLayerOwner>;
 canonicalId:(presentationId:string)=>string;
 presentationId:(canonicalId:string)=>string;
}

/** Read-only view adapter for the native Drawing renderer and hit testing.
 * Original source IDs retain their existing UI addresses. Reference members
 * retain canonical IDs. Neither the result nor its local geometry is a source
 * document: callers must route writes through layerOwners. */
export function drawingSnapshotPresentation(workspace:RecordingSnapshotWorkspace,artworkId:string):DrawingSnapshotPresentation|undefined {
 const snapshot=drawingSnapshotForArtwork(workspace,artworkId);if(!snapshot?.source)return undefined;
 const evaluation=resolveSnapshot(workspace,snapshot.id,{useDraft:false,diagnostics:'preview',immutableInputs:true});
 const originals=snapshot.source.originIds,canonicalIds=new Map<string,string>();
 const presentationId=(id:string)=>Object.hasOwn(originals,id)?originals[id]:id;
 for(const id of drawingIdentityIds(evaluation.drawing)){
  const presented=presentationId(id),previous=canonicalIds.get(presented);
  if(previous&&previous!==id)throw Error('Drawing reference identity conflicts with an original source identity.');
  canonicalIds.set(presented,id);
 }
 const layerOwners=new Map<string,DrawingSnapshotLayerOwner>(snapshot.layers.map(layer=>[presentationId(layer.id),{snapshotId:snapshot.id,layerId:layer.id,kind:layer.kind==='original'&&drawingSourceOwns(snapshot,layer.id)?'source-original':'snapshot-local'}]));
 return {snapshotId:snapshot.id,drawing:remapDrawingIdentities(evaluation.drawing,presentationId),evaluation,layerOwners,canonicalId:id=>canonicalIds.get(id)??id,presentationId};
}
