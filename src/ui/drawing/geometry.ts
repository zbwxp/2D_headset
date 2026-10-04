import {type DrawingNode,type Point2,type Cubic} from '../../domain/drawing/model';
export const curvePath=(shape:Cubic,screen:(p:Point2)=>Point2=p=>p)=>{const s=shape.map(screen);return `M ${s[0]} C ${s[1]} ${s[2]} ${s[3]}`;};
export {selectionBounds} from '../../domain/drawing/selectionBounds';
/** A vertical guide aligns by X; Y only resolves equal-distance candidates.
 * Tolerance is in CSS pixels, so zoom does not change the feel of snapping. */
export function snapMirrorAxis(nodes:DrawingNode[],x:number,y:number,unit:number):DrawingNode|null{
 return nodes.map(node=>({node,dx:Math.abs(node.position[0]-x)*unit,dy:Math.abs(node.position[1]-y)*unit}))
  .filter(n=>n.dx<=8).sort((a,b)=>a.dx-b.dx||a.dy-b.dy||a.node.id.localeCompare(b.node.id))[0]?.node??null;
}
