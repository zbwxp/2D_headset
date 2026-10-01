import {effectiveTerminusBrush,renderTerminusBrush,geometryJoinBrush} from './terminusBrush';
import {copyCurveSource,curveSamples,tagExtension} from './curveProvenance';
import {boundEndpoint,objectVisible,add,sub,mul,length,curveById,nodeAt,inkTaperDistance,sameEnd,type Point2,type Cubic,type CurveUse,type DrawingDocument as Doc,type Profile,type OffsetRelation,type FillRegion,type InkEnds,type InkEndStyle,type Endpoint} from './model';
import {strokeFor,strokePaths,type Stroke,type StrokePath} from './strokes';
import {cuspCorner,cubicEndTangent} from './inkJoin';
import {derivedUses,partitionedUses,subcurve} from './roundedJoin';
import {displayField,pathTracks,type Span,type InkSpan} from './displayIntervals';
import {point,arcField,type ArcSampling} from './sampling';
import {InputCache} from '../geometry/cache';
import type {InkPinch} from './intervalPinch';
export {point,samples,arcField} from './sampling';
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export function profileAt(profile:Profile,s:number,reverse=false){
 s=Math.max(0,Math.min(1,reverse?1-s:s));
 if(profile==='UNIFORM')return 1;
 if(profile==='TAPER_END')return 1-smooth((s-.55)/.45);
 if(profile==='TAPER_BOTH')return Math.pow(Math.sin(Math.PI*s),.7);
 // Thin inner corner, heavier outer third, pointed tail.
 return s<.76?.12+1.58*smooth(s/.76):1.7*(1-smooth((s-.76)/.24));
}
export const resolveUses=derivedUses;
/** Boundary visibility is ink-only; whole-stroke hiding is an explicit separate action. */
export const fillVisible=(d:Doc,f:FillRegion)=>objectVisible(d,f.id)&&!!f.boundary.length&&f.boundary.every(x=>!!curveById(d,x.id));
export function fillGeometry(d:Doc,f:FillRegion){return resolveUses(d,f.boundary,true);}
export function pathOf(shapes:Cubic[],project:(p:Point2)=>Point2=p=>p,closed=false){return shapes.map((s,i)=>{const p=s.map(project);return `${i?'':`M ${p[0]} `}C ${p[1]} ${p[2]} ${p[3]}`;}).join(' ')+(closed?' Z':'');}
export interface InkFragment {pieceIndex:number;jointWith?:number;outline:Point2[];shapes:Cubic[];tips:Point2[][]}
export interface InkRun {fragments?:InkFragment[];shapes:Cubic[];outline:Point2[];uniform:boolean;closed:boolean;tips:Point2[][];clipped?:boolean;extensions?:{shape:Cubic;pieceIndex:number}[]}
export function defaultTaperDistances(profile:Profile,reverse:boolean,total:number):[number,number]{
 const v:[number,number]=profile==='TAPER_END'?[0,total*.45]:profile==='TAPER_BOTH'?[total*.5,total*.5]:profile==='EYELID'?[0,total*.24]:[0,0];return reverse?[v[1],v[0]]:v;
}
/** Resolve the visible taper, including short-stroke fitting, before blending poses. */
export function outerTaperDistances(ends:InkEnds,width:number,total:number,profile:Profile='UNIFORM',reverse=false):[number,number]{
 const defaults=defaultTaperDistances(profile,reverse,total),tapers=ends.map((e,i)=>inkTaperDistance(e,width,defaults[i]));
 const auto=ends.map(e=>e.taper===undefined&&e.taperWidthScale!==undefined),fixed=tapers.reduce((sum,v,i)=>sum+(auto[i]?0:v),0),autoLength=tapers.reduce((sum,v,i)=>sum+(auto[i]?v:0),0),autoFit=Math.min(1,Math.max(0,total-fixed)/(autoLength||1));
 return tapers.map((v,i)=>auto[i]?v*autoFit:v) as [number,number];
}
export function inkTips(shapes:Cubic[],ends:InkEnds=[{},{}]){
 if(!shapes.length)return [];
 return ([0,1] as const).map(end=>{const tip=renderTerminusBrush(end?shapes.at(-1)!:shapes[0],end,ends[end]);return {base:tip.support,direction:tip.direction,point:tip.point,end};});
}
/** Straight tangent extensions belong to ink, never to raw boundary geometry. */
export function extendedInk(shapes:Cubic[],ends:InkEnds=[{},{}]){
 const tips=inkTips(shapes,ends),out=[...shapes],indices=shapes.map((_,i)=>i),extensions:{shape:Cubic;end:0|1}[]=[];
 for(const tip of tips){if(length(sub(tip.point,tip.base))<1e-10)continue;const a=tip.end?tip.base:tip.point,b=tip.end?tip.point:tip.base,v=sub(b,a),shape:Cubic=[a,add(a,mul(v,1/3)),add(a,mul(v,2/3)),b];tagExtension(shape,shapes[tip.end?shapes.length-1:0],tip.end);extensions.push({shape,end:tip.end});if(tip.end){out.push(shape);indices.push(shapes.length-1);}else{out.unshift(shape);indices.unshift(0);}}
 return {shapes:out,indices,tips,extensions};
}
export function strokeEnds(d:Doc,s:StrokePath){
 if(s.closed||!s.segments.length)return [];
 const first=s.segments[0],last=s.segments.at(-1)!,endpoints:Endpoint[]=[{curveId:first.id,end:first.reverse?1:0},{curveId:last.id,end:last.reverse?0:1}];
 return endpoints.map(endpoint=>{const stored=curveById(d,endpoint.curveId).inkEnds?.[endpoint.end]??{};return {endpoint,style:effectiveTerminusBrush(stored,boundEndpoint(d,endpoint))};});
}
/** Shared by controls, picking and keyboard edits. ARC ends use the visible
 * trimmed source and its tangent rather than the hidden sharp control corner. */
export function inkEndpointInfo(d:Doc,id:string,end:0|1){
 const curve=curveById(d,id),offset=d.offsets.find(o=>o.id===id);if(!curve&&!offset)return undefined;
 const path=curve?strokePaths(strokeFor(d,id)).find(p=>p.segments.some(x=>x.id===id)):undefined;
 const outer=path?strokeEnds(d,path):[],index=path?outer.findIndex(e=>sameEnd(e.endpoint,{curveId:id,end})):end,interior=!!path&&(index<0||boundEndpoint(d,{curveId:id,end}));
 const stored=(curve??offset!).inkEnds?.[end]??{},enabled=!interior||stored.interior===true,style=enabled?stored:{};
 const pathGeometry=path?derivedUses(d,path.segments,path.closed):undefined,g=pathGeometry??offsetGeometry(d,offset!);
 if(interior){const use=path!.segments.find(x=>x.id===id)!,piece=pathGeometry!.pieces.find(p=>!p.joinId&&p.owners[0]===id);
  const shape=piece&&(use.reverse?[...piece.shape].reverse() as Cubic:piece.shape),ends:InkEnds=[{},{}];ends[end]=style;
  return {interior,enabled,style,tip:shape?inkTips([shape],ends)[end]:undefined,error:g.error};
 }
 const ends=path?outer.map(e=>e.style) as InkEnds:offset!.inkEnds;
 return {interior,enabled,style,tip:inkTips(g.shapes,ends)[index],error:g.error};
}
/** Width progress spans the whole chain, even where a segment's ink is disabled. */
/** Display-only accuracy. Geometry operations keep their original arc tables. */
export interface InkProjection {point:(p:Point2,shape?:Cubic,t?:number)=>Point2;shapes:(s:Cubic[])=>Cubic[]}
export interface InkSampling extends ArcSampling {taperSteps:number;nativeUniform?:boolean;projection?:InkProjection}
export function displayInkSampling(pixelsPerUnit:number):InkSampling{
 // Quantized zoom buckets reuse geometry while panning/zooming. At least the
 // nominal 250 px/unit is retained; larger views automatically refine sampling.
 const scale=250*2**Math.max(0,Math.ceil(Math.log2(Math.max(250,pixelsPerUnit)/250)));
 return {tolerance:.05/scale,maxStep:1/16,taperSteps:Math.ceil(12*Math.sqrt(scale/250)),nativeUniform:true};
}
const inkCache=new InputCache<InkRun[]>(128);
const projectedInkCaches=new WeakMap<InkProjection,InputCache<InkRun[]>>();
export function inkRuns(shapes:Cubic[],width:number,profile:Profile,reverse=false,enabled=shapes.map(()=>true),closed=false,ends:InkEnds=[{},{}],sharpAfter:number[]=[],mask?:Span[],cuts?:InkSpan[],interiorEnds?:Array<InkEnds|undefined>,partition=false,sampling?:InkSampling,intervalPinches:InkPinch[]=[]):InkRun[]{
 // Pointer/selection changes and edits to another stroke must not resample this ink.
 // Include every geometric/appearance input, including interval endpoint styles.
 const key=JSON.stringify([shapes,width,profile,reverse,enabled,closed,ends,sharpAfter,mask,cuts,interiorEnds,partition,sampling,intervalPinches,sampling?.projection?shapes.map(s=>[curveSamples(s,0),curveSamples(s,1)]):undefined]);
 let cache=inkCache;if(sampling?.projection){const p=sampling.projection;cache=projectedInkCaches.get(p)??new InputCache<InkRun[]>(128);projectedInkCaches.set(p,cache);}
 const cached=cache.get(key);if(cached)return cached;
 // Detach source points: command drafts can mutate nodes/handles in place, and a
 // cached result must remain valid if a later Undo requests the original shape.
 const snapshot=shapes.map(s=>copyCurveSource(s,s.map(p=>[...p]) as Cubic));
 return cache.set(key,buildInkRuns(snapshot,width,profile,reverse,enabled,closed,ends,sharpAfter,mask,cuts,interiorEnds,partition,sampling,intervalPinches));
}
function buildInkRuns(shapes:Cubic[],width:number,profile:Profile,reverse:boolean,enabled:boolean[],closed:boolean,ends:InkEnds,sharpAfter:number[],mask?:Span[],cuts?:InkSpan[],interiorEnds?:Array<InkEnds|undefined>,partition=false,sampling?:InkSampling,intervalPinches:InkPinch[]=[]):InkRun[]{
 if(!shapes.length)return [];
 const project=sampling?.projection?.point??((p:Point2)=>p),projectShapes=sampling?.projection?.shapes??((s:Cubic[])=>s);
 const projectedCorner=(a:Cubic,b:Cubic,h0:number,h1=h0)=>cuspCorner(projectShapes([a]).at(-1)!,projectShapes([b])[0],h0,h1);
 const baseLength=mask?arcField(shapes).total:0;let extensionStart=0,sourceIndices=shapes.map((_,i)=>i);
 if(closed){profile='UNIFORM';ends=[{},{}];}
 else{ends=[{...ends[0]},{...ends[1]}];if(cuts?.some(c=>c.start<1e-10&&c.ends[0].extension!==undefined))ends[0].extension=0;if(cuts?.some(c=>c.end>1-1e-10&&c.ends[1].extension!==undefined))ends[1].extension=0;const ext=extendedInk(shapes,ends);extensionStart=ext.extensions.find(x=>x.end===0)?ends[0].extension??0:0;if(ext.extensions.some(x=>x.end===0)){sharpAfter=sharpAfter.map(i=>i+1);if(interiorEnds)interiorEnds=[undefined,...interiorEnds];}if(ext.extensions.some(x=>x.end===1)&&interiorEnds)interiorEnds=[...interiorEnds,undefined];enabled=ext.indices.map(i=>enabled[i]);sourceIndices=ext.indices;shapes=ext.shapes;}
 const field=arcField(shapes),steps=sampling?.taperSteps??24,tapers=outerTaperDistances(ends,width,field.total,profile,reverse);
 // A zero-valued opt-in leaves the old continuous ink byte-for-byte unchanged.
 const localStyle=(index:number,end:0|1):InkEndStyle|undefined=>{
  const e=interiorEnds?.[index]?.[end];if(!e?.interior||!(inkTaperDistance(e,width)>0||(e.extension??0)>0))return undefined;
  return {...e,taper:Math.min(inkTaperDistance(e,width),field.parts[index].length+(e.extension??0))};
 };
 const breakBetween=(a:number,b:number)=>!!(localStyle(a,1)||localStyle(b,0));
 const junctions=sharpAfter.flatMap(i=>{const next=(i+1)%shapes.length;if(!shapes[i]||!enabled[i]||!enabled[next]||next===0&&!closed)return [];
  if(breakBetween(i,next))return [];
  const part=field.parts[i],d=part.start+part.length,pinch=projectedCorner(shapes[i],shapes[next],1).pinch,radius=Math.min(width*1.5,part.length/3,field.parts[next].length/3);
  return [{i,next,d,pinch,radius}];});
 const pinches=junctions.filter(j=>j.pinch&&j.radius>1e-10);
 const widthAt=(distance:number,skipStart=false,skipEnd=false)=>{
  const s=distance/(field.total||1),q=reverse?1-s:s,body=profile==='EYELID'?.12+1.58*smooth(Math.min(q,.76)/.76):1;
  const ramp=(v:number)=>profile==='TAPER_BOTH'?Math.pow(Math.sin(Math.PI/2*Math.max(0,Math.min(1,v))),.7):smooth(v);
  const tipFactor=pinches.reduce((value,j)=>{let gap=Math.abs(distance-j.d);if(closed)gap=Math.min(gap,field.total-gap);return value*smooth(gap/j.radius);},1);
  const gapFactor=intervalPinches.reduce((value,p)=>{
   let offset=distance-extensionStart-p.position*baseLength;
   if(closed)offset-=Math.floor(offset/(field.total||1)+.5)*field.total;
   const taper=p.tapers[offset<0?0:1],ramp=taper>0?smooth(Math.abs(offset)/taper):Math.abs(offset)<1e-10?0:1;
   return value*(1-p.strength*(1-ramp));
  },1);
  return body*(!skipStart&&tapers[0]>0?ramp(distance/tapers[0]):1)*(!skipEnd&&tapers[1]>0?ramp((field.total-distance)/tapers[1]):1)*tipFactor*gapFactor;
 };
 // Explicit samples within each taper keep short tips accurate on long, straight cubics.
 const supports:number[]=[];for(let e=0;e<2;e++)if(tapers[e]>0)for(let i=0;i<=steps;i++){const x=tapers[e]*i/steps,d=e?field.total-x:x;if(d>=0&&d<=field.total)supports.push(d);}
 for(const j of pinches)for(let k=-steps;k<=steps;k++){let d=j.d+j.radius*k/steps;if(closed)d=(d+field.total)%field.total;if(d>=0&&d<=field.total)supports.push(d);}
 for(const p of intervalPinches)for(const side of [0,1] as const)for(let i=0;i<=steps;i++){
  let d=extensionStart+p.position*baseLength+(side?1:-1)*Math.min(p.tapers[side],field.total)*i/steps;
  if(closed)d=((d%field.total)+field.total)%field.total;
  if(d>=0&&d<=field.total)supports.push(d);
 }
 // Crop the ink after measuring the original whole stroke: profile/taper never restart.
 const allowed:Span[]=mask?mask.map(([a,b])=>[a<=1e-10?0:extensionStart+a*baseLength,b>=1-1e-10?field.total:extensionStart+b*baseLength]):[[0,field.total]];
 type Piece={index:number;lo:number;hi:number;shape:Cubic};
 const groups:Piece[][]=[];
 const parameter=(part:typeof field.parts[number],distance:number)=>{
  const d=Math.max(0,Math.min(part.length,distance));let i=1;while(i<part.dist.length-1&&part.dist[i]<d)i++;
  const t=(d-part.dist[i-1])/(part.dist[i]-part.dist[i-1]||1);return part.pts[i-1].t+(part.pts[i].t-part.pts[i-1].t)*t;
 };
 for(let index=0;index<field.parts.length;index++){
  if(!enabled[index])continue;const part=field.parts[index];
  for(const [a,b] of allowed){const lo=Math.max(part.start,a),hi=Math.min(part.start+part.length,b);if(hi-lo<=1e-12)continue;
   const piece={index,lo,hi,shape:subcurve(part.shape,parameter(part,lo-part.start),parameter(part,hi-part.start))},last=groups.at(-1),previous=last?.at(-1);
   if(previous&&Math.abs(previous.hi-lo)<1e-10&&(previous.index===index||!breakBetween(previous.index,index)))last!.push(piece);else groups.push([piece]);
  }
 }
 if(closed&&groups.length>1&&!breakBetween(shapes.length-1,0)&&groups[0][0].lo<1e-10&&Math.abs(groups.at(-1)!.at(-1)!.hi-field.total)<1e-10)groups[0]=[...groups.pop()!,...groups[0]];
 return groups.map(group=>{
  const first=group[0],last=group.at(-1)!,bodyLength=group.reduce((sum,p)=>sum+p.hi-p.lo,0),complete=bodyLength>=field.total-1e-10;
  const insideStart=Math.abs(first.lo-field.parts[first.index].start)<1e-10?localStyle(first.index,0):undefined,insideEnd=Math.abs(last.hi-field.parts[last.index].start-field.parts[last.index].length)<1e-10?localStyle(last.index,1):undefined;
  const runClosed=closed&&complete&&!insideStart&&!insideEnd;
  const intervalStart=cuts?.find(c=>Math.abs((c.start<1e-10?0:extensionStart+c.start*baseLength)-first.lo)<1e-9)?.ends[0],intervalEnd=cuts?.find(c=>Math.abs((c.end>1-1e-10?field.total:extensionStart+c.end*baseLength)-last.hi)<1e-9)?.ends[1];
  const explicit=(e:InkEndStyle|undefined)=>e&&(e.taper!==undefined||e.taperWidthScale!==undefined||e.extension!==undefined)?e:undefined;
  const localEnds:InkEnds=runClosed?[{},{}]:[explicit(intervalStart)??insideStart??{},explicit(intervalEnd)??insideEnd??{}];
  const ext=extendedInk(group.map(p=>p.shape),localEnds),startExtension=localEnds[0].extension??0,endExtension=localEnds[1].extension??0,localLength=bodyLength+startExtension+endExtension;
  const overrideStart=first.lo<1e-10&&(localEnds[0].taper!==undefined||localEnds[0].extension!==undefined),overrideEnd=last.hi>field.total-1e-10&&(localEnds[1].taper!==undefined||localEnds[1].extension!==undefined);
  const localTapers=[localEnds[0].taper??(overrideStart?tapers[0]:0),localEnds[1].taper??(overrideEnd?tapers[1]:0)];
  // Interval tips retain their authored distance. When a visible fragment gets
  // shorter, the two ramps overlap and thin it instead of leaving a thick nub.
  const fit=Math.min(1,localLength/(localTapers[0]+localTapers[1]||1));
  localTapers.forEach((v,i)=>{if(!explicit(i?intervalEnd:intervalStart))localTapers[i]=v*fit;});
  const localWidth=(d:number,s:number)=>widthAt(d,overrideStart,overrideEnd)*(localTapers[0]>0?smooth(s/localTapers[0]):1)*(localTapers[1]>0?smooth((localLength-s)/localTapers[1]):1);
  const uniform=profile==='UNIFORM'&&(overrideStart||tapers[0]===0)&&(overrideEnd||tapers[1]===0)&&localTapers.every(x=>x===0)&&!pinches.length&&!intervalPinches.length;
  const visibleCorners=junctions.filter(j=>!j.pinch&&group.some(p=>p.index===j.i&&Math.abs(p.hi-j.d)<1e-10)&&group.some(p=>p.index===j.next&&Math.abs(p.lo-(j.next===0?0:j.d))<1e-10));
  // Native cubic strokes need neither a sampled polygon nor its per-vertex
  // normals. Raster mist and depth fragments explicitly request the outline.
  if(uniform&&sampling?.nativeUniform&&!partition)return {shapes:projectShapes(ext.shapes),outline:[],uniform:true,closed:runClosed,clipped:mask!==undefined&&!complete,
   tips:visibleCorners.map(j=>projectedCorner(shapes[j.i],shapes[j.next],width*.5,width*.5).tip).filter(t=>t.length),
   ...(ext.extensions.length?{extensions:ext.extensions.map(e=>({shape:e.shape,pieceIndex:sourceIndices[e.end?last.index:first.index]}))}:{})};
  const samples:{p:Point2;d:number;s:number;shape?:Cubic;t?:number}[]=[];let offset=startExtension;
  for(const piece of group){const part=field.parts[piece.index],pts=part.renderSamples(sampling).map(q=>({p:q.p,t:q.t,shape:part.shape,d:part.start+q.distance})).filter(q=>q.d>piece.lo+1e-12&&q.d<piece.hi-1e-12);
   pts.push({p:piece.shape[0],shape:piece.shape,t:0,d:piece.lo},{p:piece.shape[3],shape:piece.shape,t:1,d:piece.hi});
   for(const d of supports)if(d>piece.lo&&d<piece.hi)pts.push({...field.at(d/(field.total||1)),d});pts.sort((a,b)=>a.d-b.d);
   pts.forEach(q=>samples.push({...q,s:offset+q.d-piece.lo}));offset+=piece.hi-piece.lo;
  }
  const atLocal=(s:number)=>{
   if(s<startExtension)return {s,d:first.lo,p:add(ext.tips[0].point,mul(ext.tips[0].direction,-s)),shape:ext.shapes[0],t:s/startExtension};
   if(s>startExtension+bodyLength)return {s,d:last.hi,p:add(ext.tips[1].base,mul(ext.tips[1].direction,s-startExtension-bodyLength)),shape:ext.shapes.at(-1),t:(s-startExtension-bodyLength)/endExtension};
   let distance=s-startExtension;for(const p of group){if(distance<=p.hi-p.lo+1e-10){const d=Math.min(p.hi,p.lo+distance);return {s,d,...field.at(d/(field.total||1))};}distance-=p.hi-p.lo;}return {s,d:last.hi,p:last.shape[3],shape:last.shape,t:1};
  };
  for(let e=0;e<2;e++)if(localTapers[e]>0)for(let i=0;i<=steps;i++){const distance=Math.min(localTapers[e],localLength)*i/steps;samples.push(atLocal(e?localLength-distance:distance));}
  if(startExtension>0)samples.push(atLocal(0));if(endExtension>0)samples.push(atLocal(localLength));samples.sort((a,b)=>a.s-b.s);
  const localAt=(index:number,d:number)=>startExtension+group.slice(0,group.findIndex(p=>p.index===index&&d<=p.hi+1e-10)).reduce((sum,p)=>sum+p.hi-p.lo,0)+d-group.find(p=>p.index===index&&d<=p.hi+1e-10)!.lo;
  const corners=visibleCorners.map(j=>{
   const nextDistance=j.next===0?0:j.d,s=localAt(j.i,j.d),h0=width*.5*localWidth(j.d,s),h1=width*.5*localWidth(nextDistance,localAt(j.next,nextDistance));
   const before=projectShapes([shapes[j.i]]).at(-1)!,after=projectShapes([shapes[j.next]])[0],a=cubicEndTangent(before,1),b=cubicEndTangent(after,0),p=before[3];
   return {s,tip:projectedCorner(shapes[j.i],shapes[j.next],h0,h1).tip,outerLeft:a[0]*b[1]-a[1]*b[0]<0,
    left:[add(p,mul([-a[1],a[0]],h0)),add(p,mul([-b[1],b[0]],h1))],right:[add(p,mul([a[1],-a[0]],h0)),add(p,mul([b[1],-b[0]],h1))]};
  }).filter(j=>j.tip.length);
  const points:{p:Point2;half:number;s:number}[]=[];for(const q of samples){const p=project(q.p,q.shape,q.t);if(points.length&&length(sub(points.at(-1)!.p,p))<1e-12)continue;points.push({p,half:width*.5*localWidth(q.d,q.s),s:q.s});}
  const left:Point2[]=[],right:Point2[]=[],sections:{left:Point2[];right:Point2[];corner?:typeof corners[number]}[]=[];
  for(let i=0;i<points.length;i++){
   const q=points[i],a=points[partition&&runClosed&&i===0?Math.max(0,points.length-2):Math.max(0,i-1)].p,b=points[partition&&runClosed&&i===points.length-1?Math.min(1,points.length-1):Math.min(points.length-1,i+1)].p;
   const corner=corners.find(j=>Math.abs(j.s-q.s)<1e-10);
   if(corner){
    // Keep each side's one-sided normal at a cusp. Averaging across the turn
    // pinches the body away from the miter root, leaving white wedges.
    const l=[corner.left[0],...(corner.outerLeft?[corner.tip[2]]:[]),corner.left[1]],r=[corner.right[0],...(!corner.outerLeft?[corner.tip[2]]:[]),corner.right[1]];left.push(...l);right.push(...r);if(partition)sections.push({left:l,right:r,corner});continue;
   }
   let v=sub(b,a);if(length(v)<1e-10)v=sub(q.p,a);const normal=mul([-v[1],v[0]],q.half/(length(v)||1));left.push(add(q.p,normal));right.push(sub(q.p,normal));if(partition)sections.push({left:[left.at(-1)!],right:[right.at(-1)!]});
  }
  let fragments:InkFragment[]|undefined;
  if(partition){
   const ranges:{lo:number;hi:number;pieceIndex:number;shape:Cubic}[]=[];let at=0;
   ext.shapes.forEach((shape,i)=>{const piece=group[ext.indices[i]],start=i===0&&startExtension>0,end=i===ext.shapes.length-1&&endExtension>0,size=start?startExtension:end?endExtension:piece.hi-piece.lo;ranges.push({lo:at,hi:at+size,pieceIndex:sourceIndices[piece.index],shape});at+=size;});
   const ownerAt=(s:number)=>ranges.find(r=>s<r.hi-1e-10)??ranges.at(-1)!;
   fragments=[];let part:{owner:number;left:Point2[];right:Point2[]}|undefined;
   const flush=()=>{if(!part)return;fragments!.push({pieceIndex:part.owner,outline:[...part.left,...part.right.reverse()],shapes:projectShapes(ranges.filter(r=>r.pieceIndex===part!.owner).map(r=>r.shape)),tips:[]});part=undefined;};
   for(let i=0;i<points.length-1;i++){
    const a=sections[i],b=sections[i+1],owner=ownerAt((points[i].s+points[i+1].s)/2).pieceIndex;
    if(part?.owner!==owner||a.corner){flush();part={owner,left:[a.left.at(-1)!],right:[a.right.at(-1)!]};}
    part!.left.push(b.left[0]);part!.right.push(b.right[0]);
    if(b.corner){flush();const next=ownerAt(runClosed&&points[i+1].s>=localLength-1e-10?0:points[i+1].s+1e-8).pieceIndex;fragments.push({pieceIndex:owner,jointWith:next,outline:[...b.left,...[...b.right].reverse()],shapes:projectShapes([ranges.find(r=>r.pieceIndex===owner)!.shape]),tips:[]});}
   }
   flush();
  }
  return {...(fragments?{fragments}:{}),shapes:projectShapes(ext.shapes),outline:[...left,...right.reverse()],uniform,closed:runClosed,clipped:mask!==undefined&&!complete,
   tips:corners.map(j=>j.tip),...(ext.extensions.length?{extensions:ext.extensions.map(e=>({shape:e.shape,pieceIndex:sourceIndices[e.end?last.index:first.index]}))}:{})};
 });
}

export function strokeInk(d:Doc,s:Stroke,inkOwners?:ReadonlySet<string>,partition=false,sampling?:InkSampling){return strokePaths(s).flatMap(path=>{
 const tracks=pathTracks(d,path),replaced=new Set<string>();
 // The inferred moving ink end replaces its covered original endpoint. Leaving
 // both ramps active multiplies the same taper twice and visibly thins the line.
 for(const track of tracks)if(track.scope==='CURVE'&&track.revealFrom!==undefined)for(const range of track.ranges){
  if(range.enabled===false||range.mode!=='HIDE'||Math.abs(range.end-range.start)<1e-10)continue;
  if(Math.min(range.start,range.end)<1e-10)replaced.add(`${track.anchor.id}:${track.anchor.reverse?1:0}`);
  if(Math.max(range.start,range.end)>1-1e-10)replaced.add(`${track.anchor.id}:${track.anchor.reverse?0:1}`);
 }
 const c=curveById(d,path.segments[0].id),g=(partition?partitionedUses:derivedUses)(d,path.segments,path.closed),ends=strokeEnds(d,path).map(e=>replaced.has(`${e.endpoint.curveId}:${e.endpoint.end}`)?{...e,style:{taper:0,extension:0}}:e);
 const sharpAfter=g.pieces.flatMap((p,i)=>{const q=g.pieces[(i+1)%g.pieces.length];if(!path.closed&&i===g.pieces.length-1)return [];
  return d.joins.some(j=>geometryJoinBrush(j).kind==='SHARP'&&((p.owners.includes(j.a.curveId)&&q.owners.includes(j.b.curveId))||(p.owners.includes(j.b.curveId)&&q.owners.includes(j.a.curveId)))&&length(sub(p.shape[3],nodeAt(d,j.a).position))<1e-7)?[i]:[];});
 const display=tracks.length?displayField(d,path):undefined;
 const hasInterior=path.segments.some(u=>curveById(d,u.id).inkEnds?.some(e=>e.interior)),interiorEnds=hasInterior?g.pieces.map(p=>{
  if(p.joinId)return undefined;const id=p.owners[0],use=path.segments.find(u=>u.id===id)!,curve=curveById(d,id);
  const styles=([0,1] as const).map(end=>replaced.has(`${id}:${end}`)||ends.some(e=>sameEnd(e.endpoint,{curveId:id,end}))&&!boundEndpoint(d,{curveId:id,end})?{}:curve.inkEnds?.[end]?.interior?curve.inkEnds[end]:{}) as InkEnds;
  return use.reverse?[styles[1],styles[0]] as InkEnds:styles;
 }):undefined;
 return inkRuns(g.shapes,c.width,c.profile??'UNIFORM',c.profileReverse,g.pieces.map(p=>p.owners.every(id=>curveById(d,id).inkVisible!==false)&&(!inkOwners||p.owners.every(id=>inkOwners.has(id)))),path.closed,ends.length?ends.map(e=>e.style) as InkEnds:undefined,sharpAfter,display?.mask,display?.inkSpans,interiorEnds,partition,sampling,display?.pinches);
});}
export function outlinePath(points:Point2[],project:(p:Point2)=>Point2=p=>p){return points.length?`M ${points.map(p=>project(p).join(',')).join(' L ')} Z`:'';}
export interface OffsetGeometry {shapes:Cubic[];error?:string}
const offsetCache=new WeakMap<Doc,Map<string,OffsetGeometry>>();
/** Follower uses stable ordered source references; internal fitted cubics are runtime only. */
export function offsetGeometry(d:Doc,o:OffsetRelation):OffsetGeometry{
 let cache=offsetCache.get(d);if(!cache){cache=new Map();offsetCache.set(d,cache);}const hit=cache.get(o.id);if(hit)return hit;
 const solve=():OffsetGeometry=>{
  const resolved=resolveUses(d,o.source);if(resolved.error)return resolved;
  const field=arcField(resolved.shapes);if(field.total<1e-7)return {shapes:[],error:'源线长度退化，无法偏移。'};
  // A cusp reverses the unit normal. Refuse a spurious bridge across that jump.
  for(let i=1;i<field.parts.length;i++){
   const s=field.parts[i].start/field.total;if(s<=o.start+1e-7||s>=o.end-1e-7)continue;
   const a=field.at(s-1e-7).tangent,b=field.at(s+1e-7).tangent;
   if(a[0]*b[0]+a[1]*b[1]<.98)return {shapes:[],error:'偏移范围跨过尖点，请缩小范围或使用平滑源线。'};
  }
  const position=(t:number):Point2=>{const q=field.at(o.start+(o.end-o.start)*t),ramp=o.taper>0?smooth(t/o.taper)*smooth((1-t)/o.taper):1;return add(q.p,mul([-q.tangent[1],q.tangent[0]],o.distance*ramp));};
  const velocity=(t:number)=>{const a=Math.max(0,t-1e-5),b=Math.min(1,t+1e-5);return mul(sub(position(b),position(a)),1/(b-a));};
  const out:Cubic[]=[];let failed=false;
  const fit=(a:number,b:number,depth:number)=>{const p=position(a),q=position(b),s:Cubic=[p,add(p,mul(velocity(a),(b-a)/3)),sub(q,mul(velocity(b),(b-a)/3)),q];
   const error=Math.max(...[.125,.25,.375,.5,.625,.75,.875].map(t=>length(sub(point(s,t),position(a+(b-a)*t)))));
   if(error<=.0001&&b-a<=.125){out.push(s);return;}if(!depth||out.length>512){failed=true;return;}const m=(a+b)/2;fit(a,m,depth-1);fit(m,b,depth-1);
  };
  fit(0,1,14);return failed?{shapes:[],error:'偏移近似未达到精度，请减小距离或调整源线。'}:{shapes:out};
 };
 const solved=solve(),result=o.translation?{...solved,shapes:solved.shapes.map(s=>s.map(p=>add(p,o.translation!)) as Cubic)}:solved;cache.set(o.id,result);return result;
}
