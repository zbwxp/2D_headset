import {curveById,uid,type CurveUse,type DisplayInterval,type DrawingDocument as Doc,type InkEnds,type InkEndStyle,type StrokeDisplayIntervals} from './model';
import {localDisplayPath,intervalMode,type InkSpan} from './displayIntervals';
import type {StrokePath} from './strokes';
import {createDisplayRouteField,resolveDisplayRoute,captureRouteCoverage,remapRouteCoverage,type DisplayRoute,type DisplayRouteField,type RouteMaterialSpan} from './displayRoutes';
import {displayRouteInkSupport} from './displayRouteInk';
import {intervalPinch,withIntervalPinch} from './intervalPinch';
import {strokeEnds} from './appearance';

export interface AdoptDisplayRouteResult {document:Doc;route:DisplayRoute;generatedRangeIds:string[];affectedTrackIds:string[]}
export interface DetachDisplayRouteResult {document:Doc;generatedTrackIds:string[];generatedRangeIds:string[];affectedTrackIds:string[]}
const clonePath=(p:StrokePath):StrokePath=>({segments:p.segments.map(u=>({...u})),closed:p.closed});
const reverse=(p:StrokePath):StrokePath=>({segments:[...p.segments].reverse().map(u=>({...u,reverse:!u.reverse})),closed:p.closed});
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const wrap=(x:number)=>((x%1)+1)%1;
const pathKey=(p:StrokePath)=>JSON.stringify([p.closed,p.segments.map(u=>u.id).sort()]);
const fail=(message:string):never=>{throw new Error(message);};
function orientedSeed(path:StrokePath,anchor:CurveUse):StrokePath {
 let out=clonePath(path);if(out.segments.find(u=>u.id===anchor.id)?.reverse!==anchor.reverse)out=reverse(out);
 if(out.closed){const i=out.segments.findIndex(u=>u.id===anchor.id);out={...out,segments:[...out.segments.slice(i),...out.segments.slice(0,i)]};}
 return out;
}
function sourceField(d:Doc,track:StrokeDisplayIntervals):DisplayRouteField {
 return createDisplayRouteField(d,track.displayRoute??{seed:localDisplayPath(d,track.anchor.id),throughLinkIds:[]});
}
function nativePosition(field:DisplayRouteField,track:StrokeDisplayIntervals,s:number):number {
 if(track.displayRoute)return field.path.closed?wrap(s):clamp(s);
 const use=field.path.segments.find(u=>u.id===track.anchor.id);if(!use)return fail('区间锚定曲线不在原显示路径中。');
 const direction=use.reverse===track.anchor.reverse?1:-1;
 if(!field.path.closed)return direction===1?clamp(s):clamp(1-s);
 const i=field.geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===track.anchor.id),part=field.parts[i];if(!part)return fail('区间锚定曲线的材料位置已失效。');
 const origin=(part.start+(direction<0?part.length:0))/(field.total||1);return wrap(origin+direction*s);
}
/** Resolve one authored range independently of its enabled state and siblings.
 * Mode is deliberately preserved by the caller; disabled data is not discarded. */
function inheritedBrush(base:InkEndStyle,explicit:InkEndStyle):InkEndStyle {
 const brush={...base,...explicit};if(explicit.taperWidthScale!==undefined&&explicit.taper===undefined)delete brush.taper;return brush;
}
function rangeSpans(d:Doc,field:DisplayRouteField,track:StrokeDisplayIntervals,range:DisplayInterval):InkSpan[] {
 const ends:InkEnds=range.inkEnds?[{...range.inkEnds[0]},{...range.inkEnds[1]}]:[{},{}];
 if(!field.path.closed){
  const a=nativePosition(field,track,range.start),b=nativePosition(field,track,range.end),start=Math.min(a,b),end=Math.max(a,b),ordered:InkEnds=a<=b?ends:[ends[1],ends[0]];
  if(!track.displayRoute){const outer=strokeEnds(d,field.path);if(start<1e-10)ordered[0]=inheritedBrush(outer[0]?.style??{},ordered[0]);if(end>1-1e-10)ordered[1]=inheritedBrush(outer[1]?.style??{},ordered[1]);}
  return [{start,end,ends:ordered}];
 }
 if(Math.abs(range.end-range.start)>=1-1e-10)return [{start:0,end:1,ends:[{},{}]}];
 const size=wrap(range.end-range.start);if(size<1e-10)return [];
 const forward=track.displayRoute?true:field.path.segments.find(u=>u.id===track.anchor.id)!.reverse===track.anchor.reverse;
 let start=nativePosition(field,track,forward?range.start:range.end);if(start<1e-10||start>1-1e-10)start=0;
 let end=start+size;if(Math.abs(end-1)<1e-10)end=1;
 const ordered:InkEnds=forward?ends:[ends[1],ends[0]];
 return end<=1?[{start,end,ends:ordered}]:[{start,end:1,ends:[ordered[0],{}]},{start:0,end:end-1,ends:[{},ordered[1]]}];
}
function mapSpans(before:DisplayRouteField,after:DisplayRouteField,spans:InkSpan[]):InkSpan[] {
 const result=remapRouteCoverage(captureRouteCoverage(before,spans),after);
 if(result.unmapped.length)fail(`无法保持原显示材料范围：${result.unmapped[0].message} 请先预览并明确处理接笔影响区。`);
 return result.inkSpans;
}

/** Explicit one-transaction adoption. Old coordinates are first resolved in
 * their PRE-link frames, then every material fragment is mapped into one common
 * native route frame. Geometry, fills, widths and depth are never authored here.
 *
 * A visible ordinary SHOW range named 保留原可见范围 supplies an old implicit
 * full-ink base when another component introduces explicit SHOW coverage. There
 * is no hidden influence domain or automatic future branch search. */
export function adoptDisplayRoute(d:Doc,trackId:string,linkId:string):AdoptDisplayRouteResult {
 const chosen=d.displayIntervals?.find(t=>t.id===trackId);if(!chosen)return fail('显示区间轨道不存在。');
 if(chosen.scope==='CURVE')return fail('单曲线显示区间保留局部作用域，不能直接贯通为跨层路径。');
 const link=d.endpointLinks?.find(l=>l.id===linkId);if(!link)return fail('所选几何端点联动不存在。');
 const seed=chosen.displayRoute?.seed??orientedSeed(localDisplayPath(d,chosen.anchor.id),chosen.anchor);
 const linkIds=new Set([...(chosen.displayRoute?.throughLinkIds??[]),linkId]);
 const allTracks=d.displayIntervals??[],priorRoutes=new Map<string,DisplayRouteField>();
 for(const track of allTracks)if(track.displayRoute){const field=sourceField(d,track);if(field.diagnostics.length)return fail(field.diagnostics[0].message);priorRoutes.set(track.id,field);}
 // Existing explicit routed components on the other side are adopted intact.
 // Their link lists, rather than geometric proximity, establish continuation.
 const members=new Set(seed.segments.map(u=>u.id));let changed=true;
 while(changed){changed=false;
  for(const id of linkIds){const l=d.endpointLinks?.find(l=>l.id===id);if(!l)return fail('原显示路径引用的端点联动已删除。');for(const e of [l.a,l.b])for(const u of localDisplayPath(d,e.curveId).segments)if(!members.has(u.id)){members.add(u.id);changed=true;}}
  for(const track of allTracks){const field=priorRoutes.get(track.id);if(field&&field.path.segments.some(u=>members.has(u.id))){for(const u of field.path.segments)if(!members.has(u.id)){members.add(u.id);changed=true;}for(const id of track.displayRoute!.throughLinkIds)if(!linkIds.has(id)){linkIds.add(id);changed=true;}}}
 }
 const next:Doc={...d,endpointLinks:d.endpointLinks!.map(l=>linkIds.has(l.id)?{...l,throughDisplay:true}:l)},route:DisplayRoute={seed:clonePath(seed),throughLinkIds:[...linkIds]};
 const resolved=resolveDisplayRoute(next,route);if(resolved.diagnostics.length)return fail(resolved.diagnostics[0].message);
 const support=displayRouteInkSupport(next,route);if(support.length)return fail(support[0]);
 const target=createDisplayRouteField(next,resolved);if(target.diagnostics.length)return fail(target.diagnostics[0].message);
 const included=new Set(target.path.segments.map(u=>u.id));if([...included].some(id=>curveById(d,id).locked))return fail('贯通路径包含锁定成员，未修改任何内容。');
 const affected=allTracks.filter(t=>t.scope!=='CURVE'&&included.has(t.anchor.id)),affectedTrackIds=affected.map(t=>t.id),generatedRangeIds:string[]=[];
 const sourceFields=new Map(affected.map(t=>[t.id,priorRoutes.get(t.id)??sourceField(d,t)]));
 for(const [id,field] of sourceFields){if(field.diagnostics.length)return fail(field.diagnostics[0].message);if(field.path.segments.some(u=>!included.has(u.id)))return fail(`轨道 ${id} 的原路径不能完整包含在新贯通路径中。`);}
 const fresh=()=>{const id=uid();generatedRangeIds.push(id);return id;};
 const replacements=new Map<string,StrokeDisplayIntervals>();
 for(const track of affected){
  const field=sourceFields.get(track.id)!,ranges:DisplayInterval[]=[];
  for(const range of track.ranges){
   const spans=rangeSpans(d,field,track,range);
   if(!spans.length||spans.every(s=>s.end-s.start<1e-12)){
    const material=field.materialAt(nativePosition(field,track,range.start)),at=material&&target.positionOf(material);
    if(at===undefined)return fail('空显示范围的材料位置已被接笔替换，无法无损迁移。');
    ranges.push(withIntervalPinch({...range,start:at,end:at,inkEnds:range.inkEnds?[{...range.inkEnds[0]},{...range.inkEnds[1]}]:undefined},intervalPinch(range)));continue;
   }
   const mapped=mapSpans(field,target,spans);
   mapped.forEach((span,i)=>ranges.push(withIntervalPinch({...range,id:i?fresh():range.id,...(i?{originId:range.originId??range.id}:{}),start:span.start,end:span.end,inkEnds:[{...span.ends[0]},{...span.ends[1]}]},intervalPinch(range))));
  }
  replacements.set(track.id,{...track,displayRoute:{seed:clonePath(route.seed),throughLinkIds:[...route.throughLinkIds]},ranges});
 }
 // Source coordinate components partition the new route. A pre-existing routed
 // component is one old frame; untouched components retain their local frame.
 const components=new Map<string,{field:DisplayRouteField;trackIds:Set<string>}>(),covered=new Set<string>();
 for(const track of affected)if(track.displayRoute){
  const field=sourceFields.get(track.id)!,key=pathKey(field.path),entry=components.get(key)??{field,trackIds:new Set<string>()};entry.trackIds.add(track.id);components.set(key,entry);field.path.segments.forEach(u=>covered.add(u.id));
 }
 for(const use of target.path.segments){
  if(covered.has(use.id))continue;const path=localDisplayPath(d,use.id),key=pathKey(path);if(components.has(key))continue;
  if(path.segments.some(u=>!included.has(u.id)))return fail('新路径只包含原局部路径的一部分，不能自动重解释其显示区间。');
  components.set(key,{field:createDisplayRouteField(d,{seed:clonePath(path),throughLinkIds:[]}),trackIds:new Set(affected.filter(t=>!t.displayRoute&&path.segments.some(u=>u.id===t.anchor.id)).map(t=>t.id))});
 }
 const hasShow=affected.some(t=>t.ranges.some(r=>r.enabled!==false&&intervalMode(r)==='SHOW'));
 if(hasShow)for(const component of components.values()){
  const explicitShow=affected.some(t=>component.trackIds.has(t.id)&&t.ranges.some(r=>r.enabled!==false&&intervalMode(r)==='SHOW'));if(explicitShow)continue;
  const outer=component.field.path.closed?[]:strokeEnds(d,component.field.path),ends:InkEnds=outer.length?[{...outer[0].style},{...outer[1].style}]:[{},{}];
  const mapped=mapSpans(component.field,target,[{start:0,end:1,ends}]);
  for(const span of mapped)replacements.get(chosen.id)!.ranges.push({id:fresh(),name:'保留原可见范围',mode:'SHOW',start:span.start,end:span.end,inkEnds:[{...span.ends[0]},{...span.ends[1]}]});
 }
 return {document:{...next,displayIntervals:allTracks.map(t=>replacements.get(t.id)??t)},route,generatedRangeIds,affectedTrackIds};
}

/** Release the entire shared display route, retaining the geometric links and
 * their authored brushes. Material on a new cross-layer ARC has no local target
 * and requires an explicit author decision instead of being silently dropped. */
export function detachDisplayRoute(d:Doc,trackId:string):DetachDisplayRouteResult {
 const all=d.displayIntervals??[],chosen=all.find(t=>t.id===trackId);
 if(!chosen)return fail('显示区间轨道不存在。');
 if(!chosen.displayRoute)return {document:d,generatedTrackIds:[],generatedRangeIds:[],affectedTrackIds:[]};
 const base=sourceField(d,chosen);if(base.diagnostics.length)return fail(base.diagnostics[0].message);
 const ids=new Set(base.path.segments.map(u=>u.id)),affected:StrokeDisplayIntervals[]=[],sourceFields=new Map<string,DisplayRouteField>();
 for(const track of all){
  if(!track.displayRoute)continue;const field=sourceField(d,track);
  if(!field.path.segments.some(u=>ids.has(u.id)))continue;
  if(field.diagnostics.length)return fail(field.diagnostics[0].message);
  if(JSON.stringify(field.path)!==JSON.stringify(base.path))return fail('重叠的贯通路径方向或分支不同，不能自动解除其中一部分。');
  affected.push(track);sourceFields.set(track.id,field);
 }
 if([...ids].some(id=>curveById(d,id).locked))return fail('贯通路径包含锁定成员，未修改任何内容。');
 const targets=new Map<string,DisplayRouteField>();
 for(const id of ids){const path=localDisplayPath(d,id),key=pathKey(path);if(!targets.has(key)){if(path.segments.some(u=>!ids.has(u.id)))return fail('原局部路径超出当前贯通范围，不能自动解除。');const field=createDisplayRouteField(d,{seed:path,throughLinkIds:[]});if(field.diagnostics.length)return fail(field.diagnostics[0].message);targets.set(key,field);}}
 const generatedTrackIds:string[]=[],generatedRangeIds:string[]=[],newTracks:StrokeDisplayIntervals[]=[],replacements=new Map<string,StrokeDisplayIntervals[]>();
 const freshRange=()=>{const id=uid();generatedRangeIds.push(id);return id;};
 const freshTrack=()=>{const id=uid();generatedTrackIds.push(id);return id;};
 const noTarget=()=>fail('显示范围包含新的跨层接笔或已裁切材料，无法映回原局部路径；请先明确改为尖角笔触或撤销该接笔，再解除贯通。');
 for(const track of affected){
  const source=sourceFields.get(track.id)!,buckets=new Map<string,DisplayInterval[]>();
  // Prefer the original anchor's local component when retaining original IDs.
  const order=[...targets.keys()].sort((a,b)=>Number(!targets.get(a)!.path.segments.some(u=>u.id===track.anchor.id))-Number(!targets.get(b)!.path.segments.some(u=>u.id===track.anchor.id)));
  for(const range of track.ranges){
   const spans=rangeSpans(d,source,track,range),parts=new Map<string,RouteMaterialSpan[]>();
   if(!spans.length||spans.every(s=>s.end-s.start<1e-12)){
    const material=source.materialAt(nativePosition(source,track,range.start));if(!material)return noTarget();
    const key=order.find(key=>targets.get(key)!.positionOf(material)!==undefined);if(!key)return noTarget();const at=targets.get(key)!.positionOf(material)!;
    const list=buckets.get(key)??[];list.push(withIntervalPinch({...range,start:at,end:at,inkEnds:range.inkEnds?[{...range.inkEnds[0]},{...range.inkEnds[1]}]:undefined},intervalPinch(range)));buckets.set(key,list);continue;
   }
   for(const part of captureRouteCoverage(source,spans)){
    const key=order.find(key=>targets.get(key)!.positionOf(part.from)!==undefined&&targets.get(key)!.positionOf(part.to)!==undefined);if(!key)return noTarget();
    parts.set(key,[...(parts.get(key)??[]),part]);
   }
   let first=true;
   for(const key of order){const material=parts.get(key);if(!material?.length)continue;const result=remapRouteCoverage(material,targets.get(key)!);if(result.unmapped.length)return noTarget();
    const list=buckets.get(key)??[];
    for(const span of result.inkSpans){list.push(withIntervalPinch({...range,id:first?range.id:freshRange(),...(!first?{originId:range.originId??range.id}:{}),start:span.start,end:span.end,inkEnds:[{...span.ends[0]},{...span.ends[1]}]},intervalPinch(range)));first=false;}
    buckets.set(key,list);
   }
  }
  const tracks:StrokeDisplayIntervals[]=[];let first=true;
  for(const key of order){const ranges=buckets.get(key);if(!ranges?.length)continue;const field=targets.get(key)!;
   // Native local fractions use the first oriented piece as their new explicit
   // frame. Source material and brush sides are preserved even if IDs reorder.
   const {displayRoute:_,...plain}=track;
   tracks.push({...plain,id:first?track.id:freshTrack(),anchor:{...field.path.segments[0]},ranges});first=false;
  }
  if(!tracks.length)return noTarget();replacements.set(track.id,tracks);newTracks.push(...tracks);
 }
 // A global SHOW leaves every unshown component empty. Without an explicit
 // empty SHOW, detaching that component would incorrectly reveal implicit ink.
 const hasShow=affected.some(t=>t.ranges.some(r=>r.enabled!==false&&intervalMode(r)==='SHOW'));
 if(hasShow)for(const field of targets.values()){
  const localIds=new Set(field.path.segments.map(u=>u.id)),local=newTracks.filter(t=>localIds.has(t.anchor.id));
  if(local.some(t=>t.ranges.some(r=>r.enabled!==false&&intervalMode(r)==='SHOW')))continue;
  const empty:DisplayInterval={id:freshRange(),name:'保留原可见范围',mode:'SHOW',start:0,end:0,inkEnds:[{},{}]};
  if(local.length)local[0].ranges.push(empty);
  else{
   const created:StrokeDisplayIntervals={id:freshTrack(),anchor:{...field.path.segments[0]},ranges:[empty]};newTracks.push(created);replacements.get(chosen.id)!.push(created);
  }
 }
 const displayIntervals=all.flatMap(t=>replacements.get(t.id)??[t]),used=new Set(displayIntervals.flatMap(t=>t.displayRoute?.throughLinkIds??[])),released=new Set(affected.flatMap(t=>t.displayRoute!.throughLinkIds));
 const document:Doc={...d,displayIntervals,endpointLinks:d.endpointLinks?.map(l=>released.has(l.id)&&!used.has(l.id)?{...l,throughDisplay:false}:l)};
 return {document,generatedTrackIds,generatedRangeIds,affectedTrackIds:affected.map(t=>t.id)};
}
