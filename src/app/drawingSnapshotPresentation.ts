import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from '../domain/drawing/evaluatedAffine';
import {resolveSnapshot,type SnapshotEvaluation} from '../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {drawingIdentityIds,drawingSnapshotForArtwork,drawingSourceOwns,materializeOriginalSnapshot,remapDrawingIdentities} from '../domain/recordingSnapshot/sources';

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
const presentations=new WeakMap<RecordingSnapshotWorkspace,Map<string,DrawingSnapshotPresentation>>();
const EMPTY=emptyDrawing();

/** Every native Drawing tool reads this same immutable presentation. Other
 * workspaces still edit their own original document through their adapter. */
export function currentDrawingPresentation(project:LandmarkProject,workspaceId='drawing'):DrawingDocument {
 if(workspaceId==='drawing'&&project.recordingSnapshots){const view=drawingSnapshotPresentation(project.recordingSnapshots,project.drawingSnapshots?.activeId??'$working');if(view)return view.drawing;}
 const drawing=project.drawing??EMPTY;return drawing.version===3?drawing:parseDrawing(drawing);
}

/** Read-only view adapter for the native Drawing renderer and hit testing.
 * Original source IDs retain their existing UI addresses. Reference members
 * retain canonical IDs. Neither the result nor its local geometry is a source
 * document: callers must route writes through layerOwners. */
export function drawingSnapshotPresentation(workspace:RecordingSnapshotWorkspace,artworkId:string):DrawingSnapshotPresentation|undefined {
 const cached=presentations.get(workspace)?.get(artworkId);if(cached)return cached;
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
 const canonicalId=(id:string)=>canonicalIds.get(id)??id;
 const drawing=remapDrawingIdentities(evaluation.drawing,presentationId),original=materializeOriginalSnapshot(workspace,snapshot.id);
 // Image and mirror controls belong to the original adapter. Resolution does
 // not carry these editor-only fields or original layer locking into its view.
 if(original){const metadata=remapDrawingIdentities(original,presentationId);for(const key of ['reference','mirrorAxisX','mirrorEditing'] as const)if(metadata[key]!==undefined)Object.assign(drawing,{[key]:metadata[key]});
  drawing.layers=drawing.layers.map(layer=>{const source=metadata.layers.find(value=>value.id===layer.id);return source?{...layer,visible:source.visible&&layer.visible,locked:source.locked||layer.locked}:layer;});}
 const material=evaluatedAffineSource(evaluation.drawing);if(material)registerEvaluatedAffine(drawing,remapDrawingIdentities(material,presentationId),id=>evaluatedAffine(evaluation.drawing,canonicalId(id)));
 const result={snapshotId:snapshot.id,drawing,evaluation,layerOwners,canonicalId,presentationId};
 const cache=presentations.get(workspace)??new Map();cache.set(artworkId,result);presentations.set(workspace,cache);return result;
}
