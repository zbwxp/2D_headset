import {expect,test,vi} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createEndpointOnionCache,interpolateEndpointOnion,type EndpointOnionGeometry} from '../../ui/vectorRecording/endpointOnion';

const at=(x:number)=>({x,y:0});
const point=(x:number,y=0):Point2=>[x,y];
function drawing(shared=false,linked=false):DrawingDocument {
 return {...emptyDrawing(),nodes:[{id:'a',position:point(0)},{id:'b',position:point(1)},...(!shared?[{id:'c',position:point(linked?1:2)}]:[]),{id:'d',position:point(linked||shared?2:3)}],curves:[{id:'left',name:'Left',nodes:['a','b'],handles:[point(1/3),point(2/3)],visible:true,locked:false,width:.01},{id:'right',name:'Right',nodes:[shared?'b':'c','d'],handles:[point(linked||shared?4/3:7/3),point(linked||shared?5/3:8/3)],visible:true,locked:false,width:.01}],layers:linked?[{id:'alpha',name:'Alpha',visible:true,locked:false,items:['left']},{id:'zeta',name:'Zeta',visible:true,locked:false,items:['right']}]:[{id:'layer',name:'Layer',visible:true,locked:false,items:['left','right']}],...(linked?{endpointLinks:[{id:'link',a:{curveId:'left',end:1},b:{curveId:'right',end:0}}]}:{})};
}
function translated(source:DrawingDocument,x=10):DrawingDocument {
 return {...source,nodes:source.nodes.map(node=>({...node,position:point(node.position[0]+x,node.position[1])})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(p=>point(p[0]+x,p[1])) as [Point2,Point2]}))};
}
const endpoint=(drawing:DrawingDocument,id='start',x=0):EndpointOnionGeometry=>({drawing,snapshotId:id,angle:at(x)});
test('endpoint ghosts linearly blend final geometry and preserve both exact endpoints',()=>{
 const source=drawing(),start=endpoint(source),end=endpoint(translated(source),'end',-90),before=JSON.stringify([start,end]),result=interpolateEndpointOnion(start,end,5),middle=result.frames.find(frame=>frame.angle.x===-45)!;
 expect(middle.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBe(5);expect(middle.drawing.nodes.find(node=>node.id==='c')!.position[0]).toBe(7);
 for(const [frame,basis] of [[result.frames[0],start],[result.frames.at(-1)!,end]] as const)for(const curve of basis.drawing.curves)expect(shapeOf(frame.drawing,curve.id)).toEqual(shapeOf(basis.drawing,curve.id));
 expect(JSON.stringify([start,end])).toBe(before);
});

test.each(['shared','linked'] as const)('%s endpoint ghosts stay connected with their relative handle vectors',mode=>{
 const source=drawing(mode==='shared',mode==='linked'),target=translated(source);target.curves[0].handles[1][1]=2;target.curves[1].handles[0][1]=4;
 const middle=interpolateEndpointOnion(endpoint(source),endpoint(target,'end',-90),5).frames.find(frame=>frame.angle.x===-45)!,left=shapeOf(middle.drawing,'left'),right=shapeOf(middle.drawing,'right');
 expect(left[3]).toEqual(right[0]);expect(left[3][0]).toBe(6);expect(left[2][0]).toBeCloseTo(6-1/3);expect(left[2][1]).toBe(1);expect(right[1][1]).toBe(2);
 expect(middle.centerlines!.find(line=>line.id==='curve:left:0')!.cubic).toEqual(left);expect(middle.centerlines!.find(line=>line.id==='curve:right:0')!.cubic).toEqual(right);
});

test('reversing endpoint order produces the same geometry at every angle',()=>{
 const source=drawing(),start=endpoint(source),end=endpoint(translated(source),'end',-90),forward=interpolateEndpointOnion(start,end,5),reverse=interpolateEndpointOnion(end,start,5);
 for(const frame of forward.frames){const other=reverse.frames.find(value=>Math.abs(value.angle.x-frame.angle.x)<1e-8)!;for(const node of frame.drawing.nodes){const position=other.drawing.nodes.find(value=>value.id===node.id)!.position;expect(node.position[0]).toBeCloseTo(position[0],12);expect(node.position[1]).toBeCloseTo(position[1],12);}}
});

test('full source ghosts remain complete regardless of material intervals and hidden geometry',()=>{
 const source=drawing();source.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'left',reverse:false},ranges:[{id:'show',start:.1,end:.4}]}];
 const target=translated(source);target.curves[0].visible=false;target.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'left',reverse:false},ranges:[{id:'show',start:.5,end:.9}]}];
 const result=interpolateEndpointOnion(endpoint(source),endpoint(target,'end',-90),5),middle=result.frames.find(frame=>frame.angle.x===-45)!,line=middle.centerlines!.find(value=>value.id==='curve:left:0')!;
 expect(line.cubic[0][0]).toBe(5);expect(line.cubic[3][0]).toBe(6);for(const frame of result.frames)expect(frame.centerlines!.map(line=>line.id)).toEqual(['curve:left:0','curve:right:0']);
});

test.each([false,true])('ARC-connected ghosts preserve full shared endpoints without derived trims (endpoint link: %s)',linked=>{
 const source=drawing(!linked,linked);source.nodes.find(node=>node.id==='a')!.position=point(-1);source.nodes.find(node=>node.id==='b')!.position=point(0);if(linked)source.nodes.find(node=>node.id==='c')!.position=point(0);source.nodes.find(node=>node.id==='d')!.position=point(0,1);source.curves[0].handles=[point(-2/3),point(-1/3)];source.curves[1].handles=[point(0,1/3),point(0,2/3)];
 if(linked){source.endpointLinks![0].throughDisplay=true;source.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.2};source.displayIntervals=[{id:'route',anchor:{id:'left',reverse:false},ranges:[{id:'coverage',start:0,end:1}],displayRoute:{seed:{segments:[{id:'left',reverse:false}],closed:false},throughLinkIds:['link']}}];}else source.joins=[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'right',end:0},mode:'ARC',radius:.2}];
 const result=interpolateEndpointOnion(endpoint(source),endpoint(translated(source),'end',-90),5);
 for(const frame of result.frames){expect(frame.centerlines!.filter(line=>line.id.startsWith('arc:'))).toEqual([]);const left=shapeOf(frame.drawing,'left'),right=shapeOf(frame.drawing,'right');expect(left[3]).toEqual(right[0]);expect(frame.centerlines!.find(line=>line.id==='curve:left:0')!.cubic).toEqual(left);}
});

function workspaceFixture(){
 const workspace=emptyRecordingSnapshotWorkspace(),source=drawing();workspace.library.nodes=Object.fromEntries(source.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries(source.curves.map(curve=>[curve.id,curve]));
 const start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',at(-90)),middle=emptyRecordingSnapshot('middle','Middle','view',at(-45));for(const snapshot of [start,end,middle])snapshot.layers=source.layers.map(layer=>({...layer,kind:'original'}));
 const recording=emptySnapshotRecording('recording');recording.snapshotIds=['start','end','middle'];recording.tracks=[{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'a',angle:at(0),value:{nodes:{a:point(0)},handles:{}}},{id:'b',angle:at(-90),value:{nodes:{a:point(10)},handles:{}}},{id:'middle-key',angle:at(-45),value:{nodes:{a:point(100)},handles:{}}}]}];workspace.snapshots=[start,end,middle];workspace.recordings=[recording];return {workspace,recording};
}

test('endpoint cache evaluates only two saved states and reuses the live canvas endpoint',()=>{
 const {workspace,recording}=workspaceFixture(),before=JSON.stringify(workspace),evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate),start=cache.resolve(workspace,recording.id,'start',at(0)),end=cache.resolve(workspace,recording.id,'end',at(0));
 expect(interpolateEndpointOnion(start,end,5).frames.find(frame=>frame.angle.x===-45)!.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBe(5);expect(evaluate).toHaveBeenCalledTimes(2);
 expect(cache.resolve(workspace,recording.id,'start',at(0))).toBe(start);expect(cache.resolve(workspace,recording.id,'end',at(0))).toBe(end);expect(evaluate).toHaveBeenCalledTimes(2);expect(JSON.stringify(workspace)).toBe(before);
 const canvas=evaluateRecordingSnapshot(workspace,recording.id,{snapshotId:'start',angle:at(0),diagnostics:'preview'}),fromCanvasEvaluate=vi.fn(evaluateRecordingSnapshot),fromCanvasCache=createEndpointOnionCache(fromCanvasEvaluate);
 expect(fromCanvasCache.resolve(workspace,recording.id,'start',at(0),undefined,canvas).drawing).toBe(canvas.drawing);expect(fromCanvasEvaluate).not.toHaveBeenCalled();
});

test('saved parent track revisions invalidate referenced endpoint geometry',()=>{
 const {workspace,recording}=workspaceFixture(),child=emptyRecordingSnapshot('child','Child');child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:'middle',baseLayerId:'layer'}];workspace.snapshots.push(child);recording.snapshotIds.push(child.id);
 const evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate),first=cache.resolve(workspace,recording.id,'child',at(0)),changed=structuredClone(workspace),track=changed.recordings[0].tracks[0];if(track.channel!=='shape')throw Error('Expected shape');track.keys[2].value.nodes.a=point(80);
 const next=cache.resolve(changed,recording.id,'child',at(0));expect(next).not.toBe(first);expect(evaluate).toHaveBeenCalledTimes(2);expect(first.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBe(100);expect(next.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBe(80);
});
