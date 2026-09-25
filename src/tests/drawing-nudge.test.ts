import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,add,sub,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {translateObjects} from '../domain/drawing/movement';
import {offsetGeometry} from '../domain/drawing/appearance';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {nudgeSelection} from '../ui/drawing/nudge';

function base(){let d=c.addLayer(emptyDrawing(),'Lines');d=c.createCurve(d,d.layers[0].id,[[-1,0],[-.7,.1],[-.3,.1],[0,0]],.02,'A','a');return c.createCurve(d,d.layers[0].id,[[0,0],[.3,-.1],[.7,-.1],[1,0]],.02,'B','b');}
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
const shifted=(a:Doc,b:Doc,id:string,delta:Point2)=>shapeOf(b,id).forEach((p,i)=>near(p,add(shapeOf(a,id)[i],delta)));

test('nudging a joined segment preserves its shape and moves only the shared side of its neighbour',()=>{
 const d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH'),before=structuredClone(d),delta:Point2=[.04,.02],n=nudgeSelection(d,{ids:['a']},delta);
 shifted(d,n,'a',delta);near(shapeOf(n,'b')[0],add(shapeOf(d,'b')[0],delta));near(shapeOf(n,'b')[1],add(shapeOf(d,'b')[1],delta));expect(shapeOf(n,'b').slice(2)).toEqual(shapeOf(d,'b').slice(2));valid(n);expect(d).toEqual(before);
 expect(()=>nudgeSelection(c.curveChange(d,'b',{locked:true}),{ids:['a']},delta)).toThrow(/锁定/);
});
test('bound endpoints and constrained handles remain valid; hidden list members can move without being shown',()=>{
 let d=c.connect(base(),{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');d=c.curveChange(d,'b',{visible:false});const endpoint={curveId:'a',end:1 as const},node=nodeAt(d,endpoint).id;
 const n=nudgeSelection(d,{ids:['a'],node},[.01,.02]);near(nodeAt(n,endpoint).position,[.01,.02]);expect(n.curves[1].visible).toBe(false);valid(n);
 const h=nudgeSelection(n,{ids:['a'],handle:endpoint},[0,.02]);expect(h.nodes).toEqual(n.nodes);valid(h);
 const linked=c.linkEndpoints(base(),endpoint,{curveId:'b',end:0});const moved=nudgeSelection(linked,{ids:['a'],node:nodeAt(linked,endpoint).id},[.02,0]);near(nodeAt(moved,{curveId:'b',end:0}).position,[.02,0]);valid(moved);
});
test('fill nudge moves hidden boundary once, preserves fill ownership and rejects a locked boundary atomically',()=>{
 let d=c.addLayer(emptyDrawing());const e=c.ellipse(d,d.layers[0].id,[-.5,-.5],[.5,.5],.01);d=paint.createFill(e.document,e.ids,'white');d=c.setStrokeState(d,e.ids[0],{visible:false});const fill=d.fills[0],delta:Point2=[.02,.01];
 const n=nudgeSelection(d,{ids:e.ids,paintIds:[fill.id]},delta);e.ids.forEach(id=>shifted(d,n,id,delta));expect(n.fills).toEqual(d.fills);expect(n.layers).toEqual(d.layers);expect(n.curves.every(x=>!x.visible)).toBe(true);valid(n);
 expect(()=>nudgeSelection(c.curveChange(d,e.ids[0],{locked:true}),{ids:[],paint:fill.id},delta)).toThrow(/锁定/);
});
test('offset nudge keeps its relation, persists its translation and bakes identical independent curves on detach',()=>{
 const d=paint.createOffset(base(),'a'),o=d.offsets[0],delta:Point2=[.04,.01],n=translateObjects(d,[o.id],delta),g=offsetGeometry(d,o),ng=offsetGeometry(n,n.offsets[0]);
 expect(n.curves).toEqual(d.curves);expect(n.offsets[0].source).toEqual(o.source);g.shapes.forEach((s,i)=>s.forEach((p,j)=>near(ng.shapes[i][j],add(p,delta))));valid(n);
 const mixed=translateObjects(n,['a',o.id],delta);expect(mixed.offsets[0].translation).toEqual(delta);offsetGeometry(mixed,mixed.offsets[0]).shapes.forEach((s,i)=>s.forEach((p,j)=>near(p,add(ng.shapes[i][j],delta))));
 const detached=paint.detachOffset(n,o.id);detached.ids.forEach((id,i)=>shapeOf(detached.document,id).forEach((p,j)=>near(p,ng.shapes[i][j])));valid(detached.document);
 expect(()=>parseDrawing({...n,offsets:[{...n.offsets[0],translation:[NaN,0]}]})).toThrow();
 expect(()=>translateObjects(paint.changePaint(n,o.id,{locked:true}),[o.id],[.1,0])).toThrow(/锁定/);
});
test('reference and mirror axis move independently and clamp without no-op history',()=>{
 const d:Doc={...base(),reference:{name:'Grid',dataUrl:'data:image/png;base64,AA==',width:1,height:1,scale:1,rotation:0,opacity:1,offset:[10,0],visible:true,locked:false}};
 expect(nudgeSelection(d,{ids:[],reference:true},[.1,0])).toBe(d);const n=nudgeSelection(d,{ids:[],reference:true},[0,.1]);expect(n.reference!.offset).toEqual([10,.1]);expect(n.curves).toEqual(d.curves);
 expect(nudgeSelection(d,{ids:[],mirrorAxis:true},[0,.1])).toBe(d);expect(nudgeSelection(d,{ids:[],mirrorAxis:true},[.1,0]).mirrorAxisX).toBe(.1);
 expect(()=>nudgeSelection({...d,reference:{...d.reference!,locked:true}},{ids:[],reference:true},[0,.1])).toThrow(/锁定/);
});
test('interval grips slide along their path; ink endpoints change extension instead of moving a whole curve',()=>{
 const d=addDisplayInterval(base(),'a'),track=d.displayIntervals![0],r=track.ranges[0],n=nudgeSelection(d,{ids:['a'],displayInterval:{track:track.id,range:r.id,end:0}},[.01,0]);
 expect(n.displayIntervals![0].ranges[0].start).toBeCloseTo(r.start+.01);expect(n.curves).toEqual(d.curves);expect(n.nodes).toEqual(d.nodes);
 const k=nudgeSelection(d,{ids:['a'],inkEnd:{id:'a',end:0}},[-.01,0]);expect(k.curves[0].inkEnds![0].extension).toBeGreaterThan(0);expect(shapeOf(k,'a')).toEqual(shapeOf(d,'a'));valid(k);
});
