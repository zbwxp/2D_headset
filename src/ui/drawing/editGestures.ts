import {add,sub,curveById,editable,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {selectionUnit,selectedGroup} from '../../domain/drawing/groups';
import {selectionBounds} from './geometry';
import type {DrawingSelection} from './session';
import type {Affine2D} from '../../domain/geometry/affine2d';

export interface CurvePointerSelectionOptions {grouped:boolean;shift?:boolean}

/** Drawing's curve hit selection: V chooses a complete stroke/group; A chooses
 * one curve. Clicking a member of an already complete V selection keeps the
 * other selected units so the following drag moves the whole selection. */
export function selectCurveAtPointer(document:DrawingDocument,selectedIds:readonly string[],curveId:string,{grouped,shift=false}:CurvePointerSelectionOptions):string[]{
 const unit=grouped?selectionUnit(document,curveId):[curveId];
 const wholeUnitSelected=unit.every(id=>selectedIds.includes(id));
 if(shift)return wholeUnitSelected?selectedIds.filter(id=>!unit.includes(id)):[...new Set([...selectedIds,...unit])];
 if(grouped&&selectedIds.includes(curveId)&&wholeUnitSelected)return [...selectedIds];
 return [...unit];
}

/** Hit eligibility is separate from semantic membership. Hidden continuations
 * and locked group members remain selected; the operation validates the whole
 * unit instead of silently editing its unlocked subset. Both V and A body hits
 * start a move, while the deform tool only changes selection. */
export function drawingCurveBodySelection(document:DrawingDocument,selection:DrawingSelection,curveId:string,tool:'select'|'direct'|'deform',shift=false):{selection:DrawingSelection;move:boolean}|null {
 if(!editable(document,curveId))return null;
 const ids=selectCurveAtPointer(document,selection.ids,curveId,{grouped:tool!=='direct',shift});
 return {selection:{ids,group:tool==='select'?selectedGroup(document,ids)?.id:undefined},move:tool!=='deform'&&ids.length>0};
}

export interface DrawingMarqueeGesture {grouped:boolean;previousIds:readonly string[]}
/** Freeze additive selection at pointer-down, including all semantic members.
 * A curve transform box is still a normal canvas selection. Only explicitly
 * selected layer containers may opt out of curve marquee selection. */
export function beginDrawingMarquee(selection:DrawingSelection,tool:'select'|'direct',shift=false,layerContainer=false):DrawingMarqueeGesture|null {
 return layerContainer?null:{grouped:tool==='select',previousIds:shift?[...selection.ids]:[]};
}
export function finishDrawingMarquee(document:DrawingDocument,candidates:readonly string[],start:Point2,end:Point2,gesture:DrawingMarqueeGesture):DrawingSelection {
 const ids=selectCurvesInBox(document,candidates,start,end,gesture);
 return {ids,group:gesture.grouped?selectedGroup(document,ids)?.id:undefined};
}

/** Drawing's corner intent, expressed in the caller's established frame.
 * Normal dragging scales each axis independently; Shift uses the X ratio for
 * both. Source geometry may keep its existing authoring minimum, while retained
 * domains and native material frames can represent an exact collapsed axis. */
export function drawingCornerScale(start:Point2,point:Point2,origin:Point2,shift=false,minimum=0):{sx:number;sy:number;matrix:Affine2D} {
 const before=sub(start,origin),after=sub(point,origin),safe=(value:number)=>Math.abs(value)<minimum?(value<0?-minimum:minimum):value;
 const sx=safe(Math.abs(before[0])<1e-9?1:after[0]/before[0]),sy=shift?sx:safe(Math.abs(before[1])<1e-9?1:after[1]/before[1]);
 return {sx,sy,matrix:[sx,0,0,sy,origin[0]*(1-sx),origin[1]*(1-sy)]};
}

export interface BoxCurveSelectionOptions {grouped:boolean;previousIds?:readonly string[]}

/** A box contains the actual curve, not its endpoint chord or control polygon.
 * The canvas provides its visible candidate scope. Hit members must be editable;
 * grouped selection then expands them using the same units as a curve hit. */
export function selectCurvesInBox(document:DrawingDocument,candidateIds:readonly string[],start:Point2,end:Point2,{grouped,previousIds=[]}:BoxCurveSelectionOptions):string[]{
 const min:Point2=[Math.min(start[0],end[0]),Math.min(start[1],end[1])],max:Point2=[Math.max(start[0],end[0]),Math.max(start[1],end[1])];
 const hits=candidateIds.filter(id=>{
  if(!curveById(document,id)||!editable(document,id))return false;
  const bounds=selectionBounds(document,[id]);
  return !!bounds&&bounds.min[0]>=min[0]&&bounds.min[1]>=min[1]&&bounds.max[0]<=max[0]&&bounds.max[1]<=max[1];
 });
 const ids=grouped?hits.flatMap(id=>selectionUnit(document,id)):hits;
 return [...new Set([...previousIds,...ids])];
}

/** Preserve the pointer's pickup offset, and always evaluate against the frozen
 * control position. Intermediate previews never accumulate into the next move. */
export function controlDragTarget(basePosition:Point2,pointerStart:Point2,pointerNow:Point2):Point2{
 return add(basePosition,sub(pointerNow,pointerStart));
}

export type DrawingControlTarget={nodeId:string}|{handle:Endpoint};

/** Resolve a Drawing node or handle from the gesture's frozen document before
 * applying the shared pointer delta. Snapping and geometry commands run later. */
export function drawingControlDragTarget(base:DrawingDocument,target:DrawingControlTarget,pointerStart:Point2,pointerNow:Point2):Point2{
 const position='nodeId' in target?base.nodes.find(node=>node.id===target.nodeId)!.position:curveById(base,target.handle.curveId).handles[target.handle.end];
 return controlDragTarget(position,pointerStart,pointerNow);
}

// Both Drawing and Recording author geometry through this frozen operation plan.
export {prepareDrawingControlEditPlan,applyDrawingControlEditPlan,type DrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
