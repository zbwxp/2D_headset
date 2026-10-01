import type {Cubic,Point2} from '../drawing/model';
import {point} from '../drawing/sampling';
import type {InkProjection} from '../drawing/appearance';
/** Adaptive runtime cubics. Source curves/IDs are never split or persisted. */
export function vectorProjection(map:(p:Point2,s?:Cubic,t?:number)=>Point2,tolerance=.0006):InkProjection {
 const cache=new WeakMap<Cubic,Cubic[]>();
 function shape(s:Cubic){const hit=cache.get(s);if(hit)return hit;const out:Cubic[]=[];
  const at=(t:number)=>map(point(s,t),s,t);
  const velocity=(t:number):Point2=>{const lo=Math.max(0,t-1e-5),hi=Math.min(1,t+1e-5),a=at(lo),b=at(hi);return [(b[0]-a[0])/(hi-lo),(b[1]-a[1])/(hi-lo)];};
  const fit=(a:number,b:number,depth:number)=>{const p=at(a),q=at(b),v=velocity(a),w=velocity(b),dt=(b-a)/3,c:Cubic=[p,[p[0]+v[0]*dt,p[1]+v[1]*dt],[q[0]-w[0]*dt,q[1]-w[1]*dt],q];
   const error=Math.max(...[.2,.4,.6,.8].map(t=>{const x=point(c,t),y=at(a+(b-a)*t);return Math.hypot(x[0]-y[0],x[1]-y[1]);}));
   if(error<=tolerance||depth===0){out.push(c);return;}const mid=(a+b)/2;fit(a,mid,depth-1);fit(mid,b,depth-1);
  };fit(0,1,7);cache.set(s,out);return out;
 }
 return {point:map,shapes:shapes=>shapes.flatMap(shape)};
}
