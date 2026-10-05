import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {prepareSnapshotDrawingPropertyEdit} from '../ui/vectorRecording/snapshotDrawingPropertyEdit';
import {createEmptyProject} from '../app/emptyProject';
import {composePreparedSnapshotEdits,finalizePreparedSnapshotEdit,prepareSnapshotEdit,snapshotEditContext} from '../app/snapshotEditTransaction';
import {invalidatePreparedEdits} from '../app/preparedEditRevision';
import {prepareSnapshotDrawingToolEdit} from '../app/snapshotDrawingToolEdit';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareDrawingSnapshotEdit} from '../app/drawingSnapshotEdit';
import {currentDrawingPresentation} from '../app/drawingSnapshotPresentation';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan,drawingControlEditStats,drawingControlEditProof} from '../domain/drawing/controlEditPlan';
import {prepareDrawingSnapshotControlTarget} from '../app/drawingSnapshotControlTarget';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {moveHandle} from '../domain/drawing/commands';
import {createSnapshotAngleGraph} from '../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {canonicalElementId,drawingSnapshotForArtwork,remapDrawingIdentities,upsertDrawingSource} from '../domain/recordingSnapshot/sources';
import {getSnapshotSurfaceTargetWorkStats} from '../domain/recordingSnapshot/surfaceTargets';
import * as persistence from '../domain/recordingSnapshot/persistence';

const initial=useEditor.getState(),initialMode=useWorkspaceMode.getState().mode;
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.restoreAllMocks();useEditor.setState(initial,true);useWorkspaceMode.setState({mode:initialMode});vi.useRealTimers();});
function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace(),snapshot=emptyRecordingSnapshot('front'),recording=emptySnapshotRecording('recording');
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]}};
 workspace.library.curves={curve:{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false}};
 snapshot.layers=[{kind:'original',id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}];
 recording.mode='triangulated';recording.snapshotIds=[snapshot.id];recording.activeSnapshotId=snapshot.id;recording.angleGraph=createSnapshotAngleGraph([{snapshotId:snapshot.id,angle:snapshot.angle}]);
 workspace.snapshots=[snapshot];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
function rename(project:ReturnType<typeof fixture>,name='Changed',validation:'full'|'preview'='full'){
 return prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:{...project.recordingSnapshots,snapshots:project.recordingSnapshots.snapshots.map(snapshot=>({...snapshot,name}))},validation});
}
it('rejects fabricated, serialized and core-modified receipts, but accepts metadata extensions',()=>{
 const project=fixture(),plan=rename(project);useEditor.setState({project,past:[],future:[]});
 for(const fake of [{before:plan.before,project:plan.project,changed:true,preparedRevision:plan.preparedRevision},JSON.parse(JSON.stringify(plan)),{...plan,before:{...project}},{...plan,project:{...plan.project}},{...plan,changed:false},{...plan,preparedRevision:plan.preparedRevision!+1}]){
  expect(()=>useEditor.getState().commitPreparedSnapshotEdit(fake)).toThrow(/receipt/);expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().project).toBe(project);
 }
 const extended={...plan,description:'adapter metadata'};expect(finalizePreparedSnapshotEdit(extended,project).description).toBe('adapter metadata');
 useEditor.getState().commitPreparedSnapshotEdit(extended);expect(useEditor.getState().past).toEqual([project]);expect(useEditor.getState().project).toBe(plan.project);
 expect(()=>{plan.project.recordingSnapshots!.snapshots[0].name='tampered';}).toThrow();
});
it('requires the exact current project and rejects cancellation, including Undo/Redo restoring the same project',()=>{
 const project=fixture(),plan=rename(project);expect(()=>finalizePreparedSnapshotEdit(plan,{...project})).toThrow(/stale/);
 useEditor.setState({project,past:[],future:[]});useEditor.getState().cancelEdit();expect(()=>useEditor.getState().commitPreparedSnapshotEdit(plan)).toThrow(/canceled|stale/);
 const accepted=rename(project),late=rename(project,'Late');useWorkspaceMode.setState({mode:'drawing'});useEditor.getState().commitPreparedSnapshotEdit(accepted);useWorkspaceMode.setState({mode:'recording'});useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);expect(()=>useEditor.getState().commitPreparedSnapshotEdit(late)).toThrow(/canceled|stale/);
 const whileUndone=rename(project,'While undone');useEditor.getState().redo();expect(useEditor.getState().project).toBe(accepted.project);useEditor.getState().undo();expect(()=>useEditor.getState().commitPreparedSnapshotEdit(whileUndone)).toThrow(/canceled|stale/);
});
it('upgrades one accepted control preview once without rerunning authoring or target solving',()=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true,immutableInputs:true,diagnostics:'preview'}).drawing,controlPlan=prepareDrawingControlEditPlan(before,{kind:'node',nodeId:'a'}),drawing=applyDrawingControlEditPlan(controlPlan,{kind:'point',position:[.1,.2]}),parse=vi.spyOn(persistence,'parseRecordingSnapshots');
 const accepted=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'recording',snapshotId:'front',angle:{x:0,y:0},beforeDrawing:before,drawing,intent:{kind:'geometry',controlPlan},validation:'preview'}),stats=drawingControlEditStats();
 expect(parse).not.toHaveBeenCalled();const full=finalizePreparedSnapshotEdit(accepted,project);expect(parse).toHaveBeenCalledTimes(1);expect(finalizePreparedSnapshotEdit({...accepted,note:'second'},project).project).toBe(full.project);expect(parse).toHaveBeenCalledTimes(1);expect(drawingControlEditStats()).toEqual(stats);
 useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(accepted);expect(parse).toHaveBeenCalledTimes(1);expect(drawingControlEditStats()).toEqual(stats);expect(useEditor.getState().past).toEqual([project]);expect(useEditor.getState().project).toBe(full.project);
});
it('does not parse an already fully validated plan again at commit',()=>{
 const project=fixture(),parse=vi.spyOn(persistence,'parseRecordingSnapshots'),plan=rename(project);expect(parse).toHaveBeenCalledTimes(1);useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(parse).toHaveBeenCalledTimes(1);
});
it('keeps schema normalizer output when upgrading preview',()=>{
 const project=fixture(),workspace={...project.recordingSnapshots,recordings:project.recordingSnapshots.recordings.map(recording=>({...recording,interpolationWeights:{retired:true}}))},plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace,validation:'preview'});
 expect(plan.project.recordingSnapshots!.recordings[0]).toHaveProperty('interpolationWeights');const full=finalizePreparedSnapshotEdit(plan,project);expect(full.project.recordingSnapshots!.recordings[0]).not.toHaveProperty('interpolationWeights');expect(full.project).not.toBe(plan.project);useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().project).toBe(full.project);
});
it('rejects invalid preview schema before opening history or changing the store',()=>{
 const project=fixture(),plan=rename(project,'','preview');useEditor.setState({project,past:[],future:[]});expect(()=>useEditor.getState().commitPreparedSnapshotEdit(plan)).toThrow(/Invalid recording snapshot JSON/);expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().future).toEqual([]);
});
it('runs a builder once against frozen input and rejects cancellation during construction',()=>{
 const project=fixture(),build=vi.fn((workspace:RecordingSnapshotWorkspace)=>({...workspace,snapshots:workspace.snapshots.map(snapshot=>({...snapshot,name:'Built'}))})),plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-build',build,validation:'preview'});expect(build).toHaveBeenCalledTimes(1);expect(build.mock.calls[0][0]).toBe(project.recordingSnapshots);expect(Object.isFrozen(project.recordingSnapshots.snapshots)).toBe(true);finalizePreparedSnapshotEdit(plan,project);expect(build).toHaveBeenCalledTimes(1);
 expect(()=>prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-build',build:workspace=>{invalidatePreparedEdits();return workspace;}})).toThrow(/canceled/);
});
it('composes genuine contiguous source and local edits atomically, rejecting arbitrary steps',()=>{
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Source',nodes:['a','b'],handles:[[.3,0],[.7,0]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}]};
 const project={...createEmptyProject(),drawing,recordingSnapshots:upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'$working',drawing)},source=prepareDrawingSnapshotEdit(project,moveHandle(currentDrawingPresentation(project),{curveId:'curve',end:0},[.3,.2])),workspace=source.project.recordingSnapshots!,owner=drawingSnapshotForArtwork(workspace,'$working')!,local=prepareSnapshotEdit(snapshotEditContext(source.project,true),{kind:'object-locks',snapshotId:owner.id,changes:{[canonicalElementId('$working','curve')]:true}}),plan=composePreparedSnapshotEdits(project,[source,local]);
 expect(()=>composePreparedSnapshotEdits(project,[local])).toThrow(/sequence/);expect(()=>composePreparedSnapshotEdits(project,[{before:project,project:local.project,changed:true}])).toThrow(/receipt/);
 useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);expect(useEditor.getState().project.drawing!.curves[0].handles[0]).toEqual([.3,.2]);expect(useEditor.getState().project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id===owner.id)!.objectLocks).toEqual({[canonicalElementId('$working','curve')]:true});useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);
});
it('makes empty composition and unchanged workspace genuine no-ops',()=>{
 const project=fixture(),empty=composePreparedSnapshotEdits(project,[]),same=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:project.recordingSnapshots});useEditor.setState({project,past:[],future:[]});for(const plan of [empty,same]){expect(plan.changed).toBe(false);useEditor.getState().commitPreparedSnapshotEdit(plan);}expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().project).toBe(project);
});
it('maps authentic Drawing control plans through canonical identities without trusting a copied descriptor',()=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true}).drawing,plan=prepareDrawingControlEditPlan(before,{kind:'node',nodeId:'a'}),wanted=applyDrawingControlEditPlan(plan,{kind:'point',position:[.1,.2]}),id=(value:string)=>`canonical:${value}`,canonicalBefore=remapDrawingIdentities(before,id),canonicalWanted=remapDrawingIdentities(wanted,id),mapped=prepareDrawingSnapshotControlTarget(before,wanted,canonicalBefore,canonicalWanted,id,plan)!;
 expect(mapped.drawing).toEqual(canonicalWanted);expect(drawingControlEditProof(canonicalBefore,mapped.drawing,mapped.controlPlan)).toBe(mapped.controlPlan);expect(prepareDrawingSnapshotControlTarget(before,wanted,canonicalBefore,canonicalWanted,id,{...plan})).toBeUndefined();expect(prepareDrawingSnapshotControlTarget(before,{...wanted},canonicalBefore,canonicalWanted,id,plan)).toBeUndefined();
});

it('routes interval property plans through the authentic full gate and one Undo',()=>{
 const project=fixture();project.recordingSnapshots.snapshots[0].relations.displayIntervals={add:[{id:'interval',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.1,end:.9}]}]};
 const beforeDrawing=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true}).drawing,drawing={...beforeDrawing,displayIntervals:beforeDrawing.displayIntervals!.map(track=>({...track,ranges:track.ranges.map(range=>({...range,enabled:false}))}))},parse=vi.spyOn(persistence,'parseRecordingSnapshots'),plan=prepareSnapshotDrawingPropertyEdit(project,{recordingId:'recording',snapshotId:'front',angle:{x:0,y:0},beforeDrawing,drawing});
 expect(parse).toHaveBeenCalledTimes(1);expect(finalizePreparedSnapshotEdit(plan,project)).toBe(plan);useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(parse).toHaveBeenCalledTimes(1);expect(useEditor.getState().past).toEqual([project]);expect(evaluateRecordingSnapshot(useEditor.getState().project.recordingSnapshots!,'recording',{useDraft:true}).drawing.displayIntervals![0].ranges[0].enabled).toBe(false);
});
it('default JSON Snapshot host commits the prepared plan once and rejects request-supplied receipts',()=>{
 const project=fixture();useEditor.setState({project,past:[],future:[]});useWorkspaceMode.setState({mode:'recording'});const api=createVectorEditingApi(),parse=vi.spyOn(persistence,'parseRecordingSnapshots'),result=api.snapshot({commands:[{op:'setTolerance',pixels:3}]});
 expect(result.ok).toBe(true);expect(useEditor.getState().past).toEqual([project]);expect(parse).toHaveBeenCalledTimes(1);const after=useEditor.getState().project,bad=api.snapshot({commands:[],preparedPlan:{before:after,project:after,changed:false}} as never);expect(bad.ok).toBe(false);expect(useEditor.getState().project).toBe(after);expect(useEditor.getState().past).toEqual([project]);
});
it('source normalization survives preparation and malformed source schema creates no history',()=>{
 const drawing={...emptyDrawing(),version:2,layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:true}],nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,0],[.7,0]],width:.01,visible:true,locked:false}]} as unknown as DrawingDocument,project=createEmptyProject(),plan=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing});
 expect(plan.project.drawing!.version).toBe(3);expect(plan.project.drawing!.layers[0].locked).toBe(false);expect(plan.project.drawing!.curves[0].locked).toBe(true);useEditor.setState({project,past:[],future:[]});expect(()=>prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:{...drawing,curves:drawing.curves.map(curve=>({...curve,width:-1}))}})).toThrow();expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().project).toBe(project);
});

it('commits the accepted correction preview without a second inverse solve',()=>{
 const project=fixture(),workspace=project.recordingSnapshots,front=workspace.snapshots[0],side={...structuredClone(front),id:'side',angle:{x:90,y:0}},up={...structuredClone(front),id:'up',angle:{x:0,y:90}};
 side.deformation.layers.layer={shape:{nodes:{a:[1,0],b:[1,0]},handles:{}}};up.deformation.layers.layer={shape:{nodes:{a:[0,1],b:[0,1]},handles:{}}};workspace.snapshots=[front,side,up];const recording=workspace.recordings[0];recording.snapshotIds=workspace.snapshots.map(snapshot=>snapshot.id);recording.angle={x:20,y:20};recording.angleGraph=createSnapshotAngleGraph(workspace.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 const evaluation=evaluateRecordingSnapshot(workspace,recording.id,{useDraft:true,immutableInputs:true,diagnostics:'preview'}),controlPlan=prepareDrawingControlEditPlan(evaluation.drawing,{kind:'node',nodeId:'a'}),drawing=applyDrawingControlEditPlan(controlPlan,{kind:'point',position:[.3,.3]}),before=getSnapshotSurfaceTargetWorkStats(),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:recording.id,snapshotId:evaluation.snapshotId,angle:recording.angle,beforeDrawing:evaluation.drawing,drawing,intent:{kind:'geometry',controlPlan},validation:'preview'}),solved=getSnapshotSurfaceTargetWorkStats();expect(solved.nodeSolves).toBeGreaterThan(before.nodeSolves);
 useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(getSnapshotSurfaceTargetWorkStats()).toEqual(solved);expect(useEditor.getState().past).toEqual([project]);
});
