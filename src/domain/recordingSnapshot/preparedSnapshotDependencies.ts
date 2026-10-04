import type {RecordingSnapshotWorkspace,RecordingSnapshot,SnapshotRecording,SnapshotAngleGraph,Angle} from './model';
import {recordingViewMirrorRelation} from './viewMirrorRelation';
import {snapshotMaterialRecipeDependencies} from './materialRestriction';
import {snapshotVisibilityRecipeDependencies} from './visibilityRestriction';
import {snapshotResponseExpressionBasisReferences,snapshotResponseExpressionFitParameters} from './responseExpressions';
import {effectiveSnapshotSurfaceResponses} from './surfaceTargets';
import {locateSnapshotSimplex,type SnapshotSimplexLocation} from './triangulation';

/** Addresses only. Numeric resolution and its saved/live policy belong to the
 * prepared session. Keep the same dependency enumerators as recipe execution. */
export interface PreparedSnapshotDependencyIndex {
 snapshots:ReadonlyMap<string,RecordingSnapshot>;
 recordings:ReadonlyMap<string,SnapshotRecording>;
 recordingForSnapshot:ReadonlyMap<string,SnapshotRecording>;
 dependencies:ReadonlyMap<string,ReadonlySet<string>>;
 dependents:ReadonlyMap<string,ReadonlySet<string>>;
}
export function indexPreparedSnapshotDependencies(workspace:RecordingSnapshotWorkspace):PreparedSnapshotDependencyIndex {
 const snapshots=new Map(workspace.snapshots.map(snapshot=>[snapshot.id,snapshot])),recordings=new Map(workspace.recordings.map(recording=>[recording.id,recording])),owners=new Map<string,SnapshotRecording>();
 for(const recording of workspace.recordings)for(const id of recording.snapshotIds)if(!owners.has(id))owners.set(id,recording);
 const dependencies=new Map<string,Set<string>>(),dependents=new Map<string,Set<string>>();
 for(const snapshot of snapshots.values()){
  const ids=new Set(snapshot.layers.flatMap(layer=>layer.kind==='reference'?[layer.baseSnapshotId]:[]));
  for(const id of Object.values(snapshot.memberSources??{}))ids.add(id);
  // Sole ancestry is structural even when its layers are presently excluded.
  if(snapshot.parentSnapshotId)ids.add(snapshot.parentSnapshotId);
  const recording=owners.get(snapshot.id),graph=recording?.angleGraph,mirror=recording&&recordingViewMirrorRelation(workspace,recording),material=graph?.materialBasisRecipes?.[snapshot.id],visibility=graph?.visibilityBasisRecipes?.[snapshot.id];
  if(material)for(const id of snapshotMaterialRecipeDependencies(material,graph!.mesh,graph,snapshot.angle))ids.add(id);
  if(visibility)for(const id of snapshotVisibilityRecipeDependencies(visibility))ids.add(id);
  if(mirror?.targetSnapshotId===snapshot.id){ids.add(mirror.sourceSnapshotId);ids.add(mirror.zeroSnapshotId);}
  dependencies.set(snapshot.id,ids);for(const id of ids){let values=dependents.get(id);if(!values){values=new Set();dependents.set(id,values);}values.add(snapshot.id);}
 }
 return {snapshots,recordings,recordingForSnapshot:owners,dependencies,dependents};
}

/** Active controls include expression basis leaves and fitted parameter domains.
 * Reflections additionally consume the reflected point and every support corner. */
export function snapshotSurfaceDemand(graph:SnapshotAngleGraph,locations:readonly SnapshotSimplexLocation[],mirrorZeroId?:string,includeMaterial=true):Set<string> {
 const result=new Set<string>(),effective=effectiveSnapshotSurfaceResponses(graph),visited=new Set<string>(),vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.angle]));
 const visit=(location:SnapshotSimplexLocation,reflect:boolean)=>{
  const key=JSON.stringify([location.simplexId,location.vertexIds,location.geometricWeights,reflect]);if(visited.has(key))return;visited.add(key);
  for(const id of location.snapshotIds)result.add(id);
  const responses=effective.responseExpressions[location.simplexId];
  if(responses)for(const control of [...Object.values(responses.nodes),...Object.values(responses.handles).flat()])for(const expression of Object.values(control))for(const reference of [...snapshotResponseExpressionBasisReferences(expression),...snapshotResponseExpressionFitParameters(expression)])result.add(reference.snapshotId);
  if(includeMaterial){const material=graph.materialRecipes?.[location.simplexId],visibility=graph.visibilityRecipes?.[location.simplexId];
   const at=location.vertexIds.reduce((sum,id,index)=>({x:sum.x+vertices.get(id)!.x*location.geometricWeights[index],y:sum.y+vertices.get(id)!.y*location.geometricWeights[index]}),{x:0,y:0});
   if(material)for(const id of snapshotMaterialRecipeDependencies(material,graph.mesh,graph,at))result.add(id);
   if(visibility)for(const id of snapshotVisibilityRecipeDependencies(visibility))result.add(id);
  }
  if(!reflect||!mirrorZeroId)return;
  const corners=location.vertexIds.map(id=>vertices.get(id)!),at=corners.reduce((sum,point,index)=>({x:sum.x+point.x*location.geometricWeights[index],y:sum.y+point.y*location.geometricWeights[index]}),{x:0,y:0});
  if(at.x<=0)return;result.add(mirrorZeroId);
  for(const point of [at,...corners]){const reflected=locateSnapshotSimplex(graph.mesh,{x:-point.x,y:point.y});if(reflected)visit(reflected,false);}
 };
 for(const location of locations)visit(location,true);return result;
}
