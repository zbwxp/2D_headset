import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {prepareDrawingControlEditPlan,applyDrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
import {createLayerAffineIntent,type LayerAffineDomainIntent} from '../../domain/drawing/layerDomainIntent';
import {applyAffine2D,composeAffine2D,type Affine2D} from '../../domain/geometry/affine2d';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {snapshotStrokeTransformFrame} from '../../domain/recordingSnapshot/strokeTransformFrame';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';
import {applyScenePlacement,placementMatrix,scenePlacementScales} from '../../domain/recordingScene/tracks';
import {beginInstanceTransform,instanceTransformDelta,instanceAxisScaleValue,instanceCornerScaleValue,applyInstanceDisplayFrame} from '../../ui/vectorRecording/SceneInstanceTransformBox';
import {snapshotLayerSelectionTransform} from '../../ui/vectorRecording/snapshotLayerTransform';
import {snapshotStrokeSelectionTransform} from '../../ui/vectorRecording/SnapshotRecordingWorkspace';
import {previewGestureTarget,takeGestureTarget,type GesturePreviewTarget} from '../../ui/drawing/gestureTransaction';

const previousEditor=useEditor.getState(),previousMode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(previousEditor,true);useWorkspaceMode.getState().setMode(previousMode);vi.useRealTimers();});
const id=(raw:string)=>canonicalElementId('source',raw),layerIds=['slot-a','slot-b'];
const near=(actual:Point2,wanted:Point2)=>actual.forEach((value,index)=>expect(value).toBeCloseTo(wanted[index],8));
const evaluate=(project:LandmarkProject)=>evaluateRecordingSnapshot(project.recordingSnapshots!,'recording',{useDraft:true,immutableInputs:true,diagnostics:'preview'});

function fixture():LandmarkProject {
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a0',position:[0,0]},{id:'a1',position:[1,1]},{id:'b0',position:[2,.3]},{id:'b1',position:[3,1.6]}],curves:[
  {id:'curve-a',name:'A',nodes:['a0','a1'],handles:[[.2,.4],[.7,.9]],width:.02,visible:true,locked:false},
  {id:'curve-b',name:'B',nodes:['b0','b1'],handles:[[2.3,.8],[2.7,1.3]],width:.02,visible:true,locked:false},
 ],layers:[{id:'layer-a',name:'A',items:['curve-a'],visible:true,locked:false},{id:'layer-b',name:'B',items:['curve-b'],visible:true,locked:false}]};
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:60,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=layerIds.map((layerId,index)=>({kind:'reference' as const,id:layerId,name:index?'B':'A',baseSnapshotId:source.id,baseLayerId:id(index?'layer-b':'layer-a')}));
 view.deformation.layers['slot-a']={placement:{translation:[.15,-.1],rotation:27,scale:1,scaleX:1.4,scaleY:.7}};
 view.deformation.layers['slot-b']={placement:{translation:[-.2,.3],rotation:-16,scale:.9}};
 side.layers=structuredClone(view.layers);side.deformation=structuredClone(view.deformation);
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),drawing,recordingSnapshots:workspace};
}

function domainPlan(project:LandmarkProject,intent:LayerAffineDomainIntent,validation:'preview'|'full'='full') {
 return prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'recording-layer-domain',recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},intent,validation});
}
function harness(project:LandmarkProject,selected=layerIds) {
 let preview:LandmarkProject|null=null,committed=project;
 const domainPreviews:LayerAffineDomainIntent[]=[],domainCommits:LayerAffineDomainIntent[]=[],commandCommits:SnapshotCommand[][]=[],before=evaluate(project);
 const adapter=snapshotLayerSelectionTransform(before,before,selected,true,
  commands=>{preview=commands?{...project,recordingSnapshots:prepareSnapshotPreview(project,{recordingId:'recording',commands}).recordingSnapshots}:null;},
  commands=>{commandCommits.push(commands);committed={...project,recordingSnapshots:prepareSnapshotBatch(project,{recordingId:'recording',commands}).recordingSnapshots};},
  intent=>{if(!intent){preview=null;return true;}domainPreviews.push(intent);preview=domainPlan(project,intent,'preview').project;return true;},
  intent=>{domainCommits.push(intent);committed=domainPlan(project,intent).project;},
 )!;
 return {adapter,before,domainPreviews,domainCommits,commandCommits,preview:()=>preview,project:()=>committed};
}
function expectMapped(before:DrawingDocument,after:DrawingDocument,map:(point:Point2)=>Point2) {
 expect(after.curves.map(curve=>curve.id)).toEqual(before.curves.map(curve=>curve.id));
 for(const curve of before.curves)shapeOf(after,curve.id).forEach((point,index)=>near(point,map(shapeOf(before,curve.id)[index])));
}
function cornerDelta(h:ReturnType<typeof harness>,shift=false) {
 const {min:origin,max:start}=h.adapter.bounds,point:Point2=[origin[0]+1.8*(start[0]-origin[0]),origin[1]+.6*(start[1]-origin[1])];
 return instanceTransformDelta(beginInstanceTransform('scale',start,origin),point,shift);
}

test.each([false,true])('real multilayer corner scale uses Drawing ratios and Shift=%s while preserving source ownership',shift=>{
 const project=fixture(),serialized=JSON.stringify(project),library=JSON.stringify(project.recordingSnapshots!.library),source=JSON.stringify(project.recordingSnapshots!.snapshots[0]),h=harness(project),delta=cornerDelta(h,shift);
 expect(scenePlacementScales(delta)[0]).toBeCloseTo(1.8,10);expect(scenePlacementScales(delta)[1]).toBeCloseTo(shift?1.8:.6,10);
 h.adapter.onPreview(delta);expectMapped(h.before.drawing,evaluate(h.preview()!).drawing,point=>applyScenePlacement(delta,point));
 expect(JSON.stringify(project)).toBe(serialized);h.adapter.onCommit(delta);
 expectMapped(h.before.drawing,evaluate(h.project()).drawing,point=>applyScenePlacement(delta,point));
 expect(JSON.stringify(h.project().recordingSnapshots!.library)).toBe(library);expect(JSON.stringify(h.project().recordingSnapshots!.snapshots[0])).toBe(source);expect(h.project().drawing).toBe(project.drawing);
 expect(h.domainCommits).toHaveLength(shift?0:1);expect(h.commandCommits).toHaveLength(shift?1:0);
 if(!shift)expect(h.domainCommits[0].operationId).toBe(h.domainPreviews[0].operationId);
});

test('a world move after multilayer anisotropy appends after the domain and preserves the exact requested delta',()=>{
 const project=fixture(),first=harness(project);first.adapter.onCommit(cornerDelta(first));const scaled=first.project(),next=harness(scaled),delta={...identityScenePlacement(),translation:[.37,-.23] as Point2};
 next.adapter.onPreview(delta);next.adapter.onCommit(delta);
 expect(next.domainCommits).toHaveLength(1);expect(next.commandCommits).toEqual([]);expect(evaluate(next.project()).state.layerDomains).toHaveLength(2);
 expectMapped(next.before.drawing,evaluate(next.preview()!).drawing,point=>applyScenePlacement(delta,point));expectMapped(next.before.drawing,evaluate(next.project()).drawing,point=>applyScenePlacement(delta,point));
 expect(evaluate(next.project()).placements).toEqual(next.before.placements);
});

test('a locked member rejects the shared affine preview and commit without partial state',()=>{
 const project=fixture();project.recordingSnapshots!.library.curves[id('curve-b')].locked=true;const before=JSON.stringify(project),h=harness(project),delta=cornerDelta(h);
 expect(()=>h.adapter.onPreview(delta)).toThrow(/Unlock/);expect(()=>h.adapter.onCommit(delta)).toThrow(/Unlock/);expect(h.preview()).toBeNull();expect(h.project()).toBe(project);expect(JSON.stringify(project)).toBe(before);
});

test.each(['layer','stroke'] as const)('%s preview adapters propagate rejection for deltas and absolute native values',kind=>{
 const project=fixture(),evaluation=evaluate(project),delta={...identityScenePlacement(),translation:[.1,.2] as Point2};let accepts=true;
 const preview=vi.fn((commands:SnapshotCommand[]|null)=>commands===null||accepts),commit=vi.fn();
 const adapter=kind==='layer'?snapshotLayerSelectionTransform(evaluation,evaluation,['slot-a'],true,preview,commit,()=>true,()=>{}):snapshotStrokeSelectionTransform(evaluation,evaluation,[id('curve-a')],true,preview,commit);
 for(const publish of [adapter!.onPreview,adapter!.onValuePreview!]){
  const slot:GesturePreviewTarget<ScenePlacementValue>={};accepts=true;
  expect(previewGestureTarget(slot,()=>delta,publish)).toBe(true);expect(slot.target).toBe(delta);
  accepts=false;expect(previewGestureTarget(slot,()=>delta,publish)).toBe(false);expect(takeGestureTarget(slot)).toBeUndefined();expect(preview).toHaveBeenLastCalledWith(null);expect(publish(null)).toBe(true);
 }
 expect(commit).not.toHaveBeenCalled();
});

test('one multilayer affine gesture produces one global Undo and Redo transaction',()=>{
 vi.useFakeTimers();const project=fixture(),h=harness(project),delta=cornerDelta(h);h.adapter.onPreview(delta);h.adapter.onCommit(delta);const intent=h.domainCommits[0];
 useWorkspaceMode.getState().setMode('recording');useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(domainPlan(project,intent));vi.runAllTimers();
 const after=useEditor.getState().project;expect(useEditor.getState().past).toEqual([project]);expectMapped(h.before.drawing,evaluate(after).drawing,point=>applyScenePlacement(delta,point));
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});

test('a native stroke under a sheared display frame retains material through zero and restores its local width',()=>{
 const initial=fixture(),matrix:Affine2D=[1.2,.15,.45,.8,.2,-.1],project=domainPlan(initial,createLayerAffineIntent(['slot-a'],matrix)).project,curveId=id('curve-a'),zero:ScenePlacementValue={translation:[.2,.1],rotation:-19,scale:1,scaleX:0,scaleY:.7};
 const collapsed={...project,recordingSnapshots:prepareSnapshotBatch(project,{recordingId:'recording',commands:[{op:'setShapeElementPlacement',curveIds:[curveId],value:zero}]}).recordingSnapshots},before=evaluate(collapsed),frame=snapshotStrokeTransformFrame(before,[curveId])!,commits:SnapshotCommand[][]=[];
 const adapter=snapshotStrokeSelectionTransform(before,before,[curveId],true,()=>{},commands=>commits.push(commands))!;
 expect(frame.placement).toEqual(zero);expect(adapter.basePlacement).toEqual(zero);expect(Array.isArray(adapter.displayPlacement)).toBe(true);expect(frame.parentInvertible).toBe(true);
 const expected=composeAffine2D(matrix,placementMatrix(before.placements['slot-a']));expect(adapter.displayPlacement).toEqual(expected);
 for(const point of shapeOf(before.preElementPlacementDrawing,curveId))near(applyInstanceDisplayFrame(adapter.displayPlacement!,applyScenePlacement(zero,point)),applyAffine2D(expected,applyScenePlacement(zero,point)));
 const anchor=frame.materialBounds.min,start=applyScenePlacement(zero,frame.materialBounds.max),extent=frame.materialBounds.max[0]-anchor[0],angle=zero.rotation*Math.PI/180,point:Point2=[start[0]+extent*Math.cos(angle),start[1]+extent*Math.sin(angle)],restored=instanceAxisScaleValue({axis:'x',anchor,start,extent,placement:zero},point);
 expect(scenePlacementScales(restored)[0]).toBeCloseTo(1,10);expect(scenePlacementScales(restored)[1]).toBe(.7);near(applyScenePlacement(restored,anchor),applyScenePlacement(zero,anchor));adapter.onValueCommit!(restored);
 expect(commits[0]).toEqual([{op:'setShapeElementPlacement',curveIds:[curveId],value:restored}]);
 const after=evaluate({...collapsed,recordingSnapshots:prepareSnapshotBatch(collapsed,{recordingId:'recording',commands:commits[0]}).recordingSnapshots});shapeOf(after.drawing,curveId).forEach((value,index)=>near(value,applyAffine2D(expected,applyScenePlacement(restored,shapeOf(before.preElementPlacementDrawing,curveId)[index]))));
 expect(after.state.layerDomains).toEqual(before.state.layerDomains);expect(after.preElementPlacementDrawing).toEqual(before.preElementPlacementDrawing);
});

test('native corner scaling changes rotated local axes around the material anchor and Shift keeps their ratio',()=>{
 const placement:ScenePlacementValue={translation:[.3,-.2],rotation:37,scale:1,scaleX:1.7,scaleY:.6},anchor:Point2=[-.2,.1],material:Point2=[1.2,1.4],start=applyScenePlacement(placement,material),target=applyScenePlacement(placement,[anchor[0]+(material[0]-anchor[0])*1.5,anchor[1]+(material[1]-anchor[1])*.4]);
 for(const shift of [false,true]){const value=instanceCornerScaleValue({placement,anchor,start},target,shift);expect(value.rotation).toBe(placement.rotation);expect(scenePlacementScales(value)[0]).toBeCloseTo(1.7*1.5,10);expect(scenePlacementScales(value)[1]).toBeCloseTo(.6*(shift?1.5:.4),10);near(applyScenePlacement(value,anchor),applyScenePlacement(placement,anchor));}
});

test('intermediate stroke selection stays on grouped Drawing control targets without creating a persistent domain',()=>{
 const initial=fixture(),side=initial.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!;
 for(const layer of Object.values(side.deformation.layers))layer.placement!.translation[1]+=.4;
 const project={...initial,recordingSnapshots:prepareSnapshotBatch(initial,{recordingId:'recording',commands:[{op:'setAngle',angle:{x:30,y:0}}]}).recordingSnapshots},before=evaluate(project),ids=before.drawing.curves.map(curve=>curve.id),commands:SnapshotCommand[][]=[],adapter=snapshotStrokeSelectionTransform(before,before,ids,true,()=>{},value=>commands.push(value))!,delta={...identityScenePlacement(),translation:[0,.03] as Point2};
 expect(before.angleSurface?.role).toBe('correction');expect(adapter.basePlacement).toEqual(identityScenePlacement());expect(adapter.displayPlacement).toBeUndefined();adapter.onCommit(delta);expect(commands).toEqual([[{op:'transformShapeElements',curveIds:ids,value:delta}]]);
 const controlPlan=prepareDrawingControlEditPlan(before.drawing,{kind:'curves',curveIds:ids,preserveRelations:true}),wanted=applyDrawingControlEditPlan(controlPlan,{kind:'transform',value:delta}),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:{x:30,y:0},beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry',controlPlan}});
 expectMapped(before.drawing,evaluate(plan.project).drawing,point=>applyScenePlacement(delta,point));expect(plan.project.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
 for(const snapshot of plan.project.recordingSnapshots!.snapshots){expect(snapshot.deformation.layerDomains??[]).toEqual([]);expect(snapshot.draft?.deformation.layerDomains??[]).toEqual([]);}
});
