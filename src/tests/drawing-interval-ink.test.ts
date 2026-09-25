import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,type DrawingDocument as Doc,type Cubic,type InkEndStyle} from '../domain/drawing/model';
import {addDisplayInterval,changeDisplayInterval,setDisplayIntervalEnd,displayPath,displayField} from '../domain/drawing/displayIntervals';
import {strokeInk,fillVisible,fillGeometry,inkRuns} from '../domain/drawing/appearance';
import {strokeFor} from '../domain/drawing/strokes';
const line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]];
function base(){const d=c.addLayer(emptyDrawing(),'Ink'),n=c.createCurve(d,d.layers[0].id,line,.1,'Line','a');n.nodes.forEach((p,i)=>p.id=String(i));n.curves[0].nodes=['0','1'];return n;}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
function range(d:Doc,start:number,end:number,index=0){const t=d.displayIntervals![0];return changeDisplayInterval(d,t.id,t.ranges[index].id,{start,end});}
function tip(d:Doc,end:0|1,style:InkEndStyle,index=0){const t=d.displayIntervals![0];return setDisplayIntervalEnd(d,t.id,t.ranges[index].id,end,style);}
const ink=(d:Doc,id='a')=>strokeInk(d,strokeFor(d,id));
const bounds=(d:Doc)=>{const xs=ink(d).flatMap(r=>r.shapes.flatMap(s=>[s[0][0],s[3][0]]));return [Math.min(...xs),Math.max(...xs)];};
test('all four ellipse sides may be hidden while fill geometry remains intact; explicit group and layer hides still apply',()=>{
 let d=c.addLayer(emptyDrawing(),'Highlight');const e=c.ellipse(d,d.layers[0].id,[-.2,-.15],[.2,.15],.01);d=p.createFill(e.document,e.ids,'white');const geometry=fillGeometry(d,d.fills[0]);
 for(const id of e.ids){d=c.curveChange(d,id,{visible:false});expect(fillVisible(d,d.fills[0])).toBe(true);expect(fillGeometry(d,d.fills[0])).toEqual(geometry);}
 d=c.setStrokeState(d,e.ids[0],{visible:false});expect(fillVisible(d,d.fills[0])).toBe(false);valid(d);d=c.setStrokeState(d,e.ids[0],{visible:true});expect(fillVisible(d,d.fills[0])).toBe(true);
 d=p.changePaint(d,d.fills[0].id,{visible:false});d=c.setStrokeState(c.setStrokeState(d,e.ids[0],{visible:false}),e.ids[0],{visible:true});expect(fillVisible(d,d.fills[0])).toBe(true);
 d=p.changePaint(d,d.fills[0].id,{visible:true});expect(fillVisible(c.layerChange(d,d.layers[0].id,{visible:false}),d.fills[0])).toBe(false);
 d=c.deleteCurves(d,[e.ids[0]]);expect(fillGeometry(d,d.fills[0]).error).toBeTruthy();expect(fillVisible(d,d.fills[0])).toBe(false);
});
test('interval ends taper and extend without moving geometry, markers, or the other endpoint settings',()=>{
 const b=base();let d=range(addDisplayInterval(b,'a'),.2,.8);d=tip(tip(d,0,{taper:.1,extension:.05}),1,{taper:.2,extension:.07});
 expect(bounds(d)[0]).toBeCloseTo(.15,10);expect(bounds(d)[1]).toBeCloseTo(.87,10);const r=ink(d)[0],points=r.outline.slice(0,r.outline.length/2);expect(points[0][1]).toBeCloseTo(0);expect(points.at(-1)![1]).toBeCloseTo(0);expect(Math.max(...points.map(p=>p[1]))).toBeCloseTo(.05,10);expect(r.uniform).toBe(false);
 expect(d.nodes).toBe(b.nodes);expect(d.curves).toBe(b.curves);expect(d.joins).toBe(b.joins);expect(d.displayIntervals![0].ranges[0].start).toBe(.2);
 const flat=tip(d,0,{taper:0});expect(ink(flat)[0].outline[0][1]).toBeCloseTo(.05);expect(flat.displayIntervals![0].ranges[0].inkEnds![1]).toEqual({taper:.2,extension:.07});valid(d);
});
test('short interval tapers meet at full width instead of making the entire line disappear',()=>{
 const d=addDisplayInterval(base(),'a'),r=ink(d)[0];expect(Math.max(...r.outline.map(p=>p[1]))).toBeCloseTo(.05);expect(r.outline[0][1]).toBeCloseTo(0);expect(r.outline[r.outline.length/2-1][1]).toBeCloseTo(0);
});
test('overlapping intervals union first: covered endpoint taper and extension cannot pinch or protrude',()=>{
 let d=range(addDisplayInterval(base(),'a'),.1,.6);d=tip(tip(d,0,{taper:.1,extension:.02}),1,{taper:20,extension:1});d=range(addDisplayInterval(d,'a'),.4,.9,1);d=tip(tip(d,0,{taper:20,extension:1},1),1,{taper:.1,extension:.03},1);
 expect(ink(d)).toHaveLength(1);expect(bounds(d)[0]).toBeCloseTo(.08);expect(bounds(d)[1]).toBeCloseTo(.93);for(const q of ink(d)[0].outline.filter(q=>q[0]>.35&&q[0]<.65))expect(Math.abs(q[1])).toBeCloseTo(.05,10);
});
test('open marker crossing and reversed path preserve style attached to each marker',()=>{
 let d=range(addDisplayInterval(base(),'a'),.8,.2);d=tip(tip(d,0,{taper:.01,extension:.07}),1,{taper:.2,extension:.03});expect(bounds(d)[0]).toBeCloseTo(.17);expect(bounds(d)[1]).toBeCloseTo(.87);
 const path=displayPath(d,'a'),forward=displayField(d,path),reverse=displayField(d,{...path,segments:[...path.segments].reverse().map(x=>({...x,reverse:!x.reverse}))});expect(reverse.inkSpans![0].ends).toEqual([...forward.inkSpans![0].ends].reverse());valid(d);
});
test('closed wrapping interval has two ink tips, no artificial taper at the parameter seam, and a full unaffected fill',()=>{
 const b=c.addLayer(emptyDrawing(),'Loop'),e=c.ellipse(b,b.layers[0].id,[-1,-1],[1,1],.025);let d=p.createFill(e.document,e.ids,'black');const geometry=fillGeometry(d,d.fills[0]);d=range(addDisplayInterval(d,e.ids[0]),.85,.15);d=tip(tip(d,0,{taper:.1}),1,{taper:.15});
 const f=displayField(d,displayPath(d,e.ids[0])),r=ink(d,e.ids[0])[0];expect(ink(d,e.ids[0])).toHaveLength(1);expect(r.closed).toBe(false);expect(r.uniform).toBe(false);expect(fillVisible(d,d.fills[0])).toBe(true);expect(fillGeometry(d,d.fills[0])).toEqual(geometry);
 const seam=f.at(0).p,near=r.outline.filter(p=>Math.hypot(p[0]-seam[0],p[1]-seam[1])<.025);expect(near.length).toBeGreaterThan(0);for(const p of near)expect(Math.hypot(p[0]-seam[0],p[1]-seam[1])).toBeGreaterThan(.01);
 d=range(d,0,1);expect(ink(d,e.ids[0])[0].closed).toBe(true);expect(ink(d,e.ids[0])[0].uniform).toBe(true);valid(d);
});
test('old interval and Pen data remain unchanged; only newly authored Pen curves receive 20× width defaults',()=>{
 const b=base(),d=addDisplayInterval(b,'a');delete d.displayIntervals![0].ranges[0].inkEnds;const path=displayPath(d,'a'),f=displayField(d,path);expect(ink(d)).toEqual(inkRuns(f.geometry.shapes,.1,'UNIFORM',false,undefined,false,undefined,[],f.mask));expect(parseDrawing(d).curves[0].inkEnds).toBeUndefined();
 const fresh=c.createPenCurve(b,b.layers[0].id,line,.16,'pen');expect(fresh.curves.find(c=>c.id==='pen')!.inkEnds).toEqual([{taperWidthScale:20},{taperWidthScale:20}]);expect(fresh.curves[0]).toEqual(b.curves[0]);expect(Math.max(...ink(fresh,'pen')[0].outline.map(p=>p[1]))).toBeCloseTo(.08);valid(fresh);expect(c.splitCurve(b,'a',.5).document.curves.every(c=>c.inkEnds===undefined)).toBe(true);
});
test('interval ink persists across exact split, clone, locks and JSON validation',()=>{
 let d=tip(tip(addDisplayInterval(base(),'a'),0,{taper:.03,extension:.1}),1,{taper:.07,extension:.2});const before=bounds(d);d=c.splitCurve(d,'a',.5).document;expect(bounds(d)).toEqual(expect.arrayContaining(before.map(v=>expect.closeTo(v,7))));valid(d);
 const clone=c.duplicateCurves(d,d.curves.map(c=>c.id));expect(clone.document.displayIntervals![1].ranges[0].inkEnds).toEqual(d.displayIntervals![0].ranges[0].inkEnds);valid(clone.document);
 expect(()=>tip(c.curveChange(d,'a',{locked:true}),0,{taper:.1})).toThrow();for(const taper of [-1,21,NaN])expect(()=>tip(d,0,{taper})).toThrow();const track=d.displayIntervals![0];expect(()=>parseDrawing({...d,displayIntervals:[{...track,ranges:[{...track.ranges[0],inkEnds:[{taper:-1},{}]}]}]})).toThrow();
});
test('Pen multiplier changes only new outer ends; interior joins and closed paths stay uniform',()=>{
 const b=base();let d=c.createPenCurve(b,b.layers[0].id,line,.1,'p1',3);
 d=c.createPenCurve(d,b.layers[0].id,[[1,0],[4/3,0],[5/3,0],[2,0]],.1,'p2',8);
 d=c.connect(d,{curveId:'p1',end:1},{curveId:'p2',end:0},'POSITION');
 expect(d.curves[0]).toEqual(b.curves[0]);expect(d.curves.find(c=>c.id==='p1')!.inkEnds![0]).toEqual({taperWidthScale:3});expect(d.curves.find(c=>c.id==='p2')!.inkEnds![1]).toEqual({taperWidthScale:8});
 const run=ink(d,'p1')[0],nearJoin=run.outline.filter(p=>Math.abs(p[0]-1)<.02);expect(nearJoin.length).toBeGreaterThan(0);nearJoin.forEach(p=>expect(Math.abs(p[1])).toBeCloseTo(.05,9));
 d=c.createPenCurve(d,b.layers[0].id,[[2,0],[2,-1],[0,-1],[0,0]],.1,'p3',40);
 d=c.connect(d,{curveId:'p2',end:1},{curveId:'p3',end:0},'POSITION');d=c.connect(d,{curveId:'p3',end:1},{curveId:'p1',end:0},'POSITION');expect(ink(d,'p1')[0].uniform).toBe(true);valid(d);
 const flat=c.createPenCurve(b,b.layers[0].id,line,.1,'flat',0);expect(ink(flat,'flat')[0].uniform).toBe(true);valid(flat);
 for(const scale of [-1,201,NaN,Infinity])expect(()=>c.createPenCurve(b,b.layers[0].id,line,.1,'bad',scale)).toThrow();
});
