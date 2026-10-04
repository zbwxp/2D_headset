import type {Cubic} from './model';
import {retainCurveFitRange} from './curveFitRange';
/** Runtime-only provenance survives trims/reversal; never serialized in artwork. */
export interface CurveSample {id:string;t:number;weight:number}
/** Derivatives are with respect to this derived cubic's own parameter. */
export interface CurveSampleDerivative extends CurveSample {tDerivative:number;weightDerivative:number}
const sources=new WeakMap<Cubic,(t:number)=>CurveSample[]>(),derivatives=new WeakMap<Cubic,(t:number)=>CurveSampleDerivative[]>();
export function tagCurve(s:Cubic,id:string):Cubic {sources.set(s,t=>[{id,t,weight:1}]);derivatives.set(s,t=>[{id,t,weight:1,tDerivative:1,weightDerivative:0}]);return s;}
export function curveSamples(s:Cubic,t:number){return sources.get(s)?.(t)??[];}
export function curveSampleDerivatives(s:Cubic,t:number){return derivatives.get(s)?.(t)??[];}
/** Preserve source material identity through a monotone fitted parameter map. */
export function mapCurveSource(from:Cubic,to:Cubic,parameter:(t:number)=>number,slope:(t:number)=>number):Cubic {
 const f=sources.get(from),d=derivatives.get(from);if(f)sources.set(to,t=>f(parameter(t)));if(d)derivatives.set(to,t=>{const v=slope(t);return d(parameter(t)).map(sample=>({...sample,tDerivative:sample.tDerivative*v,weightDerivative:sample.weightDerivative*v}));});return retainCurveFitRange(from,to,parameter(0),parameter(1));
}
export function copyCurveSource(from:Cubic,to:Cubic,lo=0,hi=1):Cubic {return mapCurveSource(from,to,t=>lo+(hi-lo)*t,()=>hi-lo);}
export function tagBridge(s:Cubic,a:CurveSample[],b:CurveSample[],lo:number,hi:number):Cubic {
 sources.set(s,t=>{const x=lo+(hi-lo)*t,u=x*x*(3-2*x);return [...a.map(q=>({...q,weight:q.weight*(1-u)})),...b.map(q=>({...q,weight:q.weight*u}))];});
 derivatives.set(s,t=>{const x=lo+(hi-lo)*t,u=x*x*(3-2*x),v=6*x*(1-x)*(hi-lo);return [...a.map(q=>({...q,weight:q.weight*(1-u),tDerivative:0,weightDerivative:-q.weight*v})),...b.map(q=>({...q,weight:q.weight*u,tDerivative:0,weightDerivative:q.weight*v}))];});return s;
}
/** Endpoint extensions inherit both the displacement and its endpoint tangent. */
export function tagExtension(out:Cubic,base:Cubic,end:0|1):Cubic {
 const f=sources.get(base);if(!f)return out;const p=base[end?3:0],h=base[end?2:1],speed=3*Math.hypot(h[0]-p[0],h[1]-p[1]),length=Math.hypot(out[3][0]-out[0][0],out[3][1]-out[0][1]),eps=1e-5;
 const a=f(end),b=f(end?1-eps:eps),scale=length/Math.max(speed,1e-8)/eps;
 sources.set(out,t=>{const k=(end?t:1-t)*scale;return [...a.map(q=>({...q,weight:q.weight*(1+k)})),...b.map(q=>({...q,weight:-q.weight*k}))];});
 derivatives.set(out,t=>{const k=(end?t:1-t)*scale,v=(end?1:-1)*scale;return [...a.map(q=>({...q,weight:q.weight*(1+k),tDerivative:0,weightDerivative:q.weight*v})),...b.map(q=>({...q,weight:-q.weight*k,tDerivative:0,weightDerivative:-q.weight*v}))];});return out;
}

/** Rename stable identities while retaining the exact material parameter map. */
export function remapCurveSource(from:Cubic,to:Cubic,id:(id:string)=>string):Cubic {
 const f=sources.get(from),d=derivatives.get(from);if(f)sources.set(to,t=>f(t).map(sample=>({...sample,id:id(sample.id)})));if(d)derivatives.set(to,t=>d(t).map(sample=>({...sample,id:id(sample.id)})));return retainCurveFitRange(from,to,0,1,id);
}

/** Conjugate a material identity/parameter frame, without changing its weights. */
export function transformCurveSource(from:Cubic,to:Cubic,id:(id:string)=>string,reverse:(id:string)=>boolean):Cubic {
 const f=sources.get(from),d=derivatives.get(from);if(f)sources.set(to,t=>f(t).map(sample=>({...sample,id:id(sample.id),t:reverse(sample.id)?1-sample.t:sample.t})));if(d)derivatives.set(to,t=>d(t).map(sample=>({...sample,id:id(sample.id),t:reverse(sample.id)?1-sample.t:sample.t,tDerivative:(reverse(sample.id)?-1:1)*sample.tDerivative})));return retainCurveFitRange(from,to,0,1,id);
}
