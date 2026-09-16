import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {LoomisScaffold} from './scaffold';
import {sideShellX} from './scaffold';
import {toHead,rotateFrame} from './frame';
import {InputCache} from '../geometry/cache';
import {provider,type CurveProvider} from '../geometry/curveProvider';
/** Front to back; endpoints are existing Side Ring / main-ring intersections. */
export function rimHeight(s:LoomisScaffold,z:number){const r=Math.sqrt(1-s.sidePosition*s.sidePosition);return -s.rimSag*r*Math.max(0,1-z*z/(r*r));}
const cache=new InputCache<CurveProvider>(64);
export function rimProvider(p:LandmarkProject){const key=JSON.stringify(['rim',p.headFrame,p.loomisScaffold?.sidePosition,p.loomisScaffold?.roundness,p.loomisScaffold?.rimSag]),hit=cache.get(key);if(hit)return hit;const s=p.loomisScaffold!,r=Math.sqrt(1-s.sidePosition*s.sidePosition),r2=r*r;
 const evaluate=(t:number):Vec3=>{const z=r*(1-2*t),y=rimHeight(s,z);return toHead(p,[sideShellX(s,y,z),y,z]);};
 const derivative=(t:number):Vec3=>{const z=r*(1-2*t),y=rimHeight(s,z),dz=-2*r,dy=2*s.rimSag*z/r*dz,rho=Math.hypot(y,z)/r,c=s.sidePosition,exponent=Math.max(6,1/(c*c));
 const radial=rho===0?0:-(1-s.roundness)*(r2/c)*rho**exponent-s.roundness*r2*rho/Math.sqrt(1-r2*rho*rho);
 const dx=rho===0?0:radial*(y*dy+z*dz)/(r2*rho),f=p.headFrame!;
 return rotateFrame([dx*f.radiusX,dy*f.radiusY,dz*f.radiusZ],f);};
 const g=provider(key,false,evaluate,derivative);cache.set(key,g);return g;
}
