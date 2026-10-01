import type {Cubic} from './model';
/** Runtime-only provenance survives trims/reversal; never serialized in artwork. */
export interface CurveSample {id:string;t:number;weight:number}
const sources=new WeakMap<Cubic,(t:number)=>CurveSample[]>();
export function tagCurve(s:Cubic,id:string):Cubic {sources.set(s,t=>[{id,t,weight:1}]);return s;}
export function curveSamples(s:Cubic,t:number){return sources.get(s)?.(t)??[];}
export function copyCurveSource(from:Cubic,to:Cubic,lo=0,hi=1):Cubic {const f=sources.get(from);if(f)sources.set(to,t=>f(lo+(hi-lo)*t));return to;}
export function tagBridge(s:Cubic,a:CurveSample[],b:CurveSample[],lo:number,hi:number):Cubic {
 sources.set(s,t=>{const x=lo+(hi-lo)*t,u=x*x*(3-2*x);return [...a.map(q=>({...q,weight:q.weight*(1-u)})),...b.map(q=>({...q,weight:q.weight*u}))];});return s;
}
/** Endpoint extensions inherit both the displacement and its endpoint tangent. */
export function tagExtension(out:Cubic,base:Cubic,end:0|1):Cubic {
 const f=sources.get(base);if(!f)return out;const p=base[end?3:0],h=base[end?2:1],speed=3*Math.hypot(h[0]-p[0],h[1]-p[1]),length=Math.hypot(out[3][0]-out[0][0],out[3][1]-out[0][1]),eps=1e-5;
 const a=f(end),b=f(end?1-eps:eps);sources.set(out,t=>{const k=(end?t:1-t)*length/Math.max(speed,1e-8)/eps;return [...a.map(q=>({...q,weight:q.weight*(1+k)})),...b.map(q=>({...q,weight:-q.weight*k}))];});return out;
}
