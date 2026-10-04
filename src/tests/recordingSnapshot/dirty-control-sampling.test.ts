import {describe,expect,it,vi} from 'vitest';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';
import {snapshotCoverageRevisionChanges,prepareSnapshotCoverage,prepareSnapshotCoverageStructure,type SnapshotCoverageEvaluation} from '../../domain/recordingSnapshot/snapshotCoverage';
import {createSnapshotSurfaceValueSampler} from '../../domain/recordingSnapshot/surfaceTargets';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {snapshotSimplexDrawingRevision,getSnapshotSimplexSamplingStats,resetSnapshotSimplexSamplingStats,type SnapshotSimplexBasis,type SnapshotSimplexRevisionChanges,type SnapshotScalarTarget} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotResponseConstant} from '../../domain/recordingSnapshot/responseExpressions';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';

function fixture(unrelated=0,triangle=false){
 const bindings=[{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},...(triangle?[{snapshotId:'C',angle:{x:0,y:90}}]:[])];
 const mesh=createSnapshotTriangulation(bindings),graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 const bases:SnapshotSimplexBasis[]=bindings.map((binding,index)=>{
  const drawing=emptyDrawing(),point=(x:number,y:number):Point2=>[index+x*(index+1),y*(1+index*.4)];
  for(const [i,id] of ['a','b',...Array.from({length:unrelated},(_,i)=>`other${i}`)].entries()){
   drawing.nodes.push({id:`${id}0`,position:point(i,0)},{id:`${id}1`,position:point(i+1,0)});
   drawing.curves.push({id,name:id,nodes:[`${id}0`,`${id}1`],handles:[point(i+.2,.4),point(i+.8,.25)],width:.02,visible:true,locked:false});
  }
  drawing.endpointLinks=[{id:'smooth',a:{curveId:'a',end:1},b:{curveId:'b',end:0},throughDisplay:true,joinBrush:{kind:'SMOOTH'}}];
  drawing.layers=[{id:'layer',name:'Layer',visible:true,locked:false,items:drawing.curves.map(curve=>curve.id)}];
  drawing.fills=[{id:'fill',name:'Fill',visible:true,locked:false,color:'black',boundary:[{id:'a',reverse:false},{id:'b',reverse:false}]}];
  drawing.layers[0].items.push('fill');return {...binding,drawing};
 });
 const angle=triangle?{x:30,y:20}:{x:30,y:0},location=locateSnapshotSimplex(mesh,angle)!,structure=prepareSnapshotCoverageStructure(mesh,bases);
 const sample=(input=bases,g=graph,previous?:SnapshotCoverageEvaluation,changes?:SnapshotSimplexRevisionChanges)=>structure.evaluate(angle,id=>input.find(basis=>basis.snapshotId===id)!,support=>createSnapshotSurfaceValueSampler(g,support,input,undefined,{immutableInputs:true}),{immutableInputs:true,previous,changes});
 const expected=(input:SnapshotSimplexBasis[],g=graph)=>prepareSnapshotCoverage(mesh,input).evaluate(angle,support=>createSnapshotSurfaceValueSampler(g,support,input));
 return {bases,graph,mesh,angle,location,structure,sample,expected};
}
function changeHandle(bases:readonly SnapshotSimplexBasis[],snapshotId:string,curveId:string,end:0|1,delta:Point2):SnapshotSimplexBasis[]{
 return bases.map(basis=>basis.snapshotId!==snapshotId?basis:{...basis,drawing:{...basis.drawing,curves:basis.drawing.curves.map(curve=>curve.id!==curveId?curve:{...curve,handles:curve.handles.map((point,index)=>index!==end?point:[point[0]+delta[0],point[1]+delta[1]]) as [Point2,Point2]})}});
}
const changes=(basisId:string,controls:readonly SnapshotScalarTarget[],responseControls:readonly SnapshotScalarTarget[]=[]):SnapshotSimplexRevisionChanges=>({structureUnchanged:true,basisControls:new Map([[basisId,controls]]),responseControls});
const handle:SnapshotScalarTarget={kind:'handle',curveId:'a',end:1};

describe('prepared native control sample lineage',()=>{
 it.each([0,100,1000])('bounds scalar/projection work independently of %i unrelated curves',unrelated=>{
  const f=fixture(unrelated),before=f.sample(),next=changeHandle(f.bases,'A','a',1,[.25,.4]);resetSnapshotSimplexSamplingStats();
  const actual=f.sample(next,f.graph,before,changes('A',[handle])),counts=getSnapshotSimplexSamplingStats();
  expect(actual).toEqual(f.expected(next));
  expect(counts).toMatchObject({revisionSamples:1,fullSamples:0,scalarEvaluations:2,basisCoordinateReads:2,projectedComponents:1});
  expect(counts.copiedControlSlots).toBeGreaterThan(unrelated*4);
  const proof=snapshotSimplexDrawingRevision(actual.normal!.drawing)!;expect(proof.previous).toBe(before.normal!.drawing);expect([...proof.dirtyCurveIds].sort()).toEqual(['a','b']);expect(Object.isFrozen(proof)).toBe(true);expect(Object.isFrozen(proof.dirtyCurveIds)).toBe(true);expect(snapshotSimplexDrawingRevision(before.normal!.drawing)).toBeUndefined();expect(snapshotCoverageRevisionChanges(before,actual)).toEqual({curveIds:proof.dirtyCurveIds});expect(snapshotCoverageRevisionChanges(actual,before)).toBeUndefined();
  expect(actual.normal!.drawing.curves.find(curve=>curve.id==='b')!.handles[0]).not.toEqual(before.normal!.drawing.curves.find(curve=>curve.id==='b')!.handles[0]);
  expect(actual.normal!.drawing.fills).toEqual(before.normal!.drawing.fills);
 });
 it.each([false,true])('keeps raw vectors separate through repeated basis changes, undo and cancel (triangle=%s)',triangle=>{
  const f=fixture(8,triangle),baseline=f.sample();let before=baseline;
  const frames=[changeHandle(f.bases,'A','a',1,[.7,-.4]),changeHandle(f.bases,'A','a',1,[-.4,.9]),f.bases,changeHandle(f.bases,'A','a',1,[.2,.3]),f.bases];
  for(const next of frames){resetSnapshotSimplexSamplingStats();const actual=f.sample(next,f.graph,before,changes('A',[handle]));expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:1,scalarEvaluations:2,projectedComponents:1});expect(actual).toEqual(f.expected(next));before=actual;}
  expect(before).toEqual(baseline);
 });
 it('compares only the bounded dependency coordinates and skips unchanged candidates',()=>{
  const f=fixture(100),before=f.sample(),next=f.bases.map(basis=>({...basis,drawing:{...basis.drawing}}));resetSnapshotSimplexSamplingStats();
  const actual=f.sample(next,f.graph,before,{structureUnchanged:true,basisControls:new Map(next.map(basis=>[basis.snapshotId,[handle]])),responseControls:[]});
  expect(actual).toEqual(before);expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:1,scalarEvaluations:0,basisCoordinateReads:4,projectedComponents:0});
 });
 it('reports no final curve change when a dirty response candidate evaluates identically',()=>{
  const f=fixture(3),before=f.sample(),actual=f.sample(f.bases,f.graph,before,{structureUnchanged:true,basisControls:new Map(),responseControls:[handle]});
  expect(actual).toEqual(before);expect(snapshotCoverageRevisionChanges(before,actual)).toEqual({curveIds:[]});
  const cold=f.sample();expect(snapshotCoverageRevisionChanges(before,cold)).toBeUndefined();
 });
 it('expands a canonical linked-node move to raw incident vectors without reprojecting unrelated handles',()=>{
  const f=fixture(12),before=f.sample(),next=f.bases.map(basis=>basis.snapshotId!=='A'?basis:{...basis,drawing:{...basis.drawing,nodes:basis.drawing.nodes.map(node=>!['a1','b0'].includes(node.id)?node:{...node,position:[node.position[0]+.5,node.position[1]+.25] as Point2})}});
  resetSnapshotSimplexSamplingStats();const actual=f.sample(next,f.graph,before,changes('A',[{kind:'node',nodeId:'a1'},{kind:'node',nodeId:'b0'}]));
  expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:1,scalarEvaluations:6,basisCoordinateReads:6,projectedComponents:1});expect(actual).toEqual(f.expected(next));
  expect(actual.normal!.nodeAuthorities.get('b0')).toBe('a1');
 });
 it.each([false,true])('samples signed native response revisions with original support (triangle=%s)',triangle=>{
  const f=fixture(100,triangle),before=f.sample();
  const graph:SnapshotAngleGraph=triangle?{...f.graph,triangleResponses:{[f.location.simplexId]:{nodes:{},handles:{a:[{},{x:[{id:'response',at:[1-30/90-20/90,30/90,20/90],weights:[-1,1,1]}]}]}}}}:{...f.graph,edgeResponses:{[f.location.simplexId]:{nodes:{},handles:{a:[{},{x:[[1/3,1.2]]}]}}}};
  resetSnapshotSimplexSamplingStats();const actual=f.sample(f.bases,graph,before,{structureUnchanged:true,basisControls:new Map(),responseControls:[handle]});
  expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:1,fullSamples:0,scalarEvaluations:2,projectedComponents:1});expect(actual).toEqual(f.expected(f.bases,graph));
 });
 it('reprepares when linked geometry changes coherence and recomputes node authority',()=>{
  const f=fixture(3),before=f.sample(),next=f.bases.map(basis=>basis.snapshotId!=='A'?basis:{...basis,drawing:{...basis.drawing,nodes:basis.drawing.nodes.map(node=>node.id!=='b0'?node:{...node,position:[node.position[0]+.2,node.position[1]] as Point2})}});
  resetSnapshotSimplexSamplingStats();const actual=f.sample(next,f.graph,before,changes('A',[{kind:'node',nodeId:'b0'}]));
  expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:0,fullSamples:1});expect(actual).toEqual(f.expected(next));expect(actual.normal!.nodeAuthorities.get('b0')).toBe('b0');expect(actual.normal!.drawing.endpointLinks).toHaveLength(0);
  const restored=f.sample(f.bases,f.graph,actual,changes('A',[{kind:'node',nodeId:'b0'}]));expect(restored).toEqual(before);
 });
 it('requires complete basis lineage and source/membership proof',()=>{
  const f=fixture(4),before=f.sample(),next=changeHandle(f.bases,'A','a',1,[.1,.3]);
  for(const proof of [undefined,{structureUnchanged:true as const,basisControls:new Map(),responseControls:[]}]){resetSnapshotSimplexSamplingStats();const actual=f.sample(next,f.graph,before,proof);expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:0,fullSamples:1});expect(actual).toEqual(f.expected(next));}
  const changed=next.map(basis=>({...basis,drawing:{...basis.drawing,curves:basis.drawing.curves.filter(curve=>curve.id!=='other0')}})),structure=prepareSnapshotCoverageStructure(f.mesh,changed);
  resetSnapshotSimplexSamplingStats();const actual=structure.evaluate(f.angle,id=>changed.find(basis=>basis.snapshotId===id)!,undefined,{immutableInputs:true,previous:before,changes:changes('A',[handle])});expect(getSnapshotSimplexSamplingStats().revisionSamples).toBe(0);expect(actual.normal!.drawing.curves.some(curve=>curve.id==='other0')).toBe(false);
 });
 it('takes the canonical full path for expressions and unbranded callback wrappers',()=>{
  const f=fixture(4),before=f.sample(),graph={...f.graph,responseExpressions:{[f.location.simplexId]:{nodes:{a0:{x:createSnapshotResponseConstant(.125)}},handles:{}}}};
  resetSnapshotSimplexSamplingStats();const actual=f.sample(f.bases,graph,before,{structureUnchanged:true,basisControls:new Map(),responseControls:[{kind:'node',nodeId:'a0'}]});expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:0,fullSamples:1});expect(snapshotSimplexDrawingRevision(actual.normal!.drawing)).toBeUndefined();expect(actual).toEqual(f.expected(f.bases,graph));
  const callback=vi.fn((_target:SnapshotScalarTarget,_axis:0|1,_coordinates:readonly number[],weights:readonly number[])=>weights);
  resetSnapshotSimplexSamplingStats();f.structure.evaluate(f.angle,id=>f.bases.find(basis=>basis.snapshotId===id)!,()=>callback,{immutableInputs:true,previous:before,changes:{structureUnchanged:true,basisControls:new Map(),responseControls:[]}});expect(getSnapshotSimplexSamplingStats().revisionSamples).toBe(0);expect(callback).toHaveBeenCalledTimes(getSnapshotSimplexSamplingStats().scalarEvaluations);
 });
 it('uses the complete canonical mirror sampler when mirror dependencies are not proven',()=>{
  const f=fixture(5),before=f.sample(),mirror={sample:()=>undefined},responses=(support:typeof f.location)=>createSnapshotSurfaceValueSampler(f.graph,support,f.bases,mirror,{immutableInputs:true});
  resetSnapshotSimplexSamplingStats();const actual=f.structure.evaluate(f.angle,id=>f.bases.find(basis=>basis.snapshotId===id)!,responses,{immutableInputs:true,previous:before,changes:{structureUnchanged:true,basisControls:new Map(),responseControls:[]}});
  expect(getSnapshotSimplexSamplingStats()).toMatchObject({revisionSamples:0,fullSamples:1});expect(actual).toEqual(prepareSnapshotCoverage(f.mesh,f.bases).evaluate(f.angle,responses));
 });
 it('rejects malformed callback results even with retained coverage options',()=>{
  const f=fixture(),before=f.sample();expect(()=>f.structure.evaluate(f.angle,id=>f.bases.find(basis=>basis.snapshotId===id)!,()=>()=>[NaN,0],{immutableInputs:true,previous:before,changes:{structureUnchanged:true,basisControls:new Map(),responseControls:[]}})).toThrow(/finite sum-one/);
 });
});
