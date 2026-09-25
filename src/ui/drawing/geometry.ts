import {flatten} from '../../domain/geometry/bezier';
import {shapeOf,type DrawingDocument,type DrawingNode,type Point2,type Cubic} from '../../domain/drawing/model';
export const curvePath=(shape:Cubic,screen:(p:Point2)=>Point2=p=>p)=>{const s=shape.map(screen);return `M ${s[0]} C ${s[1]} ${s[2]} ${s[3]}`;};
export function selectionBounds(d:DrawingDocument,ids:string[]){
 const points=ids.flatMap(id=>flatten(shapeOf(d,id).map(([x,y])=>[x,y,0]),.0005));if(!points.length)return null;
 const min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 return {min,max,center:[(min[0]+max[0])/2,(min[1]+max[1])/2] as Point2};
}
/** A vertical guide aligns by X; Y only resolves equal-distance candidates.
 * Tolerance is in CSS pixels, so zoom does not change the feel of snapping. */
export function snapMirrorAxis(nodes:DrawingNode[],x:number,y:number,unit:number):DrawingNode|null{
 return nodes.map(node=>({node,dx:Math.abs(node.position[0]-x)*unit,dy:Math.abs(node.position[1]-y)*unit}))
  .filter(n=>n.dx<=8).sort((a,b)=>a.dx-b.dx||a.dy-b.dy||a.node.id.localeCompare(b.node.id))[0]?.node??null;
}
