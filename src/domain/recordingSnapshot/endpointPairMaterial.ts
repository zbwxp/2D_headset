import {nativeDrawingPathMaterialSignature} from '../drawing/pathMaterialSignature';
import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import {displayField,displayPath} from '../drawing/displayIntervals';
import type {StrokePath} from '../drawing/strokes';
import {InputCache} from '../geometry/cache';
import {snapshotRouteMaterialSource} from './routeMaterialSource';
import {resolveDisplayRoute} from '../drawing/displayRoutes';

type Field=ReturnType<typeof displayField>;
type Support={kind:'curve';curveId:string;t:number}|{kind:'arc';joinId:string;s:number;pieceCount:number};
const fields=new WeakMap<DrawingDocument,Map<string,Field>>();
const pathFields=new InputCache<Field>(1024);
/** Final runtime drawings are immutable. A sweep can share the same derived
 * material field with its native ink extraction without another Warp solve. */
export function endpointPairDisplayField(drawing:DrawingDocument,path:StrokePath):Field {
 let cache=fields.get(drawing);if(!cache){cache=new Map();fields.set(drawing,cache);}const key=JSON.stringify([path.segments,path.closed]),known=cache.get(key);if(known)return known;
 const signature=nativeDrawingPathMaterialSignature(drawing,path),shared=signature===undefined?undefined:pathFields.get(signature),field=shared??displayField(drawing,path);cache.set(key,field);if(signature!==undefined&&!shared)pathFields.set(signature,field);return field;
}
/** Only for the sampler's fresh, unpublished intermediate Drawing. Retaining
 * geometry identity keeps its native ARC cache; full material fields refresh. */
export function replaceEndpointPairMaterial(drawing:DrawingDocument,displayIntervals:StrokeDisplayIntervals[]):DrawingDocument {
 fields.delete(drawing);drawing.displayIntervals=displayIntervals;return drawing;
}
const clamp=(t:number)=>Math.max(0,Math.min(1,t));
function parameterAt(part:Field['parts'][number],distance:number):number {
 const local=Math.max(0,Math.min(part.length,distance-part.start));let lo=0,hi=part.dist.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
 return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);
}
function distanceAt(part:Field['parts'][number],t:number):number {
 let lo=0,hi=part.pts.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(part.pts[mid].t<=t)lo=mid;else hi=mid;}
 return part.start+part.dist[lo]+(part.dist[hi]-part.dist[lo])*clamp((t-part.pts[lo].t)/(part.pts[hi].t-part.pts[lo].t||1));
}
function supportAt(field:Field,path:StrokePath,track:StrokeDisplayIntervals,s:number):Support {
 if(field.total<1e-10)throw Error('The endpoint material path is degenerate.');
 const absolute=field.native(track,s)*field.total,index=field.parts.findIndex(part=>absolute<=part.start+part.length+1e-12),i=index<0?field.parts.length-1:index,piece=field.geometry.pieces[i],part=field.parts[i];
 if(!piece||!part)throw Error('The endpoint material piece is missing.');
 if(piece.joinId){const indices=field.geometry.pieces.flatMap((p,j)=>p.joinId===piece.joinId?[j]:[]),start=field.parts[indices[0]].start,total=indices.reduce((n,j)=>n+field.parts[j].length,0);return {kind:'arc',joinId:piece.joinId,s:clamp((absolute-start)/(total||1)),pieceCount:indices.length};}
 const range=piece.sourceRange??[0,1],u=range[0]+(range[1]-range[0])*parameterAt(part,absolute),curveId=piece.owners[0],reverse=path.segments.find(use=>use.id===curveId)?.reverse;return {kind:'curve',curveId,t:reverse?1-u:u};
}
function resolveSupport(field:Field,path:StrokePath,track:StrokeDisplayIntervals,support:Support,diagnostics:string[]):number {
 if(field.total<1e-10)throw Error('The current material path is degenerate.');let distance:number;
 if(support.kind==='arc'){
  const indices=field.geometry.pieces.flatMap((p,i)=>p.joinId===support.joinId?[i]:[]);if(!indices.length)throw Error(`ARC ${support.joinId} is missing or degenerate; its material support cannot be resolved.`);
  if(indices.length!==support.pieceCount)diagnostics.push(`ARC ${support.joinId}: piece count changed; material retains its explicit relation arc fraction.`);
  distance=field.parts[indices[0]].start+support.s*indices.reduce((n,i)=>n+field.parts[i].length,0);
 }else{
  const i=field.geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===support.curveId);if(i<0)throw Error(`Material curve ${support.curveId} is missing.`);
  const range=field.geometry.pieces[i].sourceRange??[0,1],native=path.segments.find(use=>use.id===support.curveId)?.reverse?1-support.t:support.t;
  if(native<range[0]-1e-9||native>range[1]+1e-9)diagnostics.push(`Material curve ${support.curveId}: its source parameter is inside the current ARC trim and is constrained to that trim boundary.`);
  distance=distanceAt(field.parts[i],clamp((native-range[0])/(range[1]-range[0]||1)));
 }
 return field.relative(track,distance/field.total);
}
interface PreparedTrack {path:StrokePath;supports:Map<string,{start:Support;end:Support;full:boolean}>}
const prepared=new WeakMap<DrawingDocument,Map<StrokeDisplayIntervals,PreparedTrack>>();
function prepare(drawing:DrawingDocument,track:StrokeDisplayIntervals):PreparedTrack {
 let cache=prepared.get(drawing);if(!cache){cache=new Map();prepared.set(drawing,cache);}const known=cache.get(track);if(known)return known;
 const path=displayPath(drawing,track.anchor.id),field=endpointPairDisplayField(drawing,path),supports=new Map(track.ranges.map(r=>[r.id,{start:supportAt(field,path,track,r.start),end:supportAt(field,path,track,r.fullLoop?r.start:r.end),full:!!(path.closed&&Math.abs(r.end-r.start)>1-1e-10)}]));
 const value={path,supports};cache.set(track,value);return value;
}
/** Cache endpoint source-t/ARC addresses once. Only the target's derived field
 * changes per sample; no endpoint geometry or arc table is rebuilt. */
export function transportEndpointPairMaterial(endpoint:DrawingDocument,track:StrokeDisplayIntervals,drawing:DrawingDocument,diagnostics:string[]):StrokeDisplayIntervals {
 endpoint=snapshotRouteMaterialSource(endpoint,track);drawing=snapshotRouteMaterialSource(drawing,track);
 if(track.displayRoute)for(const document of [endpoint,drawing]){const resolved=resolveDisplayRoute(document,track.displayRoute);if(resolved.diagnostics.length)throw Error(`Material route ${track.id}: ${resolved.diagnostics[0].message}`);}
 const basis=prepare(endpoint,track),path=basis.path,field=endpointPairDisplayField(drawing,path);
 if(field.geometry.error)diagnostics.push(`Material ${track.id}: ${field.geometry.error}`);
 return {...track,ranges:track.ranges.map(range=>{const support=basis.supports.get(range.id)!;if(support.full)return {...range};return {...range,start:resolveSupport(field,path,track,support.start,diagnostics),end:resolveSupport(field,path,track,support.end,diagnostics)};})};
}
