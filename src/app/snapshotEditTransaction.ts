import {isNonlinearLayerDomain} from '../domain/recordingSnapshot/layerDomains';
import {snapshotWithObjectLocks,type SnapshotObjectLocks} from '../domain/recordingSnapshot/objectLocks';
import {prepareRecordingLayerDomainWorkspace,type RecordingLayerDomainEdit} from './recordingLayerDomainEdit';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {hasNonlinearDeformationFor,evaluatedMaterialProgram} from '../domain/drawing/evaluatedDeformation';
import {prepareSnapshotDrawingTopologyEdit,prepareSnapshotLocalDrawingEdit,type SnapshotDrawingTopologyEdit,type SnapshotLocalDrawingEdit} from '../domain/recordingSnapshot/drawingTopology';
import {prepareDrawingLayerDomainEdit} from './drawingSnapshotEdit';
import type {LandmarkProject} from '../domain/landmarks/model';
import {propagateAutomaticSnapshotLayers} from '../domain/recordingSnapshot/automaticSnapshotEdits';
import type {DrawingDocument} from '../domain/drawing/model';
import {applyLayerEditIntent,curveSplitIntents,type LayerEditIntent,type CurveSplitIntent,type LayerDomainIntent} from '../domain/drawing/layerEditIntent';
import {transferSnapshotSplitResponses,pruneSnapshotResponseDependencies} from '../domain/recordingSnapshot/responseExpressionTransactions';
import {canonicalSnapshotLayerEditIntent,prepareSnapshotCurveSplits,finishSnapshotCurveSplits,splitSnapshotLocalCurve,type SnapshotCurveSplitBatchPlan} from '../domain/recordingSnapshot/topologyEdits';
import type {DrawingSnapshotState} from '../domain/drawing/snapshots';
import type {RecordingSnapshot,RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
import {validateMirrorEditing} from '../domain/drawing/mirrorEditing';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {drawingSnapshotForArtwork,drawingSourceOwns,remapWorkingSnapshotSource,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
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
 | {kind:'object-locks';snapshotId:string;changes:SnapshotObjectLocks}
 | ({kind:'recording-layer-domain'}&RecordingLayerDomainEdit)
 | {kind:'layer-domain';intent:LayerDomainIntent;allowRelated?:boolean}
 | {kind:'original-geometry';drawing:DrawingDocument;intent?:LayerEditIntent}
 | {kind:'original-state';state:DrawingSnapshotState;intent?:LayerEditIntent}
 | ({kind:'local-drawing-topology'}&SnapshotDrawingTopologyEdit)
 | ({kind:'snapshot-local-drawing'}&SnapshotLocalDrawingEdit)
 | {kind:'local-curve-split';snapshotId:string;intent:CurveSplitIntent}
 | {kind:'snapshot-state';workspace:RecordingSnapshotWorkspace;validation?:'full'|'preview'};
export interface SnapshotEditPlan {
 readonly before:LandmarkProject;
 readonly project:LandmarkProject;
 readonly changed:boolean;
 readonly diagnostics?:readonly {code:string;message:string;snapshotId?:string}[];
}
const same=(before:unknown,after:unknown)=>before===after||JSON.stringify(before)===JSON.stringify(after);
const sourceOnly=(snapshot:RecordingSnapshot)=>({
 kind:snapshot.kind,source:snapshot.source,
 layers:snapshot.layers.filter(layer=>layer.kind==='original'&&drawingSourceOwns(snapshot,layer.id)).map(({membership,...layer})=>layer),
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
function prepareOriginalState(before:LandmarkProject,incoming:DrawingSnapshotState,splitPlan?:SnapshotCurveSplitBatchPlan):LandmarkProject{
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
 if(project.recordingSnapshots){
  const source=splitPlan?.before.snapshots.find(value=>value.id===splitPlan.sourceSnapshotId);
  const synced=syncRecordingSnapshotSources(project,undefined,splitPlan?{splitRetirements:new Map([[source!.source!.artworkId,new Set([...splitPlan.plans.map(plan=>plan.intent.curveId),...splitPlan.mirrorPairs.map(pair=>pair.oldPairId)])]]),deferMaterialTransport:true}:{});
  let recordingSnapshots=splitPlan?finishSnapshotCurveSplits(splitPlan,synced.recordingSnapshots!):pruneSnapshotResponseDependencies(synced.recordingSnapshots!);
  if(splitPlan)for(const plan of splitPlan.plans){
   // Geometry responses accumulate across paired splits, while frozen old
   // real drawings must still use their old material topology coordinate frame.
   const recordings=recordingSnapshots.recordings.map(recording=>{if(!recording.angleGraph)return recording;const original=splitPlan!.before.recordings.find(value=>value.id===recording.id)?.angleGraph;return {...recording,angleGraph:{...recording.angleGraph,materialPartitions:original?.materialPartitions,materialPathLineages:original?.materialPathLineages}};});
   recordingSnapshots=transferSnapshotSplitResponses({...splitPlan.before,recordings},recordingSnapshots,plan.intent);
  }
  return recordingSnapshots===synced.recordingSnapshots?synced:{...synced,recordingSnapshots};
 }
 return syncRecordingSceneSources(project.recordingScenes?project:syncVectorRecordingSources(project,recordingSourceBaselines(before)),before);
}

/** Pure common transaction entry. Checks and source propagation finish before
 * the store writes/persists the resulting project. Discrete Recording commits
 * also validate before opening history; source gestures retain their caller's
 * single Undo boundary. Previews share ownership guards without deep parsing. */
export function prepareSnapshotEdit(context:SnapshotEditContext,edit:SnapshotEdit):SnapshotEditPlan{
 if(edit.kind==='object-locks'){
  const before=context.project,workspace=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots,snapshot=workspace.snapshots.find(value=>value.id===edit.snapshotId);if(!snapshot)throw Error('The lock target Snapshot no longer exists.');
  const next=snapshotWithObjectLocks(snapshot,resolveSnapshot(workspace,snapshot.id,{useDraft:true,diagnostics:'preview'}).drawing,edit.changes);
  if(next===snapshot)return {before,project:before,changed:false};
  return prepareSnapshotEdit(context,{kind:'snapshot-state',workspace:{...workspace,snapshots:workspace.snapshots.map(value=>value===snapshot?next:value)}});
 }
 if(edit.kind==='recording-layer-domain')return prepareSnapshotEdit(context,{kind:'snapshot-state',workspace:prepareRecordingLayerDomainWorkspace(context.project,edit),validation:edit.validation});
 if(edit.kind==='layer-domain')return prepareDrawingLayerDomainEdit(context.project,edit.intent,{canEditOriginals:context.canEditOriginals,allowRelated:edit.allowRelated});
 const before=context.project;let project:LandmarkProject;let diagnostics:readonly {code:string;message:string;snapshotId?:string}[]|undefined;
 if(edit.kind==='local-drawing-topology'||edit.kind==='snapshot-local-drawing'){
  const original=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots,result=edit.kind==='local-drawing-topology'?prepareSnapshotDrawingTopologyEdit(original,edit):prepareSnapshotLocalDrawingEdit(original,edit);
  assertOriginalsUnchanged(original,result.workspace);
  return {before,project:result.workspace===original?before:{...before,recordingSnapshots:result.workspace},changed:result.workspace!==original,diagnostics:result.diagnostics};
 }
 if(edit.kind==='local-curve-split'){
  const original=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots;
  assertCageSplitSupported(original,[edit.intent.curveId],edit.snapshotId);
  const result=splitSnapshotLocalCurve(original,edit.snapshotId,edit.intent);
  assertOriginalsUnchanged(original,result.workspace);diagnostics=result.diagnostics;project={...before,recordingSnapshots:parseRecordingSnapshots(result.workspace)};
  return {before,project,changed:true,diagnostics};
 }
 if(edit.kind==='snapshot-state'){
  const original=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots;
  assertOriginalsUnchanged(original,edit.workspace);
  const propagated=propagateAutomaticSnapshotLayers(original,edit.workspace).workspace;
  const recordingSnapshots=edit.validation==='preview'?propagated:parseRecordingSnapshots(propagated);
  project=recordingSnapshots===context.workspace?before:{...before,recordingSnapshots};
 }else{
  if(!context.canEditOriginals)throw Error('录制模式不能修改源画稿。请先返回绘制模式。');
  const state=edit.kind==='original-geometry'?{drawing:finalizeGeometryEdit(before.drawing,edit.drawing),drawingSnapshots:before.drawingSnapshots}:edit.state;
  let splitPlan:SnapshotCurveSplitBatchPlan|undefined;
  if(edit.intent){
   if(edit.intent.kind==='layer-domain')throw Error('Resolve layer domain ownership through the Drawing Snapshot adapter before writing source geometry.');
   if(!context.workspace&&((before.recordingScenes?.scenes.length??0)>0||(before.vectorRecording?.rigs.length??0)>0))throw Error(`Cannot split source topology while legacy ${before.recordingScenes?.scenes.length?'scene':'vector'} Recording assets are live (${(before.recordingScenes?.scenes??before.vectorRecording?.rigs??[]).map(value=>value.id).join(', ')}). Migrate those assets to Snapshot recording before splitting; their original tracks and archive were not changed.`);
   if(!before.drawing||!state.drawing)throw Error('A split transaction requires the original Drawing document.');
   const expected=applyLayerEditIntent(before.drawing,edit.intent,{propagate:true}).document;
   if(!same(expected,state.drawing))throw Error('The explicit split intent and submitted Drawing document disagree.');
   if(state.drawingSnapshots?.activeId!==before.drawingSnapshots?.activeId)throw Error('A split transaction cannot switch its source artwork.');
   if(context.workspace){const source=drawingSnapshotForArtwork(context.workspace,before.drawingSnapshots?.activeId??'$working');if(!source)throw Error('The split source adapter is missing.');const intent=canonicalSnapshotLayerEditIntent(source,edit.intent,context.workspace);assertSourceSplitProgramSupported(context.workspace,curveSplitIntents(intent).map(value=>value.curveId));splitPlan=prepareSnapshotCurveSplits(context.workspace,source.id,curveSplitIntents(intent),intent.kind==='split-curves'?intent.mirrorPairs:[]);}
  }
  project=prepareOriginalState(before,state,splitPlan);
  if(project.recordingSnapshots){const recordingSnapshots=propagateAutomaticSnapshotLayers(context.workspace,project.recordingSnapshots).workspace;if(recordingSnapshots!==project.recordingSnapshots)project={...project,recordingSnapshots};}
 }
 if(project.recordingSnapshots&&edit.kind!=='snapshot-state'&&edit.intent)project={...project,recordingSnapshots:parseRecordingSnapshots(project.recordingSnapshots)};
 return {before,project,changed:project!==before,...(diagnostics?{diagnostics}:{})};
}

/** Splitting fitted controls is not equivalent to fitting split source cubics.
 * Until an exact program restriction is stored, refuse this specific action. */
function assertCageSplitSupported(workspace:NonNullable<LandmarkProject['recordingSnapshots']>,curveIds:readonly string[],snapshotId?:string){
 if(!workspace.snapshots.some(snapshot=>[snapshot.deformation,snapshot.inheritedState,snapshot.draft?.deformation].some(state=>state?.layerDomains?.some(domain=>isNonlinearLayerDomain(domain)&&domain.enabled!==false))))return;
 for(const snapshot of workspace.snapshots)if(!snapshotId||snapshot.id===snapshotId){const drawing=resolveSnapshot(workspace,snapshot.id).drawing;if(curveIds.some(id=>hasNonlinearDeformationFor(drawing,id)))throw Error('Splitting a retained cage needs an exact fitted-program restriction. Disable or reset the affected cage before splitting its source.');}
}

/** Native cage families now have a restriction law. A reflected descriptor
 * additionally needs its explicit one-to-many endpoint-direction transport. */
function assertSourceSplitProgramSupported(workspace:RecordingSnapshotWorkspace,curveIds:readonly string[]):void {
 for(const snapshot of workspace.snapshots){const drawing=resolveSnapshot(workspace,snapshot.id).drawing;for(const id of curveIds)if(hasNonlinearDeformationFor(drawing,id)){const program=evaluatedMaterialProgram(drawing,id);if(!program||program.some(step=>step.kind==='reflected'))throw Error(`Cannot split ${id} through snapshot ${snapshot.id}: its reflected fitted program requires an explicit child-identity and endpoint-direction restriction. No geometry was changed.`);}}
}
