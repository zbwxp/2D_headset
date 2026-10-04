import {expect,test} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareRecordingTemporaryCageEdit} from '../../app/recordingTemporaryCageEdit';
import {snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {applyLayerDomainIntent,createLayerCageIntent} from '../../domain/drawing/layerDomainIntent';
import {shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {rectQuad,type DeformRect} from '../../domain/drawing/deform';
import {neutralBend} from '../../domain/deformation/coons';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {beginDrawingCageGesture,drawingCageSelectionIssue,resolveDrawingCage,updateDrawingCageGesture,type CageControl} from '../../ui/drawing/cageEditorController';
import {chooseDrawingSelection} from '../../ui/drawing/interactionController';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

const at=(x:number)=>({x,y:0});
function fixture(persistentCages=true){
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]},c:{id:'c',position:[2,2]},d:{id:'d',position:[3,.5]},e:{id:'e',position:[4,1.5]}};
 workspace.library.curves={first:{id:'first',name:'First',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false},second:{id:'second',name:'Second',nodes:['b','c'],handles:[[1.3,1.4],[1.7,1.8]],width:.01,visible:true,locked:false},other:{id:'other',name:'Other',nodes:['d','e'],handles:[[3.3,.8],[3.7,1.2]],width:.01,visible:true,locked:false}};
 const views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',at(90))],restRect:DeformRect={min:[-1,-1],max:[5,3]};
 for(const [index,view] of views.entries()){
  view.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['first','second','other']}];
  if(persistentCages){const bend=neutralBend();bend.handles[1][0][0]+=.03*(index+1);view.deformation.layerDomains=[{kind:'h-coons',id:`basis-cage-${index}`,layerIds:['layer'],restRect,quad:rectQuad(restRect).map(([x,y]):Point2=>index?[2*x+2,3*y+3]:[x+.1,y+.2]) as [Point2,Point2,Point2,Point2],bend}];}
  else if(index)view.deformation.layers.layer={shape:{nodes:{a:[2,3],b:[3,4],c:[4,5],d:[5,6],e:[6,7]},handles:{first:[[.2,.3],[-.3,-.4]],second:[[.3,.4],[-.3,-.2]],other:[[.3,.3],[-.3,-.3]]}}};
 }
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=views.map(view=>view.id);recording.activeSnapshotId='front';recording.angle=at(60);recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));workspace.snapshots=views;workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
const near=(actual:DrawingDocument,wanted:DrawingDocument)=>{for(const curve of wanted.curves)shapeOf(actual,curve.id).forEach((point,index)=>point.forEach((value,axis)=>expect(value).toBeCloseTo(shapeOf(wanted,curve.id)[index][axis],7)));};
function gesture(project:ReturnType<typeof fixture>,control:CageControl={corner:2},delta:Point2=[.08,.06]){
 const before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true,immutableInputs:true}),selection={ids:before.drawing.curves.map(curve=>curve.id),layer:'layer'},cage=resolveDrawingCage(before.drawing,selection,{domains:[]})!;
 const start:Point2='corner' in control?cage.quad[control.corner]:[(cage.rect.min[0]+cage.rect.max[0])/2,(cage.rect.min[1]+cage.rect.max[1])/2];
 const changed=updateDrawingCageGesture(beginDrawingCageGesture(cage,selection,control,start,'temporary-cage'),[start[0]+delta[0],start[1]+delta[1]]);
 expect(changed.intent).not.toBeNull();expect(changed.intent!.replace).toBeUndefined();
 return {before,cage,intent:changed.intent!,wanted:applyLayerDomainIntent(before.drawing,changed.intent!).document};
}

test.each([{corner:2},{edge:1,handle:0}] as CageControl[])('60° temporary cage %j stores only grouped responses and preserves both persistent bases',control=>{
 const project=fixture(),original=JSON.stringify(project),g=gesture(project,control),edit={recordingId:'recording',snapshotId:g.before.snapshotId,angle:at(60),beforeDrawing:g.before.drawing,intent:g.intent};
 const preview=prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{...edit,validation:'preview'}),plan=prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),edit),workspace=plan.project.recordingSnapshots!;
 near(evaluateRecordingSnapshot(preview.project.recordingSnapshots!,'recording',{useDraft:true}).drawing,g.wanted);near(evaluateRecordingSnapshot(workspace,'recording',{useDraft:true}).drawing,g.wanted);
 expect(JSON.stringify(project)).toBe(original);expect(workspace.snapshots).toEqual(project.recordingSnapshots.snapshots);expect(workspace.library).toEqual(project.recordingSnapshots.library);expect(workspace.recordings[0].snapshotIds).toEqual(['front','side']);expect(workspace.recordings[0].tracks).toEqual(project.recordingSnapshots.recordings[0].tracks);
 const frame=workspace.recordings[0].angleGraph!.correctionFrames![0];expect(frame).toMatchObject({status:'draft',angle:at(60)});expect(frame.edgeResponses).toBeDefined();expect(JSON.stringify(frame)).not.toMatch(/temporary-cage|layerDomains|h-coons|restRect|quad|"drawing"/);
 for(const angle of [0,90])near(evaluateRecordingSnapshot(workspace,'recording',{angle:at(angle),useDraft:true}).drawing,evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{angle:at(angle),useDraft:true}).drawing);
 const saved=prepareSnapshotBatch(plan.project,{recordingId:'recording',commands:[{op:'updateEndpointCorrection'}]}).recordingSnapshots,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(saved))),current=evaluateRecordingSnapshot(loaded,'recording',{useDraft:true}),onions=interpolateSnapshotSurfaceOnion(loaded.recordings[0],current,{startSnapshotId:'front',endSnapshotId:'side'},5);
 near(current.drawing,g.wanted);expect(loaded.snapshots).toEqual(project.recordingSnapshots.snapshots);expect(loaded.recordings[0].angleGraph!.correctionFrames![0].status).toBe('saved');
 for(const frame of onions.frames)near(frame.drawing!,evaluateRecordingSnapshot(loaded,'recording',{angle:frame.angle,useDraft:true}).drawing);
 const reopened=resolveDrawingCage(current.drawing,{ids:current.drawing.curves.map(curve=>curve.id),layer:'layer'},{domains:[]})!;expect(reopened.domainOperationId).toBeUndefined();expect(reopened.quad).toEqual(rectQuad(reopened.rect));
});

test('a late unavailable cage coordinate rejects the complete edit and leaves no response draft',()=>{
 const project=fixture(false);project.recordingSnapshots.snapshots[1].deformation.layers.layer.shape!.nodes.e[0]=0;
 const before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true}),restRect:DeformRect={min:[-1,-1],max:[9,9]},intent=createLayerCageIntent(['layer'],{kind:'h-coons',restRect,quad:rectQuad(restRect).map(([x,y]):Point2=>[x+.1,y+.1]) as [Point2,Point2,Point2,Point2]},{operationId:'rejected'}),saved=JSON.stringify(project);
 for(const validation of ['preview','full'] as const)expect(()=>prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:at(60),beforeDrawing:before.drawing,intent,validation})).toThrow(/Node e X/);
 expect(JSON.stringify(project)).toBe(saved);expect(project.recordingSnapshots.recordings[0].angleGraph!.correctionFrames).toBeUndefined();
});

test('a whole continuous stroke can use a temporary cage without moving other strokes in the same layer',()=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true}),selection={ids:['first','second']},cage=resolveDrawingCage(before.drawing,selection,{domains:[]})!,start=cage.quad[2],intent=updateDrawingCageGesture(beginDrawingCageGesture(cage,selection,{corner:2},start,'stroke-target'),[start[0]+.1,start[1]-.06]).intent!;
 expect(drawingCageSelectionIssue(before.drawing,selection)).toBeUndefined();expect(drawingCageSelectionIssue(before.drawing,{ids:['first']})).toMatch(/complete continuous strokes/);
 expect(chooseDrawingSelection('deform',selection,'select',{deformRequiresLayers:!!drawingCageSelectionIssue(before.drawing,selection)}).tool).toBe('deform');
 expect(intent.domain.strokeScope).toEqual({kind:'continuous-strokes',curveIds:['first','second']});
 const wanted=applyLayerDomainIntent(before.drawing,intent).document,plan=prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:at(60),beforeDrawing:before.drawing,intent}),after=evaluateRecordingSnapshot(plan.project.recordingSnapshots!,'recording',{useDraft:true}).drawing;
 near(after,wanted);expect(shapeOf(after,'other')).toEqual(shapeOf(before.drawing,'other'));expect(shapeOf(after,'first')).not.toEqual(shapeOf(before.drawing,'first'));expect(plan.project.recordingSnapshots!.snapshots).toEqual(project.recordingSnapshots.snapshots);
});

test('temporary cages reject saved-cage replacement, real bases and stale gestures',()=>{
 const project=fixture(),g=gesture(project),edit={recordingId:'recording',snapshotId:g.before.snapshotId,angle:at(60),beforeDrawing:g.before.drawing,intent:g.intent};
 expect(()=>prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{...edit,intent:{...g.intent,replace:true}})).toThrow(/cannot replace a saved cage/);
 expect(()=>prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{...edit,angle:at(0)})).toThrow(/requires an intermediate angle/);
 const next=prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),edit).project;expect(()=>prepareRecordingTemporaryCageEdit(snapshotEditContext(next,false),edit)).toThrow(/changed during this Drawing gesture/);
 const navigated={...project,recordingSnapshots:{...project.recordingSnapshots,recordings:project.recordingSnapshots.recordings.map(recording=>({...recording,angle:at(30)}))}};expect(()=>prepareRecordingTemporaryCageEdit(snapshotEditContext(navigated,false),edit)).toThrow(/cursor changed/);
});
