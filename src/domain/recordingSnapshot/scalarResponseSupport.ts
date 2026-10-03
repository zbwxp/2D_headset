import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {prepareTriangularResponse,type BarycentricWeights,type InteriorResponseSample,type OrientedEdgeResponse,type PreparedTriangularResponse,type ScalarResponseKnot,type TriangleVertexIndex} from './triangularResponses';

/** One orientation/support authority for both geometric controls and typed
 * attributes. Consumers decide which scalar field to read, never how a shared
 * edge or persisted triangle is oriented. */
export function describeSnapshotScalarResponseSupport(mesh:SnapshotTriangulation,location:SnapshotSimplexLocation,invalid:(message:string)=>never=message=>{throw Error(message);}) {
 const count=location.kind==='vertex'?1:location.kind==='edge'?2:location.kind==='triangle'?3:0;
 if(!count||location.vertexIds.length!==count||location.snapshotIds.length!==count||location.geometricWeights.length!==count||new Set(location.vertexIds).size!==count||new Set(location.snapshotIds).size!==count||location.geometricWeights.some(w=>!Number.isFinite(w)||w<=0)||Math.abs(location.geometricWeights.reduce((sum,w)=>sum+w,0)-1)>64*Number.EPSILON)invalid('A response surface needs the original positive geometric support of its active simplex.');
 const vertices=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex]));
 if(location.vertexIds.some((id,index)=>vertices.get(id)?.snapshotId!==location.snapshotIds[index]))invalid('The active simplex references different saved snapshot bases.');
 const simplex=location.kind==='edge'?mesh.edges.find(edge=>edge.id===location.simplexId):location.kind==='triangle'?mesh.triangles.find(triangle=>triangle.id===location.simplexId):undefined;
 const ownerIds=location.kind==='vertex'?[location.simplexId]:simplex?.vertexIds;
 if(!ownerIds||ownerIds.length!==count||ownerIds.some(id=>!location.vertexIds.includes(id)))invalid('The active simplex is no longer present in this recorder. Re-evaluate its angle before editing.');
 const ownerToLocation=ownerIds.map(id=>location.vertexIds.indexOf(id)),locationToOwner=location.vertexIds.map(id=>ownerIds.indexOf(id));
 const triangle=location.kind==='triangle'?mesh.triangles.find(face=>face.id===location.simplexId)!:undefined;
 const edgeMap=new Map(mesh.edges.map(edge=>[edge.id,edge]));
 const edges=location.kind==='edge'?[{id:location.simplexId,from:0 as TriangleVertexIndex,to:1 as TriangleVertexIndex}]:triangle?triangle.edgeIds.map(id=>{
  const edge=edgeMap.get(id);if(!edge)invalid(`Triangle ${triangle.id} is missing shared edge ${id}.`);
  const from=ownerIds.indexOf(edge.vertexIds[0]),to=ownerIds.indexOf(edge.vertexIds[1]);
  if(from<0||to<0)invalid(`Triangle ${triangle.id} has an incompatible shared edge ${id}.`);
  return {id,from:from as TriangleVertexIndex,to:to as TriangleVertexIndex};
 }):[];
 return {count,kind:location.kind,simplexId:location.simplexId,ownerToLocation,locationToOwner,edges};
}
export type SnapshotScalarResponseSupport=ReturnType<typeof describeSnapshotScalarResponseSupport>;

/** Scalar-only field adapter. Inputs and outputs use the caller's location
 * order; prepared fields use persisted order and compile once per target key. */
export function createSnapshotScalarResponseWeightSampler<T>(support:SnapshotScalarResponseSupport,source:{
 key:(target:T)=>string;
 edgeKnots:(edgeId:string,target:T)=>readonly ScalarResponseKnot[]|undefined;
 triangleSamples:(triangleId:string,target:T)=>readonly InteriorResponseSample[]|undefined;
}):(target:T,geometricWeights:readonly number[])=>readonly number[] {
 const compiled=new Map<string,PreparedTriangularResponse|null>();
 return (target,geometricWeights)=>{
  if(support.kind==='vertex')return geometricWeights;
  const key=source.key(target);let field=compiled.get(key);
  if(field===undefined){
   const edges:OrientedEdgeResponse[]=support.edges.flatMap(edge=>{
    const knots=source.edgeKnots(edge.id,target);return knots?.length?[{from:edge.from,to:edge.to,knots}]:[];
   });
   const samples=support.kind==='triangle'?source.triangleSamples(support.simplexId,target):undefined;
   field=edges.length||samples?.length?prepareTriangularResponse(edges,samples):null;compiled.set(key,field);
  }
  if(!field)return geometricWeights;
  const original=support.ownerToLocation.map(index=>geometricWeights[index]);if(support.kind==='edge')original.push(0);
  const weights=field(original as unknown as BarycentricWeights);
  return support.locationToOwner.map(index=>weights[index]);
 };
}
