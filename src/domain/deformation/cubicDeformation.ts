import {add,sub,mul,length,type Point2,type Cubic} from '../drawing/model';
import type {DeformProjection} from './cageField';
// Hot fitting loop: evaluate the 2D cubic directly (no temporary 3D de Casteljau arrays).
const point=(s:Cubic,t:number):Point2=>{const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;return [a*s[0][0]+b*s[1][0]+c*s[2][0]+d*s[3][0],a*s[0][1]+b*s[1][1]+c*s[2][1]+d*s[3][1]];};
const dot=(a:Point2,b:Point2)=>a[0]*b[0]+a[1]*b[1];
const clamp=(x:number)=>Math.max(0,Math.min(1,x));

/** Projective reparameterization equalizes the rational cubic's endpoint weights.
 * This preserves source-point correspondence while avoiding tangential fit error on long curves. */
export const deformParameter=(t:number,scale:number)=>scale*t/(1+(scale-1)*t);
export interface CurveParameterMap {values:number[]}
export function mappedParameter(t:number,map?:CurveParameterMap){
 if(!map)return t;const x=clamp(t)*(map.values.length-1),i=Math.min(map.values.length-2,Math.floor(x));return map.values[i]+(map.values[i+1]-map.values[i])*(x-i);
}
/** Fit two positive handle lengths and monotonically refine point correspondence.
 * Endpoint positions and tangent rays remain exact throughout the geometric fit. */
function fit(shape:Cubic,f:DeformProjection){
 const count=128,scale=Math.cbrt(f.denominator(shape[3])/f.denominator(shape[0]));
 const values=Array.from({length:count+1},(_,i)=>f.affine?i/count:deformParameter(i/count,scale));
 if(f.affine)return {shape:shape.map(f.map) as Cubic,parameters:{values}};
 const targets=values.map((_,i)=>f.map(point(shape,i/count))),a=targets[0],b=targets[count],va=mul(f.vector(shape[0],sub(shape[1],shape[0])),1/scale),vb=mul(f.vector(shape[3],sub(shape[2],shape[3])),scale);
 const la=length(va),lb=length(vb),ta=mul(va,1/(la||1)),tb=mul(vb,1/(lb||1)),loA=la?la*.01:0,loB=lb?lb*.01:0,hiA=la*8,hiB=lb*8,bound=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
 let fitted:Cubic=[a,add(a,va),add(b,vb),b];
 for(let iteration=0;iteration<10;iteration++){
  let aa=0,ab=0,bb=0,ra=0,rb=0;
  for(let i=1;i<count;i++){
   const t=values[i],u=1-t,B1=3*u*u*t,B2=3*u*t*t,base=add(mul(a,u*u*u+B1),mul(b,B2+t*t*t)),r=sub(targets[i],base),x=mul(ta,B1),y=mul(tb,B2);
   aa+=dot(x,x);ab+=dot(x,y);bb+=dot(y,y);ra+=dot(x,r);rb+=dot(y,r);
  }
  const det=aa*bb-ab*ab,candidates:Point2[]=[];
  if(det>1e-15){const x=(ra*bb-rb*ab)/det,y=(rb*aa-ra*ab)/det;if(x>=loA&&x<=hiA&&y>=loB&&y<=hiB)candidates.push([x,y]);}
  for(const x of [loA,hiA])candidates.push([x,bound(bb?(rb-ab*x)/bb:0,loB,hiB)]);
  for(const y of [loB,hiB])candidates.push([bound(aa?(ra-ab*y)/aa:0,loA,hiA),y]);
  const score=([x,y]:Point2)=>aa*x*x+2*ab*x*y+bb*y*y-2*ra*x-2*rb*y;
  const [x,y]=candidates.sort((p,q)=>score(p)-score(q))[0];fitted=[a,add(a,mul(ta,x)),add(b,mul(tb,y)),b];
  // Closest-point Newton steps, constrained between neighbours to keep material order.
  for(let i=1;i<count;i++)for(let step=0;step<3;step++){
   const t=values[i],u=1-t,v=add(add(mul(sub(fitted[1],a),3*u*u),mul(sub(fitted[2],fitted[1]),6*u*t)),mul(sub(b,fitted[2]),3*t*t)),acc=add(mul(add(sub(fitted[2],mul(fitted[1],2)),a),6*u),mul(add(sub(b,mul(fitted[2],2)),fitted[1]),6*t)),r=sub(point(fitted,t),targets[i]),den=dot(v,v)+dot(r,acc);
   if(den<=1e-15)break;const next=bound(t-dot(r,v)/den,values[i-1]+1e-9,values[i+1]-1e-9);
   if(length(sub(point(fitted,next),targets[i]))>length(r))break;values[i]=next;
  }
  if(values.every((t,i)=>length(sub(point(fitted,t),targets[i]))<.00004))break;
 }
 return {shape:fitted,parameters:{values}};
}

/** The same fit is used for authored source cubics and may be used for derived
 * material cubics. The table maps source t to fitted t; fitted handles are not
 * field.map(source handles), so a point-field inverse cannot unfit them.
 * No document, membership, locks, mirrors or relation authoring enter this kernel.
 * maxError is the existing 257-sample diagnostic, not a certified global bound. */
export function fitDeformedCubic(shape:Cubic,field:DeformProjection){
 shape.forEach(field.map); // Also guard authored controls outside the fixed rest cage.
 const result=fit(shape,field);let maxError=0;
 for(let i=0;i<=256;i++)maxError=Math.max(maxError,length(sub(point(result.shape,mappedParameter(i/256,result.parameters)),field.map(point(shape,i/256)))));
 return {...result,maxError};
}

/** Inverse of the fitted cubic's strictly increasing source-t → fitted-t table.
 * This recovers a material parameter only; it never inverts fitted controls. */
export function sourceParameter(t:number,map?:CurveParameterMap):number {
 if(!map)return t;
 const value=clamp(t),values=map.values;let lo=0,hi=values.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(values[mid]<=value)lo=mid;else hi=mid;}
 return (lo+(value-values[lo])/(values[hi]-values[lo]))/(values.length-1);
}
