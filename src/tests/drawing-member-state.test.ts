import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import * as g from '../domain/drawing/groups';
import {emptyDrawing,parseDrawing,visible,editable,curveById,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {objectState} from '../domain/drawing/objectState';
import {fillVisible,fillGeometry} from '../domain/drawing/appearance';

function fixture(){
 let d=c.addLayer(emptyDrawing(),'Eye');const layer=d.layers[0].id;
 const e=c.ellipse(d,layer,[-.4,-.3],[.4,.3],.02);d=p.createFill(e.document,e.ids,'white');
 d=c.createCurve(d,layer,[[-.6,.5],[-.2,.7],[.2,.7],[.6,.5]],.02,'Brow','brow');d=p.createOffset(d,'brow');
 d=g.createGroup(d,[e.ids[0],'brow']);return {d,layer,group:d.groups![0].id,ellipse:e.ids,fill:d.fills[0].id,offset:d.offsets[0].id};
}
const valid=(d:DrawingDocument)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
test('layer hide/lock batches curves, owned fill and offset; an individual member can show/unlock and edit',()=>{
 const {d,layer,group,fill,offset}=fixture(),before=structuredClone(d),hidden=c.layerChange(d,layer,{visible:false,locked:true});
 expect(objectState(hidden,hidden.layers[0].items)).toMatchObject({anyVisible:false,allLocked:true});
 let n=c.curveChange(hidden,'brow',{visible:true,locked:false});expect(editable(n,'brow')).toBe(true);
 expect(objectState(n,n.layers[0].items)).toMatchObject({anyVisible:true,allVisible:false,anyLocked:true,allLocked:false});
 n=c.moveHandle(n,{curveId:'brow',end:0},[-.3,.8]);expect(shapeOf(n,'brow')).not.toEqual(shapeOf(d,'brow'));
 expect(n.offsets[0]).toMatchObject({visible:false,locked:true});
 n=p.changePaint(n,offset,{visible:true,locked:false});n=p.changePaint(n,offset,{distance:.04});expect(n.offsets[0].distance).toBe(.04);
 n=p.changePaint(n,fill,{visible:true,locked:false});expect(fillVisible(n,n.fills[0])).toBe(true);
 expect(fillGeometry(n,n.fills[0])).toEqual(fillGeometry(d,d.fills[0]));
 n=g.changeGroup(n,group,{visible:true,locked:false});expect(n.curves.every(c=>c.visible&&!c.locked)).toBe(true);
 valid(n);expect(d).toEqual(before);
});
test('batch commands remain repeatable after overrides and do not bind future members',()=>{
 const {d,layer,group}=fixture(),hidden=g.changeGroup(d,group,{visible:false});
 const one=c.curveChange(hidden,'brow',{visible:true}),again=g.changeGroup(one,group,{visible:false});expect(visible(again,'brow')).toBe(false);
 expect(g.changeGroup(again,group,{visible:false})).toBe(again);
 const locked=c.layerChange(again,layer,{locked:true}),fresh=c.createCurve(locked,layer,[[0,0],[.1,0],[.2,0],[.3,0]],.01,'New','new');
 expect(editable(fresh,'new')).toBe(true);expect(editable(fresh,'brow')).toBe(false);
 const shown=c.layerChange(fresh,layer,{visible:true,locked:false});expect(objectState(shown,shown.layers[0].items)).toMatchObject({allVisible:true,anyLocked:false});valid(shown);
});
test('whole-stroke hide/lock also allows a fill-only override and independent unlock',()=>{
 const {d,ellipse,fill}=fixture(),hidden=c.setStrokeState(d,ellipse[0],{visible:false,locked:true});
 const n=p.changePaint(hidden,fill,{visible:true,locked:false});expect(fillVisible(n,n.fills[0])).toBe(true);
 expect(ellipse.every(id=>!visible(n,id)&&curveById(n,id).locked)).toBe(true);valid(n);
 const shown=c.setStrokeState(n,ellipse[0],{visible:true,locked:false});expect(shown.fills[0]).toMatchObject({visible:true,locked:false});valid(shown);
});
test('V2 migration materializes inherited states once; partial overrides survive subsequent load',()=>{
 const {d,layer,group,ellipse,fill,offset}=fixture();
 const legacy={...structuredClone(d),version:2,layers:d.layers.map(l=>({...l,locked:true})),groups:d.groups!.map(g=>({...g,visible:false}))};
 const before=structuredClone(legacy),loaded=parseDrawing(legacy);
 expect(loaded.version).toBe(3);expect(loaded.nodes).toEqual(d.nodes);expect(loaded.joins).toEqual(d.joins);
 expect(loaded.curves.every(c=>!c.visible&&c.locked)).toBe(true);expect(fillVisible(loaded,loaded.fills[0])).toBe(false);
 expect(loaded.offsets[0]).toMatchObject({visible:true,locked:true});expect(legacy).toEqual(before);
 let n=c.curveChange(loaded,'brow',{visible:true,locked:false});n=p.changePaint(n,fill,{visible:true,locked:false});valid(n);
 const reload=parseDrawing(JSON.parse(JSON.stringify(n)));expect(editable(reload,'brow')).toBe(true);expect(ellipse.every(id=>!editable(reload,id))).toBe(true);expect(fillVisible(reload,reload.fills[0])).toBe(true);
 // The group and layer commands can still override all current members after migration.
 n=g.changeGroup(reload,group,{visible:true,locked:false});n=c.layerChange(n,layer,{locked:false});expect(n.offsets.find(o=>o.id===offset)!.locked).toBe(false);valid(n);
});
test('legacy stroke-hidden fills and layer-hidden offsets preserve appearance without a hidden parent gate',()=>{
 const {d,fill}=fixture(),legacy={...d,version:2,fills:d.fills.map(f=>({...f,hiddenWithStroke:true})),layers:d.layers.map(l=>({...l,visible:false}))};
 const loaded=parseDrawing(legacy);expect(loaded.offsets[0].visible).toBe(false);expect(loaded.fills[0].visible).toBe(false);expect(loaded.fills[0].hiddenWithStroke).toBeUndefined();
 const n=p.changePaint(loaded,fill,{visible:true});expect(fillVisible(n,n.fills[0])).toBe(true);expect(n.curves.every(c=>!c.visible)).toBe(true);valid(n);
});
