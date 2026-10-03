import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {subcurve} from '../../domain/drawing/roundedJoin';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import * as evaluation from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotEndpointResponses} from '../../domain/recordingSnapshot/model';
import {DEFAULT_SCENE_ONION_SETTINGS,createSnapshotOnionInspectionCache} from '../../ui/vectorRecording/angleInspection';
import {interpolateEndpointPairOnion} from '../../ui/vectorRecording/endpointOnion';
import {extractEndpointOnionInk} from '../../ui/vectorRecording/endpointOnionInk';
import {useSnapshotOnionFrames} from '../../ui/vectorRecording/useSnapshotOnionFrames';

const at=(x:number)=>({x,y:0});
const point=(x:number,y=0):Point2=>[x,y];
function drawing():DrawingDocument {
 return {...emptyDrawing(),nodes:[{id:'a',position:point(-1)},{id:'b',position:point(0)},{id:'c',position:point(0,1)}],curves:[
  {id:'left',name:'Left',nodes:['a','b'],handles:[point(-2/3),point(-1/3)],visible:true,locked:false,width:.02},
  {id:'right',name:'Right',nodes:['b','c'],handles:[point(0,1/3),point(0,2/3)],visible:true,locked:false,width:.02},
  {id:'closure',name:'Hidden closure',nodes:['c','a'],handles:[point(-.3,.8),point(-.8,.2)],visible:true,inkVisible:false,locked:false,width:.02},
 ],layers:[{id:'layer',name:'Layer',items:['left','right','closure'],visible:true,locked:false}],joins:[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'right',end:0},mode:'ARC',radius:.2}]};
}
const transform=(p:Point2):Point2=>[p[0]*2+10,p[1]*3+4];
function fixture(side:number){
 const source=drawing(),workspace=emptyRecordingSnapshotWorkspace(),zero=emptyRecordingSnapshot('zero','Front','view'),end=emptyRecordingSnapshot('side','Side','view',at(side)),recording=emptySnapshotRecording('recording');
 workspace.library.nodes=Object.fromEntries(source.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries(source.curves.map(curve=>[curve.id,curve]));
 for(const snapshot of [zero,end]){snapshot.layers=source.layers.map(layer=>({...layer,kind:'original' as const}));snapshot.relations={joins:{add:source.joins}};}
 const delta=(p:Point2):Point2=>{const q=transform(p);return [q[0]-p[0],q[1]-p[1]];};
 end.deformation.layers.layer={shape:{nodes:Object.fromEntries(source.nodes.map(node=>[node.id,delta(node.position)])),handles:Object.fromEntries(source.curves.map(curve=>[curve.id,curve.handles.map(delta) as [Point2,Point2]]))}};
 recording.mode='endpoint-pair';recording.snapshotIds=['zero','side'];recording.activeSnapshotId='zero';recording.endpointPair={axis:'x',startSnapshotId:'zero',endSnapshotId:'side'};
 workspace.snapshots=[zero,end];workspace.recordings=[recording];return {workspace,recording,source};
}
const responses:SnapshotEndpointResponses={nodes:{b:{x:[[.5,.2]],y:[[.5,.8]]}},handles:{left:[{x:[[.5,.1]],y:[[.5,.9]]},{}],right:[{x:[[.5,.7]],y:[[.5,.3]]},{}]}};

test.each([-90,90])('two-basis ghosts and runtime share final controls, ARC and hidden material at yaw %s',side=>{
 const {workspace,recording}=fixture(side);recording.endpointPair!.responses=responses;
 const start=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(0),diagnostics:'preview'}),end=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(side),diagnostics:'preview'}),before=JSON.stringify(workspace);
 const result=interpolateEndpointPairOnion(start,end,5,responses);
 expect(result.frames).toHaveLength(19);
 expect(result.frames.find(frame=>frame.highlight==='30')?.angle).toEqual(at(Math.sign(side)*30));expect(result.frames.find(frame=>frame.highlight==='60')?.angle).toEqual(at(Math.sign(side)*60));
 for(const frame of result.frames){
  const live=evaluateRecordingSnapshot(workspace,recording.id,{angle:frame.angle,diagnostics:'preview'}),ink=extractEndpointOnionInk(live.drawing);
  for(const curve of frame.drawing.curves)expect(shapeOf(frame.drawing,curve.id)).toEqual(shapeOf(live.drawing,curve.id));
  expect(frame.centerlines?.some(line=>line.id.includes('closure'))).toBe(false);
  expect(frame.centerlines?.filter(line=>line.id.startsWith('arc:')).map(line=>line.cubic)).toEqual(Object.values(ink.arcs).flat());
  expect(shapeOf(frame.drawing,'left')[3]).toEqual(shapeOf(frame.drawing,'right')[0]);
 }
 expect(JSON.stringify(workspace)).toBe(before);
});

test.each([-90,90])('material masks and one-sided visibility remain identical to runtime at yaw %s',side=>{
 const {workspace,recording}=fixture(side);recording.endpointPair!.responses=responses;
 for(const [index,snapshot] of workspace.snapshots.entries())snapshot.relations.displayIntervals={add:[{id:'material',anchor:{id:'left',reverse:false},ranges:[{id:'show',start:index===1 ? .2 : .05,end:index===1 ? .9 : .7}]}]};
 workspace.snapshots[1].deformation.layers.layer.visibility={right:false};
 const start=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(0),diagnostics:'preview'}),end=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(side),diagnostics:'preview'}),result=interpolateEndpointPairOnion(start,end,5,responses);
 for(const frame of result.frames){
  const runtime=evaluateRecordingSnapshot(workspace,recording.id,{angle:frame.angle,diagnostics:'preview'}),ink=extractEndpointOnionInk(runtime.drawing),centerlines=Object.entries(ink.curves).flatMap(([id,curve])=>curve.segments.map((segment,index)=>({id:`curve:${id}:${index}`,cubic:subcurve(segment.cubic,segment.start,segment.end)})));
  for(const [id,arcs] of Object.entries(ink.arcs))arcs.forEach((cubic,index)=>centerlines.push({id:`arc:${id}:${index}`,cubic}));
  expect(frame.centerlines).toEqual(centerlines);expect(centerlines.some(line=>line.id.includes('closure'))).toBe(false);
 }
 expect(result.frames.find(frame=>frame.angle.x===Math.sign(side)*60)!.centerlines!.some(line=>line.id.startsWith('curve:right:'))).toBe(false);
});

test('inspection switches scalar draft responses across the whole pair without making geometry keys',()=>{
 const {workspace,recording}=fixture(-90);recording.endpointPair!.responses=responses;
 const cache=createSnapshotOnionInspectionCache(),saved=cache.get(workspace,recording.id,at(-30)),draft={...responses,nodes:{b:{x:[[1/3,.8]] as Point2[],y:[[1/3,.1]] as Point2[]}}},preview={...workspace,recordings:[{...recording,endpointPair:{...recording.endpointPair!,draft:{angle:at(-30),responses:draft}}}]};
 const live=cache.get(preview,recording.id,at(-30));
 expect(live.recordings[0].endpointPair!.responses).toEqual(draft);expect(live.recordings[0].endpointPair!.draft).toBeUndefined();
 expect(live.recordings[0].tracks).toEqual([]);expect(live.snapshots.map(view=>view.id)).toEqual(['zero','side']);expect(preview.recordings[0].endpointPair!.draft).toBeDefined();
 expect(cache.get(preview,recording.id,at(-60))).toBe(live);expect(live).not.toBe(saved);
 const changed={...workspace,recordings:[{...recording,endpointPair:{...recording.endpointPair!,responses:draft}}]};
 expect(cache.get(changed,recording.id,at(-60)).recordings[0].endpointPair!.responses).toEqual(draft);
});

test('pair onion reuses the canvas basis during inverse preview and ignores arbitrary onion endpoints',()=>{
 const {workspace,recording}=fixture(-90);recording.angle=at(-30);
 const saved=evaluateRecordingSnapshot(workspace,recording.id,{diagnostics:'preview'}),preview={...workspace,recordings:[{...recording,endpointPair:{...recording.endpointPair!,draft:{angle:at(-30),responses}}}]},current=evaluateRecordingSnapshot(preview,recording.id,{diagnostics:'preview'});
 expect(current.endpointPair!.start).toBe(saved.endpointPair!.start);expect(current.endpointPair!.end).toBe(saved.endpointPair!.end);
 const resolve=vi.spyOn(evaluation,'resolveEndpointPairBasis');
 let result:ReturnType<typeof useSnapshotOnionFrames>|undefined;
 function Preview(){result=useSnapshotOnionFrames(preview,recording.id,recording.angle,{...DEFAULT_SCENE_ONION_SETTINGS,enabled:true,step:5},undefined,{startSnapshotId:'arbitrary',endSnapshotId:'invalid'},current);return null;}
 try{
  renderToStaticMarkup(createElement(Preview));expect(resolve).not.toHaveBeenCalled();expect(result?.error).toBeUndefined();expect(result?.frames).toHaveLength(19);
  for(const frame of result!.frames){const runtime=evaluateRecordingSnapshot(preview,recording.id,{angle:frame.angle,diagnostics:'preview'});expect(frame.drawing.nodes).toEqual(runtime.drawing.nodes);expect(frame.drawing.curves).toEqual(runtime.drawing.curves);}
  expect(preview.recordings[0].tracks).toEqual([]);expect(preview.snapshots).toHaveLength(2);
 }finally{resolve.mockRestore();}
});
