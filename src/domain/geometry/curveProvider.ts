import type {Vec3} from '../project/types';
import type {ControlPoints} from '../curves/geometry';
import {bezier} from '../curves/geometry';
import {arcLengthLUT,evaluate as evaluateBezier,derivative,flatten,normalizedArcLengthToT} from './bezier';
import {sub} from './core';
/** Pure derived geometry. No sampled representation is ever a source Curve. */
export interface CurveProvider {
 readonly key:string; readonly closed:boolean; readonly controls?:ControlPoints;
 evaluate(t:number):Vec3; derivative(t:number):Vec3;
 arcLengthLUT():number[]; atArcLength(s:number):Vec3; sample(segments?:number):Vec3[];
}
export function provider(key:string,closed:boolean,evaluate:(t:number)=>Vec3,d:(t:number)=>Vec3,controls?:ControlPoints):CurveProvider {
 let lut:number[]|undefined;
 const table=()=>{if(lut)return lut;if(controls)return lut=arcLengthLUT(controls);lut=[0];let prev=evaluate(0);for(let i=1;i<=512;i++){const q=evaluate(i/512);lut.push(lut[i-1]+Math.hypot(...sub(q,prev)));prev=q;}return lut;};
 return {key,closed,controls,evaluate,derivative:d,arcLengthLUT:table,atArcLength:s=>controls?evaluateBezier(controls,normalizedArcLengthToT(table(),s)):evaluate(normalizedArcLengthToT(table(),s)),sample:(n=96)=>Array.from({length:n+1},(_,i)=>evaluate(i/n))};
}
export const bezierProvider=(cp:ControlPoints)=>provider(JSON.stringify(cp),false,t=>bezier(cp,t),t=>derivative(cp,t),cp);
export function curvePolyline(g:CurveProvider):Vec3[]{if(g.controls){const cp=g.controls;return flatten(cp,Math.max(...cp.map(p=>Math.hypot(...sub(p,cp[0]))))*1e-4||1e-6);}return g.sample(256);}
