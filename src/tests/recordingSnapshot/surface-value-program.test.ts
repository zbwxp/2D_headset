import {expect,it} from 'vitest';
import {emptyDrawing} from '../../domain/drawing/model';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotSurfaceValueSampler,prepareSnapshotSurfaceValueProgram,getSnapshotSurfaceValueProgramStats,resetSnapshotSurfaceValueProgramStats} from '../../domain/recordingSnapshot/surfaceTargets';
import {createSnapshotResponseResidual,createSnapshotResponseConstant,createSnapshotResponseMaterialParameter,type SnapshotResponseExpressionField} from '../../domain/recordingSnapshot/responseExpressions';
import {snapshotSplitParameterRange} from '../../domain/recordingSnapshot/splitParameterField';
import {type SnapshotSurfaceMirrorContext} from '../../domain/recordingSnapshot/surfaceMirrorContext';
const target={kind:'node' as const,nodeId:'a'};
function fixture(){
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),edge=mesh.edges[0],graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 const field:SnapshotResponseExpressionField={id:'field',vertexIds:edge.vertexIds,edges:[{from:0,to:1,knots:[[.4,-.25],[.6,1.4]]}],samples:[]};
 const bases=['A','B'].map((snapshotId,i)=>({snapshotId,drawing:{...emptyDrawing(),nodes:[{id:'a',position:[i*10,0] as [number,number]}]}}));
 graph.responseExpressions={[edge.id]:{nodes:{a:{x:createSnapshotResponseResidual(field,edge.vertexIds.map(id=>[{coefficient:1,basis:{snapshotId:mesh.vertices.find(v=>v.id===id)!.snapshotId,target,axis:0}}]))}},handles:{}}};
 const location=(x:number)=>locateSnapshotSimplex(mesh,{x,y:0})!;
 const coords=(x:number)=>location(x).snapshotIds.map(id=>bases.find(b=>b.snapshotId===id)!.drawing.nodes[0].position[0]);
 return {graph,field,bases,location,coords};
}
it('reuses one compiled program across new support objects and immutable basis wrappers',()=>{
 const f=fixture(),angles=[9,27,45,63,81],expected=angles.map(x=>createSnapshotSurfaceValueSampler(f.graph,f.location(x),f.bases)(target,0,f.coords(x),f.location(x).geometricWeights));
 resetSnapshotSurfaceValueProgramStats();let preparations=0;
 const program=prepareSnapshotSurfaceValueProgram(f.graph,f.location(9),f.bases,undefined,{onPrepare:()=>preparations++});
 angles.forEach((x,i)=>{
  const reused=prepareSnapshotSurfaceValueProgram({...f.graph},f.location(x),f.bases.map(b=>({...b})),undefined,{onPrepare:()=>preparations++});
  expect(reused).toBe(program);expect(reused.createSampler()(target,0,f.coords(x),f.location(x).geometricWeights)).toBe(expected[i]);
 });
 expect(getSnapshotSurfaceValueProgramStats()).toEqual({programCompilations:1,expressionCompilations:1});expect(preparations).toBe(1);
 const changed={...f.graph,responseExpressions:{}};
 expect(prepareSnapshotSurfaceValueProgram(changed,f.location(45),f.bases)).not.toBe(program);
 expect(prepareSnapshotSurfaceValueProgram(f.graph,f.location(45),f.bases)).toBe(program);
 const changedBases=f.bases.map((b,i)=>i?{...b,drawing:{...b.drawing,nodes:[{id:'a',position:[20,0] as [number,number]}]}}:b);
 expect(prepareSnapshotSurfaceValueProgram(f.graph,f.location(45),changedBases)).not.toBe(program);
});
it('keeps the mutable compatibility adapter responsive to in-place changes',()=>{
 const f=fixture(),l=f.location(45);delete f.graph.responseExpressions;
 const sample=()=>createSnapshotSurfaceValueSampler(f.graph,l,f.bases)(target,0,[0,10],l.geometricWeights);
 expect(sample()).toBe(5);f.graph.edgeResponses[l.simplexId]={nodes:{a:{x:[[.5,1.3]]}},handles:{}};expect(sample()).toBe(13);
});
it('isolates fitted parameter collectors between interleaved samples of one program',()=>{
 const f=fixture(),domain={parts:[{curveId:'left',parameterRange:[0,.5] as const},{curveId:'right',parameterRange:[.5,1] as const}],t:.5};
 const controls=([[0,0],[1/3,0],[2/3,0],[1,0]] as const).map(point=>[createSnapshotResponseConstant(point[0]),createSnapshotResponseConstant(point[1])] as const);
 const expression=createSnapshotResponseMaterialParameter(controls,[createSnapshotResponseConstant(.2),createSnapshotResponseConstant(.8)],{...f.field,edges:[]},domain);
 f.graph.responseExpressions={[f.location(45).simplexId]:{nodes:{a:{x:expression}},handles:{}}};
 const program=prepareSnapshotSurfaceValueProgram(f.graph,f.location(18),f.bases),a=program.createSampler(),b=program.createSampler();
 const qa=a(target,0,[0,0],f.location(18).geometricWeights),qb=b(target,0,[0,0],f.location(72).geometricWeights);expect(qa).not.toBe(qb);
 const first=a.projectSmooth!(emptyDrawing()).drawing,second=b.projectSmooth!(emptyDrawing()).drawing;
 expect(snapshotSplitParameterRange(first,'left')).toEqual([0,qa]);expect(snapshotSplitParameterRange(second,'left')).toEqual([0,qb]);
 expect(snapshotSplitParameterRange(a.projectSmooth!(emptyDrawing()).drawing,'left')).toEqual([0,qa]);
});
it('isolates mirror angle buffers, projection scalars and diagnostics between samplers',()=>{
 const f=fixture();delete f.graph.responseExpressions;let calls=0;
 const mirror:SnapshotSurfaceMirrorContext={sample:(location,weights)=>{calls++;expect(location.geometricWeights).toEqual(weights);const value=weights[1]*10;return {scalar:t=>t.kind==='node'&&t.nodeId==='a'?value:undefined,corners:()=>[0,10],contracts:[],diagnostics:[`mirror ${value}`]};}};
 const program=prepareSnapshotSurfaceValueProgram(f.graph,f.location(18),f.bases,mirror),a=program.createSampler(),b=program.createSampler();
 a({kind:'node',nodeId:'missing'},0,[0,10],f.location(18).geometricWeights);
 const first=a(target,0,[0,10],f.location(18).geometricWeights),second=b(target,0,[0,10],f.location(72).geometricWeights);
 expect(calls).toBe(2);expect(a.rawScalar!(target,0)).toBe(first);expect(b.rawScalar!(target,0)).toBe(second);expect(first).not.toBe(second);
 expect(a.projectSmooth!(emptyDrawing()).diagnostics).toHaveLength(2);expect(b.projectSmooth!(emptyDrawing()).diagnostics).toEqual([`mirror ${second}`]);
});
