import type {DrawingDocument} from '../drawing/model';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../drawing/affineDrawing';
import {reflectMaterialProgramFrame} from '../drawing/materialProgramFrame';
import {validateMaterialProgram,type EvaluatedMaterialStep} from '../drawing/materialProgram';
import {retainSnapshotAffines} from './elementPlacement';
import {applyLayerCageDomain,applyLayerDomainPostShape} from './layerCageEvaluation';

/** Rebuild the saved projectors from owned material and authored parameters.
 * A reflection restores the original forward fitting frame before replay and
 * reuses the same exact wrapper on output; it never refits mirrored controls. */
function replay(input:DrawingDocument,steps:readonly EvaluatedMaterialStep[],tolerance:number):DrawingDocument {
 let drawing=input;
 const layerIds=input.layers.map(layer=>layer.id),scope=new Set(input.curves.map(curve=>curve.id)),owners=drawingLayerObjectOwners(input);
 for(const step of steps){
  if(step.kind==='affine')drawing=placeDrawingAffines(drawing,Object.fromEntries(layerIds.map(id=>[id,step.matrix])),id=>owners.get(id),{retainMaterial:true});
  else if(step.kind==='cage')drawing=applyLayerCageDomain(drawing,{...step.domain,layerIds},undefined,tolerance);
  else if(step.kind==='post-shape')drawing=applyLayerDomainPostShape(drawing,step.value,scope,tolerance);
  else {const frame={axisX:step.axisX,reverseCurveIds:step.reverseCurveIds};drawing=reflectMaterialProgramFrame(replay(reflectMaterialProgramFrame(drawing,frame),step.steps,tolerance),frame);}
 }
 return drawing;
}
export function applyOwnedMaterialProgram(input:DrawingDocument,layerIds:readonly string[],steps:readonly EvaluatedMaterialStep[],tolerance=.00004):DrawingDocument {
 validateMaterialProgram(steps);
 const layers=input.layers.filter(layer=>layerIds.includes(layer.id)),items=new Set(layers.flatMap(layer=>layer.items)),curves=input.curves.filter(curve=>items.has(curve.id)),ids=new Set(curves.map(curve=>curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes));
 if(!curves.length)return input;
 const scoped=retainSnapshotAffines({...input,layers,curves,nodes:input.nodes.filter(node=>nodes.has(node.id)),fills:input.fills.filter(fill=>items.has(fill.id)),offsets:input.offsets.filter(offset=>items.has(offset.id)),joins:input.joins.filter(join=>ids.has(join.a.curveId)&&ids.has(join.b.curveId)),endpointLinks:input.endpointLinks?.filter(link=>ids.has(link.a.curveId)&&ids.has(link.b.curveId)),displayIntervals:input.displayIntervals?.filter(track=>ids.has(track.anchor.id)),groups:input.groups?.filter(group=>group.curveIds.some(id=>ids.has(id))).map(group=>({...group,curveIds:group.curveIds.filter(id=>ids.has(id))}))},[input]);
 const evaluated=replay(scoped,steps,tolerance),byId=<T extends {id:string}>(values:T[])=>new Map(values.map(value=>[value.id,value])),evaluatedNodes=byId(evaluated.nodes),evaluatedCurves=byId(evaluated.curves),evaluatedOffsets=byId(evaluated.offsets);
 return retainSnapshotAffines({...input,nodes:input.nodes.map(node=>evaluatedNodes.get(node.id)??node),curves:input.curves.map(curve=>evaluatedCurves.get(curve.id)??curve),offsets:input.offsets.map(offset=>evaluatedOffsets.get(offset.id)??offset)},[input,evaluated]);
}
