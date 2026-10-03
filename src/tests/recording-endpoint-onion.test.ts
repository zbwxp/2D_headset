import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {emptyDrawing,type Cubic,type DrawingDocument} from '../domain/drawing/model';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../domain/recordingSnapshot/model';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {parseLandmarks} from '../domain/landmarks/persistence';
import SceneOnionSkin,{SceneOnionControls} from '../ui/vectorRecording/SceneOnionSkin';
import {DEFAULT_SCENE_ONION_SETTINGS} from '../ui/vectorRecording/angleInspection';
import {createEndpointOnionCache,defaultSceneOnionEndpoints,interpolateEndpointOnion,sampleEndpointOnionAngles,type EndpointOnionGeometry} from '../ui/vectorRecording/endpointOnion';
import {extractEndpointOnionInk} from '../ui/vectorRecording/endpointOnionInk';
const at=(x:number,y=0)=>({x,y});
function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace();workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};workspace.library.curves={curve:{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.25,0],[.75,0]],width:.02,visible:true,locked:false}};
 const zero=emptyRecordingSnapshot('zero','Front','view'),side=emptyRecordingSnapshot('side','Side','view',at(-90)),middle=emptyRecordingSnapshot('middle','Middle','view',at(-45));
 for(const snapshot of [zero,side,middle])snapshot.layers=[{kind:'original',id:'layer',name:'Outline',items:['curve'],visible:true,locked:false}];
 const recording=emptySnapshotRecording('recording');recording.angle=at(-90);recording.snapshotIds=['zero','side','middle'];recording.activeSnapshotId='side';
 recording.tracks=[{id:'shape',channel:'shape',targetId:'layer',interpolation:'independent',keys:[{id:'front-shape',angle:at(0),value:{nodes:{},handles:{}}},{id:'side-shape',angle:at(-90),value:{nodes:{a:[.9,0]},handles:{curve:[[0,.6],[0,0]]}}},{id:'middle-shape',angle:at(-45),value:{nodes:{a:[8,3]},handles:{curve:[[2,8],[0,0]]}}}]}];
 workspace.snapshots=[zero,side,middle];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;return {workspace,recording};
}

test('two final endpoint controls blend halfway and completely ignore a nonlinear intermediate key',()=>{
 const {workspace,recording}=fixture(),before=JSON.stringify(workspace),cache=createEndpointOnionCache(),start=cache.resolve(workspace,recording.id,'zero',at(-90)),end=cache.resolve(workspace,recording.id,'side',at(-90));
 const result=interpolateEndpointOnion(start,end,5),half=result.frames.find(frame=>frame.angle.x===-45)!;
 expect(half.drawing.nodes.find(node=>node.id==='a')!.position).toEqual([.45,0]);
 for(const endIndex of [0,1] as const)for(const axis of [0,1] as const)expect(half.drawing.curves[0].handles[endIndex][axis]).toBeCloseTo((start.drawing.curves[0].handles[endIndex][axis]+end.drawing.curves[0].handles[endIndex][axis])/2);
 expect(evaluateRecordingSnapshot(workspace,recording.id,{angle:at(-45),useDraft:false,diagnostics:'preview'}).drawing.nodes.find(node=>node.id==='a')!.position).toEqual([8,3]);
 expect(result.frames.find(frame=>frame.highlight==='30')!.angle).toEqual(at(-30));expect(result.frames.find(frame=>frame.highlight==='60')!.angle).toEqual(at(-60));expect(JSON.stringify(workspace)).toBe(before);
});

test('dragging one selected endpoint evaluates only that endpoint and keeps the other cached',()=>{
 const {workspace,recording}=fixture(),evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate),start=cache.resolve(workspace,recording.id,'zero',at(-90));cache.resolve(workspace,recording.id,'side',at(-90));expect(evaluate).toHaveBeenCalledTimes(2);
 const original=recording.tracks[0];if(original.channel!=='shape')throw Error('Fixture shape track');
 const changed={...original,draft:{angle:at(-90),value:{nodes:{a:[2.7,0] as [number,number]},handles:{}}}},preview={...workspace,recordings:[{...recording,tracks:[changed]}]};
 const nextStart=cache.resolve(preview,recording.id,'zero',at(-90)),nextEnd=cache.resolve(preview,recording.id,'side',at(-90));
 expect(nextStart).toBe(start);expect(evaluate).toHaveBeenCalledTimes(3);expect(nextEnd.drawing.nodes.find(node=>node.id==='a')!.position).toEqual([2.7,0]);
 const calls=evaluate.mock.calls.map(([, ,options])=>options!.angle!.x);expect(calls).toEqual([0,-90,-90]);expect(recording.tracks[0].keys).toHaveLength(3);expect(recording.tracks[0].draft).toBeUndefined();
});

test('current canvas evaluation is reused with zero duplicate endpoint runtime calls',()=>{
 const {workspace,recording}=fixture(),current=evaluateRecordingSnapshot(workspace,recording.id,{snapshotId:'side',angle:at(-90),diagnostics:'preview'}),evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate);
 expect(cache.resolve(workspace,recording.id,'side',at(-90),undefined,current).drawing).toBe(current.drawing);expect(evaluate).not.toHaveBeenCalled();
});

function geometric(cubic:Cubic,spans:Array<[number,number]>):EndpointOnionGeometry {
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:cubic[0]},{id:'b',position:cubic[3]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[cubic[1],cubic[2]],width:.02,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}]};
 drawing.displayIntervals=[{id:'track',anchor:{id:'curve',reverse:false},ranges:spans.map(([start,end],index)=>({id:`range-${index}`,start,end}))}];
 return {snapshotId:'pose',angle:at(0),drawing};
}
test('full source ghosts ignore endpoint material ranges and hidden geometry flags',()=>{
 const cubic:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]],start=geometric(cubic,[[.1,.4]]),end={...geometric(cubic,[[.5,.9]]),angle:at(-90)};
 end.drawing.curves[0].visible=false;start.drawing.curves[0].inkVisible=false;start.drawing.layers[0].visible=false;
 const result=interpolateEndpointOnion(start,end,5);for(const frame of result.frames)expect(frame.centerlines).toEqual([{id:'curve:curve:0',cubic}]);
});

test('unmatched material ranges do not affect full source ghosts or produce material diagnostics',()=>{
 const cubic:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]],start=geometric(cubic,[[.1,.4]]),end={...geometric(cubic,[[.6,.9]]),angle:at(-90)};end.drawing.displayIntervals![0].ranges[0].id='other-range';
 const result=interpolateEndpointOnion(start,end,10);expect(result.diagnostics).toEqual([]);for(const frame of result.frames)expect(frame.centerlines).toEqual([{id:'curve:curve:0',cubic}]);
});

test('selected endpoints define the degree line and thin SVG controls declare the visibility policy',()=>{
 const {workspace}=fixture(),endpoints=defaultSceneOnionEndpoints(workspace.snapshots);expect(endpoints).toEqual({startSnapshotId:'zero',endSnapshotId:'side'});
 expect(sampleEndpointOnionAngles(at(0),at(-90),10)).toHaveLength(10);expect(sampleEndpointOnionAngles(at(0),at(-90),5)).toHaveLength(19);
 const controls=renderToStaticMarkup(createElement(SceneOnionControls,{settings:{...DEFAULT_SCENE_ONION_SETTINGS,enabled:true},onChange:()=>{},endpointViews:workspace.snapshots,endpoints,onEndpointsChange:()=>{},zh:true}));expect(controls).toContain('两端快照插值');expect(controls).toContain('Onion start snapshot');expect(controls).toContain('Onion end snapshot');expect(controls).toContain('不做显隐裁切或 ARC 修剪');expect(controls).not.toContain('Onion sweep axis');
 const cache=createEndpointOnionCache(),frames=interpolateEndpointOnion(cache.resolve(workspace,'recording','zero',at(-90)),cache.resolve(workspace,'recording','side',at(-90)),10).frames;
 const svg=renderToStaticMarkup(createElement(SceneOnionSkin,{frames,angle:at(-90),opacity:.16,screen:p=>p,unit:250}));expect(svg).toContain('scene-onion-centerline');expect(svg).toContain('stroke-width="1"');expect(svg).not.toContain('drawing-ink');expect(svg).not.toContain('drawing-fill');expect(svg).not.toContain('drawing-hit');
});

test('real three-piece face endpoint blend preserves canonical half controls and hidden closures',()=>{
 const project=ensureRecordingSnapshots(parseLandmarks(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'))),workspace=project.recordingSnapshots,recording=workspace.recordings[0],views=recording.snapshotIds.map(id=>workspace.snapshots.find(snapshot=>snapshot.id===id)!),zero=views.find(view=>view.angle.x===0&&view.angle.y===0)!,side=views.find(view=>Math.abs(view.angle.x)===90&&view.angle.y===0)!,before=JSON.stringify(workspace),cache=createEndpointOnionCache();
 expect(zero).toBeTruthy();expect(side).toBeTruthy();const start=cache.resolve(workspace,recording.id,zero.id,zero.angle),end=cache.resolve(workspace,recording.id,side.id,zero.angle),frames=interpolateEndpointOnion(start,end,5).frames,half=frames.find(frame=>Math.abs(frame.angle.x)===45)!;
 for(const curve of half.drawing.curves){const a=start.drawing.curves.find(value=>value.id===curve.id)!,b=end.drawing.curves.find(value=>value.id===curve.id)!;for(const index of [0,1] as const)for(const axis of [0,1] as const)expect(curve.handles[index][axis]).toBeCloseTo((a.handles[index][axis]+b.handles[index][axis])/2,10);}
 const closures=start.drawing.curves.filter(curve=>curve.name?.includes('内部闭合线'));expect(closures.length).toBeGreaterThan(0);for(const curve of closures){expect(extractEndpointOnionInk(start.drawing).curves[curve.id]?.segments??[]).toEqual([]);expect(frames.every(frame=>frame.centerlines!.some(line=>line.id===`curve:${curve.id}:0`))).toBe(true);}
 expect(JSON.stringify(workspace)).toBe(before);
});
