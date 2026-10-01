import {curveById,inkTaperDistance,validInkEnds,type DrawingDocument,type StrokeDisplayIntervals,type DisplayInterval,type InkEndStyle} from '../drawing/model';
import {displayPath,intervalMode} from '../drawing/displayIntervals';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {blendPoseIntervals,wrapUnit} from '../recording/poseIntervals';

export interface IntervalOverrideSample {overrides?:readonly StrokeDisplayIntervals[];weight:number}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=1024;
function fail():never {throw new Error('Invalid vector recording interval appearance');}
const allowed=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));

/** Appearance payload validation; with source supplied, tracks cannot be created,
 * retargeted or change coordinate frames. Derived range IDs are allowed because
 * SHOW/HIDE interpolation can create transient appearance channels. */
export function validateIntervalOverrides(value:unknown,source?:DrawingDocument):asserts value is StrokeDisplayIntervals[]|undefined {
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>4096)fail();
 const tracks=new Map((source?.displayIntervals??[]).map(t=>[t.id,t])),seen=new Set<string>();
 const claim=(s:unknown)=>{if(!id(s)||seen.has(s))fail();seen.add(s);};
 for(const raw of value as unknown[]){
  if(!object(raw)||!allowed(raw,['id','anchor','ranges','scope','revealFrom','inferenceInkVersion','displayRoute']))fail();
  claim(raw.id);
  if(!object(raw.anchor)||!allowed(raw.anchor,['id','reverse'])||!id(raw.anchor.id)||typeof raw.anchor.reverse!=='boolean'||!Array.isArray(raw.ranges)||!raw.ranges.length||raw.ranges.length>4096)fail();
  if(raw.scope!==undefined&&raw.scope!=='CURVE'||raw.revealFrom!==undefined&&(raw.scope!=='CURVE'||![0,1].includes(raw.revealFrom as number))||raw.inferenceInkVersion!==undefined&&raw.inferenceInkVersion!==1)fail();
  if(raw.displayRoute!==undefined){const route=raw.displayRoute;if(!object(route)||!allowed(route,['seed','throughLinkIds'])||!object(route.seed)||!allowed(route.seed,['segments','closed'])||typeof route.seed.closed!=='boolean'||!Array.isArray(route.seed.segments)||!route.seed.segments.length||route.seed.segments.length>16384||route.seed.segments.some(u=>!object(u)||!allowed(u,['id','reverse'])||!id(u.id)||typeof u.reverse!=='boolean')||!Array.isArray(route.throughLinkIds)||!route.throughLinkIds.length||route.throughLinkIds.length>4096||route.throughLinkIds.some(x=>!id(x))||new Set(route.throughLinkIds).size!==route.throughLinkIds.length||raw.scope==='CURVE')fail();}
  if(source){const base=tracks.get(raw.id as string);if(!base||base.anchor.id!==raw.anchor.id||base.anchor.reverse!==raw.anchor.reverse||base.scope!==raw.scope||base.revealFrom!==raw.revealFrom||base.inferenceInkVersion!==raw.inferenceInkVersion||JSON.stringify(base.displayRoute)!==JSON.stringify(raw.displayRoute))fail();}
  for(const range of raw.ranges as unknown[]){
   if(!object(range)||!allowed(range,['id','start','end','mode','enabled','inkEnds','originId','name','fullLoop']))fail();claim(range.id);if(range.fullLoop!==undefined&&typeof range.fullLoop!=='boolean'||range.fullLoop&&(raw.scope==='CURVE'||source&&!displayPath(source,raw.anchor.id as string).closed))fail();if(range.originId!==undefined&&!id(range.originId)||range.name!==undefined&&(typeof range.name!=='string'||range.name.length>256))fail();
   if(![range.start,range.end].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1)||range.mode!==undefined&&!['SHOW','HIDE'].includes(range.mode as string)||range.enabled!==undefined&&typeof range.enabled!=='boolean'||!validInkEnds(range.inkEnds))fail();
  }
 }
}
function cloneRange(range:DisplayInterval):DisplayInterval{return withIntervalPinch(structuredClone(range),intervalPinch(range));}
/** Clone persisted appearance AND transient pinch strength. structuredClone alone
 * intentionally cannot copy the old renderer's WeakMap-based pinch metadata. */
export function cloneIntervalTracks(tracks:readonly StrokeDisplayIntervals[]):StrokeDisplayIntervals[]{
 return tracks.map(track=>({...structuredClone(track),ranges:track.ranges.map(cloneRange)}));
}
export function applyIntervalEnableFlags(tracks:readonly StrokeDisplayIntervals[],flags:Readonly<Record<string,boolean>>):StrokeDisplayIntervals[]{
 return tracks.map(track=>({...structuredClone(track),ranges:track.ranges.map(range=>withIntervalPinch({...structuredClone(range),...(flags[range.id]===undefined?{}:{enabled:flags[range.id]})},intervalPinch(range)))}));
}
function effective(source:DrawingDocument,overrides?:readonly StrokeDisplayIntervals[]):StrokeDisplayIntervals[]{
 validateIntervalOverrides(overrides,source);
 const byId=new Map((overrides??[]).map(track=>[track.id,track]));
 return (source.displayIntervals??[]).map(base=>({...base,ranges:byId.get(base.id)?.ranges??base.ranges}));
}
/** Replace a known track's complete appearance ranges. Source geometry, ownership,
 * canonical track frame and IDs are never edited; omitted tracks inherit source. */
export function applyIntervalOverrides(source:DrawingDocument,overrides?:readonly StrokeDisplayIntervals[]):DrawingDocument {
 if(!overrides?.length)return source;
 const displayIntervals=cloneIntervalTracks(effective(source,overrides));
 // Preserve Drawing's global ID uniqueness without parsing/rebuilding geometry.
 const used=new Set([...source.nodes,...source.curves,...source.fills,...source.offsets,...source.layers,...source.joins,...(source.groups??[]),...(source.endpointLinks??[])].map(x=>x.id));
 for(const track of displayIntervals)for(const value of [track.id,...track.ranges.map(r=>r.id)]){if(used.has(value))fail();used.add(value);}
 return {...source,displayIntervals};
}
function blendTrack(source:DrawingDocument,base:StrokeDisplayIntervals,samples:{track:StrokeDisplayIntervals;weight:number}[],stateSample?:number):StrokeDisplayIntervals {
 if(samples.length===1)return {...base,ranges:samples[0].track.ranges.map(cloneRange)};
 const first=samples[0].track,key=JSON.stringify(first.ranges);
 if(samples.every(s=>(s.track.ranges===first.ranges||JSON.stringify(s.track.ranges)===key)&&s.track.ranges.every((r,i)=>intervalPinch(r)===intervalPinch(first.ranges[i]))))return {...base,ranges:first.ranges.map(cloneRange)};
 // The legacy aligner merges multiple tracks on one stroke. Blend one canonical
 // track at a time so applying overrides cannot resurrect merged source tracks.
 const doc={...source,displayIntervals:[base]},result=blendPoseIntervals(doc,samples.map(s=>({drawing:{...source,displayIntervals:[s.track]},weight:s.weight})),stateSample);
 const ranges=result.flatMap(t=>t.ranges).map(cloneRange);
 return {...base,ranges};
}
/** Positive appearance blending, in SOURCE coordinates before Warp. Geometry uses
 * a separate signed X+Y-neutral rule; never apply negative weights to coverage. */
export function blendIntervalOverrides(source:DrawingDocument,samples:readonly IntervalOverrideSample[],stateSample?:number):StrokeDisplayIntervals[]{
 if(!samples.length)return cloneIntervalTracks(source.displayIntervals??[]);
 if(samples.some(s=>!Number.isFinite(s.weight)||s.weight<0)||stateSample!==undefined&&(!Number.isInteger(stateSample)||stateSample<0||stateSample>=samples.length))fail();
 const total=samples.reduce((sum,s)=>sum+s.weight,0);if(!Number.isFinite(total)||total<=0)fail();
 const maps=samples.map(s=>new Map(effective(source,s.overrides).map(t=>[t.id,t])));
 return (source.displayIntervals??[]).map(base=>blendTrack(source,base,samples.map((s,i)=>({track:maps[i].get(base.id)!,weight:s.weight/total})),stateSample));
}
function appearanceKey(source:DrawingDocument,track:StrokeDisplayIntervals):string {
 const path=displayPath(source,track.anchor.id),closed=path.closed&&track.scope!=='CURVE',width=curveById(source,path.segments[0].id).width;
 const number=(n:number)=>Number(n.toFixed(10));
 const tip=(e:InkEndStyle={})=>[e.taper!==undefined||e.taperWidthScale!==undefined,number(inkTaperDistance(e,width)),e.extension===undefined?null:number(e.extension),e.interior??false];
 return JSON.stringify(track.ranges.map(r=>{
  const reverse=!closed&&r.start>r.end,ends=r.inkEnds??[{},{}];
  const start=closed?r.fullLoop||Math.abs(r.end-r.start)>=1-1e-9?0:wrapUnit(r.start):Math.min(r.start,r.end),end=closed?r.fullLoop||Math.abs(r.end-r.start)>=1-1e-9?1:wrapUnit(r.end):Math.max(r.start,r.end);
  return [r.id,intervalMode(r),r.enabled!==false,number(start),number(end),tip(ends[reverse?1:0]),tip(ends[reverse?0:1]),number(intervalPinch(r))];
 }).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[1]).localeCompare(String(b[1]))));
}
/** Missing 2D corner policy, per canonical track: inherit an edit from its sole
 * changed axis without dilution. If BOTH axes changed that track, blend them
 * with positive |x|:|y| weights. Explicit 2D keys must bypass this helper. */
export function missingCornerIntervals(source:DrawingDocument,neutralOverrides:readonly StrokeDisplayIntervals[]|undefined,xOverrides:readonly StrokeDisplayIntervals[]|undefined,yOverrides:readonly StrokeDisplayIntervals[]|undefined,angle:{x:number;y:number}):StrokeDisplayIntervals[]{
 if(!Number.isFinite(angle.x)||!Number.isFinite(angle.y))fail();
 const neutral=new Map(effective(source,neutralOverrides).map(t=>[t.id,t])),x=new Map(effective(source,xOverrides).map(t=>[t.id,t])),y=new Map(effective(source,yOverrides).map(t=>[t.id,t]));
 return (source.displayIntervals??[]).map(base=>{
  const n=neutral.get(base.id)!,a=x.get(base.id)!,b=y.get(base.id)!,key=appearanceKey(source,n),hasX=appearanceKey(source,a)!==key,hasY=appearanceKey(source,b)!==key;
  if(!hasX&&!hasY)return {...base,ranges:n.ranges.map(cloneRange)};
  if(!hasY)return {...base,ranges:a.ranges.map(cloneRange)};
  if(!hasX)return {...base,ranges:b.ranges.map(cloneRange)};
  const wx=Math.abs(angle.x),wy=Math.abs(angle.y),total=wx+wy;
  return total?blendTrack(source,base,[{track:a,weight:wx/total},{track:b,weight:wy/total}]):{...base,ranges:n.ranges.map(cloneRange)};
 });
}
