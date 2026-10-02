import {shapeOf,type Cubic,type DrawingDocument} from '../../domain/drawing/model';
import {displayField,unionSpans} from '../../domain/drawing/displayIntervals';
import {resolveDisplayRoute} from '../../domain/drawing/displayRoutes';
import type {CompiledDisplayRouteBrushes} from '../../domain/drawing/displayRouteBrush';
import {strokes,strokePaths,type StrokePath} from '../../domain/drawing/strokes';
import {curveSamples} from '../../domain/drawing/curveProvenance';
import {subcurve} from '../../domain/drawing/roundedJoin';

export interface EndpointOnionMask {
 id:string;trackId:string;rangeId:string;mode:'SHOW'|'HIDE';enabled:boolean;scope:'PATH'|'CURVE';
 /** Empty coverage is retained as a degenerate span for endpoint interpolation. */
 spans:Array<{start:number;end:number}>;
}
export interface EndpointOnionSegment {id:string;start:number;end:number;cubic:Cubic}
export interface EndpointOnionInk {
 curves:Record<string,{cubic:Cubic;visible:boolean;domain?:{start:number;end:number};segments:EndpointOnionSegment[];masks?:EndpointOnionMask[]}>;
 /** Already clipped endpoint ink, retained for simple endpoint rendering. */
 arcs:Record<string,Cubic[]>;
 arcSegments?:Record<string,Array<{pieceIndex:number;start:number;end:number;cubic:Cubic}>>;
 arcPieceCounts?:Record<string,number>;
 /** Complete final ARC geometry and stable masks, including a hidden endpoint. */
 arcGeometry?:Record<string,Array<{pieceIndex:number;cubic:Cubic;visible:boolean;masks?:EndpointOnionMask[]}>>;
 arcVisible?:Record<string,boolean>;
 arcMasks?:Record<string,Record<number,EndpointOnionMask[]>>;
 diagnostics:string[];
}
type Field=ReturnType<typeof displayField>;
function parameterAt(part:Field['parts'][number],distance:number):number {
 if(distance<=0)return 0;if(distance>=part.length)return 1;
 let lo=0,hi=part.dist.length-1;while(hi-lo>1){const middle=(lo+hi)>>1;if(part.dist[middle]<=distance)lo=middle;else hi=middle;}
 const fraction=(distance-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*fraction;
}
/** Material is resolved only at the two endpoint states. Intermediate ghosts
 * blend these final controls and ID-matched scalar masks; no runtime solver or
 * outline tessellator participates. Hidden geometry stays available for pairing. */
export function extractEndpointOnionInk(drawing:DrawingDocument):EndpointOnionInk {
 const result:EndpointOnionInk={curves:{},arcs:{},arcSegments:{},arcPieceCounts:{},arcGeometry:{},arcVisible:{},arcMasks:{},diagnostics:[]},curves=new Map(drawing.curves.map(c=>[c.id,c])),coverage=new Map<string,Array<[number,number]>>(),routed=new Set<string>(),routeKeys=new Set<string>(),ambiguousArcs=new Set<string>();
 const visible=(id:string)=>{const curve=curves.get(id);return !!curve?.visible&&curve.inkVisible!==false;};
 for(const curve of drawing.curves)result.curves[curve.id]={cubic:shapeOf(drawing,curve.id),visible:visible(curve.id),segments:[],masks:[]};
 const paths:Array<{path:StrokePath;route:boolean}>=[];
 for(const track of drawing.displayIntervals??[])if(track.displayRoute){const key=JSON.stringify(track.displayRoute);if(routeKeys.has(key))continue;routeKeys.add(key);const resolved=resolveDisplayRoute(drawing,track.displayRoute);if(resolved.diagnostics.length){result.diagnostics.push(...resolved.diagnostics.map(d=>d.message));continue;}resolved.path.segments.forEach(u=>routed.add(u.id));paths.push({path:resolved.path,route:true});}
 for(const layer of drawing.layers)for(const stroke of strokes(drawing,layer.id))for(const path of strokePaths(stroke))if(path.segments.some(u=>!routed.has(u.id)))paths.push({path,route:false});
 for(const {path,route} of paths)try{
  const field=displayField(drawing,path),geometry=field.geometry;if(geometry.error){result.diagnostics.push(geometry.error);continue;}
  const brushes=(field as Field&{brushes?:CompiledDisplayRouteBrushes}).brushes,linkByJoin=new Map(brushes?.links.flatMap(link=>link.joinId?[[link.joinId,link.linkId] as const]:[])??[]),uses=new Map(path.segments.map(u=>[u.id,u]));
  type ArcGroup={reverse:boolean;indices:number[];visible:boolean;pieces:Array<{index:number;t:number;cubic:Cubic}>;segments:Array<{pieceIndex:number;start:number;end:number;cubic:Cubic}>;geometry:Map<number,Cubic>;masks:Record<number,EndpointOnionMask[]>};
  const arcParts=new Map<string,ArcGroup>();
  const masksFor=(index:number,map:(t:number)=>number,curveId?:string):EndpointOnionMask[]=>{
   const part=field.parts[index];return field.tracks.filter(track=>track.scope!=='CURVE'||track.anchor.id===curveId).flatMap(track=>track.ranges.map(range=>({id:JSON.stringify([track.id,range.id]),trackId:track.id,rangeId:range.id,mode:range.mode??'SHOW',enabled:range.enabled!==false,scope:track.scope==='CURVE'?'CURVE' as const:'PATH' as const,spans:field.span(track,range).map(span=>{const a=map(parameterAt(part,span.start*field.total-part.start)),b=map(parameterAt(part,span.end*field.total-part.start));return {start:Math.min(a,b),end:Math.max(a,b)};})})));
  };
  for(let index=0;index<geometry.pieces.length;index++){
   const piece=geometry.pieces[index],part=field.parts[index];if(!part||!route&&piece.owners.some(id=>routed.has(id)))continue;
   let arc:{key:string;group:ArcGroup;ordinal:number}|undefined;
   const id=piece.owners[0],range=piece.sourceRange??[0,1],use=uses.get(id),canonical=(t:number)=>{const samples=curveSamples(piece.shape,t);if(samples.length===1&&samples[0].id===id)return samples[0].t;const x=range[0]+(range[1]-range[0])*t;return use?.reverse?1-x:x;};
   if(piece.joinId){
    const linkId=linkByJoin.get(piece.joinId),join=linkId?drawing.endpointLinks?.find(l=>l.id===linkId):drawing.joins.find(j=>j.id===piece.joinId);if(!join){result.diagnostics.push(`Derived ARC ${piece.joinId} has no explicit join identity and was omitted.`);continue;}
    const key=JSON.stringify([linkId?'link':'join',linkId??piece.joinId]);let group=arcParts.get(key);
    if(!group){let before=index-1;while(before>=0&&geometry.pieces[before].joinId===piece.joinId)before--;if(before<0)before=geometry.pieces.length-1;const previous=geometry.pieces[before],previousUse=uses.get(previous.owners[0]),exit=previousUse?.reverse?0:1;group={reverse:!(previousUse?.id===join.a.curveId&&exit===join.a.end),indices:geometry.pieces.flatMap((p,i)=>p.joinId===piece.joinId?[i]:[]),visible:piece.owners.every(visible),pieces:[],segments:[],geometry:new Map(),masks:{}};arcParts.set(key,group);}
    const ordinal=group.indices.indexOf(index),canonicalOrdinal=group.reverse?group.indices.length-1-ordinal:ordinal;group.geometry.set(canonicalOrdinal,group.reverse?[...part.shape].reverse() as Cubic:part.shape);group.masks[canonicalOrdinal]=masksFor(index,t=>group!.reverse?1-t:t);arc={key,group,ordinal:canonicalOrdinal};
   }else{
    const a=canonical(0),b=canonical(1),entry=result.curves[id];entry.domain={start:Math.min(a,b),end:Math.max(a,b)};entry.masks=masksFor(index,canonical,id);
   }
   for(const mask of field.inkSpans??[{start:0,end:1,ends:[{},{}]}]){
    const start=Math.max(mask.start*field.total,part.start),end=Math.min(mask.end*field.total,part.start+part.length);if(end-start<=1e-12)continue;const lo=parameterAt(part,start-part.start),hi=parameterAt(part,end-part.start);if(hi-lo<=1e-12)continue;
    if(arc){const {group,ordinal}=arc;group.pieces.push({index,t:lo,cubic:subcurve(part.shape,lo,hi)});group.segments.push({pieceIndex:ordinal,start:group.reverse?1-hi:lo,end:group.reverse?1-lo:hi,cubic:group.geometry.get(ordinal)!});}
    else{const a=canonical(lo),b=canonical(hi),spans=coverage.get(id)??[];spans.push([Math.max(0,Math.min(a,b)),Math.min(1,Math.max(a,b))]);coverage.set(id,spans);}
   }
  }
  for(const [key,group] of arcParts){if(ambiguousArcs.has(key))continue;let pieces=group.pieces.sort((a,b)=>a.index-b.index||a.t-b.t).map(p=>p.cubic);if(group.reverse)pieces=pieces.reverse().map(c=>[...c].reverse() as Cubic);const full=[...group.geometry].sort(([a],[b])=>a-b).map(([,c])=>c);if(result.arcGeometry![key]){if(JSON.stringify(result.arcGeometry![key].map(piece=>piece.cubic))!==JSON.stringify(full)){result.diagnostics.push(`ARC ${key} has ambiguous display geometry and was omitted.`);ambiguousArcs.add(key);for(const record of [result.arcs,result.arcSegments!,result.arcPieceCounts!,result.arcGeometry!,result.arcVisible!,result.arcMasks!])delete record[key];}continue;}result.arcs[key]=group.visible?pieces:[];result.arcGeometry![key]=full.map((cubic,pieceIndex)=>({pieceIndex,cubic,visible:group.visible,masks:group.masks[pieceIndex]}));result.arcVisible![key]=group.visible;result.arcMasks![key]=group.masks;result.arcSegments![key]=group.segments.sort((a,b)=>a.pieceIndex-b.pieceIndex||a.start-b.start);result.arcPieceCounts![key]=group.indices.length;}
 }catch(error){result.diagnostics.push(error instanceof Error?error.message:String(error));}
 for(const [id,entry] of Object.entries(result.curves)){if(entry.domain)(entry.masks??=[]).push({id:JSON.stringify(['geometry-domain',id]),trackId:JSON.stringify(['geometry-domain',id]),rangeId:'geometry-domain',mode:'SHOW',enabled:true,scope:'CURVE',spans:[entry.domain]});entry.segments=entry.visible?unionSpans(coverage.get(id)??[]).map(([start,end],index)=>({id:JSON.stringify(['coverage',id,index]),start,end,cubic:entry.cubic})):[];}
 result.diagnostics=[...new Set(result.diagnostics)];return result;
}
