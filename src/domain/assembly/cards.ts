import {resolvePlacement} from './placement';
import {locatorProjection,rotateLocal,type AssemblyDocument} from './model';
import type {DrawingDocument,Point2} from '../drawing/model';

/** Project a front-facing vector card about its bound locator. Input coordinates
 * are the existing billboard's screen pixels, so binding calibration, offsets,
 * pan and depth scale remain identical in both preview modes.
 *
 * The absolute rig orientation is relative to the FRONT view, never the pose
 * where the user happened to enable the switch. This is a full homography,
 * including perspective within the card, not just cos(yaw) width compression.
 */
export function layerCardProjection(a:AssemblyDocument,layerId:string,screen:(p:Point2)=>Point2,unit:number):number[]|undefined {
 const frame=resolvePlacement(a),b=frame.bindings.find(b=>b.layerId===layerId);if(!b||!a.followAxisRotation||unit<=0)return;
 const p=locatorProjection(frame,b.locatorId),[cx,cy]=screen([b.anchor[0]+p.point[0]-b.reference[0]+b.offset[0],b.anchor[1]+p.point[1]-b.reference[1]+b.offset[1]]);
 const base=a.timeline?.base;
 const basis=(v:[number,number,number])=>{
  if(!base)return rotateLocal(v,a.pose);
  const p={...a.pose,...base,roll:0},axes=([0,1,2] as const).map(i=>rotateLocal([i===0?1:0,i===1?1:0,i===2?1:0],p));
  const local=axes.map(axis=>axis.reduce((sum,x,i)=>sum+x*v[i],0)) as [number,number,number];return rotateLocal(local,a.pose);
 };
 const x=basis([1,0,0]),y=basis([0,1,0]);
 const depth=Math.max(.5,a.pose.distance-p.world[2]),rx=p.world[0]/depth,ry=p.world[1]/depth;
 const wx=-x[2]/(unit*a.pose.distance),wy=y[2]/(unit*a.pose.distance);
 const a00=x[0]+rx*x[2],a01=-y[0]-rx*y[2],a10=-x[1]-ry*x[2],a11=y[1]+ry*y[2];
 const h00=a00+cx*wx,h01=a01+cx*wy,h10=a10+cy*wx,h11=a11+cy*wy;
 // Column-major CSS matrix3d. z is flattened deliberately: compositing order
 // stays with Drawing's paint batches, including cross-layer depth offsets.
 return [h00,h10,0,wx,h01,h11,0,wy,0,0,1,0,cx-h00*cx-h01*cy,cy-h10*cx-h11*cy,0,1-wx*cx-wy*cy];
}

/** Appearance/list operations can be inspected live. Coordinate edits return
 * to the existing editor instead of attempting to invert an edge-on card. */
export function cardGeometryChanged(before:DrawingDocument,after:DrawingDocument):boolean {
 if(before.nodes.length!==after.nodes.length||before.curves.length!==after.curves.length)return true;
 const nodes=new Map(before.nodes.map(n=>[n.id,n.position]));
 if(after.nodes.some(n=>{const p=nodes.get(n.id);return !p||n.position.some((v,i)=>v!==p[i]);}))return true;
 const curves=new Map(before.curves.map(c=>[c.id,c]));
 return after.curves.some(c=>{const old=curves.get(c.id);return !old||c.nodes.some((id,i)=>id!==old.nodes[i])||c.handles.some((p,i)=>p.some((v,j)=>v!==old.handles[i][j]));});
}
