import type {Point2} from '../drawing/model';
import type {HairNet,Vec3} from './model';
import type {HairSurfaceCurve} from './strandTypes';
import {hairWorld,hairRadiusSquared,hairShellField} from './profile';
import {hairBasis,type HairView} from './projection';
import {fitHairCubic,type SectionArc} from './geometry';
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
const subtract=(a:Vec3,b:Vec3):Vec3=>a.map((v,i)=>v-b[i]) as Vec3;

function storedBasis(s:HairSurfaceCurve):ReturnType<typeof hairBasis>{
 if(s.version===2)return hairBasis(s.view);
 // Old saved handles/depths are coordinates in this frame, not in today's UI
 // camera frame. Reinterpreting them would deform existing authored strands.
 const y=s.view.yaw*Math.PI/180,p=s.view.pitch*Math.PI/180;
 return {right:[Math.cos(y),0,-Math.sin(y)],up:[-Math.sin(y)*Math.sin(p),Math.cos(p),-Math.cos(y)*Math.sin(p)],forward:[Math.sin(y)*Math.cos(p),Math.sin(p),Math.cos(y)*Math.cos(p)]};
}

/** Ray through a 2D sketch point. The shell can be non-convex: collect all
 * curved-wall crossings and retain the one closest to the previous depth. */
export function hairSketchProjector(net:HairNet,view:HairView){
 return sketchProjectorInBasis(net,hairBasis(view));
}
function sketchProjectorInBasis(net:HairNet,{right,up,forward}:ReturnType<typeof hairBasis>){
 const r=[net.radiusX,net.radiusY,net.radiusZ],w=net.profile?.width??1;
 const bounds=[[-w,w],[net.profile?.version===2?-1.2:-1,1],[-w,w]],b=forward.map((v,i)=>v/r[i]);
 return (target:Point2,depth:number):Vec3|null=>{
  const origin=right.map((v,i)=>v*target[0]+up[i]*target[1]) as Vec3,a=origin.map((v,i)=>(v-net.center[i])/r[i]);
  let low=-Infinity,high=Infinity;
  for(let i=0;i<3;i++){
   if(Math.abs(b[i])<1e-12){if(a[i]<bounds[i][0]||a[i]>bounds[i][1])return null;continue;}
   const ends=bounds[i].map(v=>(v-a[i])/b[i]).sort((a,b)=>a-b);low=Math.max(low,ends[0]);high=Math.min(high,ends[1]);
  }
  if(low>high)return null;
  const field=(t:number)=>{
   const x=a[0]+b[0]*t,y=a[1]+b[1]*t,z=a[2]+b[2]*t;
   return x*x+z*z-hairRadiusSquared(net,y);
  };
  let result:Vec3|null=null,best=Infinity,last=low,f=field(last);
  for(let i=1;i<=64;i++){
   const next=low+(high-low)*i/64,g=field(next);
   if(f*g<=0){
    let lo=last,hi=next,fl=f;
    for(let j=0;j<24;j++){const mid=(lo+hi)/2,fm=field(mid);if(fl*fm<=0)hi=mid;else{lo=mid;fl=fm;}}
    const t=(lo+hi)/2,p=origin.map((v,i)=>v+forward[i]*t) as Vec3,error=Math.abs(t-depth);
    if(Math.abs(hairShellField(net,p))<1e-6&&error<best){result=p;best=error;}
   }
   last=next;f=g;
  }
  return result;
 };
}

export function surfaceFromView(net:HairNet,arc:SectionArc,view:HairView):HairSurfaceCurve {
 const {right,up,forward}=hairBasis(view),c=arc.cubic,R=net.radiusX;
 return {version:2,view:{...view},handles:[1,2].map((j)=>{
  const p=subtract(c[j],c[j===1?0:3]);return [dot(p,right)/R,dot(p,up)/R];
 }) as [Point2,Point2],depths:c.map(p=>dot(subtract(p,net.center),forward)/R) as [number,number,number,number]};
}

export function surfaceHairArc(net:HairNet,root:Vec3,tip:Vec3,s:HairSurfaceCurve):SectionArc {
 const basis=storedBasis(s),{right,up,forward}=basis,R=net.radiusX,A=hairWorld(net,root),B=hairWorld(net,tip),depthCenter=dot(net.center,forward);
 const xy=(p:Vec3):Point2=>[dot(p,right),dot(p,up)],a=xy(A),b=xy(B);
 const controls=[a,s.handles[0].map((v,i)=>a[i]+v*R),s.handles[1].map((v,i)=>b[i]+v*R),b];
 const depths=s.depths.map(v=>depthCenter+v*R),deltaA=dot(A,forward)-depths[0],deltaB=dot(B,forward)-depths[3];
 const project=sketchProjectorInBasis(net,basis),points:Vec3[]=[],invalid:number[]=[];
 for(let i=0;i<=32;i++){
  const t=i/32,u=1-t,weights=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];
  const p=[0,1].map(k=>controls.reduce((sum,q,j)=>sum+weights[j]*q[k],0)) as Point2;
  const depth=dot(depths,weights)+u*deltaA+t*deltaB;
  const q=i===0?A:i===32?B:project(p,depth);
  if(!q)invalid.push(i);
  // An invalid preview remains finite and editable; callers must surface the
  // miss instead of claiming this fallback point lies on the shell.
  points.push(q??right.map((v,k)=>v*p[0]+up[k]*p[1]+forward[k]*depth) as Vec3);
 }
 const cubic=fitHairCubic(points);
 return {kind:'SURFACE',projectionMisses:invalid,angle:0,requestedAngle:0,normal:[0,0,0],planeOffset:0,points,cubic,cubics:[cubic],inkRange:[0,1]};
}
