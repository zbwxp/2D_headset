import {afterEach,describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {createCurve,deleteCurves,moveNode} from '../../domain/drawing/commands';
import {applyCurveSplitIntent,createCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareRecordingContext} from '../../domain/recordingSnapshot/preparedRecordingContext';
import {canonicalElementId,drawingSnapshotForArtwork,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';

const options={immutableInputs:true,useDraft:true,diagnostics:'preview'} as const;
const at=(x:number)=>({x,y:0});
const id=(raw:string)=>canonicalElementId('$working',raw);
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
const drawing=():DrawingDocument=>({...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,1]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.25,.5],[.75,.5]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}]});
function fixture() {
 const original=drawing();let workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'$working',original);
 workspace=upsertDrawingSource(workspace,'unrelated',drawing());
 const source=drawingSnapshotForArtwork(workspace,'$working')!,unrelated=drawingSnapshotForArtwork(workspace,'unrelated')!;
 const zero=emptyRecordingSnapshot('zero','Zero'),side=emptyRecordingSnapshot('side','Side','view',at(90)),child=emptyRecordingSnapshot('child','Child','view',at(45));
 for(const view of [zero,side])view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:id('layer')}];
 side.deformation.layers.slot={shape:{nodes:{[id('a')]:[1,.5],[id('b')]:[.5,1]},handles:{[id('curve')]:[[.2,.1],[-.1,.2]]}}};
 child.parentSnapshotId=side.id;child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:side.id,baseLayerId:'slot'}];child.deformation.layers['child-slot']={placement:{translation:[.2,-.1],scale:1,rotation:0}};
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=['zero','side'];recording.activeSnapshotId='zero';recording.angle=at(60);recording.angleGraph=createSnapshotAngleGraph([zero,side].map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots.push(zero,side,child);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {original,workspace,source,unrelated,zero,side,child,recording,project:{...createEmptyProject(),drawing:original,recordingSnapshots:workspace}};
}
function expectColdEquivalent(actual:SnapshotEvaluation,workspace:RecordingSnapshotWorkspace,useDraft=true) {
 const cold=evaluateRecordingSnapshot(structuredClone(workspace),'recording',{angle:actual.angle,useDraft,diagnostics:'preview'});
 expect(actual.drawing).toEqual(cold.drawing);expect(actual.angleSurface?.outsideCurves).toEqual(cold.angleSurface?.outsideCurves);
}
function curvesAt(context:ReturnType<typeof prepareRecordingContext>,x:number){return context.sample('recording',{angle:at(x)});}
const originalStore=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.getState().endEdit();useEditor.setState(originalStore,true);useWorkspaceMode.setState({mode:originalMode});vi.useRealTimers();});

describe('prepared Recording dependency invalidation',()=>{
 it('does not flush reachable controls or structural coverage after an unrelated source update',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),child=context.resolveSnapshot('child');
  const unrelated=moveNode(f.original,'a',[17,-4],true),next=freeze(upsertDrawingSource(f.workspace,'unrelated',unrelated)),fork=context.fork(next),actual=fork.sample('recording');
  expect(actual.drawing).toBe(before.drawing);expect(fork.resolveSnapshot('child')).toBe(child);
  expect(fork.counters.ownGeometry).toBe(0);expect(fork.counters.basis).toBe(0);expect(fork.counters.coverageStructure).toBe(0);
  expectColdEquivalent(actual,next);
 });

 it('invalidates a numeric source dependency and its descendants while retaining the membership plan',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options);context.sample('recording');const child=context.resolveSnapshot('child'),unrelated=context.resolveSnapshot(f.unrelated.id);
  const changed=moveNode(f.original,'a',[.2,-.1],true),next=freeze(upsertDrawingSource(f.workspace,'$working',changed)),fork=context.fork(next),actual=fork.sample('recording');
  expect(fork.resolveSnapshot('child').drawing).not.toEqual(child.drawing);expect(fork.resolveSnapshot(f.unrelated.id)).toBe(unrelated);
  expect(fork.counters.bySnapshot[f.unrelated.id]?.ownGeometry??0).toBe(0);expect(fork.counters.coverageStructure).toBe(0);
  for(const dirty of [f.source.id,'zero','side','child'])expect(fork.counters.bySnapshot[dirty]?.ownGeometry).toBe(1);
  expectColdEquivalent(actual,next);
 });

 it('propagates a live source addition to descendants and rebuilds structural coverage once',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options);context.sample('recording');context.resolveSnapshot('child');
  const changed=createCurve(f.original,'layer',[[0,2],[.2,2],[.8,2],[1,2]],.01,'New source','new'),next=freeze(upsertDrawingSource(f.workspace,'$working',changed)),fork=context.fork(next);
  for(const x of [0,30,90])expect(curvesAt(fork,x).drawing.curves.map(curve=>curve.id).sort()).toEqual([id('curve'),id('new')].sort());
  expect(fork.resolveSnapshot('child').drawing.curves.map(curve=>curve.id).sort()).toEqual([id('curve'),id('new')].sort());
  expect(fork.counters.coverageStructure).toBeLessThanOrEqual(1);expectColdEquivalent(curvesAt(fork,30),next);
 });

 it('rebuilds red coverage and actual descendants when one view excludes a source member',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),zero=context.resolveBasis('recording','zero');context.resolveSnapshot('child');
  const side={...f.side,layers:f.side.layers.map(layer=>({...layer,membership:{excludeElementIds:[id('curve')]}}))},next=freeze({...f.workspace,snapshots:f.workspace.snapshots.map(snapshot=>snapshot.id==='side'?side:snapshot)}),fork=context.fork(next),actual=fork.sample('recording');
  expect(before.drawing.curves).toHaveLength(1);expect(actual.drawing.curves).toHaveLength(0);
  expect(actual.angleSurface!.outsideCurves).toEqual([expect.objectContaining({curveId:id('curve'),evaluatedAngle:at(0),readonly:true})]);
  expect(fork.resolveSnapshot('child').drawing.curves).toHaveLength(0);expect(fork.resolveBasis('recording','zero')).toBe(zero);
  expect(fork.counters.coverageStructure).toBeLessThanOrEqual(1);expect(fork.counters.bySnapshot.zero?.ownGeometry??0).toBe(0);expectColdEquivalent(actual,next);
 });

 it('retires deleted source members from both normal controls and cached red previews',()=>{
  const f=fixture();f.side.layers[0]={...f.side.layers[0],membership:{excludeElementIds:[id('curve')]}};freeze(f);
  const context=prepareRecordingContext(f.workspace,options),before=context.sample('recording');expect(before.angleSurface!.outsideCurves).toHaveLength(1);
  const next=freeze(upsertDrawingSource(f.workspace,'$working',deleteCurves(f.original,['curve']))),fork=context.fork(next),actual=fork.sample('recording');
  expect(actual.drawing.curves).toHaveLength(0);expect(actual.angleSurface!.outsideCurves).toHaveLength(0);expect(fork.resolveSnapshot('child').drawing.curves).toHaveLength(0);
  expect(fork.counters.coverageStructure).toBeLessThanOrEqual(1);expectColdEquivalent(actual,next);
 });

 it('rebuilds coverage after source split and preserves the same de Casteljau controls in every descendant',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),angles=[0,35,90],before=angles.map(x=>curvesAt(context,x)),child=context.resolveSnapshot('child');
  let serial=0;const split=createCurveSplitIntent(f.original,'curve',.37,{allocateId:()=>`split-${++serial}`}),canonical=mapCurveSplitIntent(split,id),edit=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.original,split).document,intent:split});
  const fork=context.fork(edit.project.recordingSnapshots!);
  for(const [index,x] of angles.entries()){
   const expected=applyCurveSplitIntent(before[index].drawing,canonical,{propagate:true}).document,actual=curvesAt(fork,x);
   expect(actual.drawing.curves.map(curve=>curve.id)).toEqual(canonical.childCurveIds);
   for(const curveId of canonical.childCurveIds)for(const [i,point] of shapeOf(expected,curveId).entries())for(const axis of [0,1])expect(shapeOf(actual.drawing,curveId)[i][axis]).toBeCloseTo(point[axis],8);
   expect(actual.angleSurface!.outsideCurves).toHaveLength(0);expectColdEquivalent(actual,edit.project.recordingSnapshots!);
  }
  const expectedChild=applyCurveSplitIntent(child.drawing,canonical,{propagate:true}).document,actualChild=fork.resolveSnapshot('child').drawing;
  for(const curveId of canonical.childCurveIds)for(const [i,point] of shapeOf(expectedChild,curveId).entries())for(const axis of [0,1])expect(shapeOf(actualChild,curveId)[i][axis]).toBeCloseTo(point[axis],8);
  expect(fork.counters.coverageStructure).toBeLessThanOrEqual(1);
 });

 it('keeps saved/live and active-basis draft masks separate when the cursor revisits history',()=>{
  const f=fixture();f.side.draft={angle:at(90),channels:[],deformation:{...f.side.deformation,layers:{slot:{shape:{nodes:{[id('a')]:[2,1]},handles:{}}}}}};f.recording.angle=at(0);freeze(f);
  const context=prepareRecordingContext(f.workspace,options),inactive=curvesAt(context,60),saved=context.sample('recording',{angle:at(60),useDraft:false});expect(inactive.drawing).toEqual(saved.drawing);
  const next=freeze({...f.workspace,recordings:[{...f.recording,angle:at(90)}]}),fork=context.fork(next),live=curvesAt(fork,60);
  expect(live.drawing.nodes.find(node=>node.id===id('a'))!.position).not.toEqual(saved.drawing.nodes.find(node=>node.id===id('a'))!.position);
  expect(fork.sample('recording',{angle:at(60),useDraft:false}).drawing).toEqual(saved.drawing);expect(curvesAt(context,60).drawing).toBe(inactive.drawing);
  expectColdEquivalent(live,next);expectColdEquivalent(saved,f.workspace,false);
 });

 it('restores historical project and basis identity across Save, Discard, Undo, and Redo',()=>{
  vi.useFakeTimers();const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),zero=context.resolveBasis('recording','zero');
  const node=before.drawing.nodes.find(value=>value.id===id('a'))!,target=moveNode(before.drawing,id('a'),[node.position[0]+.07,node.position[1]-.03],true),edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:target,intent:{kind:'geometry'}});
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(edit);
  const draft=useEditor.getState().project,draftContext=context.fork(draft.recordingSnapshots!),draftValue=draftContext.sample('recording');expect(draftValue.drawing.nodes).toEqual(target.nodes);expect(draftContext.resolveBasis('recording','zero')).toBe(zero);
  const discarded=prepareSnapshotBatch(draft,{commands:[{op:'discardEndpointCorrection'}]}).recordingSnapshots,discardedContext=draftContext.fork(discarded);expect(discardedContext.sample('recording').drawing).toEqual(before.drawing);expect(discardedContext.resolveBasis('recording','zero')).toBe(zero);
  const saved=prepareSnapshotBatch(draft,{commands:[{op:'updateEndpointCorrection'}]}).recordingSnapshots,savedContext=draftContext.fork(saved);expect(savedContext.sample('recording',{useDraft:false}).drawing.nodes).toEqual(target.nodes);expect(savedContext.resolveBasis('recording','zero')).toBe(zero);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.project);expect(prepareRecordingContext(f.workspace,options)).toBe(context);expect(context.sample('recording')).toBe(before);
  useEditor.getState().redo();expect(useEditor.getState().project).toBe(draft);expect(prepareRecordingContext(draft.recordingSnapshots!,options)).toBe(draftContext);expect(draftContext.sample('recording')).toBe(draftValue);
 });

 it('never trusts external JSON identity after in-place library, response, or membership mutation',()=>{
  const f=fixture(),workspace=parseRecordingSnapshots(JSON.parse(JSON.stringify(f.workspace))),first=evaluateRecordingSnapshot(workspace,'recording',{angle:at(60),diagnostics:'preview'}),nodeId=id('a');
  workspace.library.nodes[nodeId].position=[.4,-.2];
  const moved=evaluateRecordingSnapshot(workspace,'recording',{angle:at(60),diagnostics:'preview'});expect(moved.drawing.nodes).not.toEqual(first.drawing.nodes);expectColdEquivalent(moved,workspace);
  const graph=workspace.recordings[0].angleGraph!,edge=graph.mesh.edges[0],start=graph.mesh.vertices.find(vertex=>vertex.id===edge.vertexIds[0])!.snapshotId;
  graph.edgeResponses[edge.id]={nodes:{[nodeId]:{x:[[start==='zero'?2/3:1/3,.1]]}},handles:{}};
  const response=evaluateRecordingSnapshot(workspace,'recording',{angle:at(60),diagnostics:'preview'});expect(response.drawing.nodes).not.toEqual(moved.drawing.nodes);expectColdEquivalent(response,workspace);
  workspace.snapshots.find(snapshot=>snapshot.id==='side')!.layers[0].membership={excludeElementIds:[id('curve')]};
  const excluded=evaluateRecordingSnapshot(workspace,'recording',{angle:at(60),diagnostics:'preview'});expect(excluded.drawing.curves).toHaveLength(0);expect(excluded.angleSurface!.outsideCurves).toHaveLength(1);expectColdEquivalent(excluded,workspace);
 });

 it('cancels preview state and rejects a stale commit without changing history or allowing a timer commit',()=>{
  vi.useFakeTimers();const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),node=before.drawing.nodes.find(value=>value.id===id('a'))!,target=moveNode(before.drawing,id('a'),[node.position[0]+.08,node.position[1]-.04],true);
  const edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:target,intent:{kind:'geometry'}});
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(edit);useEditor.getState().undo();
  const cancelled=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:target,intent:{kind:'geometry'}});
  const state=useEditor.getState();state.beginEdit(true);state.setRecordingSnapshots(cancelled.project.recordingSnapshots!);state.cancelEdit();vi.runAllTimers();
  expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toBe(state.past);expect(useEditor.getState().future).toBe(state.future);expect(context.sample('recording')).toBe(before);
  expect(()=>useEditor.getState().commitPreparedSnapshotEdit(cancelled)).toThrow(/cancel|stale|supersed/i);vi.runAllTimers();expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().future).toBe(state.future);
  useEditor.getState().redo();const after=useEditor.getState();expect(()=>after.commitPreparedSnapshotEdit(edit)).toThrow(/stale/i);vi.runAllTimers();
  expect(useEditor.getState().project).toBe(after.project);expect(useEditor.getState().past).toBe(after.past);expect(useEditor.getState().future).toBe(after.future);
 });
});
