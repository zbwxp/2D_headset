import {test,expect} from 'vitest';
import {addDrawingRegion,editDrawingRegion,enableDrawingRegions,removeDrawingRegion,drawingIntervals,finalDrawingStrokes,curveDrawingPieces,cubicSpan,pointOnCubic,pointOnDrawingCurve} from '../domain/recording/drawingRegions';
import {createRecorded,duplicate,editShape} from '../domain/recording/commands';
import {bindEndpoints,evaluateRecording} from '../domain/recording/junctions';
import {smoothGeometry,setSmoothMode} from '../domain/recording/smooth';
import {emptyRecording,parseRecording,displayShape,type Cubic,type Recording} from '../domain/recording/model';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
const v={yaw:0,pitch:0};
const base=()=>createRecorded(emptyRecording(),v,'a','A');
const strokes=(r:Recording)=>finalDrawingStrokes(r.curves,smoothGeometry(r,v));
const close=(a:number[],b:number[])=>a.forEach((x,i)=>expect(x).toBeCloseTo(b[i],10));

test('display spans clip exact cubic geometry and never write authoring keys or solver inputs',()=>{
 const r=base(),shape=r.curves[0].keys[0].shape;
 expect(strokes(r)).toHaveLength(1);expect(strokes(r)[0].shape).toEqual(shape);
 let n=addDrawingRegion(r,'a','r1',.4,.15);n=addDrawingRegion(n,'a','r2',.65,.9);
 expect(n.curves[0].keys).toBe(r.curves[0].keys);
 expect(evaluateRecording(n,v)).toEqual(evaluateRecording(r,v));
 expect(smoothGeometry(n,v)).toEqual(smoothGeometry(r,v));
 const output=strokes(n);expect(output).toHaveLength(2);
 for(const {shape:segment,interval:[a,b]} of output)for(const t of [0,.1,.5,.9,1])close(pointOnCubic(segment,t),pointOnCubic(shape,a+(b-a)*t));
 expect(n.curves[0].drawing?.regions[0]).toEqual({id:'r1',start:.15,end:.4});
});
test('overlap is unioned, enable/disable preserves regions, empty restriction draws nothing',()=>{
 let r=addDrawingRegion(base(),'a','r1',.1,.5);r=addDrawingRegion(r,'a','r2',.3,.6);r=addDrawingRegion(r,'a','r3',.6,.9);
 expect(strokes(r)).toHaveLength(1);expect(strokes(r)[0].interval).toEqual([.1,.9]);
 const off=enableDrawingRegions(r,'a',false);expect(drawingIntervals(off.curves[0])).toEqual([[0,1]]);expect(off.curves[0].drawing?.regions).toBe(r.curves[0].drawing?.regions);
 expect(enableDrawingRegions(off,'a',false)).toBe(off);
 for(const id of ['r1','r2','r3'])r=removeDrawingRegion(r,'a',id);
 expect(strokes(r)).toHaveLength(0);expect(strokes(enableDrawingRegions(r,'a',false))).toHaveLength(1);
});
test('views, negative yaw, Auto-Key, duplicate and JSON roundtrip preserve curve-attached regions',()=>{
 let r=addDrawingRegion(base(),'a','r',.125,.75);r=editShape(r,'a',{yaw:60,pitch:0},s=>{s[1][1]+=.2;return s;});
 const d=r.curves[0].drawing;
 const positive=finalDrawingStrokes(r.curves,smoothGeometry(r,{yaw:30,pitch:0}));
 const negative=finalDrawingStrokes(r.curves,smoothGeometry(r,{yaw:-30,pitch:0}));
 expect(negative).toEqual(positive);
 const mirror=displayShape(negative[0].shape,{yaw:-30,pitch:0});mirror.forEach((p,i)=>close(p,[-positive[0].shape[i][0],positive[0].shape[i][1]]));
 const copy=duplicate(r,'a',v,'b',[0,0]);expect(copy.curves[1].drawing).toEqual(d);expect(copy.curves[1].drawing).not.toBe(d);
 const next=editDrawingRegion(copy,'b','r',.2,.8);expect(next.curves[0].drawing).toBe(d);
 const project={...createLandmarkProject(),recording:next};expect(parseLandmarks(JSON.stringify(project)).recording).toBeUndefined();
});
test('invalid region data is rejected; zero spans and locked edits are no-ops',()=>{
 const r=base();for(const [a,b] of [[0,0],[-1,.5],[.5,2],[NaN,.5]])expect(addDrawingRegion(r,'a','x',a,b)).toBe(r);
 const n=addDrawingRegion(r,'a','x',.2,.8),lock={...n,curves:n.curves.map(c=>({...c,locked:true}))};
 expect(removeDrawingRegion(lock,'a','x')).toBe(lock);expect(enableDrawingRegions(lock,'a',false)).toBe(lock);
 expect(addDrawingRegion(n,'a','x',.1,.9)).toBe(n);expect(editDrawingRegion(n,'a','x',.9,.2)).toBe(n);
 for(const drawing of [null,{enabled:1,regions:[]},{enabled:true,regions:[{id:'x',start:0,end:2}]},{enabled:true,regions:[{id:'x',start:.5,end:.2}]},{enabled:true,regions:[{id:'x',start:0,end:1},{id:'x',start:0,end:1}]}])expect(()=>parseRecording({...n,curves:[{...n.curves[0],drawing}]})).toThrow();
 expect(parseRecording(r)).toEqual(r);
});
test('Smooth display provenance clips both halves in every endpoint orientation without changing G1 geometry',()=>{
 for(const ae of [0,3] as const)for(const be of [0,3] as const){
  const a:Cubic=[[-1,1],[-.8,.5],[-.3,0],[0,0]],b:Cubic=[[0,0],[.3,0],[.8,.5],[1,1]];
  let r=createRecorded(emptyRecording(),v,'a','A',(ae===0?[...a].reverse():a) as Cubic);
  r=createRecorded(r,v,'b','B',(be===3?[...b].reverse():b) as Cubic);
  r=bindEndpoints(r,{id:'a',end:ae},{id:'b',end:be},v,'j');r=setSmoothMode(r,'j',v,true);
  const smooth=smoothGeometry(r,v),tr=smooth.transitions[0];expect(tr).toBeDefined();
  const whole=strokes(r);expect(whole).toHaveLength(3);expect(whole.find(x=>x.kind==='transition')!.shape).toEqual(tr.shape);
  for(const trim of tr.trims){
   const pieces=curveDrawingPieces(trim.id,smooth),at=pointOnDrawingCurve(pieces,trim.t)!;
   close(at,tr.shape[trim.id==='a'?0:3]);
   close(pointOnDrawingCurve(pieces,trim.end===0?0:1)!,pointOnCubic(tr.shape,.5));
  }
  // Only first half's last half is selected; the other curve draws nothing.
  const trim=tr.trims[0],end=ae===0?0:1,start=(trim.t+end)/2;
  let n=addDrawingRegion(r,'a','partial',start,end);n=enableDrawingRegions(n,'b',true);
  expect(smoothGeometry(n,v)).toEqual(smooth);
  const partial=strokes(n);expect(partial).toHaveLength(1);expect(partial[0].kind).toBe('transition');
  close(partial[0].interval,[.25,.5]);close(partial[0].shape[0],pointOnCubic(tr.shape,.25));close(partial[0].shape[3],pointOnCubic(tr.shape,.5));
  // Restrict both sources away from the join: no stray transition remains.
  n=r;for(const id of ['a','b'])n=addDrawingRegion(n,id,id,.2,.7);
  expect(strokes(n).filter(x=>x.kind==='transition')).toHaveLength(0);
  const crossing=ae===0?[0,.7]:[.2,1];
  n=enableDrawingRegions(addDrawingRegion(r,'a','cross',crossing[0],crossing[1]),'b',true);
  const visible=strokes(n),source=visible.find(x=>x.kind==='source')!,bridge=visible.find(x=>x.kind==='transition')!;
  close(source.shape[ae],bridge.shape[0]);expect(visible).toHaveLength(2);
 }
});
test('empty visible sets omit all strokes and tiny spans retain exact endpoints',()=>{
 const shape:Cubic=[[-1,0],[-.5,.7],[.5,-.7],[1,0]];
 const fake={sources:new Map([['a',cubicSpan(shape,[.2,.8])]]),warnings:new Map(),transitions:[]};
 expect(curveDrawingPieces('missing',fake)).toEqual([]);
 expect(finalDrawingStrokes([],fake)).toEqual([]);
 // Also exercise very short spans near the end without a sampled-polyline approximation.
 const tiny=cubicSpan(shape,[.9999,1]);close(tiny[0],pointOnCubic(shape,.9999));close(tiny[3],shape[3]);
});
