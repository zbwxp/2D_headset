import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,layerFor,shapeOf} from '../domain/drawing/model';
import {layerTree,strokeFor,strokeObjectIds} from '../domain/drawing/strokes';
function fixture(){
 let d=c.addLayer(emptyDrawing(),'Iris');const source=d.layers[0].id,e=c.ellipse(d,source,[-.5,-.4],[.5,.4],.02);d=p.createFill(e.document,e.ids,'black');d=p.createFill(d,e.ids,'white');d=p.createOffset(d,e.ids[0]);const offset=d.offsets[0].id;d=c.addLayer(d,'Hair');const target=d.layers[0].id;d=c.createCurve(d,target,[[0,0],[.3,0],[.6,0],[1,0]],.02,'Other','other');return {d,source,target,ids:e.ids,offset};
}
test('sidebar nests every owned fill, preserves paint order and removes paint whose source was deleted',()=>{
 const {d,source,ids}=fixture(),before=structuredClone(d),tree=layerTree(d,source),owner=tree.find(x=>x.stroke)!;
 expect(owner.fills).toHaveLength(2);expect(tree.map(x=>x.kind)).toEqual(['offset','stroke']);expect(d).toEqual(before);
 const partial=c.deleteCurves(d,[ids[0]]);expect(layerTree(partial,source).filter(x=>x.kind==='fill')).toHaveLength(0);expect(partial.fills).toEqual([]);expect(partial.offsets).toEqual([]);expect(partial.layers.some(layer=>layer.id===source)).toBe(true);
});
test('moving a complete hidden stroke carries fills in paint order, preserves geometry, joins and flags',()=>{
 let {d,source,target,ids,offset}=fixture();d=c.setStrokeState(d,ids[0],{visible:false});d=p.changePaint(d,d.fills[0].id,{visible:false});const before=structuredClone(d),contents=strokeObjectIds(d,strokeFor(d,ids[0]));
 const moved=c.moveToLayer(d,ids,target);expect(d).toEqual(before);expect(moved.layers.find(l=>l.id===target)!.items).toEqual([...contents,'other']);expect(moved.layers.find(l=>l.id===source)!.items).toEqual([offset]);expect(moved.curves).toEqual(d.curves);expect(moved.joins).toEqual(d.joins);expect(moved.nodes).toEqual(d.nodes);expect(moved.fills).toEqual(d.fills);expect(layerTree(moved,target).find(x=>x.stroke&&x.id!=='other')!.fills).toHaveLength(2);expect(parseDrawing(moved)).toEqual(moved);
});
test('cross-layer drop can position the bundle; same-layer sorting keeps its internal ink/fill order',()=>{
 const {d,source,target,ids}=fixture(),contents=strokeObjectIds(d,strokeFor(d,ids[0]));let n=p.dropPaint(d,ids[0],target,'other',true);expect(n.layers.find(l=>l.id===target)!.items).toEqual(['other',...contents]);
 n=p.reorderPaint(n,ids[0],'other');expect(n.layers.find(l=>l.id===target)!.items).toEqual([...contents,'other']);expect(n.curves.map(x=>shapeOf(n,x.id))).toEqual(d.curves.map(x=>shapeOf(d,x.id)));expect(parseDrawing(n)).toEqual(n);
 // A stroke dropped onto a nested fill targets that fill's owning group.
 const onChild=p.dropPaint(d,'other',source,d.fills[0].id,true),items=onChild.layers.find(l=>l.id===source)!.items;expect(items.indexOf('other')).toBeGreaterThan(Math.max(...contents.map(id=>items.indexOf(id))));
});
test('partial selections and locked source/fill/destination reject the complete atomic transfer',()=>{
 const {d,target,ids,source}=fixture(),before=structuredClone(d);expect(()=>c.moveToLayer(d,[ids[0]],target)).toThrow(c.RelatedSelection);
 for(const locked of [c.curveChange(d,ids[2],{locked:true}),p.changePaint(d,d.fills[0].id,{locked:true}),c.layerChange(d,source,{locked:true})])expect(()=>p.dropPaint(locked,ids[0],target)).toThrow(/锁定/);
 expect(d).toEqual(before);expect(layerFor(d,ids[0])!.id).toBe(source);
});
