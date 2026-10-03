import type {LandmarkProject} from '../domain/landmarks/model';
import type {DrawingDocument} from '../domain/drawing/model';
import type {DrawingSnapshotState} from '../domain/drawing/snapshots';
import type {RecordingSnapshot,RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
import {validateMirrorEditing} from '../domain/drawing/mirrorEditing';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {drawingSourceOwns,remapWorkingSnapshotSource,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {syncPoseSnapshots} from '../domain/recording/poses';
import {prepareDrawingWorkingCopyTransition} from './drawingWorkingCopies';
import {remapWorkingSceneSource,syncRecordingSceneSources} from './recordingSceneSources';
import {recordingSourceBaselines,syncVectorRecordingSources} from './vectorSourceSync';

/** Both rooms edit this context. Snapshot originals live in workspace.library;
 * Drawing's old documents are explicit adapters for their originIds only.
 * Referenced layers never own copies of the elements they resolve. */
export interface SnapshotEditContext {
 readonly project:LandmarkProject;
 readonly workspace:RecordingSnapshotWorkspace|undefined;
 readonly canEditOriginals:boolean;
}
export function snapshotEditContext(project:LandmarkProject,canEditOriginals:boolean):SnapshotEditContext{
 return {project,workspace:project.recordingSnapshots,canEditOriginals};
}

export type SnapshotEdit =
 | {kind:'original-geometry';drawing:DrawingDocument}
 | {kind:'original-state';state:DrawingSnapshotState}
 | {kind:'snapshot-state';workspace:RecordingSnapshotWorkspace;validation?:'full'|'preview'};
export interface SnapshotEditPlan {
 readonly before:LandmarkProject;
 readonly project:LandmarkProject;
 readonly changed:boolean;
}
const same=(before:unknown,after:unknown)=>before===after||JSON.stringify(before)===JSON.stringify(after);
const sourceOnly=(snapshot:RecordingSnapshot)=>({
 kind:snapshot.kind,source:snapshot.source,
 layers:snapshot.layers.filter(layer=>layer.kind==='original'&&drawingSourceOwns(snapshot,layer.id)),
 relations:Object.fromEntries((['joins','endpointLinks','groups','displayIntervals'] as const).map(kind=>[kind,{
  add:snapshot.relations[kind]?.add?.filter(value=>drawingSourceOwns(snapshot,value.id))??[],
 }])),
});

/** Recording can create independent canonical originals (cloneLayers), and
 * edit any local residual. It cannot replace, delete or reassign an adapter's
 * original identities, including retained orphan identities and relations. */
function assertOriginalsUnchanged(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace):void{
 const reject=()=>{throw Error('Snapshot edits cannot modify Drawing-owned originals. Use the original-source adapter in Drawing mode.');};
 const sources=new Map(before.snapshots.filter(snapshot=>snapshot.source).map(snapshot=>[snapshot.id,snapshot]));
 for(const snapshot of after.snapshots)if(snapshot.source&&!sources.has(snapshot.id))reject();
 const nextSnapshots=new Map(after.snapshots.map(snapshot=>[snapshot.id,snapshot]));
 for(const source of sources.values()){
  const next=nextSnapshots.get(source.id);if(!next||next!==source&&!same(sourceOnly(source),sourceOnly(next)))reject();
  for(const category of ['nodes','curves','fills','offsets'] as const){
   if(before.library[category]===after.library[category])continue;
   for(const id of Object.keys(source.source!.originIds))if(!same(before.library[category][id],after.library[category][id]))reject();
  }
 }
 if(!same(before.legacyArchive,after.legacyArchive))throw Error('Snapshot edits must preserve the original project archive.');
}

/** Preserve old adapters/checkpoints without making them a second authority
 * for Recording edits. Only an original-source transaction refreshes them. */
function prepareOriginalState(before:LandmarkProject,incoming:DrawingSnapshotState):LandmarkProject{
 const prepared=prepareDrawingWorkingCopyTransition(before,incoming),{drawing,drawingSnapshots,drawingWorkingCopies}=prepared.state,promotion=prepared.promotedWorkingArtworkId;
 if(drawing){assertDisplayRouteSupport(drawing);validateMirrorEditing(drawing);}
 const vectorRecording=promotion&&before.vectorRecording?{...before.vectorRecording,rigs:before.vectorRecording.rigs.map(rig=>rig.artworkId==='$working'?{...rig,artworkId:promotion}:rig)}:before.vectorRecording;
 const project:LandmarkProject={...before,drawing,drawingSnapshots,drawingWorkingCopies,
  ...(vectorRecording?{vectorRecording}:{}),
  ...(promotion&&before.recordingScenes?{recordingScenes:remapWorkingSceneSource(before.recordingScenes,promotion)}:{}),
  ...(promotion&&before.recordingSnapshots?{recordingSnapshots:remapWorkingSnapshotSource(before.recordingSnapshots,promotion)}:{}),
  ...(before.poseRecording?{poseRecording:syncPoseSnapshots(syncPoseSnapshots(before.poseRecording,before.drawingSnapshots),drawingSnapshots)}:{}),
 };
 // Sync every source: an inactive same-ID working copy wins over its checkpoint.
 // This is the single material transport boundary for a source transaction.
 if(project.recordingSnapshots)return syncRecordingSnapshotSources(project);
 return syncRecordingSceneSources(project.recordingScenes?project:syncVectorRecordingSources(project,recordingSourceBaselines(before)),before);
}

/** Pure common transaction entry. Checks and source propagation finish before
 * the store writes/persists the resulting project. Discrete Recording commits
 * also validate before opening history; source gestures retain their caller's
 * single Undo boundary. Previews share ownership guards without deep parsing. */
export function prepareSnapshotEdit(context:SnapshotEditContext,edit:SnapshotEdit):SnapshotEditPlan{
 const before=context.project;let project:LandmarkProject;
 if(edit.kind==='snapshot-state'){
  const original=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots;
  assertOriginalsUnchanged(original,edit.workspace);
  const recordingSnapshots=edit.validation==='preview'?edit.workspace:parseRecordingSnapshots(edit.workspace);
  project=recordingSnapshots===context.workspace?before:{...before,recordingSnapshots};
 }else{
  if(!context.canEditOriginals)throw Error('录制模式不能修改源画稿。请先返回绘制模式。');
  const state=edit.kind==='original-geometry'?{drawing:finalizeGeometryEdit(before.drawing,edit.drawing),drawingSnapshots:before.drawingSnapshots}:edit.state;
  project=prepareOriginalState(before,state);
 }
 return {before,project,changed:project!==before};
}
