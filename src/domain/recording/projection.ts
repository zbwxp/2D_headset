import type {HeadFrame} from '../head/frame';
import {rotateFrame} from '../head/frame';
import type {Vec3} from '../project/types';
import type {View,Point2} from './model';
/** Head-local yaw convention matches the modeling views. Orthographic support radii, not a mesh bounding box. */
export function recordingBasis(f:HeadFrame,view:View){
 const y=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180;
 const right:Vec3=[Math.cos(y),0,-Math.sin(y)],up:Vec3=[-Math.sin(y)*Math.sin(p),Math.cos(p),-Math.cos(y)*Math.sin(p)],forward:Vec3=[Math.sin(y)*Math.cos(p),Math.sin(p),Math.cos(y)*Math.cos(p)];
 const radius=(v:Vec3)=>Math.hypot(v[0]*f.radiusX,v[1]*f.radiusY,v[2]*f.radiusZ);
 return {right:rotateFrame(right,f),up:rotateFrame(up,f),forward:rotateFrame(forward,f),halfWidth:radius(right),halfHeight:radius(up)};
}
export function projectReference(point:Vec3,f:HeadFrame,v:View):Point2 {const b=recordingBasis(f,v),q=point.map((x,i)=>x-f.center[i]);return [q.reduce((s,x,i)=>s+x*b.right[i],0)/b.halfWidth,q.reduce((s,x,i)=>s+x*b.up[i],0)/b.halfHeight];}
