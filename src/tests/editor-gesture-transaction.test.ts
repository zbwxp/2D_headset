import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../domain/recordingSnapshot/triangulation';
import {interpolateSnapshotSimplexGeometry} from '../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceResponseSampler,prepareSnapshotSurfaceTargetEdit} from '../domain/recordingSnapshot/surfaceTargets';
import type {SnapshotAngleGraph} from '../domain/recordingSnapshot/model';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {prepareDrawingControlEditPlan,applyDrawingControlEditPlan} from '../ui/drawing/editGestures';
import {clearGestureTarget,previewGestureTarget,takeGestureTarget,cancelEditorGesture,runEditorHistory,consumeEditorHistoryShortcut,type GesturePreviewTarget} from '../ui/drawing/gestureTransaction';
import {currentPreparedEditRevision,assertPreparedEditCurrent} from '../app/preparedEditRevision';

function fixture(){
 let source=addLayer(emptyDrawing(),'Layer');source=createCurve(source,source.layers[0].id,[[0,0],[.2,.3],[.8,.3],[1,0]],.01,'Curve','curve');
 const allBases=['zero','side','pitch'].map((snapshotId,i)=>{const drawing=structuredClone(source);drawing.curves[0].handles=[[.2+i*.2,.3],[.8+i*.1,.3]];return {snapshotId,drawing};});
 const mesh=createSnapshotTriangulation([{snapshotId:'zero',angle:{x:0,y:0}},{snapshotId:'side',angle:{x:90,y:0}},{snapshotId:'pitch',angle:{x:0,y:90}}]);
 const graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}},angle={x:30,y:30},location=locateSnapshotSimplex(mesh,angle)!;
 const bases=location.snapshotIds.map(id=>allBases.find(b=>b.snapshotId===id)!);
 const current=interpolateSnapshotSimplexGeometry(bases,location.geometricWeights,createSnapshotSurfaceResponseSampler(graph,location)).drawing;
 const plan=prepareDrawingControlEditPlan(current,{kind:'handle',endpoint:{curveId:'curve',end:0}});
 return {allBases,bases,current,plan,graph,angle,location};
}

describe('one shared preview target transaction',()=>{
 it('normal release cleanup preserves a prepared receipt; actual cancellation invalidates it',()=>{
  const receipt={preparedRevision:currentPreparedEditRevision()},slot:GesturePreviewTarget<object>={target:receipt},accepted=takeGestureTarget(slot);
  clearGestureTarget(slot);cancelEditorGesture(false,()=>clearGestureTarget(slot));expect(()=>assertPreparedEditCurrent(accepted!)).not.toThrow();
  slot.target=receipt;cancelEditorGesture(true,()=>clearGestureTarget(slot));expect(takeGestureTarget(slot)).toBeUndefined();expect(()=>assertPreparedEditCurrent(receipt)).toThrow(/stale, canceled or superseded/);
 });
 it('a valid target followed by an unavailable inverse clears both display and commit target',()=>{
  const f=fixture(),original=JSON.stringify([f.graph,f.allBases]),slot:GesturePreviewTarget<DrawingDocument>={};let visible=f.current,accepted=0,rejected=0;
  const start=f.current.curves[0].handles[0];
  const publish=(target:DrawingDocument|null)=>{if(!target){visible=f.current;return true;}try{prepareSnapshotSurfaceTargetEdit(f.graph,f.location,f.bases,f.current,target,{angle:f.angle,frameId:'test'});visible=target;accepted++;return true;}catch{visible=f.current;rejected++;return false;}};
  expect(previewGestureTarget(slot,()=>applyDrawingControlEditPlan(f.plan,{kind:'point',position:[start[0]+.05,start[1]]}),publish)).toBe(true);
  expect(visible).not.toBe(f.current);expect(accepted).toBe(1);
  expect(previewGestureTarget(slot,()=>applyDrawingControlEditPlan(f.plan,{kind:'point',position:[start[0]+.05,start[1]+.1]}),publish)).toBe(false);
  expect(rejected).toBe(1);expect(visible).toBe(f.current);expect(takeGestureTarget(slot)).toBeUndefined();
  expect(JSON.stringify([f.graph,f.allBases])).toBe(original);
 });
 it('producer exceptions retire the previous target; a later valid sample still uses the frozen origin',()=>{
  const f=fixture(),slot:GesturePreviewTarget<DrawingDocument>={},start=f.current.curves[0].handles[0],before=JSON.stringify(f.current);let shown:DrawingDocument|null=null;
  const publish=(next:DrawingDocument|null)=>{shown=next;};
  const target=()=>applyDrawingControlEditPlan(f.plan,{kind:'point',position:[start[0]+.1,start[1]]});
  previewGestureTarget(slot,target,publish);
  expect(()=>previewGestureTarget(slot,()=>{throw Error('Rejected constraint');},publish)).toThrow('Rejected constraint');
  expect(shown).toBeNull();expect(takeGestureTarget(slot)).toBeUndefined();
  previewGestureTarget(slot,target,publish);const next=takeGestureTarget(slot)!;
  expect(next.curves[0].handles[0]).toEqual([start[0]+.1,start[1]]);expect(takeGestureTarget(slot)).toBeUndefined();expect(JSON.stringify(f.current)).toBe(before);
 });
 it('cancel and duplicate release cannot submit a target, including after a failed adapter',()=>{
  const slot:GesturePreviewTarget<object>={},target={value:1};const publish=vi.fn();
  previewGestureTarget(slot,()=>target,publish);clearGestureTarget(slot);expect(takeGestureTarget(slot)).toBeUndefined();
  previewGestureTarget(slot,()=>target,publish);const commit=vi.fn((_target:object)=>{throw Error('stale');});
  expect(()=>{const wanted=takeGestureTarget(slot);if(wanted)commit(wanted);}).toThrow('stale');
  expect(takeGestureTarget(slot)).toBeUndefined();expect(commit).toHaveBeenCalledTimes(1);
 });
});

function keyEvent(key:string,options:{ctrl?:boolean;meta?:boolean;shift?:boolean;composing?:boolean;prevented?:boolean}={}){
 const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,ctrlKey:options.ctrl??true,metaKey:options.meta??false,shiftKey:options.shift??false,isComposing:options.composing??false});
 if(options.prevented)event.preventDefault();return event as unknown as KeyboardEvent;
}
const prior=useEditor.getState(),priorMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{vi.useFakeTimers();const project=ensureRecordingSnapshots({...createEmptyProject(),drawing:emptyDrawing()});useEditor.setState({project,past:[],future:[],viewId:project.views[0].id});useWorkspaceMode.setState({mode:'drawing'});});
afterEach(()=>{useEditor.getState().endEdit();vi.runAllTimers();useEditor.setState(prior);useWorkspaceMode.setState({mode:priorMode});vi.useRealTimers();});

describe('shared canvas history dispatch',()=>{
 it.each(['drawing','recording'] as const)('%s cancels an active preview before consuming global history, once per key',mode=>{
  const before=useEditor.getState().project,store=useEditor.getState();store.beginEdit();store.setDrawing({...before.drawing!,mirrorAxisX:.3});store.endEdit();const committed=useEditor.getState().project;
  useWorkspaceMode.setState({mode});const slot:GesturePreviewTarget<DrawingDocument>={target:{...committed.drawing!,mirrorAxisX:.5}};let active=true;
  const run=(redo:boolean)=>runEditorHistory(redo,{activeGesture:active,pendingAnchor:false,cancelGesture:()=>{active=false;clearGestureTarget(slot);},cancelAnchor:()=>{},undo:store.undo,redo:store.redo});
  const event=keyEvent('z');expect(consumeEditorHistoryShortcut(event,run)).toBe(true);
  // The App fallback must not consume the canvas-owned key a second time.
  expect(consumeEditorHistoryShortcut(event,redo=>redo?store.redo():store.undo())).toBe(false);
  expect(useEditor.getState().project).toBe(committed);expect(useEditor.getState().past).toHaveLength(1);expect(takeGestureTarget(slot)).toBeUndefined();
  consumeEditorHistoryShortcut(keyEvent('z'),run);expect(useEditor.getState().project).toBe(before);expect(useWorkspaceMode.getState().mode).toBe('drawing');
  consumeEditorHistoryShortcut(keyEvent('y'),run);expect(useEditor.getState().project).toBe(committed);expect(useEditor.getState().past).toHaveLength(1);
 });
 it.each([{key:'y',shift:false,redo:true},{key:'z',shift:true,redo:true},{key:'z',shift:false,redo:false}])('recognizes Ctrl/Cmd $key shift=$shift once',({key,shift,redo})=>{
  for(const options of [{ctrl:true,meta:false},{ctrl:false,meta:true}]){const run=vi.fn(),event=keyEvent(key,{...options,shift});expect(consumeEditorHistoryShortcut(event,run)).toBe(true);expect(run).toHaveBeenCalledExactlyOnceWith(redo);expect(event.defaultPrevented).toBe(true);expect(consumeEditorHistoryShortcut(event,run)).toBe(false);}
 });
 it('leaves composing, already consumed and ordinary keys to their owner',()=>{
  const run=vi.fn();for(const event of [keyEvent('z',{composing:true}),keyEvent('z',{prevented:true}),keyEvent('z',{ctrl:false}),keyEvent('a')])expect(consumeEditorHistoryShortcut(event,run)).toBe(false);expect(run).not.toHaveBeenCalled();
 });
 it('an unsaved first pen anchor consumes Undo locally while Redo still uses history',()=>{
  const actions={activeGesture:false,pendingAnchor:true,cancelGesture:vi.fn(),cancelAnchor:vi.fn(),undo:vi.fn(),redo:vi.fn()};
  expect(runEditorHistory(false,actions)).toBe('cancel-anchor');expect(actions.cancelAnchor).toHaveBeenCalledTimes(1);expect(actions.undo).not.toHaveBeenCalled();expect(runEditorHistory(true,actions)).toBe('history');expect(actions.redo).toHaveBeenCalledTimes(1);
 });
});
