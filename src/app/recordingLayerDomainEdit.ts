import type {LandmarkProject} from '../domain/landmarks/model';
import {assertLayerDomainIntent,type LayerDomainIntent} from '../domain/drawing/layerDomainIntent';
import {prepareRecordingContext} from '../domain/recordingSnapshot/evaluation';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {writeLayerDomainOperation} from './layerDomainOperation';
import {prepareDrawingLayerDomainPlan} from '../domain/drawing/layerDomainEditPlan';

export interface RecordingLayerDomainEdit {recordingId:string;snapshotId:string;angle:{x:number;y:number};intent:LayerDomainIntent;validation?:'preview'|'full'}
export const RECORDING_CAGE_BASIS_REQUIRED='Persistent cage parameters are editable at a real snapshot in a triangulated Recording. Intermediate angles use temporary cages to edit curve responses. Select a saved viewpoint to edit its saved cage.';

/** Resolve a concrete owner without creating a view, geometry key or response.
 * Intermediate Drawing cage targets use the separate geometry-edit adapter;
 * choosing a nearby basis here would silently change the user's target. */
export function resolveRecordingLayerDomainTarget(workspace:RecordingSnapshotWorkspace,edit:Pick<RecordingLayerDomainEdit,'recordingId'|'snapshotId'|'angle'>) {
 const recording=workspace.recordings.find(value=>value.id===edit.recordingId),snapshot=workspace.snapshots.find(value=>value.id===edit.snapshotId);
 const vertex=recording?.mode==='triangulated'?recording.angleGraph?.mesh.vertices.find(value=>value.angle.x===edit.angle.x&&value.angle.y===edit.angle.y):undefined;
 if(!recording||!snapshot||!recording.snapshotIds.includes(snapshot.id)||vertex?.snapshotId!==snapshot.id||recording.angle.x!==edit.angle.x||recording.angle.y!==edit.angle.y)throw Error(RECORDING_CAGE_BASIS_REQUIRED);
 return {recording,snapshot};
}

/** Recording writes only the selected Snapshot draft. Library/source geometry
 * is read-only; shared snapshot-state validation supplies the ownership guard. */
export function prepareRecordingLayerDomainWorkspace(project:LandmarkProject,edit:RecordingLayerDomainEdit) {
 assertLayerDomainIntent(edit.intent);
 const workspace=project.recordingSnapshots;if(!workspace)throw Error('The Recording workspace is unavailable.');
 const {snapshot}=resolveRecordingLayerDomainTarget(workspace,edit),context=prepareRecordingContext(workspace,{useDraft:true,immutableInputs:true,diagnostics:'preview'}),evaluation=context.sample(edit.recordingId,{angle:edit.angle}),drawing=evaluation.drawing;
 const scope=prepareDrawingLayerDomainPlan(drawing,{layerIds:edit.intent.scope.layerIds,...edit.intent.domain.kind==='h-coons'?{strokeScope:edit.intent.domain.strokeScope}:{}});
 if(scope.layers.some(layer=>!snapshot.layers.some(value=>value.id===layer.id)))throw Error('A layer domain target no longer exists.');
 if(scope.layers.some(layer=>layer.locked)||scope.curves.some(curve=>curve.locked))throw Error('Unlock the selected layer and its curves before transforming the cage scope.');
 if(scope.separatesLinkedLayers)throw Error('Select every linked layer before transforming their shared endpoints.');
 const draft=snapshot.draft??{angle:{...snapshot.angle},deformation:emptySnapshotDeformationState(),channels:[]},layerDomains=writeLayerDomainOperation(draft.deformation.layerDomains,evaluation.state.layerDomains??[],edit.intent),next={...workspace,snapshots:workspace.snapshots.map(value=>value===snapshot?{...snapshot,draft:{...draft,deformation:{...draft.deformation,layerDomains}}}:value)};
 const result=context.forkCandidate(next,edit.recordingId).sample(edit.recordingId,{angle:edit.angle}),failed=result.diagnostics.find(issue=>issue.code==='LAYER_DOMAIN'&&issue.channelId===edit.intent.operationId);
 if(failed)throw Error(failed.message);
 const priorConflicts=new Set(evaluation.diagnostics.filter(issue=>issue.code==='RELATION_CONFLICT').map(issue=>JSON.stringify(issue)));
 if(result.diagnostics.some(issue=>issue.code==='RELATION_CONFLICT'&&!priorConflicts.has(JSON.stringify(issue))))throw Error('This layer domain would separate linked endpoint authorities. Transform their layers coherently.');
 return next;
}
