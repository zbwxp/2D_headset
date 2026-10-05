import {inkRuns,type InkRun,type InkSampling} from '../../domain/drawing/appearance';
import type {Point2} from '../../domain/drawing/model';
import type {FillBoundaryInkPass} from './paintProducts';

export type FillInkSupport={kind:'outline';points:Point2[]}|{kind:'circle';center:Point2;radius:number};
interface SupportProduct {support:FillInkSupport[];unsupportedRuns:number}
const cache=new WeakMap<InkRun[],Map<string,SupportProduct>>();

/** Inverting a nonzero self-overlapping outline with even-odd would expose
 * its winding-two interior. Reject crossed ribbons instead of guessing a
 * Boolean union. X-sorted bounds keep ordinary sampled ribbons local. */
function selfIntersects(points:Point2[]):boolean {
 const edges=points.map((a,i)=>{const b=points[(i+1)%points.length];return {a,b,i,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])};}).filter(e=>e.a[0]!==e.b[0]||e.a[1]!==e.b[1]).sort((a,b)=>a.minX-b.minX);
 const cross=(a:Point2,b:Point2,c:Point2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].minX<=edges[i].maxX;j++){
  const a=edges[i],b=edges[j],gap=Math.abs(a.i-b.i);
  if(gap===1||gap===points.length-1||a.maxY<b.minY||b.maxY<a.minY)continue;
  const ab=cross(a.a,a.b,b.a),ac=cross(a.a,a.b,b.b),ba=cross(b.a,b.b,a.a),bc=cross(b.a,b.b,a.b);
  if(ab*ac<0&&ba*bc<0)return true;
  // Opposed coincident edges are the harmless seam of a closed ribbon. Same
  // direction overlap, however, can carry winding two even without a crossing.
  if(ab===0&&ac===0&&(a.b[0]-a.a[0])*(b.b[0]-b.a[0])+(a.b[1]-a.a[1])*(b.b[1]-b.a[1])>0&&
   (Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)||Math.min(a.maxY,b.maxY)>Math.max(a.minY,b.minY)))return true;
 }
 return false;
}

/** Nominal sharp-ink support, shared by fill paint and native SVG hit clipping.
 * Variable-width ink already has its painted outline. Native uniform strokes
 * ask the existing sampling kernel for the ribbon that its fast path omitted;
 * SVG's round caps and joins are explicit circles, never a padded line width.
 * This is geometric coverage, not a promise of raster antialias bit identity. */
function readSupport(pass:FillBoundaryInkPass,sampling:InkSampling):SupportProduct {
 const quality={tolerance:sampling.tolerance,maxStep:sampling.maxStep,taperSteps:sampling.taperSteps,nativeUniform:false};
 const key=JSON.stringify([pass.width,quality]),saved=cache.get(pass.runs),hit=saved?.get(key);if(hit)return hit;
 const support:FillInkSupport[]=[];let unsupportedRuns=0;
 const outline=(points:Point2[])=>{if(points.length>2)support.push({kind:'outline',points});};
 const circle=(center:Point2)=>support.push({kind:'circle',center,radius:pass.width/2});
 for(const run of pass.runs){
  if(!run.uniform){if(selfIntersects(run.outline)){unsupportedRuns++;continue;}outline(run.outline);continue;}
  // These are the already-visible, extended/trimmed, placed centerlines. Do not
  // apply the author's profile, interval, projection or endpoint styles again.
  // A native round join is the union of its two butt ribbons and a disk.
  // Sampling each cubic separately avoids the artificial closing seam of a
  // whole closed ribbon and never changes native centerlines or their width.
  const ribbons=run.shapes.flatMap(shape=>inkRuns([shape],pass.width,'UNIFORM',false,undefined,false,undefined,undefined,undefined,undefined,undefined,false,quality));
  if(ribbons.some(ribbon=>selfIntersects(ribbon.outline))){unsupportedRuns++;continue;}
  for(const ribbon of ribbons)outline(ribbon.outline);
  if(!run.shapes.length)continue;
  for(let i=1;i<run.shapes.length;i++)circle(run.shapes[i][0]);
  if(run.closed)circle(run.shapes[0][0]);
  else if(!run.clipped){circle(run.shapes[0][0]);circle(run.shapes.at(-1)![3]);}
  for(const tip of run.tips)outline(tip);
 }
 const result={support,unsupportedRuns},entries=saved??new Map<string,SupportProduct>();entries.set(key,result);if(entries.size>8)entries.delete(entries.keys().next().value!);if(!saved)cache.set(pass.runs,entries);
 return result;
}
export const fillInkSupport=(pass:FillBoundaryInkPass,sampling:InkSampling):FillInkSupport[]=>readSupport(pass,sampling).support;
export const fillInkSupportDiagnostics=(pass:FillBoundaryInkPass,sampling:InkSampling):string[]=>readSupport(pass,sampling).unsupportedRuns?[`Self-intersecting boundary ink is not supported by the geometric fill clip: ${pass.ownerIds.join(', ')}`]:[];
