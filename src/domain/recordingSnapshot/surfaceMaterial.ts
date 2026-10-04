import type {DrawingDocument} from '../drawing/model';
import {intervalPinch} from '../drawing/intervalPinch';
import {retainSnapshotAffines} from './elementPlacement';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {evaluateSnapshotMaterialRecipe} from './materialRestriction';
import {snapshotMaterialPartitionValue} from './materialSplit';
import type {Angle,SnapshotAngleGraph} from './model';
import {blendSnapshotPropertyValues,createSnapshotPropertyResponseSampler} from './propertyResponses';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {transportSnapshotSimplexMaterial} from './simplexMaterial';
import type {SnapshotSimplexLocation} from './triangulation';
import type {SnapshotSurfaceMirrorMaterial} from './surfaceMirrorContext';

/** One material stage for native rendering and reflected source sampling.
 * Geometry and membership are already resolved; full-curve onions never enter. */
export function evaluateSnapshotSurfaceMaterial(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],input:DrawingDocument,angle:Angle,mirror?:SnapshotSurfaceMirrorMaterial):{drawing:DrawingDocument;diagnostics:string[]} {
 if(location.kind==='vertex')return {drawing:input,diagnostics:[]};
 const drawing=retainSnapshotRouteMaterialInput(retainSnapshotAffines({...input},[input]),input),active=location.snapshotIds.map(id=>bases.find(base=>base.snapshotId===id)!);
 let recipe=graph.materialRecipes?.[location.simplexId];
 if(mirror){
  // Zero-column authoring belongs to 0− and arrives through the live reflected
  // field. Do not also extend its native response into the positive triangle.
  if(recipe)recipe={...recipe,terms:recipe.terms.map(term=>({...term,field:{...term.field,properties:term.field.properties.map(property=>({...property,edges:property.edges.map(edge=>term.field.angles[edge.from].x===0&&term.field.angles[edge.to].x===0?{from:edge.from,to:edge.to}:edge)}))}}))};
 }
 const retained=recipe?evaluateSnapshotMaterialRecipe(recipe,bases,drawing,angle,graph.materialPartitions,graph.materialPathLineages):undefined;
 const native=createSnapshotPropertyResponseSampler(graph,location,{omitZeroEdgeResponses:!!mirror}),inherited=(target:Parameters<typeof native>[0])=>retained?snapshotMaterialPartitionValue(graph.materialPartitions,retained.drawing,target,graph.materialPathLineages):undefined;
 const material=transportSnapshotSimplexMaterial(active,retained?.drawing??drawing,location.geometricWeights,{partitions:graph.materialPartitions,pathLineages:graph.materialPathLineages,inherited,response:(target,values,weights)=>{
  const old=inherited(target),sampled=native(target,values,weights),value=old===undefined?sampled:old+(sampled-blendSnapshotPropertyValues(values,weights));return mirror?.sample(target,value)??value;
 },pinch:(trackId,rangeId)=>{const range=retained?.drawing.displayIntervals?.find(track=>track.id===trackId)?.ranges.find(range=>range.id===rangeId);return range?intervalPinch(range):undefined;}});
 return {drawing:material.drawing,diagnostics:[...new Set([...material.diagnostics,...retained?.diagnostics??[],...mirror?.diagnostics??[]])]};
}
