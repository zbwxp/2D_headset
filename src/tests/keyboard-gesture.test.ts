import {expect,it,vi} from 'vitest';
import {addLayer,connect,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {drawingControlEditProof} from '../domain/drawing/controlEditPlan';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {beginKeyboardGesture,previewKeyboardGesture,releaseKeyboardGesture,cancelKeyboardGesture} from '../ui/drawing/keyboardGesture';
import {takeGestureTarget} from '../ui/drawing/gestureTransaction';
import {applyDrawingNudgePlan,nudgeSelection,prepareDrawingNudgePlan} from '../ui/drawing/nudge';

function fixture(){
 let d=addLayer(emptyDrawing(),'Layer');d=createCurve(d,d.layers[0].id,[[-1,0],[-.7,0],[-.3,0],[0,0]],.01,'A','a');d=createCurve(d,d.layers[0].id,[[0,0],[.3,0],[.7,0],[1,0]],.01,'B','b');
 return connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');
}

it('last owned arrow release finishes once; an unrelated release cannot finish a held gesture',()=>{
 const gesture=beginKeyboardGesture<Point2>(),publish=vi.fn();
 previewKeyboardGesture(gesture,'ArrowRight',[.1,0],offset=>offset,publish);
 previewKeyboardGesture(gesture,'ArrowUp',[0,.2],offset=>offset,publish);
 expect(releaseKeyboardGesture(gesture,'ArrowLeft')).toBe(false);expect(releaseKeyboardGesture(gesture,'ArrowRight')).toBe(false);
 expect(gesture.previewTarget.target).toEqual([.1,.2]);expect(releaseKeyboardGesture(gesture,'ArrowUp')).toBe(true);
 expect(takeGestureTarget(gesture.previewTarget)).toEqual([.1,.2]);expect(releaseKeyboardGesture(gesture,'ArrowUp')).toBe(false);expect(takeGestureTarget(gesture.previewTarget)).toBeUndefined();
});

it('a rejected SMOOTH handle sample retires its target but preserves the first document and total requested offset',()=>{
 const before=fixture(),saved=JSON.stringify(before),plan=prepareDrawingNudgePlan(before,{ids:['a'],handle:{curveId:'a',end:1}}),gesture=beginKeyboardGesture<DrawingDocument>();let visible:DrawingDocument|null=null;
 const publish=(next:DrawingDocument|null)=>{visible=next;},produce=(offset:Point2)=>applyDrawingNudgePlan(plan,offset);
 previewKeyboardGesture(gesture,'ArrowRight',[.1,0],produce,publish);
 // The second request reaches the endpoint exactly and must reject collapse.
 expect(()=>previewKeyboardGesture(gesture,'ArrowRight',[.2,0],produce,publish)).toThrow(/连接柄不能缩为零/);
 expect(visible).toBeNull();expect(takeGestureTarget(gesture.previewTarget)).toBeUndefined();
 previewKeyboardGesture(gesture,'ArrowUp',[0,.1],produce,publish);
 expect(visible).toEqual(applyDrawingNudgePlan(plan,gesture.offset));expect(visible!.curves[0].handles[1][0]).toBeCloseTo(0,12);expect(visible!.curves[0].handles[1][1]).toBeCloseTo(.1,12);
 expect(JSON.stringify(before)).toBe(saved);expect(plan.kind).toBe('geometry');if(plan.kind==='geometry')expect(drawingControlEditProof(before,visible!,plan.controlPlan)).toBe(plan.controlPlan);
});

it.each(['node','handle','curves'] as const)('%s repeated nudges use one immutable plan and match a single canonical total displacement',kind=>{
 const before=fixture(),selection=kind==='node'?{ids:['a'],node:before.curves[0].nodes[1]}:kind==='handle'?{ids:['a'],handle:{curveId:'a',end:1 as const}}:{ids:['a']},plan=prepareDrawingNudgePlan(before,selection),gesture=beginKeyboardGesture<DrawingDocument>();
 selection.ids.push('b');
 for(const [key,delta] of [['ArrowRight',[.004,0]],['ArrowUp',[0,.004]],['ArrowRight',[.02,0]],['ArrowDown',[0,-.0008]]] as [string,Point2][])previewKeyboardGesture(gesture,key,delta,offset=>applyDrawingNudgePlan(plan,offset),()=>{});
 const next=takeGestureTarget(gesture.previewTarget)!,expected=finalizeGeometryEdit(before,nudgeSelection(before,plan.selection,[.024,.0032]));
 expect(plan.selection.ids).toEqual(['a']);for(const curve of before.curves)for(const [i,point] of shapeOf(next,curve.id).entries())point.forEach((value,axis)=>expect(value).toBeCloseTo(shapeOf(expected,curve.id)[i][axis],12));
});

it.each(['Escape','history','blur','context change'])('%s cancellation prevents any late release or preview from reviving the target',()=>{
 const gesture=beginKeyboardGesture<Point2>(),publish=vi.fn();previewKeyboardGesture(gesture,'ArrowRight',[.1,0],offset=>offset,publish);cancelKeyboardGesture(gesture);
 expect(releaseKeyboardGesture(gesture,'ArrowRight')).toBe(false);expect(takeGestureTarget(gesture.previewTarget)).toBeUndefined();
 expect(previewKeyboardGesture(gesture,'ArrowRight',[.1,0],offset=>offset,publish)).toBe(false);expect(publish).toHaveBeenCalledTimes(1);
});

it('nongeometry reference nudges retain incremental clamp behavior',()=>{
 const before={...fixture(),reference:{name:'Image',dataUrl:'data:image/png;base64,AA==',width:1,height:1,offset:[10,0] as Point2,scale:1,rotation:0,opacity:1,visible:true,locked:false}},plan=prepareDrawingNudgePlan(before,{ids:[],reference:true});
 const clamped=applyDrawingNudgePlan(plan,[.1,0]);expect(clamped).toBe(before);
 expect(applyDrawingNudgePlan(plan,[0,0],clamped,[-.1,0]).reference!.offset).toEqual([9.9,0]);
});
