import {test,expect} from 'vitest';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import {createOffset,detachOffset,setInk} from '../domain/drawing/paintCommands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk} from '../domain/drawing/appearance';
import {setContourMist,strokeMist,mistWarpAt,mistRasterLayout} from '../domain/drawing/mist';
const line=(x0:number,x1:number,y=0):Cubic=>[[x0,y],[x0+(x1-x0)/3,y],[x0+2*(x1-x0)/3,y],[x1,y]];
function base(){let d=c.addLayer(emptyDrawing());d=c.createCurve(d,d.layers[0].id,line(-1,0),.008,'a','a');return c.createCurve(d,d.layers[0].id,line(0,1),.008,'b','b');}

test('mist targets individual selected lines, persists, and leaves geometry/joins/layers and sharp ink unchanged',()=>{
 const d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'POSITION'),before=structuredClone(d),ink=strokeInk(d,strokeFor(d,'a'));
 const n=setContourMist(d,['a'],{enabled:true,width:.03,density:.4});
 expect(n.curves[1]).toBe(d.curves[1]);expect(n.layers).toBe(d.layers);expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));expect(d).toEqual(before);
 expect(strokeInk(n,strokeFor(n,'a'))).toEqual(ink);expect(strokeMist(n,strokeFor(n,'a'))[0].runs[0].shapes).toHaveLength(1);
 expect(parseDrawing(JSON.parse(JSON.stringify(n)))).toEqual(n);expect(parseDrawing(d).curves.every(c=>c.mist===undefined)).toBe(true);
 expect(setContourMist(n,['a'],{density:.4})).toBe(n);
 const boosted=setContourMist(n,['a'],{density:5});expect(parseDrawing(JSON.parse(JSON.stringify(boosted)))).toEqual(boosted);expect(strokeInk(boosted,strokeFor(boosted,'a'))).toEqual(ink);
 for(const change of [{density:NaN},{width:-1},{density:5.1},{enabled:1}])expect(()=>parseDrawing({...n,curves:[{...n.curves[0],mist:{...n.curves[0].mist,...change}},n.curves[1]]})).toThrow();
 expect(()=>setContourMist(c.curveChange(n,'a',{locked:true}),['a'],{enabled:false})).toThrow(/锁定/);
});

test('mist follows display intervals, hidden ink and arc bridges without altering source data',()=>{
 let d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');d=setContourMist(d,['a','b'],{enabled:true});
 const all=strokeMist(d,strokeFor(d,'a'));expect(all).toHaveLength(1);expect(all[0].runs[0].shapes).toHaveLength(2);
 d=addDisplayInterval(d,'a');const clipped=strokeMist(d,strokeFor(d,'a'));expect(clipped[0].runs).toEqual(strokeInk(d,strokeFor(d,'a')));
 const xs=clipped[0].runs.flatMap(r=>r.shapes.flatMap(s=>s.map(p=>p[0])));expect(Math.max(...xs)).toBeLessThan(.35);expect(Math.min(...xs)).toBeGreaterThan(-.35);
 d=setInk(d,['a','b'],{inkVisible:false});expect(strokeMist(d,strokeFor(d,'a'))).toEqual([]);
 let arc=base();arc=c.moveHandle(arc,{curveId:'b',end:0},[.1,.3]);arc=c.connect(arc,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.15);arc=setContourMist(arc,['a','b'],{enabled:true});
 expect(strokeMist(arc,strokeFor(arc,'a'))[0].runs).toEqual(strokeInk(arc,strokeFor(arc,'a')));
 const hidden={...arc,curves:arc.curves.map(c=>({...c,visible:false}))};expect(strokeMist(hidden,strokeFor(hidden,'a'))).toEqual([]);
});

test('copy, split and detached offset retain mist settings without coupling edits',()=>{
 let d=setContourMist(base(),['a'],{enabled:true,width:.02});const copy=c.duplicateCurves(d,['a']);
 expect(copy.document.curves.find(c=>c.id===copy.ids[0])!.mist).toEqual(d.curves[0].mist);
 const changed=setContourMist(copy.document,copy.ids,{width:.1});expect(changed.curves[0].mist!.width).toBe(.02);
 const split=c.splitCurve(d,'a',.4);expect(split.document.curves.find(c=>!d.curves.some(x=>x.id===c.id))!.mist).toEqual(d.curves[0].mist);
 d=createOffset(d,'a');d=setContourMist(d,[d.offsets[0].id],{enabled:true,width:.05,density:.7});const independent=detachOffset(d,d.offsets[0].id);
 expect(independent.ids.every(id=>independent.document.curves.find(c=>c.id===id)!.mist!.width===.05)).toBe(true);expect(parseDrawing(independent.document)).toEqual(independent.document);
});

test('soft edge displacement is continuous, deterministic and bounded, including at extreme sizes',()=>{
 let maxDelta=0;const dxs=[];
 for(let x=0;x<200;x+=.1){const a=mistWarpAt(x,0,12),b=mistWarpAt(x+.1,0,12);expect(mistWarpAt(x,0,12)).toEqual(a);maxDelta=Math.max(maxDelta,Math.abs(b.dx-a.dx),Math.abs(b.dy-a.dy));dxs.push(a.dx);expect(Math.abs(a.dx)).toBeLessThanOrEqual(1.4);expect(Math.abs(a.dy)).toBeLessThanOrEqual(1.4);expect(a.shade).toBeGreaterThanOrEqual(.73);expect(a.shade).toBeLessThanOrEqual(1);}
 expect(maxDelta).toBeLessThan(.03);expect(Math.max(...dxs)-Math.min(...dxs)).toBeGreaterThan(1);
 const narrow=mistWarpAt(1,2,.25),wide=mistWarpAt(1,2,60);expect(Math.abs(narrow.dx)).toBeLessThan(Math.abs(wide.dx));
 const layout=mistRasterLayout([[0,-.01],[2,.01]],.04)!;expect(layout.bounds[0]).toBeLessThan(-10);expect(layout.bounds[3]).toBeGreaterThan(12.5);expect(layout.sigma).toBeCloseTo(10/3);
 const huge=mistRasterLayout([[-1000,-1000],[1000,1000]],.24)!;expect(huge.nx*huge.ny).toBeLessThan(1503000);expect(Math.max(huge.nx,huge.ny)).toBeLessThanOrEqual(2048);expect(mistRasterLayout([],.02)).toBeNull();
});
