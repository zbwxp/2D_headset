import {drawingControlEditProof,drawingControlPlanView,type DrawingControlEditPlan} from '../drawing/controlEditPlan';
import {layerFor,nodeAt,sub,length,type DrawingDocument,type Point2} from '../drawing/model';
import {hasNonlinearDeformationFor} from '../drawing/evaluatedDeformation';
import {identityAffine2D,applyAffine2D,type Affine2D} from '../geometry/affine2d';
import {snapshotControlMatrix,trySnapshotControlInverse} from './controlSpace';
import {captureLayerDomainControls,layerUsesOutputControls} from './layerDomainControlEdit';
import {reconcileSnapshotEndpointRelationEdit} from './endpointRelationEdits';
import {createSnapshotControlTargetWriter} from './controlTargetWriter';
import type {SnapshotEvaluation} from './evaluation';
import type {SnapshotDeformationState} from './model';
import type {SnapshotLayerDomain} from './layerDomains';

const close=(a:Point2,b:Point2)=>length(sub(a,b))<=1e-9*Math.max(1,length(a),length(b));
export class SnapshotControlTargetError extends Error {constructor(readonly code:string,message:string){super(message);}}
const outputDomain=(evaluation:SnapshotEvaluation,layerId:string)=>layerUsesOutputControls(evaluation.state.layerDomains,layerId)?[...evaluation.state.layerDomains??[]].reverse().find(domain=>domain.enabled!==false&&domain.layerIds.includes(layerId)):undefined;

/** One component owns shared nodes, explicit links and relation handle laws.
 * Stage grouping never chooses an independent position for a linked follower. */
export function snapshotControlComponents(drawing:DrawingDocument):string[][] {
 const parents=new Map(drawing.curves.map(curve=>[curve.id,curve.id]));
 const root=(id:string):string=>{const parent=parents.get(id);if(!parent||parent===id)return id;const found=root(parent);parents.set(id,found);return found;};
 const join=(a:string,b:string)=>{if(!parents.has(a)||!parents.has(b))return;const x=root(a),y=root(b);if(x!==y)parents.set(x<y?y:x,x<y?x:y);};
 const nodes=new Map<string,string>();for(const curve of drawing.curves)for(const node of curve.nodes){const prior=nodes.get(node);if(prior)join(prior,curve.id);else nodes.set(node,curve.id);}
 for(const relation of [...drawing.joins,...drawing.endpointLinks??[]])join(relation.a.curveId,relation.b.curveId);
 const groups=new Map<string,string[]>();for(const curve of drawing.curves){const key=root(curve.id),group=groups.get(key)??[];group.push(curve.id);groups.set(key,group);}return [...groups.values()];
}
export function snapshotUsesControlTargetStages(evaluation:SnapshotEvaluation,curveIds:readonly string[],includeCollapsed=false):boolean {
 const selected=new Set(curveIds);
 return snapshotControlComponents(evaluation.drawing).some(component=>component.some(id=>selected.has(id))&&component.some(id=>!!outputDomain(evaluation,layerFor(evaluation.drawing,id)!.id)||hasNonlinearDeformationFor(evaluation.drawing,id)||includeCollapsed&&!trySnapshotControlInverse(evaluation,layerFor(evaluation.drawing,id)!.id,id)));
}

const capturePlanStages=new WeakMap<SnapshotEvaluation,WeakMap<DrawingControlEditPlan,boolean>>();
/** Capture grouping is broader than directly changed controls: a far member of
 * the same shared-node component can select a common output write stage. Check
 * this frozen dependency once, before using the narrower numeric control view. */
function boundedControlCapture(evaluation:SnapshotEvaluation,plan:DrawingControlEditPlan):boolean {
 let cache=capturePlanStages.get(evaluation);if(!cache){cache=new WeakMap();capturePlanStages.set(evaluation,cache);}const known=cache.get(plan);if(known!==undefined)return known;
 let bounded=!evaluation.drawing.endpointLinks?.length&&!evaluation.state.layerDomains?.length;
 if(bounded){const selected=new Set(plan.curveIds);for(const component of snapshotControlComponents(evaluation.drawing))if(component.some(id=>selected.has(id))){if(component.some(id=>hasNonlinearDeformationFor(evaluation.drawing,id))||new Set(component.map(id=>JSON.stringify(snapshotControlMatrix(evaluation,layerFor(evaluation.drawing,id)!.id,id)))).size>1){bounded=false;break;}}}
 cache.set(plan,bounded);return bounded;
}

/** Resolve one frozen final-space target into its existing write stages. A
 * relation component spanning stages receives one common sparse output owner;
 * its identity field preserves all existing input programs and live membership.
 * This is an explicit post-control stage, never an inverse fit of cage handles. */
export function captureSnapshotControlTargets(evaluation:SnapshotEvaluation,wanted:DrawingDocument,own:SnapshotDeformationState,fresh:()=>string,controlPlan?:DrawingControlEditPlan,options:{immutableInputs?:boolean}={}):SnapshotDeformationState {
 const trusted=controlPlan&&drawingControlEditProof(controlPlan.before,wanted,controlPlan),bounded=trusted&&boundedControlCapture(evaluation,trusted);
 const before=bounded?drawingControlPlanView(evaluation.drawing,trusted):evaluation.drawing;
 if(bounded)wanted=drawingControlPlanView(wanted,trusted);
 const curves=new Map(before.curves.map(curve=>[curve.id,curve])),nodes=new Map(before.nodes.map(node=>[node.id,node])),targets=new Map(wanted.curves.map(curve=>[curve.id,curve])),wantedNodes=new Map(wanted.nodes.map(node=>[node.id,node]));
 if(curves.size!==targets.size||nodes.size!==wantedNodes.size||before.curves.some(curve=>!targets.has(curve.id)||curve.nodes.some((id,end)=>id!==targets.get(curve.id)!.nodes[end])))throw new SnapshotControlTargetError('CONTROL_TOPOLOGY_CHANGED','Control targets must preserve node and curve identity.');
 const changed=new Set(before.curves.filter(curve=>curve.handles.some((p,end)=>!close(p,targets.get(curve.id)!.handles[end])||!close(nodes.get(curve.nodes[end])!.position,wantedNodes.get(curve.nodes[end])!.position))).map(curve=>curve.id));
 if(!changed.size)return own;
 const writer=createSnapshotControlTargetWriter(own,evaluation.state,options.immutableInputs),state=writer.state;
 const finalLayers=new Set<string>(),stage=(id:string)=>{const layer=layerFor(before,id)!.id,domain=outputDomain(evaluation,layer);return domain?`domain:${domain.id}`:`local:${JSON.stringify(snapshotControlMatrix(evaluation,layer,id))}`;};
 for(const component of snapshotControlComponents(before))if(component.some(id=>changed.has(id))&&new Set(component.map(stage)).size>1)for(const id of component)finalLayers.add(layerFor(before,id)!.id);
 let evaluatedDomains:SnapshotLayerDomain[]=[...evaluation.state.layerDomains??[]];
 if(finalLayers.size){const domain:SnapshotLayerDomain={id:fresh(),kind:'affine',layerIds:[...finalLayers].sort(),matrix:identityAffine2D(),postShape:{nodes:{},handles:{}}};evaluatedDomains=[...evaluatedDomains,domain];state.layerDomains=[...state.layerDomains??[],domain];}
 const changedLayers=new Set([...changed].map(id=>layerFor(before,id)!.id)),post=captureLayerDomainControls(before,wanted,evaluatedDomains,state.layerDomains,changedLayers);if(post.handledLayers.size)state.layerDomains=post.domains;
 const localLayers=new Set([...changedLayers].filter(id=>!post.handledLayers.has(id))),inverseCache=new Map<string,Affine2D|null>();
 const unplace=(layerId:string,curveId:string,p:Point2):Point2=>{
  let inverse=inverseCache.get(curveId);if(inverse===undefined){inverse=trySnapshotControlInverse(evaluation,layerId,curveId);inverseCache.set(curveId,inverse);}if(inverse)return applyAffine2D(inverse,p);
  const target=targets.get(curveId)!,current=evaluation.preElementPlacementDrawing.curves.find(curve=>curve.id===curveId)!,nodeEnd=target.nodes.findIndex(id=>wantedNodes.get(id)?.position===p),handleEnd=target.handles.findIndex(point=>point===p),anchor=nodeEnd>=0?nodeAt(evaluation.preElementPlacementDrawing,{curveId,end:nodeEnd as 0|1}).position:handleEnd>=0?current.handles[handleEnd]:undefined,matrix=snapshotControlMatrix(evaluation,layerId,curveId);
  if(!anchor)throw new SnapshotControlTargetError('CONTROL_AXIS_UNAVAILABLE',`Curve ${curveId} in layer ${layerId}: the collapsed placement target has no retained input control.`);
  const label=nodeEnd>=0?`Node ${target.nodes[nodeEnd]}`:`Handle ${curveId} end ${handleEnd}`;
  return solveCollapsedControlTarget(matrix,anchor,p,label,layerId);
 };
 const localRelations=(drawing:DrawingDocument):DrawingDocument=>({...drawing,endpointLinks:drawing.endpointLinks?.filter(link=>localLayers.has(layerFor(drawing,link.a.curveId)!.id)&&localLayers.has(layerFor(drawing,link.b.curveId)!.id))});
 const relationNodes=reconcileSnapshotEndpointRelationEdit(localRelations(before),localRelations(wanted),evaluation,state,unplace,[state],writer),shapeFor=writer.shapeFor;
 for(const curve of wanted.curves){const layerId=layerFor(wanted,curve.id)!.id;if(!localLayers.has(layerId))continue;const prior=curves.get(curve.id)!,base=evaluation.preShapeDrawing.curves.find(value=>value.id===curve.id)!;
  for(const end of [0,1] as const){const node=nodeAt(wanted,{curveId:curve.id,end}),old=nodeAt(before,{curveId:curve.id,end}),baseNode=nodeAt(evaluation.preShapeDrawing,{curveId:curve.id,end});
   if(!relationNodes.has(node.id)&&!close(node.position,old.position))shapeFor(layerId).nodes[node.id]=sub(unplace(layerId,curve.id,node.position),baseNode.position);
   if(!close(sub(curve.handles[end],node.position),sub(prior.handles[end],old.position))){const pair=writer.handlePair(layerId,curve.id);pair[end]=sub(sub(unplace(layerId,curve.id,curve.handles[end]),unplace(layerId,curve.id,node.position)),sub(base.handles[end],baseNode.position));}
  }
 }
 return state;
}

/** No partial writes: verify the complete linked/SMOOTH target before commit. */
export function assertSnapshotControlTargetReplay(actual:DrawingDocument,wanted:DrawingDocument,controlPlan?:DrawingControlEditPlan):void {
 if(controlPlan){actual=drawingControlPlanView(actual,controlPlan);wanted=drawingControlPlanView(wanted,controlPlan);}
 const verify=(label:string,a:Point2|undefined,b:Point2)=>{for(const axis of [0,1] as const)if(!a||!Number.isFinite(a[axis])||Math.abs(a[axis]-b[axis])>1e-7*Math.max(1,Math.abs(b[axis])))throw new SnapshotControlTargetError('CONTROL_TARGET_UNSOLVABLE',`${label} ${axis===0?'X':'Y'}: its complete write-stage and relation replay cannot reproduce this target.`);};
 const nodes=new Map(actual.nodes.map(node=>[node.id,node])),curves=new Map(actual.curves.map(curve=>[curve.id,curve]));for(const node of wanted.nodes)verify(`Node ${node.id}`,nodes.get(node.id)?.position,node.position);for(const curve of wanted.curves)for(const end of [0,1] as const)verify(`Handle ${curve.id} end ${end}`,curves.get(curve.id)?.handles[end],curve.handles[end]);
}


/** A collapsed field has no inverse. Solve only an actually reachable target,
 * retaining the current input on the free coordinate; never invent an epsilon
 * inverse or discard the hidden input that restoring the saved axis needs. */
function solveCollapsedControlTarget(matrix:Affine2D,anchor:Point2,target:Point2,label:string,layerId:string):Point2 {
 const current=applyAffine2D(matrix,anchor),delta=sub(target,current),[a,b,c,d]=matrix,result:Point2=[...anchor];
 if(Math.hypot(a,b)>=Math.hypot(c,d)&&Math.max(Math.abs(a),Math.abs(b))>0)result[0]+=Math.abs(a)>=Math.abs(b)?delta[0]/a:delta[1]/b;
 else if(Math.max(Math.abs(c),Math.abs(d))>0)result[1]+=Math.abs(c)>=Math.abs(d)?delta[0]/c:delta[1]/d;
 const replay=applyAffine2D(matrix,result);
 for(const axis of [0,1] as const)if(!Number.isFinite(result[axis])||Math.abs(replay[axis]-target[axis])>1e-8*Math.max(1,Math.abs(target[axis])))throw new SnapshotControlTargetError('CONTROL_AXIS_UNAVAILABLE',`${label} in layer ${layerId} ${axis===0?'X':'Y'}: its local placement cannot reach this control target while the collapsed input is retained.`);
 return result;
}
