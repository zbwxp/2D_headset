import {createDisplayRouteField,resolveDisplayRoute,type ResolvedDisplayRoute} from './displayRoutes';
import type {DrawingDocument,StrokeDisplayIntervals} from './model';
import {strokeFor,strokePaths} from './strokes';

/** Curve parameters are native to the live source. ARC fractions always run
 * from relation a toward b, independently of display traversal direction. */
export type DrawingPathMaterialPoint={kind:'curve';curveId:string;t:number}|{kind:'join';joinId:string;s:number;linkId?:string};
export type DrawingMaterialSourceResolver=(drawing:DrawingDocument,track:StrokeDisplayIntervals)=>DrawingDocument;
export interface DrawingPathMaterialFrame {
 readonly closed:boolean;
 readonly total:number;
 materialAt:(value:number)=>DrawingPathMaterialPoint;
 positionOf:(point:DrawingPathMaterialPoint)=>number;
}
/** Optional runtime-only frame inputs for a verified topology contraction.
 * Ordinary Drawing consumers pass just the document and track. */
export interface DrawingPathMaterialFrameOptions {
 resolvedPath?:ResolvedDisplayRoute;
 anchor?:{start:DrawingPathMaterialPoint;end:DrawingPathMaterialPoint};
 routeOrigin?:DrawingPathMaterialPoint;
}
const fail=(message:string):never=>{throw Error(`Path material frame: ${message}`);};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const wrap=(value:number)=>((value%1)+1)%1;
const caches=new WeakMap<DrawingDocument,Map<string,DrawingPathMaterialFrame>>();

/** An explicit track route is authoritative. Otherwise retain Drawing's
 * routed display path when another track supplies one for the same anchor. */
export function resolveDrawingMaterialPath(drawing:DrawingDocument,track:StrokeDisplayIntervals):ResolvedDisplayRoute {
 let route=track.displayRoute;
 if(!route)for(const candidate of drawing.displayIntervals??[])if(candidate.displayRoute){const resolved=resolveDisplayRoute(drawing,candidate.displayRoute);if(!resolved.diagnostics.length&&resolved.path.segments.some(use=>use.id===track.anchor.id)){route=candidate.displayRoute;break;}}
 if(route){const resolved=resolveDisplayRoute(drawing,route);if(resolved.diagnostics.length)fail(resolved.diagnostics[0].message);return resolved;}
 const stroke=strokeFor(drawing,track.anchor.id),path=stroke&&strokePaths(stroke).find(path=>path.segments.some(use=>use.id===track.anchor.id));if(!path?.segments.length)return fail(`material ${track.id} has no live path.`);
 return {path,usedLinkIds:[],displacedJoinIds:[],diagnostics:[]};
}

/** The existing material arc table and its exact piecewise-linear inverse.
 * The caller may prepare a material-space document before entering this pure
 * reader; no Recorder evaluation, Warp, or rendering is invoked here. */
export function createDrawingPathMaterialFrame(drawing:DrawingDocument,track:StrokeDisplayIntervals,options:DrawingPathMaterialFrameOptions={}):DrawingPathMaterialFrame {
 const key=JSON.stringify([track.id,track.anchor,track.scope,track.displayRoute,options]),cache=caches.get(drawing),known=cache?.get(key);if(known)return known;
 const resolved=options.resolvedPath??resolveDrawingMaterialPath(drawing,track),field=createDisplayRouteField(drawing,resolved),path=resolved.path;
 if(field.diagnostics.length)fail(field.diagnostics[0].message);if(!(field.total>1e-10))fail('the live material path is degenerate.');
 const curveIds=new Set(path.segments.map(use=>use.id)),linkToJoin=new Map(field.brushes.links.flatMap(link=>link.joinId?[[link.linkId,link.joinId] as const]:[])),joinToLink=new Map([...linkToJoin].map(([link,join])=>[join,link]));
 const distanceOf=(point:DrawingPathMaterialPoint)=>{
  let mapped:DrawingPathMaterialPoint=point;
  if(point.kind==='join'){
   if(!Number.isFinite(point.s)||point.s<0||point.s>1)fail('invalid ARC material fraction.');
   if(point.linkId)mapped={...point,joinId:linkToJoin.get(point.linkId)??fail(`ARC link ${point.linkId} is missing.`)};
  }else{
   if(!curveIds.has(point.curveId)||!Number.isFinite(point.t)||point.t<0||point.t>1)fail(`material curve ${point.curveId} is absent or has an invalid parameter.`);
   const index=field.geometry.pieces.findIndex(piece=>!piece.joinId&&piece.owners[0]===point.curveId);if(index<0)fail(`material curve ${point.curveId} has no live piece.`);
   const range=field.geometry.pieces[index].sourceRange??[0,1],reverse=path.segments.find(use=>use.id===point.curveId)!.reverse,native=reverse?1-point.t:point.t,t=Math.max(range[0],Math.min(range[1],native));mapped={...point,t:reverse?1-t:t};
  }
  const value=field.positionOf(mapped);return value===undefined?fail('the material support is missing or degenerate.'):value;
 };
 const use=path.segments.find(use=>use.id===track.anchor.id);if(!use)fail('the material anchor is outside its live path.');
 const anchor=options.anchor??{start:{kind:'curve' as const,curveId:track.anchor.id,t:0},end:{kind:'curve' as const,curveId:track.anchor.id,t:1}},direction=track.displayRoute?1:use!.reverse===track.anchor.reverse?1:-1,closed=path.closed&&track.scope!=='CURVE';
 let origin:number,scale=1;
 if(track.scope==='CURVE'){const a=distanceOf(anchor.start),b=distanceOf(anchor.end);origin=track.anchor.reverse?b:a;scale=Math.abs(b-a);}
 else if(track.displayRoute){const first=path.segments[0];origin=distanceOf(options.routeOrigin??{kind:'curve',curveId:first.id,t:first.reverse?1:0});}
 else origin=closed?distanceOf(track.anchor.reverse?anchor.end:anchor.start):direction===1?0:1;
 if(!(scale>1e-12))fail('the live material interval scale is degenerate.');
 const frame:DrawingPathMaterialFrame={closed,total:field.total,
  materialAt(value){
   if(!Number.isFinite(value)||value<0||value>1)fail('material value must be within 0…1.');
   const native=origin+direction*value*scale,point=field.materialAt(closed?wrap(native):clamp(native));if(!point)return fail('the live material support is unavailable.');
   if(point.kind==='join'){const linkId=joinToLink.get(point.joinId);return {...point,...linkId?{linkId}:{}};}return point;
  },
  positionOf(point){const relative=(distanceOf(point)-origin)*direction/scale;return closed?wrap(relative):clamp(relative);},
 };
 if(cache)cache.set(key,frame);else caches.set(drawing,new Map([[key,frame]]));return frame;
}
