import {evaluatedMaterialSource,evaluatedMaterialProgram,hasNonlinearDeformationFor} from '../drawing/evaluatedDeformation';
import {identityAffine2D} from '../geometry/affine2d';
import type {EvaluatedMaterialStep} from '../drawing/materialProgram';
import {drawingSmoothComponents,projectDrawingSmoothComponent} from '../drawing/smoothHandleAuthoring';
import {layerFor,shapeOf,add,sub,type DrawingDocument,type DrawingCurve,type Point2} from '../drawing/model';
import {isLayerCageDomain,type SnapshotLayerDomain} from './layerDomains';
import {layerUsesCage} from './layerDomainControlEdit';
import type {SnapshotEvaluation} from './evaluation';
import {layerCageCurveIds} from './layerCageScope';

/** Existing output stages and live inherited fields both accept an explicit
 * final-space topology target. Inherited fields receive a sparse local output
 * stage; their canonical material and parent program remain live. */
export function nonlinearTopologyTargetLayers(evaluation:SnapshotEvaluation,target:DrawingDocument,inheritedPrograms:ReadonlyMap<string,EvaluatedMaterialStep[]>=new Map()):Set<string> {
 const before=evaluation.drawing;
 const signature=(drawing:DrawingDocument,layerId:string)=>{const ids=new Set(drawing.layers.find(layer=>layer.id===layerId)?.items??[]),curves=drawing.curves.filter(curve=>ids.has(curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes));return JSON.stringify([curves.map(curve=>[curve.id,curve.nodes,curve.handles]),drawing.nodes.filter(node=>nodes.has(node.id)),drawing.joins.filter(join=>ids.has(join.a.curveId)||ids.has(join.b.curveId)),drawing.endpointLinks?.filter(link=>ids.has(link.a.curveId)||ids.has(link.b.curveId))??[]]);};
 return new Set(target.layers.filter(layer=>(layerUsesCage(evaluation.state.layerDomains,layer.id)||layer.items.some(id=>inheritedPrograms.get(id)?.length)||evaluation.source.curves.some(curve=>evaluation.source.layers.find(value=>value.id===layer.id)?.items.includes(curve.id)&&hasNonlinearDeformationFor(evaluation.source,curve.id)))&&signature(before,layer.id)!==signature(target,layer.id)).map(layer=>layer.id));
}

/** A new child-owned P curve has two explicit parts: a finite canonical input
 * draft in the first cage's fixed rest frame, and its authored output target.
 * Normalize only the NEW input controls into the central rest rectangle; this
 * is an input policy, not an inverse of the field or of its fitted handles.
 * Existing shared nodes retain their live input identity and position.
 */
export function createNonlinearTopologyInput(evaluation:SnapshotEvaluation,target:DrawingDocument,newIds:ReadonlySet<string>,layerIds:ReadonlySet<string>,inheritedPrograms:ReadonlyMap<string,EvaluatedMaterialStep[]>=new Map()):Map<string,{curve:DrawingCurve;nodes:Map<string,Point2>}> {
 const result=new Map<string,{curve:DrawingCurve;nodes:Map<string,Point2>}>(),material=evaluatedMaterialSource(evaluation.source),inputNodes=new Map(material.nodes.map(node=>[node.id,node.position]));
 const firstCage=(steps:readonly EvaluatedMaterialStep[],layerId:string,curveId:string):import('./layerCageDomain').SnapshotLayerCageDomain|undefined=>{for(const step of steps){if(step.kind==='cage'&&layerCageCurveIds(target,{...step.domain,layerIds:[layerId]}).has(curveId))return step.domain;if(step.kind==='reflected'){const cage=firstCage(step.steps,layerId,curveId);if(cage)return cage;}}};
 for(const layerId of layerIds){
  const groups=new Map<string,{domain:import('./layerCageDomain').SnapshotLayerCageDomain;curves:DrawingCurve[]}>();
  for(const curve of target.curves.filter(curve=>newIds.has(curve.id)&&layerFor(target,curve.id)?.id===layerId)){
   const inherited=inheritedPrograms.get(curve.id),sourceSteps=inherited??evaluation.source.curves.filter(peer=>layerFor(evaluation.source,peer.id)?.id===layerId).flatMap(peer=>evaluatedMaterialProgram(evaluation.source,peer.id)??[]),domain=firstCage(sourceSteps,layerId,curve.id)??evaluation.state.layerDomains?.find(domain=>domain.enabled!==false&&isLayerCageDomain(domain)&&layerCageCurveIds(target,domain).has(curve.id));
   if(!domain||!isLayerCageDomain(domain))continue;
   const key=JSON.stringify(domain),group=groups.get(key)??{domain,curves:[]};group.curves.push(curve);groups.set(key,group);
  }
  for(const {domain,curves} of groups.values()){
   const points=curves.flatMap(curve=>shapeOf(target,curve.id)),min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
   const map=(point:Point2):Point2=>point.map((value,axis)=>domain.restRect.min[axis]+(domain.restRect.max[axis]-domain.restRect.min[axis])*(max[axis]===min[axis] ? .5 : .2+.6*(value-min[axis])/(max[axis]-min[axis]))) as Point2;
   for(const curve of curves){
    const shape=shapeOf(target,curve.id),nodes=new Map<string,Point2>();
    for(const end of [0,1] as const){const id=curve.nodes[end],position=inputNodes.get(id)??map(shape[end?3:0]);inputNodes.set(id,position);nodes.set(id,position);}
    const handles=curve.handles.map((point,end)=>add(nodes.get(curve.nodes[end])!,sub(map(point),map(shape[end?3:0])))) as [Point2,Point2];
    result.set(curve.id,{curve:{...structuredClone(curve),handles},nodes});
   }
  }
 }
 // A continued SMOOTH segment starts on the existing input tangent ray.
 // Use the same component law as native Pen, copying only NEW source handles.
 // Existing source controls remain owned by their original source.
 if(result.size){
  const input:DrawingDocument={...target,nodes:target.nodes.map(node=>({...node,position:[...(inputNodes.get(node.id)??node.position)] as Point2})),curves:target.curves.map(curve=>structuredClone(result.get(curve.id)?.curve??material.curves.find(value=>value.id===curve.id)??curve))};
  for(const component of drawingSmoothComponents(input))if([...component.ends.values()].some(({endpoint})=>result.has(endpoint.curveId))){
   const driver=[...component.ends.values()].find(({endpoint})=>!result.has(endpoint.curveId))?.endpoint??component.driver;projectDrawingSmoothComponent(input,component,driver);
  }
  for(const [id,value] of result)value.curve.handles=input.curves.find(curve=>curve.id===id)!.handles;
 }
 return result;
}

/** Topology changes the baseline and its relation projector. Re-author the last
 * stage's controls against its actual uncorrected output; incrementing offsets
 * from an already projected follower would apply the SMOOTH law twice. */
export function nonlinearTopologyControlBase(evaluated:readonly SnapshotLayerDomain[],own:readonly SnapshotLayerDomain[]|undefined,layerIds:ReadonlySet<string>,fresh?:()=>string):SnapshotLayerDomain[] {
 let domains=[...own??[]];
 const missing=[...layerIds].filter(layerId=>!evaluated.some(domain=>domain.enabled!==false&&domain.layerIds.includes(layerId)));
 if(missing.length&&fresh)domains.push({id:fresh(),kind:'affine',layerIds:missing,matrix:identityAffine2D(),postShape:{nodes:{},handles:{}}});
 const selected=new Set([...layerIds].map(layerId=>[...evaluated].reverse().find(domain=>domain.enabled!==false&&domain.layerIds.includes(layerId))?.id).filter((id):id is string=>!!id));
 for(const domain of evaluated)if(selected.has(domain.id)){const base={...structuredClone(domain),postShape:{nodes:{},handles:{}}};domains=domains.some(value=>value.id===domain.id)?domains.map(value=>value.id===domain.id?base:value):[...domains,base];}
 return domains;
}

/** A domain may cover several layers. Clearing it for baseline evaluation does
 * not authorize replacing another layer's explicit control entries. */
export function retainOtherTopologyControls(domains:readonly SnapshotLayerDomain[],evaluated:readonly SnapshotLayerDomain[],own:readonly SnapshotLayerDomain[]|undefined,target:DrawingDocument,layerIds:ReadonlySet<string>,retiredNodes:ReadonlySet<string>):SnapshotLayerDomain[] {
 const curves=new Set(target.curves.filter(curve=>layerIds.has(layerFor(target,curve.id)!.id)).map(curve=>curve.id)),nodes=new Set(target.curves.filter(curve=>curves.has(curve.id)).flatMap(curve=>curve.nodes));
 return domains.map(domain=>{const prior=own?.find(value=>value.id===domain.id)??evaluated.find(value=>value.id===domain.id);if(!domain.postShape||!prior?.postShape)return domain;return {...domain,postShape:{nodes:{...Object.fromEntries(Object.entries(prior.postShape.nodes).filter(([id])=>!nodes.has(id)&&!retiredNodes.has(id))),...domain.postShape.nodes},handles:{...Object.fromEntries(Object.entries(prior.postShape.handles).filter(([id])=>!curves.has(id))),...domain.postShape.handles}}};});
}
