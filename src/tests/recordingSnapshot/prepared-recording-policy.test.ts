import {drawingSignature} from '../../domain/vectorRecording/model';
import {materializeOriginalSnapshot} from '../../domain/recordingSnapshot/sources';
import {describe,expect,it} from 'vitest';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,resolveRecordingSnapshotBasis} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotDeformationState,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {prepareRecordingContext,preparedRecordingOptionsForEvaluation} from '../../domain/recordingSnapshot/preparedRecordingContext';

function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace();workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]}};workspace.library.curves={c:{id:'c',name:'Curve',nodes:['a','b'],handles:[[.25,0],[.75,1]],width:.01,visible:true,locked:false}};
 const zero=emptyRecordingSnapshot('zero','Zero'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
 for(const snapshot of [zero,side])snapshot.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['c']}];
 side.deformation.layers.layer={shape:{nodes:{a:[1,0]},handles:{}}};
 side.draft={angle:side.angle,channels:[],deformation:emptySnapshotDeformationState()};side.draft.deformation.layers.layer={shape:{nodes:{a:[2,0]},handles:{}}};
 const recording=emptySnapshotRecording('r');recording.mode='triangulated';recording.snapshotIds=['zero','side'];recording.activeSnapshotId='zero';recording.angle={x:0,y:0};recording.angleGraph=createSnapshotAngleGraph([zero,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots=[zero,side];workspace.recordings=[recording];return {workspace,recording};
}
const node=(value:{drawing:{nodes:{id:string;position:readonly number[]}[]}})=>value.drawing.nodes.find(node=>node.id==='a')!.position[0];
describe('prepared recording request ownership',()=>{
 it('keeps factory defaults local and never leaks omitted-shape policy into a public wrapper',()=>{
  const {workspace}=fixture(),options={immutableInputs:true,diagnostics:'preview' as const};
  const shapes=prepareRecordingContext(workspace,{...options,omitShapes:true}),normal=prepareRecordingContext(workspace,options);
  expect(node(shapes.sample('r',{angle:{x:90,y:0}}))).toBe(0);
  expect(node(evaluateRecordingSnapshot(workspace,'r',{...options,angle:{x:90,y:0}}))).toBe(1);
  expect(node(normal.sample('r',{angle:{x:90,y:0}}))).toBe(1);
  expect(shapes.counters).toBe(normal.counters);expect(normal.counters.validation).toBe(1);
  expect(node(shapes.sample('r',{angle:{x:90,y:0}}))).toBe(0);
 });
 it('does not leak the first wrapper angle or draft/shape policy into later implicit requests',()=>{
  const {workspace}=fixture(),options={immutableInputs:true,diagnostics:'preview' as const};
  evaluateRecordingSnapshot(workspace,'r',{...options,angle:{x:90,y:0},useDraft:false,omitShapes:true});
  const implicit=evaluateRecordingSnapshot(workspace,'r',options);expect(implicit.angle).toEqual({x:0,y:0});expect(node(implicit)).toBe(0);
  expect(node(evaluateRecordingSnapshot(workspace,'r',{...options,angle:{x:90,y:0}}))).toBe(1);
 });
 it('prepares controls from a cold context without constructing terminal paint',()=>{
  const {workspace}=fixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,diagnostics:'preview'});
  const controls=context.sample('r',{angle:{x:45,y:0},products:'controls'});expect(node(controls)).toBe(.5);expect(controls.paintBatches).toEqual([]);expect(context.counters.ownGeometry).toBe(2);expect(context.counters.paint).toBe(0);expect(context.counters.material).toBe(0);
  const before=context.counters.surfaceSample,display=context.sample('r',{angle:{x:45,y:0}});expect(display.paintBatches.length).toBeGreaterThan(0);expect(context.counters.surfaceSample).toBe(before);expect(context.counters.paint).toBe(1);
 });
 it('preserves a supplied temporary side-angle draft policy while the recording cursor remains at zero',()=>{
  const {workspace,recording}=fixture(),options={immutableInputs:true,useDraft:true,diagnostics:'preview'} as const;
  const saved=resolveRecordingSnapshotBasis(workspace,recording,'side',options),live=resolveRecordingSnapshotBasis(workspace,{...recording,angle:{x:90,y:0}},'side',options);
  expect(node(saved)).toBe(1);expect(node(live)).toBe(2);expect(node(resolveRecordingSnapshotBasis(workspace,recording,'side',options))).toBe(1);expect(recording.angle).toEqual({x:0,y:0});
 });
 it('shares validated dependency preparation across response forks and rebuilds it for structural changes',()=>{
  const {workspace,recording}=fixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,diagnostics:'preview'});context.sample('r',{angle:{x:45,y:0}});
  const graph=recording.angleGraph!,edge=graph.mesh.edges[0],response={...workspace,recordings:[{...recording,angleGraph:{...graph,edgeResponses:{[edge.id]:{nodes:{a:{x:[[.5,.6] as [number,number]]}},handles:{}}}}}]},fork=context.fork(response);fork.sample('r',{angle:{x:45,y:0}});
  expect(fork.counters.validation).toBe(0);expect(fork.counters.dependencyIndex).toBe(0);expect(fork.counters.ownGeometry).toBe(0);
  const structural={...workspace,snapshots:workspace.snapshots.map(snapshot=>snapshot.id==='side'?{...snapshot,layers:snapshot.layers.map(layer=>({...layer,membership:{excludeElementIds:['c']}}))}:snapshot)},changed=context.fork(structural);changed.sample('r',{angle:{x:45,y:0}});
  expect(changed.counters.validation).toBe(1);expect(changed.counters.dependencyIndex).toBe(1);
  expect(()=>context.fork({...workspace,snapshots:workspace.snapshots.map(snapshot=>snapshot.id==='side'?{...snapshot,parentSnapshotId:'side'}:snapshot)})).toThrow(/cycle/);
 });
 it('invalidates a retained material source signature outside geometric ancestry',()=>{
  const {workspace}=fixture(),external=emptyRecordingSnapshot('external','External','drawing');external.layers=[{kind:'original',id:'external-layer',name:'External',items:['external-curve'],visible:true,locked:false}];
  workspace.library.nodes.externalA={id:'externalA',position:[0,0]};workspace.library.nodes.externalB={id:'externalB',position:[1,1]};workspace.library.curves['external-curve']={...workspace.library.curves.c,id:'external-curve',nodes:['externalA','externalB']};workspace.snapshots.push(external);
  const zero=workspace.snapshots[0];zero.relations.displayIntervals={add:[{id:'interval',anchor:{id:'c',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.2,end:.7}]}]};
  zero.deformation.intervalMaterialIssues={interval:{sourceSnapshotId:external.id,sourceSignature:drawingSignature(materializeOriginalSnapshot(workspace,external.id)!),message:'Source material is unavailable.'}};
  const context=prepareRecordingContext(workspace,{immutableInputs:true,diagnostics:'preview'}),before=context.sample('r');expect(before.drawing.displayIntervals).toHaveLength(1);
  const changed={...workspace,library:{...workspace.library,nodes:{...workspace.library.nodes,externalA:{...workspace.library.nodes.externalA,position:[.3,.2] as [number,number]}}}},next=context.fork(changed).sample('r'),cold=evaluateRecordingSnapshot(structuredClone(changed),'r',{diagnostics:'preview'});
  expect(next.drawing.displayIntervals).toHaveLength(0);expect(next.drawing).toEqual(cold.drawing);
 });
 it('retains the exact sampled draft and product policy independently of the factory handle',()=>{
  const {workspace}=fixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,useDraft:true,omitShapes:true,diagnostics:'preview'}),sample=context.sample('r',{angle:{x:45,y:0},useDraft:false,omitShapes:false,products:'controls'});
  expect(preparedRecordingOptionsForEvaluation(sample)).toMatchObject({angle:{x:45,y:0},useDraft:false,omitShapes:false,products:'controls',immutableInputs:true,diagnostics:'preview'});
  const options=preparedRecordingOptionsForEvaluation(sample)!;options.angle!.x=12;expect(preparedRecordingOptionsForEvaluation(sample)!.angle!.x).toBe(45);
 });
});
