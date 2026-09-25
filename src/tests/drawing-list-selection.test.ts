import {test,expect} from 'vitest';
import {drawingListRows,selectListRows,type ListRow} from '../ui/drawing/listSelection';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument as Doc} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import {createGroup} from '../domain/drawing/groups';
import {createFill} from '../domain/drawing/paintCommands';
import {strokeFor,strokeIds} from '../domain/drawing/strokes';

const rows:ListRow[]=Array.from({length:6},(_,i)=>({key:'curve:'+i,ids:[String(i)],kind:'curve'}));
const plain={shift:false,toggle:false},shift={shift:true,toggle:false};
test('range selection follows displayed order in either direction; repeated Shift keeps its anchor and can shrink',()=>{
 const first=selectListRows(rows,null,'curve:1',[],plain),range=selectListRows(rows,first.anchor,'curve:4',first.ids,shift);
 expect(range).toEqual({ids:['1','2','3','4'],anchor:'curve:1'});
 expect(selectListRows(rows,range.anchor,'curve:2',range.ids,shift)).toEqual({ids:['1','2'],anchor:'curve:1'});
 expect(selectListRows(rows,'curve:4','curve:1',['4'],shift).ids).toEqual(['1','2','3','4']);
});
test('Ctrl/Cmd toggles without a range; modified Shift adds a range; missing anchor starts a new selection',()=>{
 const mod={shift:false,toggle:true};expect(selectListRows(rows,'curve:0','curve:4',['0'],mod)).toEqual({ids:['0','4'],anchor:'curve:4'});
 expect(selectListRows(rows,'curve:4','curve:0',['0','4'],mod).ids).toEqual(['4']);
 expect(selectListRows(rows,'curve:2','curve:4',['0'],{shift:true,toggle:true}).ids).toEqual(['0','2','3','4']);
 expect(selectListRows(rows,'missing','curve:3',['0'],shift)).toEqual({ids:['3'],anchor:'curve:3'});
});
function fixture(){let d=c.addLayer(emptyDrawing(),'Eye');const e=c.ellipse(d,d.layers[0].id,[-.4,-.3],[.4,.3],.02);d=createFill(e.document,e.ids,'black');d=c.createCurve(d,d.layers[0].id,[[0,.6],[.1,.7],[.2,.7],[.3,.6]],.01,'Brow','brow');return {d,ids:e.ids};}
test('sidebar row keys distinguish stroke headers and segments; collapsed groups/ranges select complete contents',()=>{
 let {d,ids}=fixture();d=createGroup(d,[ids[0],'brow']);const group=d.groups![0],stroke=strokeFor(d,ids[0]);
 const open=drawingListRows(d,[]);expect(open.map(r=>r.key)).toContain('stroke:'+stroke.id);expect(open.map(r=>r.key)).toContain('curve:'+stroke.id);
 const segments=strokeIds(stroke),range=selectListRows(open,'curve:'+segments[0],'curve:'+segments[2],[],shift);expect(range.ids).toEqual(segments.slice(0,3));expect(range.ids).not.toContain(d.fills[0].id);
 const folded=drawingListRows(d,[group.id]);expect(folded.map(r=>r.key)).toEqual(['layer:'+d.layers[0].id,'group:'+group.id]);expect(new Set(folded[1].ids)).toEqual(new Set([...group.curveIds,d.fills[0].id]));
 expect(drawingListRows(d,[d.layers[0].id])).toHaveLength(1);
});
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
test('batch deletion permits hidden selected segments and preserves unrelated geometry, locks and valid topology',()=>{
 const {d,ids}=fixture(),before=structuredClone(d),hidden=c.setStrokeState(d,ids[0],{visible:false}),removed=c.deleteObjects(hidden,[ids[0],ids[1]]);
 expect(removed.curves).toHaveLength(3);expect(shapeOf(removed,'brow')).toEqual(shapeOf(d,'brow'));expect(removed.fills).toEqual(hidden.fills);valid(removed);expect(d).toEqual(before);
 const locked=c.curveChange(hidden,ids[0],{locked:true});expect(()=>c.deleteObjects(locked,[ids[0],ids[1]])).toThrow(/锁定/);expect(locked.curves).toHaveLength(d.curves.length);
});
test('mixed selection removes selected curve and fill in one immutable command; deleting a whole group removes its container',()=>{
 let {d,ids}=fixture();d=createGroup(d,[ids[0],'brow']);const before=structuredClone(d),all=d.layers[0].items,n=c.deleteObjects(d,all);
 expect(n.curves).toEqual([]);expect(n.fills).toEqual([]);expect(n.nodes).toEqual([]);expect(n.joins).toEqual([]);expect(n.groups).toEqual([]);expect(n.layers[0].items).toEqual([]);expect(d).toEqual(before);valid(n);
});
