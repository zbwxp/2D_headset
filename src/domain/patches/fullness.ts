import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {controls} from '../curves/geometry';
import {arcLengthLUT} from '../geometry/bezier';
import {cross,dot,scale,add} from '../geometry/core';
import {loop,type SurfacePatch} from './model';
export const FULLNESS_SCALE = 0.15;
// First-order forward automatic differentiation: value, d/du, d/dv.
type J=[number,number,number];type V=[J,J,J];
const c=(x:number):J=>[x,0,0];
const plus=(a:J,b:J):J=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a:J,b:J):J=>[a[0]*b[0],a[1]*b[0]+a[0]*b[1],a[2]*b[0]+a[0]*b[2]];
const times=(a:J,k:number):J=>a.map(x=>x*k) as J;
const minus=(a:J,b:J)=>plus(a,times(b,-1));
const divide=(a:J,b:J):J=>[a[0]/b[0],(a[1]*b[0]-a[0]*b[1])/(b[0]*b[0]),(a[2]*b[0]-a[0]*b[2])/(b[0]*b[0])];
const vec=(p:Vec3):V=>p.map(c) as V;
const va=(a:V,b:V):V=>a.map((x,i)=>plus(x,b[i])) as V;
const vs=(a:V,k:J):V=>a.map(x=>mul(x,k)) as V;
const vm=(a:V,b:V)=>va(a,vs(b,c(-1)));
const reflected=(a:V):V=>[times(a[0],-1),a[1],a[2]];
const cubic=(cp:Vec3[],t:J):V=>{let q=cp.map(vec);for(let n=3;n>0;n--)q=q.slice(0,n).map((p,i)=>va(vs(p,minus(c(1),t)),vs(q[i+1],t)));return q[0];};
/** Analytic derivatives of the unchanged base formula, including self-symmetry. */
export function baseDifferential(p:LandmarkProject,patch:SurfacePatch){
 const ring=loop(p,patch.boundaryEdgeIds),cp=ring.map(r=>{const v=controls(p,p.curves.find(c=>c.id===r.id)!);return r.reverse?[...v].reverse():v;});const corners=cp.map(q=>vec(q[0]));
 const raw=(u:J,v:J):V=>{
 const U=minus(c(1),u),W=minus(c(1),v);
 if(patch.type==='quad'){
 const bilinear=va(va(vs(corners[0],mul(U,W)),vs(corners[1],mul(u,W))),va(vs(corners[2],mul(u,v)),vs(corners[3],mul(U,v))));
 return vm(va(va(vs(cubic(cp[0],u),W),vs(cubic(cp[2],U),v)),va(vs(cubic(cp[3],W),U),vs(cubic(cp[1],v),u))),bilinear);
 }
 const l=[minus(U,v),u,v];let q=vec([0,0,0]);for(let i=0;i<3;i++)q=va(q,vs(corners[i],l[i]));
 for(let i=0;i<3;i++){const j=(i+1)%3,s=plus(l[i],l[j]);if(s[0]<1e-14)continue;const t=divide(l[j],s),linear=va(vs(corners[i],minus(c(1),t)),vs(corners[j],t));q=va(q,vs(vm(cubic(cp[i],t),linear),mul(s,s)));}return q;
 };
 const permutation=ring.map(r=>{const l=p.landmarks.find(l=>l.id===r.vertex)!;return ring.findIndex(s=>s.vertex===(l.mirrorPartnerId??l.id));});
 const symmetric=permutation.every(i=>i>=0)&&permutation.some((i,j)=>i!==j);
 return(u:number,v:number)=>{
 const U:J=[u,1,0],W:J=[v,0,1];let q=raw(U,W);
 if(symmetric){const a=minus(c(1),U),b=minus(c(1),W);const weights=patch.type==='tri'?[minus(a,W),U,W]:[mul(a,b),mul(U,b),mul(U,W),mul(a,W)];const mapped=permutation.map(i=>weights[i]);const mu=patch.type==='tri'?mapped[1]:plus(mapped[1],mapped[2]),mv=patch.type==='tri'?mapped[2]:plus(mapped[2],mapped[3]);q=vs(va(q,reflected(raw(mu,mv))),c(.5));}
 return {position:q.map(x=>x[0]) as Vec3,du:q.map(x=>x[1]) as Vec3,dv:q.map(x=>x[2]) as Vec3};
 };
}
export function bubble(type:SurfacePatch['type'],u:number,v:number){
 const b=type==='quad'?16*u*(1-u)*v*(1-v):27*(1-u-v)*u*v;return b*b;
}
export function prepareFullness(p:LandmarkProject,patch:SurfacePatch,base:(u:number,v:number)=>Vec3){
 const lengths=patch.boundaryEdgeIds.map(id=>arcLengthLUT(controls(p,p.curves.find(c=>c.id===id)!)).at(-1)!).sort((a,b)=>a-b);
 const mid=Math.floor(lengths.length/2),L=lengths.length%2?lengths[mid]:(lengths[mid-1]+lengths[mid])/2;
 if(!Number.isFinite(L)||L<=1e-12)throw Error('Fullness：边界长度退化');
 const differential=baseDifferential(p,patch);
 const normal=(u:number,v:number)=>{const d=differential(u,v),n=cross(d.du,d.dv),length=Math.hypot(...n);if(!Number.isFinite(length)||length<=1e-12*L*L)throw Error('Fullness：BasePatch 法向退化');return scale(n,1/length);};
 const center=patch.type==='quad'?[.5,.5]:[1/3,1/3];let score=0;
 try{score=dot(normal(center[0],center[1]),base(center[0],center[1]));}catch{ /* Fixed interior fallback below. */ }
 if(Math.abs(score)<=1e-8*L){
 const samples=patch.type==='quad'?[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]:[[.2,.2],[.6,.2],[.2,.6]];let total=0,count=0;
 for(const [u,v] of samples)try{total+=dot(normal(u,v),base(u,v));count++;}catch{ /* Skip singular reference points. */ }
 score=count?total/count:0;
 }
 if(!Number.isFinite(score)||Math.abs(score)<=1e-8*L)throw Error('Fullness：无法根据 Head Origin 稳定确定外侧方向');
 const sign=score>0?1:-1,A=(patch.fullness??0)*FULLNESS_SCALE*L;
 // One patch-level sign, determined only from source geometry (not view/LOD).
 return (u:number,v:number):Vec3=>{
 const q=base(u,v);
 if(u<=0||v<=0||(patch.type==='quad'?(u>=1||v>=1):u+v>=1))return q;
 return add(q,scale(normal(u,v),sign*A*bubble(patch.type,u,v)));
 };
}
