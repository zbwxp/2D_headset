import type {HairLeaf,HairBang,HairStrand} from './model';
export const randomUnit=(random:()=>number)=>Math.max(1e-6,Math.min(1-1e-6,random()));
/** Legacy migration is repeatable even before a migrated document is saved. */
export function seededHairRandom(seed:string){let n=2166136261;for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619);return()=>{n+=0x6D2B79F5;let t=Math.imul(n^(n>>>15),1|n);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
export const bangRandom=(bang:HairBang|undefined,key:string)=>seededHairRandom(`${bang?.seed??0}:${key}`);
export function centerAngles(bang?:HairBang):[number,number]{const r=bangRandom(bang,'center-angles');return [20+20*r(),20+20*r()];}
export function hairCapacity(leaf:HairLeaf,bang?:HairBang){const [left,right]=centerAngles(bang);return [Math.max(0,Math.floor((leaf.leftAngle-left+1e-8)/5)-1),Math.max(0,Math.floor((leaf.rightAngle-right+1e-8)/5)-1)] as const;}
/** Stratify the available side fans, then bounded jitter. A five degree margin
 * includes the center and outer boundary. Overcrowded saved strands are dormant,
 * not deleted: widening the fan restores their IDs and original random samples. */
export function layoutHairAngles(leaf:HairLeaf,bang:HairBang|undefined,curves:HairStrand[]):Map<string,number>{
 const centers=centerAngles(bang),capacity=hairCapacity(leaf,bang),counts=[0,0];
 for(let i=0;i<curves.length;i++){
  const side=counts[0]>=capacity[0]?1:counts[1]>=capacity[1]?0:counts[0]/(capacity[0]||1)<=counts[1]/(capacity[1]||1)?0:1;
  if(counts[side]>=capacity[side])break;counts[side]++;
 }
 const result=new Map<string,number>();let index=0;
 for(const side of [0,1]){
  const count=counts[side],lo=centers[side],hi=side===0?leaf.leftAngle:leaf.rightAngle,step=(hi-lo)/(count+1),jitter=Math.min(.28*step,Math.max(0,(step-5)/2));
  for(let i=0;i<count;i++){
   const c=curves[index++],angle=lo+step*(i+1)+(2*c.angleT-1)*jitter;
   result.set(c.id,(side===0?1:-1)*angle);
  }
 }
 return result;
}
