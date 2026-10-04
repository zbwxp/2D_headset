import {curveParameterSourceKnots,mappedParameter,sourceParameter,type CurveParameterMap} from './cubicDeformation';

const fail=():never=>{throw Error('Curve parameter correspondence must be finite, strictly increasing, and cover 0…1.');};
function validate(map:CurveParameterMap|undefined):void {
 if(!map)return;
 const knots=curveParameterSourceKnots(map),values=map.values;
 if(values.length<2||knots.length!==values.length||[knots,values].some(list=>list[0]!==0||list.at(-1)!==1||list.some((value,index)=>!Number.isFinite(value)||index>0&&value<=list[index-1])))fail();
}
const copy=(map:CurveParameterMap|undefined):CurveParameterMap=>map?{values:[...map.values],...(map.sourceKnots?{sourceKnots:[...map.sourceKnots]}:{})}:{values:[0,1]};

/** Restrict M to a native source interval and normalize both axes:
 * (M(lo + (hi-lo)s) - M(lo)) / (M(hi)-M(lo)). Every original breakpoint inside
 * the interval survives; no uniform resampling or geometry fitting occurs. */
export function restrictCurveParameterMap(map:CurveParameterMap|undefined,lo:number,hi:number):CurveParameterMap {
 validate(map);
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo<0||hi>1||!(hi>lo))throw Error('A curve parameter restriction requires 0 ≤ lo < hi ≤ 1.');
 if(lo===0&&hi===1)return copy(map);
 const start=mappedParameter(lo,map),end=mappedParameter(hi,map),span=end-start;
 if(!(span>0))fail();
 const interior=curveParameterSourceKnots(map).filter(value=>value>lo&&value<hi);
 return {sourceKnots:[0,...interior.map(value=>(value-lo)/(hi-lo)),1],values:[0,...interior.map(value=>(mappedParameter(value,map)-start)/span),1]};
}

/** Compose in evaluation order: second(first(t)). Knots of the first map and
 * preimages of every second-map knot make this exact piecewise-linear data. */
export function composeCurveParameterMaps(first:CurveParameterMap|undefined,second:CurveParameterMap|undefined):CurveParameterMap {
 validate(first);validate(second);
 if(!first)return copy(second);if(!second)return copy(first);
 const sourceKnots=[...new Set([...curveParameterSourceKnots(first),...curveParameterSourceKnots(second).map(value=>sourceParameter(value,first))])].sort((a,b)=>a-b);
 return {sourceKnots,values:sourceKnots.map(value=>mappedParameter(mappedParameter(value,first),second))};
}
