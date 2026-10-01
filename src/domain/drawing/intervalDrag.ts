import type {DisplayInterval,Point2,StrokeDisplayIntervals} from './model';
import type {displayField} from './displayIntervals';

type Field=ReturnType<typeof displayField>;
type IntervalBounds={start:number;end:number;fullLoop?:boolean};
type Segment={a:Point2;b:Point2;start:number;end:number};
export interface IntervalDragState {
 readonly segments:readonly Segment[];
 readonly total:number;
 readonly closed:boolean;
 readonly origin:number;
 readonly direction:1|-1;
 readonly scale:number;
 readonly side:0|1;
 readonly unitsPerPixel:number;
 readonly grabOffset:Point2;
 readonly pointer:Point2;
 /** Unwrapped, directed bounds for a closed track; never inferred from pixels. */
 readonly start:number;
 readonly end:number;
 readonly stored:IntervalBounds;
}
export interface IntervalDragUpdate {state:IntervalDragState;change:{start?:number;end?:number;fullLoop?:boolean}}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const wrap=(v:number)=>((v%1)+1)%1;
const finite=(p:Point2)=>p.length===2&&p.every(Number.isFinite);
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

/** A gesture captures one authored traversal. Coincident world-space locations
 * on another loop (or an open path's other end) are not neighboring material.
 * unitsPerPixel is logical drawing units per screen pixel, not its reciprocal. */
export function beginIntervalDrag(field:Field,track:StrokeDisplayIntervals,range:DisplayInterval,side:0|1,pointerPoint:Point2,unitsPerPixel:number):IntervalDragState {
 if(!finite(pointerPoint)||!Number.isFinite(unitsPerPixel)||unitsPerPixel<=0||!Number.isFinite(field.total)||field.total<=1e-12||![range.start,range.end].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||(side!==0&&side!==1))throw Error('显示区间拖动参数无效。');
 const origin=field.native(track,0),last=field.native(track,1),closed=track.scope!=='CURVE'&&Math.abs(last-origin)<1e-12;
 if(range.fullLoop!==undefined&&typeof range.fullLoop!=='boolean'||range.fullLoop&&!closed)throw Error('全圈区间只能沿闭合显示路径拖动。');
 let step=closed?field.native(track,.25)-origin:last-origin;
 if(closed){if(step>.5)step-=1;if(step<-.5)step+=1;}
 const direction:1|-1=step<0?-1:1,scale=closed?1:Math.abs(step);
 if(scale<=1e-12)throw Error('显示区间所在曲线退化，无法拖动。');
 const segments:Segment[]=field.parts.flatMap((part,index)=>{
  const piece=field.geometry.pieces[index];
  if(track.scope==='CURVE'&&(piece.joinId||!piece.owners.includes(track.anchor.id)))return [];
  return part.pts.slice(1).map((point,i)=>({a:[...part.pts[i].p] as Point2,b:[...point.p] as Point2,start:(part.start+part.dist[i])/field.total,end:(part.start+part.dist[i+1])/field.total})).filter(s=>s.end>s.start);
 });
 const span=closed?(range.fullLoop||Math.abs(range.end-range.start)>=1-1e-10?1:wrap(range.end-range.start)):range.end-range.start,start=range.start,end=start+span;
 const grip=field.at(field.native(track,side?range.end:range.start)).p;
 return {segments,total:field.total,closed,origin,direction,scale,side,unitsPerPixel,grabOffset:[pointerPoint[0]-grip[0],pointerPoint[1]-grip[1]],pointer:[...pointerPoint],start,end,stored:{start:range.start,end:range.end,...(range.fullLoop===undefined?{}:{fullLoop:range.fullLoop})}};
}

/** Follow only material locally reachable from the preceding grip. The window
 * is measured in arc length from pointer travel (with a 2px capture allowance),
 * so a crossing never gets to compete solely because it is nearest in pixels. */
export function updateIntervalDrag(state:IntervalDragState,pointerPoint:Point2):IntervalDragUpdate {
 if(!finite(pointerPoint))throw Error('显示区间拖动位置无效。');
 const travel=distance(pointerPoint,state.pointer);
 if(travel===0)return {state,change:{...state.stored}};
 const active=state.side?state.end:state.start,previous=state.origin+state.direction*active*state.scale;
 const radius=Math.min(state.scale/4,(travel*2+state.unitsPerPixel*2)/state.total),lo=previous-radius,hi=previous+radius;
 const target:Point2=[pointerPoint[0]-state.grabOffset[0],pointerPoint[1]-state.grabOffset[1]];
 let best=Infinity,bestProgress=Infinity,result=previous;
 for(const segment of state.segments){
  const turns=state.closed?[Math.floor(previous)-1,Math.floor(previous),Math.floor(previous)+1]:[0];
  for(const turn of turns){
   const a=segment.start+turn,b=segment.end+turn;if(b<lo||a>hi)continue;
   const min=clamp((lo-a)/(b-a),0,1),max=clamp((hi-a)/(b-a),0,1),vx=segment.b[0]-segment.a[0],vy=segment.b[1]-segment.a[1],den=vx*vx+vy*vy;
   const t=clamp(den?((target[0]-segment.a[0])*vx+(target[1]-segment.a[1])*vy)/den:0,min,max),candidate=a+(b-a)*t;
   const dx=target[0]-segment.a[0]-vx*t,dy=target[1]-segment.a[1]-vy*t,score=dx*dx+dy*dy,progress=Math.abs(candidate-previous);
   if(score<best-1e-20||Math.abs(score-best)<=1e-20&&progress<bestProgress){best=score;bestProgress=progress;result=candidate;}
  }
 }
 let value=(result-state.origin)/(state.direction*state.scale);
 value=state.closed?clamp(value,state.side?state.start:state.end-1,state.side?state.start+1:state.end):clamp(value,0,1);
 const start=state.side?state.start:value,end=state.side?value:state.end;
 const stored=state.closed?serializeClosed(start,end,state.stored):{start,end,...(state.stored.fullLoop===undefined?{}:{fullLoop:false})};
 return {state:{...state,pointer:[...pointerPoint],start,end,stored},change:{...stored}};
}

function serializeClosed(start:number,end:number,previous:IntervalBounds):IntervalBounds{
 const span=end-start;
 if(span>=1-Number.EPSILON*4){
  // Legacy origin-anchored [0,1] remains byte-stable at its full-length limit.
  if(previous.fullLoop!==true&&previous.start===0&&previous.end===1&&Math.abs(start)<Number.EPSILON*4)return {start:0,end:1,...(previous.fullLoop===undefined?{}:{fullLoop:false})};
  const anchor=wrap(start);return {start:anchor,end:anchor,fullLoop:true};
 }
 const fullLoop=previous.fullLoop===undefined?{}:{fullLoop:false};
 if(span<=Number.EPSILON*4){const s=wrap(start);return {start:s,end:s,...fullLoop};}
 const s=wrap(start),e=wrap(end);
 return {start:s===0&&previous.start===1?1:s,end:e===0?1:e,...fullLoop};
}
