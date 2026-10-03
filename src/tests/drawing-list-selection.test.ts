import {test,expect} from 'vitest';
import {drawingListRows,selectListRows,selectLayerRows,layerBatchScope,type ListRow} from '../ui/drawing/listSelection';
import {setObjectState} from '../domain/drawing/objectState';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument as Doc} from '../domain/drawing/model';
import * as c from '../domain/drawing/commands';
import {createGroup} from '../domain/drawing/groups';
import {createFill} from '../domain/drawing/paintCommands';
import {strokeFor,strokeIds} from '../domain/drawing/strokes';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PaintScene from '../ui/drawing/PaintScene';

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
 expect(removed.curves).toHaveLength(3);expect(shapeOf(removed,'brow')).toEqual(shapeOf(d,'brow'));expect(removed.fills).toEqual([]);expect(removed.layers).toHaveLength(hidden.layers.length);valid(removed);expect(d).toEqual(before);
 const locked=c.curveChange(hidden,ids[0],{locked:true});expect(()=>c.deleteObjects(locked,[ids[0],ids[1]])).toThrow(/锁定/);expect(locked.curves).toHaveLength(d.curves.length);
});
test('mixed selection removes selected curve and fill in one immutable command; deleting a whole group removes its container',()=>{
 let {d,ids}=fixture();d=createGroup(d,[ids[0],'brow']);const before=structuredClone(d),all=d.layers[0].items,n=c.deleteObjects(d,all);
 expect(n.curves).toEqual([]);expect(n.fills).toEqual([]);expect(n.nodes).toEqual([]);expect(n.joins).toEqual([]);expect(n.groups).toEqual([]);expect(n.layers[0].items).toEqual([]);expect(d).toEqual(before);valid(n);
});

test('layer ranges select identities, including empty layers, independent of expanded object rows',()=>{
 let {d}=fixture();d=c.addLayer(d,'Empty');d=c.addLayer(d,'Hair');
 const [hair,empty,eye]=d.layers.map(l=>l.id),first=selectLayerRows(d.layers,null,eye,[],plain);
 const range=selectLayerRows(d.layers,first.anchor,hair,first.ids,shift);
 expect(range.ids).toEqual([hair,empty,eye]);expect(drawingListRows(d,[]).length).toBeGreaterThan(3);
 expect(selectLayerRows(d.layers,range.anchor,empty,range.ids,shift).ids).toEqual([empty,eye]);
 const toggled=selectLayerRows(d.layers,range.anchor,empty,range.ids,{shift:false,toggle:true});
 expect(toggled.ids).toEqual([hair,eye]);
 expect(selectLayerRows(d.layers,toggled.anchor,eye,toggled.ids,{shift:true,toggle:true}).ids).toEqual([hair,empty,eye]);
});
test('layer batch scope includes hidden fills and members; does not reach another layer or alter geometry',()=>{
 let {d,ids}=fixture();const eye=d.layers[0].id;d=createGroup(d,[ids[0],'brow']);
 d=c.addLayer(d,'Other');const other=d.layers[0].id;d=c.createCurve(d,other,[[1,0],[1,1],[2,1],[2,0]],.01,'Other','other');
 const before=structuredClone(d),scope=layerBatchScope(d,[eye]),n=setObjectState(d,scope.items,{visible:false,locked:true});
 expect(scope.selected).toEqual([eye]);expect(scope.items).toContain(d.fills[0].id);expect(scope.foldIds).toContain(d.groups![0].id);expect(scope.foldIds).not.toContain(other);
 expect(n.curves.find(c=>c.id==='other')).toEqual(d.curves.find(c=>c.id==='other'));
 expect(n.curves.filter(c=>c.id!=='other').every(c=>!c.visible&&c.locked)).toBe(true);expect(n.fills.every(f=>!f.visible&&f.locked)).toBe(true);
 expect(n.nodes).toEqual(d.nodes);expect(d).toEqual(before);
 expect(layerBatchScope(d,[]).items).toEqual(d.layers.flatMap(l=>l.items));
});
test('multi-layer deletion is atomic, removes empty layers too, and respects member locks',()=>{
 let {d}=fixture();const eye=d.layers[0].id;d=c.addLayer(d,'Empty');const empty=d.layers[0].id;d=c.addLayer(d,'Keep');const keep=d.layers[0].id;
 const before=structuredClone(d),n=c.deleteLayers(d,[empty,eye]);expect(n.layers.map(l=>l.id)).toEqual([keep]);expect(n.curves).toEqual([]);expect(n.fills).toEqual([]);valid(n);expect(d).toEqual(before);
 const locked=c.curveChange(d,d.curves[0].id,{locked:true});expect(()=>c.deleteLayers(locked,[empty,eye])).toThrow(/锁定/);expect(locked.layers).toHaveLength(3);
});
test('layer fill preview overrides the global view without changing saved fills or other layers',()=>{
 let {d}=fixture();const eye=d.layers[0].id,first=d.fills[0].id;
 d=c.addLayer(d,'Other');const other=d.layers[0].id,e=c.ellipse(d,other,[1,1],[2,2],.01);d=createFill(e.document,e.ids,'white');const second=d.fills.at(-1)!.id,before=structuredClone(d);
 const render=(showFills:boolean,fillVisibility:Record<string,boolean>)=>renderToStaticMarkup(createElement(PaintScene,{d,showFills,fillVisibility,screen:p=>p,unit:250,preview:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}}));
 const scoped=render(true,{[eye]:false});expect(scoped).not.toContain(`data-id="${first}"`);expect(scoped).toContain(`data-id="${second}"`);
 const reverse=render(false,{[eye]:true});expect(reverse).toContain(`data-id="${first}"`);expect(reverse).not.toContain(`data-id="${second}"`);
 d={...d,fills:d.fills.map(f=>f.id===first?{...f,visible:false}:f)};expect(render(true,{[eye]:true})).not.toContain(`data-id="${first}"`);expect(before.fills[0].visible).toBe(true);
});
