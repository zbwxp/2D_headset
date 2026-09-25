import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {rotateFrame} from './frame';
import {add,sub,scale,dot,cross,normalize} from '../geometry/core';

export interface HeadPerspective {x:number;y:number}
export function parseHeadPerspective(value:unknown):HeadPerspective|undefined {
 if(value===undefined)return;
 const v=value as HeadPerspective;
 if(!v||![v.x,v.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid HeadSet perspective');
 return {x:v.x,y:v.y};
}
/** One continuous camera-local warp for the entire connected head. Never split
 * by object/side: shared boundary positions must remain identical. Source depth
 * is retained, so editing has an exact inverse on a fixed-depth plane. */
export function headPerspective(p:Pick<LandmarkProject,'headFrame'|'headPerspective'>,facing:Vec3){
 const f=p.headFrame,center=f?.center??[0,0,0] as Vec3,forward=normalize(facing);
 const vertical=f?rotateFrame([0,1,0],f):[0,1,0] as Vec3;
 let right=cross(vertical,forward);if(Math.hypot(...right)<1e-8)right=f?rotateFrame([1,0,0],f):[1,0,0];right=normalize(right);
 const up=normalize(cross(forward,right)),local=f?rotateFrame(forward,f,true):forward,yaw=Math.atan2(local[0],local[2]),gain=Math.sin(yaw)**2;
 const radius=f?Math.max(f.radiusX,f.radiusY,f.radiusZ):1;
 const kx=.55*(p.headPerspective?.x??0)*gain/radius,ky=.4*(p.headPerspective?.y??0)*gain/radius;
 const active=!!f&&(kx>1e-14||ky>1e-14);
 const denominator=(k:number,d:number)=>Math.max(.25,1-k*d);
 const map=(v:Vec3,inverse=false,unbounded=false):Vec3=>{
  if(!active)return v;
  const q=sub(v,center),d=dot(q,forward),x=dot(q,right),y=dot(q,up);
  const dx=unbounded?1-kx*d:denominator(kx,d),dy=unbounded?1-ky*d:denominator(ky,d);
  return add(center,add(scale(forward,d),add(scale(right,inverse?x*dx:x/dx),scale(up,inverse?y*dy:y/dy))));
 };
 return {active,key:JSON.stringify([center,forward,kx,ky]),center,forward,right,up,
  display:(v:Vec3)=>map(v),raw:(v:Vec3)=>map(v,true),
  // Analytic construction hosts lie within the frame radius, where denominators
  // stay positive. Their inverse screen ray is a straight line before clipping.
  rawRayPoint:(v:Vec3)=>map(v,true,true)};
}
