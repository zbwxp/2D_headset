import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,add,mul,sub,type DrawingDocument as Doc,type Cubic,type Point2} from '../domain/drawing/model';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk,inkEndpointInfo,fillGeometry} from '../domain/drawing/appearance';
import {addDisplayInterval,changeDisplayInterval,setDisplayIntervalEnd,displayField,displayPath} from '../domain/drawing/displayIntervals';
import {nudgeSelection} from '../ui/drawing/nudge';
const line=(a:Point2,b:Point2):Cubic=>[a,add(a,mul(sub(b,a),1/3)),add(a,mul(sub(b,a),2/3)),b];
function chain(closed=false,reverseB=false){
 let d=c.addLayer(emptyDrawing(),'Neck');
 d=c.createPenCurve(d,d.layers[0].id,line([-1,1],[-1,0]),.04,'a');
 d=c.createPenCurve(d,d.layers[0].id,line(...(reverseB?[[1,0],[-1,0]]:[[-1,0],[1,0]]) as [Point2,Point2]),.04,'b');
 d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:reverseB?1:0},'POSITION');
 if(closed){d=c.createPenCurve(d,d.layers[0].id,line([1,0],[-1,1]),.04,'c');d=c.connect(d,{curveId:'b',end:reverseB?0:1},{curveId:'c',end:0},'POSITION');d=c.connect(d,{curveId:'c',end:1},{curveId:'a',end:0},'POSITION');d=p.createFill(d,['a','b','c'],'white');}
 return d;
}
const contains=(points:Point2[],p:Point2)=>expect(points.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-9)).toBe(true);
const ink=(d:Doc)=>strokeInk(d,strokeFor(d,'a'));
const extensions=(d:Doc)=>ink(d).flatMap(r=>r.extensions??[]);
const style=(d:Doc,id='a',end:0|1=1)=>p.setInkEnd(p.enableInteriorInkEnd(d,id,end,true),id,end,{taper:.2,extension:.2});
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
test('legacy internal defaults stay dormant; first opt-in is visually unchanged and disabled settings are remembered',()=>{
 const source=chain(true),d:Doc={...source,curves:source.curves.map(c=>({...c,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]}))},before=ink(d);expect(d.curves[0].inkEnds![1]).toEqual({taperWidthScale:20});expect(inkEndpointInfo(d,'a',1)!.enabled).toBe(false);
 const enabled=p.enableInteriorInkEnd(d,'a',1,true);expect(enabled.curves[0].inkEnds![1]).toEqual({interior:true,taper:0,extension:0});expect(ink(enabled)).toEqual(before);
 const changed=style(enabled),off=p.enableInteriorInkEnd(changed,'a',1,false);expect(ink(off)).toEqual(before);expect(ink(p.enableInteriorInkEnd(off,'a',1,true))).toEqual(ink(changed));valid(changed);valid(off);
});
for(const closed of [false,true])test(`internal E=T produces a full-width root and sharp tip without changing ${closed?'closed fill':'open chain'} geometry`,()=>{
 const before=chain(closed),d=style(before),g=closed?fillGeometry(before,before.fills[0]):undefined;
 expect(d.nodes).toBe(before.nodes);expect(d.joins).toBe(before.joins);expect(d.curves.slice(1)).toEqual(before.curves.slice(1));expect(shapeOf(d,'a')).toEqual(shapeOf(before,'a'));
 const ext=extensions(d);expect(ext).toHaveLength(1);contains([ext[0].shape[0],ext[0].shape[3]],[-1,0]);contains([ext[0].shape[0],ext[0].shape[3]],[-1,-.2]);
 const run=ink(d).find(r=>r.extensions?.length)!;expect(run.closed).toBe(false);contains(run.outline,[-1,-.2]);contains(run.outline,[-1.02,0]);contains(run.outline,[-.98,0]);
 expect(inkEndpointInfo(d,'a',1)!.tip!.point).toEqual([-1,-.2]);if(g)expect(fillGeometry(d,d.fills[0])).toEqual(g);valid(d);
});
test('reversed segments and closed traversal seam retain curve-local endpoint ownership',()=>{
 for(const reverse of [false,true]){
  let d=chain(true,reverse);d=style(d,'b',reverse?0:1);expect(inkEndpointInfo(d,'b',reverse?0:1)!.tip!.point).toEqual([1.2,0]);expect(extensions(d)).toHaveLength(1);
  d=style(d,'a',0);const tip=inkEndpointInfo(d,'a',0)!.tip!.point;expect(tip).toEqual([-1,1.2]);expect(extensions(d)).toHaveLength(2);contains(ink(d).flatMap(r=>r.outline),tip);valid(d);
 }
});
test('internal taper only affects its own side, and visible intervals or hidden ink suppress omitted endpoints',()=>{
 const before=chain(),d=p.setInkEnd(p.enableInteriorInkEnd(before,'a',1,true),'a',1,{taper:.1});expect(extensions(d)).toHaveLength(0);
 const runs=ink(d);expect(runs).toHaveLength(2);const vertical=runs.find(r=>r.shapes.every(s=>s[0][0]===-1&&s[3][0]===-1))!,horizontal=runs.find(r=>r!==vertical)!;contains(vertical.outline,[-1,0]);expect(horizontal.outline.filter(q=>Math.abs(q[0]+1)<1e-10).map(q=>Math.abs(q[1]))).toEqual([.02,.02]);
 let masked=addDisplayInterval(style(before),'a'),track=masked.displayIntervals![0],range=track.ranges[0];masked=changeDisplayInterval(masked,track.id,range.id,{start:.05,end:.2});expect(extensions(masked)).toHaveLength(0);
 masked=changeDisplayInterval(masked,track.id,range.id,{start:0,end:1});expect(extensions(masked)).toHaveLength(1);
 // Explicit interval style owns an exactly coincident cut end.
 const field=displayField(masked,displayPath(masked,'a')),index=field.geometry.pieces.findIndex(p=>p.owners[0]==='a'),part=field.parts[index],reversed=part.shape[0][1]===0,start=field.relative(track,(part.start+(reversed?part.length:0))/field.total),end=field.relative(track,(part.start+(reversed?0:part.length))/field.total);masked=changeDisplayInterval(masked,track.id,range.id,{start,end});masked=setDisplayIntervalEnd(masked,track.id,range.id,1,{extension:.07,taper:.07});expect(Math.min(...extensions(masked).flatMap(e=>[e.shape[0][1],e.shape[3][1]]))).toBeCloseTo(-.07);
 const hidden=p.setInk(style(before),['a'],{inkVisible:false});expect(extensions(hidden)).toHaveLength(0);expect(strokeInk(style(before),strokeFor(before,'a'),new Set(['b'])).flatMap(r=>r.extensions??[])).toHaveLength(0);
});
test('ARC attaches ink at the visible trimmed source tangent, preserving the transition',()=>{
 const before=c.connect(chain(),{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2),d=style(before),info=inkEndpointInfo(d,'a',1)!;
 expect(info.tip!.base[0]).toBeCloseTo(-1);expect(info.tip!.base[1]).toBeCloseTo(.2);expect(info.tip!.point[1]).toBeCloseTo(0);contains([extensions(d)[0].shape[0],extensions(d)[0].shape[3]],info.tip!.base);expect(d.joins).toBe(before.joins);
 expect(ink(d).flatMap(r=>r.shapes).length).toBeGreaterThan(3);valid(d);
});
test('local endpoint state survives split, mirror, duplicate and keyboard edits; disabled endpoints do not nudge geometry',()=>{
 const before=chain(true),selection={ids:['a'],inkEnd:{id:'a',end:1 as const}};expect(nudgeSelection(before,selection,[0,-.01])).toBe(before);
 const d=style(before),moved=nudgeSelection(d,selection,[0,-.01]);expect(moved.curves[0].inkEnds![1].extension).toBeCloseTo(.21);expect(moved.nodes).toBe(d.nodes);
 const split=c.splitCurve(d,'a',.5);expect(split.document.curves.find(c=>c.id===split.ids[1])!.inkEnds![1]).toEqual(d.curves[0].inkEnds![1]);expect(extensions(split.document)[0].shape[3]).toEqual([-1,-.2]);
 const mirror=c.transform(d,['a','b','c'],([x,y])=>[-x,y]);expect(inkEndpointInfo(mirror,'a',1)!.tip!.point).toEqual([1,-.2]);
 const copy=c.duplicateCurves(d,['a','b','c']);expect(copy.document.curves.find(c=>c.id===copy.ids[0])!.inkEnds).toEqual(d.curves[0].inkEnds);valid(copy.document);valid(split.document);
 expect(()=>p.enableInteriorInkEnd(c.curveChange(before,'a',{locked:true}),'a',1,true)).toThrow(/锁定/);
 expect(()=>parseDrawing({...d,curves:d.curves.map(x=>x.id==='a'?{...x,inkEnds:[{}, {interior:'yes'}]}:x)})).toThrow();
});
