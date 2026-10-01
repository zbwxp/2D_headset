/** Piecewise bilinear weights on the complete parameter lattice. Missing cells
 * are evaluated by the caller as neutral + X delta + Y delta. This keeps authored
 * keyforms exact and supports local corrective poses without distance weighting. */
export interface Angle {x:number;y:number}
export const clampAngle=(n:number)=>Math.max(-90,Math.min(90,Number.isFinite(n)?n:0));
export const angleKey=({x,y}:Angle)=>`${x.toFixed(4)},${y.toFixed(4)}`;
export const sameAngle=(a:Angle,b:Angle)=>Math.abs(a.x-b.x)<.00001&&Math.abs(a.y-b.y)<.00001;
export function bracket(values:number[],value:number):[number,number,number]{
 const sorted=[...new Set(values)].sort((a,b)=>a-b),v=Math.max(sorted[0],Math.min(sorted.at(-1)!,value));
 const lo=sorted.filter(x=>x<=v).at(-1)!,hi=sorted.find(x=>x>=v)!;
 return [lo,hi,hi===lo?0:(v-lo)/(hi-lo)];
}
export function latticeWeights(keys:Angle[],angle:Angle):{angle:Angle;weight:number}[]{
 const [x0,x1,tx]=bracket([-90,0,90,...keys.map(k=>k.x)],clampAngle(angle.x));
 const [y0,y1,ty]=bracket([-90,0,90,...keys.map(k=>k.y)],clampAngle(angle.y));
 const raw=[{angle:{x:x0,y:y0},weight:(1-tx)*(1-ty)},{angle:{x:x1,y:y0},weight:tx*(1-ty)},{angle:{x:x0,y:y1},weight:(1-tx)*ty},{angle:{x:x1,y:y1},weight:tx*ty}];
 return raw.filter(x=>x.weight>0);
}
