import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotBatch,prepareSnapshotPreview,snapshotOverview,type SnapshotCommand} from '../../app/recordingSnapshotApi';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {rebindSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';

const unwrap=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function fixture(linked=false){
 const w=emptyRecordingSnapshotWorkspace();
 w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]},c:{id:'c',position:linked?[1,1]:[3,2]},d:{id:'d',position:[4,3]}};
 w.library.curves={first:{id:'first',name:'First',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false},second:{id:'second',name:'Second',nodes:['c','d'],handles:[linked?[1.6,1.8]:[3.6,2.8],[3.7,2.6]],width:.01,visible:true,locked:false}};
 const views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),emptyRecordingSnapshot('up','Up','view',{x:0,y:90})];
 for(const [index,view] of views.entries()){
  view.layers=[{kind:'original',id:'left',name:'Left',visible:true,locked:false,items:['first']},{kind:'original',id:'right',name:'Right',visible:true,locked:false,items:['second']}];
  if(linked)view.relations.endpointLinks={add:[{id:'link',a:{curveId:'first',end:1},b:{curveId:'second',end:0},joinBrush:{kind:'SMOOTH'}}]};
  const k=index===1?1:index===2?-.6:0;
  view.deformation.layers={left:{shape:{nodes:{a:[2*k,3*k],b:[3*k,4*k]},handles:{first:[[.3*k,.4*k],[-.3*k,-.4*k]]}}},right:{shape:{nodes:{c:linked?[3*k,4*k]:[4*k,5*k],d:[5*k,6*k]},handles:{second:[[.6*k,.8*k],[-.4*k,-.3*k]]}}}};
 }
 const r=emptySnapshotRecording('surface');r.mode='triangulated';r.snapshotIds=views.map(view=>view.id);r.activeSnapshotId='front';r.angle={x:30,y:30};r.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));w.recordings=[r];w.snapshots=views;w.activeRecordingId=r.id;
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:w};const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Source mutation');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 return {api,past,project:()=>project,current:()=>project.recordingSnapshots!.recordings.find(recording=>recording.id===project.recordingSnapshots!.activeRecordingId)!,apply:(...commands:SnapshotCommand[])=>unwrap(api.snapshot({commands})),drawing:(angle?:{x:number;y:number},useDraft=true)=>evaluateRecordingSnapshot(project,{angle,useDraft}).drawing};
}
const command=(value:Partial<ScenePlacementValue>,curveIds=['first','second']):SnapshotCommand=>({op:'transformShapeElements',curveIds,value:{...identityScenePlacement(),...value}});
const near=(actual:Point2,wanted:Point2)=>{expect(actual[0]).toBeCloseTo(wanted[0],9);expect(actual[1]).toBeCloseTo(wanted[1],9);};
const transformed=(before:DrawingDocument,after:DrawingDocument,value:ScenePlacementValue)=>{for(const node of before.nodes)near(after.nodes.find(node2=>node2.id===node.id)!.position,applyScenePlacement(value,node.position));for(const curve of before.curves)for(const end of [0,1] as const)near(after.curves.find(curve2=>curve2.id===curve.id)!.handles[end],applyScenePlacement(value,curve.handles[end]));};

describe('surface commands use the Drawing target inverse',()=>{
 for(const [name,value] of Object.entries({move:{translation:[.4,-.2] as Point2},rotate:{rotation:23},nonuniform:{scaleX:1.3,scaleY:.7},zeroAxis:{scaleX:0,scaleY:1}}))it(`replays multilayer ${name} targets and saves one undo transaction`,()=>{
  const h=fixture(),before=h.project(),drawing=h.drawing(),transform=command(value);
  h.apply(transform,{op:'updateEndpointCorrection'});transformed(drawing,h.drawing(),(transform as {value:ScenePlacementValue}).value);
  expect(h.past).toHaveLength(1);expect(h.current().tracks).toEqual([]);expect(h.project().recordingSnapshots!.snapshots).toEqual(before.recordingSnapshots!.snapshots);expect(h.project().recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);
  expect(h.current().angleGraph!.correctionFrames).toMatchObject([{status:'saved',angle:{x:30,y:30}}]);expect(h.current().angleGraph!.correctionFrames![0].triangleResponses).toBeUndefined();
  const after=h.project();unwrap(h.api.undo());expect(h.project()).toBe(before);unwrap(h.api.redo());expect(h.project()).toBe(after);
 });
 it('handles linked SMOOTH controls once across a complete transform selection',()=>{
  const h=fixture(true),before=h.drawing(),transform=command({rotation:21,scaleX:1.2,scaleY:.8});h.apply(transform);transformed(before,h.drawing(),(transform as {value:ScenePlacementValue}).value);
  const responses=Object.values(h.current().angleGraph!.correctionFrames![0].triangleResponses!)[0];expect(Object.keys(responses.nodes).sort()).toEqual(['a','b','d']);expect(responses.nodes.c).toBeUndefined();
 });
 it('routes A node and handle moves through the same correction frame and leaves bases unchanged',()=>{
  const h=fixture(),before=h.project(),node:Point2=[1.2,-.7];h.apply({op:'moveShapeNode',layerId:'left',nodeId:'a',position:node});near(h.drawing().nodes.find(value=>value.id==='a')!.position,node);
  const frame=h.current().angleGraph!.correctionFrames![0].id,handle:Point2=[1.9,-.2];h.apply({op:'moveShapeHandle',layerId:'left',curveId:'first',end:0,position:handle});near(h.drawing().curves.find(value=>value.id==='first')!.handles[0],handle);expect(h.current().angleGraph!.correctionFrames![0].id).toBe(frame);
  expect(h.project().recordingSnapshots!.snapshots).toEqual(before.recordingSnapshots!.snapshots);h.apply({op:'updateSnapshot'});expect(snapshotOverview(h.project())).toMatchObject({hasDraft:false});near(h.drawing(undefined,false).curves.find(value=>value.id==='first')!.handles[0],handle);
 });
 it('copies only modified graph response maps during pointer previews',()=>{
  const h=fixture();h.apply(command({translation:[.1,0]}));const before=freeze(h.project()),graph=h.current().angleGraph!,commands=[command({rotation:5})],preview=prepareSnapshotPreview(before,{commands}),strict=prepareSnapshotBatch(before,{commands,dryRun:true}),next=preview.recordingSnapshots.recordings[0].angleGraph!;
  expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.recordingSnapshots.library).toBe(before.recordingSnapshots!.library);expect(preview.recordingSnapshots.snapshots).toBe(before.recordingSnapshots!.snapshots);expect(next.mesh).toBe(graph.mesh);expect(next.edgeResponses).toBe(graph.edgeResponses);expect(next.triangleResponses).toBe(graph.triangleResponses);expect(next.correctionFrames).not.toBe(graph.correctionFrames);
 });
 it('refuses outside geometry and nonvertex local channels without mutating source or history',()=>{
  const h=fixture();h.apply({op:'setAngle',angle:{x:90,y:90}});const before=freeze(h.project()),count=h.past.length;
  expect(h.api.snapshot({commands:[command({translation:[1,0]})]})).toMatchObject({ok:false,error:{code:'SURFACE_OUTSIDE_COVERAGE'}});
  expect(h.api.snapshot({commands:[{op:'setLayerPlacement',layerId:'left',value:identityScenePlacement()}]})).toMatchObject({ok:false,error:{code:'REAL_SNAPSHOT_REQUIRED'}});
  expect(h.project()).toBe(before);expect(h.past).toHaveLength(count);expect(h.drawing().curves).toHaveLength(0);
 });
 it('rejects a late unavailable coordinate atomically, including an existing response draft',()=>{
  const h=fixture();for(const view of h.project().recordingSnapshots!.snapshots)view.deformation.layers.right.shape!.nodes.d[0]=0;
  h.apply({op:'moveShapeNode',layerId:'left',nodeId:'a',position:[1,.4]});const before=freeze(h.project()),count=h.past.length;
  expect(h.api.snapshot({commands:[command({translation:[.3,0]})]})).toMatchObject({ok:false,error:{code:'SURFACE_AXIS_UNAVAILABLE',message:expect.stringContaining('Node d X')}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(count);
 });
});

describe('real surface snapshots and Recorder bindings',()=>{
 it('creates a genuinely empty zero view and new outside views without fallback capture',()=>{
  const h=fixture();h.apply({op:'createTriangulatedRecording',name:'Empty'});expect(h.current().mode).toBe('triangulated');expect(h.current().angleGraph!.mesh.vertices).toHaveLength(3);expect(h.drawing().curves).toHaveLength(0);expect(h.current().angle).toEqual({x:0,y:0});
  h.apply({op:'createSnapshot',angle:{x:90,y:0}});expect(h.current().snapshotIds).toHaveLength(6);expect(h.drawing().curves).toHaveLength(0);expect(h.current().tracks).toEqual([]);
  const before=h.project(),count=h.current().snapshotIds.length;h.apply({op:'createSnapshot',angle:{x:45,y:0}});expect(h.current().snapshotIds).toHaveLength(count+1);expect(h.project().recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(h.drawing().curves).toHaveLength(0);
 });
 it('edits a rebound real vertex with world controls and snapshot-local drafts, retaining all old keys',()=>{
  const h=fixture(),r=h.current();r.angleGraph!.mesh=rebindSnapshotVertex(r.angleGraph!.mesh,'side',{x:80,y:10});
  r.tracks=[{id:'old-placement',targetId:'left',channel:'placement',keys:[{id:'legacy',angle:{x:90,y:0},value:{...identityScenePlacement(),translation:[2,1]}}]}];
  const keys=structuredClone(r.tracks),other=structuredClone(h.project().recordingSnapshots!.snapshots.filter(view=>view.id!=='side'));h.apply({op:'selectSnapshot',snapshotId:'side'});expect(h.current().angle).toEqual({x:80,y:10});
  expect(snapshotOverview(h.project())).toMatchObject({snapshots:expect.arrayContaining([{id:'side',name:'Side',kind:'view',angle:{x:80,y:10},layerCount:2,authored:[]}])});
  const before=freeze(h.project()),commands:SnapshotCommand[]=[{op:'moveShapeNode',layerId:'left',nodeId:'a',position:[5,6]}],preview=prepareSnapshotPreview(before,{commands}),view=preview.recordingSnapshots.snapshots.find(view=>view.id==='side')!;
  expect(view.draft?.angle).toEqual({x:90,y:0});expect(view.angle).toEqual({x:90,y:0});expect(preview.recordingSnapshots.recordings[0].tracks).toBe(before.recordingSnapshots!.recordings[0].tracks);
  for(const original of before.recordingSnapshots!.snapshots)if(original.id!=='side')expect(preview.recordingSnapshots.snapshots.find(view=>view.id===original.id)).toBe(original);
  near(evaluateRecordingSnapshot({...before,recordingSnapshots:preview.recordingSnapshots}).drawing.nodes.find(node=>node.id==='a')!.position,[5,6]);
  h.apply(...commands,{op:'updateSnapshot'});expect(h.current().tracks).toEqual(keys);expect(h.project().recordingSnapshots!.snapshots.filter(view=>view.id!=='side')).toEqual(other);expect(h.project().recordingSnapshots!.snapshots.find(view=>view.id==='side')!.draft).toBeUndefined();near(h.drawing(undefined,false).nodes.find(node=>node.id==='a')!.position,[5,6]);
 });
 it('archives responses incident to a deleted view and never fills the deleted region',()=>{
  const h=fixture();h.apply(command({translation:[.1,.2]}),{op:'updateSnapshot'});const source=structuredClone(h.project().recordingSnapshots!.library),mesh=h.current().angleGraph!.mesh;
  h.apply({op:'deleteSnapshot',snapshotId:'up'});expect(h.current().angleGraph!.mesh.coverage).toBe('explicit');expect(h.current().angleGraph!.orphanedResponses).toMatchObject([{reason:'deleted-view',mesh}]);expect(h.current().angleGraph!.triangleResponses).toEqual({});expect(h.project().recordingSnapshots!.library).toEqual(source);expect(h.drawing({x:30,y:30}).curves).toHaveLength(0);
 });
 it('keeps near-vertex edits on the response surface and refuses structural writes',()=>{
  const h=fixture();h.apply({op:'setAngle',angle:{x:1e-6,y:0}});const snapshots=structuredClone(h.project().recordingSnapshots!.snapshots);h.apply(command({translation:[.1,0]}));expect(h.current().angleGraph!.correctionFrames).toHaveLength(1);expect(h.project().recordingSnapshots!.snapshots).toEqual(snapshots);
  expect(h.api.snapshot({commands:[{op:'setLayerPlacement',layerId:'left',value:identityScenePlacement()}]})).toMatchObject({ok:false,error:{code:'REAL_SNAPSHOT_REQUIRED'}});
 });
 it('rebinds exact view coordinates without moving its geometry and rejects unresolved constrained rebinds',()=>{
  const h=fixture();h.apply({op:'selectSnapshot',snapshotId:'side'});const before=h.drawing(),snapshot=structuredClone(h.project().recordingSnapshots!.snapshots.find(view=>view.id==='side'));
  h.apply({op:'rebindSnapshotAngle',snapshotId:'side',angle:{x:80,y:10}});expect(h.current().angle).toEqual({x:80,y:10});expect(h.drawing()).toEqual(before);expect(h.project().recordingSnapshots!.snapshots.find(view=>view.id==='side')).toEqual(snapshot);
  h.apply({op:'setAngle',angle:{x:20,y:20}},command({translation:[.1,0]}),{op:'updateSnapshot'});const project=h.project();expect(h.api.snapshot({commands:[{op:'rebindSnapshotAngle',snapshotId:'side',angle:{x:70,y:10}}]})).toMatchObject({ok:false,error:{code:'UNHANDLED_REBIND'}});expect(h.project()).toBe(project);
 });
 it('saves and discards selected surface controls while preserving unselected changes',()=>{
  const h=fixture(),base=h.drawing();h.apply({op:'moveShapeNode',layerId:'left',nodeId:'a',position:[2,3]},{op:'moveShapeNode',layerId:'right',nodeId:'d',position:[8,9]});h.apply({op:'saveSelected',layerIds:['left']});
  near(h.drawing(undefined,false).nodes.find(node=>node.id==='a')!.position,[2,3]);near(h.drawing(undefined,false).nodes.find(node=>node.id==='d')!.position,base.nodes.find(node=>node.id==='d')!.position);near(h.drawing().nodes.find(node=>node.id==='d')!.position,[8,9]);
  h.apply({op:'discardSelected',layerIds:['right']});expect(h.current().angleGraph!.correctionFrames?.some(frame=>frame.status==='draft')).toBe(false);near(h.drawing().nodes.find(node=>node.id==='a')!.position,[2,3]);near(h.drawing().nodes.find(node=>node.id==='d')!.position,base.nodes.find(node=>node.id==='d')!.position);
 });
 it('refuses retired endpoint copies without deleting saved state or drafts',()=>{
  const h=fixture(),source=h.current();source.mode='endpoint-pair';delete source.angleGraph;source.snapshotIds=['front','side'];source.angle={x:90,y:0};source.activeSnapshotId='side';source.endpointPair={axis:'x',startSnapshotId:'front',endSnapshotId:'side'};
  source.tracks=[{id:'old-placement',channel:'placement',targetId:'left',keys:[{id:'start-key',angle:{x:0,y:0},value:{...identityScenePlacement(),translation:[1,2]}},{id:'end-key',angle:{x:90,y:0},value:{...identityScenePlacement(),translation:[3,4]}}],draft:{angle:{x:90,y:0},value:{...identityScenePlacement(),translation:[5,6]}}}];
  const before=JSON.stringify(h.project()),project=h.project();const result=h.api.snapshot({commands:[{op:'createTriangulatedRecordingCopy'}]});
  expect(result.ok).toBe(false);if(!result.ok)expect(result.error.message).toContain('旧录制已停用');
  expect(h.project()).toBe(project);expect(JSON.stringify(h.project())).toBe(before);expect(h.past).toEqual([]);
 });
 it('limits linked basis position drafts to the one real snapshot',()=>{
  const h=fixture(true);h.apply({op:'selectSnapshot',snapshotId:'front'});const before=freeze(h.project()),preview=prepareSnapshotPreview(before,{commands:[{op:'moveShapeNode',layerId:'left',nodeId:'b',position:[2,2]}]});
  for(const view of before.recordingSnapshots!.snapshots)if(view.id!=='front')expect(preview.recordingSnapshots.snapshots.find(next=>next.id===view.id)).toBe(view);
  expect(preview.recordingSnapshots.recordings[0].tracks).toEqual([]);const drawing=evaluateRecordingSnapshot({...before,recordingSnapshots:preview.recordingSnapshots}).drawing;near(drawing.nodes.find(node=>node.id==='b')!.position,[2,2]);near(drawing.nodes.find(node=>node.id==='c')!.position,[2,2]);
 });

});
