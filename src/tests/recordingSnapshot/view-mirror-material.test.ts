import {describe,expect,it} from 'vitest';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

const angle=(x:number)=>({x,y:0});
function fixture(reverse=true){
 const w=emptyRecordingSnapshotWorkspace();w.library.nodes={a:{id:'a',position:[-2,0]},b:{id:'b',position:[-1,0]},c:{id:'c',position:[1,0]},d:{id:'d',position:[2,0]}};
 w.library.curves={left:{id:'left',name:'Left',nodes:['a','b'],handles:[[-5/3,0],[-4/3,0]],width:.01,visible:true,locked:false},right:{id:'right',name:'Right',nodes:['c','d'],handles:[[4/3,0],[5/3,0]],width:.01,visible:true,locked:false}};
 const source=emptyRecordingSnapshot('source','Source','drawing');source.layers=[{kind:'original',id:'layer',name:'Layer',items:['left','right'],visible:true,locked:false}];source.source={artworkId:'asset',originIds:{},mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'left',b:'right',reverse}]}};
 source.relations.displayIntervals={add:[{id:'left-material',scope:'CURVE',anchor:{id:'left',reverse:false},ranges:[{id:'left-gap',mode:'HIDE',start:.3,end:.3},{id:'left-other',start:.1,end:.2}]},{id:'right-material',scope:'CURVE',anchor:{id:'right',reverse},ranges:[{id:'right-gap',mode:'HIDE',start:.3,end:.3},{id:'right-other',start:.1,end:.2}]}]};
 const zero=emptyRecordingSnapshot('zero','Zero','view',angle(0)),left=emptyRecordingSnapshot('left-view','Left','view',angle(-90)),right=emptyRecordingSnapshot('right-view','Right','view',angle(90));
 for(const view of [zero,left]){view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:source.id,baseLayerId:'layer'}];}
 left.relations.displayIntervals={update:source.relations.displayIntervals.add!.map(track=>({...structuredClone(track),ranges:track.ranges.map(range=>({...range,end:range.id.endsWith('gap')?.9:range.end}))}))};
 right.parentSnapshotId=left.id;right.parentLayers={};right.inputMirror={axisX:0,curvePairs:[]};right.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:left.id,baseLayerId:'layer'}];
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[zero.id,left.id,right.id];recording.activeSnapshotId=zero.id;recording.angle=angle(0);recording.angleGraph=createSnapshotAngleGraph([zero,left,right].map(view=>({snapshotId:view.id,angle:view.angle})));
 w.snapshots=[source,zero,left,right];w.recordings=[recording];w.activeRecordingId=recording.id;return w;
}
const evaluate=(w:RecordingSnapshotWorkspace,x:number,useDraft=false)=>evaluateRecordingSnapshot(w,'recording',{angle:angle(x),useDraft,diagnostics:'preview'});
const range=(w:RecordingSnapshotWorkspace,x:number,side=x>0?'right':'left',useDraft=false)=>evaluate(w,x,useDraft).drawing.displayIntervals!.find(track=>track.id===`${side}-material`)!.ranges.find(range=>range.id===`${side}-gap`)!;
function edit(w:RecordingSnapshotWorkspace,x:number,end:number,save=true){applySnapshotCommand(w,{op:'setAngle',angle:angle(x)});applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:x>0?'right-material':'left-material',rangeId:x>0?'right-gap':'left-gap',end});if(save)applySnapshotCommand(w,{op:'updateEndpointCorrection'});}
const geometry=(w:RecordingSnapshotWorkspace,x:number)=>{const d=evaluate(w,x).drawing;return {nodes:d.nodes,curves:d.curves};};

describe('live View mirror interval response fields',()=>{
 it('keeps the exact nonzero HIDE plateau through 30 degrees, then expands with directed reverse parity',()=>{
  for(const reverse of [false,true]){const w=fixture(reverse);edit(w,-30,range(w,-30).start);const before=JSON.stringify(w);
   for(const x of [0,.01,1,15,29.99,30]){const r=range(w,x,x===0?'left':'right');expect(r.start).toBeCloseTo(.3,13);expect(r.end).toBe(r.start);expect(r.mode).toBe('HIDE');}
   for(const x of [31,45,60,75,89,90]){expect(range(w,x).end).toBeCloseTo(range(w,-x).end,13);expect(range(w,x).start).toBeCloseTo(range(w,-x).start,13);expect(range(w,x).end).toBeGreaterThan(.3);}
   expect(JSON.stringify(w)).toBe(before);const loaded=parseRecordingSnapshots(JSON.parse(before));for(const x of [15,30,45,75])expect(range(loaded,x)).toEqual(range(w,x));
  }
 });
 it('updates saved and draft negative source fields live and keeps full-curve onions geometry-only',()=>{
  const w=fixture(),before=[15,30,45,75].map(x=>geometry(w,x));edit(w,-30,range(w,-30).start,false);
  expect(range(w,30,'right',true).end).toBe(range(w,30,'right',true).start);expect(range(w,30).end).toBeCloseTo(.5,13);
  applySnapshotCommand(w,{op:'updateEndpointCorrection'});expect(range(w,30).end).toBe(range(w,30).start);
  edit(w,-30,.42);expect(range(w,30).end).toBeCloseTo(.42,13);expect([15,30,45,75].map(x=>geometry(w,x))).toEqual(before);
  const current=evaluate(w,30),onion=interpolateSnapshotSurfaceOnion(w.recordings[0],current,{startSnapshotId:'zero',endSnapshotId:'right-view'},5);expect(onion.frames.length).toBeGreaterThan(0);for(const frame of onion.frames)expect({nodes:frame.drawing.nodes,curves:frame.drawing.curves}).toEqual(geometry(w,frame.angle.x));
 });
 it('replays positive independent property edits over the mirrored residual and preserves positive real-view overrides',()=>{
  const w=fixture();edit(w,-30,range(w,-30).start);const negative=JSON.stringify(w.recordings[0].angleGraph!.propertyResponses),before=range(w,-30);
  edit(w,30,.46,false);expect(range(w,30,'right',true).end).toBeCloseTo(.46,13);expect(range(w,30,'right',true).start).toBeCloseTo(.3,13);expect(range(w,-30)).toEqual(before);expect(JSON.stringify(w.recordings[0].angleGraph!.propertyResponses)).toBe(negative);
  applySnapshotCommand(w,{op:'discardEndpointCorrection'});expect(range(w,30).end).toBe(range(w,30).start);edit(w,30,.46);expect(range(w,30).end).toBeCloseTo(.46,13);
  applySnapshotCommand(w,{op:'setAngle',angle:angle(90)});applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:'right-material',rangeId:'right-gap',end:.72});applySnapshotCommand(w,{op:'saveSelected',layerIds:['layer']});
  expect(range(w,90).end).toBeCloseTo(.72,13);expect(range(w,-90).end).toBeCloseTo(.9,13);expect(range(w,45).end).not.toBeCloseTo(range(w,-45).end,10);
 });
 it('complements scalar values only for explicit canonical-forward split identities',()=>{
  const w=fixture(true);for(const view of [w.snapshots[0],w.snapshots[2]])for(const track of [...view.relations.displayIntervals?.add??[],...view.relations.displayIntervals?.update??[]])track.anchor.reverse=false;
  w.snapshots[3].inputMirror!.splitMaterials=[{a:'left-material',b:'right-material',ranges:[{a:'left-gap',b:'right-gap'},{a:'left-other',b:'right-other'}]}];
  edit(w,-30,range(w,-30).start);
  for(const x of [1,15,30,45,75]){const positive=range(w,x),negative=range(w,-x);expect(positive.start).toBeCloseTo(1-negative.start,13);expect(positive.end).toBeCloseTo(1-negative.end,13);if(x<=30)expect(positive.start).toBe(positive.end);}
 });
 it('samples reflected pitched triangles and zero-edge fields once, with positive inverse replay',()=>{
  const w=fixture(),r=w.recordings[0],up=w.snapshots.slice(1).map(view=>{const copy=structuredClone(view);copy.id+='-up';copy.angle.y=90;if(copy.parentSnapshotId==='left-view'){copy.parentSnapshotId+='-up';for(const layer of copy.layers)if(layer.kind==='reference')layer.baseSnapshotId='left-view-up';}return copy;});
  up[0].relations.displayIntervals={update:w.snapshots[0].relations.displayIntervals!.add!.map(track=>({...structuredClone(track),ranges:track.ranges.map(range=>({...range,end:range.id.endsWith('gap')?.7:range.end}))}))};
  w.snapshots.push(...up);r.snapshotIds.push(...up.map(view=>view.id));r.angleGraph=createSnapshotAngleGraph(w.snapshots.filter(view=>view.kind==='view').map(view=>({snapshotId:view.id,angle:view.angle})));
  applySnapshotCommand(w,{op:'setAngle',angle:{x:0,y:30}});for(const [side,end] of [['left',.32],['right',.57]] as const)applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:`${side}-material`,rangeId:`${side}-gap`,end});applySnapshotCommand(w,{op:'updateEndpointCorrection'});
  const sample=(x:number,y:number)=>evaluateRecordingSnapshot(w,'recording',{angle:{x,y},useDraft:false,diagnostics:'preview'}).drawing.displayIntervals!.find(track=>track.id===`${x>0?'right':'left'}-material`)!.ranges[0];
  for(const [x,y] of [[20,35],[60,20],[15,70],[70,65]])expect(sample(x,y).end).toBeCloseTo(sample(-x,y).end,12);
  applySnapshotCommand(w,{op:'setAngle',angle:{x:20,y:35}});applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:'right-material',rangeId:'right-gap',end:.55});applySnapshotCommand(w,{op:'updateEndpointCorrection'});expect(sample(20,35).end).toBeCloseTo(.55,12);
 });

});
