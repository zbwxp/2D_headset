import {ellipse} from '../../domain/drawing/commands';
import {add,sub,type DrawingDocument,type Point2} from '../../domain/drawing/model';

/** One Drawing gesture for both hosts; ownership and Undo remain with adapters. */
export interface DrawingEllipseGesture {base:DrawingDocument;layerId:string;start:Point2;width:number}
export function beginDrawingEllipseGesture(base:DrawingDocument,layerId:string|null,start:Point2,width:number):DrawingEllipseGesture {
 if(!layerId||!base.layers.some(layer=>layer.id===layerId))throw Error('Create a drawing layer first.');
 return {base,layerId,start:[...start],width};
}
export function updateDrawingEllipseGesture(gesture:DrawingEllipseGesture,point:Point2,circle=false):ReturnType<typeof ellipse> {
 const delta=sub(point,gesture.start),size=Math.max(Math.abs(delta[0]),Math.abs(delta[1]));
 const end=circle?add(gesture.start,[Math.sign(delta[0])*size,Math.sign(delta[1])*size]):point;
 return ellipse(gesture.base,gesture.layerId,gesture.start,end,gesture.width);
}
