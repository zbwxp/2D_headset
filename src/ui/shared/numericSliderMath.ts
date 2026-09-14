export const SLIDER = {normalizedStep:.0025,fineScale:.2,coarseScale:5,delay:300,stepsPerSecond:20,maxMultiplier:16};
export const formatNumeric=(value:number)=>String(Number(value.toFixed(2)));
export const modifierScale=(alt:boolean,shift:boolean,fine=SLIDER.fineScale,coarse=SLIDER.coarseScale)=>alt?fine:shift?coarse:1;
export const holdMultiplier=(ms:number)=>1+(SLIDER.maxMultiplier-1)*(1-Math.exp(-Math.max(0,ms-SLIDER.delay)/1400))**2;
export const trackValue=(x:number,left:number,width:number,min:number,max:number)=>min+Math.max(0,Math.min(1,(x-left)/Math.max(1,width)))*(max-min);
