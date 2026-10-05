import {assertPreparedEditCurrent,currentPreparedEditRevision} from './preparedEditRevision';
import {shareValidatedRecordingWorkspace} from '../domain/recordingSnapshot/workspaceChanges';
import {retainPreparedControlChanges} from '../domain/recordingSnapshot/preparedControlChanges';
import {assertRecordingProjectActive} from '../domain/recordingSnapshot/retirement';
import {effectiveSnapshotSurfaceResponses} from '../domain/recordingSnapshot/surfaceTargets';
import {isNonlinearLayerDomain} from '../domain/recordingSnapshot/layerDomains';
import {snapshotWithObjectLocks,type SnapshotObjectLocks} from '../domain/recordingSnapshot/objectLocks';
import {prepareRecordingLayerDomainWorkspace,type RecordingLayerDomainEdit} from './recordingLayerDomainEdit';
import {prepareRecordingContext,resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {hasNonlinearDeformationFor,evaluatedMaterialProgram} from '../domain/drawing/evaluatedDeformation';
import {prepareSnapshotDrawingTopologyEdit,prepareSnapshotLocalDrawingEdit,type SnapshotDrawingTopologyEdit,type SnapshotLocalDrawingEdit} from '../domain/recordingSnapshot/drawingTopology';
import {canDeferDrawingSourceSynchronization,buildDrawingLayerDomainEdit,buildDrawingSnapshotEdit,type DrawingSnapshotEditIntent} from './drawingSnapshotEdit';
import type {LandmarkProject} from '../domain/landmarks/model';
import {propagateAutomaticSnapshotLayers} from '../domain/recordingSnapshot/automaticSnapshotEdits';
import {parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {applyLayerEditIntent,curveSplitIntents,type LayerEditIntent,type CurveSplitIntent,type LayerDomainIntent} from '../domain/drawing/layerEditIntent';
import {transferSnapshotSplitResponses,pruneSnapshotResponseDependencies} from '../domain/recordingSnapshot/responseExpressionTransactions';
import {canonicalSnapshotLayerEditIntent,prepareSnapshotCurveSplits,finishSnapshotCurveSplits,splitSnapshotLocalCurve,type SnapshotCurveSplitBatchPlan} from '../domain/recordingSnapshot/topologyEdits';
import {parseDrawingSnapshots,parseDrawingWorkingCopies,type DrawingSnapshotState} from '../domain/drawing/snapshots';
import type {RecordingSnapshot,RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {finalizeGeometryEdit,retainFinalizedGeometry} from '../domain/drawing/geometryEdit';
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
 | {kind:'layer-domain';intent:LayerDomainIntent;allowRelated?:boolean;validation?:'full'|'preview'}
 | {kind:'drawing-source-target';beforeDrawing:DrawingDocument;drawing:DrawingDocument;intent?:DrawingSnapshotEditIntent}
 | {kind:'drawing-document';drawing:DrawingDocument;intent?:DrawingSnapshotEditIntent;validation?:'full'|'preview'}
 | {kind:'original-geometry';drawing:DrawingDocument;intent?:LayerEditIntent;validation?:'full'|'preview'}
 | {kind:'original-state';state:DrawingSnapshotState;intent?:LayerEditIntent}
 | ({kind:'local-drawing-topology'}&SnapshotDrawingTopologyEdit)
 | ({kind:'snapshot-local-drawing'}&SnapshotLocalDrawingEdit)
 | {kind:'local-curve-split';snapshotId:string;intent:CurveSplitIntent}
 | {kind:'snapshot-build';build:(workspace:RecordingSnapshotWorkspace)=>RecordingSnapshotWorkspace;validation?:'full'|'preview'}
 | {kind:'snapshot-state';workspace:RecordingSnapshotWorkspace;validation?:'full'|'preview'};
export interface SnapshotEditPlan {
 readonly preparedRevision?:number;
 readonly before:LandmarkProject;
 readonly project:LandmarkProject;
 readonly changed:boolean;
 readonly diagnostics?:readonly {code:string;message:string;snapshotId?:string}[];
}
const same=(before:unknown,after:unknown)=>before===after||JSON.stringify(before)===JSON.stringify(after);

// The receipt is runtime-only. Spreading a plan to add adapter metadata keeps
// it, while JSON and a caller-supplied revision cannot manufacture acceptance.
const receiptKey=Symbol('prepared snapshot edit');
type ValidationStage='full'|'preview'|'source-target';
interface PreparedReceipt {
 readonly before:LandmarkProject;
 readonly project:LandmarkProject;
 readonly changed:boolean;
 readonly revision:number;
 readonly validation:ValidationStage;
 finalized?:SnapshotEditPlan;
 completeSource?:()=>SnapshotEditPlan;
}
const receipts=new WeakMap<object,PreparedReceipt>();
const frozenValues=new WeakSet<object>();
function freezeCandidate(value:unknown):void {
 if(!value||typeof value!=='object'||frozenValues.has(value))return;
 frozenValues.add(value);for(const child of Object.values(value))freezeCandidate(child);Object.freeze(value);
}
function issuePreparedEdit(plan:SnapshotEditPlan,validation:ValidationStage,revision=currentPreparedEditRevision()):SnapshotEditPlan {
 if(plan.changed)freezeCandidate(plan.project);
 const token=Object.freeze({}),result={...plan,preparedRevision:revision,[receiptKey]:token};
 receipts.set(token,{before:result.before,project:result.project,changed:result.changed,revision,validation});return result;
}
function preparedReceipt(plan:SnapshotEditPlan):PreparedReceipt {
 const token=(plan as SnapshotEditPlan&{[receiptKey]?:object})[receiptKey],receipt=token&&receipts.get(token);
 if(!receipt||receipt.before!==plan.before||receipt.project!==plan.project||receipt.changed!==plan.changed||receipt.revision!==plan.preparedRevision)throw Error('This snapshot edit has no valid prepared acceptance receipt. Prepare the edit again.');
 assertPreparedEditCurrent(plan);return receipt;
}
/** Normalization may create a new immutable workspace identity. Keep both the
 * completed candidate and its validated result in the same dependency lineage. */
function normalizePreparedWorkspace(before:RecordingSnapshotWorkspace|undefined,candidate:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace {
 const validated=shareValidatedRecordingWorkspace(before,parseRecordingSnapshots(candidate));
 retainPreparedControlChanges(validated,candidate);
 if(before)prepareRecordingContext(before,{immutableInputs:true,diagnostics:'preview'}).fork(candidate);
 prepareRecordingContext(candidate,{immutableInputs:true,diagnostics:'preview'}).fork(validated);
 return validated;
}
function adoptPreparedWorkspace(before:LandmarkProject,after:LandmarkProject):void {
 if(before.recordingSnapshots&&after.recordingSnapshots&&before.recordingSnapshots!==after.recordingSnapshots)prepareRecordingContext(before.recordingSnapshots,{immutableInputs:true,diagnostics:'preview'}).fork(after.recordingSnapshots);
}
/** Finish an accepted preview without running its target producer, inverse,
 * source synchronization or propagation again. A full plan is already done.
 * The cached upgrade preserves normalizer output and runs at most once. */
export function finalizePreparedSnapshotEdit<T extends SnapshotEditPlan>(plan:T,currentProject?:LandmarkProject):T {
 const receipt=preparedReceipt(plan);
 if(currentProject!==undefined&&currentProject!==receipt.before)throw Error('Snapshot edit became stale before commit.');
 if(receipt.validation==='full'||!plan.changed)return plan;
 if(receipt.validation==='source-target'){if(!receipt.finalized)receipt.finalized=receipt.completeSource!();preparedReceipt(receipt.finalized);return {...plan,...receipt.finalized} as T;}
 if(!receipt.finalized){
  const candidate=receipt.project,workspace=candidate.recordingSnapshots;
  const recordingSnapshots=workspace&&normalizePreparedWorkspace(workspace,workspace);
  if(workspace&&recordingSnapshots)retainPreparedControlChanges(recordingSnapshots,workspace);
  const project=recordingSnapshots===workspace?candidate:{...candidate,recordingSnapshots};
  receipt.finalized=issuePreparedEdit({before:plan.before,project,changed:plan.changed},'full',receipt.revision);
 }
 return {...plan,...receipt.finalized} as T;
}
/** Compose only a contiguous chain of accepted owner transactions. No caller
 * can certify an arbitrary project by copying a revision or a native flag. */
export function composePreparedSnapshotEdits(before:LandmarkProject,steps:readonly SnapshotEditPlan[]):SnapshotEditPlan {
 let project=before,validation:ValidationStage='full';const diagnostics:NonNullable<SnapshotEditPlan['diagnostics']>[number][]=[];
 for(const step of steps){const receipt=preparedReceipt(step);if(receipt.validation==='source-target')throw Error('Accept the prepared source target before composing project transactions.');if(step.before!==project)throw Error('Prepared snapshot edits must form one exact project sequence.');project=step.project;if(receipt.validation==='preview')validation='preview';if(step.diagnostics)diagnostics.push(...step.diagnostics);}
 return issuePreparedEdit({before,project,changed:project!==before,...(diagnostics.length?{diagnostics}:{})},validation);
}
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

/** A coupled correction owns its real bases until the one Save/Discard.
 * Direct topology/property/domain adapters share the same ownership boundary
 * as control commands; navigation and the coupled finish transaction stay free. */
function assertCoupledBasisEditOwnership(original:RecordingSnapshotWorkspace|undefined,edit:SnapshotEdit):void {
 if(!original)return;
 const pending=original.recordings.flatMap(recording=>{const graph=recording.angleGraph,draft=graph&&effectiveSnapshotSurfaceResponses(graph).draft;return draft?.basisAdjustment?[{recording,draft}]:[];});
 const blocked=()=>{throw Error('A coupled intermediate-angle correction is pending. Save or discard it before editing real views or their dependencies.');};
 if(edit.kind==='snapshot-state'){
  for(const {recording,draft} of pending){
   const next=edit.workspace.recordings.find(value=>value.id===recording.id),stillOwned=next?.angleGraph?.correctionFrames?.some(frame=>frame.id===draft.id&&frame.status==='draft'&&frame.basisAdjustment);
   if(!stillOwned||!recording.angleGraph!.mesh.vertices.some(vertex=>vertex.angle.x===recording.angle.x&&vertex.angle.y===recording.angle.y))continue;
   if(recording.snapshotIds.some(id=>!same(original.snapshots.find(value=>value.id===id),edit.workspace.snapshots.find(value=>value.id===id))))blocked();
  }
 }else if('snapshotId' in edit){
  if(pending.some(({recording})=>recording.snapshotIds.includes(edit.snapshotId)))blocked();
 }
}

/** Preserve old adapters/checkpoints without making them a second authority
 * for Recording edits. Only an original-source transaction refreshes them. */
function prepareOriginalState(before:LandmarkProject,incoming:DrawingSnapshotState,splitPlan?:SnapshotCurveSplitBatchPlan):LandmarkProject{
 const prepared=prepareDrawingWorkingCopyTransition(before,incoming),raw=prepared.state,promotion=prepared.promotedWorkingArtworkId;
 const checkedDrawing=raw.drawing&&raw.drawing!==before.drawing?parseDrawing(raw.drawing):raw.drawing;
 const drawing=raw.drawing&&checkedDrawing?(same(raw.drawing,checkedDrawing)?raw.drawing:retainFinalizedGeometry(checkedDrawing,raw.drawing)):checkedDrawing;
 const checkedSnapshots=raw.drawingSnapshots&&raw.drawingSnapshots!==before.drawingSnapshots?parseDrawingSnapshots(raw.drawingSnapshots):raw.drawingSnapshots;
 const drawingSnapshots=same(raw.drawingSnapshots,checkedSnapshots)?raw.drawingSnapshots:checkedSnapshots;
 const checkedCopies=raw.drawingWorkingCopies&&raw.drawingWorkingCopies!==before.drawingWorkingCopies?parseDrawingWorkingCopies(raw.drawingWorkingCopies,drawingSnapshots):raw.drawingWorkingCopies;
 const drawingWorkingCopies=same(raw.drawingWorkingCopies,checkedCopies)?raw.drawingWorkingCopies:checkedCopies;
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
 if(context.workspace!==context.project.recordingSnapshots)throw Error('The snapshot edit context must belong to its exact project.');
 freezeCandidate(context.project);
 const revision=currentPreparedEditRevision();
 if(edit.kind==='drawing-source-target'){
  assertRecordingProjectActive(context.project);assertCoupledBasisEditOwnership(context.workspace,edit);
  if(!context.canEditOriginals||!canDeferDrawingSourceSynchronization(context.project,edit.beforeDrawing))throw Error('Only an unchanged pure-source Drawing presentation can defer source synchronization.');
  freezeCandidate(edit.beforeDrawing);freezeCandidate(edit.drawing);
  const plan=issuePreparedEdit({before:context.project,project:context.project,changed:edit.drawing!==edit.beforeDrawing},'source-target',revision);
  preparedReceipt(plan).completeSource=()=>prepareSnapshotEdit(context,{kind:'drawing-document',drawing:edit.drawing,intent:edit.intent});
  return plan;
 }
 const plan=buildSnapshotEditPlan(context,edit);
 if(revision!==currentPreparedEditRevision())throw Error('This prepared edit was canceled during preparation.');
 adoptPreparedWorkspace(plan.before,plan.project);
 if(receiptKey in plan){preparedReceipt(plan);return plan;}
 return issuePreparedEdit(plan,'validation' in edit&&edit.validation==='preview'?'preview':'full',revision);
}
function buildSnapshotEditPlan(context:SnapshotEditContext,edit:Exclude<SnapshotEdit,{kind:'drawing-source-target'}>):SnapshotEditPlan{
 assertRecordingProjectActive(context.project);
 assertCoupledBasisEditOwnership(context.workspace,edit);
 if(edit.kind==='snapshot-build'){
  const workspace=context.workspace??ensureRecordingSnapshots(context.project).recordingSnapshots;freezeCandidate(workspace);
  return prepareSnapshotEdit(context,{kind:'snapshot-state',workspace:edit.build(workspace),validation:edit.validation});
 }
 if(edit.kind==='object-locks'){
  const before=context.project,workspace=context.workspace??ensureRecordingSnapshots(before).recordingSnapshots,snapshot=workspace.snapshots.find(value=>value.id===edit.snapshotId);if(!snapshot)throw Error('The lock target Snapshot no longer exists.');
  const next=snapshotWithObjectLocks(snapshot,resolveSnapshot(workspace,snapshot.id,{useDraft:true,diagnostics:'preview'}).drawing,edit.changes);
  if(next===snapshot)return {before,project:before,changed:false};
  return prepareSnapshotEdit(context,{kind:'snapshot-state',workspace:{...workspace,snapshots:workspace.snapshots.map(value=>value===snapshot?next:value)}});
 }
 if(edit.kind==='recording-layer-domain')return prepareSnapshotEdit(context,{kind:'snapshot-state',workspace:prepareRecordingLayerDomainWorkspace(context.project,edit),validation:edit.validation});
 if(edit.kind==='layer-domain')return buildDrawingLayerDomainEdit(context.project,edit.intent,{canEditOriginals:context.canEditOriginals,allowRelated:edit.allowRelated,validation:edit.validation});
 if(edit.kind==='drawing-document'){
  if(!context.canEditOriginals)throw Error('Drawing document edits require the original-source adapter in Drawing mode.');
  return buildDrawingSnapshotEdit(context.project,edit.drawing,edit.intent,{validation:edit.validation});
 }
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
  const propagation=propagateAutomaticSnapshotLayers(original,edit.workspace),propagated=propagation.workspace;diagnostics=propagation.diagnostics;
  const recordingSnapshots=edit.validation==='preview'?propagated:normalizePreparedWorkspace(original,propagated);
  if(propagated===edit.workspace)retainPreparedControlChanges(recordingSnapshots,edit.workspace);
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
 if(project.recordingSnapshots&&edit.kind!=='snapshot-state'&&(!('validation' in edit)||edit.validation!=='preview'))project={...project,recordingSnapshots:normalizePreparedWorkspace(context.workspace,project.recordingSnapshots)};
 if(edit.kind!=='snapshot-state'&&same(project,before))project=before;
 return {before,project,changed:project!==before,...(diagnostics?{diagnostics}:{})};
}

/** Splitting fitted controls is not equivalent to fitting split source cubics.
 * Until an exact program restriction is stored, refuse this specific action. */
function assertCageSplitSupported(workspace:NonNullable<LandmarkProject['recordingSnapshots']>,curveIds:readonly string[],snapshotId?:string){
 if(!workspace.snapshots.some(snapshot=>[snapshot.deformation,snapshot.inheritedState,snapshot.draft?.deformation].some(state=>state?.layerDomains?.some(domain=>isNonlinearLayerDomain(domain)&&domain.enabled!==false))))return;
 for(const snapshot of workspace.snapshots)if(!snapshotId||snapshot.id===snapshotId){const drawing=resolveSnapshot(workspace,snapshot.id).drawing;if(curveIds.some(id=>hasNonlinearDeformationFor(drawing,id)))throw Error('Splitting a retained cage needs an exact fitted-program restriction. Disable or reset the affected cage before splitting its source.');}
}

/** Only a serializable material descriptor has an exact source restriction.
 * Reflected descriptors transport the same intent through endpoint parity. */
function assertSourceSplitProgramSupported(workspace:RecordingSnapshotWorkspace,curveIds:readonly string[]):void {
 for(const snapshot of workspace.snapshots){const drawing=resolveSnapshot(workspace,snapshot.id).drawing;for(const id of curveIds)if(hasNonlinearDeformationFor(drawing,id)){const program=evaluatedMaterialProgram(drawing,id);if(!program)throw Error(`Cannot split ${id} through snapshot ${snapshot.id}: its fitted program has no serializable source restriction. No geometry was changed.`);}}
}
