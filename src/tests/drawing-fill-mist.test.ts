import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,DEFAULT_FILL_MIST,type FillMist,type DrawingDocument as Doc} from '../domain/drawing/model';
import {setFillMist,fillMistAlpha,fillMistLayout,boundaryDistances} from '../domain/drawing/fillMist';
import {fillGeometry,fillVisible} from '../domain/drawing/appearance';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {cutDrawing,pasteDrawingCut} from '../domain/drawing/clipboard';
function fixture(){let d=c.addLayer(emptyDrawing(),'Iris');const e=c.ellipse(d,d.layers[0].id,[-.3,-.5],[.3,.5],.01);return {d:p.createFill(e.document,e.ids,'black','MIST'),ids:e.ids};}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
test('mist fill is a closed-boundary appearance, independent of stroke, ink intervals and geometry',()=>{
 const {d,ids}=fixture(),f=d.fills[0];expect(f.mist).toEqual(DEFAULT_FILL_MIST);const g=fillGeometry(d,f);expect(g.error).toBeUndefined();
 let n=p.setInk(d,ids,{inkVisible:false});n=addDisplayInterval(n,ids[0]);n=setFillMist(n,f.id,{side:'OUTSIDE',width:.2,opacity:.4});expect(n.nodes).toBe(d.nodes);expect(n.joins).toBe(d.joins);expect(fillGeometry(n,n.fills[0])).toEqual(g);expect(fillVisible(n,n.fills[0])).toBe(true);valid(n);
 const broken=c.unbind(d,{curveId:ids[0],end:0}),moved=c.moveNode(broken,broken.curves.find(x=>x.id===ids[0])!.nodes[0],[2,2]);expect(fillGeometry(moved,moved.fills[0]).error).toBeDefined();
 expect(()=>p.createFill(d,ids.slice(1),'black','MIST')).toThrow();expect(()=>p.createFill(d,ids,'transparent','MIST')).toThrow();
});
test('solid legacy fills are untouched; invalid mist cannot enter saved data or locked fills',()=>{
 const {d,ids}=fixture();const old=p.createFill(d,ids,'white');expect(old.fills.at(-1)!.mist).toBeUndefined();valid(old);
 for(const bad of [{width:0},{width:NaN},{width:2},{opacity:1.01},{opacity:-1},{side:'LEFT'},{enabled:1}]){
  expect(()=>setFillMist(d,d.fills[0].id,bad as Partial<FillMist>)).toThrow();expect(()=>parseDrawing({...d,fills:[{...d.fills[0],mist:{...DEFAULT_FILL_MIST,...bad}}]})).toThrow();
 }
 expect(()=>setFillMist(p.changePaint(d,d.fills[0].id,{locked:true}),d.fills[0].id,{opacity:.5})).toThrow(/锁定/);
 const transparent=p.changePaint(d,d.fills[0].id,{color:'transparent'});expect(transparent.fills[0].mist?.enabled).toBe(false);valid(transparent);
 expect(()=>setFillMist(transparent,d.fills[0].id,{enabled:true})).toThrow();
});
test('Gaussian fades monotonically to exact transparent support and is independent of boundary winding',()=>{
 expect(fillMistAlpha(0,10)).toBe(1);expect(fillMistAlpha(10,10)).toBe(0);expect(fillMistAlpha(11,10)).toBe(0);
 for(let i=1;i<=100;i++)expect(fillMistAlpha(i/10,10)).toBeLessThan(fillMistAlpha((i-1)/10,10));
 expect(fillMistAlpha(10/3,10)).toBeCloseTo(.6021,3);expect(fillMistAlpha(2,10)).toBeCloseTo(fillMistAlpha(4,20),12);
 const {d}=fixture(),shapes=fillGeometry(d,d.fills[0]).shapes,a=fillMistLayout(shapes,DEFAULT_FILL_MIST)!,b=fillMistLayout(shapes,{...DEFAULT_FILL_MIST,side:'OUTSIDE'})!;
 expect(b.bounds[0]).toBeLessThan(a.bounds[0]);expect(b.nx*b.ny).toBeLessThanOrEqual(1_504_100);
 const preview=fillMistLayout(shapes,DEFAULT_FILL_MIST,.5)!;expect(preview.nx*preview.ny).toBeLessThan(a.nx*a.ny/12);expect(preview.origin).toEqual(a.origin);expect(preview.relative).toEqual(a.relative);expect(preview.bounds[0]).toBe(a.bounds[0]);expect(preview.bounds[3]).toBe(a.bounds[3]);
});
test('linear distance transform agrees with brute-force nearest-boundary distances including seed-free rows',()=>{
 const nx=21,ny=17,seeds=new Uint8Array(nx*ny),positions=[[0,0],[3,9],[16,12],[20,16]];for(const [x,y] of positions)seeds[y*nx+x]=1;
 const d=boundaryDistances(seeds,nx,ny);for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)expect(d[y*nx+x]).toBeCloseTo(Math.min(...positions.map(([a,b])=>Math.hypot(x-a,y-b))),5);
 expect([...boundaryDistances(new Uint8Array(4),2,2)].every(x=>Number.isFinite(x)&&x>100)).toBe(true);
});
test('mist settings survive source transform, split, layer copy, cut/paste and Save/Load',()=>{
 const {d,ids}=fixture(),f=d.fills[0],n=c.transform(d,ids,([x,y])=>[-x+.2,y+.3]);expect(n.fills).toEqual(d.fills);expect(fillGeometry(n,f).shapes).not.toEqual(fillGeometry(d,f).shapes);
 const split=c.splitCurve(d,ids[0],.4).document;expect(split.fills[0].mist).toEqual(f.mist);expect(fillGeometry(split,split.fills[0]).error).toBeUndefined();
 const copy=c.duplicateLayer(d,d.layers[0].id);expect(copy.fills.at(-1)!.mist).toEqual(f.mist);valid(copy);valid(split);
 const cut=cutDrawing(d,ids)!,layered=c.addLayer(cut.document,'Moved'),pasted=pasteDrawingCut(layered,cut.clipboard,layered.layers[0].id);expect(pasted.fills[0].mist).toEqual(f.mist);valid(pasted);
});
