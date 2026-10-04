import type {Cubic} from './model';

/** Runtime-only interval in a common fitted-parent control frame. Unlike
 * material provenance, this describes the current cubic's control parameter. */
export interface CurveFitRange {id:string;parameterRange:readonly [number,number]}
const ranges=new WeakMap<Cubic,CurveFitRange>();
export const curveFitRange=(shape:Cubic):CurveFitRange|undefined=>ranges.get(shape);
export function setCurveFitRange(shape:Cubic,range:CurveFitRange):Cubic {ranges.set(shape,range);return shape;}
/** A new fitted cubic keeps its endpoint interval. Exact trims and reversals
 * provide their local bounds; namespace adapters provide the identity map. */
export function retainCurveFitRange(from:Cubic,to:Cubic,lo=0,hi=1,id:(id:string)=>string=value=>value):Cubic {
 const prior=ranges.get(from);if(prior){const [a,b]=prior.parameterRange,at=(t:number)=>t===0?a:t===1?b:a+(b-a)*t;ranges.set(to,{id:id(prior.id),parameterRange:[at(lo),at(hi)]});}return to;
}
