import {add,sub,curveById,editable,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {selectionUnit} from '../../domain/drawing/groups';
import {selectionBounds} from './geometry';

export interface CurvePointerSelectionOptions {grouped:boolean;shift?:boolean;memberFilter?:(id:string)=>boolean}

/** Drawing's curve hit selection: V chooses a complete stroke/group; A chooses
 * one curve. Clicking a member of an already complete V selection keeps the
 * other selected units so the following drag moves the whole selection. */
export function selectCurveAtPointer(document:DrawingDocument,selectedIds:readonly string[],curveId:string,{grouped,shift=false,memberFilter}:CurvePointerSelectionOptions):string[]{
 const unit=(grouped?selectionUnit(document,curveId):[curveId]).filter(id=>!memberFilter||memberFilter(id));
 const wholeUnitSelected=unit.every(id=>selectedIds.includes(id));
 if(shift)return wholeUnitSelected?selectedIds.filter(id=>!unit.includes(id)):[...new Set([...selectedIds,...unit])];
 if(grouped&&selectedIds.includes(curveId)&&wholeUnitSelected)return [...selectedIds];
 return [...unit];
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
