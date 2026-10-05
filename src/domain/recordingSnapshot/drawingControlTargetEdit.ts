import {hasEvaluatedDeformation} from '../drawing/evaluatedDeformation';
import type {SnapshotSimplexRevisionChanges} from './simplexGeometry';
import {drawingControlEditProof,drawingControlPlanView,type DrawingControlEditPlan} from '../drawing/controlEditPlan';
import {uid,type DrawingDocument} from '../drawing/model';
import {captureSnapshotControlTargets,assertSnapshotControlTargetReplay} from './controlTargets';
import {evaluateRecordingSnapshot,prepareRecordingContext,resolveSnapshot,resolveRecordingSnapshotBasis,snapshotSurfaceRequiredBases,retainSnapshotSavedEvaluationIdentity,type SnapshotEvaluation} from './evaluation';
import {assertSnapshotObjectsUnlocked} from './objectLocks';
import {prepareSnapshotSurfaceTargetEdit,effectiveSnapshotSurfaceResponses,SnapshotSurfaceTargetEditError} from './surfaceTargets';
import {prepareSnapshotSurfaceBasisFallback,SnapshotBasisFallbackError} from './surfaceBasisFallback';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type SnapshotRecording,type RecordingSnapshot,type Angle,type SnapshotAngleGraph} from './model';

export class SnapshotDrawingControlTargetError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotDrawingControlTargetError(code,message);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** References and editor preferences do not change the evaluated control frame. */
export const snapshotDrawingEditContent=(drawing:DrawingDocument)=>[drawing.nodes,drawing.curves,drawing.layers,drawing.fills,drawing.offsets,drawing.joins,drawing.endpointLinks??[],drawing.groups??[],drawing.displayIntervals??[]];
const contentSignatures=new WeakMap<DrawingDocument,string>();
export function snapshotDrawingEditSignature(drawing:DrawingDocument):string {let signature=contentSignatures.get(drawing);if(signature===undefined){signature=JSON.stringify([snapshotDrawingEditContent(drawing),drawing.mirrorEditing?.curvePairs??[]]);contentSignatures.set(drawing,signature);}return signature;}
const controlStructure=(drawing:DrawingDocument)=>snapshotDrawingEditContent({...drawing,nodes:drawing.nodes.map(node=>({...node,position:[0,0]})),curves:drawing.curves.map(curve=>({...curve,handles:[[0,0],[0,0]]}))});
export interface SnapshotDrawingControlTarget {recordingId:string;snapshotId:string;angle:Angle;beforeDrawing:DrawingDocument;drawing:DrawingDocument;controlPlan?:DrawingControlEditPlan}

/** A frozen Drawing target is captured once, regardless of how many controls
 * its tool authored. Commands and Drawing tools share this write boundary. */
export function captureSnapshotDrawingControlTarget(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,evaluation:SnapshotEvaluation,wanted:DrawingDocument,fresh:()=>string,options:{immutableInputs?:boolean;controlPlan?:DrawingControlEditPlan}={}):{snapshot?:RecordingSnapshot;snapshots?:RecordingSnapshot[];graph?:SnapshotAngleGraph;changes?:SnapshotSimplexRevisionChanges} {
 const current=evaluation.drawing,controlPlan=options.controlPlan&&drawingControlEditProof(options.controlPlan.before,wanted,options.controlPlan),currentControls=controlPlan?drawingControlPlanView(current,controlPlan):current,wantedControls=controlPlan?drawingControlPlanView(wanted,controlPlan):wanted;

 const nodes=new Map(currentControls.nodes.map(node=>[node.id,node.position])),wantedNodes=new Map(wantedControls.nodes.map(node=>[node.id,node.position]));
 assertSnapshotObjectsUnlocked(current,currentControls.curves.filter((curve,index)=>!same(curve.handles,wantedControls.curves[index]?.handles)||curve.nodes.some(id=>!same(nodes.get(id),wantedNodes.get(id)))).map(curve=>curve.id));
 const graph=recording.mode==='triangulated'?recording.angleGraph:undefined,vertex=graph?.mesh.vertices.find(value=>value.angle.x===recording.angle.x&&value.angle.y===recording.angle.y);
 if(graph&&!vertex){
  const surface=evaluation.angleSurface;if(!surface?.simplex||surface.role==='outside')fail('SURFACE_OUTSIDE_COVERAGE','This angle is outside saved snapshot coverage. Red projected geometry is read-only.');
  try{
   const frameId=effectiveSnapshotSurfaceResponses(graph).draft?.id??fresh();
   const result=options.immutableInputs?prepareRecordingContext(workspace,{useDraft:true,immutableInputs:true,diagnostics:'preview'}).prepareSurfaceTargetEdit(recording.id,evaluation,wanted,{angle:recording.angle,frameId,controlPlan}):prepareSnapshotSurfaceTargetEdit(graph,surface!.simplex!,surface!.bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:graph.mesh.vertices.find(vertex=>vertex.snapshotId===base.snapshotId)!.angle})),current,wanted,{angle:recording.angle,frameId,allBases:snapshotSurfaceRequiredBases(surface!,recording.angle),mirror:surface!.mirrorContext,controlPlan});
   return result.changed?{graph:result.graph,...controlPlan?{changes:{structureUnchanged:true as const,basisControls:new Map(),responseControls:result.responseControls??[]}}:{}}:{};
  }catch(error){
   if(!(error instanceof SnapshotSurfaceTargetEditError)||!['SURFACE_AXIS_UNAVAILABLE','SURFACE_CONSTRAINT_UNSOLVABLE'].includes(error.code))throw error;
   try{return prepareSnapshotSurfaceBasisFallback(workspace,recording,evaluation,wanted,fresh,{...options,controlPlan});}catch(fallback){
    if(fallback instanceof SnapshotBasisFallbackError&&fallback.code==='SURFACE_BASIS_FALLBACK_UNSUPPORTED')throw new SnapshotSurfaceTargetEditError(error.code,`${error.message} ${fallback.message}`);
    throw fallback;
   }
  }
 }
 const owner=workspace.snapshots.find(value=>value.id===(vertex?.snapshotId??evaluation.snapshotId))??fail('MISSING_SNAPSHOT','The geometry target Snapshot no longer exists.');
 if(graph?.correctionFrames?.some(frame=>frame.status==='draft'&&frame.basisAdjustment))fail('SURFACE_BASIS_DRAFT_OWNED','A coupled intermediate-angle correction is pending. Save or discard it before editing real views or their dependencies.');
 const bound=vertex?.angle??owner.angle;if(bound.x!==recording.angle.x||bound.y!==recording.angle.y)fail('REAL_SNAPSHOT_REQUIRED','Create a real snapshot at this angle before editing this Recording with Drawing tools.');
 const prior=owner.draft??{angle:{...owner.angle},deformation:emptySnapshotDeformationState(),channels:[]},deformation=captureSnapshotControlTargets(evaluation,wanted,prior.deformation,fresh,controlPlan,{immutableInputs:options.immutableInputs});
 if(deformation===prior.deformation)return {};
 const candidate={...owner,draft:{...prior,deformation}};
 // A fresh pointer target replaces only this draft. Keep saved bases reusable,
 // while the changed draft gets its own exact replay and dependent mirror.
 if(options.immutableInputs)retainSnapshotSavedEvaluationIdentity(candidate,owner);
 const next={...workspace,snapshots:workspace.snapshots.map(value=>value===owner?candidate:value)};
 // The controlled writer only changed the proven scalar closure. Establish its
 // lineage before replay so the candidate can revise the frozen native basis.
 // Domains, Warp programs and reflected inputs keep the canonical full path.
 const native=controlPlan&&!evaluation.state.layerDomains?.length&&!deformation.layerDomains?.length&&!evaluation.state.warps.length&&!deformation.warps.length&&!owner.inputMirror&&!hasEvaluatedDeformation(evaluation.drawing),changes=native?{structureUnchanged:true as const,basisControls:new Map([[owner.id,controlPlan.controls]]),responseControls:[]}:undefined;
 const context=options.immutableInputs?prepareRecordingContext(workspace,{useDraft:true,immutableInputs:true,diagnostics:'preview'}).forkCandidate(next,recording.id,changes):undefined;
 const replay=recording.mode==='triangulated'?(context?context.resolveBasis(recording.id,owner.id):resolveRecordingSnapshotBasis(next,recording,owner.id,{useDraft:true,immutableInputs:options.immutableInputs,diagnostics:'preview'})):recording.mode==='endpoint-pair'?evaluateRecordingSnapshot(next,recording.id,{snapshotId:owner.id,angle:recording.angle,useDraft:true,diagnostics:'preview'}):context?context.resolveSnapshot(owner.id,{angle:recording.angle}):resolveSnapshot(next,owner.id,{angle:recording.angle,useDraft:true,immutableInputs:options.immutableInputs,diagnostics:'preview'});
 const bounded=native&&!hasEvaluatedDeformation(replay.drawing);assertSnapshotControlTargetReplay(replay.drawing,wanted,bounded?controlPlan:undefined);return {snapshot:candidate,...bounded?{changes}:{}};
}

export function prepareSnapshotDrawingControlTarget(workspace:RecordingSnapshotWorkspace,edit:SnapshotDrawingControlTarget):RecordingSnapshotWorkspace {
 const recording=workspace.recordings.find(value=>value.id===edit.recordingId)??fail('MISSING_RECORDING','The Recording target no longer exists.');
 if(recording.legacy)fail('LEGACY_READ_ONLY',recording.legacy.reason);
 if(recording.angle.x!==edit.angle.x||recording.angle.y!==edit.angle.y||!recording.snapshotIds.includes(edit.snapshotId))fail('STALE_DRAWING_TARGET','The Recording cursor changed during this Drawing gesture. Start the gesture again.');
 const evaluation=evaluateRecordingSnapshot(workspace,recording.id,{angle:edit.angle,useDraft:true,immutableInputs:true,diagnostics:'preview'});
 if(evaluation.snapshotId!==edit.snapshotId||snapshotDrawingEditSignature(evaluation.drawing)!==snapshotDrawingEditSignature(edit.beforeDrawing))fail('STALE_DRAWING_TARGET','The snapshot changed during this Drawing gesture. Start the gesture again on its current frame.');
 const controlPlan=drawingControlEditProof(edit.beforeDrawing,edit.drawing,edit.controlPlan);
 if(!controlPlan&&(!same(controlStructure(evaluation.drawing),controlStructure(edit.drawing))||!same(edit.beforeDrawing.mirrorEditing?.curvePairs??[],edit.drawing.mirrorEditing?.curvePairs??[])))fail('CONTROL_TOPOLOGY_CHANGED','A geometry target must preserve topology, relations and appearance.');
 const result=captureSnapshotDrawingControlTarget(workspace,recording,evaluation,edit.drawing,uid,{immutableInputs:true,controlPlan});
 const writes=new Map([...result.snapshots??[],...result.snapshot?[result.snapshot]:[]].map(value=>[value.id,value]));
 const next=writes.size||result.graph?{...workspace,...writes.size?{snapshots:workspace.snapshots.map(value=>writes.get(value.id)??value)}:{},...result.graph?{recordings:workspace.recordings.map(value=>value===recording?{...recording,angleGraph:result.graph}:value)}:{}}:workspace;
 if(next!==workspace)prepareRecordingContext(workspace,{useDraft:true,immutableInputs:true,diagnostics:'preview'}).forkCandidate(next,recording.id,result.changes);return next;
}
