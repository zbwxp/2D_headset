import {describe,expect,it} from 'vitest';
import {applyDrawingControlWrites,prepareDrawingControlEditPlan,type DrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {createSnapshotResponseConstant} from '../../domain/recordingSnapshot/responseExpressions';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {getSnapshotSimplexSamplingStats,resetSnapshotSimplexSamplingStats,prepareSnapshotSimplexGeometry,reviseSnapshotSimplexGeometry,type SnapshotSimplexBasis,type SnapshotSimplexGeometry} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceValueSampler,getSnapshotSurfaceTargetWorkStats,resetSnapshotSurfaceTargetWorkStats,prepareSnapshotSurfaceTargetEditWithReplay,SnapshotSurfaceTargetEditError} from '../../domain/recordingSnapshot/surfaceTargets';
import {getSnapshotSurfaceReplayScopeStats,resetSnapshotSurfaceReplayScopeStats,snapshotSurfaceTargetReplayScope} from '../../domain/recordingSnapshot/surfaceTargetReplayScope';

const plus=(point:Point2,delta:Point2):Point2=>[point[0]+delta[0],point[1]+delta[1]];
function fixture(unrelated=0,relation?:'SMOOTH'|'ARC',hiddenDirtyCurve=false){
 const bindings=[{snapshotId:'zero',angle:{x:0,y:0}},{snapshotId:'side',angle:{x:-90,y:0}}],mesh=createSnapshotTriangulation(bindings),angle={x:-30,y:0},location=locateSnapshotSimplex(mesh,angle)!;
 const graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 const sources=bindings.map((binding,index)=>{
  const drawing=emptyDrawing(),point=(x:number,y:number):Point2=>[index+x*(1+index*.2),index*.5+y*(1+index*.3)];
  for(const [i,id] of ['a','b',...Array.from({length:unrelated},(_,i)=>`other${i}`)].entries()){
   const start=point(i,0),end=point(i+1,0),vector:Point2=[.2+index*.1,.3+index*.1];
   drawing.nodes.push({id:`${id}0`,position:start},{id:`${id}1`,position:end});
   drawing.curves.push({id,name:id,nodes:[`${id}0`,`${id}1`],handles:[plus(start,vector),plus(end,[-vector[0],-vector[1]])],visible:!hiddenDirtyCurve||id!=='b',locked:false,width:.02});
  }
  drawing.layers=[{id:'layer',name:'Layer',visible:true,locked:false,items:drawing.curves.map(curve=>curve.id)}];
  if(relation)drawing.endpointLinks=[{id:'link',a:{curveId:'a',end:1},b:{curveId:'b',end:0},joinBrush:relation==='ARC'?{kind:'ARC',trimDistance:.1}:{kind:'SMOOTH'}}];
  return {...binding,drawing};
 });
 const bases=location.snapshotIds.map(id=>sources.find(source=>source.snapshotId===id)!);
 const initial=prepareSnapshotSimplexGeometry(bases).sample(location.geometricWeights,undefined,{retainLineage:true});
 // The runtime's native material result can have different interval storage,
 // while preserving the exact projected control arrays and all other metadata.
 const before={...initial.drawing,displayIntervals:[]};
 const plan=prepareDrawingControlEditPlan(before,{kind:'handle',endpoint:{curveId:'a',end:0}}),wanted=applyDrawingControlWrites(plan,{handlePositions:[{curveId:'a',end:0,position:plus(before.curves[0].handles[0],[.04,.03])}]});
 const revise=(previous:SnapshotSimplexGeometry,input:SnapshotSimplexBasis[],nodes=false)=>{
  const at=input.findIndex(basis=>basis.snapshotId==='side'),source=input[at],basisPlan=prepareDrawingControlEditPlan(source.drawing,{kind:'curves',curveIds:['b']});
  const nodeIds=nodes?(relation?['a1','b0']:['b0']):[],nodePositions=new Map(nodeIds.map(id=>[id,plus(source.drawing.nodes.find(node=>node.id===id)!.position,[.03,.02])]));
  const handlePositions=basisPlan.controls.filter((control):control is Extract<typeof control,{kind:'handle'}>=>control.kind==='handle').map(control=>{
   const curve=source.drawing.curves.find(curve=>curve.id===control.curveId)!;
   return {...control,position:plus(curve.handles[control.end],nodeIds.includes(curve.nodes[control.end])?[.03,.02]:control.curveId==='b'&&control.end===1?[.02,.04]:[0,0])};
  });
  const drawing=applyDrawingControlWrites(basisPlan,{nodePositions,handlePositions}),next=input.map((basis,index)=>index===at?{...basis,drawing}:basis),sample=reviseSnapshotSimplexGeometry(previous,next,location.geometricWeights,undefined,{structureUnchanged:true,basisControls:new Map([[source.snapshotId,basisPlan.controls]]),responseControls:[]})!;
  expect(sample).toBeDefined();return {bases:next,sample};
 };
 const first=revise(initial,bases,true),second=revise(first.sample,first.bases);
 return {angle,location,graph,bases:second.bases,initial,current:second.sample,before,plan,wanted};
}
function solve(f:ReturnType<typeof fixture>,plan?:DrawingControlEditPlan,wanted=f.wanted,graph=f.graph,mirror?:{sample:()=>undefined}){
 let replay:DrawingDocument|undefined;
 const result=prepareSnapshotSurfaceTargetEditWithReplay(graph,f.location,f.bases,f.current.drawing,wanted,{immutableInputs:true,angle:f.angle,frameId:'draft',controlPlan:plan,mirror},(candidate,responseControls)=>{
  const sampler=createSnapshotSurfaceValueSampler(candidate,f.location,f.bases,mirror,{immutableInputs:true});
  replay=reviseSnapshotSimplexGeometry(f.current,f.bases,f.location.geometricWeights,sampler,{structureUnchanged:true,basisControls:new Map(),responseControls})?.drawing??prepareSnapshotSimplexGeometry(f.bases).sample(f.location.geometricWeights,sampler).drawing;
  return replay;
 });return {result,replay};
}
const controls=(drawing:DrawingDocument)=>[drawing.nodes.map(node=>node.position),drawing.curves.map(curve=>curve.handles)].flat(3);

describe('native surface target read/replay scope',()=>{
 it('keeps actual inverse, topology and replay work constant with 100 and 1000 unrelated curves',()=>{
  const counts=[];
  for(const unrelated of [0,100,1000]){
   const f=fixture(unrelated);resetSnapshotSurfaceTargetWorkStats();resetSnapshotSurfaceReplayScopeStats();resetSnapshotSimplexSamplingStats();
   const actual=solve(f,f.plan);
   counts.push({inverse:getSnapshotSurfaceTargetWorkStats(),scope:getSnapshotSurfaceReplayScopeStats(),sampling:getSnapshotSimplexSamplingStats()});
   const cold=solve(f);expect(actual.result).toEqual(cold.result);
   controls(actual.replay!).forEach((value,index)=>expect(value).toBeCloseTo(controls(f.wanted)[index],10));
   expect(counts.at(-1)!.inverse).toEqual({nodeSolves:4,handleSolves:4,replayNodes:4,replayHandles:4,topologyComparisons:0});
   expect(counts.at(-1)!.scope.revisionSteps).toBe(2);
   expect(counts.at(-1)!.sampling).toMatchObject({fullSamples:0,revisionSamples:1});
  }
  expect(counts[1].inverse).toEqual(counts[0].inverse);expect(counts[2].inverse).toEqual(counts[0].inverse);
  expect(counts[1].scope).toEqual(counts[0].scope);expect(counts[2].scope).toEqual(counts[0].scope);
  for(const count of counts.slice(1))for(const key of ['scalarEvaluations','basisCoordinateReads','projectedComponents'] as const)expect(count.sampling[key]).toBe(counts[0].sampling[key]);
  expect(counts[2].sampling.copiedControlSlots).toBeGreaterThan(counts[0].sampling.copiedControlSlots);
 });
 it('solves native-dirty nodes outside the narrow handle plan and verifies linked SMOOTH members',()=>{
  const f=fixture(100,'SMOOTH');expect(f.plan.nodeIds).toEqual([]);expect(f.plan.curveIds).toEqual(['a']);
  const scope=snapshotSurfaceTargetReplayScope(f.current.drawing,f.wanted,f.plan)!;
  expect([...scope.nodeIds].sort()).toEqual(['a0','a1','b0','b1']);expect(scope.nodeAuthorities.get('b0')).toBe('a1');
  expect(scope.view(f.current.drawing).curves.map(curve=>curve.id)).toEqual(['a','b']);
  resetSnapshotSurfaceTargetWorkStats();const actual=solve(f,f.plan),work=getSnapshotSurfaceTargetWorkStats(),cold=solve(f);
  expect(actual.result).toEqual(cold.result);expect(work).toMatchObject({nodeSolves:3,handleSolves:4,replayNodes:4,replayHandles:4,topologyComparisons:0});
  controls(actual.replay!).forEach((value,index)=>expect(value).toBeCloseTo(controls(f.wanted)[index],10));
 });
 it('does not turn an arbitrary target, forged plan or interrupted ancestry into a scope',()=>{
  const f=fixture(8),clone=structuredClone(f.wanted);
  expect(snapshotSurfaceTargetReplayScope(f.current.drawing,clone,f.plan)).toBeUndefined();
  expect(snapshotSurfaceTargetReplayScope(f.current.drawing,f.wanted,{...f.plan})).toBeUndefined();
  expect(snapshotSurfaceTargetReplayScope({...f.current.drawing},f.wanted,f.plan)).toBeUndefined();
  resetSnapshotSurfaceTargetWorkStats();expect(solve(f,f.plan,clone).result).toEqual(solve(f).result);expect(getSnapshotSurfaceTargetWorkStats().topologyComparisons).toBeGreaterThan(0);
  clone.nodes.find(node=>node.id==='other70')!.position=[NaN,0];expect(()=>solve(f,f.plan,clone)).toThrow(SnapshotSurfaceTargetEditError);
 });
 it('rejects changed structural wrapper metadata and retains the full ARC guard',()=>{
  const f=fixture(3,'ARC'),before={...f.before,endpointLinks:f.before.endpointLinks!.map(link=>({...link,joinBrush:{kind:'ARC' as const,trimDistance:.2}}))},plan=prepareDrawingControlEditPlan(before,{kind:'handle',endpoint:{curveId:'a',end:0}}),wanted=applyDrawingControlWrites(plan,{handlePositions:[{curveId:'a',end:0,position:plus(before.curves[0].handles[0],[.04,.03])}]});
  expect(snapshotSurfaceTargetReplayScope(f.current.drawing,wanted,plan)).toBeUndefined();
  expect(()=>solve(f,plan,wanted)).toThrow(/ARC link brush or trim changes/);expect(f.graph.correctionFrames).toBeUndefined();
  for(const key of ['layers','groups','fills','offsets','joins'] as const){const wrapped={...f.before,[key]:[...f.before[key]??[]]},wrappedPlan=prepareDrawingControlEditPlan(wrapped,{kind:'handle',endpoint:{curveId:'a',end:0}}),target=applyDrawingControlWrites(wrappedPlan,{});expect(snapshotSurfaceTargetReplayScope(f.current.drawing,target,wrappedPlan)).toBeUndefined();}
 });
 it('retains full validation for mirror and inherited expression uncertainty',()=>{
  const f=fixture(5);
  for(const [graph,mirror] of [[f.graph,{sample:()=>undefined}],[{...f.graph,responseExpressions:{[f.location.simplexId]:{nodes:{a0:{x:createSnapshotResponseConstant(0)}},handles:{}}}},undefined]] as const){
   resetSnapshotSurfaceTargetWorkStats();solve(f,f.plan,f.wanted,graph,mirror);expect(getSnapshotSurfaceTargetWorkStats().topologyComparisons).toBeGreaterThan(0);
  }
 });
 it('declines deferred projectors and domain plans',()=>{
  const f=fixture(1),domain=prepareDrawingControlEditPlan(f.before,{kind:'domain',layerIds:['layer']});
  expect(snapshotSurfaceTargetReplayScope(f.current.drawing,applyDrawingControlWrites(domain,{}),domain)).toBeUndefined();
  registerEvaluatedAffine(f.current.drawing,f.initial.drawing,()=>({point:p=>p,maxScale:1}));
  expect(snapshotSurfaceTargetReplayScope(f.current.drawing,f.wanted,f.plan)).toBeUndefined();
 });
 it('retains full validation when the native dirty closure includes hidden controls',()=>{
  const f=fixture(5,undefined,true);expect(snapshotSurfaceTargetReplayScope(f.current.drawing,f.wanted,f.plan)).toBeUndefined();
  resetSnapshotSurfaceTargetWorkStats();const actual=solve(f,f.plan),work=getSnapshotSurfaceTargetWorkStats();expect(actual.result).toEqual(solve(f).result);expect(work.topologyComparisons).toBeGreaterThan(0);
 });
});
