import {describe,it,expect} from 'vitest';
import {emptyDrawing,add,sub,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {moveNode,transform} from '../../domain/drawing/commands';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotTriangulation,locateSnapshotSimplex,projectToSnapshotCoverage,type SnapshotSimplexLocation} from '../../domain/recordingSnapshot/triangulation';
import {interpolateSnapshotSimplexGeometry} from '../../domain/recordingSnapshot/simplexGeometry';
import {solveClosestBarycentricWeights,type BarycentricWeights} from '../../domain/recordingSnapshot/triangularResponses';
import {createSnapshotSurfaceResponseSampler,effectiveSnapshotSurfaceResponses,prepareSnapshotSurfaceTargetEdit,SnapshotSurfaceTargetEditError} from '../../domain/recordingSnapshot/surfaceTargets';

const angle={x:2,y:3};
function drawing(index:number,linked=false):DrawingDocument {
 const a:Point2=([[0,1],[4,2],[1,6]] as Point2[])[index],b:Point2=([[2,3],[6,5],[4,7]] as Point2[])[index],v:Point2=([[.5,.25],[1,1],[-.5,1.5]] as Point2[])[index];
 const d={...emptyDrawing(),nodes:[{id:'a',position:a},{id:'b',position:b}],curves:[{id:'c',name:'Curve',nodes:['a','b'] as [string,string],handles:[add(a,v),sub(b,v)] as [Point2,Point2],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}],groups:[{id:'group',name:'Group',curveIds:['c'],visible:true,locked:false}]};
 if(linked){
  const end=add(b,[2+index,1+index]);d.nodes.push({id:'linked',position:[...b]},{id:'d',position:end});
  d.curves.push({...d.curves[0],id:'other',nodes:['linked','d'],handles:[add(b,[2*v[0],2*v[1]]),sub(end,v)]});d.layers[0].items.push('other');d.groups[0].curveIds.push('other');
  d.endpointLinks=[{id:'link',a:{curveId:'c',end:1},b:{curveId:'other',end:0},joinBrush:{kind:'SMOOTH'}}];
 }
 return d;
}
function fixture(linked=false){
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:10,y:0}},{snapshotId:'C',angle:{x:0,y:10}}]);
 const graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}},allBases=['A','B','C'].map((snapshotId,index)=>({snapshotId,drawing:drawing(index,linked)}));
 const location=locateSnapshotSimplex(mesh,angle)!;
 const bases=location.snapshotIds.map(id=>allBases.find(basis=>basis.snapshotId===id)!);
 const sample=(g=graph,l=location,source=allBases)=>interpolateSnapshotSimplexGeometry(l.snapshotIds.map(id=>source.find(basis=>basis.snapshotId===id)!),l.geometricWeights,createSnapshotSurfaceResponseSampler(g,l)).drawing;
 return {graph,location,bases,allBases,sample,current:sample()};
}
function expectControls(actual:DrawingDocument,wanted:DrawingDocument){
 for(const node of wanted.nodes){const found=actual.nodes.find(value=>value.id===node.id)!;for(const axis of [0,1] as const)expect(found.position[axis]).toBeCloseTo(node.position[axis],10);}
 for(const curve of wanted.curves){const found=actual.curves.find(value=>value.id===curve.id)!;for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(found.handles[end][axis]).toBeCloseTo(curve.handles[end][axis],10);}
}
function edit(f:ReturnType<typeof fixture>,target:DrawingDocument,graph=f.graph,current=f.current,location=f.location,at=angle){return prepareSnapshotSurfaceTargetEdit(graph,location,f.bases,current,target,{angle:at,frameId:'draft'});}
function capturedError(run:()=>unknown){try{run();throw Error('Expected edit to fail');}catch(error){expect(error).toBeInstanceOf(SnapshotSurfaceTargetEditError);return error as SnapshotSurfaceTargetEditError;}}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}

describe('snapshot surface target transactions',()=>{
 it.each([
  ['translate',(p:Point2):Point2=>[p[0]+4,p[1]-3]],
  ['rotate',(p:Point2):Point2=>[-p[1],p[0]]],
  ['nonuniform scale',(p:Point2):Point2=>[p[0]*2,p[1]*.6]],
 ] as const)('reproduces a representable group %s in one immutable draft',(_name,map)=>{
  const f=fixture(),target=transform(f.current,['c'],map,true),prior=JSON.stringify([f.graph,f.bases,f.current,target]);
  freeze(f.graph);freeze(f.bases);freeze(f.current);freeze(target);
  const result=edit(f,target);expect(result.changed).toBe(true);expectControls(f.sample(result.graph),target);
  expect(JSON.stringify([f.graph,f.bases,f.current,target])).toBe(prior);expect(result.graph.mesh).toBe(f.graph.mesh);
  expect(result.graph.edgeResponses).toBe(f.graph.edgeResponses);expect(result.graph.triangleResponses).toBe(f.graph.triangleResponses);
  expect(result.graph.correctionFrames).toHaveLength(1);expect(result.graph.correctionFrames![0].status).toBe('draft');
  expect(JSON.stringify(result.graph.correctionFrames)).not.toMatch(/position|deformation|drawing/);
  if(_name==='translate')expect(Object.values(result.graph.correctionFrames![0].triangleResponses!)[0].handles).toEqual({});
 });
 it('skips unchanged zero-delta handle vectors during a translation',()=>{
  const f=fixture();for(const basis of f.bases){const curve=basis.drawing.curves[0],node=basis.drawing.nodes[0];curve.handles[0]=add(node.position,[.25,0]);}
  const current=f.sample(),target=transform(current,['c'],p=>add(p,[2,3]),true),result=edit(f,target,f.graph,current);
  expectControls(f.sample(result.graph),target);expect(Object.values(result.graph.correctionFrames![0].triangleResponses!)[0].handles).toEqual({});
 });
 it('rejects the entire operation with its control and axis when one changed coordinate has no inverse',()=>{
  const f=fixture();for(const basis of f.bases){const old=basis.drawing.nodes[0].position[1];basis.drawing.nodes[0].position[1]=7;basis.drawing.curves[0].handles[0][1]+=7-old;}
  const current=f.sample(),target=transform(current,['c'],p=>add(p,[2,3]),true),before=JSON.stringify(f.graph),failure=capturedError(()=>edit(f,target,f.graph,current));
  expect(failure.code).toBe('SURFACE_AXIS_UNAVAILABLE');expect(failure.message).toMatch(/Node a Y/);expect(JSON.stringify(f.graph)).toBe(before);expect(f.graph.correctionFrames).toBeUndefined();
 });
 it('diagnoses a near-zero scalar basis without introducing an epsilon denominator',()=>{
  const f=fixture();f.bases.forEach((basis,i)=>{const node=basis.drawing.nodes[0],old=node.position[0];node.position[0]=1+i*Number.EPSILON;basis.drawing.curves[0].handles[0][0]+=node.position[0]-old;});
  const current=f.sample(),target=moveNode(current,'a',[current.nodes[0].position[0]+1,current.nodes[0].position[1]],true);
  expect(capturedError(()=>edit(f,target,f.graph,current)).message).toMatch(/Node a X.*numerically/);
 });
 it('solves three-coordinate minimum norm from the original barycentrics, independently per axis',()=>{
  const f=fixture(),target=moveNode(f.current,'a',[-7,12],true),result=edit(f,target),response=Object.values(result.graph.correctionFrames![0].triangleResponses!)[0].nodes.a;
  for(const axis of [0,1] as const){const wanted=target.nodes.find(node=>node.id==='a')!.position[axis],coordinates=f.bases.map(b=>b.drawing.nodes.find(n=>n.id==='a')!.position[axis]) as unknown as BarycentricWeights,solved=solveClosestBarycentricWeights(f.location.geometricWeights as unknown as BarycentricWeights,coordinates,wanted);expect(solved.available).toBe(true);if(solved.available)expect(response[axis===0?'x':'y']![0].weights).toEqual(solved.weights);}
  expect(response.x![0].weights.some(weight=>weight<0)).toBe(true);expectControls(f.sample(result.graph),target);
 });
 it('uses one authority for linked nodes and verifies rotated SMOOTH controls together',()=>{
  const f=fixture(true),target=transform(f.current,['c','other'],p=>[-p[1],p[0]],true),result=edit(f,target),responses=Object.values(result.graph.correctionFrames![0].triangleResponses!)[0];
  expect(responses.nodes.linked).toBeUndefined();expect(responses.nodes.b).toBeDefined();expectControls(f.sample(result.graph),target);
  const replay=f.sample(result.graph),c=replay.curves.find(c=>c.id==='c')!,other=replay.curves.find(c=>c.id==='other')!,b=replay.nodes.find(n=>n.id==='b')!.position,u=sub(c.handles[1],b),v=sub(other.handles[0],b);
  expect(u[0]*v[1]-u[1]*v[0]).toBeCloseTo(0,12);
 });
 it('rejects inconsistent linked nodes before recording responses',()=>{
  const f=fixture(true),target=structuredClone(f.current),linked=target.nodes.find(node=>node.id==='linked')!;linked.position=add(linked.position,[1,0]);
  expect(capturedError(()=>edit(f,target)).message).toMatch(/linked.*authority b/);expect(f.graph.correctionFrames).toBeUndefined();
 });
 it('atomically rejects a representable scalar target that SMOOTH cannot reproduce',()=>{
  const f=fixture(true),target=structuredClone(f.current);target.curves.find(curve=>curve.id==='other')!.handles[0][0]++;
  const failure=capturedError(()=>edit(f,target));expect(failure.code).toBe('SURFACE_CONSTRAINT_UNSOLVABLE');expect(failure.message).toMatch(/other.*SMOOTH/);expect(f.graph.correctionFrames).toBeUndefined();
 });
 it('keeps saved samples, replaces only the exact current sample, and retains one draft frame',()=>{
  const f=fixture(),first=edit(f,moveNode(f.current,'a',[4,8],true)),firstFrame=first.graph.correctionFrames![0],firstSamples=Object.values(firstFrame.triangleResponses!)[0].nodes.a.x!;
  const current=f.sample(first.graph),second=edit(f,moveNode(current,'a',[6,10],true),first.graph,current);
  expect(second.graph.correctionFrames).toHaveLength(1);const samples=Object.values(second.graph.correctionFrames![0].triangleResponses!)[0].nodes.a.x!;
  expect(samples).toHaveLength(1);expect(samples[0].id).toBe(firstSamples[0].id);expect(firstSamples[0].weights).not.toEqual(samples[0].weights);
  const saved:SnapshotAngleGraph={...second.graph,triangleResponses:{...second.graph.triangleResponses,...second.graph.correctionFrames![0].triangleResponses},correctionFrames:second.graph.correctionFrames!.map(frame=>({...frame,status:'saved'}))};
  const anotherAngle={x:2.1,y:3},location=locateSnapshotSimplex(f.graph.mesh,anotherAngle)!,at=f.sample(saved,location),next=prepareSnapshotSurfaceTargetEdit(saved,location,f.bases,at,moveNode(at,'a',[5,9],true),{angle:anotherAngle,frameId:'next'});
  expect(Object.values(next.graph.correctionFrames!.find(frame=>frame.status==='draft')!.triangleResponses!)[0].nodes.a.x).toHaveLength(2);
 });
 it('blocks another draft angle, projected red fallback, and exact-vertex correction',()=>{
  const f=fixture(),draft=edit(f,moveNode(f.current,'a',[4,8],true)).graph,newAngle={x:3,y:3},newLocation=locateSnapshotSimplex(draft.mesh,newAngle)!;
  expect(capturedError(()=>edit(f,f.current,draft,f.current,newLocation,newAngle)).code).toBe('OBJECT_DRAFT_AT_OTHER_ANGLE');
  const outside={x:20,y:20},projection=projectToSnapshotCoverage(f.graph.mesh,outside)!;
  expect(capturedError(()=>edit(f,f.current,f.graph,f.current,projection.simplex,outside)).code).toBe('SURFACE_OUTSIDE_COVERAGE');
  const vertexAngle={x:0,y:0},vertex=locateSnapshotSimplex(f.graph.mesh,vertexAngle)!;
  expect(capturedError(()=>edit(f,f.current,f.graph,f.current,vertex,vertexAngle)).code).toBe('SURFACE_CORRECTION_REQUIRES_INTERIOR');
 });
 it('explicitly rejects ARC radius and trim changes, including an otherwise unchanged target',()=>{
  const f=fixture(true),current=structuredClone(f.current);current.joins=[{id:'arc',a:{curveId:'c',end:1},b:{curveId:'other',end:0},mode:'ARC',radius:.2}];
  const target=structuredClone(current);target.joins[0].radius=.3;expect(capturedError(()=>edit(f,target,f.graph,current)).code).toBe('SURFACE_ARC_BASIS_REQUIRED');
  current.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.1};const trimmed=structuredClone(current);trimmed.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.2};
  expect(capturedError(()=>edit(f,trimmed,f.graph,current)).message).toMatch(/ARC link.*trim/);expect(f.graph.correctionFrames).toBeUndefined();
 });
 it('returns the same graph for an unchanged target without creating a draft',()=>{const f=fixture();expect(edit(f,f.current)).toEqual({graph:f.graph,changed:false});expect(edit(f,f.current).graph).toBe(f.graph);});
});

describe('snapshot shared surface response sampler',()=>{
 it('remaps triangle and edge controls to caller location order, with signed edge inverses',()=>{
  const f=fixture(),permutation=[2,0,1],location:SnapshotSimplexLocation={...f.location,vertexIds:permutation.map(i=>f.location.vertexIds[i]),snapshotIds:permutation.map(i=>f.location.snapshotIds[i]),geometricWeights:permutation.map(i=>f.location.geometricWeights[i])};
  const current=f.sample(f.graph,location),target=moveNode(current,'a',[-4,8],true),result=edit(f,target,f.graph,current,location);
  expectControls(f.sample(result.graph,location),target);expectControls(f.sample(result.graph,f.location),target);
  const edgeAngle={x:4,y:0},edge=locateSnapshotSimplex(f.graph.mesh,edgeAngle)!,reversed={...edge,vertexIds:[...edge.vertexIds].reverse(),snapshotIds:[...edge.snapshotIds].reverse(),geometricWeights:[...edge.geometricWeights].reverse()};
  const edgeBases=reversed.snapshotIds.map(id=>f.allBases.find(basis=>basis.snapshotId===id)!),edgeCurrent=f.sample(f.graph,reversed),edgeTarget=moveNode(edgeCurrent,'a',[-8,edgeCurrent.nodes[0].position[1]],true);
  const edgeResult=prepareSnapshotSurfaceTargetEdit(f.graph,reversed,edgeBases,edgeCurrent,edgeTarget,{angle:edgeAngle,frameId:'edge-draft'}),response=Object.values(edgeResult.graph.correctionFrames![0].edgeResponses!)[0].nodes.a;
  expect(response.x).toEqual([[.4,-2]]);expect(response.y).toBeUndefined();expectControls(f.sample(edgeResult.graph,reversed),edgeTarget);expectControls(f.sample(edgeResult.graph,edge),edgeTarget);
 });
 it('uses the one globally oriented shared edge on both incident triangles and approaches it continuously',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:10,y:0}},{snapshotId:'C',angle:{x:0,y:10}},{snapshotId:'D',angle:{x:10,y:10}}]);
  const shared=mesh.edges.find(edge=>mesh.triangles.filter(face=>face.edgeIds.includes(edge.id)).length===2)!,graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{[shared.id]:{nodes:{a:{x:[[.5,1.7]]}},handles:{}}},triangleResponses:{}};
  const edge:SnapshotSimplexLocation={kind:'edge',simplexId:shared.id,vertexIds:[...shared.vertexIds],snapshotIds:shared.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId),geometricWeights:[.5,.5]},edgeSampler=createSnapshotSurfaceResponseSampler(graph,edge),expected=edgeSampler({kind:'node',nodeId:'a'},0,[0,1],[.5,.5]);
  expect(expected[1]).toBeCloseTo(1.7,14);
  for(const face of mesh.triangles){
   const location:SnapshotSimplexLocation={kind:'triangle',simplexId:face.id,vertexIds:[...face.vertexIds],snapshotIds:face.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId),geometricWeights:[1/3,1/3,1/3]},sampler=createSnapshotSurfaceResponseSampler(graph,location),boundary=face.vertexIds.map(id=>shared.vertexIds.includes(id)?.5:0),exact=sampler({kind:'node',nodeId:'a'},0,[0,1,2],boundary);
   shared.vertexIds.forEach((id,index)=>expect(exact[face.vertexIds.indexOf(id)]).toBeCloseTo(expected[index],14));
   for(const epsilon of [1e-4,1e-7,1e-10]){const near=boundary.map(weight=>weight===0?epsilon:weight*(1-epsilon)),response=sampler({kind:'node',nodeId:'a'},0,[0,1,2],near);response.forEach((weight,index)=>expect(Math.abs(weight-exact[index])).toBeLessThan(4*epsilon));}
  }
 });
 it('keeps draft-effective geometry identical after save over the whole simplex',()=>{
  const f=fixture(),draft=edit(f,transform(f.current,['c'],p=>[-p[1],p[0]],true)).graph,effective=effectiveSnapshotSurfaceResponses(draft),saved:SnapshotAngleGraph={...draft,edgeResponses:effective.edgeResponses,triangleResponses:effective.triangleResponses,correctionFrames:draft.correctionFrames!.map(frame=>({...frame,status:'saved'}))};
  for(const angle of [{x:1,y:1},{x:2,y:3},{x:8,y:1},{x:0,y:4},{x:4,y:0},{x:0,y:0}]){const location=locateSnapshotSimplex(f.graph.mesh,angle)!;expectControls(f.sample(saved,location),f.sample(draft,location));}
 });
 it('preserves unrelated knots and does not let corrected weights change active membership',()=>{
  const f=fixture(),edgeAngle={x:4,y:0},location=locateSnapshotSimplex(f.graph.mesh,edgeAngle)!;
  f.graph.edgeResponses[location.simplexId]={nodes:{a:{x:[[.2,-1],[.400000000001,8],[.8,2]]}},handles:{}};
  const bases=location.snapshotIds.map(id=>f.allBases.find(b=>b.snapshotId===id)!),current=f.sample(f.graph,location),target=moveNode(current,'a',[-4,current.nodes[0].position[1]],true),result=prepareSnapshotSurfaceTargetEdit(f.graph,location,bases,current,target,{angle:edgeAngle,frameId:'edge'}),knots=effectiveSnapshotSurfaceResponses(result.graph).edgeResponses[location.simplexId].nodes.a.x!;
  expect(knots.map(point=>point[0])).toEqual([.2,.4,.400000000001,.8]);expect(f.sample(result.graph,location).curves.map(curve=>curve.id)).toEqual(['c']);
 });
});
