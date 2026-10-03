import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph,reconcileSnapshotAngleGraphMesh} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {removeSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';

function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 workspace.library.curves={line:{id:'line',name:'Line',nodes:['a','b'],handles:[[1/3,0],[2/3,0]],width:.01,visible:true,locked:false}};
 const snapshots=[emptyRecordingSnapshot('front','Front','view',{x:0,y:0}),emptyRecordingSnapshot('side','Side','view',{x:90,y:0})];
 for(const [index,snapshot] of snapshots.entries()){
  snapshot.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['line']}];
  snapshot.relations.displayIntervals={add:[{id:'interval',anchor:{id:'line',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.3,end:index?.9:.3}]}]};
 }
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=snapshots.map(s=>s.id);recording.activeSnapshotId='front';recording.angle={x:30,y:0};recording.angleGraph=createSnapshotAngleGraph(snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));
 workspace.snapshots=snapshots;workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:workspace};
 const apply=(...commands:SnapshotCommand[])=>{const before=project,plan=prepareSnapshotBatch(project,{commands});project={...project,recordingSnapshots:plan.recordingSnapshots};return before;};
 const evaluate=(x:number,useDraft=true)=>evaluateRecordingSnapshot(project.recordingSnapshots!,'recording',{angle:{x,y:0},useDraft,immutableInputs:true});
 return {apply,evaluate,project:()=>project,set:(next:LandmarkProject)=>{project=next;},workspace:()=>project.recordingSnapshots!};
}
const interval=(h:ReturnType<typeof fixture>,x:number,useDraft=true)=>h.evaluate(x,useDraft).drawing.displayIntervals![0].ranges[0];
const edit:SnapshotCommand={op:'changeInterval',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:.3};

describe('Recorder interval responses use independent material coordinates',()=>{
 it('holds a true zero-length gap through30 then opens, without geometry keys or snapshots',()=>{
  const h=fixture(),before=h.project(),geometries=[0,15,30,45,90].map(x=>h.evaluate(x).drawing.curves);
  h.apply(edit,{op:'updateEndpointCorrection'});
  for(const x of [0,15,30]){const range=interval(h,x);expect(range.end).toBe(range.start);}
  expect(interval(h,45).end).toBeCloseTo(.45,12);expect(interval(h,90).end).toBeCloseTo(.9,12);
  expect([0,15,30,45,90].map(x=>h.evaluate(x).drawing.curves)).toEqual(geometries);
  expect(h.workspace().library).toEqual(before.recordingSnapshots!.library);expect(h.workspace().snapshots).toEqual(before.recordingSnapshots!.snapshots);
  expect(h.workspace().recordings[0].tracks).toEqual([]);expect(h.workspace().recordings[0].angleGraph!.mesh.vertices).toHaveLength(2);
  expect(parseRecordingSnapshots(JSON.parse(JSON.stringify(h.workspace())))).toEqual(h.workspace());
 });
 it('keeps a reversed negative-yaw zero plateau exact across serialized reload',()=>{
  const h=fixture(),w=h.workspace(),r=w.recordings[0];
  w.snapshots[0].id='zz-front';w.snapshots[1].id='aa-side';w.snapshots[1].angle={x:-90,y:0};
  w.snapshots[0].relations.displayIntervals!.add![0].ranges[0]={id:'gap',mode:'HIDE',start:0,end:0};
  w.snapshots[1].relations.displayIntervals!.add![0].ranges[0]={id:'gap',mode:'HIDE',start:0,end:.6};
  r.snapshotIds=w.snapshots.map(s=>s.id);r.activeSnapshotId='zz-front';r.angle={x:-30,y:0};r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));
  h.apply({...edit,end:0},{op:'updateEndpointCorrection'});
  h.set({...h.project(),recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(h.workspace())))});
  for(const x of [-1,-15,-29.99,-30]){expect(interval(h,x).end).toBe(0);expect(h.evaluate(x).diagnostics.filter(d=>d.code==='SOURCE_MATERIAL')).toEqual([]);}
  expect(interval(h,-60).end).toBeCloseTo(.3,12);
 });
 it('invalidates cached material after response-only edits and restores exact values on Undo-style project restoration',()=>{
  const h=fixture(),prior=interval(h,30).end,before=h.project();expect(prior).toBeCloseTo(.5,12);
  const preview=prepareSnapshotPreview(before,{commands:[edit]});expect(preview.recordingSnapshots.library).toBe(before.recordingSnapshots!.library);expect(preview.recordingSnapshots.snapshots).toBe(before.recordingSnapshots!.snapshots);
  h.apply(edit);expect(interval(h,30).end).toBeCloseTo(.3,12);expect(interval(h,30,false).end).toBeCloseTo(prior,12);
  const after=h.project();h.set(before);expect(interval(h,30).end).toBe(prior);h.set(after);expect(interval(h,30).end).toBeCloseTo(.3,12);
  h.apply({op:'updateEndpointCorrection'});expect(interval(h,30,false).end).toBeCloseTo(.3,12);
 });
 it('shares draft/save/discard transactions with geometry and respects selected layer commits',()=>{
  const h=fixture();for(const s of h.workspace().snapshots)if(s.id==='side')s.deformation.layers.layer={shape:{nodes:{a:[1,1]},handles:{}}};
  h.apply({op:'moveShapeNode',layerId:'layer',nodeId:'a',position:[.6,.6]});const prior=h.workspace().recordings[0].angleGraph!.correctionFrames![0];
  h.apply(edit);const draft=h.workspace().recordings[0].angleGraph!.correctionFrames![0];expect(draft.id).toBe(prior.id);expect(draft.edgeResponses).toEqual(prior.edgeResponses);expect(draft.propertyResponses).toBeDefined();
  h.apply({op:'saveSelected',layerIds:['layer']});expect(h.workspace().recordings[0].angleGraph!.correctionFrames!.every(f=>f.status==='saved')).toBe(true);expect(h.workspace().recordings[0].angleGraph!.propertyResponses).toBeDefined();
  const saved=interval(h,30).end;h.apply({...edit,end:.4});h.apply({op:'discardSelected',layerIds:['layer']});expect(interval(h,30).end).toBe(saved);
 });
 it('rejects unavailable scalar edits atomically and keeps mode changes on real snapshots',()=>{
  const h=fixture(),before=h.project();expect(()=>h.apply({...edit,start:.2,end:.3})).toThrow(/equal|unavailable|indistinguishable|constant/i);expect(h.project()).toBe(before);
  expect(()=>h.apply({...edit,mode:'SHOW'})).toThrow(/real snapshot/i);expect(h.project()).toBe(before);
 });
 it('archives property constraints with deleted mesh support rather than silently moving them',()=>{
  const h=fixture();h.apply(edit,{op:'updateEndpointCorrection'});const graph=h.workspace().recordings[0].angleGraph!;
  const result=reconcileSnapshotAngleGraphMesh(graph,removeSnapshotVertex(graph.mesh,'side'),{id:'archive',reason:'deleted-view',message:'Deleted side'});expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.graph.propertyResponses?.edges).toEqual({});expect(result.graph.orphanedResponses![0].propertyResponses).toEqual(graph.propertyResponses);
 });
});
