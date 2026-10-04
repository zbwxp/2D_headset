import {describe,expect,it} from 'vitest';
import {solveBoundedSnapshotBasisAdjustment,type BasisDisplacementRow,type BoundedBasisScalar,type BoundedBasisSolution} from '../../domain/recordingSnapshot/boundedBasisInverse';

// Independent direct-cost reference: evaluate the actual sampled displacements
// and all penalties at every trial, without using the quadratic implementation.
function response(s:BoundedBasisScalar,d:number):number|undefined {
 const epsilon=64*Number.EPSILON*Math.max(1,Math.abs(s.span),Math.abs(s.target),Math.abs(d));
 if(Math.abs(s.span+d)<=epsilon)return Math.abs(s.target)<=epsilon?s.weight:undefined;
 const value=s.target/(s.span+d);
 return Number.isFinite(value)&&Math.abs(value-s.weight)<=8+1e-10?value:undefined;
}
function directCost(scalars:readonly BoundedBasisScalar[],rows:readonly BasisDisplacementRow[],deltas:readonly number[]):number {
 let result=0;
 for(let i=0;i<scalars.length;i++){
  const s=scalars[i],weight=response(s,deltas[i]);if(weight===undefined)return Infinity;
  result+=((s.kind==='node'?16:1)*deltas[i]*deltas[i]+.005*(weight-s.weight)**2)/Math.max(1,scalars.length);
 }
 for(const row of rows){let displacement=0;for(const term of row.terms)displacement+=term.coefficient*deltas[term.index];result+=row.weight*displacement*displacement;}
 return result;
}
function directSolve(input:readonly BoundedBasisScalar[],rows:readonly BasisDisplacementRow[],scale:number):BoundedBasisSolution|undefined {
 const scalars=input.map(s=>({...s,span:s.span/scale,target:s.target/scale})),deltas=scalars.map(()=>0);
 const intervals=scalars.map(s=>{
  const cuts=[-1,1,-s.span];
  for(const w of [s.weight-8,s.weight+8])if(w!==0)cuts.push(s.target/w-s.span);
  const ordered=cuts.filter(d=>Number.isFinite(d)&&d>=-1&&d<=1).sort((a,b)=>a-b),feasible:[number,number][]=[];
  for(const d of ordered)if(response(s,d)!==undefined)feasible.push([d,d]);
  for(let j=1;j<ordered.length;j++)if(response(s,(ordered[j-1]+ordered[j])/2)!==undefined)feasible.push([ordered[j-1],ordered[j]]);
  return feasible;
 });
 if(intervals.some(interval=>interval.length===0))return undefined;
 for(let i=0;i<scalars.length;i++)if(response(scalars[i],0)===undefined){
  const choices=intervals[i].flatMap(([a,b])=>[a,b,(a+b)/2]).filter(d=>response(scalars[i],d)!==undefined);
  choices.sort((a,b)=>Math.abs(a)-Math.abs(b));deltas[i]=choices[0];
 }
 let cost=directCost(scalars,rows,deltas);
 for(let sweep=0;sweep<12;sweep++){
  const before=cost;
  for(let i=0;i<scalars.length;i++){
   let best=deltas[i],minimum=cost;
   const consider=(x:number)=>{deltas[i]=x;const value=directCost(scalars,rows,deltas);if(value<minimum){minimum=value;best=x;}return value;};
   consider(0);
   for(const [lo,hi] of intervals[i]){
    consider(lo);consider(hi);if(lo===hi)continue;
    let a=lo,b=hi,x=b-(b-a)*.6180339887498949,y=a+(b-a)*.6180339887498949,fx=consider(x),fy=consider(y);
    for(let iteration=0;iteration<22;iteration++)if(fx<fy){b=y;y=x;fy=fx;x=b-(b-a)*.6180339887498949;fx=consider(x);}else{a=x;x=y;fx=fy;y=a+(b-a)*.6180339887498949;fy=consider(y);}
   }
   deltas[i]=best;cost=minimum;
  }
  if(before-cost<=1e-12*Math.max(1,before))break;
 }
 const weights=scalars.map((s,i)=>response(s,deltas[i])!);
 return {deltas:deltas.map(d=>d*scale),weights,cost,boundActive:deltas.some(d=>Math.abs(d)>1-1e-6)||weights.some((w,i)=>Math.abs(w-scalars[i].weight)>8-1e-6)};
}
function cubicRows(offset=0,weight=1):BasisDisplacementRow[] {
 return Array.from({length:9},(_,sample)=>{
  const t=sample/8,u=1-t,b=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];
  return {weight:weight/9,terms:[{index:offset,coefficient:b[0]+b[1]},{index:offset+1,coefficient:b[2]+b[3]},{index:offset+2,coefficient:b[1]},{index:offset+3,coefficient:b[2]}]};
 });
}
const cases:{name:string;scalars:BoundedBasisScalar[];rows:BasisDisplacementRow[];scale:number}[]=[
 {name:'signed responses and coupled node / H-P displacement',scale:1,rows:cubicRows(),scalars:[
  {span:.3,target:-.5,weight:-.75,kind:'node'},{span:-.4,target:.08,weight:2/3,kind:'node'},
  {span:.1,target:.2,weight:-1,kind:'handle'},{span:-.05,target:-.16,weight:1.4,kind:'handle'},
 ]},
 {name:'preexisting positive and negative overshoot',scale:1,rows:cubicRows(),scalars:[
  {span:.02,target:.52,weight:25,kind:'node'},{span:.03,target:-.33,weight:-12,kind:'node'},
  {span:0,target:.03,weight:9.25,kind:'handle'},{span:-.004,target:-.06,weight:-18,kind:'handle'},
 ]},
 {name:'flat spans and equal-cost signed branches',scale:1,rows:cubicRows(),scalars:[
  {span:0,target:.2,weight:0,kind:'node'},{span:0,target:-.17,weight:0,kind:'node'},
  {span:0,target:.08,weight:0,kind:'handle'},{span:0,target:-.03,weight:0,kind:'handle'},
 ]},
 {name:'zero targets and isolated feasible collapsed spans',scale:1,rows:cubicRows(),scalars:[
  {span:0,target:0,weight:-9,kind:'node'},{span:.2,target:0,weight:20,kind:'node'},
  {span:0,target:0,weight:2/3,kind:'handle'},{span:0,target:.1,weight:2/3,kind:'handle'},
 ]},
 {name:'aliased endpoints, cancelled terms and disconnected controls',scale:13,rows:[...cubicRows(),
  {weight:.2,terms:[{index:0,coefficient:.3},{index:0,coefficient:-.7},{index:3,coefficient:.5}]},
  {weight:100,terms:[{index:1,coefficient:2},{index:1,coefficient:-2}]},{weight:1,terms:[]},
 ],scalars:[
  {span:.2,target:.3,weight:-.2,kind:'node'},{span:-.4,target:.08,weight:2/3,kind:'node'},
  {span:0,target:.2,weight:.4,kind:'handle'},{span:0,target:-.16,weight:1.4,kind:'handle'},
  {span:.2,target:.1,weight:.5,kind:'node'},
 ]},
];

describe('sparse quadratic bounded basis objective',()=>{
 it.each(cases)('matches the direct objective for $name',({scalars,rows,scale})=>{
  const before=JSON.stringify({scalars,rows}),actual=solveBoundedSnapshotBasisAdjustment(scalars,rows,scale)!,reference=directSolve(scalars,rows,scale)!;
  expect(actual).toBeDefined();expect(reference).toBeDefined();
  for(let i=0;i<scalars.length;i++){
   expect(Number.isFinite(actual.deltas[i])&&Number.isFinite(actual.weights[i])).toBe(true);
   expect(Math.abs(actual.deltas[i])).toBeLessThanOrEqual(scale);
   expect(Math.abs(actual.weights[i]-scalars[i].weight)).toBeLessThanOrEqual(8+1e-10);
   expect((scalars[i].span+actual.deltas[i])*actual.weights[i]).toBeCloseTo(scalars[i].target,11);
  }
  const normalized=scalars.map(s=>({...s,span:s.span/scale,target:s.target/scale}));
  expect(actual.cost).toBeCloseTo(directCost(normalized,rows,actual.deltas.map(d=>d/scale)),13);
  // Signed branches may have nonunique minima; compare objectives and exact
  // feasible replay, rather than requiring bit-identical chosen coordinates.
  expect(Math.abs(actual.cost-reference.cost)).toBeLessThan(1e-9*Math.max(1,reference.cost));
  expect(solveBoundedSnapshotBasisAdjustment(scalars,rows,scale)).toEqual(actual);
  expect(JSON.stringify({scalars,rows})).toBe(before);
 });
 it('retains a finite boundary solution and rejects an unreachable target',()=>{
  const scalar:BoundedBasisScalar={span:0,target:8,weight:0,kind:'handle'},actual=solveBoundedSnapshotBasisAdjustment([scalar],[],1)!;
  expect(actual.boundActive).toBe(true);expect(actual.cost).toBeCloseTo(1+.005*64,13);
  expect(Math.abs(actual.deltas[0])).toBe(1);expect(actual.deltas[0]*actual.weights[0]).toBe(8);
  expect(solveBoundedSnapshotBasisAdjustment([{...scalar,target:9}],[],1)).toBeUndefined();
 });
 it('does not revisit every sample row during coordinate trials on a large sparse selection',()=>{
  const scalars:BoundedBasisScalar[]=[],rows:BasisDisplacementRow[]=[];let rowReads=0;
  for(let curve=0;curve<96;curve++){
   const offset=scalars.length;
   scalars.push({span:.4,target:.3,weight:2/3,kind:'node'},{span:-.2,target:-.15,weight:2/3,kind:'node'},{span:0,target:.02,weight:2/3,kind:'handle'},{span:0,target:-.015,weight:2/3,kind:'handle'});
   for(const row of cubicRows(offset,1/96))rows.push({weight:row.weight,get terms(){rowReads++;return row.terms;}});
  }
  const actual=solveBoundedSnapshotBasisAdjustment(scalars,rows,1)!;
  expect(actual).toBeDefined();expect(Number.isFinite(actual.cost)).toBe(true);
  // One coefficient-preparation read, one initialization, at most 12 sweeps.
  expect(rowReads).toBeLessThanOrEqual(rows.length*14);
  expect(actual.cost).toBeCloseTo(directCost(scalars,rows,actual.deltas),13);
  for(let i=0;i<scalars.length;i++)expect((scalars[i].span+actual.deltas[i])*actual.weights[i]).toBeCloseTo(scalars[i].target,12);
 });
});
