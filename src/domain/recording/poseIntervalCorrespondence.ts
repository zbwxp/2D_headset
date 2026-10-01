import {displayField,displayPath,intervalMode,closedIntervalLength} from '../drawing/displayIntervals';
import type {StrokePath} from '../drawing/strokes';
import type {DrawingDocument as Doc,StrokeDisplayIntervals as Track,DisplayInterval as Range,InkEnds} from '../drawing/model';
import {poseCoverageRanges} from './poseIntervalCoverage';

function pathKey(p:StrokePath){
 const order=(segments:StrokePath['segments'])=>{
  if(!p.closed)return JSON.stringify(segments.map(s=>[s.id,s.reverse]));
  const first=segments.reduce((best,s,i)=>s.id<segments[best].id?i:best,0);
  return JSON.stringify([...segments.slice(first),...segments.slice(0,first)].map(s=>[s.id,s.reverse]));
 };
 const reverse=[...p.segments].reverse().map(s=>({...s,reverse:!s.reverse}));
 return `${p.closed}:${[order(p.segments),order(reverse)].sort()[0]}`;
}
const rangeKey=(r:Range)=>JSON.stringify([r.id,intervalMode(r)]);
/** Rebase arc positions, never world positions. An open interval is unordered;
 * a closed interval is a directed circular span, including a full revolution. */
function rebase(d:Doc,path:StrokePath,track:Track,anchor:Track['anchor']):Range[]{
 const direction=(a:Track['anchor'])=>path.segments.find(s=>s.id===a.id)!.reverse===a.reverse;
 const sameDirection=direction(track.anchor)===direction(anchor);
 const sameFrame=track.anchor.id===anchor.id&&track.anchor.reverse===anchor.reverse;
 const closed=path.closed&&track.scope!=='CURVE',field=closed&&!sameFrame?displayField(d,path):undefined;
 const position=(s:number)=>sameFrame?s:field?field.relative({...track,anchor},field.native(track,s)):sameDirection?s:1-s;
 return track.ranges.map(r=>{
  const a=position(r.start),b=position(r.end);
  const reverse=closed?!sameDirection:a>b;
  const ends=r.inkEnds;
  const inkEnds=reverse&&ends?[ends[1],ends[0]] as InkEnds:ends;
  if(!closed)return {...r,start:Math.min(a,b),end:Math.max(a,b),inkEnds};
  if(r.fullLoop===true)return {...r,start:a,end:a,inkEnds};
  if(closedIntervalLength(r)===1)return {...r,start:0,end:1,inkEnds};
  return {...r,start:reverse?b:a,end:reverse?a:b,inkEnds};
 });
}
function spans(r:Range,closed:boolean):[number,number][]{
 if(!closed)return [[r.start,r.end]];
 const size=closedIntervalLength(r),end=r.start+size;
 return size>=1-1e-9?[[0,1]]:end<=1?[[r.start,end]]:[[r.start,1],[0,end-1]];
}
/** Overlap is a fallback only for recreated ranges. Stable IDs remain primary;
 * far-away or ambiguous ranges retain their genuine appearance/disappearance. */
function overlap(a:Range,b:Range,closed:boolean){
 const aa=spans(a,closed),bb=spans(b,closed);
 const intersection=aa.reduce((sum,[a,b])=>sum+bb.reduce((n,[c,d])=>n+Math.max(0,Math.min(b,d)-Math.max(a,c)),0),0);
 const size=(s:[number,number][])=>s.reduce((n,[a,b])=>n+b-a,0);
 const union=size(aa)+size(bb)-intersection;return union>1e-10?intersection/union:0;
}
function correspond(ranges:Range[][],closed:boolean){
 type Channel={keys:string[];id:string;mode:ReturnType<typeof intervalMode>;samples:Map<number,Range>};
 const keyed=new Map<string,Channel>();
 ranges.forEach((rs,i)=>rs.forEach(r=>{
  const key=rangeKey(r);let channel=keyed.get(key);
  if(!channel){channel={keys:[key],id:r.id,mode:intervalMode(r),samples:new Map()};keyed.set(key,channel);}
  channel.samples.set(i,r);
 }));
 let channels=[...keyed.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.mode.localeCompare(b.mode));
 for(;;){
  const candidates:{a:Channel;b:Channel;score:number}[]=[];
  for(let i=0;i<channels.length;i++)for(let j=i+1;j<channels.length;j++){
   const a=channels[i],b=channels[j];
   if(a.mode!==b.mode||[...a.samples.keys()].some(k=>b.samples.has(k)))continue;
   const score=Math.min(...[...a.samples.values()].flatMap(x=>[...b.samples.values()].map(y=>overlap(x,y,closed))));
   if(score>=.5)candidates.push({a,b,score});
  }
  candidates.sort((a,b)=>b.score-a.score||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id));
  const best=candidates.find(c=>!candidates.some(other=>{
   if(other===c||other.score<c.score-1e-9||![other.a,other.b].some(x=>x===c.a||x===c.b))return false;
   // A third pose can agree equally well with both: that is one compatible
   // channel, not ambiguity. Reject ties only between competing authored ranges.
   const extra=[other.a,other.b].find(x=>x!==c.a&&x!==c.b)!;
   return [...extra.samples.keys()].some(i=>c.a.samples.has(i)||c.b.samples.has(i));
  }));
  if(!best)break;
  best.a.keys.push(...best.b.keys);best.a.id=[best.a.id,best.b.id].sort()[0];
  best.b.samples.forEach((r,i)=>best.a.samples.set(i,r));channels=channels.filter(c=>c!==best.b);
 }
 const ids=new Map(channels.flatMap(c=>c.keys.map(k=>[k,c.id] as const)));
 return ranges.map(rs=>rs.map(r=>({...r,id:ids.get(rangeKey(r))!})));
}

// Correspondence depends only on immutable snapshots, not on yaw or weights.
// Cache it so rotating a view does not repeat matching or arc-table conversion.
const cache=new WeakMap<Doc,{drawings:Doc[];result:Doc[]}[]>();
export function alignPoseIntervalDrawings(drawings:Doc[]):Doc[]{
 if(!drawings.length)return drawings;
 const entries=cache.get(drawings[0])??[],hit=entries.find(e=>e.drawings.length===drawings.length&&e.drawings.every((d,i)=>d===drawings[i]));
 if(hit)return hit.result;
 const groups=new Map<string,{sample:number;track:Track;path:StrokePath}[]>();
 drawings.forEach((d,sample)=>{for(const track of d.displayIntervals??[]){
  const path=displayPath(d,track.anchor.id),key=track.scope==='CURVE'?`curve:${track.anchor.id}`:pathKey(path);
  groups.set(key,[...(groups.get(key)??[]),{sample,track,path}]);
 }});
 const replaced=drawings.map(()=>new Set<string>()),tracks:Track[][]=drawings.map(()=>[]);
 for(const [key,group] of groups){
  // Use an authored anchor so the recording evaluator's element coverage stays
  // authoritative. Do not guess correspondence across changed connectivity.
  const template=[...group].sort((a,b)=>a.track.id.localeCompare(b.track.id)||a.track.anchor.id.localeCompare(b.track.anchor.id)||Number(a.track.anchor.reverse)-Number(b.track.anchor.reverse))[0].track;
  if(template.scope!=='CURVE'&&drawings.some(d=>d.curves.some(c=>c.id===template.anchor.id)&&pathKey(displayPath(d,template.anchor.id))!==key))continue;
  const ranges:Range[][]=drawings.map(()=>[]);
  for(const g of group)ranges[g.sample].push(...rebase(drawings[g.sample],g.path,g.track,template.anchor));
  // Establish correspondence BEFORE choosing a coverage representation. Older
  // saves may have different IDs for the same range; an unambiguous overlap
  // matches those just like a stable ID. Converting first destroys this match
  // and invents extra channels even when both poses use the same SHOW/HIDE recipe.
  const closed=group[0].path.closed&&template.scope!=='CURVE';
  const authored=correspond(ranges,closed),recipe=authored[0].map(rangeKey).sort();
  const sameRecipe=authored.every(rs=>{const keys=rs.map(rangeKey).sort();return keys.length===recipe.length&&keys.every((k,i)=>k===recipe[i]);});
  // Different authoring recipes can describe the very same mask. Never blend
  // a disappearing HIDE and appearing SHOW independently: that reveals ink
  // which both source views hid. Compare coverage and its physical tips first.
  const mixed=new Set(ranges.flat().map(intervalMode)).size>1;
  const samples=new Set(group.map(g=>g.sample));
  // Full ink becoming several SHOW runs creates new gaps too. Give these the
  // same pinch-before-break transition as an equivalent authored HIDE range.
  const size=(r:Range)=>closed?closedIntervalLength(r):Math.abs(r.end-r.start);
  const fullSource=ranges.some(rs=>!rs.length||rs.some(r=>intervalMode(r)==='SHOW'&&size(r)>=1-1e-9)&&!rs.some(r=>intervalMode(r)==='HIDE'&&size(r)>1e-9));
  const opensGaps=fullSource&&ranges.some(rs=>rs.filter(r=>intervalMode(r)==='SHOW').length>1);
  // Explicit switches belong to authored ranges. Baking them into coverage
  // would discard their identity and turn a held switch into a growing gap.
  const switched=ranges.some(rs=>rs.some(r=>r.enabled!==undefined));
  const convertCoverage=!switched&&template.scope!=='CURVE'&&((mixed&&!sameRecipe)||opensGaps);
  if(convertCoverage)drawings.forEach((d,i)=>{
   if(!d.curves.some(c=>c.id===template.anchor.id))return;
   samples.add(i);ranges[i]=poseCoverageRanges(d,displayPath(d,template.anchor.id),{...template,ranges:ranges[i]},i);
  });
  const matched=convertCoverage?correspond(ranges,closed):authored;
  for(const sample of samples){
   group.filter(g=>g.sample===sample).forEach(g=>replaced[sample].add(g.track.id));
   tracks[sample].push({...template,ranges:matched[sample]});
  }
 }
 const result=drawings.map((d,i)=>({...d,displayIntervals:[...(d.displayIntervals??[]).filter(t=>!replaced[i].has(t.id)),...tracks[i]]}));
 if(entries.length>=16)entries.shift();entries.push({drawings:[...drawings],result});cache.set(drawings[0],entries);
 return result;
}
