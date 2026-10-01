import {expect,test} from 'vitest';
import {blendInterval} from '../domain/recording/poseIntervals';
import {validateIntervalOverrides} from '../domain/vectorRecording/intervals';
import {type DisplayInterval} from '../domain/drawing/model';

const range=(start:number,end:number):DisplayInterval=>({id:'range',start,end});
const sample=(start:number,end:number,weight:number)=>({range:range(start,end),weight,width:.02});
const validate=(r:DisplayInterval)=>validateIntervalOverrides([{id:'track',anchor:{id:'curve',reverse:false},ranges:[r]}]);

test('positive interval blending absorbs only computed unit-boundary roundoff',()=>{
 const samples=[sample(.1,1,.92),sample(.1,1,.08)],before=JSON.stringify(samples);
 const start=samples.reduce((n,s)=>n+s.weight*s.range.start,0),length=samples.reduce((n,s)=>n+s.weight*(s.range.end-s.range.start),0);
 expect(start+length).toBe(1.0000000000000002);
 const result=blendInterval(samples,false);
 expect(result.start).toBe(.1);expect(result.end).toBe(1);expect(()=>validate(result)).not.toThrow();
 expect(JSON.stringify(samples)).toBe(before);
});

test('fractional blends of bounded forward and reverse intervals retain strict unit bounds',()=>{
 for(const a of [0,.1,.31,.9,1])for(const b of [0,.1,.37,.9,1])for(const end of [0,1])for(let i=0;i<=100;i++){
  const w=i/100,result=blendInterval([sample(a,end,1-w),sample(b,end,w)],false);
  expect(()=>validate(result)).not.toThrow();expect(result.end).toBeCloseTo(end,14);
 }
});

test('external out-of-domain boundaries remain invalid, including a single ULP',()=>{
 for(const end of [1+Number.EPSILON,1.000001,Infinity]){
  const authored=range(.1,end);expect(()=>validate(authored)).toThrow();
  expect(()=>validate(blendInterval([{range:authored,weight:1,width:.02}],false))).toThrow();
 }
 const result=blendInterval([sample(0,1,1+Number.EPSILON),sample(0,0,-Number.EPSILON)],false);
 expect(result.end).toBeGreaterThan(1);expect(()=>validate(result)).toThrow();
 expect(()=>validate(blendInterval([sample(0,1,1.01)],false))).toThrow();
});

test('in-domain near-boundary values and closed-loop coverage are not snapped',()=>{
 const end=1-Number.EPSILON,result=blendInterval([sample(0,end,1)],false);
 expect(result.end).toBe(end);
 const full={...range(.3,.3),fullLoop:true};
 expect(blendInterval([{range:full,weight:.92,width:.02},{range:full,weight:.08,width:.02}],true)).toMatchObject({start:expect.closeTo(.3,14),end:expect.closeTo(.3,14),fullLoop:true});
});
