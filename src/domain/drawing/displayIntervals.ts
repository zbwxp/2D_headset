import {resolveDisplayRoute,createDisplayRouteField,splitDisplayRoute,type DisplayRoute} from './displayRoutes';
import {curveById,editable,uid,sub,length,validInkEnds,inkTaperDistance,type InkEnds,type InkEndStyle,type DrawingDocument as Doc,type StrokeDisplayIntervals,type DisplayInterval,type DisplayIntervalMode,type Point2,type Cubic} from './model';
import {strokeFor,strokePaths,type StrokePath} from './strokes';
import {derivedUses} from './roundedJoin';
import {arcField} from './sampling';
import {intervalPinch,type InkPinch} from './intervalPinch';
export type Span=[number,number];
export interface InkSpan {start:number;end:number;ends:InkEnds}
const combineEnd=(a:InkEndStyle,b:InkEndStyle):InkEndStyle=>Object.fromEntries((['taper','extension'] as const).flatMap(k=>a[k]===undefined&&b[k]===undefined?[]:[[k,Math.max(a[k]??0,b[k]??0)]]));
/** Only union boundary styles survive; covered markers never pinch a continuous run. */
export function unionInkSpans(spans:InkSpan[]):InkSpan[]{
 const out:InkSpan[]=[];
 for(const s of spans.filter(s=>s.end-s.start>1e-10).sort((a,b)=>a.start-b.start)){
  const last=out.at(-1);if(!last||s.start>last.end+1e-10){out.push({...s,ends:[{...s.ends[0]},{...s.ends[1]}]});continue;}
  if(Math.abs(s.start-last.start)<1e-10)last.ends[0]=combineEnd(last.ends[0],s.ends[0]);
  if(s.end>last.end+1e-10){last.end=s.end;last.ends[1]={...s.ends[1]};}else if(Math.abs(s.end-last.end)<1e-10)last.ends[1]=combineEnd(last.ends[1],s.ends[1]);
 }
 return out;
}
/** Subtraction puts each gap marker's style on the adjacent surviving ink end.
 * Union gaps first so hidden/overlapping markers cannot create spurious tips. */
export function subtractInkSpans(base:InkSpan[],gaps:InkSpan[],closed=false):InkSpan[]{
 const original=unionInkSpans(base),hidden=unionInkSpans(gaps);let out=original;
 for(const gap of hidden)out=out.flatMap(s=>{
  if(gap.end<=s.start+1e-10||gap.start>=s.end-1e-10)return [s];
  const parts:InkSpan[]=[];
  if(gap.start>s.start+1e-10)parts.push({start:s.start,end:gap.start,ends:[s.ends[0],gap.ends[0]]});
  if(gap.end<s.end-1e-10)parts.push({start:gap.end,end:s.end,ends:[gap.ends[1],s.ends[1]]});
  return parts;
 });
 // 0 and 1 are the same material location on a closed path. Linear subtraction
 // loses a gap's terminal brush at that seam, leaving one end blunt. Transfer
 // only the effective cut brush when base ink really continued across the seam;
 // an independently bounded SHOW range retains its existing brush precedence.
 const epsilon=1e-10;
 if(closed&&original.some(s=>s.start<=epsilon)&&original.some(s=>s.end>=1-epsilon)){
  const atStart=out.some(s=>s.start<=epsilon),atEnd=out.some(s=>s.end>=1-epsilon);
  if(atStart&&!atEnd){const brush=hidden.find(s=>s.end>=1-epsilon)?.ends[1];if(brush)out=out.map(s=>s.start<=epsilon?{...s,ends:[{...brush},s.ends[1]]}:s);}
  if(atEnd&&!atStart){const brush=hidden.find(s=>s.start<=epsilon)?.ends[0];if(brush)out=out.map(s=>s.end>=1-epsilon?{...s,ends:[s.ends[0],{...brush}]}:s);}
 }
 return out;
}
export const intervalMode=(r:DisplayInterval):DisplayIntervalMode=>r.mode??'SHOW';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const wrap=(x:number)=>((x%1)+1)%1;
export const localDisplayPath=(d:Doc,id:string)=>strokePaths(strokeFor(d,id)).find(p=>p.segments.some(x=>x.id===id))!;
/** Explicit routes are display-only; strokeFor/layer ownership remain local. */
export function displayRouteFor(d:Doc,id:string):DisplayRoute|undefined {
 for(const track of d.displayIntervals??[])if(track.displayRoute){const resolved=resolveDisplayRoute(d,track.displayRoute);if(!resolved.diagnostics.length&&resolved.path.segments.some(u=>u.id===id))return track.displayRoute;}
 return undefined;
}
export const displayPath=(d:Doc,id:string)=>{const route=displayRouteFor(d,id);return route?resolveDisplayRoute(d,route).path:localDisplayPath(d,id);};
export const pathTracks=(d:Doc,path:StrokePath)=>(d.displayIntervals??[]).filter(t=>path.segments.some(x=>x.id===t.anchor.id));
export function unionSpans(spans:Span[]):Span[]{
 const out:Span[]=[];for(const [a,b] of spans.filter(([a,b])=>b-a>1e-10).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&a<=last[1]+1e-10)last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;
}
/** The saved anchor is only a stable coordinate frame; the interval grips are free arc positions. */
export function displayField(d:Doc,path:StrokePath){
 const route=path.segments.length?displayRouteFor(d,path.segments[0].id):undefined;
 const routed=route&&resolveDisplayRoute(d,route).path.segments.length===path.segments.length?createDisplayRouteField(d,route):undefined;
 const geometry=routed?.geometry??derivedUses(d,path.segments,path.closed),field=routed??arcField(geometry.shapes),tracks=pathTracks(d,path);

 function frame(track:StrokeDisplayIntervals){
  if(track.displayRoute)return {direction:1,origin:0,scale:1};
  const use=path.segments.find(x=>x.id===track.anchor.id)!,direction=use.reverse===track.anchor.reverse?1:-1;
  if(track.scope==='CURVE'){
   const i=geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===use.id),part=field.parts[i];
   return {direction,origin:part?(part.start+(direction===-1?part.length:0))/(field.total||1):0,scale:part?part.length/(field.total||1):0};
  }
  if(!path.closed)return {direction,origin:direction===1?0:1,scale:1};
  const i=geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===use.id),part=field.parts[i];
  return {direction,origin:part?(part.start+(direction===-1?part.length:0))/(field.total||1):0,scale:1};
 }
 function native(track:StrokeDisplayIntervals,s:number){const f=frame(track),v=f.origin+f.direction*s*f.scale;return path.closed&&track.scope!=='CURVE'?wrap(v):clamp(v);}
 function relative(track:StrokeDisplayIntervals,s:number){const f=frame(track),v=(s-f.origin)*f.direction/(f.scale||1);return path.closed&&track.scope!=='CURVE'?wrap(v):clamp(v);}
 function span(track:StrokeDisplayIntervals,r:DisplayInterval):InkSpan[]{
  const ends:InkEnds=(r.inkEnds??[{},{}]).map(e=>e.taperWidthScale===undefined?e:{...e,taper:inkTaperDistance(e,curveById(d,path.segments[0].id).width)}) as InkEnds;
  if(!path.closed||track.scope==='CURVE'){const a=native(track,r.start),b=native(track,r.end);return [{start:Math.min(a,b),end:Math.max(a,b),ends:a<=b?ends:[ends[1],ends[0]]}];}
  if(Math.abs(r.end-r.start)>=1-1e-10)return [{start:0,end:1,ends:[{},{}]}];
  const distance=wrap(r.end-r.start);if(distance<1e-10)return [];
  const forward=frame(track).direction===1,rawA=native(track,forward?r.start:r.end),ordered:InkEnds=forward?ends:[ends[1],ends[0]];
  // Use the same seam tolerance as union/subtraction. Otherwise floating-point
  // wrap arithmetic can split a real brush into a tiny fragment that is discarded.
  const a=rawA<1e-10||rawA>1-1e-10?0:rawA,rawB=a+distance,b=Math.abs(rawB-1)<1e-10?1:rawB;
  return b<=1?[{start:a,end:b,ends:ordered}]:[{start:a,end:1,ends:[ordered[0],{}]},{start:0,end:b-1,ends:[{},ordered[1]]}];
 }
 const ranges=tracks.flatMap(t=>t.ranges.filter(r=>r.enabled!==false).map(r=>({track:t,range:r}))),shown=ranges.filter(x=>x.track.scope!=='CURVE'&&intervalMode(x.range)==='SHOW'),hidden=ranges.filter(x=>intervalMode(x.range)==='HIDE');
 const localGaps=tracks.filter(t=>t.scope==='CURVE').flatMap(t=>{
  const shown=t.ranges.filter(r=>r.enabled!==false&&intervalMode(r)==='SHOW');
  return shown.length?subtractInkSpans(span(t,{id:'scope',start:0,end:1}),shown.flatMap(r=>span(t,r))):[];
 });
 const inkSpans=ranges.length?subtractInkSpans(shown.length?shown.flatMap(x=>span(x.track,x.range)):[{start:0,end:1,ends:[{},{}]}],[...hidden.flatMap(x=>span(x.track,x.range)),...localGaps],path.closed):undefined;
 const pinches:InkPinch[]=hidden.flatMap(({track,range})=>{
  const strength=intervalPinch(range),position=native(track,range.start);
  if(!strength||!inkSpans?.some(s=>position>=s.start-1e-10&&position<=s.end+1e-10))return [];
  const width=curveById(d,path.segments[0].id).width,ends=range.inkEnds??[{},{}],ordered=frame(track).direction===1?ends:[ends[1],ends[0]];
  return [{position,strength,tapers:ordered.map(e=>inkTaperDistance(e,width)) as [number,number]}];
 });
 return {...field,geometry,tracks,native,relative,inkSpans,pinches,mask:inkSpans?.map(s=>[s.start,s.end] as Span)};
}
/** Nearest arc-table point. A tiny continuity tie-break avoids jumping at crossings. */
export function nearestDisplayPosition(field:ReturnType<typeof displayField>,track:StrokeDisplayIntervals,p:Point2,previous:number,project?:(p:Point2,s:Cubic,t:number)=>Point2){
 let best=Infinity,result=previous;
 for(const [partIndex,part] of field.parts.entries())for(let i=1;i<part.pts.length;i++){
  if(track.scope==='CURVE'&&(field.geometry.pieces[partIndex].joinId||!field.geometry.pieces[partIndex].owners.includes(track.anchor.id)))continue;
  const a=project?project(part.pts[i-1].p,part.shape,part.pts[i-1].t):part.pts[i-1].p,b=project?project(part.pts[i].p,part.shape,part.pts[i].t):part.pts[i].p,v=sub(b,a),w=sub(p,a),den=v[0]*v[0]+v[1]*v[1],t=den?clamp((w[0]*v[0]+w[1]*v[1])/den):0;
  const distance=length([w[0]-v[0]*t,w[1]-v[1]*t]),s=field.relative(track,(part.start+part.dist[i-1]+(part.dist[i]-part.dist[i-1])*t)/(field.total||1)),tie=Math.abs(s-previous),score=distance+Math.min(tie,1-tie)*1e-8;
  if(score<best){best=score;result=s;}
 }
 return result;
}

/** An exact cubic split must preserve a curve-local mask across both children. */
export function splitDisplayIntervals(before:Doc,after:Doc,id:string,newId:string):Doc{
 if(!before.displayIntervals?.length)return after;
 const scoped=before.displayIntervals.some(t=>t.scope==='CURVE'&&t.anchor.id===id);
 const field=scoped?displayField(after,displayPath(after,id)):undefined;
 const size=(curve:string)=>field!.parts.reduce((sum,p,i)=>sum+(!field!.geometry.pieces[i].joinId&&field!.geometry.pieces[i].owners[0]===curve?p.length:0),0);
 const a=scoped?size(id):0,b=scoped?size(newId):0,cut=a/(a+b||1);
 return {...after,displayIntervals:before.displayIntervals.flatMap(originalTrack=>{
  const track=originalTrack.displayRoute?{...originalTrack,displayRoute:splitDisplayRoute(originalTrack.displayRoute,id,newId)}:originalTrack;
  if(track.anchor.id!==id)return [track];
  if(track.scope!=='CURVE')return [{...track,anchor:track.anchor.reverse?{id:newId,reverse:true}:track.anchor}];
  return ([{id,lo:0,hi:cut},{id:newId,lo:cut,hi:1}]).map((child,index)=>{
   const ranges=track.ranges.flatMap(r=>{
    const x=track.anchor.reverse?1-r.start:r.start,y=track.anchor.reverse?1-r.end:r.end,ends=r.inkEnds??[{},{}],ordered:InkEnds=x<=y?ends:[ends[1],ends[0]];
    const lo=Math.min(x,y),hi=Math.max(x,y),start=Math.max(lo,child.lo),end=Math.min(hi,child.hi),rangeId=index?uid():r.id;
    if(end<=start+1e-10)return intervalMode(r)==='SHOW'?[{...r,id:rangeId,start:0,end:0,inkEnds:[{},{}] as InkEnds}]:[];
    return [{...r,id:rangeId,start:(start-child.lo)/(child.hi-child.lo),end:(end-child.lo)/(child.hi-child.lo),inkEnds:[start===lo?ordered[0]:{},end===hi?ordered[1]:{}] as InkEnds}];
   });
   return {...track,id:index?uid():track.id,anchor:{id:child.id,reverse:false},ranges};
  }).filter(t=>t.ranges.length);
 })};
}
const check=(d:Doc,path:StrokePath)=>{if(path.segments.some(x=>!editable(d,x.id)))throw Error('关联对象已隐藏或锁定，无法修改。');};
export function addDisplayInterval(d:Doc,id:string,mode:DisplayIntervalMode='SHOW'):Doc{
 if(!['SHOW','HIDE'].includes(mode))throw Error('区间类型无效。');
 const path=displayPath(d,id);check(d,path);const existing=pathTracks(d,path).find(t=>!t.scope),r:DisplayInterval={id:uid(),mode,start:1/3,end:2/3,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]};
 return {...d,displayIntervals:existing?(d.displayIntervals??[]).map(t=>t.id===existing.id?{...t,ranges:[...t.ranges,r]}:t):[...(d.displayIntervals??[]),{id:uid(),anchor:{...path.segments[0]},ranges:[r]}]};
}
export function setDisplayIntervalEnd(d:Doc,trackId:string,id:string,end:0|1,change:InkEndStyle):Doc{
 const track=d.displayIntervals?.find(t=>t.id===trackId),range=track?.ranges.find(r=>r.id===id);if(!track||!range)return d;check(d,displayPath(d,track.anchor.id));
 const ends=range.inkEnds??[{},{}],inkEnds:InkEnds=[{...ends[0]},{...ends[1]}];inkEnds[end]={...inkEnds[end],...change};
 if(Object.hasOwn(change,'taper'))delete inkEnds[end].taperWidthScale;
 if(!validInkEnds(inkEnds))throw Error('收尖距离须为 0–5000 px，延伸距离须为 0–500 px。');
 if(JSON.stringify(inkEnds)===JSON.stringify(ends))return d;
 return {...d,displayIntervals:d.displayIntervals!.map(t=>t===track?{...t,ranges:t.ranges.map(r=>r===range?{...r,inkEnds}:r)}:t)};
}
export function changeDisplayInterval(d:Doc,trackId:string,id:string,change:Partial<Pick<DisplayInterval,'start'|'end'|'mode'|'enabled'>>):Doc{
 const track=d.displayIntervals?.find(t=>t.id===trackId);if(!track)return d;check(d,displayPath(d,track.anchor.id));
 if(change.mode!==undefined&&!['SHOW','HIDE'].includes(change.mode))throw Error('区间类型无效。');
 if(change.enabled!==undefined&&typeof change.enabled!=='boolean')throw Error('区间开关无效。');
 if(!(['start','end'] as const).every(k=>change[k]===undefined||Number.isFinite(change[k])&&change[k]!>=0&&change[k]!<=1))throw Error('显示区间位置必须在 0% 到 100% 之间。');
 const ranges=track.ranges.map(r=>r.id===id?{...r,...change}:r);if(JSON.stringify(ranges)===JSON.stringify(track.ranges))return d;
 return {...d,displayIntervals:d.displayIntervals!.map(t=>t===track?{...t,ranges}:t)};
}
export function removeDisplayInterval(d:Doc,trackId:string,id:string):Doc{
 const track=d.displayIntervals?.find(t=>t.id===trackId);if(!track)return d;check(d,displayPath(d,track.anchor.id));
 return {...d,displayIntervals:d.displayIntervals!.map(t=>t===track?{...t,ranges:t.ranges.filter(r=>r.id!==id)}:t).filter(t=>t.ranges.length)};
}
/** Deleting an anchor keeps appearance on the surviving path, never a dangling reference. */
export function retainDisplayIntervals(before:Doc,after:Doc):Doc{
 if(!before.displayIntervals?.length)return after;
 return {...after,displayIntervals:before.displayIntervals.flatMap(t=>{
  if(curveById(after,t.anchor.id))return [t];if(t.scope==='CURVE')return [];const path=displayPath(before,t.anchor.id),same=path.segments.find(x=>x.id===t.anchor.id)!.reverse===t.anchor.reverse;
  const remaining=(same?path.segments:[...path.segments].reverse().map(x=>({...x,reverse:!x.reverse}))).find(x=>curveById(after,x.id));
  return remaining?[{...t,anchor:{...remaining}}]:[];
 })};
}
