import {boundEndpoint,curveById,inkTaperDistance,type DrawingDocument as Doc,type InkEnds} from '../drawing/model';
import {extendedInk,outerTaperDistances,strokeEnds} from '../drawing/appearance';
import {derivedUses} from '../drawing/roundedJoin';
import {strokes,strokePaths} from '../drawing/strokes';
import {arcField} from '../drawing/sampling';
import {displayField,pathTracks} from '../drawing/displayIntervals';

// Snapshot drawings are immutable. Resolve arc lengths once per source, never
// on every recording frame, and key by physical curve/end rather than traversal.
const cache=new WeakMap<Doc,Map<string,InkEnds>>();
function resolvedEnds(d:Doc){
 const hit=cache.get(d);if(hit)return hit;
 const result=new Map<string,InkEnds>(d.curves.map(c=>[c.id,[{taper:0,extension:0},{taper:0,extension:0}]]));
 for(const layer of d.layers)for(const stroke of strokes(d,layer.id))for(const path of strokePaths(stroke)){
  const c=curveById(d,path.segments[0].id),g=derivedUses(d,path.segments,path.closed),outer=strokeEnds(d,path);
  if(!g.shapes.length)continue;
  for(const use of path.segments){
   const curve=curveById(d,use.id),piece=g.pieces.find(p=>!p.joinId&&p.owners[0]===use.id);
   for(const end of [0,1] as const){
    const e=curve.inkEnds?.[end];if(!e?.interior||!piece)continue;
    result.get(use.id)![end]={taper:Math.min(inkTaperDistance(e,c.width),arcField([piece.shape]).total+(e.extension??0)),extension:e.extension??0,interior:true};
   }
  }
  if(!outer.length)continue;
  const ends=outer.map(e=>({...e.style})) as InkEnds;
  // Interval-end extensions replace, rather than add to, ordinary extensions.
  const cuts=pathTracks(d,path).length?displayField(d,path).inkSpans:undefined;
  if(cuts?.some(c=>c.start<1e-10&&c.ends[0].extension!==undefined))ends[0].extension=0;
  if(cuts?.some(c=>c.end>1-1e-10&&c.ends[1].extension!==undefined))ends[1].extension=0;
  const total=arcField(extendedInk(g.shapes,ends).shapes).total,tapers=outerTaperDistances(ends,c.width,total,c.profile??'UNIFORM',c.profileReverse);
  outer.forEach(({endpoint},i)=>{
   if(boundEndpoint(d,endpoint))return; // Interior ink is explicitly opt-in.
   const stored=curveById(d,endpoint.curveId).inkEnds?.[endpoint.end];
   result.get(endpoint.curveId)![endpoint.end]={taper:tapers[i],extension:ends[i].extension??0,...(stored?.interior?{interior:true}:{})};
  });
 }
 cache.set(d,result);return result;
}
/** Physical A/B ink as actually rendered, including dormant bound defaults and
 * short-stroke fitting. Return copies so authoring never mutates the cache. */
export function resolvedCurveInkEnds(d:Doc,id:string):InkEnds{
 const ends=resolvedEnds(d).get(id);if(!ends)throw Error('源姿态中没有这条曲线。');
 return ends.map(e=>({taper:e.taper??0,extension:e.extension??0})) as InkEnds;
}
/** Blend rendered distances, not raw defaults that may be dormant at bindings.
 * The authoring styles remain untouched, including their width multipliers. */
export function blendPoseInkEnds(id:string,samples:{drawing:Doc;weight:number}[]):InkEnds{
 return ([0,1] as const).map(end=>{
  let taper=0,extension=0,interior=false;
  for(const s of samples){const e=resolvedEnds(s.drawing).get(id)![end];taper+=s.weight*(e.taper??0);extension+=s.weight*(e.extension??0);interior||=s.weight>0&&e.interior===true;}
  return {taper,extension,...(interior?{interior:true}:{})};
 }) as InkEnds;
}
