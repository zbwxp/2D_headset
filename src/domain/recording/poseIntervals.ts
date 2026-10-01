import {displayField,displayPath,intervalMode,closedIntervalLength} from '../drawing/displayIntervals';
import {strokeEnds} from '../drawing/appearance';
import {withIntervalPinch} from '../drawing/intervalPinch';
import {curveById,inkTaperDistance,type DisplayInterval,type DrawingDocument,type InkEnds,type StrokeDisplayIntervals} from '../drawing/model';
import {alignPoseIntervalDrawings} from './poseIntervalCorrespondence';

export const wrapUnit=(x:number)=>((x%1)+1)%1;
const delta=(x:number)=>x-Math.floor(x+.5);
const span=(r:DisplayInterval,closed:boolean)=>closed?closedIntervalLength(r):r.end-r.start;
const withoutFullLoop=(r:DisplayInterval):DisplayInterval=>{const {fullLoop:_,...rest}=r;return rest;};
/** One circular start plus a length preserves both full loops and empty intervals. */
export function blendInterval(samples:{range:DisplayInterval;weight:number;width:number}[],closed:boolean):DisplayInterval {
 const base=samples.reduce((a,b)=>a.weight>=b.weight?a:b).range;
 const start=samples.reduce((sum,s)=>sum+s.weight*(closed?base.start+delta(s.range.start-base.start):s.range.start),0);
 const length=samples.reduce((sum,s)=>sum+s.weight*span(s.range,closed),0);
 // A px distance and a width multiplier are alternate representations, not
 // independent channels. Mixing both leaves `taper` overriding the multiplier
 // and can even turn a 20× tip into zero as soon as interpolation starts.
 const ends:InkEnds=([0,1] as const).map(i=>{
  const styles=samples.map(s=>s.range.inkEnds?.[i]??{});
  return {
   ...(styles.some(e=>e.taper!==undefined||e.taperWidthScale!==undefined)?{taper:samples.reduce((sum,s,j)=>sum+s.weight*inkTaperDistance(styles[j],s.width),0)}:{}),
   ...(styles.some(e=>e.extension!==undefined)?{extension:samples.reduce((sum,s,j)=>sum+s.weight*(styles[j].extension??0),0)}:{}),
  };
 }) as InkEnds;
 const active=samples.filter(s=>s.weight>0),full=closed&&active.length>0&&active.every(s=>closedIntervalLength(s.range)===1),explicitFull=full&&active.some(s=>s.range.fullLoop===true);
 // Do not inherit a full-turn flag from the strongest sample into a partial
 // interpolation. Exact full loops retain their meaningful arbitrary anchor.
 return {...withoutFullLoop(base),start:closed?(full&&!explicitFull?0:wrapUnit(start)):start,end:closed?(full?explicitFull?wrapUnit(start):1:wrapUnit(start+length)):start+length,...(explicitFull?{fullLoop:true}:{}),inkEnds:ends};
}
/** A missing track means full ink, not absence. Divide full ink at gap midpoints:
 * the next pose opens those gaps instead of making the whole line pop away. */
function fullRanges(track:StrokeDisplayIntervals,closed:boolean,ends:InkEnds):DisplayInterval[] {
 const sorted=[...track.ranges].sort((a,b)=>a.start-b.start);
 if(sorted.length===1)return [{...withoutFullLoop(sorted[0]),start:0,end:1,inkEnds:closed?[{},{}]:ends}];
 return sorted.map((r,i)=>{
  const prev=sorted[(i+sorted.length-1)%sorted.length],next=sorted[(i+1)%sorted.length];
  const start=closed?wrapUnit(r.start-wrapUnit(r.start-prev.end)/2):i?(prev.end+r.start)/2:0;
  const end=closed?wrapUnit(r.end+wrapUnit(next.start-r.end)/2):i<sorted.length-1?(r.end+next.start)/2:1;
  return {...withoutFullLoop(r),start,end,inkEnds:[!closed&&i===0?ends[0]:{},!closed&&i===sorted.length-1?ends[1]:{}]};
 });
}
export function blendPoseIntervals(doc:DrawingDocument,samples:{drawing:DrawingDocument;weight:number}[],stateSample?:number):StrokeDisplayIntervals[] {
 const aligned=alignPoseIntervalDrawings(samples.map(s=>s.drawing));
 const stateDrawing=aligned[stateSample??samples.reduce((best,s,i)=>s.weight>samples[best].weight?i:best,0)];
 samples=samples.map((s,i)=>({...s,drawing:aligned[i]}));
 const templates=new Map<string,StrokeDisplayIntervals>();
 for(const s of samples)for(const track of s.drawing.displayIntervals??[])if(!templates.has(track.id))templates.set(track.id,track);
 return [...templates.values()].filter(t=>doc.curves.some(c=>c.id===t.anchor.id)).map(template=>{
  const path=displayPath(doc,template.anchor.id),closed=path.closed&&template.scope!=='CURVE';
  let pathLength:number|undefined;
  const relevant=samples.filter(s=>s.drawing.curves.some(c=>c.id===template.anchor.id)),total=relevant.reduce((n,s)=>n+s.weight,0);
  const tracks=relevant.map(s=>{
   const path=displayPath(s.drawing,template.anchor.id),outer=strokeEnds(s.drawing,path).map(e=>e.style) as InkEnds;
   const forward=path.segments.find(u=>u.id===template.anchor.id)!.reverse===template.anchor.reverse;
   return {state:s.drawing===stateDrawing,weight:s.weight/total,track:s.drawing.displayIntervals?.find(t=>t.id===template.id),width:curveById(s.drawing,path.segments[0].id).width,ends:path.closed?[{},{}] as InkEnds:forward?outer:[outer[1],outer[0]] as InkEnds};
  });
  // Keep positive and negative ranges separate. A missing gap is zero-length;
  // a pose without positive ranges means full ink. Mode changes use both
  // channels after coverage alignment, rather than flipping at the midpoint.
  const ranges=new Map<string,DisplayInterval>();
  for(const s of tracks)for(const r of s.track?.ranges??[])ranges.set(JSON.stringify([r.id,intervalMode(r)]),r);
  const all=[...ranges.values()],positive=all.filter(r=>intervalMode(r)==='SHOW');
  const full=tracks.map(s=>new Map(fullRanges({...template,ranges:positive},closed,s.ends).map(r=>[r.id,r])));
  return {...template,ranges:all.map(r=>{
   const mode=intervalMode(r),mid=template.revealFrom!==undefined?(template.revealFrom===0?1:0):closed?wrapUnit(r.start+span(r,true)/2):(r.start+r.end)/2;
   const exact=tracks.map(s=>s.track?.ranges.find(x=>x.id===r.id&&intervalMode(x)===mode));
   const present=tracks.flatMap((s,i)=>exact[i]&&span(exact[i]!,closed)>1e-10?[{range:exact[i]!,width:s.width,weight:s.weight}]:[]),presence=present.reduce((n,s)=>n+s.weight,0);
   // No gap is not a zero-length brush. Inherit a new gap's real tip style;
   // width-relative distances continue responding to the evaluated line width.
   const inherited:InkEnds=presence>1e-10?blendInterval(present.map(s=>({...s,weight:s.weight/presence})),closed).inkEnds!:[{},{}];
   for(const end of [0,1] as const)if(present.length&&present.every(s=>s.range.inkEnds?.[end].taper===undefined&&s.range.inkEnds?.[end].taperWidthScale!==undefined)){
    delete inherited[end].taper;inherited[end].taperWidthScale=present.reduce((n,s)=>n+s.weight*s.range.inkEnds![end].taperWidthScale!,0)/presence;
   }
   const blended=blendInterval(tracks.map((s,i)=>{
    const missing=mode==='HIDE'?{...withoutFullLoop(r),start:mid,end:mid,inkEnds:inherited}:s.track?.ranges.some(x=>intervalMode(x)==='SHOW')?{...withoutFullLoop(r),start:mid,end:mid}:full[i].get(r.id)!;
    const source=exact[i];
    return {weight:s.weight,width:s.width,range:source?(mode==='HIDE'&&span(source,closed)<1e-10?{...source,inkEnds:inherited}:source):missing};
   }),closed);
   if(exact.some(r=>r?.enabled!==undefined)){
    const state=exact[tracks.findIndex(s=>s.state)];
    blended.enabled=!!state&&state.enabled!==false;
   }
   let pinch=0;
   if(mode==='HIDE'&&template.scope!=='CURVE'&&presence>1e-10&&presence<1-1e-10){
    const atStart=!closed&&present.every(s=>s.range.start<1e-10),atEnd=!closed&&present.every(s=>s.range.end>1-1e-10);
    const tips=blended.inkEnds!,taper=(atStart?0:tips[0].taper??0)+(atEnd?0:tips[1].taper??0);
    if(taper>1e-10){
     pathLength??=displayField(doc,path).total;
     const length=span(blended,closed),targetLength=length/presence,phase=Math.min(.5,taper/(taper+targetLength*pathLength));
     const opening=Math.max(0,(presence-phase)/(1-phase)),size=targetLength*opening;
     const center=atStart?size/2:atEnd?1-size/2:blended.start+length/2;
     blended.start=closed?wrapUnit(center-size/2):center-size/2;blended.end=closed?wrapUnit(center+size/2):center+size/2;
     delete blended.fullLoop;
     if(presence<=phase){const q=presence/phase;pinch=q*q*(3-2*q);}
     for(const tip of tips)if(tip.extension!==undefined)tip.extension*=opening;
    }
   }
   // The same authored range can have different roles in two snapshots. Give
   // the two derived channels unique IDs without modifying either snapshot.
   const result=all.some(x=>x.id===r.id&&intervalMode(x)!==mode)?{...blended,id:`${template.id}:${r.id}:${mode}`}:blended;
   return withIntervalPinch(result,pinch);
  })};
 });
}
