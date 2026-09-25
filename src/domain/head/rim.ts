import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {LoomisScaffold} from './scaffold';
import {sideHorizontalIntersection,sideBasis,sideToHead,sideShellX} from './scaffold';
import {toHead,rotateFrame} from './frame';
import {InputCache} from '../geometry/cache';
import {provider,type CurveProvider} from '../geometry/curveProvider';
/** Front to back; endpoints are existing Side Ring / main-ring intersections. */
export function rimHeight(s:LoomisScaffold,z:number){
 // ensureScaffold removes sag from all current projects. Retain the legacy
 // evaluator while loading old sources so their dependent planes can transport.
 const sag=s.rimSag??0;if(!sag)return s.horizontalOffset??0;
 const extent=sideHorizontalIntersection(s).z;
 return (s.horizontalOffset??0)-sag*Math.sqrt(1-s.sidePosition*s.sidePosition)*Math.max(0,1-z*z/(extent*extent));
}
const cache=new InputCache<CurveProvider>(64);
export function rimProvider(p:LandmarkProject){const key=JSON.stringify(['rim',p.headFrame,p.loomisScaffold?.horizontalOffset,p.loomisScaffold?.sideTilt,p.loomisScaffold?.sidePosition,p.loomisScaffold?.roundness,p.loomisScaffold?.rimSag]),hit=cache.get(key);if(hit)return hit;const s=p.loomisScaffold!,r=Math.sqrt(1-s.sidePosition*s.sidePosition),r2=r*r;
 const extent=sideHorizontalIntersection(s).z;
 const evaluate=(t:number):Vec3=>{const z=extent*(1-2*t),target=rimHeight(s,z),{c,sn}=sideBasis(s);let lo=-Math.sqrt(Math.max(0,r2-z*z)),hi=-lo;
 for(let i=0;i<48;i++){const y=(lo+hi)/2;if(sn*sideShellX(s,y,z)+c*y<target)lo=y;else hi=y;}
 const y=(lo+hi)/2;return toHead(p,sideToHead(s,[sideShellX(s,y,z),y,z]));};
 const derivative=(t:number):Vec3=>{const lo=Math.max(0,t-1e-5),hi=Math.min(1,t+1e-5),a=evaluate(lo),b=evaluate(hi);return b.map((v,i)=>(v-a[i])/(hi-lo)) as Vec3;};
 const g=provider(key,false,evaluate,derivative);cache.set(key,g);return g;
}
