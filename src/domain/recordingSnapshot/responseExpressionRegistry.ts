import type {SnapshotResponseExpressionRegistry,SnapshotExpressionResponses} from './model';
import type {SnapshotScalarTarget,SnapshotSimplexBasis} from './simplexGeometry';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {SnapshotResponseExpressionError,validateSnapshotResponseExpression,snapshotResponseExpressionTerms,type SnapshotResponseBasisReference,type SnapshotResponseExpression,type SnapshotResponseExpressionField} from './responseExpressions';

const own=<T>(record:Record<string,T>|undefined,id:string):T|undefined=>record&&Object.hasOwn(record,id)?record[id]:undefined;
export const snapshotResponseExpressionFor=(responses:SnapshotExpressionResponses|undefined,target:SnapshotScalarTarget,axis:0|1):SnapshotResponseExpression|undefined=>(target.kind==='node'?own(responses?.nodes,target.nodeId):own(responses?.handles,target.curveId)?.[target.end])?.[axis===0?'x':'y'];
const invalid=(message:string):never=>{throw new SnapshotResponseExpressionError('EXPRESSION_INVALID',message);};
function object(value:unknown,allowed?:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid('Expression registry must contain plain data objects.');
 const data=value as Record<string,unknown>,keys=Reflect.ownKeys(value);
 if(keys.length>16384||keys.some(key=>typeof key!=='string'||!('value' in Object.getOwnPropertyDescriptor(value,key)!)||allowed&&!allowed.includes(key)))invalid('Expression registry contains invalid or unknown fields.');
 return data;
}
/** Expressions may retain a removed triangle's field, but each of that field's
 * real vertices and every live basis snapshot must still exist in this mesh. */
export function validateSnapshotResponseExpressionRegistry(value:unknown,mesh:SnapshotTriangulation):asserts value is SnapshotResponseExpressionRegistry {
 const vertices=new Set(mesh.vertices.map(vertex=>vertex.id)),snapshots=new Set(mesh.vertices.map(vertex=>vertex.snapshotId)),simplexes=new Set([...mesh.edges,...mesh.triangles].map(simplex=>simplex.id)),contracts=new Map<string,string>();
 const control=(raw:unknown)=>{const data=object(raw,['x','y']);for(const axis of ['x','y'])if(data[axis]!==undefined){validateSnapshotResponseExpression(data[axis]);const expression=data[axis] as SnapshotResponseExpression;
  for(const contract of expression.smoothContracts??[]){const serialized=JSON.stringify(contract),prior=contracts.get(contract.id);if(prior&&prior!==serialized)invalid('The expression registry contains inconsistent original SMOOTH contracts.');contracts.set(contract.id,serialized);}
  if(expression.fields.some(field=>field.vertexIds.some(id=>!vertices.has(id))))invalid('Expression field references a missing real mesh vertex; archive it before deleting its source.');
  if(snapshotResponseExpressionTerms(expression).some(term=>term.basis.some(value=>!snapshots.has(value.basis.snapshotId))))invalid('Expression references a missing real basis snapshot; archive it before deleting its source.');
 }};
 for(const [simplexId,raw] of Object.entries(object(value))){
  if(!simplexes.has(simplexId))invalid('Expression registry references a missing active simplex; archive it with its original frame.');
  const responses=object(raw,['nodes','handles']);if(!Object.hasOwn(responses,'nodes')||!Object.hasOwn(responses,'handles'))invalid('Expression registry needs node and handle maps.');
  for(const [id,raw] of Object.entries(object(responses.nodes))){if(!id||id.length>16384)invalid('Invalid expression target ID.');control(raw);}
  for(const [id,raw] of Object.entries(object(responses.handles))){if(!id||id.length>16384||!Array.isArray(raw)||raw.length!==2)invalid('Invalid expression handle pair.');const pair=raw as unknown[];control(pair[0]);control(pair[1]);}
 }
}

/** Resolve only already evaluated real controls, with relative H-P for handles.
 * This closure is reused by every control and ghost in a prepared frame. */
export function createSnapshotResponseBasisResolver(bases:readonly SnapshotSimplexBasis[]):(basis:SnapshotResponseBasisReference)=>number|undefined {
 const index=new Map(bases.map(basis=>[basis.snapshotId,{nodes:new Map(basis.drawing.nodes.map(node=>[node.id,node.position])),curves:new Map(basis.drawing.curves.map(curve=>[curve.id,curve]))}]));
 return basis=>{const source=index.get(basis.snapshotId);if(!source)return undefined;
  if(basis.target.kind==='node')return source.nodes.get(basis.target.nodeId)?.[basis.axis];
  const curve=source.curves.get(basis.target.curveId),node=curve&&source.nodes.get(curve.nodes[basis.target.end]);
  return curve&&node?curve.handles[basis.target.end][basis.axis]-node[basis.axis]:undefined;
 };
}

/** Map current ORIGINAL geometric barycentrics into each retained field frame.
 * Mapping matrices are prepared once; no mesh search or graph evaluation occurs
 * per control, and removed old triangles need no resurrected geometry. */
export function createSnapshotResponseFieldWeightMapper(mesh:SnapshotTriangulation,location:Pick<SnapshotSimplexLocation,'vertexIds'>):(field:SnapshotResponseExpressionField,weights:readonly number[])=>readonly number[] {
 const vertices=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex.angle])),current=location.vertexIds.map(id=>vertices.get(id));
 if(current.some(point=>!point))throw new SnapshotResponseExpressionError('EXPRESSION_MISSING_SUPPORT','The active simplex references a missing real vertex.');
 const cache=new WeakMap<SnapshotResponseExpressionField,number[][]>();
 return (field,weights)=>{
  let matrix=cache.get(field);if(!matrix){const points=field.vertexIds.map(id=>vertices.get(id));if(points.some(point=>!point))throw new SnapshotResponseExpressionError('EXPRESSION_MISSING_SUPPORT',`Field ${field.id} references a missing real vertex.`);
   const [a,b,c]=points as {x:number;y:number}[];
   matrix=current.map((point,index)=>{const same=field.vertexIds.indexOf(location.vertexIds[index]);if(same>=0)return field.vertexIds.map((_,coordinate)=>coordinate===same?1:0);const p=point!;if(points.length===2){const x=b.x-a.x,y=b.y-a.y,denominator=x*x+y*y;if(!denominator)invalid('A retained edge field has degenerate angle support.');const t=((p.x-a.x)*x+(p.y-a.y)*y)/denominator;return [1-t,t];}
    const denominator=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(!denominator)invalid('A retained triangle field has degenerate angle support.');
    const u=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/denominator,v=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/denominator;return [u,v,1-u-v];
   });cache.set(field,matrix);
  }
  const mapped=field.vertexIds.map((_,coordinate)=>weights.reduce((sum,weight,index)=>sum+weight*matrix![index][coordinate],0));
  const sum=mapped.reduce((a,b)=>a+b,0);if(Math.abs(sum-1)<128*Number.EPSILON){const index=mapped.reduce((best,value,i)=>value>mapped[best]?i:best,0);mapped[index]+=1-sum;}
  return mapped;
 };
}

export function snapshotResponseExpressionRegistryValidForMesh(responses:SnapshotExpressionResponses,mesh:SnapshotTriangulation):boolean {
 const vertices=new Set(mesh.vertices.map(vertex=>vertex.id)),snapshots=new Set(mesh.vertices.map(vertex=>vertex.snapshotId));
 return [...Object.values(responses.nodes),...Object.values(responses.handles).flat()].every(control=>(Object.values(control) as SnapshotResponseExpression[]).every(expression=>expression.fields.every(field=>field.vertexIds.every(id=>vertices.has(id)))&&snapshotResponseExpressionTerms(expression).every(term=>term.basis.every(value=>snapshots.has(value.basis.snapshotId)))));
}
