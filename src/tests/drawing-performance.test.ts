import {test,expect} from 'vitest';
import fixture from './fixtures/drawing-ear-performance.json';
import {parseDrawing,shapeOf,curveById,type Cubic} from '../domain/drawing/model';
import {strokes,strokeFor} from '../domain/drawing/strokes';
import {inkRuns,strokeInk} from '../domain/drawing/appearance';
import {drawingItemById} from '../domain/drawing/lookup';
import {moveHandle,unbind} from '../domain/drawing/commands';

test('ear drawing: handle edits reuse topology but keep geometry current; unbind and Undo restore membership',()=>{
 const d=parseDrawing(fixture),id=d.curves.find(c=>c.name==='内耳廓')!.id,original=strokeFor(d,id),shape=shapeOf(d,id),before=JSON.stringify(d);
 const ink=strokeInk(d,original),n=moveHandle(d,{curveId:id,end:0},[shape[1][0]+.01,shape[1][1]+.02]);
 expect(strokeFor(n,id)).toBe(original);expect(shapeOf(n,id)).not.toEqual(shape);expect(strokeInk(n,original)).not.toEqual(ink);
 expect(strokeInk(d,original)).toEqual(ink);expect(JSON.stringify(d)).toBe(before);
 const detached=unbind(d,{curveId:id,end:0});expect(strokeFor(detached,id).segments.length).toBeLessThan(original.segments.length);
 expect(strokeFor(d,id)).toBe(original);
});

test('topology stays current through in-place command draft changes and visible-only queries',()=>{
 const d=parseDrawing(fixture),layer=d.layers.find(l=>l.name==='左耳')!,before=strokes(d,layer.id),saved=structuredClone(d);
 const curve=d.curves.find(c=>c.id===before[0].segments[0].id)!;
 curve.nodes=[curve.nodes[0]+'-detached',curve.nodes[1]+'-detached'];
 expect(strokes(d,layer.id)).not.toBe(before);expect(strokeFor(d,curve.id).segments).toHaveLength(1);
 d.curves=structuredClone(saved.curves);expect(strokes(d,layer.id)).toBe(before);
 const visible=strokes(d,layer.id,true);for(const c of d.curves)if(layer.items.includes(c.id))c.visible=false;
 expect(strokes(d,layer.id,true)).toEqual([]);expect(visible.length).toBeGreaterThan(0);expect(strokes(d,layer.id)).toBe(before);
 layer.items.reverse();expect(strokes(d,layer.id)).not.toBe(before);
});

test('fast lookup follows same-length replacement/reorder, insertion and deletion in mutable drafts',()=>{
 const a={id:'a',value:1},b={id:'b',value:2},items=[a,b];
 expect(drawingItemById(items,'a')).toBe(a);expect(drawingItemById(items,'missing')).toBeUndefined();
 items[0]={id:'a',value:3};expect(drawingItemById(items,'a')?.value).toBe(3);
 items.reverse();expect(drawingItemById(items,'a')?.value).toBe(3);expect(drawingItemById(items,'b')).toBe(b);
 items[0]={id:'missing',value:4};expect(drawingItemById(items,'missing')?.value).toBe(4);expect(drawingItemById(items,'b')).toBeUndefined();
 items.push(b);expect(drawingItemById(items,'b')).toBe(b);items.splice(0,2);expect(drawingItemById(items,'a')).toBeUndefined();expect(drawingItemById(items,'b')).toBe(b);
});

test('ink cache detaches mutable source points and invalidates for geometry, width, visibility and interval style',()=>{
 const s:Cubic=[[0,0],[.3,.1],[.7,.1],[1,0]],original=structuredClone(s),base=inkRuns([s],.01,'UNIFORM'),saved=structuredClone(base);
 s[1][1]=.4;expect(inkRuns([s],.01,'UNIFORM')).not.toEqual(saved);expect(base).toEqual(saved);
 expect(inkRuns([original],.01,'UNIFORM')).toBe(base);
 expect(inkRuns([original],.02,'UNIFORM')[0].outline).not.toEqual(base[0].outline);
 expect(inkRuns([original],.01,'UNIFORM',false,[false])).toEqual([]);
 const masked=inkRuns([original],.01,'UNIFORM',false,undefined,false,undefined,[],[[.2,.8]]);
 expect(masked[0].shapes).not.toEqual(base[0].shapes);
 const taper=inkRuns([original],.01,'UNIFORM',false,undefined,false,undefined,[],[[.2,.8]],[{start:.2,end:.8,ends:[{taper:.1},{extension:.1}]}]);
 expect(taper).not.toEqual(masked);
});

test('editing one ear does not rebuild unchanged ink on the other ear',()=>{
 const d=parseDrawing(fixture),id=d.curves.find(c=>c.name==='内耳廓')!.id,other=d.layers.find(l=>l.name==='右耳')!,s=strokes(d,other.id)[0];
 const before=strokeInk(d,s),c=curveById(d,id),n=moveHandle(d,{curveId:id,end:0},[c.handles[0][0]+.01,c.handles[0][1]+.01]);
 const after=strokeInk(n,s);expect(after).toEqual(before);expect(after[0]).toBe(before[0]);
});
