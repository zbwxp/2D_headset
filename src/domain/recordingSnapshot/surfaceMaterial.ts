import type {DrawingDocument} from '../drawing/model';
import {intervalPinch} from '../drawing/intervalPinch';
import {retainSnapshotAffines} from './elementPlacement';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {evaluateSnapshotMaterialRecipe,snapshotMaterialRecipeHasMirror,snapshotPositiveMaterialRecipe} from './materialRestriction';
import {snapshotMaterialPartitionValue} from './materialSplit';
import type {Angle,SnapshotAngleGraph} from './model';
import {blendSnapshotPropertyValues,createSnapshotPropertyResponseSampler} from './propertyResponses';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {transportSnapshotSimplexMaterial,type SnapshotSimplexMaterialOptions} from './simplexMaterial';
import {retainPreparedSnapshotSurfaceMaterial,revisePreparedSnapshotSurfaceMaterial,type SnapshotSurfaceMaterialEvaluationOptions,type SnapshotSurfaceMaterialResult} from './preparedSurfaceMaterial';
export type {SnapshotSurfaceMaterialEvaluationOptions,SnapshotSurfaceMaterialResult} from './preparedSurfaceMaterial';
import type {SnapshotSimplexLocation} from './triangulation';
import type {SnapshotSurfaceMirrorContext} from './surfaceMirrorContext';

/** One material stage for native rendering and reflected source sampling.
 * Geometry and membership are already resolved; full-curve onions never enter. */
export function evaluateSnapshotSurfaceMaterial(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],input:DrawingDocument,angle:Angle,mirror?:SnapshotSurfaceMirrorContext,preparation:SnapshotSurfaceMaterialEvaluationOptions={}):SnapshotSurfaceMaterialResult {
 if(location.kind==='vertex')return {drawing:input,diagnostics:[]};
 const active=location.snapshotIds.map(id=>bases.find(base=>base.snapshotId===id)!),inputs={graph,location,bases:active,input,angle,mirror},revised=revisePreparedSnapshotSurfaceMaterial(inputs,preparation);if(revised)return revised;
 const drawing=retainSnapshotRouteMaterialInput(retainSnapshotAffines({...input},[input]),input);
 let recipe=graph.materialRecipes?.[location.simplexId];const positive=!!mirror&&angle.x>0,implicit=positive&&!snapshotMaterialRecipeHasMirror(recipe)?mirror?.material?.(location,drawing):undefined;
 if(positive){
  // Zero-column authoring belongs to 0− and arrives through the live reflected
  // field. Do not also extend its native response into the positive triangle.
  if(recipe&&!snapshotMaterialRecipeHasMirror(recipe))recipe=snapshotPositiveMaterialRecipe(recipe);
 }
 const retained=recipe?evaluateSnapshotMaterialRecipe(recipe,bases,drawing,angle,graph.materialPartitions,graph.materialPathLineages,mirror):undefined;
 const native=createSnapshotPropertyResponseSampler(graph,location,{omitZeroEdgeResponses:positive}),inherited=(target:Parameters<typeof native>[0])=>retained?snapshotMaterialPartitionValue(graph.materialPartitions,retained.drawing,target,graph.materialPathLineages):undefined;
 const options:SnapshotSimplexMaterialOptions={partitions:graph.materialPartitions,pathLineages:graph.materialPathLineages,inherited,response:(target,values,weights)=>{
  const old=inherited(target),sampled=native(target,values,weights),value=old===undefined?sampled:old+(sampled-blendSnapshotPropertyValues(values,weights));return implicit?.sample(target,value)??value;
 },pinch:(trackId,rangeId)=>{const range=retained?.drawing.displayIntervals?.find(track=>track.id===trackId)?.ranges.find(range=>range.id===rangeId);return range?intervalPinch(range):undefined;}};
 const material=transportSnapshotSimplexMaterial(active,retained?.drawing??drawing,location.geometricWeights,options),result={drawing:material.drawing,diagnostics:[...new Set([...material.diagnostics,...retained?.diagnostics??[],...implicit?.diagnostics??[]])]};
 if(preparation.retainLineage)retainPreparedSnapshotSurfaceMaterial(result,material,inputs,options);return result;
}
