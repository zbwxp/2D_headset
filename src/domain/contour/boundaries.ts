import type {LandmarkProject} from '../landmarks/model';
import {boundaryParameters,type PatchBoundaryUse} from '../patches/boundary';
import {evaluationContext} from '../geometry/evaluation';
import {HELMET,RING_Y,RIM_R,RIM_L} from '../head/scaffold';
export interface BoundaryInterval {owner:string;curveId:string;lo:number;hi:number}
/** Native host parameters, not endpoint UUIDs: whole edges and subspans share one domain. */
export function boundaryIntervals(p:LandmarkProject,owner:string,b:PatchBoundaryUse):BoundaryInterval[]{
 const g=evaluationContext(p).curve(b.curveId),out=(lo:number,hi:number)=>({owner,curveId:b.curveId,lo,hi});
 if(b.kind==='closed')return [out(0,1)];
 let {t0,t1}=boundaryParameters(p,b);
 if(!g.closed)return [out(Math.min(t0,t1),Math.max(t0,t1))];
 if(b.reversed){if(t1>=t0)t1-=1;}else if(t1<=t0)t1+=1;
 let lo=Math.min(t0,t1),hi=Math.max(t0,t1);const shift=Math.floor(lo);lo-=shift;hi-=shift;
 return hi<=1?[out(lo,hi)]:[out(lo,1),out(0,hi-1)];
}
/** Helmet's exact open rim: front/back equatorial arcs plus the two side rims.
 * These reference the same system hosts as Patch BoundaryUses, never mesh proximity.
 */
export function helmetBoundaryIntervals(p:LandmarkProject):BoundaryInterval[]{
 if(!p.loomisScaffold?.visible)return [];
 const result:BoundaryInterval[]=[],has=(id:string)=>p.curves.some(c=>c.id===id);
 if(has(RING_Y)){
  // MAIN_Y reference is +Z, normal +Y. Side intersections are |sin(2πt)|=c.
  const a=Math.asin(p.loomisScaffold.sidePosition)/(2*Math.PI);
  for(const [lo,hi] of [[0,a],[.5-a,.5+a],[1-a,1]])result.push({owner:HELMET,curveId:RING_Y,lo,hi});
 }
 for(const curveId of [RIM_R,RIM_L])if(has(curveId))result.push({owner:HELMET,curveId,lo:0,hi:1});
 return result;
}
/** Split at every use endpoint; retain only intervals incident to one surface.
 * Different uses on the same surface do not count as separate incident surfaces.
 */
export function exposedIntervals(intervals:BoundaryInterval[]):BoundaryInterval[]{
 const groups=new Map<string,BoundaryInterval[]>(),out:BoundaryInterval[]=[];
 for(const b of intervals){const a=groups.get(b.curveId)??[];a.push(b);groups.set(b.curveId,a);}
 for(const [curveId,uses] of groups){
  const cuts=[...new Set(uses.flatMap(b=>[b.lo,b.hi]))].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){const lo=cuts[i-1],hi=cuts[i];if(hi-lo<1e-10)continue;
   const t=(lo+hi)/2,owners=new Set(uses.filter(b=>t>b.lo-1e-12&&t<b.hi+1e-12).map(b=>b.owner));
   if(owners.size!==1)continue;const owner=[...owners][0],last=out.at(-1);
   if(last&&last.curveId===curveId&&last.owner===owner&&Math.abs(last.hi-lo)<1e-10)last.hi=hi;
   else out.push({owner,curveId,lo,hi});
  }
 }
 return out;
}
