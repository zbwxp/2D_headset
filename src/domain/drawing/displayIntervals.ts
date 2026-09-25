import {curveById,editable,uid,sub,length,validInkEnds,inkTaperDistance,type InkEnds,type InkEndStyle,type DrawingDocument as Doc,type StrokeDisplayIntervals,type DisplayInterval,type Point2} from './model';
import {strokeFor,strokePaths,type StrokePath} from './strokes';
import {derivedUses} from './roundedJoin';
import {arcField} from './sampling';
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
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const wrap=(x:number)=>((x%1)+1)%1;
export const displayPath=(d:Doc,id:string)=>strokePaths(strokeFor(d,id)).find(p=>p.segments.some(x=>x.id===id))!;
export const pathTracks=(d:Doc,path:StrokePath)=>(d.displayIntervals??[]).filter(t=>path.segments.some(x=>x.id===t.anchor.id));
export function unionSpans(spans:Span[]):Span[]{
 const out:Span[]=[];for(const [a,b] of spans.filter(([a,b])=>b-a>1e-10).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&a<=last[1]+1e-10)last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;
}
/** The saved anchor is only a stable coordinate frame; the interval grips are free arc positions. */
export function displayField(d:Doc,path:StrokePath){
 const geometry=derivedUses(d,path.segments,path.closed),field=arcField(geometry.shapes),tracks=pathTracks(d,path);
 function frame(track:StrokeDisplayIntervals){
  const use=path.segments.find(x=>x.id===track.anchor.id)!,direction=use.reverse===track.anchor.reverse?1:-1;
  if(!path.closed)return {direction,origin:direction===1?0:1};
  const i=geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===use.id),part=field.parts[i];
  return {direction,origin:part?(part.start+(direction===-1?part.length:0))/(field.total||1):0};
 }
 function native(track:StrokeDisplayIntervals,s:number){const f=frame(track),v=f.origin+f.direction*s;return path.closed?wrap(v):clamp(v);}
 function relative(track:StrokeDisplayIntervals,s:number){const f=frame(track),v=(s-f.origin)*f.direction;return path.closed?wrap(v):clamp(v);}
 function span(track:StrokeDisplayIntervals,r:DisplayInterval):InkSpan[]{
  const ends:InkEnds=(r.inkEnds??[{},{}]).map(e=>e.taperWidthScale===undefined?e:{...e,taper:inkTaperDistance(e,curveById(d,path.segments[0].id).width)}) as InkEnds;
  if(!path.closed){const a=native(track,r.start),b=native(track,r.end);return [{start:Math.min(a,b),end:Math.max(a,b),ends:a<=b?ends:[ends[1],ends[0]]}];}
  if(Math.abs(r.end-r.start)>=1-1e-10)return [{start:0,end:1,ends:[{},{}]}];
  const distance=wrap(r.end-r.start);if(distance<1e-10)return [];
  const forward=frame(track).direction===1,a=native(track,forward?r.start:r.end),b=a+distance,ordered:InkEnds=forward?ends:[ends[1],ends[0]];
  return b<=1?[{start:a,end:b,ends:ordered}]:[{start:a,end:1,ends:[ordered[0],{}]},{start:0,end:b-1,ends:[{},ordered[1]]}];
 }
 const inkSpans=tracks.length?unionInkSpans(tracks.flatMap(t=>t.ranges.flatMap(r=>span(t,r)))):undefined;
 return {...field,geometry,tracks,native,relative,inkSpans,mask:inkSpans?.map(s=>[s.start,s.end] as Span)};
}
/** Nearest arc-table point. A tiny continuity tie-break avoids jumping at crossings. */
export function nearestDisplayPosition(field:ReturnType<typeof displayField>,track:StrokeDisplayIntervals,p:Point2,previous:number){
 let best=Infinity,result=previous;
 for(const part of field.parts)for(let i=1;i<part.pts.length;i++){
  const a=part.pts[i-1].p,b=part.pts[i].p,v=sub(b,a),w=sub(p,a),den=v[0]*v[0]+v[1]*v[1],t=den?clamp((w[0]*v[0]+w[1]*v[1])/den):0;
  const distance=length([w[0]-v[0]*t,w[1]-v[1]*t]),s=field.relative(track,(part.start+part.dist[i-1]+(part.dist[i]-part.dist[i-1])*t)/(field.total||1)),tie=Math.abs(s-previous),score=distance+Math.min(tie,1-tie)*1e-8;
  if(score<best){best=score;result=s;}
 }
 return result;
}
const check=(d:Doc,path:StrokePath)=>{if(path.segments.some(x=>!editable(d,x.id)))throw Error('关联对象已隐藏或锁定，无法修改。');};
export function addDisplayInterval(d:Doc,id:string):Doc{
 const path=displayPath(d,id);check(d,path);const existing=pathTracks(d,path)[0],r:DisplayInterval={id:uid(),start:1/3,end:2/3,inkEnds:[{taperWidthScale:20},{taperWidthScale:20}]};
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
export function changeDisplayInterval(d:Doc,trackId:string,id:string,change:Partial<Pick<DisplayInterval,'start'|'end'>>):Doc{
 const track=d.displayIntervals?.find(t=>t.id===trackId);if(!track)return d;check(d,displayPath(d,track.anchor.id));
 if(!Object.values(change).every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('显示区间位置必须在 0% 到 100% 之间。');
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
  if(curveById(after,t.anchor.id))return [t];const path=displayPath(before,t.anchor.id),same=path.segments.find(x=>x.id===t.anchor.id)!.reverse===t.anchor.reverse;
  const remaining=(same?path.segments:[...path.segments].reverse().map(x=>({...x,reverse:!x.reverse}))).find(x=>curveById(after,x.id));
  return remaining?[{...t,anchor:{...remaining}}]:[];
 })};
}
