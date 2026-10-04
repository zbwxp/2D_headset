import {prepareLayerCageDependencies,cageEvaluationDependencyContext,retainCageEvaluationDependencyContext} from './cageEvaluationDependencies';
import {emptySnapshotDeformationState} from './model';
import {identityAffine2D} from '../geometry/affine2d';
import type {SnapshotLayerDomain} from './layerDomains';
import {evaluatedMaterialProgram,evaluatedMaterialSource,hasNonlinearDeformationFor} from '../drawing/evaluatedDeformation';
import {drawingSmoothComponents,projectDrawingSmoothComponent} from '../drawing/smoothHandleAuthoring';
import type {DrawingDocument} from '../drawing/model';
import {remapMaterialProgram,type EvaluatedMaterialStep} from '../drawing/materialProgram';
import {applyOwnedMaterialProgram} from './materialProgramEvaluation';
import {retainSnapshotAffines} from './elementPlacement';

/** Replay a topology-adapted canonical input through today's inherited program.
 * The caller supplies identity lineage, never inverse-fitted output handles.
 * Programs remain runtime values obtained from the live parent on every resolve. */
export function replaySnapshotTopologyMaterial(before:DrawingDocument,material:DrawingDocument,programs:ReadonlyMap<string,EvaluatedMaterialStep[]>,sourceForLayer:(layerId:string,representativeCurveId:string)=>DrawingDocument|undefined=()=>undefined):DrawingDocument {
 const groups=new Map<string,{steps:EvaluatedMaterialStep[];ids:Set<string>}>();
 for(const [id,steps] of programs){const key=JSON.stringify(steps),group=groups.get(key)??{steps,ids:new Set<string>()};group.ids.add(id);groups.set(key,group);}
 let result=before;
 for(const {steps,ids} of groups.values()){
  const curves=material.curves.filter(curve=>ids.has(curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes)),items=new Set([...ids,...material.fills.filter(fill=>fill.boundary.every(use=>ids.has(use.id))).map(fill=>fill.id),...material.offsets.filter(offset=>offset.source.every(use=>ids.has(use.id))).map(offset=>offset.id)]);
  const scoped:DrawingDocument={...material,layers:material.layers.map(layer=>({...layer,items:layer.items.filter(id=>items.has(id))})).filter(layer=>layer.items.length),curves:structuredClone(curves),nodes:material.nodes.filter(node=>nodes.has(node.id)).map(node=>structuredClone(node)),fills:material.fills.filter(fill=>items.has(fill.id)),offsets:material.offsets.filter(offset=>items.has(offset.id)),joins:material.joins.filter(join=>ids.has(join.a.curveId)&&ids.has(join.b.curveId)),endpointLinks:material.endpointLinks?.filter(link=>ids.has(link.a.curveId)&&ids.has(link.b.curveId)),displayIntervals:material.displayIntervals?.filter(track=>ids.has(track.anchor.id))};
  // The shared dependency adapter supplies live hidden split siblings in this
  // same canonical frame before the existing ordered material replay runs.
  const layerIds=scoped.layers.map(layer=>layer.id),domains:SnapshotLayerDomain[]=steps.flatMap((step,index)=>step.kind==='reflected'?[]:[step.kind==='cage'?{...step.domain,id:`topology-input:${index}`,layerIds}:{id:`topology-input:${index}`,layerIds,matrix:step.kind==='affine'?step.matrix:identityAffine2D(),...(step.kind==='post-shape'?{postShape:step.value}:{})}]);
  const dependency=prepareLayerCageDependencies(scoped,{...emptySnapshotDeformationState(),layerDomains:domains},sourceForLayer),updated=new Map(dependency.state.layerDomains?.map(domain=>[domain.id,domain]));
  const replaySteps=steps.map((step,index):EvaluatedMaterialStep=>{const domain=updated.get(`topology-input:${index}`);if(!domain)return step;if(step.kind==='cage'&&domain.kind==='h-coons')return {kind:'cage',domain:{...domain,id:step.domain.id,layerIds:step.domain.layerIds}};if(step.kind==='post-shape')return {...step,value:domain.postShape!};return step;});
  // New relations use the native shared SMOOTH law in the retained input frame.
  for(const component of drawingSmoothComponents(dependency.source)){const endpoints=[...component.ends.values()].map(value=>value.endpoint),original=sourceForLayer(layerIds[0],component.driver.curveId),existing=original&&drawingSmoothComponents(original).some(value=>JSON.stringify([...value.ends.keys()])===JSON.stringify([...component.ends.keys()]));if(!existing&&endpoints.length)projectDrawingSmoothComponent(dependency.source,component);}
  const live=new Set([...dependency.source.nodes,...dependency.source.curves].map(value=>value.id)),scopedSteps=remapMaterialProgram(replaySteps,id=>id,{keepObject:id=>live.has(id)}),projected=dependency.restrict(applyOwnedMaterialProgram(dependency.source,layerIds,scopedSteps)),byId=<T extends {id:string}>(values:T[])=>new Map(values.map(value=>[value.id,value])),nextNodes=byId(projected.nodes),nextCurves=byId(projected.curves);
  const next=retainSnapshotAffines({...result,nodes:result.nodes.map(node=>nextNodes.get(node.id)??node),curves:result.curves.map(curve=>nextCurves.get(curve.id)??curve)},[result,projected]);result=retainCageEvaluationDependencyContext(next,[result,projected]);
 }
 return result;
}

/** Explicit child-owned members join the same live layer field as their parent
 * peers. Parent additions still arrive with no child-authored correction. */
export function inheritedTopologyLayerProgram(parent:DrawingDocument,layerId:string):EvaluatedMaterialStep[]|undefined {
 const ids=new Set(parent.layers.find(layer=>layer.id===layerId)?.items??[]),curves=parent.curves.filter(curve=>ids.has(curve.id));
 if(!curves.some(curve=>hasNonlinearDeformationFor(parent,curve.id)))return undefined;
 const steps=evaluatedMaterialProgram(parent,curves[0].id);
 if(!steps)throw Error(`Layer ${layerId}: the inherited field has no replayable material lineage.`);
 if(curves.some(curve=>JSON.stringify(evaluatedMaterialProgram(parent,curve.id))!==JSON.stringify(steps)))throw Error(`Layer ${layerId}: its inherited members have different material programs; the new curve needs a single explicit field scope.`);
 return steps;
}
export function extendSnapshotInheritedTopology(input:DrawingDocument,parent:DrawingDocument,layerId:string,parentLayerId:string,localIds:ReadonlySet<string>,remoteIds:ReadonlySet<string>=new Set()):DrawingDocument {
 if(!input.curves.some(curve=>localIds.has(curve.id)))return input;
 const steps=inheritedTopologyLayerProgram(parent,parentLayerId);if(!steps)return input;
 const members=new Set(input.layers.find(layer=>layer.id===layerId)?.items??[]),programs=new Map(input.curves.filter(curve=>members.has(curve.id)&&!remoteIds.has(curve.id)).map(curve=>[curve.id,steps]));
 return replaySnapshotTopologyMaterial(input,evaluatedMaterialSource(input),programs,()=>evaluatedMaterialSource(cageEvaluationDependencyContext(parent)));
}
