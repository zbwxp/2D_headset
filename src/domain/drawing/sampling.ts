import {copyCurveSource} from './curveProvenance';
import {sub,mul,length,type Point2,type Cubic} from './model';
import {InputCache} from '../geometry/cache';
// This is still de Casteljau, specialized to a 2D cubic to avoid allocating
// intermediate 3D vectors at every arc-length/taper sample.
export function point(s:Cubic,t:number):Point2{
 const u=1-t;
 const axis=(i:0|1)=>{const a=s[0][i]*u+s[1][i]*t,b=s[1][i]*u+s[2][i]*t,c=s[2][i]*u+s[3][i]*t;return (a*u+b*t)*u+(b*u+c*t)*t;};
 return [axis(0),axis(1)];
}
export interface Sample {p:Point2;t:number}
/** Arc table bounds flattening error in logical units; independent of canvas zoom. */
export function samples(shape:Cubic,tolerance=.00004,maxStep=1/32):Sample[]{
 const out:Sample[]=[{p:[...shape[0]],t:0}];
 function visit(x0:number,y0:number,x1:number,y1:number,x2:number,y2:number,x3:number,y3:number,a:number,b:number,depth:number){
  const vx=x3-x0,vy=y3-y0,den=vx*vx+vy*vy;
  const distance=(x:number,y:number)=>{const q=den?Math.max(0,Math.min(1,((x-x0)*vx+(y-y0)*vy)/den)):0;return (x-(x0+vx*q))**2+(y-(y0+vy*q))**2;};
  const error=Math.max(distance(x1,y1),distance(x2,y2));
  // Also subdivide straight curves so taper profiles have sufficient support.
  if(depth===0||error<=tolerance*tolerance&&b-a<=maxStep){out.push({p:[x3,y3],t:b});return;}
  const ax=(x0+x1)/2,ay=(y0+y1)/2,bx=(x1+x2)/2,by=(y1+y2)/2,cx=(x2+x3)/2,cy=(y2+y3)/2;
  const dx=(ax+bx)/2,dy=(ay+by)/2,ex=(bx+cx)/2,ey=(by+cy)/2,fx=(dx+ex)/2,fy=(dy+ey)/2,m=(a+b)/2;
  visit(x0,y0,ax,ay,dx,dy,fx,fy,a,m,depth-1);visit(fx,fy,ex,ey,cx,cy,x3,y3,m,b,depth-1);
 }
 visit(...shape[0],...shape[1],...shape[2],...shape[3],0,1,14);return out;
}
interface ArcTable {shape:Cubic;pts:Sample[];dist:number[];length:number;renderSamples:(sampling?:ArcSampling)=>Array<Sample & {distance:number}>}
const tables=new InputCache<ArcTable>(1024);
export interface ArcSampling {tolerance:number;maxStep:number}
function arcTable(input:Cubic){
 const key=JSON.stringify(input),hit=tables.get(key);if(hit)return hit;
 // Tables are keyed by values and detached from mutable command drafts.
 const shape=input.map(p=>[...p]) as Cubic,pts=samples(shape),dist=[0];
 for(let i=1;i<pts.length;i++)dist.push(dist[i-1]+Math.hypot(pts[i].p[0]-pts[i-1].p[0],pts[i].p[1]-pts[i-1].p[1]));
 const display=new Map<string,Array<Sample & {distance:number}>>();
 const renderSamples=(quality?:ArcSampling)=>{
  const k=quality?`${quality.tolerance}:${quality.maxStep}`:'precise',hit=display.get(k);if(hit)return hit;
  const coarse=quality?samples(shape,quality.tolerance,quality.maxStep):pts;
  // Retain the original one-sided normal support at source joins and end caps.
  const points=quality?[...new Map([...coarse,...pts.slice(0,2),...pts.slice(-2)].map(p=>[p.t,p])).values()].sort((a,b)=>a.t-b.t):pts;
  // Keep original arc-length positions/trim parameters. Only the polygon's
  // support density changes; interval boundaries must never gain tiny segments.
  let lo=0;const result=points.map(q=>{while(lo<pts.length-2&&pts[lo+1].t<q.t)lo++;const f=(q.t-pts[lo].t)/(pts[lo+1].t-pts[lo].t||1);return {...q,distance:dist[lo]+f*(dist[lo+1]-dist[lo])};});
  if(display.size>=8)display.delete(display.keys().next().value!);display.set(k,result);return result;
 };
 return tables.set(key,{shape,pts,dist,length:dist.at(-1)!,renderSamples});
}
export function arcField(shapes:Cubic[]){
 let total=0;const parts=shapes.map(shape=>{const table=arcTable(shape),start=total;total+=table.length;return {...table,shape:copyCurveSource(shape,table.shape.map(p=>[...p]) as Cubic),start};});
 function at(s:number){
  const distance=Math.max(0,Math.min(1,s))*total,part=parts.find(p=>distance<=p.start+p.length)??parts.at(-1)!;
  const local=distance-part.start;let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
  const f=(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1),t=part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*f,p=point(part.shape,t);
  const u=1-t,cp=part.shape;
  let v=([0,1] as const).map(i=>{const a=3*(cp[1][i]-cp[0][i]),b=3*(cp[2][i]-cp[1][i]),c=3*(cp[3][i]-cp[2][i]);return (a*u+b*t)*u+(b*u+c*t)*t;}) as Point2;
  if(length(v)<1e-10)v=sub(point(part.shape,Math.min(1,t+1e-5)),point(part.shape,Math.max(0,t-1e-5)));
  return {p,t,shape:part.shape,tangent:mul(v,1/(length(v)||1))};
 }
 return {parts,total,at};
}
