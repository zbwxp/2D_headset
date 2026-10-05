import {afterEach,describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {createDrawingPathMaterialFrame} from '../../domain/drawing/pathMaterialSupport';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {snapshotIntervalMaterialSource} from '../../domain/recordingSnapshot/routeMaterialSource';
import {beginDrawingIntervalGesture,updateDrawingIntervalGesture} from '../../ui/drawing/intervalGesture';
import {prepareSnapshotDrawingPropertyEdit,type SnapshotDrawingPropertyEdit} from '../../ui/vectorRecording/snapshotDrawingPropertyEdit';

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.setState({mode});});
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
}
function fixture(x=30):LandmarkProject {
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 workspace.library.curves={line:{id:'line',name:'Line',nodes:['a','b'],handles:[[1/3,0],[2/3,0]],width:.01,visible:true,locked:false}};
 const snapshots=[emptyRecordingSnapshot('front','Front','view',{x:0,y:0}),emptyRecordingSnapshot('side','Side','view',{x:90,y:0})];
 for(const [index,snapshot] of snapshots.entries()){
  snapshot.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['line']}];
  snapshot.relations.displayIntervals={add:[{id:'interval',anchor:{id:'line',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.3,end:index?.9:.3}]}]};
 }
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=snapshots.map(snapshot=>snapshot.id);recording.activeSnapshotId='front';recording.angle={x,y:0};recording.angleGraph=createSnapshotAngleGraph(snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 workspace.snapshots=snapshots;workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
const evaluate=(project:LandmarkProject,x=project.recordingSnapshots!.recordings[0].angle.x,useDraft=true)=>evaluateRecordingSnapshot(project.recordingSnapshots!,'recording',{angle:{x,y:0},useDraft,immutableInputs:true});
const range=(drawing:DrawingDocument)=>drawing.displayIntervals![0].ranges[0];
const geometry=(drawing:DrawingDocument)=>({nodes:drawing.nodes,curves:drawing.curves,layers:drawing.layers,joins:drawing.joins,endpointLinks:drawing.endpointLinks});
const reload=(project:LandmarkProject)=>({...project,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(project.recordingSnapshots)))});

/** Generate the same pointer target as both canvases, then cross Recording's
 * actual property boundary. Interval edits never take a raw command shortcut. */
function drag(drawing:DrawingDocument,end:0|1,to:number) {
 const track=drawing.displayIntervals![0],interval=track.ranges[0],from=end?interval.end:interval.start,field=displayField(drawing,displayPath(drawing,track.anchor.id)),point=(value:number):Point2=>field.at(field.native(track,value)).p;
 let gesture=beginDrawingIntervalGesture(drawing,track.id,interval.id,end,point(from),.001),target=drawing;
 for(let step=1;step<=24;step++){const next=updateDrawingIntervalGesture(gesture,point(from+(to-from)*step/24));gesture=next.gesture;target=next.drawing;}
 return {gesture,drawing:target};
}
function prepareDrag(project:LandmarkProject,end:0|1,to:number,validation:'preview'|'full'='full') {
 const before=evaluate(project),target=drag(before.drawing,end,to),recording=project.recordingSnapshots!.recordings[0],edit:SnapshotDrawingPropertyEdit={recordingId:recording.id,snapshotId:before.snapshotId,angle:recording.angle,beforeDrawing:before.drawing,drawing:target.drawing,validation};
 return {before,target,edit,plan:prepareSnapshotDrawingPropertyEdit(project,edit)};
}

describe('shared canvas interval targets in Recording',()=>{
 it('keeps saved real-key intervals separate from successive active drafts and saves the same pointer target',()=>{
  const project=freeze(fixture(0)),bytes=JSON.stringify(project),first=prepareDrag(project,1,.55),draft=first.plan.project;
  expect(first.target.gesture.base).toBe(first.before.drawing);expect(first.target.gesture.selection).toEqual({ids:['line'],displayInterval:{track:'interval',range:'gap',end:1}});
  expect(range(evaluate(draft).drawing).end).toBeCloseTo(.55,12);expect(range(evaluate(draft,0,false).drawing).end).toBeCloseTo(.3,12);
  const view=draft.recordingSnapshots!.snapshots[0];expect(view.deformation).toEqual(project.recordingSnapshots!.snapshots[0].deformation);expect(view.draft!.deformation.layers.layer.intervals!.interval.appearance!.ranges[0].end).toBeCloseTo(.55,12);
  const saved=freeze(prepareSnapshotBatch(draft,{commands:[{op:'updateSnapshot',snapshotId:'front'}]}).preparedPlan.project);
  expect(saved.recordingSnapshots!.snapshots[0].draft).toBeUndefined();expect(range(evaluate(saved,0,false).drawing).end).toBeCloseTo(.55,12);
  const second=prepareDrag(saved,1,.7),active=second.plan.project,third=prepareDrag(active,1,.65).plan.project;
  expect(range(evaluate(third).drawing).end).toBeCloseTo(.65,12);expect(range(evaluate(third,0,false).drawing).end).toBeCloseTo(.55,12);
  expect(third.recordingSnapshots!.snapshots[0].deformation).toEqual(saved.recordingSnapshots!.snapshots[0].deformation);
  const restored=reload(third);expect(range(evaluate(restored).drawing).end).toBeCloseTo(.65,12);expect(range(evaluate(restored,0,false).drawing).end).toBeCloseTo(.55,12);
  const discarded=prepareSnapshotBatch(third,{commands:[{op:'discardSelected',layerIds:['layer']}]}).preparedPlan.project;
  expect(range(evaluate(discarded).drawing).end).toBeCloseTo(.55,12);expect(discarded.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
  for(const x of [0,30,90])expect(geometry(evaluate(third,x).drawing)).toEqual(geometry(evaluate(project,x).drawing));
  expect(third.recordingSnapshots!.recordings[0].tracks).toEqual([]);expect(third.recordingSnapshots!.recordings[0].angleGraph).toEqual(project.recordingSnapshots!.recordings[0].angleGraph);expect(JSON.stringify(project)).toBe(bytes);
 });

 it('collapses the correction interval through 30 degrees with independent material response, Save, JSON and one-step Undo',()=>{
  const project=freeze(fixture()),bytes=JSON.stringify(project),samples=[0,15,30,45,90],originalGeometry=samples.map(x=>geometry(evaluate(project,x).drawing)),preview=prepareDrag(project,1,.3,'preview'),strict=prepareSnapshotDrawingPropertyEdit(project,{...preview.edit,validation:'full'}),draft=strict.project;
  expect(evaluate(project).angleSurface?.role).toBe('correction');expect(range(preview.target.drawing).end).toBeCloseTo(.3,12);
  expect(evaluate(preview.plan.project).drawing).toEqual(evaluate(draft).drawing);expect(range(evaluate(draft,30,false).drawing).end).toBeCloseTo(.5,12);
  for(const x of [0,15,30]){const interval=range(evaluate(draft,x).drawing);expect(interval.end).toBe(interval.start);}
  expect(range(evaluate(draft,45).drawing).end).toBeCloseTo(.45,12);expect(range(evaluate(draft,90).drawing).end).toBeCloseTo(.9,12);
  const graph=draft.recordingSnapshots!.recordings[0].angleGraph!,originalGraph=project.recordingSnapshots!.recordings[0].angleGraph!;
  expect(graph.mesh).toEqual(originalGraph.mesh);expect(graph.mesh.vertices).toHaveLength(2);expect(graph.edgeResponses).toEqual(originalGraph.edgeResponses);expect(graph.triangleResponses).toEqual(originalGraph.triangleResponses);
  expect(graph.correctionFrames).toHaveLength(1);expect(graph.correctionFrames![0].status).toBe('draft');expect(graph.correctionFrames![0].basisAdjustment).toBeUndefined();expect(graph.correctionFrames![0].propertyResponses).toBeDefined();
  expect(draft.recordingSnapshots!.library).toBe(project.recordingSnapshots!.library);expect(draft.recordingSnapshots!.snapshots).toBe(project.recordingSnapshots!.snapshots);expect(draft.recordingSnapshots!.recordings[0].tracks).toEqual([]);
  expect(samples.map(x=>geometry(evaluate(draft,x).drawing))).toEqual(originalGeometry);
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(strict);
  expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);expect(range(evaluate(useEditor.getState().project).drawing).end).toBeCloseTo(.5,12);useEditor.getState().redo();expect(useEditor.getState().project).toBe(draft);
  const save=prepareSnapshotBatch(draft,{commands:[{op:'updateEndpointCorrection'}]}).preparedPlan;useEditor.getState().commitPreparedSnapshotEdit(save);const saved=useEditor.getState().project;
  expect(saved.recordingSnapshots!.recordings[0].angleGraph!.correctionFrames![0].status).toBe('saved');expect(range(evaluate(saved,30,false).drawing).end).toBeCloseTo(.3,12);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(draft);expect(range(evaluate(draft,30,false).drawing).end).toBeCloseTo(.5,12);useEditor.getState().redo();expect(useEditor.getState().project).toBe(saved);
  const loaded=reload(saved);expect(loaded.recordingSnapshots).toEqual(saved.recordingSnapshots);for(const x of samples)expect(evaluate(loaded,x,false).drawing).toEqual(evaluate(saved,x,false).drawing);
  expect(samples.map(x=>geometry(evaluate(loaded,x,false).drawing))).toEqual(originalGeometry);expect(JSON.stringify(project)).toBe(bytes);
 });

 it('rejects an unavailable endpoint after a legal preview without mutating the accepted response or accepting a stale base',()=>{
  const project=freeze(fixture()),legal=prepareDrag(project,1,.3,'preview'),accepted=freeze(legal.plan.project),bytes=JSON.stringify(accepted),before=evaluate(accepted),invalid=drag(before.drawing,0,.2),recording=accepted.recordingSnapshots!.recordings[0];
  expect(range(invalid.drawing).start).toBeCloseTo(.2,12);
  const edit={recordingId:recording.id,snapshotId:before.snapshotId,angle:recording.angle,beforeDrawing:before.drawing,drawing:invalid.drawing};
  for(const validation of ['preview','full'] as const)expect(()=>prepareSnapshotDrawingPropertyEdit(accepted,{...edit,validation})).toThrow(/equal|unavailable|indistinguishable|constant/i);
  expect(()=>prepareSnapshotDrawingPropertyEdit(accepted,legal.edit)).toThrow(/changed during this property edit/i);
  expect(JSON.stringify(accepted)).toBe(bytes);expect(range(evaluate(accepted).drawing).end).toBe(range(evaluate(accepted).drawing).start);expect(range(evaluate(accepted,30,false).drawing).end).toBeCloseTo(.5,12);
 });

 it('inverse-maps a dragged cross-layer ARC grip through the retained material frame and saves only its owning layer',()=>{
  // The cross-layer route ARC shape is the retained-material regression fixture.
  const project=fixture(0),workspace=project.recordingSnapshots!;
  workspace.library.curves.line.handles=[[.2,.4],[.8,-.2]];
  workspace.library.nodes.c={id:'c',position:[1,0]};workspace.library.nodes.d={id:'d',position:[1,1]};workspace.library.curves.next={id:'next',name:'Next',nodes:['c','d'],handles:[[1.2,.2],[.8,.8]],width:.01,visible:true,locked:false};
  for(const snapshot of workspace.snapshots){
   snapshot.layers.push({kind:'original',id:'linked',name:'Linked',items:['next'],visible:true,locked:false});
   snapshot.relations.endpointLinks={add:[{id:'link',a:{curveId:'line',end:1},b:{curveId:'next',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.15}}]};
   snapshot.relations.displayIntervals={add:[{id:'interval',anchor:{id:'line',reverse:false},displayRoute:{seed:{segments:[{id:'line',reverse:false}],closed:false},throughLinkIds:['link']},ranges:[{id:'gap',mode:'HIDE',start:.13,end:.83}]}]};
   snapshot.deformation.layers={linked:{shape:{nodes:{d:[.5,.3]},handles:{}}}};
  }
  freeze(project);const bytes=JSON.stringify(project),before=evaluate(project),track=before.drawing.displayIntervals![0],frame=createDrawingPathMaterialFrame(before.drawing,track),support={kind:'join' as const,joinId:'display-join:link',linkId:'link',s:.55},target=frame.positionOf(support),edited=prepareDrag(project,1,target),next=edited.plan.project,actual=evaluate(next),stored=next.recordingSnapshots!.snapshots[0].draft!.deformation.layers.layer.intervals!.interval.appearance!,source=snapshotIntervalMaterialSource(before,track.id),sourceFrame=createDrawingPathMaterialFrame(source,stored);
  const wanted=range(edited.target.drawing).end,wantedSupport=frame.materialAt(wanted);expect(wanted).toBeCloseTo(target,6);expect(wantedSupport).toMatchObject({kind:'join',linkId:'link',s:expect.closeTo(.55,5)});expect(range(actual.drawing).end).toBeCloseTo(wanted,7);expect(Math.abs(stored.ranges[0].end-wanted)).toBeGreaterThan(.001);
  if(wantedSupport.kind!=='join')throw Error('The pointer target must lie on the cross-layer ARC.');
  const matchingSupport={...wantedSupport,s:expect.closeTo(wantedSupport.s,12)};
  expect(sourceFrame.materialAt(stored.ranges[0].end)).toMatchObject(matchingSupport);
  expect(createDrawingPathMaterialFrame(actual.drawing,actual.drawing.displayIntervals![0]).materialAt(range(actual.drawing).end)).toMatchObject(matchingSupport);
  expect(actual.diagnostics.filter(issue=>issue.code==='SOURCE_MATERIAL')).toEqual([]);expect(geometry(actual.drawing)).toEqual(geometry(before.drawing));expect(next.recordingSnapshots!.snapshots[0].draft!.deformation.layers.linked).toBeUndefined();
  const saved=prepareSnapshotBatch(next,{commands:[{op:'saveSelected',layerIds:['layer']}]}).preparedPlan.project,loaded=reload(saved);
  expect(range(evaluate(loaded,0,false).drawing).end).toBeCloseTo(wanted,7);expect(loaded.recordingSnapshots!.snapshots[0].deformation.layers.linked).toEqual(workspace.snapshots[0].deformation.layers.linked);expect(loaded.recordingSnapshots!.library).toEqual(workspace.library);expect(loaded.recordingSnapshots!.snapshots[1]).toEqual(workspace.snapshots[1]);expect(loaded.recordingSnapshots!.recordings[0].angleGraph).toEqual(workspace.recordings[0].angleGraph);expect(JSON.stringify(project)).toBe(bytes);
 });
});
