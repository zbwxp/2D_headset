import {test,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type Point2,type ContourMist} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import {createOffset,detachOffset,setInk} from '../domain/drawing/paintCommands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk,displayInkSampling} from '../domain/drawing/appearance';
import {setContourMist,strokeInkPasses,inkEdgeStyle,inkEdgeParameters} from '../domain/drawing/mist';
import MistInk from '../ui/drawing/MistInk';
const line=(x0:number,x1:number,y=0):Cubic=>[[x0,y],[x0+(x1-x0)/3,y],[x0+2*(x1-x0)/3,y],[x1,y]];
function base(){let d=c.addLayer(emptyDrawing());d=c.createCurve(d,d.layers[0].id,line(-1,0),.008,'a','a');return c.createCurve(d,d.layers[0].id,line(0,1),.008,'b','b');}
const passes=(d:ReturnType<typeof base>)=>{const s=strokeFor(d,'a');return strokeInkPasses(d,s,strokeInk(d,s));};
const area=(ps:Point2[])=>Math.abs(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;

test('ink edge edits selected lines only, persists, and leaves geometry, fill and topology unchanged',()=>{
 const d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'POSITION'),before=structuredClone(d),ink=strokeInk(d,strokeFor(d,'a'));
 const n=setContourMist(d,['a'],{enabled:true,width:1/250,density:.4});
 expect(n.curves[1]).toBe(d.curves[1]);expect(n.layers).toBe(d.layers);expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(n.fills).toBe(d.fills);expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));expect(d).toEqual(before);
 expect(strokeInk(n,strokeFor(n,'a'))).toEqual(ink);expect(passes(n).filter(p=>p.mist?.enabled)).toHaveLength(1);
 expect(parseDrawing(JSON.parse(JSON.stringify(n)))).toEqual(n);expect(parseDrawing(d).curves.every(c=>c.mist===undefined)).toBe(true);
 expect(setContourMist(n,['a'],{density:.4})).toBe(n);
 for(const change of [{density:NaN},{width:-1},{width:3.1/250},{density:1.1},{mode:'UNKNOWN'},{enabled:1}])expect(()=>parseDrawing({...n,curves:[{...n.curves[0],mist:{...n.curves[0].mist,...change}},n.curves[1]]})).toThrow();
 expect(()=>setContourMist(c.curveChange(n,'a',{locked:true}),['a'],{enabled:false})).toThrow(/锁定/);
});

test('legacy fog is mapped without destructive migration, new edits keep their units on reload',()=>{
 const mist:ContourMist={enabled:true,width:60/250,density:5},d=base();
 const before=structuredClone(mist);expect(inkEdgeStyle(mist)).toEqual({mode:'INK_EDGE',enabled:true,width:3/250,density:1});expect(mist).toEqual(before);
 const legacy={...d,curves:d.curves.map(c=>({...c,mist}))};expect(parseDrawing(legacy).curves[0].mist).toEqual(mist);
 const changed=setContourMist(legacy,['a'],{density:.5}),roundtrip=parseDrawing(JSON.parse(JSON.stringify(changed)));
 expect(inkEdgeStyle(roundtrip.curves[0].mist)).toEqual(changed.curves[0].mist);expect(roundtrip.curves[1].mist).toEqual(mist);
 expect(legacy.curves[0].mist).toEqual(before);
});

for(const mode of ['POSITION','CUSP','ARC','SMOOTH'] as const)test(`mixed ink edges retain ${mode} joins and the complete ink area`,()=>{
 let d=base();d=c.moveHandle(d,{curveId:'b',end:0},[.1,.3]);d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},mode,.15);
 d=setContourMist(d,['a'],{enabled:true});const result=passes(d),s=strokeFor(d,'a');
 expect(result.filter(p=>p.mist?.enabled).map(p=>p.owner)).toEqual(['a']);
 expect(result.flatMap(p=>p.runs).reduce((v,r)=>v+area(r.outline),0)).toBeCloseTo(strokeInk(d,s,undefined,true).reduce((v,r)=>v+area(r.outline),0),7);
 expect(result.some(p=>p.owner==='b'&&!p.mist)).toBe(true);
 d=setContourMist(d,['b'],{enabled:true});expect(passes(d)).toHaveLength(1);expect(passes(d)[0].runs).toEqual(strokeInk(d,s));
});

test('edges follow display intervals and ink visibility, preserving native cubic fast path',()=>{
 let d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');d=setContourMist(d,['a','b'],{enabled:true});d=addDisplayInterval(d,'a');
 expect(passes(d)[0].runs).toEqual(strokeInk(d,strokeFor(d,'a')));
 const xs=passes(d)[0].runs.flatMap(r=>r.shapes.flatMap(s=>s.map(p=>p[0])));expect(Math.max(...xs)).toBeLessThan(.35);expect(Math.min(...xs)).toBeGreaterThan(-.35);
 const s=strokeFor(d,'a'),sampling=displayInkSampling(250),runs=strokeInk(d,s,undefined,false,sampling);expect(strokeInkPasses(d,s,runs,sampling)[0].runs).toBe(runs);
 d=setInk(d,['a','b'],{inkVisible:false});expect(passes(d)).toEqual([]);
});

test('copy, split and detached offset retain ink edges without coupling edits',()=>{
 let d=setContourMist(base(),['a'],{enabled:true,width:1/250});const copy=c.duplicateCurves(d,['a']);
 expect(copy.document.curves.find(c=>c.id===copy.ids[0])!.mist).toEqual(d.curves[0].mist);
 const changed=setContourMist(copy.document,copy.ids,{width:2/250});expect(changed.curves[0].mist!.width).toBe(1/250);
 const split=c.splitCurve(d,'a',.4);expect(split.document.curves.find(c=>!d.curves.some(x=>x.id===c.id))!.mist).toEqual(d.curves[0].mist);
 d=createOffset(d,'a');d=setContourMist(d,[d.offsets[0].id],{enabled:true,width:2/250,density:.7});const independent=detachOffset(d,d.offsets[0].id);
 expect(independent.ids.every(id=>independent.document.curves.find(c=>c.id===id)!.mist!.width===2/250)).toBe(true);expect(parseDrawing(independent.document)).toEqual(independent.document);
});

test('native ink filter replaces the original once, handles flat bounds and follows zoom/pan without bitmaps',()=>{
 const d=setContourMist(base(),['a'],{enabled:true,width:3/250,density:1}),mist=d.curves[0].mist!,runs=strokeInk(d,strokeFor(d,'a'),undefined,false,displayInkSampling(250));
 const props={runs,mist,width:.008,unit:250,screen:([x,y]:Point2):Point2=>[x*250,-y*250]};
 const svg=renderToStaticMarkup(createElement(MistInk,props));
 expect(svg.match(/data-testid="drawing-ink"/g)).toHaveLength(1);expect(svg).toContain('feGaussianBlur');expect(svg).not.toContain('<image');expect(svg).not.toContain('NaN');expect(svg).not.toContain('Infinity');
 const filter=svg.match(/<filter[^>]+>/)![0];expect(+(filter.match(/height="([^"]+)/)![1])).toBeGreaterThan(0);
 const pan=renderToStaticMarkup(createElement(MistInk,{...props,screen:([x,y]:Point2):Point2=>[x*250+100,-y*250+40]}));expect(pan.match(/<path[^>]+d="([^"]+)/)![1]).toEqual(svg.match(/<path[^>]+d="([^"]+)/)![1]);
 const a=inkEdgeParameters(mist,.008,250),b=inkEdgeParameters(mist,.008,500);expect(b.sigma).toBe(a.sigma*2);expect(b.displacement).toBe(a.displacement*2);
 expect(inkEdgeParameters(mist,.004,250).sigma).toBeLessThanOrEqual(.32);
 const off=renderToStaticMarkup(createElement(MistInk,{...props,mist:{...mist,density:0}}));expect(off).not.toContain('<filter');expect(off).toContain('drawing-ink');
});
