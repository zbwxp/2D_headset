import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotBatch,prepareSnapshotPreview,snapshotOverview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotPoseTrack} from '../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {identitySceneShape} from '../domain/recordingScene/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {Point2} from '../domain/drawing/model';

const unwrap=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function fixture(direction=1){
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[2,1]},c:{id:'c',position:[0,2]},d:{id:'d',position:[2,3]}};
 workspace.library.curves={first:{id:'first',name:'First',nodes:['a','b'],handles:[[.4,.3],[1.5,.8]],visible:true,locked:false,width:.02},second:{id:'second',name:'Second',nodes:['c','d'],handles:[[.3,2.2],[1.7,2.8]],visible:true,locked:false,width:.02}};
 const recording=emptySnapshotRecording('original','Original'),start=emptyRecordingSnapshot('start','Front','view',{x:0,y:0}),middle=emptyRecordingSnapshot('middle','Old middle','view',{x:30*direction,y:0}),end=emptyRecordingSnapshot('end','Side','view',{x:90*direction,y:0});
 for(const view of [start,middle,end])view.layers=[{kind:'original',id:'layer-a',name:'A',items:['first'],visible:true,locked:false},{kind:'original',id:'layer-b',name:'B',items:['second'],visible:true,locked:false}];
 for(const [layerId,nodeIds,curveId] of [['layer-a',['a','b'],'first'],['layer-b',['c','d'],'second']] as const){
  const track:SnapshotPoseTrack={id:`shape-${layerId}`,channel:'shape',targetId:layerId,interpolation:'independent',keys:[]};
  for(const [index,view] of [start,middle,end].entries()){const shape=identitySceneShape();if(index===1){shape.nodes[nodeIds[0]]=[3,-2];shape.handles[curveId]=[[1,2],[.4,-.5]];}if(index===2){shape.nodes[nodeIds[0]]=[2,4];shape.nodes[nodeIds[1]]=[1,-1];shape.handles[curveId]=[[.5,.7],[-.3,.4]];}const key={id:`key-${layerId}-${index}`,angle:{...view.angle},value:shape};track.keys.push(key);view.authored.push({trackId:track.id,keyId:key.id});}recording.tracks.push(track);
 }
 workspace.snapshots=[start,middle,end];recording.snapshotIds=['start','middle','end'];recording.activeSnapshotId='start';workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:workspace};const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected Drawing mutation');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const apply=(...commands:SnapshotCommand[])=>unwrap(api.snapshot({commands}));
 const current=()=>project.recordingSnapshots!.recordings.find(value=>value.id===project.recordingSnapshots!.activeRecordingId)!;
 const drawing=(x=current().angle.x,useDraft=true)=>evaluateRecordingSnapshot(project,{angle:{x,y:0},useDraft}).drawing;
 const makePair=()=>apply({op:'createEndpointPairRecording',startSnapshotId:'start',endSnapshotId:'end',name:'Pair'});
 return {api,apply,makePair,past,project:()=>project,current,drawing,direction};
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
const node=(drawing:ReturnType<ReturnType<typeof fixture>['drawing']>,id='a')=>drawing.nodes.find(node=>node.id===id)!.position;

test('explicit pair copy preserves original middle keys, canonical IDs and exact endpoint outputs',()=>{
 const h=fixture(),before=structuredClone(h.project().recordingSnapshots!),start=h.drawing(0,false),end=h.drawing(90,false),history=h.past.length;
 h.makePair();expect(h.past).toHaveLength(history+1);expect(h.current().mode).toBe('endpoint-pair');expect(h.current().snapshotIds).toHaveLength(2);expect(h.current().tracks).toEqual([]);
 expect(h.project().recordingSnapshots!.recordings.find(value=>value.id==='original')).toEqual(before.recordings[0]);expect(h.project().recordingSnapshots!.snapshots.slice(0,3)).toEqual(before.snapshots);expect(h.project().recordingSnapshots!.library).toEqual(before.library);
 expect(h.drawing(0,false).nodes).toEqual(start.nodes);expect(h.drawing(0,false).curves).toEqual(start.curves);expect(h.drawing(90,false).nodes).toEqual(end.nodes);expect(h.drawing(90,false).curves).toEqual(end.curves);
 expect(node(h.drawing(30,false))).toEqual([2/3,4/3]);expect(snapshotOverview(h.project())).toMatchObject({mode:'endpoint-pair',endpointPair:h.current().endpointPair});
});

for(const direction of [1,-1])test(`signed ${direction>0?'right':'left'} inverse edit creates only X/Y response constraints and one Undo batch`,()=>{
 const h=fixture(direction);h.makePair();const original=h.project(),count=h.past.length,target:Point2=[3,-2];
 h.apply({op:'setAngle',angle:{x:30*direction,y:0}},{op:'correctShapeNode',layerId:'layer-a',nodeId:'a',position:target},{op:'updateEndpointCorrection'});
 expect(h.past).toHaveLength(count+1);expect(node(h.drawing())).toEqual(target);expect(h.current().tracks).toEqual([]);expect(h.current().snapshotIds).toHaveLength(2);expect(h.current().endpointPair?.responses?.nodes.a).toEqual({x:[[1/3,1.5]],y:[[1/3,-.5]]});expect(h.current().endpointPair?.draft).toBeUndefined();
 const corrected=h.project();unwrap(h.api.undo());expect(h.project()).toBe(original);unwrap(h.api.redo());expect(h.project()).toBe(corrected);expect(node(h.drawing(0,false))).toEqual([0,0]);expect(node(h.drawing(90*direction,false))).toEqual([2,4]);
});

test('handle corrections author relative vectors and preserve their endpoint node',()=>{
 const h=fixture();h.makePair();h.apply({op:'setAngle',angle:{x:45,y:0}});const prior=node(h.drawing()),target:Point2=[prior[0]+1.4,prior[1]-.4];h.apply({op:'moveShapeHandle',layerId:'layer-a',curveId:'first',end:0,position:target},{op:'updateEndpointCorrection'});
 expect(node(h.drawing())).toEqual(prior);expect(h.drawing().curves.find(curve=>curve.id==='first')!.handles[0]).toEqual(target);expect(h.current().endpointPair?.responses?.handles.first[0].x![0][1]).toBeCloseTo(2);expect(h.current().tracks).toEqual([]);
});

test('response graph accepts overshoot, signed and nonmonotone knots; reset restores linear only on selected axis',()=>{
 const h=fixture();h.makePair();const targets=[{layerId:'layer-a',nodeId:'a'}];h.apply({op:'setControlResponse',targets,axis:'x',points:[[.2,1.4],[.6,-.2]]},{op:'setControlResponse',targets,axis:'y',points:[[.5,.25]]});
 expect(node(h.drawing(18))).toEqual([2.8,.4]);const saved=h.current().endpointPair!.responses!.nodes.a.y;h.apply({op:'resetControlResponse',targets,axis:'x'});expect(h.current().endpointPair!.responses!.nodes.a).toEqual({y:saved});expect(node(h.drawing(45))).toEqual([1,1]);
});

test('selected correction save/discard preserves unselected drafts, including no geometry keys',()=>{
 const h=fixture();h.makePair();h.apply({op:'setAngle',angle:{x:45,y:0}},{op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:[3,3]},{op:'moveShapeNode',layerId:'layer-b',nodeId:'c',position:[-1,6]});
 h.apply({op:'saveSelected',layerIds:['layer-a']});expect(h.current().endpointPair!.responses!.nodes.a).toBeDefined();expect(h.current().endpointPair!.responses!.nodes.c).toBeUndefined();expect(h.current().endpointPair!.draft).toBeDefined();
 h.apply({op:'discardSelected',layerIds:['layer-b']});expect(h.current().endpointPair!.draft).toBeUndefined();expect(node(h.drawing())).toEqual([3,3]);expect(node(h.drawing(),'c')).toEqual([1,4]);expect(h.current().tracks).toEqual([]);
});

test('unknown/zero endpoint component rejects atomically without residual or draft fallback',()=>{
 const h=fixture();h.makePair();const recording=h.current(),end=h.project().recordingSnapshots!.snapshots.find(value=>value.id===recording.endpointPair!.endSnapshotId)!;end.deformation.layers['layer-a'].shape!.nodes.a=[2,0];h.apply({op:'setAngle',angle:{x:45,y:0}});const before=h.project(),history=h.past.length;
 expect(h.api.snapshot({commands:[{op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:[2,1]}]})).toMatchObject({ok:false,error:{code:'ENDPOINT_AXIS_UNAVAILABLE'}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(history);expect(h.current().endpointPair!.draft).toBeUndefined();
 h.apply({op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:[2,0]},{op:'updateSnapshot'});expect(h.current().endpointPair!.responses!.nodes.a).toEqual({x:[[.5,1]]});
});

test('pair mode forbids arbitrary views and intermediate non-control keys, and rejects invalid graph points',()=>{
 const h=fixture();h.makePair();h.apply({op:'setAngle',angle:{x:45,y:0}});const before=h.project(),count=h.past.length;
 const invalid:unknown[]=[{op:'createSnapshot',angle:{x:30,y:0}},{op:'deleteSnapshot',snapshotId:h.current().endpointPair!.startSnapshotId},{op:'setLayerOrder',layerId:'layer-a',value:3},{op:'setAngle',angle:{x:45,y:5}},{op:'setControlResponse',targets:[{layerId:'layer-a',nodeId:'a'}],axis:'x',points:[[0,0]]},{op:'setControlResponse',targets:[{layerId:'layer-a',nodeId:'a'}],axis:'x',points:[[.5,1],[.4,2]]}];
 for(const command of invalid){expect(h.api.snapshot({commands:[command] as SnapshotCommand[]})).toMatchObject({ok:false});expect(h.project()).toBe(before);expect(h.past).toHaveLength(count);}
});

test('native correction previews match strict batches, never mutate frozen saved inputs, and expose draft state',()=>{
 const h=fixture();h.makePair();h.apply({op:'setAngle',angle:{x:45,y:0}});const before=freeze(h.project()),commands:SnapshotCommand[]=[{op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:[3,-2]}],preview=prepareSnapshotPreview(before,{commands}),strict=prepareSnapshotBatch(before,{commands,dryRun:true});
 expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.recordingSnapshots.library).toBe(before.recordingSnapshots!.library);expect(preview.recordingSnapshots.snapshots).toBe(before.recordingSnapshots!.snapshots);expect(h.current().endpointPair!.draft).toBeUndefined();expect(snapshotOverview({...before,recordingSnapshots:preview.recordingSnapshots})).toMatchObject({hasDraft:true});
});

test('strict JSON roundtrip retains responses and rejects hidden fields, invalid modes or intermediate keys',()=>{
 const h=fixture();h.makePair();h.apply({op:'setControlResponse',targets:[{layerId:'layer-a',nodeId:'a'}],axis:'x',points:[[.3,-2],[.7,4]]});expect(parseLandmarks(JSON.stringify(h.project())).recordingSnapshots).toEqual(h.project().recordingSnapshots);
 const workspace=h.project().recordingSnapshots!,activeId=h.current().id;
 for(const mutate of [(r:any)=>{r.endpointPair.responses.nodes.a.residual=[1,2];},(r:any)=>{delete r.mode;},(r:any)=>{r.endpointPair.axis='y';},(r:any)=>{r.tracks.push({id:'forbidden',channel:'depth',targetId:'layer-a',keys:[{id:'hidden',angle:{x:30,y:0},value:1}]});}]){const copy=structuredClone(workspace);mutate(copy.recordings.find(recording=>recording.id===activeId));expect(()=>parseRecordingSnapshots(copy)).toThrow();}
 const stale=structuredClone(workspace);stale.recordings.find(recording=>recording.id===activeId)!.endpointPair!.responses!.nodes['temporarily-missing']={x:[[.5,2]]};expect(parseRecordingSnapshots(stale)).toEqual(stale);
});

test('incompatible layer membership refuses clone and preserves the old original',()=>{
 const h=fixture();h.project().recordingSnapshots!.snapshots.find(view=>view.id==='end')!.layers.reverse();const before=h.project(),history=h.past.length;
 const end=h.project().recordingSnapshots!.snapshots.find(view=>view.id==='end')!;end.layers[0].id='different-layer';expect(h.api.snapshot({commands:[{op:'createEndpointPairRecording',startSnapshotId:'start',endSnapshotId:'end'}]})).toMatchObject({ok:false,error:{code:'ENDPOINT_BASIS_INCOMPATIBLE'}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(history);
});

test('editing a basis uses world coordinates and seeds both endpoint values without changing the opposite basis',()=>{
 const h=fixture();h.makePair();const endpoint=h.current().endpointPair!.startSnapshotId,endBefore=h.drawing(90,false);h.apply({op:'selectSnapshot',snapshotId:endpoint},{op:'setLayerPlacement',layerId:'layer-a',value:{translation:[1,2],rotation:0,scale:2}},{op:'updateSnapshot'});const target:Point2=[3,4];h.apply({op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:target},{op:'updateSnapshot'});
 expect(node(h.drawing(0,false))).toEqual(target);expect(h.drawing(90,false).nodes).toEqual(endBefore.nodes);expect(h.drawing(90,false).curves).toEqual(endBefore.curves);expect(h.current().tracks.every(track=>track.keys.length===2&&track.keys.every(key=>key.angle.x===0||key.angle.x===90))).toBe(true);
});

test('basis edit immutable preview cannot mutate the other endpoint while seeding its first track',()=>{
 const h=fixture();h.makePair();const before=freeze(h.project()),commands:SnapshotCommand[]=[{op:'moveShapeNode',layerId:'layer-a',nodeId:'a',position:[1,1]}],preview=prepareSnapshotPreview(before,{commands}),strict=prepareSnapshotBatch(before,{commands,dryRun:true});const previewTrack=preview.recordingSnapshots.recordings.find(recording=>recording.id===h.current().id)!.tracks[0],strictTrack=strict.recordingSnapshots.recordings.find(recording=>recording.id===h.current().id)!.tracks[0];expect(previewTrack.draft).toEqual(strictTrack.draft);expect(previewTrack.keys.map(key=>[key.angle,key.value])).toEqual(strictTrack.keys.map(key=>[key.angle,key.value]));expect(h.current().tracks).toEqual([]);expect(preview.recordingSnapshots.recordings.find(recording=>recording.id===h.current().id)!.tracks[0].keys).toHaveLength(2);expect(h.project().recordingSnapshots!.snapshots.every(view=>view.id==='start'||view.id==='middle'||view.id==='end'||view.authored.length===0)).toBe(true);
});

test('basis membership edits reject the complete batch before a broken pair can reach the UI',()=>{
 const h=fixture();h.makePair();const before=h.project(),history=h.past.length;expect(h.api.snapshot({commands:[{op:'removeLayers',layerIds:['layer-a']}]})).toMatchObject({ok:false,error:{code:'ENDPOINT_BASIS_INCOMPATIBLE',commandIndex:0}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(history);expect(h.drawing().curves).toHaveLength(2);
});

test('an ARC basis cannot acquire unsupported deferred nonuniform placement through commit or native preview',()=>{
 const h=fixture();for(const snapshot of h.project().recordingSnapshots!.snapshots)snapshot.relations.joins={add:[{id:'arc',a:{curveId:'first',end:1},b:{curveId:'second',end:0},mode:'ARC',radius:.1}]};h.makePair();const before=freeze(h.project()),history=h.past.length,commands:SnapshotCommand[]=[{op:'setLayerPlacement',layerId:'layer-a',value:{translation:[0,0],rotation:0,scale:1,scaleX:2,scaleY:1}}];
 expect(h.api.snapshot({commands})).toMatchObject({ok:false,error:{code:'ENDPOINT_BASIS_INCOMPATIBLE',commandIndex:0}});expect(()=>prepareSnapshotPreview(before,{commands})).toThrow(/ARC/);expect(h.project()).toBe(before);expect(h.past).toHaveLength(history);
});
