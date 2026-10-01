import type {HairNet,Vec3} from './model';
import {hairShellField,hairNormalizedField} from './profile';
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(p:Vec3)=>mul(p,1/(Math.hypot(...p)||1));
/** The tucked flank is not convex. Find an interior section center when the
 * chord midpoint is outside, and bracket the first exit along each radial ray.
 * Samples lie on the side OR the real sloping base, always in the same plane. */
export function pumpkinSectionPoints(n:HairNet,A:Vec3,B:Vec3,normal:Vec3):Vec3[] {
 const bound=4*Math.max(n.radiusX,n.radiusY,n.radiusZ)*Math.max(1,n.profile!.width),mid=mul(add(A,B),.5),axis=norm(sub(B,A)),perp=norm(cross(normal,axis));
 let center=mid;
 if(hairShellField(n,center)>-1e-9){
  let best=0,score=hairShellField(n,mid);
  const value=(s:number)=>hairShellField(n,add(mid,mul(perp,s))),step=bound/40;
  for(let i=-40;i<=40;i++){const s=i*step,v=value(s);if(v<score){score=v;best=s;}}
  let lo=best-step,hi=best+step;
  for(let i=0;i<18;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(value(a)<value(b))hi=b;else lo=a;}
  center=add(mid,mul(perp,(lo+hi)/2));
  // Near-degenerate tangent section: retain a finite fixed-end curve.
  if(hairShellField(n,center)>1e-6)return Array.from({length:33},(_,i)=>add(mul(A,1-i/32),mul(B,i/32)));
 }
 const u=norm(sub(A,center)),v=cross(normal,u),end=norm(sub(B,center)),raw=Math.atan2(dot(end,v),dot(end,u)),theta=raw<0?raw+2*Math.PI:raw;
 const cx=(center[0]-n.center[0])/n.radiusX,cy=(center[1]-n.center[1])/n.radiusY,cz=(center[2]-n.center[2])/n.radiusZ;
 return Array.from({length:33},(_,i)=>{
  if(i===0)return A;if(i===32)return B;
  const t=theta*i/32,d=add(mul(u,Math.cos(t)),mul(v,Math.sin(t))),dx=d[0]/n.radiusX,dy=d[1]/n.radiusY,dz=d[2]/n.radiusZ;
  const field=(s:number)=>hairNormalizedField(n,cx+dx*s,cy+dy*s,cz+dz*s);
  let lo=0,hi=bound/32;
  while(hi<bound&&field(hi)<=0){lo=hi;hi+=bound/32;}
  for(let j=0;j<25;j++){const m=(lo+hi)/2;if(field(m)<=0)lo=m;else hi=m;}
  return add(center,mul(d,(lo+hi)/2));
 });
}
