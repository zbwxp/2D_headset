import type {Angle} from './model';

/** Retained fields use their original geometric coordinates, independently of
 * any later subdivision or authored response weights. */
export function snapshotSupportWeights(field:{angles:readonly Angle[]},at:Angle,fail:(message:string)=>never):number[]{
 const [a,b,c]=field.angles;let result:number[];
 if(!c){const x=b.x-a.x,y=b.y-a.y,d=x*x+y*y;if(!d)fail('degenerate edge support.');const t=((at.x-a.x)*x+(at.y-a.y)*y)/d;result=[1-t,t];}
 else{const d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(!d)fail('degenerate triangle support.');const u=((b.y-c.y)*(at.x-c.x)+(c.x-b.x)*(at.y-c.y))/d,v=((c.y-a.y)*(at.x-c.x)+(a.x-c.x)*(at.y-c.y))/d;result=[u,v,1-u-v];}
 if(result.some(w=>w < -1e-10||w>1+1e-10))fail('child support leaves its original field.');result=result.map(w=>Math.max(0,Math.min(1,w)));const sum=result.reduce((a,b)=>a+b,0);return result.map(w=>w/sum);
}
/** Same discrete tie policy everywhere: maximum geometric weight, then pitch,
 * yaw and snapshot ID. A response never changes this selector. */
export function dominantSnapshotBasis(bases:readonly {snapshotId:string;angle?:Angle}[],weights:readonly number[]):number {
 return bases.map((basis,index)=>({basis,index,weight:weights[index]})).sort((a,b)=>b.weight-a.weight||(a.basis.angle?.y??0)-(b.basis.angle?.y??0)||(a.basis.angle?.x??0)-(b.basis.angle?.x??0)||a.basis.snapshotId.localeCompare(b.basis.snapshotId))[0].index;
}
