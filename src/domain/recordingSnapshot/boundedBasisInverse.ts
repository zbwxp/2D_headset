/** A finite, signed response trust region applies only after the original
 * fixed-basis inverse fails. It is centered on each frozen existing response,
 * so existing authored overshoot is always admissible. */
export const SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS=8;
export const SNAPSHOT_BASIS_NODE_PENALTY=16;
export const SNAPSHOT_BASIS_RESPONSE_PENALTY=.005;
export interface BoundedBasisScalar {
 /** Existing side-minus-zero coordinate (nodes or relative handle vectors). */
 span:number;
 /** Target-minus-zero after subtracting any unchanged inherited residual. */
 target:number;
 weight:number;
 kind:'node'|'handle';
}
export interface BasisDisplacementRow {terms:readonly {index:number;coefficient:number}[];weight:number}
export interface BoundedBasisSolution {deltas:number[];weights:number[];cost:number;boundActive:boolean}
const tolerance=64*Number.EPSILON;
const scalarWeight=(scalar:BoundedBasisScalar,delta:number):number|undefined=>{
 const span=scalar.span+delta,eps=tolerance*Math.max(1,Math.abs(scalar.span),Math.abs(delta),Math.abs(scalar.target));
 if(Math.abs(span)<=eps)return Math.abs(scalar.target)<=eps?scalar.weight:undefined;
 const weight=scalar.target/span;
 return Number.isFinite(weight)&&Math.abs(weight-scalar.weight)<=SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS+1e-10?weight:undefined;
};
/** Frozen normalized sampled-curve displacement, node/handle preference and
 * response continuity. The bilinear feasible set is not convex: deterministic
 * bounded coordinate minimization is a local solve, not a global-optimum claim. */
export function solveBoundedSnapshotBasisAdjustment(scalars:readonly BoundedBasisScalar[],rows:readonly BasisDisplacementRow[],scale:number):BoundedBasisSolution|undefined {
 if(!Number.isFinite(scale)||scale<=0||scalars.some(s=>![s.span,s.target,s.weight].every(Number.isFinite)))return undefined;
 const normalized=scalars.map(s=>({...s,span:s.span/scale,target:s.target/scale})),deltas=normalized.map(()=>0),intervals=normalized.map(s=>{
  const lo=s.weight-SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS,hi=s.weight+SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS;
  const cuts=[-1,1,-s.span,...[lo,hi].filter(w=>w!==0).map(w=>s.target/w-s.span)].filter(x=>x>=-1&&x<=1&&Number.isFinite(x)).sort((a,b)=>a-b);
  const result:[number,number][]=[];
  for(const cut of cuts)if(scalarWeight(s,cut)!==undefined)result.push([cut,cut]);
  for(let i=1;i<cuts.length;i++)if(scalarWeight(s,(cuts[i-1]+cuts[i])/2)!==undefined)result.push([cuts[i-1],cuts[i]]);
  return result;
 });
 if(intervals.some(value=>!value.length))return undefined;
 const count=Math.max(1,normalized.length),cost=()=>{
  let value=0;
  for(let i=0;i<normalized.length;i++){
   const w=scalarWeight(normalized[i],deltas[i]);if(w===undefined)return Infinity;
   value+=((normalized[i].kind==='node'?SNAPSHOT_BASIS_NODE_PENALTY:1)*deltas[i]**2+SNAPSHOT_BASIS_RESPONSE_PENALTY*(w-normalized[i].weight)**2)/count;
  }
  for(const row of rows)value+=row.weight*row.terms.reduce((sum,term)=>sum+term.coefficient*deltas[term.index],0)**2;
  return value;
 };
 // Every coordinate is initialized inside its own exact bounded feasible set.
 for(let i=0;i<normalized.length;i++)if(scalarWeight(normalized[i],0)===undefined){
  const choices=intervals[i].flatMap(([a,b])=>[a,b,(a+b)/2]).filter(d=>scalarWeight(normalized[i],d)!==undefined);
  choices.sort((a,b)=>Math.abs(a)-Math.abs(b));deltas[i]=choices[0];
 }
 let current=cost();
 if(!Number.isFinite(current))return undefined;
 for(let sweep=0;sweep<12;sweep++){
  const before=current;
  for(let i=0;i<normalized.length;i++){
   let best=deltas[i],bestCost=current;
   const consider=(x:number)=>{deltas[i]=x;const value=cost();if(value<bestCost){best=x;bestCost=value;}return value;};
   consider(0);
   for(const [lo,hi] of intervals[i]){
    consider(lo);consider(hi);if(lo===hi)continue;
    let a=lo,b=hi,x=b-(b-a)*.6180339887498949,y=a+(b-a)*.6180339887498949,fx=consider(x),fy=consider(y);
    for(let iteration=0;iteration<22;iteration++)if(fx<fy){b=y;y=x;fy=fx;x=b-(b-a)*.6180339887498949;fx=consider(x);}else{a=x;x=y;fx=fy;y=a+(b-a)*.6180339887498949;fy=consider(y);}
   }
   deltas[i]=best;current=bestCost;
  }
  if(before-current<=1e-12*Math.max(1,before))break;
 }
 const weights=normalized.map((s,i)=>scalarWeight(s,deltas[i])!);
 return {deltas:deltas.map(d=>d*scale),weights,cost:current,boundActive:deltas.some(d=>Math.abs(d)>1-1e-6)||weights.some((w,i)=>Math.abs(w-normalized[i].weight)>SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS-1e-6)};
}
