import {evaluate,derivative,split} from '../geometry/bezier';
import {add,sub,mul,length,type Point2,type Cubic} from './model';
const xyz=(s:Cubic)=>s.map(([x,y])=>[x,y,0] as [number,number,number]);
export const point=(s:Cubic,t:number):Point2=>evaluate(xyz(s),t).slice(0,2) as Point2;
export interface Sample {p:Point2;t:number}
/** Arc table bounds flattening error in logical units; independent of canvas zoom. */
export function samples(shape:Cubic,tolerance=.00004):Sample[]{
 const out:Sample[]=[{p:shape[0],t:0}];
 function visit(s:Cubic,a:number,b:number,depth:number){
  const v=sub(s[3],s[0]),den=length(v),error=Math.max(...s.slice(1,3).map(p=>{
   const w=sub(p,s[0]),q=den?Math.max(0,Math.min(1,(w[0]*v[0]+w[1]*v[1])/(den*den))):0;return length(sub(p,add(s[0],mul(v,q))));
  }));
  // Also subdivide straight curves so taper profiles have sufficient support.
  if(depth===0||error<=tolerance&&b-a<=1/32){out.push({p:s[3],t:b});return;}
  const [l,r]=split(xyz(s),.5).map(s=>s.map(([x,y])=>[x,y]) as Cubic),m=(a+b)/2;visit(l,a,m,depth-1);visit(r,m,b,depth-1);
 }
 visit(shape,0,1,14);return out;
}
export function arcField(shapes:Cubic[]){
 let total=0;const parts=shapes.map(shape=>{const pts=samples(shape),dist=[0];for(let i=1;i<pts.length;i++)dist.push(dist[i-1]+length(sub(pts[i].p,pts[i-1].p)));const start=total;total+=dist.at(-1)!;return {shape,pts,dist,start,length:dist.at(-1)!};});
 function at(s:number){
  const distance=Math.max(0,Math.min(1,s))*total,part=parts.find(p=>distance<=p.start+p.length)??parts.at(-1)!;
  const local=distance-part.start;let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
  const f=(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1),t=part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*f,p=point(part.shape,t);
  let v=derivative(xyz(part.shape),t).slice(0,2) as Point2;
  if(length(v)<1e-10)v=sub(point(part.shape,Math.min(1,t+1e-5)),point(part.shape,Math.max(0,t-1e-5)));
  return {p,t,tangent:mul(v,1/(length(v)||1))};
 }
 return {parts,total,at};
}
