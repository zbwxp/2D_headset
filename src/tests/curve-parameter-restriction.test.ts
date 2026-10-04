import {expect,test} from 'vitest';
import {curveParameterSourceKnots,mappedParameter,mappedParameterSlope,sourceParameter,sourceParameterSlope,type CurveParameterMap} from '../domain/deformation/cubicDeformation';
import {composeCurveParameterMaps,restrictCurveParameterMap} from '../domain/deformation/curveParameterRestriction';

const parent:CurveParameterMap={values:Array.from({length:129},(_,i)=>{const t=i/128;return t+.12*Math.sin(Math.PI*t);})};
parent.values[128]=1;
const near=(actual:number,wanted:number)=>expect(actual).toBeCloseTo(wanted,12);

test('uniform fitter maps preserve their existing numeric lookup and derivative arithmetic',()=>{
 for(const t of [-.1,0,.001,.173,.5,.999,1,1.1]){
  const x=Math.max(0,Math.min(1,t))*128,i=Math.min(127,Math.floor(x));
  expect(mappedParameter(t,parent)).toBe(parent.values[i]+(parent.values[i+1]-parent.values[i])*(x-i));
  expect(mappedParameterSlope(t,parent)).toBe((parent.values[i+1]-parent.values[i])*128);
 }
 expect(curveParameterSourceKnots(parent)).toEqual(Array.from({length:129},(_,i)=>i/128));
 expect(curveParameterSourceKnots()).toEqual([0,1]);
});

test('a non-grid restriction retains every source breakpoint and exact material correspondence',()=>{
 const lo=.173,hi=.843,child=restrictCurveParameterMap(parent,lo,hi),a=mappedParameter(lo,parent),span=mappedParameter(hi,parent)-a;
 expect(child.sourceKnots).toEqual([0,...curveParameterSourceKnots(parent).filter(t=>t>lo&&t<hi).map(t=>(t-lo)/(hi-lo)),1]);
 expect(child.sourceKnots![1]).not.toBe(1/(child.values.length-1));
 for(let i=0;i<=1000;i++){
  const s=i/1000,t=lo+(hi-lo)*s,q=mappedParameter(s,child);
  near(q,(mappedParameter(t,parent)-a)/span);
  near(sourceParameter(q,child),s);
  near(mappedParameterSlope(s,child),mappedParameterSlope(t,parent)*(hi-lo)/span);
  near(sourceParameterSlope(q,child),1/mappedParameterSlope(s,child));
 }
 for(const [i,t] of child.sourceKnots!.entries()){
  expect(mappedParameter(t,child)).toBe(child.values[i]);
  expect(sourceParameter(child.values[i],child)).toBe(t);
 }
});

test('repeated restrictions agree with the directly composed native interval',()=>{
 const lo=.173,hi=.843,a=.219,b=.731,once=restrictCurveParameterMap(parent,lo,hi),twice=restrictCurveParameterMap(once,a,b),direct=restrictCurveParameterMap(parent,lo+(hi-lo)*a,lo+(hi-lo)*b);
 expect(twice.values.length).toBe(direct.values.length);
 for(let i=0;i<=1000;i++){
  const t=i/1000;
  near(mappedParameter(t,twice),mappedParameter(t,direct));
  near(mappedParameterSlope(t,twice),mappedParameterSlope(t,direct));
  near(sourceParameter(mappedParameter(t,twice),twice),t);
 }
});

test('nonuniform lookup and one-sided slopes use the declared source intervals',()=>{
 const map:CurveParameterMap={sourceKnots:[0,.2,.7,1],values:[0,.4,.8,1]};
 near(mappedParameter(.1,map),.2);near(mappedParameter(.45,map),.6);
 near(sourceParameter(.6,map),.45);
 near(mappedParameterSlope(.2,map),.8);near(sourceParameterSlope(.4,map),1/.8);
 near(mappedParameterSlope(1,map),2/3);near(sourceParameterSlope(1,map),1.5);
 expect(mappedParameter(-1,map)).toBe(0);expect(mappedParameter(2,map)).toBe(1);
 expect(sourceParameter(-1,map)).toBe(0);expect(sourceParameter(2,map)).toBe(1);
});

test('composition keeps both stages’ breakpoints, inverses and chain-rule slopes',()=>{
 const first=restrictCurveParameterMap(parent,.173,.843),second:CurveParameterMap={sourceKnots:[0,.15,.61,.87,1],values:[0,.4,.55,.96,1]},composed=composeCurveParameterMaps(first,second);
 for(const t of curveParameterSourceKnots(first))expect(composed.sourceKnots).toContain(t);
 for(const q of curveParameterSourceKnots(second))expect(composed.sourceKnots).toContain(sourceParameter(q,first));
 for(let i=0;i<=1000;i++){
  const t=i/1000,q=mappedParameter(t,first),result=mappedParameter(t,composed);
  near(result,mappedParameter(q,second));
  near(sourceParameter(result,composed),t);
  near(mappedParameterSlope(t,composed),mappedParameterSlope(t,first)*mappedParameterSlope(q,second));
 }
 const restricted=restrictCurveParameterMap(composed,.187,.891);
 for(let i=0;i<=100;i++)near(sourceParameter(mappedParameter(i/100,restricted),restricted),i/100);
});

test('identity/full-domain operations return independent data and reject invalid restrictions',()=>{
 expect(restrictCurveParameterMap(undefined,.2,.7)).toEqual({sourceKnots:[0,1],values:[0,1]});
 const copy=restrictCurveParameterMap(parent,0,1);expect(copy).toEqual(parent);expect(copy.values).not.toBe(parent.values);
 expect(composeCurveParameterMaps(undefined,parent)).toEqual(parent);
 expect(composeCurveParameterMaps(parent,undefined)).toEqual(parent);
 for(const [lo,hi] of [[0,0],[-.1,.5],[.2,1.1],[NaN,1]])expect(()=>restrictCurveParameterMap(parent,lo,hi)).toThrow(/restriction/);
 for(const map of [{values:[0,0,1]},{values:[0,.5,1],sourceKnots:[0,1]},{values:[0,.5,1],sourceKnots:[0,NaN,1]}])expect(()=>restrictCurveParameterMap(map,.2,.7)).toThrow(/correspondence/);
});
