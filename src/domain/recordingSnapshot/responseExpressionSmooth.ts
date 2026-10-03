import {sub,type Endpoint,type Point2} from '../drawing/model';
import type {SnapshotAngleGraph} from './model';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import type {SnapshotSimplexLocation} from './triangulation';
import {createSnapshotResponseExpressionCapture,certifySnapshotSmoothResponseIdentity} from './responseExpressionSplit';

export interface SnapshotSmoothResponseDependency {id:string;a:Endpoint;b:Endpoint}
/** Prove that persisted SMOOTH projections are identities over whole scalar
 * fields. This checks live real vectors and symbolic field coefficients; no
 * sampled-angle approximation or hidden projected geometry is introduced. */
export function unprovenSnapshotSmoothResponses(graph:SnapshotAngleGraph,bases:readonly SnapshotSimplexBasis[],relations:readonly SnapshotSmoothResponseDependency[],scope:string,locations?:readonly SnapshotSimplexLocation[]):string[] {
 const vertexSnapshot=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.snapshotId])),byId=new Map(bases.map(basis=>[basis.snapshotId,basis]));
 const cells=locations??[...graph.mesh.edges,...graph.mesh.triangles].map(simplex=>({kind:simplex.vertexIds.length===2?'edge' as const:'triangle' as const,simplexId:simplex.id,vertexIds:[...simplex.vertexIds],snapshotIds:simplex.vertexIds.map(id=>vertexSnapshot.get(id)!),geometricWeights:simplex.vertexIds.map(()=>1/simplex.vertexIds.length)}));
 const capture=createSnapshotResponseExpressionCapture(graph.mesh,graph,scope),result:string[]=[];
 for(const relation of relations){
  const available=(basis:SnapshotSimplexBasis)=>[relation.a,relation.b].every(end=>basis.drawing.curves.some(curve=>curve.id===end.curveId));
  const active=cells.filter(location=>location.snapshotIds.every(id=>byId.has(id)&&available(byId.get(id)!))),ids=new Set(active.flatMap(location=>location.snapshotIds));
  const vector=(basis:SnapshotSimplexBasis,end:Endpoint)=>{const curve=basis.drawing.curves.find(curve=>curve.id===end.curveId)!;return sub(curve.handles[end.end],basis.drawing.nodes.find(node=>node.id===curve.nodes[end.end])!.position);};
  const subtractionScale=(basis:SnapshotSimplexBasis,end:Endpoint):Point2=>{const curve=basis.drawing.curves.find(curve=>curve.id===end.curveId)!,node=basis.drawing.nodes.find(node=>node.id===curve.nodes[end.end])!.position;return [Math.abs(curve.handles[end.end][0])+Math.abs(node[0]),Math.abs(curve.handles[end.end][1])+Math.abs(node[1])];};
  const values=bases.filter(basis=>ids.has(basis.snapshotId)).map(basis=>({a:vector(basis,relation.a),b:vector(basis,relation.b),aSubtractionScale:subtractionScale(basis,relation.a),bSubtractionScale:subtractionScale(basis,relation.b)})),expressions=active.map(location=>({a:{x:capture(location,{kind:'handle',...relation.a},0),y:capture(location,{kind:'handle',...relation.a},1)},b:{x:capture(location,{kind:'handle',...relation.b},0),y:capture(location,{kind:'handle',...relation.b},1)}}));
  if(!active.length)continue;
  const proof=certifySnapshotSmoothResponseIdentity(values,expressions);if(!proof.available)result.push(`${relation.id}: ${proof.reason}`);
 }
 return result;
}
