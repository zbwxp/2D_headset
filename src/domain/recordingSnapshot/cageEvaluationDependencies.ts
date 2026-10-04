import {evaluatedMaterialSource,evaluatedFitContext,remapEvaluatedDeformations} from '../drawing/evaluatedDeformation';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from '../drawing/evaluatedAffine';
import {emptyDrawing,type DrawingDocument} from '../drawing/model';
import {instanceObjectId} from '../recordingScene/model';
import {retainSnapshotAffines} from './elementPlacement';
import {isLayerCageDomain} from './layerDomains';
import {remapDrawingIdentities} from './sources';
import type {RecordingSnapshot,SnapshotDeformationState} from './model';
import type {CageSplitLineage} from './cageSplitLineage';
export interface CageDependencyScope {layerIds:string[];fitLineages:CageSplitLineage[];enabled?:boolean}

// Shares only the current evaluation's required field inputs with descendants.
// This is not serialized or an independent Snapshot/geometry authority.
const dependencyContexts=new WeakMap<DrawingDocument['nodes'],DrawingDocument>();
export const cageEvaluationDependencyContext=(drawing:DrawingDocument)=>dependencyContexts.get(drawing.nodes)??drawing;
/** Identity-preserving topology assembly keeps the exact same private fit input.
 * Public controls take precedence; only absent evaluated dependencies are added. */
export function retainCageEvaluationDependencyContext(drawing:DrawingDocument,sources:readonly DrawingDocument[]):DrawingDocument {
 const contexts=sources.map(source=>dependencyContexts.get(source.nodes)).filter((value):value is DrawingDocument=>!!value);if(!contexts.length)return drawing;
 const curves=new Map(contexts.flatMap(value=>value.curves).map(value=>[value.id,value])),nodes=new Map(contexts.flatMap(value=>value.nodes).map(value=>[value.id,value])),joins=new Map(contexts.flatMap(value=>value.joins).map(value=>[value.id,value]));for(const curve of drawing.curves)curves.set(curve.id,curve);for(const node of drawing.nodes)nodes.set(node.id,node);for(const join of drawing.joins)joins.set(join.id,join);
 const context=retainSnapshotAffines({...drawing,curves:[...curves.values()],nodes:[...nodes.values()],joins:[...joins.values()],layers:drawing.layers.map(layer=>({...layer,items:[...new Set([...layer.items,...contexts.flatMap(value=>value.layers.find(candidate=>candidate.id===layer.id)?.items??[])])]}))},[...contexts,drawing]);dependencyContexts.set(drawing.nodes,context);return drawing;
}


/** A local membership operation does not remove the live controls on which a
 * fitted family depends. Extend only this evaluation's input with the missing
 * siblings at their same explicit source address. These are not Snapshot
 * members: all returned editor/render stages are restricted again below.
 *
 * A sibling moved into another layer needs two different local input contexts.
 * The extra context uses the existing runtime namespace adapter, never a new
 * canonical identity, library record, saved program, or geometry snapshot. */
export function prepareCageEvaluationDependencies(snapshot:RecordingSnapshot,input:DrawingDocument,state:SnapshotDeformationState,parents:ReadonlyMap<string,{drawing:DrawingDocument}>){
 const sourceForLayer=(layerId:string,representative:string)=>{const local=cageEvaluationDependencyContext(input);if(local!==input&&local.layers.some(layer=>layer.id===layerId&&layer.items.includes(representative)))return local;const slot=snapshot.layers.find(layer=>layer.id===layerId),parentId=snapshot.memberSources?.[representative]??(slot?.kind==='reference'?slot.baseSnapshotId:undefined),parent=parentId&&parents.get(parentId)?.drawing;if(!parent)return;const context=cageEvaluationDependencyContext(parent),disabled=new Set(snapshot.relations.joins?.disable??[]);return disabled.size?{...context,joins:context.joins.filter(join=>!disabled.has(join.id))}:context;};
 // Carry the same dependency through an intermediate layer even when it adds
 // only shape/placement state and has no cage of its own. Read the existing
 // fitted correspondence, rather than inventing another field or source scan.
 const inherited:CageDependencyScope[]=[];
 for(const layer of input.layers){const families=new Map<string,CageSplitLineage>(),scanned=new Map<DrawingDocument['nodes'],Set<string>>();for(const id of layer.items){if(!evaluatedFitContext(input,id)?.sourceRange)continue;const parent=sourceForLayer(layer.id,id),parentLayer=parent?.layers.find(value=>value.items.includes(id));if(!parent||!parentLayer)continue;const seen=scanned.get(parent.nodes)??new Set<string>();if(seen.has(parentLayer.id))continue;seen.add(parentLayer.id);scanned.set(parent.nodes,seen);for(const curve of parent.curves){if(!parentLayer.items.includes(curve.id))continue;const context=evaluatedFitContext(parent,curve.id);if(!context?.sourceRange)continue;const family=families.get(context.id)??{id:context.id,parts:[]};if(!family.parts.some(part=>part.curveId===curve.id))family.parts.push({curveId:curve.id,parameterRange:[...context.sourceRange]});families.set(context.id,family);}}
  if(families.size)inherited.push({layerIds:[layer.id],fitLineages:[...families.values()].map(family=>({...family,parts:family.parts.sort((a,b)=>a.parameterRange[0]-b.parameterRange[0])}))});
 }
 const prepared=prepareLayerCageDependencies(input,state,sourceForLayer,inherited);
 // An inherited-only dependency already carries its parent's field constraints.
 // It must not become an editor relation participant in this child's explicit
 // post-control solve merely because its fit input is needed at runtime.
 if(prepared.source!==input&&!state.layerDomains?.some(domain=>isLayerCageDomain(domain)&&domain.enabled!==false))prepared.source={...prepared.source,joins:input.joins,endpointLinks:input.endpointLinks};
 return prepared;
}
/** Shared by ordinary own-stage evaluation and inherited program replay. The
 * caller resolves the explicit layer source; this helper never searches IDs. */
export function prepareLayerCageDependencies(input:DrawingDocument,state:SnapshotDeformationState,sourceForLayer:(layerId:string,representativeCurveId:string)=>DrawingDocument|undefined,dependencyScopes:readonly CageDependencyScope[]=[]){
 const ownScopes=(value:SnapshotDeformationState)=>(value.layerDomains??[]).filter(isLayerCageDomain);
 const needed=[...ownScopes(state),...dependencyScopes].some(domain=>domain.enabled!==false&&domain.fitLineages?.some(family=>{const scope=new Set(input.layers.filter(layer=>domain.layerIds.includes(layer.id)).flatMap(layer=>layer.items));return family.parts.some(part=>scope.has(part.curveId))&&family.parts.some(part=>!scope.has(part.curveId));}));
 if(!needed)return {source:input,state,restrict:(drawing:DrawingDocument)=>drawing};
 const originalObjects=new Set([...input.curves,...input.fills,...input.offsets].map(value=>value.id)),originalNodes=new Set(input.nodes.map(node=>node.id));
 let source=input;const next=structuredClone(state),retained:DrawingDocument[]=[input],added=new Map<string,string>();
 const occupied=new Set([...originalObjects,...originalNodes,...input.layers.map(layer=>layer.id)]);
 const runtimeId=(layerId:string,id:string)=>{let value=instanceObjectId(`cage-dependency:${layerId}`,id);while(occupied.has(value))value=`$${value}`;occupied.add(value);return value;};
 for(const domain of [...ownScopes(next),...structuredClone(dependencyScopes)]){
  if(domain.enabled===false||!domain.fitLineages?.length)continue;
  for(const family of domain.fitLineages){
   const present=input.curves.filter(curve=>family.parts.some(part=>part.curveId===curve.id)&&input.layers.some(layer=>domain.layerIds.includes(layer.id)&&layer.items.includes(curve.id)));
   if(!present.length)continue;
   const targetLayer=input.layers.find(layer=>domain.layerIds.includes(layer.id)&&layer.items.includes(present[0].id))!;
   const parent=sourceForLayer(targetLayer.id,present[0].id);
   if(!parent)continue;
   const parentLayer=parent.layers.find(layer=>layer.items.includes(present[0].id));if(!parentLayer)continue;
   const scope=new Set(input.layers.filter(layer=>domain.layerIds.includes(layer.id)).flatMap(layer=>layer.items));
   const replacements=new Map<string,string>(),nodeReplacements=new Map<string,string>();
   for(const part of family.parts){
    if(scope.has(part.curveId))continue;
    // No canonical fallback: absent source children really have been deleted.
    const curve=parent.curves.find(curve=>curve.id===part.curveId&&parentLayer.items.includes(curve.id));if(!curve)continue;
    const key=JSON.stringify([targetLayer.id,curve.id]),known=added.get(key);if(known){replacements.set(curve.id,known);continue;}
    const mapped=originalObjects.has(curve.id)?runtimeId(targetLayer.id,curve.id):curve.id;added.set(key,mapped);replacements.set(curve.id,mapped);
    for(const id of curve.nodes){if(nodeReplacements.has(id))continue;const existing=source.nodes.find(node=>node.id===id),parentNode=parent.nodes.find(node=>node.id===id);if(!parentNode)throw Error(`Cage dependency ${curve.id} is missing live input node ${id}.`);
     const own=source.curves.some(value=>targetLayer.items.includes(value.id)&&value.nodes.includes(id));nodeReplacements.set(id,existing&&!own?runtimeId(targetLayer.id,id):id);
    }
    const map=(id:string)=>replacements.get(id)??nodeReplacements.get(id)??id,nodes=new Set(curve.nodes),fragment=retainSnapshotAffines({...emptyDrawing(),layers:[{...targetLayer,items:[curve.id]}],curves:[curve],nodes:parent.nodes.filter(node=>nodes.has(node.id))},[parent]),mappedSource=remapDrawingIdentities(fragment,map),inverse=new Map([...replacements,...nodeReplacements].map(([id,mapped])=>[mapped,id])),unmap=(id:string)=>inverse.get(id)??id;
    remapEvaluatedDeformations(mappedSource,fragment,remapDrawingIdentities(evaluatedMaterialSource(fragment),map),map,unmap);
    const affineSource=evaluatedAffineSource(fragment);if(affineSource)registerEvaluatedAffine(mappedSource,remapDrawingIdentities(affineSource,map),id=>evaluatedAffine(fragment,unmap(id)));
    retained.push(mappedSource);
    const haveNodes=new Set(source.nodes.map(node=>node.id));source={...source,layers:source.layers.map(layer=>layer.id===targetLayer.id?{...layer,items:[...layer.items,mapped]}:layer),curves:[...source.curves,...mappedSource.curves],nodes:[...source.nodes,...mappedSource.nodes.filter(node=>!haveNodes.has(node.id))]};
    const local=next.layers[targetLayer.id];if(local?.shape){const handles=local.shape.handles[curve.id];if(handles&&mapped!==curve.id)local.shape.handles[mapped]=structuredClone(handles);for(const id of curve.nodes){const renamed=map(id),delta=local.shape.nodes[id];if(delta&&renamed!==id)local.shape.nodes[renamed]=[...delta];}}
    if(local?.elementPlacements?.[curve.id]&&mapped!==curve.id)local.elementPlacements[mapped]=structuredClone(local.elementPlacements[curve.id]);
   }
   if(!replacements.size)continue;
   const map=(id:string)=>replacements.get(id)??nodeReplacements.get(id)??id;
   family.parts=family.parts.map(part=>({...part,curveId:map(part.curveId)}));
   for(const candidate of next.layerDomains??[]){if(!candidate.layerIds.includes(targetLayer.id))continue;
    if(isLayerCageDomain(candidate)&&candidate.strokeScope)candidate.strokeScope={...candidate.strokeScope,curveIds:candidate.strokeScope.curveIds.map(map)};
    if(candidate.postShape){
     const inScope=(id:string)=>input.layers.some(layer=>candidate.layerIds.includes(layer.id)&&layer.items.some(curveId=>curveId===id||input.curves.some(curve=>curve.id===curveId&&curve.nodes.includes(id))));
     for(const [id,mapped] of replacements)if(mapped!==id&&candidate.postShape.handles[id]){candidate.postShape.handles[mapped]=structuredClone(candidate.postShape.handles[id]);if(!inScope(id))delete candidate.postShape.handles[id];}
     for(const [id,mapped] of nodeReplacements)if(mapped!==id&&candidate.postShape.nodes[id]){candidate.postShape.nodes[mapped]=[...candidate.postShape.nodes[id]];if(!inScope(id))delete candidate.postShape.nodes[id];}
    }
    if(candidate.shapeLineages)candidate.shapeLineages=candidate.shapeLineages.map(root=>root.id===family.id?{...root,parts:root.parts.map(part=>({...part,curveId:map(part.curveId)}))}:root);
   }
   // Preserve constraints only when both live curve inputs participate in this
   // layer context. Missing endpoints never add a relation or a fake curve.
   const ids=new Set(source.layers.find(layer=>layer.id===targetLayer.id)!.items),existing=new Set(source.joins.map(join=>join.id));
   source={...source,joins:[...source.joins,...parent.joins.filter(join=>ids.has(map(join.a.curveId))&&ids.has(map(join.b.curveId))&&!existing.has(join.id)).map(join=>({...join,a:{...join.a,curveId:map(join.a.curveId)},b:{...join.b,curveId:map(join.b.curveId)}}))]};
  }
 }
 if(source===input)return {source:input,state,restrict:(drawing:DrawingDocument)=>drawing};
 source=retainSnapshotAffines(source,retained);
 const restrict=(drawing:DrawingDocument):DrawingDocument=>{
  const curveIds=new Set(drawing.curves.filter(curve=>originalObjects.has(curve.id)).map(curve=>curve.id));
  const result=retainSnapshotAffines({...drawing,layers:drawing.layers.map(layer=>({...layer,items:layer.items.filter(id=>originalObjects.has(id))})),curves:drawing.curves.filter(curve=>curveIds.has(curve.id)),nodes:drawing.nodes.filter(node=>originalNodes.has(node.id)),fills:drawing.fills.filter(fill=>originalObjects.has(fill.id)),offsets:drawing.offsets.filter(offset=>originalObjects.has(offset.id)),joins:drawing.joins.filter(join=>curveIds.has(join.a.curveId)&&curveIds.has(join.b.curveId)),endpointLinks:drawing.endpointLinks?.filter(link=>curveIds.has(link.a.curveId)&&curveIds.has(link.b.curveId)),groups:drawing.groups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})).filter(group=>group.curveIds.length)},[drawing]);
  dependencyContexts.set(result.nodes,drawing);return result;
 };
 return {source,state:next,restrict};
}
