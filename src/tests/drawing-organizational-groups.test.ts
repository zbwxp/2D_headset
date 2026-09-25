import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as p from '../domain/drawing/paintCommands';
import * as g from '../domain/drawing/groups';
import {emptyDrawing,parseDrawing,layerFor,shapeOf,visible,editable,groupFor,type DrawingDocument} from '../domain/drawing/model';
import {strokes} from '../domain/drawing/strokes';
import {fillVisible} from '../domain/drawing/appearance';
function fixture(){let d=c.addLayer(emptyDrawing(),'Eye');const layer=d.layers[0].id,e=c.ellipse(d,layer,[-.6,-.4],[.6,.4],.02);d=p.createFill(e.document,e.ids,'white');d=c.createCurve(d,layer,[[-.7,.6],[-.2,.8],[.2,.8],[.7,.6]],.01,'Brow','brow');d=c.createCurve(d,layer,[[-.7,-.7],[-.2,-.8],[.2,-.8],[.7,-.7]],.03,'Other','other');return {d,layer,ids:e.ids};}
function valid(d:DrawingDocument){expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);}
test('group independent strokes without changing geometry, joins, ink or object identity; atomic ungroup',()=>{
 const {d,layer,ids}=fixture(),snapshot=structuredClone(d),n=g.createGroup(d,[ids[0],'brow'],'Eye set');
 expect(n.nodes).toEqual(d.nodes);expect(n.curves).toEqual(d.curves);expect(n.joins).toEqual(d.joins);expect(n.fills).toEqual(d.fills);expect(strokes(n,layer)).toHaveLength(3);expect(n.groups![0].curveIds).toHaveLength(5);expect(g.selectionUnit(n,ids[2])).toEqual(n.groups![0].curveIds);expect(g.groupTree(n,layer)).toHaveLength(2);valid(n);
 const u=g.ungroup(n,n.groups![0].curveIds);expect(u.groups).toEqual([]);expect(u.curves).toEqual(d.curves);expect(u.layers).toEqual(n.layers);valid(u);expect(d).toEqual(snapshot);
});
test('group actions batch member flags; member overrides remain visible and editable',()=>{
 const {d,ids}=fixture();let n=g.createGroup(d,[ids[0],'brow']);const id=n.groups![0].id;n=c.curveChange(n,'brow',{visible:false});const snapshot=structuredClone(n);
 const hide=g.changeGroup(n,id,{visible:false});expect(visible(hide,ids[0])).toBe(false);expect(fillVisible(hide,hide.fills[0])).toBe(false);expect(hide.curves.filter(c=>n.groups![0].curveIds.includes(c.id)).every(c=>!c.visible)).toBe(true);
 const one=c.curveChange(hide,'brow',{visible:true});expect(visible(one,'brow')).toBe(true);expect(visible(one,ids[0])).toBe(false);
 const shown=g.changeGroup(one,id,{visible:true});expect(visible(shown,'brow')).toBe(true);expect(fillVisible(shown,shown.fills[0])).toBe(true);
 const locked=g.changeGroup(shown,id,{locked:true});expect(editable(locked,ids[0])).toBe(false);
 expect(()=>c.moveNode(locked,locked.curves[0].nodes[0],[1,1])).toThrow(/锁定/);
 expect(()=>g.ungroup(locked,locked.groups![0].curveIds)).toThrow(/锁定/);
 const unlocked=c.curveChange(locked,'brow',{locked:false});expect(editable(unlocked,'brow')).toBe(true);expect(editable(unlocked,ids[0])).toBe(false);expect(()=>c.moveHandle(unlocked,{curveId:'brow',end:0},[0,1])).not.toThrow();
 expect(p.changePaint(locked,locked.fills[0].id,{visible:false}).fills[0].visible).toBe(false);
 valid(unlocked);expect(n).toEqual(snapshot);
});
test('group drag, duplication and parse preserve whole-stroke and fill ownership',()=>{
 let {d,layer,ids}=fixture();d=g.createGroup(d,[ids[0],'brow'],'Eye');d=c.addLayer(d,'New');const target=d.layers[0].id,gid=d.groups![0].id,before=structuredClone(d),n=p.dropPaint(d,gid,target);
 expect(n.groups).toEqual(d.groups);expect(layerFor(n,ids[2])!.id).toBe(target);expect(layerFor(n,n.fills[0].id)!.id).toBe(target);expect(n.curves).toEqual(d.curves);expect(g.groupTree(n,layer).map(x=>x.id)).toEqual(['other']);valid(n);
 const clone=c.duplicateCurves(n,n.groups![0].curveIds).document;expect(clone.groups).toHaveLength(2);expect(clone.fills).toHaveLength(2);expect(clone.groups![1].curveIds.every(id=>!n.groups![0].curveIds.includes(id))).toBe(true);expect(groupFor(clone,clone.fills[1].id)!.id).toBe(clone.groups![1].id);valid(clone);
 const layerClone=c.duplicateLayer(n,target);expect(layerClone.groups).toHaveLength(2);expect(layerClone.fills).toHaveLength(2);valid(layerClone);expect(d).toEqual(before);
});
test('split, remove, connect, partial layer move and regroup keep memberships valid',()=>{
 let {d,ids}=fixture();d=g.createGroup(d,[ids[0],'brow']);const split=c.splitCurve(d,'brow',.4);expect(split.document.groups![0].curveIds).toContain(split.ids[1]);valid(split.document);
 const removed=c.deleteCurves(d,['brow']);expect(removed.groups![0].curveIds).not.toContain('brow');valid(removed);
 const connected=c.connect(d,{curveId:'brow',end:1},{curveId:'other',end:0},'POSITION');expect(connected.groups![0].curveIds).toContain('other');valid(connected);
 const another=c.addLayer(d,'Other'),moved=c.moveToLayer(another,['brow'],another.layers[0].id);expect(moved.groups![0].curveIds).not.toContain('brow');valid(moved);
 const grouped=g.createGroup(d,['brow','other']);expect(grouped.groups).toHaveLength(1);expect(grouped.groups![0].curveIds).toHaveLength(6);valid(grouped);
});
test('reject cross-layer or only-one-stroke groups and corrupt persisted memberships',()=>{
 let {d,ids}=fixture();expect(()=>g.createGroup(d,ids)).toThrow(/两条/);d=c.addLayer(d,'Other');d=c.moveToLayer(d,['other'],d.layers[0].id);expect(()=>g.createGroup(d,[ids[0],'other'])).toThrow(/同一图层/);
 const n=g.createGroup(d,[ids[0],'brow']);for(const curveIds of [[ids[0]],['missing'],[...n.groups![0].curveIds,'other'],[...n.groups![0].curveIds,'brow']])expect(()=>parseDrawing({...n,groups:[{...n.groups![0],curveIds}]})).toThrow();
});
test('group transforms move each curve rigidly, direct edits still affect only the chosen member',()=>{
 const {d,ids}=fixture(),n=g.createGroup(d,[ids[0],'brow']),delta=[.1,.2],moved=c.transform(n,n.groups![0].curveIds,p=>[p[0]+delta[0],p[1]+delta[1]]);
 for(const id of n.groups![0].curveIds)expect(shapeOf(moved,id)).toEqual(shapeOf(n,id).map(p=>[p[0]+delta[0],p[1]+delta[1]]));expect(shapeOf(moved,'other')).toEqual(shapeOf(n,'other'));
 const handle=c.moveHandle(n,{curveId:'brow',end:0},[0,1]);expect(shapeOf(handle,ids[0])).toEqual(shapeOf(n,ids[0]));valid(moved);valid(handle);
});
test('moving a visible group includes hidden members without revealing them; individual locks still protect them',()=>{
 const {d,ids}=fixture();let n=g.createGroup(d,[ids[0],'brow']);n=c.curveChange(n,'brow',{visible:false});const moved=c.transform(n,n.groups![0].curveIds,p=>[p[0]+.1,p[1]]);expect(visible(moved,'brow')).toBe(false);expect(shapeOf(moved,'brow')[0][0]).toBeCloseTo(shapeOf(n,'brow')[0][0]+.1);valid(moved);
 const locked=c.curveChange(n,'brow',{locked:true});expect(()=>c.transform(locked,locked.groups![0].curveIds,p=>[p[0]+.1,p[1]])).toThrow(/锁定/);
});
test('grouping accepts hidden curves and hidden layers without changing their visibility',()=>{
 const {d,layer,ids}=fixture(),hidden=c.curveChange(d,'brow',{visible:false});
 for(const source of [hidden,c.layerChange(hidden,layer,{visible:false}),c.setStrokeState(hidden,ids[0],{visible:false})]){
  const before=structuredClone(source);expect(g.groupingIssue(source,[ids[0],'brow'])).toBeUndefined();
  const grouped=g.createGroup(source,[ids[0],'brow']);expect(grouped.curves).toEqual(source.curves);expect(grouped.fills).toEqual(source.fills);expect(grouped.layers[0].visible).toBe(source.layers[0].visible);
  for(const id of grouped.groups![0].curveIds)expect(visible(grouped,id)).toBe(visible(source,id));expect(fillVisible(grouped,grouped.fills[0])).toBe(fillVisible(source,source.fills[0]));valid(grouped);expect(source).toEqual(before);
 }
});
test('regrouping a hidden group keeps its strokes and owned fill hidden',()=>{
 const {d,ids}=fixture();let source=g.createGroup(d,[ids[0],'brow']);source=g.changeGroup(source,source.groups![0].id,{visible:false});const before=structuredClone(source),grouped=g.createGroup(source,['brow','other']);
 expect(grouped.groups).toHaveLength(1);expect(grouped.groups![0].curveIds).toHaveLength(6);expect(visible(grouped,'other')).toBe(true);expect(visible(grouped,'brow')).toBe(false);expect(ids.every(id=>!visible(grouped,id))).toBe(true);expect(fillVisible(grouped,grouped.fills[0])).toBe(false);valid(grouped);expect(source).toEqual(before);
});
test('grouping still rejects locked members, groups and layers even when hidden',()=>{
 const {d,layer,ids}=fixture(),hidden=c.curveChange(d,'brow',{visible:false});let grouped=g.createGroup(d,[ids[0],'brow']);grouped=g.changeGroup(grouped,grouped.groups![0].id,{visible:false,locked:true});
 for(const source of [c.curveChange(hidden,'brow',{locked:true}),c.layerChange(hidden,layer,{locked:true}),grouped])expect(()=>g.createGroup(source,['brow','other'])).toThrow(/锁定/);
});
test('promote a group into its own layer with its name, ordered fills and unchanged source geometry',()=>{
 let {d,layer,ids}=fixture();d=g.createGroup(d,[ids[0],'brow'],'Eye details');d=c.addLayer(d,'Above');const before=structuredClone(d),group=d.groups![0],items=g.groupObjectIds(d,group),result=g.groupToLayer(d,group.id),n=result.document;
 expect(n.layers.map(l=>l.name)).toEqual(['Above','Eye details','Eye']);expect(n.layers[1]).toEqual({id:result.layerId,name:'Eye details',visible:true,locked:false,items});expect(n.layers.find(l=>l.id===layer)!.items).toEqual(['other']);expect(n.groups).toEqual([]);expect(n.curves).toEqual(d.curves);expect(n.nodes).toEqual(d.nodes);expect(n.joins).toEqual(d.joins);expect(n.fills).toEqual(d.fills);valid(n);expect(d).toEqual(before);
});
test('promotion keeps hidden member flags and inherits hidden group/layer visibility',()=>{
 const f=fixture();let d=g.createGroup(f.d,[f.ids[0],'brow']);d=c.curveChange(d,'brow',{visible:false});
 for(const source of [d,g.changeGroup(d,d.groups![0].id,{visible:false}),c.layerChange(d,f.layer,{visible:false})]){
  const result=g.groupToLayer(source,source.groups![0].id),n=result.document;
  expect(n.curves).toEqual(source.curves);expect(n.fills).toEqual(source.fills);
  for(const id of source.groups![0].curveIds)expect(visible(n,id)).toBe(visible(source,id));expect(fillVisible(n,n.fills[0])).toBe(fillVisible(source,source.fills[0]));valid(n);
 }
});
test('promotion rejects locked group/member/fill/owner atomically',()=>{
 const {d,layer,ids}=fixture(),n=g.createGroup(d,[ids[0],'brow']);
 for(const source of [g.changeGroup(n,n.groups![0].id,{locked:true}),c.curveChange(n,'brow',{locked:true}),p.changePaint(n,n.fills[0].id,{locked:true}),c.layerChange(n,layer,{locked:true})]){const before=structuredClone(source);expect(()=>g.groupToLayer(source,source.groups![0].id)).toThrow(/锁定/);expect(source).toEqual(before);}
});
