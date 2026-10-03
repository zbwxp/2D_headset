import {describe,expect,test} from 'vitest';
import * as cmd from '../domain/drawing/commands';
import {createGroup} from '../domain/drawing/groups';
import {curveById,emptyDrawing,nodeAt,shapeOf,type Point2} from '../domain/drawing/model';
import {controlDragTarget,drawingControlDragTarget,selectCurveAtPointer,selectCurvesInBox} from '../ui/drawing/editGestures';

function curves(){
 let document=cmd.addLayer(emptyDrawing(),'Drawing gestures');
 for(const [index,id] of ['a','b','c','d'].entries())document=cmd.createCurve(document,document.layers[0].id,[[index,0],[index+.25,.1],[index+.75,-.1],[index+1,0]],.01,id,id);
 return document;
}
const stroke=()=>cmd.connect(curves(),{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');
const near=(actual:Point2,expected:Point2)=>actual.forEach((value,index)=>expect(value).toBeCloseTo(expected[index],12));

describe('Drawing curve pointer selection',()=>{
 test('select mode expands a real continuous stroke and an organizational group; direct mode picks one segment',()=>{
  const joined=stroke(),grouped=createGroup(joined,['a','c']);
  expect(selectCurveAtPointer(joined,[],'b',{grouped:true}).sort()).toEqual(['a','b']);
  expect(selectCurveAtPointer(grouped,[],'b',{grouped:true}).sort()).toEqual(['a','b','c']);
  expect(selectCurveAtPointer(grouped,['a','b','c'],'b',{grouped:false})).toEqual(['b']);
 });

 test('a selected member retains the complete multi-selection for a move; a partially selected unit is expanded',()=>{
  const document=createGroup(stroke(),['a','c']),selected=['d','a','b','c'];
  expect(selectCurveAtPointer(document,selected,'b',{grouped:true})).toEqual(selected);
  expect(selectCurveAtPointer(document,['d','a'],'a',{grouped:true}).sort()).toEqual(['a','b','c']);
  expect(selectCurveAtPointer(document,['a','b','c'],'d',{grouped:true})).toEqual(['d']);
  expect(selected).toEqual(['d','a','b','c']);
 });

 test('Shift toggles the complete unit without removing unrelated selections or duplicating existing members',()=>{
  const document=createGroup(stroke(),['a','c']);
  expect(selectCurveAtPointer(document,['d','a','b','c'],'a',{grouped:true,shift:true})).toEqual(['d']);
  expect(selectCurveAtPointer(document,['a','d'],'a',{grouped:true,shift:true})).toEqual(['a','d','b','c']);
  expect(selectCurveAtPointer(document,['a','b'],'a',{grouped:false,shift:true})).toEqual(['b']);
  expect(selectCurveAtPointer(document,['a'],'b',{grouped:false,shift:true})).toEqual(['a','b']);
 });
});

describe('Drawing box selection',()=>{
 test('contains the drawn curve, rejecting an escaping lobe while accepting handles outside the box',()=>{
  let document=cmd.addLayer(emptyDrawing(),'Bounds');
  document=cmd.createCurve(document,document.layers[0].id,[[0,0],[.2,1],[.8,1],[1,0]],.01,'Inside','inside');
  document=cmd.createCurve(document,document.layers[0].id,[[0,0],[.2,2],[.8,2],[1,0]],.01,'Outside','outside');
  const candidates=['inside','outside'];
  expect(selectCurvesInBox(document,candidates,[-.1,-.1],[1.1,.8],{grouped:false})).toEqual(['inside']);
  expect(selectCurvesInBox(document,candidates,[1.1,.8],[-.1,-.1],{grouped:false})).toEqual(['inside']);
 });

 test('a contained segment expands its complete group/stroke only in select mode, preserving Shift additions',()=>{
  const joined=stroke(),document=createGroup(joined,['a','c']),start:Point2=[-.1,-.2],end:Point2=[1.1,.2];
  expect(selectCurvesInBox(joined,['a','b','c','d'],start,end,{grouped:true}).sort()).toEqual(['a','b']);
  expect(selectCurvesInBox(document,['a','b','c','d'],start,end,{grouped:true}).sort()).toEqual(['a','b','c']);
  expect(selectCurvesInBox(document,['a','b','c','d'],start,end,{grouped:false})).toEqual(['a']);
  expect(selectCurvesInBox(document,['a','b','c','d'],start,end,{grouped:true,previousIds:['d','a']})).toEqual(['d','a','b','c']);
 });

 test('uses the canvas candidate scope, skips hidden/locked hits, and retains the existing selection when adding no hits',()=>{
  let document=cmd.curveChange(curves(),'b',{locked:true});
  document=cmd.curveChange(document,'c',{visible:false});
  const start:Point2=[-1,-1],end:Point2=[5,1];
  expect(selectCurvesInBox(document,['a','b','c','d'],start,end,{grouped:false})).toEqual(['a','d']);
  expect(selectCurvesInBox(document,['a'],start,end,{grouped:false})).toEqual(['a']);
  expect(selectCurvesInBox(document,['b','c'],start,end,{grouped:false,previousIds:['d']})).toEqual(['d']);
  const layerLocked=cmd.layerChange(document,document.layers[0].id,{locked:true});
  expect(selectCurvesInBox(layerLocked,['a','d'],start,end,{grouped:false})).toEqual([]);
 });

 test('unit expansion retains hidden members of an otherwise editable group for the command lock policy',()=>{
  const grouped=createGroup(stroke(),['a','c']),document=cmd.curveChange(grouped,'c',{visible:false});
  expect(selectCurvesInBox(document,['a'],[-.1,-.2],[1.1,.2],{grouped:true}).sort()).toEqual(['a','b','c']);
 });
});

describe('Drawing anchored control drag',()=>{
 test('preserves pickup offset for a frozen world-space point and returns precisely to its starting position',()=>{
  const base:Point2=[3.25,-2.5],start:Point2=[3.3,-2.6];
  near(controlDragTarget(base,start,[4.3,-1.6]),[4.25,-1.5]);
  expect(controlDragTarget(base,start,start)).toEqual(base);
  expect(base).toEqual([3.25,-2.5]);expect(start).toEqual([3.3,-2.6]);
 });

 test('node and handle targets read the frozen Drawing document, so repeated previews do not accumulate',()=>{
  const base=stroke(),before=structuredClone(base),nodeId=nodeAt(base,{curveId:'a',end:1}).id,handle={curveId:'a',end:0 as const},start:Point2=[1.1,.2],pointer:Point2=[1.6,-.3];
  const nodeTarget=drawingControlDragTarget(base,{nodeId},start,pointer),handleTarget=drawingControlDragTarget(base,{handle},start,pointer);
  near(nodeTarget,[1.5,-.5]);near(handleTarget,[.75,-.4]);
  for(const intermediate of [[4,5],[-2,-3],[0,0]] as Point2[]){
   cmd.moveNode(base,nodeId,drawingControlDragTarget(base,{nodeId},start,intermediate));
   cmd.moveHandle(base,handle,drawingControlDragTarget(base,{handle},start,intermediate));
  }
  expect(drawingControlDragTarget(base,{nodeId},start,pointer)).toEqual(nodeTarget);
  expect(drawingControlDragTarget(base,{handle},start,pointer)).toEqual(handleTarget);
  expect(drawingControlDragTarget(base,{nodeId},start,start)).toEqual(nodeAt(base,{curveId:'b',end:0}).position);
  expect(drawingControlDragTarget(base,{handle},start,start)).toEqual(curveById(base,'a').handles[0]);
  expect(base).toEqual(before);
 });

 test('zero-length handles keep their pickup offset, while real shared endpoints still move through Drawing commands',()=>{
  let base=stroke();base=cmd.moveHandle(base,{curveId:'a',end:1},nodeAt(base,{curveId:'a',end:1}).position);
  const start:Point2=[1.02,.03],pointer:Point2=[1.12,.23],nodeId=nodeAt(base,{curveId:'a',end:1}).id;
  near(drawingControlDragTarget(base,{handle:{curveId:'a',end:1}},start,pointer),[1.1,.2]);
  const next=cmd.moveNode(base,nodeId,drawingControlDragTarget(base,{nodeId},start,pointer));
  near(shapeOf(next,'a')[3],[1.1,.2]);near(shapeOf(next,'b')[0],[1.1,.2]);
  expect(next.curves.map(curve=>curve.nodes)).toEqual(base.curves.map(curve=>curve.nodes));
 });
});
