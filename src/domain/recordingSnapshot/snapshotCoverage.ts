import {shapeOf,type Cubic,type DrawingDocument} from '../drawing/model';
import {interpolateSnapshotSimplexGeometry,type SnapshotScalarResponse,type SnapshotSimplexBasis,type SnapshotSimplexGeometry} from './simplexGeometry';
import {locateSnapshotSimplex,projectToSnapshotCoverage,restrictSnapshotCoverage,type SnapshotSimplexLocation,type SnapshotTriangulation,type SnapshotTriangulationAngle} from './triangulation';

export interface SnapshotCoverageCurvePreview {
 curveId:string;cubic:Cubic;requestedAngle:SnapshotTriangulationAngle;evaluatedAngle:SnapshotTriangulationAngle;
 snapshotIds:string[];readonly:true;outside:true;
}
export interface SnapshotCoverageEvaluation {
 requestedAngle:SnapshotTriangulationAngle;
 /** Only normal, editable geometry belongs here. Red previews never become
  * source nodes, snapshot members, interpolation samples or create-view input. */
 normal?:SnapshotSimplexGeometry&{simplex:SnapshotSimplexLocation};
 outsideCurves:SnapshotCoverageCurvePreview[];
 diagnostics:string[];
}
export type SnapshotLocationResponses=(location:SnapshotSimplexLocation)=>SnapshotScalarResponse|undefined;

/** Prepare static membership/topology support once for a set of immutable basis
 * outputs. Curves can have different valid regions. Their red fallback cubics
 * remain separate because two projected regions can assign a shared node two
 * different preview positions; neither is an authoritative geometry edit. */
export function prepareSnapshotCoverage(mesh:SnapshotTriangulation,bases:readonly SnapshotSimplexBasis[]):{
 evaluate:(requestedAngle:SnapshotTriangulationAngle,responses?:SnapshotLocationResponses)=>SnapshotCoverageEvaluation;
 curveIds:readonly string[];
} {
 const byId=new Map(bases.map(b=>[b.snapshotId,b]));
 if(byId.size!==bases.length||mesh.vertices.some(v=>!byId.has(v.snapshotId)))throw Error('Snapshot coverage needs one basis for every real mesh vertex.');
 const curveMaps=new Map(bases.map(b=>[b.snapshotId,new Map(b.drawing.curves.map(c=>[c.id,c]))]));
 const vertexSnapshot=new Map(mesh.vertices.map(v=>[v.id,v.snapshotId]));
 const curveIds=[...new Set(mesh.vertices.flatMap(v=>byId.get(v.snapshotId)!.drawing.curves.map(c=>c.id)))].sort();
 const regions=new Map<string,SnapshotTriangulation>();
 for(const curveId of curveIds){
  const support=mesh.vertices.filter(v=>curveMaps.get(v.snapshotId)!.has(curveId)).map(v=>v.snapshotId),region=restrictSnapshotCoverage(mesh,support);
  const compatible=(vertexIds:readonly string[])=>{const first=curveMaps.get(vertexSnapshot.get(vertexIds[0])!)!.get(curveId)!;return vertexIds.every(id=>{const curve=curveMaps.get(vertexSnapshot.get(id)!)!.get(curveId)!;return curve.nodes[0]===first.nodes[0]&&curve.nodes[1]===first.nodes[1];});};
  region.edges=region.edges.filter(edge=>compatible(edge.vertexIds));
  const edgeIds=new Set(region.edges.map(edge=>edge.id));
  region.triangles=region.triangles.filter(triangle=>compatible(triangle.vertexIds)&&triangle.edgeIds.every(id=>edgeIds.has(id)));
  regions.set(curveId,region);
 }
 const sample=(location:SnapshotSimplexLocation,responses:SnapshotLocationResponses|undefined)=>interpolateSnapshotSimplexGeometry(location.snapshotIds.map(id=>byId.get(id)!),location.geometricWeights,responses?.(location));
 return {curveIds,evaluate:(requestedAngle,responses)=>{
  const requested={...requestedAngle},location=locateSnapshotSimplex(mesh,requested),normal=location?{...sample(location,responses),simplex:location}:undefined;
  const normalIds=new Set(normal?.drawing.curves.map(curve=>curve.id)),outsideCurves:SnapshotCoverageCurvePreview[]=[],diagnostics=[...(normal?.diagnostics??[])],sampled=new Map<string,SnapshotSimplexGeometry>();
  for(const curveId of curveIds){
   if(normalIds.has(curveId))continue;
   const projected=projectToSnapshotCoverage(regions.get(curveId)!,requested);if(!projected)continue;
   const key=JSON.stringify([projected.simplex.simplexId,projected.simplex.snapshotIds,projected.simplex.geometricWeights]);
   let geometry=sampled.get(key);if(!geometry){geometry=sample(projected.simplex,responses);sampled.set(key,geometry);}
   if(!geometry.drawing.curves.some(curve=>curve.id===curveId)){diagnostics.push(`Curve ${curveId} has no compatible preview at its closest supported region.`);continue;}
   outsideCurves.push({curveId,cubic:shapeOf(geometry.drawing,curveId),requestedAngle:requested,evaluatedAngle:projected.evaluatedAngle,snapshotIds:[...projected.simplex.snapshotIds],readonly:true,outside:true});
  }
  if(!location)diagnostics.push('The requested angle is outside recording coverage. Red curves show their closest valid supported pose.');
  if(outsideCurves.length)diagnostics.push(`${outsideCurves.length} curve(s) are outside their own recording coverage; red previews are read-only and are not snapshot members.`);
  return {requestedAngle:requested,...(normal?{normal}:{}),outsideCurves,diagnostics:[...new Set(diagnostics)]};
 }};
}

/** Creating a real view captures only the normal editable pose. It must never
 * adopt the red fallback reference curves, even when the normal pose is empty. */
export function snapshotCoverageEditableDrawing(result:SnapshotCoverageEvaluation):DrawingDocument|undefined {return result.normal?.drawing;}
