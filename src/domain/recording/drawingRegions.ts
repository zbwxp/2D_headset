import {evaluate,split} from '../geometry/bezier';
import type {Vec3} from '../project/types';
import type {Cubic,DrawingRegions,Point2,RecordedCurve,Recording} from './model';
import type {SmoothResult} from './smooth';

export type Interval=[number,number];
const EPS=1e-9;
const xyz=(s:Cubic):Vec3[]=>s.map(([x,y])=>[x,y,0]);
export const pointOnCubic=(s:Cubic,t:number):Point2=>{const p=evaluate(xyz(s),t);return [p[0],p[1]];};
/** Exact de Casteljau clipping; authoring controls/keys never change. */
export function cubicSpan(shape:Cubic,[lo,hi]:Interval):Cubic {
 if(lo===0&&hi===1)return shape;
 const left=hi<1?split(xyz(shape),hi)[0]:xyz(shape);
 return (lo>0?split(left,lo/hi)[1]:left).map(([x,y])=>[x,y]) as Cubic;
}
export function unionIntervals(intervals:Interval[]):Interval[]{
 const sorted=intervals.filter(([a,b])=>b-a>EPS).map(p=>[...p] as Interval).sort((a,b)=>a[0]-b[0]),result:Interval[]=[];
 for(const [a,b] of sorted){const prev=result.at(-1);if(prev&&a<=prev[1]+EPS)prev[1]=Math.max(prev[1],b);else result.push([a,b]);}
 return result;
}
export const drawingIntervals=(curve:RecordedCurve):Interval[]=>curve.drawing?.enabled?unionIntervals(curve.drawing.regions.map(r=>[r.start,r.end])):[[0,1]];

export interface DrawingPiece {
 id:string;kind:'source'|'transition';shape:Cubic;
 /** Source and rendered parameter endpoints correspond; source may run backwards. */
 source:Interval;render:Interval;
}
/** Preserve provenance through Smooth. Each source owns its adjacent half of a
 * transition. The replaced endpoint maps to its midpoint, the trim to its end.
 * This mapping is used by both editor picking and final clipping, never by the solver. */
export function curveDrawingPieces(id:string,smooth:SmoothResult):DrawingPiece[]{
 const shape=smooth.sources.get(id);if(!shape)return [];
 const range:Interval=[0,1],transitions:DrawingPiece[]=[];
 for(const tr of smooth.transitions)tr.trims.forEach((trim,index)=>{
  if(trim.id!==id)return;
  const endpoint=trim.end===0?0:1;range[endpoint]=trim.t;
  transitions.push({id:tr.id,kind:'transition',shape:tr.shape,source:index===0?[trim.t,endpoint]:[endpoint,trim.t],render:index===0?[0,.5]:[.5,1]});
 });
 return [{id,kind:'source',shape,source:range,render:[0,1]},...transitions];
}
export function pieceIntervals(piece:DrawingPiece,regions:Interval[]):Interval[]{
 const [a,b]=piece.source,[x,y]=piece.render,lo=Math.min(a,b),hi=Math.max(a,b);
 if(hi-lo<=EPS)return [];
 return unionIntervals(regions.flatMap(([start,end])=>{
  const left=Math.max(lo,start),right=Math.min(hi,end);if(right-left<=EPS)return [];
  const p=x+(left-a)/(b-a)*(y-x),q=x+(right-a)/(b-a)*(y-x);
  return [[Math.max(x,Math.min(p,q)),Math.min(y,Math.max(p,q))] as Interval];
 }));
}
export function pointOnDrawingCurve(pieces:DrawingPiece[],t:number):Point2|null {
 for(const p of pieces){const [a,b]=p.source;if(t>=Math.min(a,b)-EPS&&t<=Math.max(a,b)+EPS&&Math.abs(b-a)>EPS)return pointOnCubic(p.shape,p.render[0]+(t-a)/(b-a)*(p.render[1]-p.render[0]));}
 return null;
}
export interface DrawingStroke {id:string;kind:DrawingPiece['kind'];shape:Cubic;interval:Interval}
/** Call with already-visible, covered curves. Union contributions before drawing
 * a shared transition to avoid double strokes or a seam at its midpoint. */
export function finalDrawingStrokes(curves:RecordedCurve[],smooth:SmoothResult):DrawingStroke[]{
 const entries=new Map<string,{piece:DrawingPiece;intervals:Interval[]}>();
 for(const c of curves)for(const piece of curveDrawingPieces(c.id,smooth)){
  const key=`${piece.kind}:${piece.id}`,entry=entries.get(key)??{piece,intervals:[]};
  entry.intervals.push(...pieceIntervals(piece,drawingIntervals(c)));entries.set(key,entry);
 }
 return [...entries.values()].flatMap(({piece,intervals})=>unionIntervals(intervals).map(interval=>({id:piece.id,kind:piece.kind,shape:cubicSpan(piece.shape,interval),interval})));
}

function change(r:Recording,id:string,fn:(d:DrawingRegions)=>DrawingRegions):Recording{
 const c=r.curves.find(c=>c.id===id);if(!c||c.locked)return r;
 const prior=c.drawing??{enabled:false,regions:[]},drawing=fn(prior);
 if(JSON.stringify(prior)===JSON.stringify(drawing))return r;
 return {...r,curves:r.curves.map(x=>x===c?{...c,drawing}:x)};
}
export const enableDrawingRegions=(r:Recording,id:string,enabled:boolean)=>change(r,id,d=>({...d,enabled}));
export function addDrawingRegion(r:Recording,id:string,regionId:string,a:number,b:number):Recording{
 if(!regionId||![a,b].every(Number.isFinite)||Math.min(a,b)<0||Math.max(a,b)>1||Math.abs(a-b)<1e-6)return r;
 return change(r,id,d=>d.regions.some(x=>x.id===regionId)?d:{enabled:true,regions:[...d.regions,{id:regionId,start:Math.min(a,b),end:Math.max(a,b)}]});
}
export function editDrawingRegion(r:Recording,id:string,regionId:string,start:number,end:number):Recording{
 if(![start,end].every(Number.isFinite)||start<0||end>1||end-start<1e-6)return r;
 return change(r,id,d=>({...d,regions:d.regions.map(x=>x.id===regionId?{...x,start,end}:x)}));
}
export const removeDrawingRegion=(r:Recording,id:string,regionId:string)=>change(r,id,d=>({...d,regions:d.regions.filter(x=>x.id!==regionId)}));
