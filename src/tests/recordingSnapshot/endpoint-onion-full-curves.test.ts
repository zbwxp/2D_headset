import {expect,test,vi} from 'vitest';
import {emptyDrawing,shapeOf,sub,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import * as display from '../../domain/drawing/displayIntervals';
import * as routes from '../../domain/drawing/displayRoutes';
import * as sampling from '../../domain/drawing/sampling';
import * as rounded from '../../domain/drawing/roundedJoin';
import * as material from '../../domain/recordingSnapshot/endpointPairMaterial';
import * as onionInk from '../../ui/vectorRecording/endpointOnionInk';
import {interpolateEndpointPairDrawing,interpolateEndpointPairGeometry} from '../../domain/recordingSnapshot/endpointPair';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createEndpointOnionCache,interpolateEndpointOnion,interpolateEndpointPairOnion} from '../../ui/vectorRecording/endpointOnion';

const at=(x:number)=>({x,y:0});
function basis():DrawingDocument {
 return {...emptyDrawing(),nodes:[{id:'a',position:[-1,0]},{id:'b',position:[0,0]},{id:'c',position:[0,1]}],curves:[
  {id:'left',name:'Left',nodes:['a','b'],handles:[[-2/3,0],[-1/3,0]],visible:true,locked:false,width:.02},
  {id:'far',name:'Far face',nodes:['b','c'],handles:[[0,1/3],[0,2/3]],visible:false,locked:false,width:.02},
  {id:'closure',name:'Closure',nodes:['c','a'],handles:[[-.3,.8],[-.8,.2]],visible:true,inkVisible:false,locked:false,width:.02},
 ],layers:[{id:'layer',name:'Included source',items:['left','far','closure'],visible:false,locked:false}],
 joins:[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'far',end:0},mode:'ARC',radius:.2}],
 displayIntervals:[{id:'material',anchor:{id:'left',reverse:false},scope:'CURVE',ranges:[{id:'visible-cut',start:.2,end:.6}]}]};
}
function deformed(source:DrawingDocument):DrawingDocument {
 const transform=(p:Point2):Point2=>[p[0]*2+3,p[1]*3+1];
 return {...source,nodes:source.nodes.map(node=>({...node,position:transform(node.position)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(transform) as [Point2,Point2]}))};
}
const endpoint=(drawing:DrawingDocument,x:number)=>({drawing,angle:at(x),snapshotId:String(x)});

test('both full-curve ghost samplers make zero material, route, arclength, ARC or ink calls',()=>{
 const start=endpoint(basis(),0),end=endpoint(deformed(start.drawing),-90),before=JSON.stringify([start,end]);
 const spies=[vi.spyOn(material,'transportEndpointPairMaterial'),vi.spyOn(material,'endpointPairDisplayField'),vi.spyOn(display,'displayField'),vi.spyOn(routes,'resolveDisplayRoute'),vi.spyOn(sampling,'arcField'),vi.spyOn(rounded,'roundedJoins'),vi.spyOn(rounded,'subcurve'),vi.spyOn(onionInk,'extractEndpointOnionInk')];
 try{
  for(const result of [interpolateEndpointPairOnion(start,end,5),interpolateEndpointOnion(start,end,5)]){
   expect(result.frames).toHaveLength(19);
   for(const frame of result.frames){expect(frame.centerlines).toHaveLength(3);expect(frame.centerlines).toEqual(frame.drawing.curves.map(curve=>({id:`curve:${curve.id}:0`,cubic:shapeOf(frame.drawing,curve.id)})));}
   expect(result.frames.find(frame=>frame.highlight==='30')?.angle).toEqual(at(-30));expect(result.frames.find(frame=>frame.highlight==='60')?.angle).toEqual(at(-60));
  }
  for(const spy of spies)expect(spy).not.toHaveBeenCalled();expect(JSON.stringify([start,end])).toBe(before);
 }finally{spies.forEach(spy=>spy.mockRestore());}
});

test('geometry-only sampler shares runtime controls while the main sampler still transports material',()=>{
 const start=basis(),end=deformed(start),responses={nodes:{b:{x:[[.5,.2] as Point2],y:[[.5,.8] as Point2]}},handles:{}},before=JSON.stringify([start,end,responses]);
 const transport=vi.spyOn(material,'transportEndpointPairMaterial');
 try{
  const geometry=interpolateEndpointPairGeometry(start,end,.5,responses);expect(transport).not.toHaveBeenCalled();
  const runtime=interpolateEndpointPairDrawing(start,end,.5,responses);expect(transport).toHaveBeenCalledTimes(2);expect(runtime.drawing.nodes).toEqual(geometry.drawing.nodes);expect(runtime.drawing.curves).toEqual(geometry.drawing.curves);
  expect(interpolateEndpointPairGeometry(start,end,0,responses).drawing).toBe(start);expect(interpolateEndpointPairGeometry(start,end,1,responses).drawing).toBe(end);expect(JSON.stringify([start,end,responses])).toBe(before);
 }finally{transport.mockRestore();}
});

test.each([false,true])('full ghosts preserve explicit SMOOTH and exact endpoints (endpoint pair: %s)',pair=>{
 const start=basis();start.joins=[{id:'smooth',a:{curveId:'left',end:1},b:{curveId:'far',end:0},mode:'SMOOTH'}];start.curves[1].handles[0]=[.4,0];
 const end=structuredClone(start);end.curves[0].handles[1]=[0,-1/3];end.curves[1].handles[0]=[0,.4];
 const recording=emptySnapshotRecording('recording');recording.interpolationWeights=[{id:'slow',target:{layerId:'layer',curveId:'far'},startSnapshotId:'0',endSnapshotId:'-90',points:[[0,0],[.5,.1],[1,1]]}];
 const result=pair?interpolateEndpointPairOnion(endpoint(start,0),endpoint(end,-90),5,{nodes:{},handles:{far:[{x:[[.5,.1]],y:[[.5,.8]]},{}]}}):interpolateEndpointOnion(endpoint(start,0),endpoint(end,-90),5,recording),middle=result.frames.find(frame=>frame.angle.x===-45)!,left=shapeOf(middle.drawing,'left'),right=shapeOf(middle.drawing,'far'),a=sub(left[2],left[3]),b=sub(right[1],right[0]);
 expect(left[3]).toEqual(right[0]);expect(a[0]*b[1]-a[1]*b[0]).toBeCloseTo(0,12);expect(result.diagnostics.some(message=>message.includes('stable driver'))).toBe(true);
 for(const [frame,drawing] of [[result.frames[0],start],[result.frames.at(-1)!,end]] as const)for(const line of frame.centerlines!)expect(line.cubic).toEqual(shapeOf(drawing,line.id.slice(6,-2)));
});

test('hidden referenced source curves are included without pulling unreferenced library geometry into ghosts',()=>{
 const source=basis(),workspace=emptyRecordingSnapshotWorkspace(),parent=emptyRecordingSnapshot('source','Source','drawing'),start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',at(-90)),recording=emptySnapshotRecording('recording');
 workspace.library.nodes=Object.fromEntries(source.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries([...source.curves,{...source.curves[0],id:'unreferenced'}].map(curve=>[curve.id,curve]));
 parent.layers=source.layers.map(layer=>({...layer,kind:'original'}));parent.layers.push({kind:'original',id:'excluded',name:'Excluded source',items:['unreferenced'],visible:true,locked:false});
 for(const snapshot of [start,end])snapshot.layers=[{kind:'reference',id:'included',name:'Included',baseSnapshotId:parent.id,baseLayerId:'layer'}];
 workspace.snapshots=[parent,start,end];recording.snapshotIds=['start','end'];recording.mode='endpoint-pair';recording.endpointPair={axis:'x',startSnapshotId:'start',endSnapshotId:'end'};workspace.recordings=[recording];
 const a=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(0),diagnostics:'preview'}),b=evaluateRecordingSnapshot(workspace,recording.id,{angle:at(-90),diagnostics:'preview'}),before=JSON.stringify(workspace),extract=vi.spyOn(onionInk,'extractEndpointOnionInk');
 try{
  const cache=createEndpointOnionCache();cache.resolve(workspace,recording.id,'start',at(0),undefined,a);expect(extract).not.toHaveBeenCalled();
  for(const frame of interpolateEndpointPairOnion(a,b,10).frames)expect(frame.centerlines!.map(line=>line.id).sort()).toEqual(['curve:closure:0','curve:far:0','curve:left:0']);
  expect(JSON.stringify(workspace)).toBe(before);
 }finally{extract.mockRestore();}
});
