import {expect,test,vi} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotOnionInspectionCache} from '../../ui/vectorRecording/angleInspection';
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
function response(recording:SnapshotRecording,id:string,layerId:string,value:number,curveId?:string){
 (recording.interpolationWeights??=[]).push({id,target:{layerId,...(curveId?{curveId}:{})},startSnapshotId:'start',endSnapshotId:'end',points:[point(0),point(.5,value),point(1,1)]});
}
const half=(start:EndpointOnionGeometry,end:EndpointOnionGeometry,recording:SnapshotRecording)=>interpolateEndpointOnion(start,end,5,recording).frames.find(frame=>frame.angle.x===-45)!;

test('endpoint geometry uses curve response before layer fallback, preserves endpoints, and supports explicit linear overrides',()=>{
 const source=drawing(),start=endpoint(source),end=endpoint(translated(source),'end',-90),recording=emptySnapshotRecording('recording');response(recording,'slow','layer',.2);response(recording,'fast','layer',.8,'left');
 const before=JSON.stringify([start,end,recording]),result=interpolateEndpointOnion(start,end,5,recording),middle=result.frames.find(frame=>frame.angle.x===-45)!;
 expect(middle.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(8);expect(middle.drawing.nodes.find(node=>node.id==='c')!.position[0]).toBeCloseTo(4);
 expect(shapeOf(result.frames[0].drawing,'left')).toEqual(shapeOf(source,'left'));expect(shapeOf(result.frames.at(-1)!.drawing,'left')).toEqual(shapeOf(end.drawing,'left'));
 expect(JSON.stringify([start,end,recording])).toBe(before);
 recording.interpolationWeights![1].points=[point(0),point(1,1)];expect(half(start,end,recording).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(5);
 recording.interpolationWeights!.pop();expect(half(start,end,recording).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(2);
 expect(half(start,end,emptySnapshotRecording('none')).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(5);
});

test.each(['shared','linked'] as const)('%s endpoints keep one position authority and response-specific handle vectors',mode=>{
 const source=drawing(mode==='shared',mode==='linked'),target=translated(source),start=endpoint(source),end=endpoint(target,'end',-90),recording=emptySnapshotRecording('recording'),layer=mode==='linked'?'alpha':'layer';
 target.curves[0].handles[1][1]=2;target.curves[1].handles[0][1]=4;
 response(recording,'layer',layer,.25);response(recording,'fast',layer,.8,'left');response(recording,'slow',mode==='linked'?'zeta':'layer',.1,'right');
 const result=interpolateEndpointOnion(start,end,5,recording),middle=result.frames.find(frame=>frame.angle.x===-45)!,left=shapeOf(middle.drawing,'left'),right=shapeOf(middle.drawing,'right');
 expect(left[3]).toEqual(right[0]);expect(left[3][0]).toBeCloseTo(3.5);expect(left[2][0]).toBeCloseTo(3.5-1/3);expect(left[2][1]).toBeCloseTo(1.6);expect(right[1][1]).toBeCloseTo(.4);
 const leftInk=middle.centerlines!.find(line=>line.id==='curve:left:0')!.cubic,rightInk=middle.centerlines!.find(line=>line.id==='curve:right:0')!.cubic;expect(leftInk[3]).toEqual(rightInk[0]);expect(leftInk).toEqual(left);expect(rightInk).toEqual(right);
 expect(result.diagnostics.some(message=>message.includes('conflicting curve responses'))).toBe(true);
});

test('reversing endpoint order produces the same weighted geometry at every angle',()=>{
 const source=drawing(),start=endpoint(source),end=endpoint(translated(source),'end',-90),recording=emptySnapshotRecording('recording');response(recording,'slow','layer',.2);response(recording,'fast','layer',.8,'left');
 const forward=interpolateEndpointOnion(start,end,5,recording),reverse=interpolateEndpointOnion(end,start,5,recording);
 for(const frame of forward.frames){const other=reverse.frames.find(value=>Math.abs(value.angle.x-frame.angle.x)<1e-8)!;for(const node of frame.drawing.nodes){const position=other.drawing.nodes.find(value=>value.id===node.id)!.position;expect(node.position[0]).toBeCloseTo(position[0],12);expect(node.position[1]).toBeCloseTo(position[1],12);}}
});

test('full source ghosts retain slow geometry response regardless of material and visibility',()=>{
 const source=drawing();source.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'left',reverse:false},ranges:[{id:'show',start:.1,end:.4}]}];
 const target=translated(source);target.displayIntervals=[{id:'mask',scope:'CURVE',anchor:{id:'left',reverse:false},ranges:[{id:'show',start:.5,end:.9}]}];
 const start=endpoint(source),end=endpoint(target,'end',-90),recording=emptySnapshotRecording('recording');response(recording,'slow','layer',.2);
 const middle=half(start,end,recording),line=middle.centerlines!.find(value=>value.id==='curve:left:0')!;expect(line.cubic[0][0]).toBeCloseTo(2);expect(line.cubic[3][0]).toBeCloseTo(3);
 target.curves[0].visible=false;const hidden=endpoint(target,'end',-90),result=interpolateEndpointOnion(start,hidden,5,recording);expect(result.frames.find(frame=>frame.angle.x===-30)!.centerlines!.some(line=>line.id.startsWith('curve:left:'))).toBe(true);expect(result.frames.find(frame=>frame.angle.x===-45)!.centerlines!.some(line=>line.id.startsWith('curve:left:'))).toBe(true);
});

test.each([false,true])('ARC-connected source curves retain individual responses with full shared endpoints (endpoint link: %s)',linked=>{
 const source=drawing(!linked,linked);source.nodes.find(node=>node.id==='a')!.position=point(-1);source.nodes.find(node=>node.id==='b')!.position=point(0);if(linked)source.nodes.find(node=>node.id==='c')!.position=point(0);source.nodes.find(node=>node.id==='d')!.position=point(0,1);source.curves[0].handles=[point(-2/3),point(-1/3)];source.curves[1].handles=[point(0,1/3),point(0,2/3)];
 if(linked){source.endpointLinks![0].throughDisplay=true;source.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.2};source.displayIntervals=[{id:'route',anchor:{id:'left',reverse:false},ranges:[{id:'coverage',start:0,end:1}],displayRoute:{seed:{segments:[{id:'left',reverse:false}],closed:false},throughLinkIds:['link']}}];}else source.joins=[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'right',end:0},mode:'ARC',radius:.2}];
 const start=endpoint(source),end=endpoint(translated(source),'end',-90),recording=emptySnapshotRecording('recording'),layer=linked?'alpha':'layer';response(recording,'relation',layer,.25);response(recording,'left',layer,.8,'left');response(recording,'right',linked?'zeta':'layer',.1,'right');
 const result=interpolateEndpointOnion(start,end,5,recording),middle=result.frames.find(frame=>frame.angle.x===-45)!,left=middle.centerlines!.find(line=>line.id==='curve:left:0')!.cubic,right=middle.centerlines!.find(line=>line.id==='curve:right:0')!.cubic,arcs=middle.centerlines!.filter(line=>line.id.startsWith('arc:'));
 expect(arcs).toEqual([]);expect(left[3]).toEqual(right[0]);expect(left).toEqual(shapeOf(middle.drawing,'left'));expect(right).toEqual(shapeOf(middle.drawing,'right'));expect(shapeOf(middle.drawing,'left')[0][0]).toBeCloseTo(7);
});

test('endpoint onion evaluates only two saved states and response edits reuse fixed endpoint geometry',()=>{
 const workspace=emptyRecordingSnapshotWorkspace(),source=drawing();workspace.library.nodes=Object.fromEntries(source.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries(source.curves.map(curve=>[curve.id,curve]));
 const start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',at(-90)),middle=emptyRecordingSnapshot('middle','Middle','view',at(-45));for(const snapshot of [start,end,middle])snapshot.layers=source.layers.map(layer=>({...layer,kind:'original'}));
 const recording=emptySnapshotRecording('recording');recording.snapshotIds=['start','end','middle'];recording.tracks=[{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'a',angle:at(0),value:{nodes:{a:point(0)},handles:{}}},{id:'b',angle:at(-90),value:{nodes:{a:point(10)},handles:{}}},{id:'middle-key',angle:at(-45),value:{nodes:{a:point(100)},handles:{}}}]}];response(recording,'slow','layer',.2);workspace.snapshots=[start,end,middle];workspace.recordings=[recording];
 const evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate),first=cache.resolve(workspace,recording.id,'start',at(0)),last=cache.resolve(workspace,recording.id,'end',at(0)),result=interpolateEndpointOnion(first,last,5,recording);expect(evaluate).toHaveBeenCalledTimes(2);expect(result.frames.find(frame=>frame.angle.x===-45)!.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(2);
 const inspection=createSnapshotOnionInspectionCache(),old=inspection.get(workspace,recording.id,at(0)),changedRecording={...recording,interpolationWeights:recording.interpolationWeights!.map(asset=>({...asset,points:[point(0),point(.5,.8),point(1,1)]}))},changed={...workspace,recordings:[changedRecording]},updated=inspection.get(changed,recording.id,at(0));expect(updated).not.toBe(old);expect(updated.recordings[0].interpolationWeights).toBe(changedRecording.interpolationWeights);expect(updated.library).toBe(old.library);
 expect(cache.resolve(changed,recording.id,'start',at(0))).toBe(first);expect(cache.resolve(changed,recording.id,'end',at(0))).toBe(last);expect(evaluate).toHaveBeenCalledTimes(2);
 expect(half(first,last,changedRecording).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(8);
 const removed=inspection.get({...workspace,recordings:[{...recording,interpolationWeights:undefined}]},recording.id,at(0));expect(removed).not.toBe(old);expect(removed.recordings[0].interpolationWeights).toBeUndefined();
 expect(cache.resolve({...workspace,recordings:[{...recording,interpolationWeights:undefined}]},recording.id,'start',at(0))).toBe(first);
 const middleBefore=cache.resolve(workspace,recording.id,'middle',at(0));expect(cache.resolve(changed,recording.id,'middle',at(0))).not.toBe(middleBefore);expect(evaluate).toHaveBeenCalledTimes(4);
 const canvas=evaluateRecordingSnapshot(workspace,recording.id,{snapshotId:'start',angle:at(0),diagnostics:'preview'}),fromCanvasEvaluate=vi.fn(evaluateRecordingSnapshot),fromCanvasCache=createEndpointOnionCache(fromCanvasEvaluate),reused=fromCanvasCache.resolve(workspace,recording.id,'start',at(0),undefined,canvas);
 expect(reused.drawing).toBe(canvas.drawing);expect(fromCanvasCache.resolve(changed,recording.id,'start',at(0),undefined,canvas)).toBe(reused);expect(fromCanvasEvaluate).not.toHaveBeenCalled();
});

test('response revisions invalidate an endpoint whose saved parent is inside another pair',()=>{
 const workspace=emptyRecordingSnapshotWorkspace(),source=drawing();workspace.library.nodes=Object.fromEntries(source.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries(source.curves.map(curve=>[curve.id,curve]));
 const start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',at(-90)),parent=emptyRecordingSnapshot('parent','Parent','view',at(-45)),child=emptyRecordingSnapshot('child','Child','view',at(0));for(const snapshot of [start,end,parent])snapshot.layers=source.layers.map(layer=>({...layer,kind:'original'}));child.layers=[{kind:'reference',id:'child-layer',name:'Child layer',baseSnapshotId:parent.id,baseLayerId:'layer'}];
 const recording=emptySnapshotRecording('recording');recording.snapshotIds=['start','end','parent','child'];recording.tracks=[{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'zero',angle:at(0),value:{nodes:{a:point(0)},handles:{}}},{id:'side',angle:at(-90),value:{nodes:{a:point(10)},handles:{}}}]}];response(recording,'weight','layer',.2);workspace.snapshots=[start,end,parent,child];workspace.recordings=[recording];
 const evaluate=vi.fn(evaluateRecordingSnapshot),cache=createEndpointOnionCache(evaluate),first=cache.resolve(workspace,recording.id,'child',at(0)),changed={...workspace,recordings:[{...recording,interpolationWeights:recording.interpolationWeights!.map(asset=>({...asset,points:[point(0),point(.5,.8),point(1,1)]}))}]},last=cache.resolve(changed,recording.id,'child',at(0));
 expect(last).not.toBe(first);expect(evaluate).toHaveBeenCalledTimes(2);expect(first.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(2);expect(last.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(8);
});

test('nonlinear responses preserve complete source curves and exact endpoints without ARC trims',()=>{
 const source=drawing(true);source.nodes=[{id:'a',position:point(-1)},{id:'b',position:point(0)},{id:'d',position:point(0,1)}];source.curves[0].handles=[point(-2/3),point(-1/3)];source.curves[1].handles=[point(0,1/3),point(0,2/3)];source.joins=[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'right',end:0},mode:'ARC',radius:.2}];
 const target={...source,nodes:source.nodes.map(node=>({...node,position:point(node.position[0]*2+10,node.position[1]*2)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(p=>point(p[0]*2+10,p[1]*2)) as [Point2,Point2]}))},start=endpoint(source),end=endpoint(target,'end',-90),recording=emptySnapshotRecording('recording');response(recording,'weight','layer',.25);
 const result=interpolateEndpointOnion(start,end,5,recording),middle=result.frames.find(frame=>frame.angle.x===-45)!,left=middle.centerlines!.find(line=>line.id==='curve:left:0')!.cubic,right=middle.centerlines!.find(line=>line.id==='curve:right:0')!.cubic,arcs=middle.centerlines!.filter(line=>line.id.startsWith('arc:'));
 expect(arcs).toEqual([]);expect(left[3]).toEqual(right[0]);
 for(const [frame,geometry] of [[result.frames[0],start],[result.frames.at(-1)!,end]] as const)expect(frame.centerlines).toEqual(geometry.drawing.curves.map(curve=>({id:`curve:${curve.id}:0`,cubic:shapeOf(geometry.drawing,curve.id)})));
 const legacy=interpolateEndpointOnion(start,end,5);recording.interpolationWeights![0].points=[point(0),point(1,1)];expect(interpolateEndpointOnion(start,end,5,recording)).toEqual(legacy);
});

test('editing an ARC neighbor from 37% to 15% changes full ghosts without moving shared-node authority',()=>{
 const source=drawing(true);source.nodes=[{id:'a',position:point(-1)},{id:'b',position:point(0)},{id:'d',position:point(0,1)}];source.curves[0].handles=[point(-2/3),point(-1/3)];source.curves[1].handles=[point(0,1/3),point(0,2/3)];source.joins=[{id:'arc',a:{curveId:'left',end:1},b:{curveId:'right',end:0},mode:'ARC',radius:.2}];
 source.nodes.push({id:'u',position:point(-2,2)},{id:'v',position:point(-1,2)});source.curves.push({...source.curves[0],id:'unrelated',nodes:['u','v'],handles:[point(-1.7,2),point(-1.3,2)]});source.layers[0].items.push('unrelated');
 const target={...source,nodes:source.nodes.map(node=>({...node,position:point(node.position[0]*2+10,node.position[1]*2)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(p=>point(p[0]*2+10,p[1]*2)) as [Point2,Point2]}))},start=endpoint(source),end=endpoint(target,'end',-90),recording=emptySnapshotRecording('recording');response(recording,'jaw','layer',.37,'left');
 const first=interpolateEndpointOnion(start,end,10,recording);recording.interpolationWeights![0].points=[point(0),point(.5,.15),point(1,1)];const second=interpolateEndpointOnion(start,end,10,recording);
 for(let index=0;index<first.frames.length;index++){
  const before=first.frames[index],after=second.frames[index];expect(after.centerlines!.find(line=>line.id==='curve:unrelated:0')).toEqual(before.centerlines!.find(line=>line.id==='curve:unrelated:0'));expect(before.drawing.nodes.find(node=>node.id==='b')!.position).toEqual(after.drawing.nodes.find(node=>node.id==='b')!.position);
  const beforeJaw=before.centerlines!.find(line=>line.id==='curve:left:0')!.cubic,afterJaw=after.centerlines!.find(line=>line.id==='curve:left:0')!.cubic;
  if(index===0||index===first.frames.length-1)expect(after.centerlines).toEqual(before.centerlines);else expect(afterJaw).not.toEqual(beforeJaw);
  for(const frame of [before,after]){const left=frame.centerlines!.find(line=>line.id==='curve:left:0')!.cubic,right=frame.centerlines!.find(line=>line.id==='curve:right:0')!.cubic,arcs=frame.centerlines!.filter(line=>line.id.startsWith('arc:')).map(line=>line.cubic),pieces=[left,...arcs,right];for(let piece=0;piece<pieces.length-1;piece++)for(const axis of [0,1] as const)expect(pieces[piece][3][axis]).toBeCloseTo(pieces[piece+1][0][axis],10);}
 }
});
