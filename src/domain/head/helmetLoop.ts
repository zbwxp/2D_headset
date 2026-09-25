import type {LandmarkProject} from '../landmarks/model';
import type {HelmetLoopCurve} from '../curves/model';
import {provider,type CurveProvider} from '../geometry/curveProvider';
import {scale} from '../geometry/core';
import {InputCache} from '../geometry/cache';
import {sideHorizontalIntersection} from './scaffold';

/** Each part maps a range of the logical ring to the original host parameter.
 * Retain this identity for boundary/occlusion bookkeeping as well as evaluation. */
export function helmetLoopParts(p:LandmarkProject,c:HelmetLoopCurve){
 const s=p.loomisScaffold!,h=s.horizontalOffset??0;
 const a=Math.asin(Math.max(-1,Math.min(1,sideHorizontalIntersection(s).x/Math.sqrt(1-h*h))))/(2*Math.PI);
 const [ring,right,left]=c.sourceCurveIds;
 return [
  {curveId:ring,lo:0,hi:a,t0:0,t1:a},
  {curveId:right,lo:a,hi:.5-a,t0:0,t1:1},
  {curveId:ring,lo:.5-a,hi:.5+a,t0:.5-a,t1:.5+a},
  {curveId:left,lo:.5+a,hi:1-a,t0:1,t1:0},
  {curveId:ring,lo:1-a,hi:1,t0:1-a,t1:1},
 ];
}
const cache=new InputCache<CurveProvider>(64);
export function helmetLoopProvider(p:LandmarkProject,c:HelmetLoopCurve,resolve:(id:string)=>CurveProvider){
 const parts=helmetLoopParts(p,c).map(part=>({...part,g:resolve(part.curveId)}));
 const key=JSON.stringify(['helmetLoop',parts.map(({g,...part})=>[part,g.key])]),hit=cache.get(key);if(hit)return hit;
 const at=(t:number)=>{t=(t%1+1)%1;const part=parts.find(part=>t<part.hi)??parts[0];return {part,t:part.t0+(t-part.lo)/(part.hi-part.lo)*(part.t1-part.t0)};};
 return cache.set(key,provider(key,true,t=>{const q=at(t);return q.part.g.evaluate(q.t);},t=>{const q=at(t);return scale(q.part.g.derivative(q.t),(q.part.t1-q.part.t0)/(q.part.hi-q.part.lo));}));
}
