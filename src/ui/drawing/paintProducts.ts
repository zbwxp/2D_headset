import {visible,curveById,type DrawingDocument,type Cubic,type FillRegion,type OffsetRelation,type ContourMist} from '../../domain/drawing/model';
import {strokeInk,strokeEnds,extendedInk,fillGeometry,offsetGeometry,type InkRun,type InkSampling} from '../../domain/drawing/appearance';
import {derivedUses,partitionedUses,type DrawingPiece} from '../../domain/drawing/roundedJoin';
import {strokeInkPasses,inkEdgeStyle,type InkPass} from '../../domain/drawing/mist';
import {depthPaintBatches,memberInk,type PaintBatch} from '../../domain/drawing/depth';
import {displayRouteInk,type DisplayRouteInkPlan} from '../../domain/drawing/displayRouteInk';
import {resolveDisplayRoute,type DisplayRoute} from '../../domain/drawing/displayRoutes';
import {drawingMaterialPathDependencies} from '../../domain/drawing/readContext';
import {nativeDrawingPathMaterialSignature} from '../../domain/drawing/pathMaterialSignature';
import {evaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {hasEvaluatedDeformation} from '../../domain/drawing/evaluatedDeformation';
import {copyCurveSource} from '../../domain/drawing/curveProvenance';
import {InputCache} from '../../domain/geometry/cache';
import {strokePaths,strokeWidth,type Stroke,type StrokePath} from '../../domain/drawing/strokes';
import {fillInkSupportDiagnostics} from './fillInkSupport';

interface StrokePaintProduct {runs:InkRun[];passes:InkPass[];pieces:DrawingPiece[];ends:ReturnType<typeof strokeEnds>;extensions:ReturnType<typeof extendedInk>['extensions']}
interface MemberPaintProduct {runs:Map<string,InkRun[]>;pieces:DrawingPiece[]}
export interface FillBoundaryInkPass {ownerIds:string[];runs:InkRun[];width:number;mist?:ContourMist}
export interface FillBoundaryInkProduct {passes:FillBoundaryInkPass[];diagnostics:string[]}
const products=new InputCache<unknown>(128);
const work={readers:0,routeResolutions:0,scopeHits:0,nativeSignatures:0,cacheHits:0,productBuilds:0,fallbackBuilds:0,fillBuilds:0,offsetBuilds:0};
export const paintProductStats=()=>({...work});

/** Native inkRuns already snapshots source controls before building its cache
 * (appearance.ts). Reuse those detached outlines/fragments; only memberInk's
 * added outer extensions can still point into the current authoring geometry. */
const cubic=(shape:Cubic)=>copyCurveSource(shape,shape.map(point=>[...point]) as Cubic);
const pieces=(values:DrawingPiece[])=>values.map(piece=>({...piece,shape:cubic(piece.shape),owners:[...piece.owners],...(piece.sourceRange?{sourceRange:[...piece.sourceRange] as [number,number]}:{})}));
const runs=(values:InkRun[])=>values.map(run=>run.extensions?.length?{...run,extensions:run.extensions.map(extension=>({...extension,shape:cubic(extension.shape)}))}:run);
const ownerRuns=(values:Map<string,InkRun[]>)=>new Map([...values].map(([id,value])=>[id,runs(value)]));
function detachProduct(kind:string,value:unknown):unknown {
 if(kind==='stroke'){
  const product=value as StrokePaintProduct;return {...product,runs:runs(product.runs),pieces:pieces(product.pieces),ends:product.ends.map(end=>({endpoint:{...end.endpoint},style:{...end.style}})),extensions:product.extensions.map(extension=>({...extension,shape:cubic(extension.shape)})),passes:product.passes.map(pass=>({...pass,...(pass.mist?{mist:{...pass.mist}}:{}),runs:runs(pass.runs)}))};
 }
 if(kind==='member'){const product=value as MemberPaintProduct;return {...product,runs:ownerRuns(product.runs),pieces:pieces(product.pieces)};}
 if(kind==='route'){const product=value as DisplayRouteInkPlan;return {...product,runs:ownerRuns(product.runs),pieces:pieces(product.pieces),curveIds:new Set(product.curveIds),diagnostics:[...product.diagnostics]};}
 if(kind==='fill'){const product=value as ReturnType<typeof fillGeometry>,copy=pieces(product.pieces);return {...product,pieces:copy,shapes:copy.map(piece=>piece.shape)};}
 const product=value as ReturnType<typeof offsetGeometry>;return {...product,shapes:product.shapes.map(cubic)};
}

/** One synchronous consumer, shared by Drawing and Recording. Geometry products
 * never contain React nodes, event handlers, selection or screen coordinates.
 * Consumers treat returned products and their collections as read-only.
 * Native cross-frame reuse is value-guarded; opaque domains use the same kernel
 * only within this reader. Never treat a mutable document identity as a proof. */
export function createPaintProductReader(source:DrawingDocument,sampling:InkSampling,preparedBatches?:PaintBatch[]){
 work.readers++;
 // Retained domains keep their existing canonical input/cache lifetime. Native
 // mutable authoring instead needs a fresh facade to observe in-place edits.
 const opaqueDomain=hasEvaluatedDeformation(source)||source.curves.some(curve=>evaluatedAffine(source,curve.id));
 const drawing=opaqueDomain?source:{...source},inkDocument=drawing.curves.some(c=>!visible(drawing,c.id))?{...drawing,curves:drawing.curves.map(c=>visible(drawing,c.id)?c:{...c,inkVisible:false})}:drawing;
 const batches=preparedBatches??depthPaintBatches(drawing),positions=new Map(batches.filter(b=>b.owner).map(b=>[b.owner!,b.position]));
 type BoundaryBatch={batch:PaintBatch;index:number};
 let boundaryBatches:Map<string,BoundaryBatch[]>|undefined;const fillPositions=new Map<string,number>();
 const ensureBoundaryBatches=()=>{
  if(boundaryBatches)return boundaryBatches;
  boundaryBatches=new Map();
  batches.forEach((batch,index)=>{
   if(!batch.item.stroke){if(batch.item.kind==='fill')fillPositions.set(batch.item.id,index);return;}
   const entry={batch,index},ids=batch.owner?[batch.owner]:batch.item.stroke.segments.map(use=>use.id);
   for(const id of new Set(ids)){const list=boundaryBatches!.get(id)??[];list.push(entry);boundaryBatches!.set(id,list);}
  });
  return boundaryBatches;
 };
 const local=new Map<string,unknown>(),routesByOwner=new Map<string,DisplayRoute>();
 const resolvedRoutes=new Map<DisplayRoute,ReturnType<typeof resolveDisplayRoute>>();let routeAuthority:string|undefined;
 const ensureRoutes=()=>{
  if(routeAuthority!==undefined)return;
  const ordered=[];
  for(const track of drawing.displayIntervals??[]){if(!track.displayRoute)continue;
   let resolved=resolvedRoutes.get(track.displayRoute);
   if(!resolved){work.routeResolutions++;resolved=resolveDisplayRoute(drawing,track.displayRoute);resolvedRoutes.set(track.displayRoute,resolved);}
   ordered.push([track.id,track.anchor,track.displayRoute,resolved]);
   if(!resolved.diagnostics.length)for(const use of resolved.path.segments)if(!routesByOwner.has(use.id))routesByOwner.set(use.id,track.displayRoute);
  }
  // Global route precedence depends on selected ports outside a local path.
  // Actual resolved traversal/diagnostics guard that dependency without hashing
  // unrelated coordinates or trusting the route object's identity across frames.
  routeAuthority=JSON.stringify(ordered);
 };
 const nativeSampling=!sampling.projection&&!sampling.materialAffine&&!sampling.materialDeformation&&Object.keys(sampling).every(key=>['tolerance','maxStep','taperSteps','nativeUniform'].includes(key));
 const opaque=opaqueDomain||!nativeSampling||(source.endpointLinks??[]).some(link=>link.joinBrush?.kind==='ARC'&&link.joinBrush.trimDistance>2);
 function read<T>(kind:string,path:StrokePath,build:()=>T,extra:unknown=undefined):T {
  const localKey=JSON.stringify([kind,path,extra]),ready=local.get(localKey);if(ready){work.scopeHits++;return ready as T;}
  ensureRoutes();
  const closure=opaque?undefined:drawingMaterialPathDependencies(inkDocument,path.segments.map(use=>use.id));
  // Check the authoritative input before relying on any visibility facade.
  const selected=routesByOwner.get(path.segments[0]?.id),borrowed=selected&&resolvedRoutes.get(selected)?.path;
  // displayField can borrow an equal-length route for a local branch. Its
  // numeric dependencies may exceed that branch; keep the canonical fallback.
  const foreignRoute=(kind==='stroke'||kind==='member')&&borrowed?.segments.length===path.segments.length&&borrowed.segments.some(use=>!path.segments.some(local=>local.id===use.id));
  const native=closure&&!foreignRoute&&!closure.dependencies.curveIds.some(id=>evaluatedAffine(source,id));
  const signature=native?nativeDrawingPathMaterialSignature(inkDocument,path):undefined;
  const key=signature===undefined?undefined:localKey+'\0'+signature+'\0'+JSON.stringify([closure!.structuralIdToken,routeAuthority,sampling,path.segments.map(use=>[use.id,positions.get(use.id)])]);
  if(key!==undefined){work.nativeSignatures++;const hit=products.get(key);if(hit){work.cacheHits++;local.set(localKey,hit);return hit as T;}}
  work.productBuilds++;if(key===undefined)work.fallbackBuilds++;if(kind==='fill')work.fillBuilds++;if(kind==='offset')work.offsetBuilds++;
  const result=build(),value=key===undefined?result:detachProduct(kind,result) as T;local.set(localKey,value);if(key!==undefined)products.set(key,value);return value;
 }
 const reader={drawing,inkDocument,batches,
  routeFor(id:string){ensureRoutes();return routesByOwner.get(id);},
  fill(fill:FillRegion){return read('fill',{segments:fill.boundary,closed:true},()=>fillGeometry(drawing,fill),fill);},
  offset(offset:OffsetRelation){return read('offset',{segments:offset.source,closed:false},()=>offsetGeometry(drawing,offset),offset);},
  route(route:DisplayRoute):DisplayRouteInkPlan {
   ensureRoutes();const path=resolvedRoutes.get(route)?.path??resolveDisplayRoute(drawing,route).path;
   return read('route',path,()=>displayRouteInk(inkDocument,route,positions,sampling),route);
  },
  member(stroke:Stroke):MemberPaintProduct {
   return read('member',stroke,()=>({runs:memberInk(inkDocument,stroke,positions,sampling),pieces:partitionedUses(drawing,stroke.segments,stroke.closed).pieces}));
  },
  stroke(stroke:Stroke):StrokePaintProduct {
   return read('stroke',stroke,()=>{
    const runs=strokeInk(inkDocument,stroke,undefined,false,sampling),pieces=derivedUses(drawing,stroke.segments,stroke.closed).pieces,ends=strokeEnds(drawing,stroke),extensions=stroke.closed?[]:extendedInk(pieces.map(piece=>piece.shape),ends.map(end=>end.style) as import('../../domain/drawing/model').InkEnds).extensions;
    return {runs,pieces,ends,extensions,passes:strokeInkPasses(inkDocument,stroke,runs,sampling)};
   });
  },
  /** A fill only suppresses itself where its own earlier ink was painted.
   * Read the same route/member/stroke products as PaintScene. In particular,
   * hidden intervals, tapers and ARC ownership are never reconstructed from
   * the fill boundary. Opacity is a visibility gate, not another ink alpha. */
  fillBoundaryInk(fill:FillRegion,opacity?:ReadonlyMap<string,number>):FillBoundaryInkProduct {
   const result:FillBoundaryInkProduct={passes:[],diagnostics:[]};
   if(fill.color==='transparent')return result;
   const byOwner=ensureBoundaryBatches(),fillIndex=fillPositions.get(fill.id),boundary=new Set(fill.boundary.map(use=>use.id));
   if(fillIndex===undefined)return result;
   const append=(ownerIds:string[],runs:InkRun[],width:number,mist?:ContourMist)=>{
    if(!runs.length||!ownerIds.length)return;
    const style=inkEdgeStyle(mist);
    if(style.enabled&&style.density>0){result.diagnostics.push(`Filtered boundary ink is not supported by the geometric fill clip: ${ownerIds.join(', ')}`);return;}
    const pass={ownerIds,runs,width,...(mist?{mist}:{})};
    result.diagnostics.push(...fillInkSupportDiagnostics(pass,sampling));result.passes.push(pass);
   };
   // The queue is top first; only batches below this fill can be covered by it.
   const candidates=new Map<number,PaintBatch>();for(const id of boundary)for(const entry of byOwner.get(id)??[])if(entry.index>fillIndex)candidates.set(entry.index,entry.batch);
   for(const [, {item,owner}] of [...candidates].sort((a,b)=>a[0]-b[0])){
    if(!item.stroke||owner&&!boundary.has(owner))continue;
    for(const path of strokePaths(item.stroke)){
     const stroke={...path,id:item.id},owned=stroke.segments.filter(use=>boundary.has(use.id)&&visible(drawing,use.id));
     if(!owned.length||owner&&!stroke.segments.some(use=>use.id===owner))continue;
     if(owner){
      if((opacity?.get(owner)??1)<=0)continue;
      const curve=curveById(drawing,owner),route=reader.routeFor(owner);
      if(route){const plan=reader.route(route);append([owner],plan.runs.get(owner)??[],curve.width,curve.mist);}
      else append([owner],reader.member(stroke).runs.get(owner)??[],strokeWidth(drawing,stroke),curve.mist);
      continue;
     }
     // Unsplit paint groups use their first source member's display opacity,
     // including mixed-style passes. Match that existing rendering contract.
     if((opacity?.get(stroke.segments[0].id)??1)<=0)continue;
     for(const pass of reader.stroke(stroke).passes){
      if(pass.owner){if(boundary.has(pass.owner))append([pass.owner],pass.runs,strokeWidth(drawing,stroke),pass.mist);continue;}
      if(owned.length===stroke.segments.length)append(owned.map(use=>use.id),pass.runs,strokeWidth(drawing,stroke),pass.mist);
      else for(const use of owned)append([use.id],reader.member(stroke).runs.get(use.id)??[],strokeWidth(drawing,stroke),pass.mist);
     }
    }
   }
   return result;
  },
 };
 return reader;
}
