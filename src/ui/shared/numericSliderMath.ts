export const SLIDER = {normalizedStep:.0025,fineScale:.2,coarseScale:5,delay:300,stepsPerSecond:20,maxMultiplier:16};
export const formatNumeric=(value:number)=>String(Number(value.toFixed(2)));
export const modifierScale=(alt:boolean,shift:boolean,fine=SLIDER.fineScale,coarse=SLIDER.coarseScale)=>alt?fine:shift?coarse:1;
export const holdMultiplier=(ms:number)=>1+(SLIDER.maxMultiplier-1)*(1-Math.exp(-Math.max(0,ms-SLIDER.delay)/1400))**2;
export const trackValue=(x:number,left:number,width:number,min:number,max:number)=>min+Math.max(0,Math.min(1,(x-left)/Math.max(1,width)))*(max-min);
/** A directional neutral detent, not a value quantization grid. */
export const snapTowardZero=(previous:number,next:number,min:number,max:number)=>{
 const range=max-min;
 if(range<=0||min>=0||max<=0||Math.abs(min+max)>range*1e-10)return next;
 return previous!==0&&Math.abs(next)<=range*.01&&(Math.abs(next)<Math.abs(previous)||previous*next<0)?0:next;
};

export const snapTowardTargets=(previous:number,next:number,min:number,max:number,targets?:number[])=>{
 if(!targets)return snapTowardZero(previous,next,min,max);
 const target=targets.filter(t=>t>=min&&t<=max&&previous!==t&&Math.abs(next-t)<=(max-min)*.01&&(Math.abs(next-t)<Math.abs(previous-t)||(previous-t)*(next-t)<0)).sort((a,b)=>Math.abs(next-a)-Math.abs(next-b)||a-b)[0];
 return target??next;
};
