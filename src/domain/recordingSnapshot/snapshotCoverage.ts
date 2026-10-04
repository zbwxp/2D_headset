import {preparedSnapshotSimplexProgram} from './preparedSimplexPrograms';
import {InputCache} from '../geometry/cache';
import {shapeOf,type Cubic,type DrawingDocument} from '../drawing/model';
import {reviseSnapshotSimplexGeometry,interpolateSnapshotSimplexGeometry,type SnapshotSimplexRevisionChanges,type SnapshotScalarResponse,type SnapshotSimplexBasis,type SnapshotSimplexGeometry} from './simplexGeometry';
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
export interface SnapshotCoverageSampleOptions {immutableInputs?:boolean;onGeometryPrepare?:()=>void;previous?:SnapshotCoverageEvaluation;changes?:SnapshotSimplexRevisionChanges}
const coverageLineages=new WeakMap<SnapshotCoverageEvaluation,{structure:object;samples:ReadonlyMap<string,SnapshotSimplexGeometry>}>();
export type SnapshotLocationResponses=(location:SnapshotSimplexLocation)=>SnapshotScalarResponse|undefined;

/** Prepare static membership/topology support once for a set of immutable basis
 * outputs. Curves can have different valid regions. Their red fallback cubics
 * remain separate because two projected regions can assign a shared node two
 * different preview positions; neither is an authoritative geometry edit. */
export interface PreparedSnapshotCoverageStructure {
 evaluate:(requestedAngle:SnapshotTriangulationAngle,basis:(snapshotId:string)=>SnapshotSimplexBasis,responses?:SnapshotLocationResponses,options?:SnapshotCoverageSampleOptions)=>SnapshotCoverageEvaluation;
 /** Includes red projected supports; expression/reflection leaves add to these. */
 locations:(requestedAngle:SnapshotTriangulationAngle)=>SnapshotSimplexLocation[];
 curveIds:readonly string[];
}
export function prepareSnapshotCoverageStructure(mesh:SnapshotTriangulation,bases:readonly SnapshotSimplexBasis[]):PreparedSnapshotCoverageStructure {
 const byId=new Map(bases.map(b=>[b.snapshotId,b]));
 if(byId.size!==bases.length||mesh.vertices.some(v=>!byId.has(v.snapshotId)))throw Error('Snapshot coverage needs one basis for every real mesh vertex.');
 const curveMaps=new Map(bases.map(b=>[b.snapshotId,new Map(b.drawing.curves.map(c=>[c.id,c]))])),nodeIds=new Map(bases.map(basis=>[basis.snapshotId,new Set(basis.drawing.nodes.map(node=>node.id))]));
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
 const requests=new InputCache<{location:SnapshotSimplexLocation|null|undefined;locations:SnapshotSimplexLocation[];projections:Map<string,NonNullable<ReturnType<typeof projectToSnapshotCoverage>>>}>(128);
 const request=(requested:SnapshotTriangulationAngle)=>{
  const key=JSON.stringify([requested.x,requested.y]),known=requests.get(key);if(known)return known;
  const location=locateSnapshotSimplex(mesh,requested),result=location?[location]:[],projections=new Map<string,NonNullable<ReturnType<typeof projectToSnapshotCoverage>>>();
  const present=(curveId:string)=>!!location&&location.snapshotIds.every(id=>curveMaps.get(id)!.has(curveId))&&location.snapshotIds.every(id=>{const a=curveMaps.get(id)!.get(curveId)!,b=curveMaps.get(location.snapshotIds[0])!.get(curveId)!;return a.nodes[0]===b.nodes[0]&&a.nodes[1]===b.nodes[1]&&a.nodes.every(node=>nodeIds.get(id)!.has(node));});
  const seen=new Set(result.map(value=>JSON.stringify([value.simplexId,value.vertexIds,value.geometricWeights])));
  for(const id of curveIds)if(!present(id)){const projected=projectToSnapshotCoverage(regions.get(id)!,requested);if(projected){projections.set(id,projected);const key=JSON.stringify([projected.simplex.simplexId,projected.simplex.vertexIds,projected.simplex.geometricWeights]);if(!seen.has(key)){seen.add(key);result.push(projected.simplex);}}}
  return requests.set(key,{location,locations:result,projections});
 };
 const locations=(requested:SnapshotTriangulationAngle)=>request(requested).locations,structureIdentity={};
 return {curveIds,locations,evaluate:(requestedAngle,basis,responses,options)=>{
  const previous=options?.previous&&coverageLineages.get(options.previous),retained=new Map<string,SnapshotSimplexGeometry>();
  const sample=(location:SnapshotSimplexLocation,responses:SnapshotLocationResponses|undefined)=>{
   const key=JSON.stringify([location.simplexId,location.snapshotIds,location.geometricWeights]),active=location.snapshotIds.map(basis),response=responses?.(location),prior=previous?.structure===structureIdentity?previous.samples.get(key):undefined;
   const revised=options?.immutableInputs&&options.changes&&prior?reviseSnapshotSimplexGeometry(prior,active,location.geometricWeights,response,options.changes):undefined;
   const result=revised??(options?.immutableInputs?preparedSnapshotSimplexProgram(active,options.onGeometryPrepare).sample(location.geometricWeights,response,{retainLineage:true}):interpolateSnapshotSimplexGeometry(active,location.geometricWeights,response));retained.set(key,result);return result;
  };
  const requested={...requestedAngle},planned=request(requested),location=planned.location,normal=location?{...sample(location,responses),simplex:location}:undefined;
  const normalIds=new Set(normal?.drawing.curves.map(curve=>curve.id)),outsideCurves:SnapshotCoverageCurvePreview[]=[],diagnostics=[...(normal?.diagnostics??[])],sampled=new Map<string,SnapshotSimplexGeometry>();
  for(const curveId of curveIds){
   if(normalIds.has(curveId))continue;
   const projected=planned.projections.get(curveId)??projectToSnapshotCoverage(regions.get(curveId)!,requested);if(!projected)continue;
   const key=JSON.stringify([projected.simplex.simplexId,projected.simplex.snapshotIds,projected.simplex.geometricWeights]);
   let geometry=sampled.get(key);if(!geometry){geometry=sample(projected.simplex,responses);sampled.set(key,geometry);}
   if(!geometry.drawing.curves.some(curve=>curve.id===curveId)){diagnostics.push(`Curve ${curveId} has no compatible preview at its closest supported region.`);continue;}
   outsideCurves.push({curveId,cubic:shapeOf(geometry.drawing,curveId),requestedAngle:requested,evaluatedAngle:projected.evaluatedAngle,snapshotIds:[...projected.simplex.snapshotIds],readonly:true,outside:true});
  }
  if(!location)diagnostics.push('The requested angle is outside recording coverage. Red curves show their closest valid supported pose.');
  if(outsideCurves.length)diagnostics.push(`${outsideCurves.length} curve(s) are outside their own recording coverage; red previews are read-only and are not snapshot members.`);
  const result={requestedAngle:requested,...(normal?{normal}:{}),outsideCurves,diagnostics:[...new Set(diagnostics)]};if(options?.immutableInputs)coverageLineages.set(result,{structure:structureIdentity,samples:retained});return result;
 }};
}

/** Creating a real view captures only the normal editable pose. It must never
 * adopt the red fallback reference curves, even when the normal pose is empty. */
export function snapshotCoverageEditableDrawing(result:SnapshotCoverageEvaluation):DrawingDocument|undefined {return result.normal?.drawing;}

/** Compatibility binding for callers that already own all basis products. */
export function prepareSnapshotCoverage(mesh:SnapshotTriangulation,bases:readonly SnapshotSimplexBasis[]):{evaluate:(requestedAngle:SnapshotTriangulationAngle,responses?:SnapshotLocationResponses)=>SnapshotCoverageEvaluation;curveIds:readonly string[]} {
 const structure=prepareSnapshotCoverageStructure(mesh,bases),byId=new Map(bases.map(basis=>[basis.snapshotId,basis]));
 return {curveIds:structure.curveIds,evaluate:(angle,responses)=>structure.evaluate(angle,id=>byId.get(id)!,responses)};
}
