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
 it('preserves a supplied temporary side-angle draft policy while the recording cursor remains at zero',()=>{
  const {workspace,recording}=fixture(),options={immutableInputs:true,useDraft:true,diagnostics:'preview'} as const;
  const saved=resolveRecordingSnapshotBasis(workspace,recording,'side',options),live=resolveRecordingSnapshotBasis(workspace,{...recording,angle:{x:90,y:0}},'side',options);
  expect(node(saved)).toBe(1);expect(node(live)).toBe(2);expect(node(resolveRecordingSnapshotBasis(workspace,recording,'side',options))).toBe(1);expect(recording.angle).toEqual({x:0,y:0});
 });
 it('retains the exact sampled draft and product policy independently of the factory handle',()=>{
  const {workspace}=fixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,useDraft:true,omitShapes:true,diagnostics:'preview'}),sample=context.sample('r',{angle:{x:45,y:0},useDraft:false,omitShapes:false,products:'controls'});
  expect(preparedRecordingOptionsForEvaluation(sample)).toMatchObject({angle:{x:45,y:0},useDraft:false,omitShapes:false,products:'controls',immutableInputs:true,diagnostics:'preview'});
  const options=preparedRecordingOptionsForEvaluation(sample)!;options.angle!.x=12;expect(preparedRecordingOptionsForEvaluation(sample)!.angle!.x).toBe(45);
 });
});
