import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,type Cubic,type DrawingDocument as Doc} from '../domain/drawing/model';
import {strokes,strokeFor,strokeIds,strokePaths,strokePath,strokeName} from '../domain/drawing/strokes';
import {strokeInk,offsetGeometry} from '../domain/drawing/appearance';
function base(){let d=c.addLayer(emptyDrawing(),'Group');for(let i=0;i<5;i++)d=c.createCurve(d,d.layers[0].id,[[i,0],[i+.25,.1],[i+.75,-.1],[i+1,0]] as Cubic,.01,'Segment '+i,String(i));return d;}
function chain(mode:'POSITION'|'SMOOTH'|'CUSP'|'ARC'='POSITION'){let d=base();for(let i=0;i<4;i++)d=c.connect(d,{curveId:String(i),end:1},{curveId:String(i+1),end:0},mode);return d;}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
for(const mode of ['POSITION','SMOOTH','CUSP','ARC'] as const)test(mode+' forms one named group, downgrade retains membership and unbind splits it',()=>{
 let d=chain(mode);expect(strokes(d,d.layers[0].id)).toHaveLength(1);expect(strokeIds(strokeFor(d,'0'))).toHaveLength(5);const before=d.curves.map(x=>shapeOf(d,x.id));d=c.renameStroke(d,'2','Upper eyelid');expect(d.curves.map(x=>shapeOf(d,x.id))).toEqual(before);expect(d.curves.map(x=>x.name)).toEqual(base().curves.map(x=>x.name));expect(strokeName(d,strokeFor(d,'4'))).toBe('Upper eyelid');
 if(d.joins.length)d=c.removeJoin(d,d.joins[1].id);expect(strokes(d,d.layers[0].id)).toHaveLength(1);valid(d);
 d=c.unbind(d,{curveId:'2',end:0});expect(strokes(d,d.layers[0].id)).toHaveLength(2);const newName=c.renameStroke(d,'0','Left group');expect(strokeName(newName,strokeFor(newName,'3'))).toBe('Upper eyelid');expect(strokeName(newName,strokeFor(newName,'1'))).toBe('Left group');valid(newName);
});
test('coincident endpoints and one-shot Merge never create a group; mixed joins do',()=>{
 let d=base();expect(strokes(d,d.layers[0].id)).toHaveLength(5);d=c.merge(d,{curveId:'0',end:1},{curveId:'1',end:0});expect(strokes(d,d.layers[0].id)).toHaveLength(5);
 for(const [i,mode] of (['POSITION','SMOOTH','CUSP','ARC'] as const).entries())d=c.connect(d,{curveId:String(i),end:1},{curveId:String(i+1),end:0},mode);expect(strokes(d,d.layers[0].id)).toHaveLength(1);expect(d.joins.map(j=>j.mode)).toEqual(['SMOOTH','CUSP','ARC']);valid(d);
});
test('position-only chain has a whole-chain profile without changing either handle',()=>{
 const raw=base(),d=chain();expect(d.curves.map(c=>shapeOf(d,c.id))).toEqual(raw.curves.map(c=>shapeOf(raw,c.id)));expect(strokeInk(d,strokeFor(d,'2'))).toHaveLength(1);
 const s=p.setInk(d,['2'],{profile:'TAPER_END'});expect(s.curves.every(c=>c.profile==='TAPER_END')).toBe(true);expect(strokeInk(s,strokeFor(s,'2'))[0].shapes).toHaveLength(5);
 const moved=c.moveHandle(s,{curveId:'1',end:0},[1.3,.5]);expect(shapeOf(moved,'0')).toEqual(shapeOf(s,'0'));valid(moved);
});
test('branch stays a single selectable group while paths do not jump between branch endpoints',()=>{
 let d=c.connect(base(),{curveId:'0',end:1},{curveId:'1',end:0},'ARC');d=c.connect(d,{curveId:'0',end:1},{curveId:'2',end:0},'POSITION');d=c.renameStroke(d,'1','Branch');
 const group=strokeFor(d,'0');expect(strokeIds(group).sort()).toEqual(['0','1','2']);expect(strokePaths(group)).toHaveLength(2);expect(strokePath(d,group).match(/M/g)).toHaveLength(2);expect(strokeInk(d,group)).toHaveLength(2);expect(strokeName(d,strokeFor(d,'2'))).toBe('Branch');
 const offset=p.createOffset(d,'2');expect(offset.offsets[0].source.map(x=>x.id)).toEqual(['2']);expect(offsetGeometry(offset,offset.offsets[0]).error).toBeUndefined();valid(offset);
});
test('POSITION closed loops render once without artificial starts or ends',()=>{
 const d=chain(),n=c.connect(d,{curveId:'4',end:1},{curveId:'0',end:0},'POSITION'),s=strokeFor(n,'2');expect(s.closed).toBe(true);expect(strokePath(n,s).match(/M/g)).toHaveLength(1);expect(strokePath(n,s)).toMatch(/ Z$/);expect(strokeInk(n,s)[0].closed).toBe(true);valid(n);
});
test('name survives split, deletion, reorder, duplication, Save/Load; reconnect prefers first-click group name',()=>{
 let d=c.renameStroke(chain(),'0','Jaw');const split=c.splitCurve(d,'2',.5);d=c.deleteCurves(split.document,['0']);expect(strokeName(d,strokeFor(d,'4'))).toBe('Jaw');valid(d);
 const dupe=c.duplicateCurves(d,strokeIds(strokeFor(d,'1')));expect(strokeName(dupe.document,strokeFor(dupe.document,dupe.ids[0]))).toBe('Jaw');const copy=c.renameStroke(dupe.document,dupe.ids[0],'Jaw copy');expect(strokeName(copy,strokeFor(copy,'1'))).toBe('Jaw');
 const n=c.connect(copy,{curveId:'1',end:0},{curveId:dupe.ids[0],end:0},'POSITION');expect(strokeName(n,strokeFor(n,dupe.ids[0]))).toBe('Jaw');valid(n);
 const locked=c.curveChange(d,'4',{locked:true});expect(()=>c.renameStroke(locked,'1','Bad')).toThrow(/锁定/);expect(()=>parseDrawing({...d,curves:d.curves.map(c=>({...c,strokeName:42}))})).toThrow();
});
