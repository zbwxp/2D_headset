import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type InkEnds} from '../domain/drawing/model';
import {strokeFor} from '../domain/drawing/strokes';
import {inkTips,extendedInk,strokeEnds,strokeInk,inkRuns,fillGeometry,offsetGeometry} from '../domain/drawing/appearance';
const line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]];
function base(){let d=c.addLayer(emptyDrawing(),'Ink');return c.createCurve(d,d.layers[0].id,line,.1,'Line','a');}
test('tangent extensions point opposite each handle, preserve raw data and render short distance tapers',()=>{
 const d=base(),ends:InkEnds=[{taper:.01,extension:.2},{taper:.1,extension:.3}];
 const next=p.setInkEnd(p.setInkEnd(d,'a',0,ends[0]),'a',1,ends[1]);expect(shapeOf(next,'a')).toEqual(line);expect(d.curves[0].inkEnds).toBeUndefined();
 expect(inkTips([line],ends).map(x=>x.point)).toEqual([[-.2,0],[1.3,0]]);
 const runs=inkRuns([line],.1,'UNIFORM',false,[true],false,ends);expect(runs[0].uniform).toBe(false);
 expect(runs[0].outline[0]).toEqual([-.2,0]);const width=runs[0].outline.find(x=>Math.abs(x[0]+.19)<1e-8)!;expect(width[1]).toBeCloseTo(.05,8);
 expect(extendedInk([line],ends).indices).toEqual([0,0,0]);expect(parseDrawing(JSON.parse(JSON.stringify(next)))).toEqual(next);
 const diagonal:Cubic=[[0,0],[1,1],[1,0],[2,1]];const tips=inkTips([diagonal],ends);expect(tips[0].point[0]).toBeCloseTo(-.2/Math.sqrt(2));expect(tips[1].point[1]).toBeCloseTo(1+.3/Math.sqrt(2));
});
test('zero handles and collapsed cubics keep finite ink tips and empty geometry stays empty',()=>{
 expect(inkTips([[[0,0],[0,0],[1,0],[1,0]]],[{extension:.2},{extension:.2}]).map(x=>x.point)).toEqual([[-.2,0],[1.2,0]]);
 expect(inkTips([[[1,1],[1,1],[1,1],[1,1]]],[{extension:2},{extension:2}]).map(x=>x.point)).toEqual([[1,1],[1,1]]);expect(inkRuns([],.1,'UNIFORM')).toEqual([]);
});
test('physical endpoint settings survive split, reverse traversal, duplication and reflection',()=>{
 let d=p.setInkEnd(p.setInkEnd(base(),'a',0,{extension:.2,taper:.04}),'a',1,{extension:.3,taper:.05});
 const split=c.splitCurve(d,'a',.4);d=split.document;expect(d.curves[0].inkEnds).toEqual([{extension:.2,taper:.04},{}]);expect(d.curves[1].inkEnds).toEqual([{}, {extension:.3,taper:.05}]);
 const s=strokeFor(d,'a'),ends=strokeEnds(d,s);for(const e of ends)expect(e.style.extension).toBe(e.endpoint.curveId==='a'?.2:.3);
 const r={...s,segments:[...s.segments].reverse().map(x=>({...x,reverse:!x.reverse}))};expect(strokeEnds(d,r).map(e=>e.style)).toEqual(ends.map(e=>e.style).reverse());
 const dupe=c.duplicateCurves(d,split.ids,undefined,[0,0]);expect(dupe.ids.map(id=>dupe.document.curves.find(x=>x.id===id)!.inkEnds)).toEqual(d.curves.map(x=>x.inkEnds));
 const mirrored=c.transform(d,split.ids,([x,y])=>[-x,y]);expect(mirrored.curves.map(x=>x.inkEnds)).toEqual(d.curves.map(x=>x.inkEnds));
 expect(Math.min(...strokeInk(d,s)[0].outline.map(x=>x[0]))).toBeCloseTo(-.2);
});
test('fill boundaries and offset source are independent of endpoint ink; detached offsets preserve ink',()=>{
 const b=c.addLayer(emptyDrawing(),'Loop'),e=c.ellipse(b,b.layers[0].id,[-1,-1],[1,1],.01);let d=p.createFill(e.document,e.ids,'white');const before=fillGeometry(d,d.fills[0]);
 d=p.setInkEnd(d,e.ids[0],0,{extension:1,taper:.5});expect(fillGeometry(d,d.fills[0])).toEqual(before);expect(strokeInk(d,strokeFor(d,e.ids[0]))).toEqual(strokeInk(e.document,strokeFor(e.document,e.ids[0])));
 let o=p.createOffset(base(),'a');const source=offsetGeometry(o,o.offsets[0]);o=p.setInkEnd(o,'a',1,{extension:1,taper:.5});expect(offsetGeometry(o,o.offsets[0])).toEqual(source);
 o=p.setInkEnd(p.setInkEnd(o,o.offsets[0].id,0,{extension:.1,taper:.02}),o.offsets[0].id,1,{extension:.2,taper:.03});const detached=p.detachOffset(o,o.offsets[0].id),first=detached.document.curves.find(x=>x.id===detached.ids[0])!,last=detached.document.curves.find(x=>x.id===detached.ids.at(-1))!;
 expect(first.inkEnds?.[0]).toEqual({extension:.1,taper:.02});expect(last.inkEnds?.[1]).toEqual({extension:.2,taper:.03});
});

test('endpoint distance edits respect locks and reject corrupt saved settings',()=>{
 const d=base();for(const v of [-1,20.01,Infinity,NaN])expect(()=>p.setInkEnd(d,'a',0,{taper:v})).toThrow();for(const v of [-1,2.01,Infinity,NaN])expect(()=>parseDrawing({...d,curves:[{...d.curves[0],inkEnds:[{}, {extension:v}]}]})).toThrow();
 expect(()=>p.setInkEnd(c.curveChange(d,'a',{locked:true}),'a',0,{extension:.1})).toThrow(/锁定/);
});
