import {applyDrawingControlEditPlan,drawingControlEditProof,prepareDrawingControlEditPlan,type DrawingControlEditPlan} from '../../src/domain/drawing/controlEditPlan';
import type {DrawingDocument,Point2} from '../../src/domain/drawing/model';

export const SINGLE_CURVE_NAME='鼻尖短线';
export const SINGLE_CURVE_ANGLE={x:37.137,y:14.713};
export interface SingleCurveGesture {source:DrawingDocument;plan:DrawingControlEditPlan;curveId:string;curveIndex:number;start:Point2}
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}
 return value;
}
/** One real authoring plan, compiled once from the complete gesture-start
 * drawing. No inverse solve, source snapshot edit, or copied geometry math. */
export function prepareSingleCurveGesture(drawing:DrawingDocument):SingleCurveGesture {
 const source=freeze(drawing),curveIndex=source.curves.findIndex(curve=>curve.name===SINGLE_CURVE_NAME),curve=source.curves[curveIndex];
 if(source.curves.length!==121||!curve)throw Error('Single-curve benchmark requires the complete public face and short nose curve');
 const plan=prepareDrawingControlEditPlan(source,{kind:'handle',endpoint:{curveId:curve.id,end:0}});
 if(plan.controls.length!==1||plan.curveIds.length!==1||plan.curveIds[0]!==curve.id||plan.nodeIds.length||plan.fallbackReason)throw Error('Single-curve benchmark no longer has exactly one writable handle');
 return {source,plan,curveId:curve.id,curveIndex,start:[...curve.handles[0]]};
}
export function singleCurvePosition(gesture:SingleCurveGesture,index:number):Point2 {
 return [gesture.start[0]+.001*(index+1),gesture.start[1]+.0007*(index+1)];
}
export function sampleSingleCurveGesture(gesture:SingleCurveGesture,index:number):DrawingDocument {
 return applyDrawingControlEditPlan(gesture.plan,{kind:'point',position:singleCurvePosition(gesture,index)});
}
/** Called outside measured work. Identity checks establish that all unrelated
 * source geometry and all relation/material containers remain untouched. */
export function assertSingleCurveTarget(gesture:SingleCurveGesture,target:DrawingDocument,index:number){
 const {source,curveIndex,plan}=gesture,position=singleCurvePosition(gesture,index);
 if(drawingControlEditProof(source,target,plan)!==plan||target.curves.length!==121||target.curves.filter((curve,i)=>curve!==source.curves[i]).length!==1||target.curves[curveIndex]===source.curves[curveIndex])throw Error('Single-curve target must replace exactly the chosen source curve');
 if(target.nodes.length!==source.nodes.length||target.nodes.some((node,i)=>node!==source.nodes[i]))throw Error('Single-curve target changed an unrelated node');
 const curve=target.curves[curveIndex];
 if(curve.handles[0][0]!==position[0]||curve.handles[0][1]!==position[1]||curve.handles[1]!==source.curves[curveIndex].handles[1])throw Error('Single-curve target drifted from its frozen gesture-start handle');
 for(const key of Object.keys(source) as (keyof DrawingDocument)[])if(key!=='curves'&&key!=='nodes'&&target[key]!==source[key])throw Error(`Single-curve target changed source metadata or relations: ${key}`);
 return {changedCurves:1,unrelatedCurvesChanged:0,nodesChanged:0,relationOrMetadataChanges:0,curveId:gesture.curveId,handleEnd:0,targetFromGestureStart:true};
}
