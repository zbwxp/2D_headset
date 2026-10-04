import {expect,it} from 'vitest';
import {emptyDrawing} from '../../domain/drawing/model';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {createSnapshotResponseConstant,createSnapshotResponseMaterialParameter,prepareSnapshotExpressionValueProgram} from '../../domain/recordingSnapshot/responseExpressions';
import {prepareSnapshotSurfaceValueProgram} from '../../domain/recordingSnapshot/surfaceTargets';
import type {SnapshotSurfaceMirrorContext} from '../../domain/recordingSnapshot/surfaceMirrorContext';
import {snapshotSplitParameterRange} from '../../domain/recordingSnapshot/splitParameterField';

const target=Object.freeze({kind:'node' as const,nodeId:'a'});

for(const inherited of [false,true])it(`validates mutable scalar inputs after frozen operands have warmed (${inherited?'inherited':'absent'} expression)`,()=>{
 const program=prepareSnapshotExpressionValueProgram({vertexIds:['A','B']},{expression:inherited?()=>createSnapshotResponseConstant(3):undefined}),sample=program.createSampler(()=>0),residual=inherited?3:0;
 const coordinates=Object.freeze([0,8]),frozenWeights=Object.freeze([.25,.75]);
 expect(sample(target,0,coordinates,frozenWeights)).toBe(6+residual);
 expect(program.createSampler(()=>0)(target,0,coordinates,frozenWeights)).toBe(6+residual);
 const weights=[.25,.75];expect(sample(target,0,coordinates,weights)).toBe(6+residual);
 weights[0]=.5;weights[1]=.5;expect(sample(target,0,coordinates,weights)).toBe(4+residual);
 weights[1]=NaN;expect(()=>sample(target,0,coordinates,weights)).toThrow('original geometric weights');
 weights[1]=.5;Object.defineProperty(weights,1,{get:()=>.5});expect(()=>sample(target,0,coordinates,weights)).toThrow('dense data array');
 const mutable=[0,8];expect(sample(target,0,mutable,frozenWeights)).toBe(6+residual);
 mutable[1]=Infinity;expect(()=>sample(target,0,mutable,frozenWeights)).toThrow('finite bases');
 delete mutable[1];expect(()=>sample(target,0,mutable,frozenWeights)).toThrow('dense data array');
 const sparse=Object.freeze([0,,] as number[]);expect(()=>sample(target,0,sparse,frozenWeights)).toThrow('dense data array');
 expect(()=>sample(target,0,Object.freeze([0,Infinity]),frozenWeights)).toThrow('finite bases');
 expect(()=>sample(target,0,coordinates,Object.freeze([-.25,1.25]))).toThrow('original geometric weights');
 expect(()=>sample(target,0,coordinates,Object.freeze([.25,.75,0]))).toThrow('original geometric weights');
});

function fixture(){
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),edge=mesh.edges[0];
 const graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 const bases=['A','B'].map(snapshotId=>({snapshotId,drawing:emptyDrawing()}));
 const location=(x:number)=>locateSnapshotSimplex(mesh,{x,y:0})!;
 return {graph,bases,location,edge};
}

it('preserves surface input validation with no inherited fields and frozen coordinate plans',()=>{
 const f=fixture(),location=f.location(45),sample=prepareSnapshotSurfaceValueProgram(f.graph,location,f.bases).createSampler(),coordinates=Object.freeze([2,8]),weights=[.5,.5];
 expect(sample(target,0,coordinates,weights)).toBe(5);
 weights[0]=.25;weights[1]=.75;expect(sample(target,0,coordinates,weights)).toBe(6.5);
 weights[0]=-.25;weights[1]=1.25;expect(()=>sample(target,0,coordinates,weights)).toThrow('original geometric weights');
 expect(()=>sample(target,0,Object.freeze([2,,] as number[]),[.5,.5])).toThrow('dense data array');
 expect(()=>sample(target,0,Object.freeze([2]),[.5,.5])).toThrow('finite bases');
});

it('keeps mirrored corner sampling out of each frame fitted-parameter collector',()=>{
 const f=fixture(),domain={parts:[{curveId:'left',parameterRange:[0,.5] as const},{curveId:'right',parameterRange:[.5,1] as const}],t:.5};
 const controls=([[0,0],[1/3,0],[2/3,0],[1,0]] as const).map(point=>[createSnapshotResponseConstant(point[0]),createSnapshotResponseConstant(point[1])] as const);
 const expression=createSnapshotResponseMaterialParameter(controls,[createSnapshotResponseConstant(.2),createSnapshotResponseConstant(.8)],{id:'field',vertexIds:f.edge.vertexIds,edges:[],samples:[]},domain);
 f.graph.responseExpressions={[f.edge.id]:{nodes:{a:{x:expression}},handles:{}}};
 const mirror:SnapshotSurfaceMirrorContext={sample:()=>({scalar:()=>0,corners:()=>[0,0],contracts:[],diagnostics:[]})};
 const program=prepareSnapshotSurfaceValueProgram(f.graph,f.location(18),f.bases,mirror),first=program.createSampler(),second=program.createSampler(),coordinates=Object.freeze([0,0]);
 const qa=first(target,0,coordinates,f.location(18).geometricWeights),qb=second(target,0,coordinates,f.location(72).geometricWeights);
 expect(qa).not.toBe(qb);expect(first.rawScalar!(target,0)).toBe(qa);expect(second.rawScalar!(target,0)).toBe(qb);
 // This scalar has no expression but still needs mirror projection corners.
 expect(first(target,1,coordinates,f.location(18).geometricWeights)).toBe(0);
 expect(snapshotSplitParameterRange(first.projectSmooth!(emptyDrawing()).drawing,'left')).toEqual([0,qa]);
 expect(snapshotSplitParameterRange(second.projectSmooth!(emptyDrawing()).drawing,'left')).toEqual([0,qb]);
 expect(snapshotSplitParameterRange(first.projectSmooth!(emptyDrawing()).drawing,'left')).toEqual([0,qa]);
});
