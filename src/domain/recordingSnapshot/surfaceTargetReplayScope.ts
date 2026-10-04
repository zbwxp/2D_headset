import {drawingControlDependencyIndex,drawingControlEditProof,type DrawingControlEditPlan} from '../drawing/controlEditPlan';
import {evaluatedAffineSource} from '../drawing/evaluatedAffine';
import {hasEvaluatedDeformation} from '../drawing/evaluatedDeformation';
import {endKey,type DrawingDocument} from '../drawing/model';
import {snapshotSimplexDrawingRevision} from './simplexGeometry';

const work={revisionSteps:0,metadataComparisons:0,curveReads:0,nodeReads:0};
export const getSnapshotSurfaceReplayScopeStats=()=>({...work});
export const resetSnapshotSurfaceReplayScopeStats=()=>{for(const key of Object.keys(work) as (keyof typeof work)[])work[key]=0;};

/** A read/replay scope, never an authoring plan or a new target proof. The
 * original controlled writer proves wanted; native ancestry proves every
 * other current-versus-wanted difference. */
export interface SnapshotSurfaceTargetReplayScope {
 readonly nodeIds:ReadonlySet<string>;
 readonly nodeAuthorities:ReadonlyMap<string,string>;
 view(drawing:DrawingDocument):DrawingDocument;
}

const native=(drawing:DrawingDocument)=>!drawing.mirrorEditing?.enabled&&!hasEvaluatedDeformation(drawing)&&!evaluatedAffineSource(drawing);
function sameMetadata(left:DrawingDocument,right:DrawingDocument):boolean {
 // Native material may wrap a projected sample with new display intervals.
 // No other structural, relation, visibility or ARC metadata may differ.
 for(const key of new Set([...Object.keys(left),...Object.keys(right)])){
  if(key==='nodes'||key==='curves'||key==='displayIntervals')continue;
  work.metadataComparisons++;
  if(left[key as keyof DrawingDocument]!==right[key as keyof DrawingDocument])return false;
 }
 return true;
}

export function snapshotSurfaceTargetReplayScope(current:DrawingDocument,wanted:DrawingDocument,plan:DrawingControlEditPlan):SnapshotSurfaceTargetReplayScope|undefined {
 if(plan.fallbackReason||!drawingControlEditProof(plan.before,wanted,plan)||!native(plan.before)||!native(current))return;
 const dirty=new Set<string>(),seen=new Set<DrawingDocument>();let ancestor=current;
 while(ancestor!==plan.before&&!(ancestor.nodes===plan.before.nodes&&ancestor.curves===plan.before.curves)){
  if(seen.has(ancestor))return;seen.add(ancestor);
  const revision=snapshotSimplexDrawingRevision(ancestor);if(!revision||!sameMetadata(ancestor,revision.previous))return;
  work.revisionSteps++;
  for(const id of revision.dirtyCurveIds)dirty.add(id);
  ancestor=revision.previous;
 }
 if(!sameMetadata(ancestor,plan.before)||!native(ancestor))return;
 const index=drawingControlDependencyIndex(plan.before),curveIds=new Set([...plan.curveIds,...dirty]);
 // Include every member of a touched native SMOOTH component, even members
 // whose projected output happened to cancel in the revision. Added members
 // are read dependencies; their opposite ends do not propagate a new edit.
 for(const id of [...curveIds])for(const end of [0,1] as const)for(const member of index.smoothByHandle.get(endKey({curveId:id,end}))?.members??[])curveIds.add(member.endpoint.curveId);
 const nodeIds=new Set(plan.nodeIds);
 for(const id of curveIds){
  const curve=index.curves.get(id);if(!curve?.visible)return;
  for(const nodeId of curve.nodes)for(const linked of index.linkedNodes.get(nodeId)??[nodeId])nodeIds.add(linked);
 }
 const curveSlots=[...curveIds].map(id=>index.curvePositions.get(id)!),nodeSlots=[...nodeIds].map(id=>index.nodePositions.get(id)!);
 if(curveSlots.some(at=>at===undefined)||nodeSlots.some(at=>at===undefined))return;
 curveSlots.sort((a,b)=>a-b);nodeSlots.sort((a,b)=>a-b);
 return {nodeIds,nodeAuthorities:index.nodeAuthorities,view(drawing){
  work.curveReads+=curveSlots.length;work.nodeReads+=nodeSlots.length;
  return {...drawing,curves:curveSlots.map(at=>drawing.curves[at]),nodes:nodeSlots.map(at=>drawing.nodes[at])};
 }};
}
