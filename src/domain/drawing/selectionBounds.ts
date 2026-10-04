import {flatten} from '../geometry/bezier';
import {shapeOf,type DrawingDocument,type Point2} from './model';
export function selectionBounds(d:DrawingDocument,ids:string[]){
 const points=ids.flatMap(id=>flatten(shapeOf(d,id).map(([x,y])=>[x,y,0]),.0005));if(!points.length)return null;
 const min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 return {min,max,center:[(min[0]+max[0])/2,(min[1]+max[1])/2] as Point2};
}
