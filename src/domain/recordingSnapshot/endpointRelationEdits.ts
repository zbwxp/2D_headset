import {layerFor,length,nodeAt,sub,uid,type DrawingDocument,type Point2} from '../drawing/model';
import {linkedNodeIds} from '../drawing/endpointLinks';
import type {SnapshotEvaluation} from './evaluation';
import type {SnapshotDeformationState} from './model';
import type {SnapshotControlTargetWriter} from './controlTargetWriter';

const close=(a:Point2,b:Point2)=>length(sub(a,b))<=1e-8*Math.max(1,length(a),length(b));
/** A relation edit changes the post-Warp baseline itself. Rebase its controls
 * against that live baseline, once per linked component, without rewriting any
 * canonical node or introducing a separate position authority per layer. */
export function reconcileSnapshotEndpointRelationEdit(before:DrawingDocument,target:DrawingDocument,evaluation:SnapshotEvaluation,state:SnapshotDeformationState,unplace:(layerId:string,curveId:string,point:Point2)=>Point2,authorityStates:SnapshotDeformationState[]=[state],writer?:SnapshotControlTargetWriter):Set<string> {
 const priorLinks=before.endpointLinks??[],links=target.endpointLinks??[];
 const changedIds=new Set([...priorLinks,...links].filter(link=>{
  const prior=priorLinks.find(value=>value.id===link.id),next=links.find(value=>value.id===link.id);
  return JSON.stringify(prior)!==JSON.stringify(next)||!!prior&&!!next&&[prior.a,prior.b].some(endpoint=>!close(nodeAt(before,endpoint).position,nodeAt(target,endpoint).position));
 }).map(link=>link.id));
 if(!changedIds.size)return new Set();
 const affected=new Set<string>();
 for(const document of [before,target])for(const link of document.endpointLinks??[])if(changedIds.has(link.id))for(const endpoint of [link.a,link.b])for(const nodeId of linkedNodeIds(document,nodeAt(document,endpoint).id))affected.add(nodeId);
 const shapeFor=writer?.shapeFor??((layerId:string)=>{const layer=state.layers[layerId]??={};return layer.shape??=structuredClone(evaluation.state.layers[layerId]?.shape??{nodes:{},handles:{}});});
 const positions=(saved=state)=>saved===state&&writer?writer.relationPositions():saved.relationPositions;
 const liveIds=new Set(links.map(link=>link.id));
 for(const [id,value] of Object.entries(state.relationPositions)){const sourceLinkIds=value.sourceLinkIds.filter(id=>liveIds.has(id));if(!sourceLinkIds.length)delete positions()[id];else if(sourceLinkIds.length!==value.sourceLinkIds.length)positions()[id]={...value,sourceLinkIds};}
 const handled=new Set<string>();
 for(const nodeId of affected){
  if(handled.has(nodeId)||!target.nodes.some(node=>node.id===nodeId))continue;
  const component=[...linkedNodeIds(target,nodeId)],componentLinks=links.filter(link=>component.includes(nodeAt(target,link.a).id)&&component.includes(nodeAt(target,link.b).id));
  const deltas=component.map(id=>{const curve=target.curves.find(curve=>curve.nodes.includes(id))!,layerId=layerFor(target,curve.id)!.id,point=target.nodes.find(node=>node.id===id)!.position,base=evaluation.preShapeDrawing.nodes.find(node=>node.id===id);if(!base)throw Error('A linked endpoint has no canonical input.');return {id,layerId,delta:sub(unplace(layerId,curve.id,point),base.position)};});
  if(componentLinks.length){
   if(deltas.some(value=>!close(value.delta,deltas[0].delta)))throw Error('Linked endpoints have incompatible layer or stroke placements. Give their layers and strokes coherent placement values before linking.');
   const sourceLinkIds=componentLinks.map(link=>link.id).sort(),previous=Object.entries(evaluation.state.relationPositions).find(([,value])=>value.sourceLinkIds.some(id=>sourceLinkIds.includes(id))),id=previous?.[0]??uid();
   for(const saved of authorityStates)for(const [key,value] of Object.entries(saved.relationPositions))if(key!==id&&value.sourceLinkIds.some(id=>sourceLinkIds.includes(id)))delete positions(saved)[key];
   positions()[id]={sourceLinkIds,offset:deltas[0].delta};
   for(const value of deltas)delete shapeFor(value.layerId).nodes[value.id];
  }else for(const value of deltas)shapeFor(value.layerId).nodes[value.id]=value.delta;
  component.forEach(id=>handled.add(id));
 }
 // Adding/removing a shared endpoint also changes the fitted adjacent handles.
 // Retain Drawing's actual target handles as local residuals over that baseline.
 for(const curve of target.curves){const layerId=layerFor(target,curve.id)!.id,base=evaluation.preShapeDrawing.curves.find(value=>value.id===curve.id);if(!base||!curve.nodes.some(id=>handled.has(id)))continue;
  for(const end of [0,1] as const){
   const point=nodeAt(target,{curveId:curve.id,end}).position,basePoint=nodeAt(evaluation.preShapeDrawing,{curveId:curve.id,end}).position,vector=sub(unplace(layerId,curve.id,curve.handles[end]),unplace(layerId,curve.id,point)),handles=writer?writer.handlePair(layerId,curve.id):(shapeFor(layerId).handles[curve.id]??=[[0,0],[0,0]]);
   handles[end]=sub(vector,sub(base.handles[end],basePoint));
  }
 }
 return handled;
}
