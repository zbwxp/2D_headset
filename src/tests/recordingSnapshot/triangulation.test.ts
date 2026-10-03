import {describe,expect,it} from 'vitest';
import {
 createSnapshotTriangulation,insertSnapshotVertex,removeSnapshotVertex,rebindSnapshotVertex,restrictSnapshotCoverage,projectToSnapshotCoverage,locateSnapshotSimplex,snapshotOrientation,validateSnapshotTriangulation,
 type SnapshotTriangulation,type SnapshotTriangulationInput,
} from '../../domain/recordingSnapshot/triangulation';

const view=(snapshotId:string,x:number,y:number):SnapshotTriangulationInput=>({snapshotId,angle:{x,y}});
const square=()=>createSnapshotTriangulation([view('a',0,0),view('b',1,0),view('c',0,1),view('d',1,1)]);
const edgeNames=(mesh:SnapshotTriangulation)=>mesh.edges.map(edge=>edge.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId).sort().join('-')).sort();
const faceNames=(mesh:SnapshotTriangulation)=>mesh.triangles.map(face=>face.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId).sort().join('-')).sort();
function weightsBySnapshot(mesh:SnapshotTriangulation,x:number,y:number):Record<string,number> {
 const sample=locateSnapshotSimplex(mesh,{x,y})!;return Object.fromEntries(sample.snapshotIds.map((id,i)=>[id,sample.geometricWeights[i]]));
}

describe('stable saved-view triangulation',()=>{
 it('chooses deterministic grid diagonals independently of input order',()=>{
  const inputs=Array.from({length:9},(_,i)=>view(`v${i%3}${Math.floor(i/3)}`,i%3,Math.floor(i/3)));
  const mesh=createSnapshotTriangulation(inputs);
  expect(mesh.vertices).toHaveLength(9);expect(mesh.edges).toHaveLength(16);expect(mesh.triangles).toHaveLength(8);
  expect(createSnapshotTriangulation([...inputs].reverse())).toEqual(mesh);
  expect(createSnapshotTriangulation([inputs[4],inputs[7],inputs[1],inputs[8],inputs[0],inputs[6],inputs[2],inputs[5],inputs[3]])).toEqual(mesh);
  const expected:string[]=[];
  for(let x=0;x<2;x++)for(let y=0;y<2;y++){
   const a=`v${x}${y}`,b=`v${x+1}${y}`,c=`v${x}${y+1}`,d=`v${x+1}${y+1}`;
   expected.push([a,b,d].sort().join('-'),[a,c,d].sort().join('-'));
  }
  expect(faceNames(mesh)).toEqual(expected.sort());
 });

 it('splits one containing triangle without flipping an established diagonal',()=>{
  const mesh=square(),saved=JSON.stringify(mesh),location=locateSnapshotSimplex(mesh,{x:.75,y:.25})!;
  const unchanged=mesh.triangles.find(face=>face.id!==location.simplexId)!;
  const inserted=insertSnapshotVertex(mesh,view('new',.75,.25));
  expect(JSON.stringify(mesh)).toBe(saved);expect(inserted.vertices).toHaveLength(5);expect(inserted.triangles).toHaveLength(4);
  expect(inserted.triangles).toContainEqual(unchanged);expect(inserted.triangles.some(face=>face.id===location.simplexId)).toBe(false);
  for(const edge of mesh.edges)expect(inserted.edges).toContainEqual(edge);
  expect(edgeNames(inserted)).toContain('a-d');
  expect(locateSnapshotSimplex(inserted,{x:.75,y:.25})?.snapshotIds).toEqual(['new']);
 });

 it('splits both sides of an inserted shared-edge vertex and retires that edge',()=>{
  const mesh=square(),oldEdge=locateSnapshotSimplex(mesh,{x:.5,y:.5})!;
  expect(oldEdge.kind).toBe('edge');
  const inserted=insertSnapshotVertex(mesh,view('middle',.5,.5));
  expect(inserted.triangles).toHaveLength(4);expect(inserted.edges.some(edge=>edge.id===oldEdge.simplexId)).toBe(false);
  expect(inserted.triangles.some(face=>mesh.triangles.some(old=>old.id===face.id))).toBe(false);
  for(const edge of mesh.edges.filter(edge=>edge.id!==oldEdge.simplexId))expect(inserted.edges).toContainEqual(edge);
  expect(locateSnapshotSimplex(inserted,{x:.25,y:.25})?.snapshotIds).toEqual(['a','middle']);
  expect(locateSnapshotSimplex(inserted,{x:.75,y:.75})?.snapshotIds).toEqual(['d','middle']);
  expect(locateSnapshotSimplex(inserted,{x:.5,y:.5})?.kind).toBe('vertex');
 });

 it('splits a boundary edge and extends the hull while preserving unaffected IDs',()=>{
  const mesh=square(),boundary=locateSnapshotSimplex(mesh,{x:.5,y:0})!;
  const split=insertSnapshotVertex(mesh,view('bottom',.5,0));
  expect(split.triangles).toHaveLength(3);expect(split.edges.some(edge=>edge.id===boundary.simplexId)).toBe(false);
  const extended=insertSnapshotVertex(split,view('outside',2,.5));
  for(const triangle of split.triangles)expect(extended.triangles).toContainEqual(triangle);
  for(const edge of split.edges)expect(extended.edges).toContainEqual(edge);
  expect(locateSnapshotSimplex(extended,{x:1.5,y:.5})?.kind).toBe('triangle');
  expect(locateSnapshotSimplex(extended,{x:2.1,y:.5})).toBeNull();
 });

 it('persists JSON-safe IDs, including externally assigned edge/face IDs, through insertion',()=>{
  const mesh=JSON.parse(JSON.stringify(square())) as SnapshotTriangulation;
  const edgeIds=new Map(mesh.edges.map((edge,i)=>[edge.id,`saved-edge-${i}`]));
  mesh.edges.forEach(edge=>{edge.id=edgeIds.get(edge.id)!;});
  mesh.triangles.forEach((face,i)=>{face.id=`saved-face-${i}`;face.edgeIds=face.edgeIds.map(id=>edgeIds.get(id)!) as [string,string,string];});
  validateSnapshotTriangulation(mesh);
  const restored=JSON.parse(JSON.stringify(mesh)) as SnapshotTriangulation;
  expect(locateSnapshotSimplex(restored,{x:.5,y:.5})).toEqual(locateSnapshotSimplex(mesh,{x:.5,y:.5}));
  const added=insertSnapshotVertex(restored,view('extra',.75,.25));
  for(const vertex of restored.vertices)expect(added.vertices).toContainEqual(vertex);
  for(const edge of restored.edges)expect(added.edges).toContainEqual(edge);
  expect(added.triangles.some(face=>face.id.startsWith('saved-face-'))).toBe(true);
 });

 it('deletes incident triangles without bridging the hole or recreating missing extremes',()=>{
  const inputs=Array.from({length:9},(_,i)=>view(`v${i%3}${Math.floor(i/3)}`,i%3,Math.floor(i/3))),mesh=createSnapshotTriangulation(inputs);
  const removedId=mesh.vertices.find(vertex=>vertex.snapshotId==='v11')!.id;
  const survivingFaces=mesh.triangles.filter(face=>!face.vertexIds.includes(removedId)),saved=JSON.stringify(mesh);
  const removed=removeSnapshotVertex(mesh,'v11');
  expect(JSON.stringify(mesh)).toBe(saved);expect(removed.coverage).toBe('explicit');expect(removed.vertices).toHaveLength(8);
  expect(removed.triangles).toEqual(survivingFaces);expect(removed.triangles).toHaveLength(2);
  expect(removed.edges.every(edge=>removed.triangles.some(face=>face.edgeIds.includes(edge.id)))).toBe(true);
  expect(locateSnapshotSimplex(removed,{x:1,y:1})).toBeNull();expect(locateSnapshotSimplex(removed,{x:.9,y:1})).toBeNull();
  expect(locateSnapshotSimplex(removed,{x:0,y:0})?.snapshotIds).toEqual(['v00']);
  expect(()=>insertSnapshotVertex(removed,view('hole',1,1))).toThrow(/deleted hole/);
  expect(()=>insertSnapshotVertex(removed,view('outside',3,3))).toThrow(/explicit snapshot coverage/);
  const split=insertSnapshotVertex(removed,view('covered',.2,1.8));
  expect(split.triangles).toHaveLength(4);expect(locateSnapshotSimplex(split,{x:1,y:1})).toBeNull();
  const restored=JSON.parse(JSON.stringify(removed)) as SnapshotTriangulation;
  validateSnapshotTriangulation(restored);expect(locateSnapshotSimplex(restored,{x:1,y:1})).toBeNull();
 });

 it('keeps independent 1D edges while deletion leaves gaps rather than joining neighbors',()=>{
  const line=createSnapshotTriangulation([view('a',0,0),view('b',1,0),view('c',2,0),view('d',3,0)]);
  const removed=removeSnapshotVertex(line,'b');
  expect(edgeNames(removed)).toEqual(['c-d']);expect(locateSnapshotSimplex(removed,{x:1,y:0})).toBeNull();
  expect(locateSnapshotSimplex(removed,{x:2.5,y:0})?.kind).toBe('edge');expect(locateSnapshotSimplex(removed,{x:0,y:0})?.kind).toBe('vertex');
  const inserted=insertSnapshotVertex(removed,view('mid',2.5,0));expect(edgeNames(inserted)).toEqual(['c-mid','d-mid']);
  const empty=removeSnapshotVertex(createSnapshotTriangulation([view('only',0,0)]),'only');
  expect(empty.vertices).toHaveLength(0);expect(empty.edges).toHaveLength(0);expect(locateSnapshotSimplex(empty,{x:0,y:0})).toBeNull();
 });

 it('rebinds only the recorder angle while retaining vertex, edge, and face identities',()=>{
  const mesh=square(),saved=JSON.stringify(mesh),rebound=rebindSnapshotVertex(mesh,'b',{x:1.1,y:-.1});
  expect(JSON.stringify(mesh)).toBe(saved);expect(rebound.coverage).toBe('explicit');expect(rebound.edges).toEqual(mesh.edges);expect(rebound.triangles).toEqual(mesh.triangles);
  expect(rebound.vertices.map(v=>v.id)).toEqual(mesh.vertices.map(v=>v.id));
  expect(locateSnapshotSimplex(rebound,{x:1.1,y:-.1})).toMatchObject({kind:'vertex',snapshotIds:['b']});
  expect(locateSnapshotSimplex(rebound,{x:1,y:0})?.kind).not.toBe('vertex');
  expect(rebindSnapshotVertex(rebound,'b',{x:1.1,y:-.1})).toBe(rebound);
  expect(()=>rebindSnapshotVertex(mesh,'b',{x:0,y:0})).toThrow(/duplicate angle/);
  expect(()=>rebindSnapshotVertex(mesh,'b',{x:.5,y:.5})).toThrow(/nondegenerate/);
  expect(()=>rebindSnapshotVertex(mesh,'b',{x:-1,y:.5})).toThrow(/counterclockwise/);
  expect(()=>rebindSnapshotVertex(mesh,'missing',{x:0,y:0})).toThrow(/does not contain/);
  expect(()=>removeSnapshotVertex(mesh,'missing')).toThrow(/does not contain/);
 });

 it('projects outside coverage to a nearest edge interior with requested coordinates separate',()=>{
  const mesh=createSnapshotTriangulation([view('a',0,0),view('b',180,0),view('c',0,60),view('d',180,60)]),saved=JSON.stringify(mesh);
  const projected=projectToSnapshotCoverage(mesh,{x:90,y:61})!;
  expect(projected).toMatchObject({requestedAngle:{x:90,y:61},evaluatedAngle:{x:90,y:60},outside:true,simplex:{kind:'edge',snapshotIds:['c','d'],geometricWeights:[.5,.5]}});
  expect(locateSnapshotSimplex(mesh,{x:90,y:61})).toBeNull();expect(JSON.stringify(mesh)).toBe(saved);
  expect(projectToSnapshotCoverage(mesh,{x:90,y:30})).toMatchObject({requestedAngle:{x:90,y:30},evaluatedAngle:{x:90,y:30},outside:false});
  expect(projectToSnapshotCoverage(createSnapshotTriangulation([]),{x:90,y:61})).toBeNull();
 });

 it('projects into the surviving coverage boundary of a hole with deterministic distance ties',()=>{
  const mesh=createSnapshotTriangulation(Array.from({length:9},(_,i)=>view(`v${i%3}${Math.floor(i/3)}`,i%3,Math.floor(i/3))));
  const removed=removeSnapshotVertex(mesh,'v11'),projected=projectToSnapshotCoverage(removed,{x:1,y:1})!;
  expect(projected.outside).toBe(true);expect(projected.simplex.kind).toBe('edge');expect(projected.simplex.geometricWeights).toEqual([.5,.5]);
  expect(projected.evaluatedAngle).not.toEqual({x:1,y:1});expect(locateSnapshotSimplex(removed,{x:1,y:1})).toBeNull();
  const reversed={...removed,vertices:[...removed.vertices].reverse(),edges:[...removed.edges].reverse(),triangles:[...removed.triangles].reverse()};
  expect(projectToSnapshotCoverage(reversed,{x:1,y:1})).toEqual(projected);
 });

 it('restricts per-curve support to existing faces, standalone edges, and vertices without bridging',()=>{
  const mesh=square(),saved=JSON.stringify(mesh),supported=restrictSnapshotCoverage(mesh,new Set(['a','b','d']));
  validateSnapshotTriangulation(supported);expect(faceNames(supported)).toEqual(['a-b-d']);expect(edgeNames(supported)).toEqual(['a-b','a-d','b-d']);
  expect(locateSnapshotSimplex(supported,{x:.75,y:.25})?.kind).toBe('triangle');expect(locateSnapshotSimplex(supported,{x:.25,y:.75})).toBeNull();
  const edge=restrictSnapshotCoverage(mesh,['a','d']);validateSnapshotTriangulation(edge);
  expect(edge.triangles).toHaveLength(0);expect(edgeNames(edge)).toEqual(['a-d']);expect(projectToSnapshotCoverage(edge,{x:.25,y:.75})?.simplex.kind).toBe('edge');
  const unconnected=restrictSnapshotCoverage(mesh,['b','c']);validateSnapshotTriangulation(unconnected);
  expect(unconnected.edges).toHaveLength(0);expect(unconnected.vertices).toHaveLength(2);expect(locateSnapshotSimplex(unconnected,{x:.5,y:.5})).toBeNull();
  expect(JSON.stringify(mesh)).toBe(saved);
 });

 it('keeps a single-curve saved-view singleton as its sole normal point and preview fallback',()=>{
  const mesh=createSnapshotTriangulation([view('front',0,0),view('only-curve',60,0),view('side',90,0)]),single=restrictSnapshotCoverage(mesh,['only-curve']);
  expect(single.vertices).toHaveLength(1);expect(single.edges).toHaveLength(0);expect(single.triangles).toHaveLength(0);
  expect(projectToSnapshotCoverage(single,{x:60,y:0})).toMatchObject({outside:false,simplex:{kind:'vertex',snapshotIds:['only-curve']}});
  expect(projectToSnapshotCoverage(single,{x:61,y:5})).toMatchObject({requestedAngle:{x:61,y:5},evaluatedAngle:{x:60,y:0},outside:true,simplex:{kind:'vertex',snapshotIds:['only-curve']}});
 });

 it('uses one canonical edge identity and parameterization from adjacent triangles',()=>{
  const mesh=square(),edge=locateSnapshotSimplex(mesh,{x:.25,y:.25})!,shared=mesh.edges.find(candidate=>candidate.id===edge.simplexId)!;
  expect(edge).toMatchObject({kind:'edge',snapshotIds:['a','d'],geometricWeights:[.75,.25]});
  expect(mesh.triangles.filter(face=>face.edgeIds.includes(shared.id))).toHaveLength(2);
  const above=weightsBySnapshot(mesh,.25,.25+2**-30),below=weightsBySnapshot(mesh,.25+2**-30,.25);
  expect(above.a).toBeCloseTo(edge.geometricWeights[0],8);expect(below.a).toBeCloseTo(edge.geometricWeights[0],8);
  expect(above.d).toBeCloseTo(edge.geometricWeights[1],8);expect(below.d).toBeCloseTo(edge.geometricWeights[1],8);
  expect(above.c).toBeGreaterThan(0);expect(below.b).toBeGreaterThan(0);
 });

 it('keeps strict vertex, edge, and tiny positive triangle-interior membership',()=>{
  const mesh=createSnapshotTriangulation([view('a',0,0),view('b',1,0),view('c',0,1)]);
  expect(locateSnapshotSimplex(mesh,{x:0,y:0})).toMatchObject({kind:'vertex',snapshotIds:['a'],geometricWeights:[1]});
  expect(locateSnapshotSimplex(mesh,{x:.25,y:0})).toMatchObject({kind:'edge',snapshotIds:['a','b'],geometricWeights:[.75,.25]});
  const interior=locateSnapshotSimplex(mesh,{x:.25,y:Number.MIN_VALUE})!;
  expect(interior.kind).toBe('triangle');expect(interior.snapshotIds).toHaveLength(3);expect(interior.geometricWeights.every(weight=>weight>0)).toBe(true);
  expect(locateSnapshotSimplex(mesh,{x:.25,y:-Number.MIN_VALUE})).toBeNull();
  const nearVertex=locateSnapshotSimplex(mesh,{x:Number.MIN_VALUE,y:0})!;
  expect(nearVertex.kind).toBe('edge');expect(nearVertex.snapshotIds).toEqual(['a','b']);expect(nearVertex.geometricWeights[1]).toBe(Number.MIN_VALUE);
 });

 it('does not invent nearest-view, singleton, line, or outside-hull support',()=>{
  const single=createSnapshotTriangulation([view('only',2,3)]);
  expect(locateSnapshotSimplex(single,{x:2,y:3})?.kind).toBe('vertex');expect(locateSnapshotSimplex(single,{x:2+Number.EPSILON*2,y:3})).toBeNull();
  let line=createSnapshotTriangulation([view('a',0,0),view('c',2,2),view('b',1,1)]);
  expect(line.triangles).toHaveLength(0);expect(edgeNames(line)).toEqual(['a-b','b-c']);
  expect(locateSnapshotSimplex(line,{x:.5,y:.5})).toMatchObject({kind:'edge',snapshotIds:['a','b'],geometricWeights:[.5,.5]});
  expect(locateSnapshotSimplex(line,{x:.5,y:.5+Number.EPSILON})).toBeNull();expect(locateSnapshotSimplex(line,{x:3,y:3})).toBeNull();
  line=insertSnapshotVertex(line,view('mid',.5,.5));expect(edgeNames(line)).toEqual(['a-mid','b-c','b-mid']);
  const mesh=insertSnapshotVertex(line,view('off-line',2,0));expect(mesh.triangles).toHaveLength(3);expect(locateSnapshotSimplex(mesh,{x:1,y:.5})?.kind).toBe('triangle');
  expect(createSnapshotTriangulation([])).toEqual({version:1,vertices:[],edges:[],triangles:[]});
  expect(locateSnapshotSimplex(createSnapshotTriangulation([]),{x:0,y:0})).toBeNull();
 });

 it('uses exact IEEE predicates when float determinants underflow or overflow',()=>{
  const tiny=Number.MIN_VALUE;
  expect(snapshotOrientation({x:0,y:0},{x:tiny,y:0},{x:0,y:tiny})).toBe(1);
  const miniature=createSnapshotTriangulation([view('a',0,0),view('b',tiny*4,0),view('c',0,tiny*4)]);
  expect(weightsBySnapshot(miniature,tiny,tiny)).toEqual({a:.5,b:.25,c:.25});
  const large=createSnapshotTriangulation([view('a',-1e308,-1e308),view('b',1e308,-1e308),view('c',-1e308,1e308),view('d',1e308,1e308)]);
  expect(locateSnapshotSimplex(large,{x:0,y:0})).toMatchObject({kind:'edge',snapshotIds:['a','d'],geometricWeights:[.5,.5]});
  const thin=createSnapshotTriangulation([view('a',0,0),view('b',1,0),view('c',0,1e308)]);
  const interior=locateSnapshotSimplex(thin,{x:.25,y:tiny})!;
  expect(interior.kind).toBe('triangle');expect(interior.geometricWeights.every(weight=>weight>0)).toBe(true);
 });

 it('rejects nonfinite values and exact duplicate coordinates, not close valid views',()=>{
  for(const invalid of [NaN,Infinity,-Infinity]){
   expect(()=>createSnapshotTriangulation([view('bad',invalid,0)])).toThrow(/finite/);
   expect(()=>locateSnapshotSimplex(square(),{x:0,y:invalid})).toThrow(/finite/);
  }
  expect(()=>createSnapshotTriangulation([view('a',0,0),view('b',-0,0)])).toThrow(/duplicate angle/);
  expect(()=>insertSnapshotVertex(square(),view('another',1,1))).toThrow(/duplicate angle/);
  expect(()=>insertSnapshotVertex(square(),view('a',2,2))).toThrow(/distinct vertex and snapshot/);
  expect(createSnapshotTriangulation([view('a',0,0),view('b',Number.MIN_VALUE,0)]).vertices).toHaveLength(2);
  expect(()=>createSnapshotTriangulation([view('',0,0)])).toThrow(/nonempty/);
 });

 it('rejects persisted meshes with missing shared edges, unindexed points, and reversed faces',()=>{
  const missing=square();missing.edges.pop();expect(()=>validateSnapshotTriangulation(missing)).toThrow(/shared edges/);
  const reversed=square();const face=reversed.triangles[0];[face.vertexIds[1],face.vertexIds[2]]=[face.vertexIds[2],face.vertexIds[1]];
  expect(()=>validateSnapshotTriangulation(reversed)).toThrow(/counterclockwise/);
  const dangling=square();dangling.vertices.push({id:'dangling',snapshotId:'dangling',angle:{x:.1,y:.2}});
  expect(()=>validateSnapshotTriangulation(dangling)).toThrow(/complete convex hull/);
 });
});
