import {changeDisplayInterval,displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {beginIntervalDrag,updateIntervalDrag,type IntervalDragState} from '../../domain/drawing/intervalDrag';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import type {DrawingSelection} from './session';

/** Both canvases use Drawing's authored material walk. The host owns preview
 * acceptance, cancellation and history; the document stays fixed for the drag. */
export interface DrawingIntervalGesture {
 readonly base:DrawingDocument;
 readonly selection:DrawingSelection&{displayInterval:NonNullable<DrawingSelection['displayInterval']>};
 readonly walk:IntervalDragState;
}

export function beginDrawingIntervalGesture(base:DrawingDocument,trackId:string,rangeId:string,end:0|1,pointer:Point2,unitsPerPixel:number):DrawingIntervalGesture {
 const track=base.displayIntervals?.find(value=>value.id===trackId),range=track?.ranges.find(value=>value.id===rangeId);
 if(!track||!range)throw Error('The selected display interval is no longer available.');
 return {base,selection:{ids:[track.anchor.id],displayInterval:{track:trackId,range:rangeId,end}},walk:beginIntervalDrag(displayField(base,displayPath(base,track.anchor.id)),track,range,end,pointer,unitsPerPixel)};
}

export function updateDrawingIntervalGesture(gesture:DrawingIntervalGesture,pointer:Point2):{gesture:DrawingIntervalGesture;drawing:DrawingDocument} {
 const result=updateIntervalDrag(gesture.walk,pointer),grip=gesture.selection.displayInterval;
 return {gesture:{...gesture,walk:result.state},drawing:changeDisplayInterval(gesture.base,grip.track,grip.range,result.change)};
}
