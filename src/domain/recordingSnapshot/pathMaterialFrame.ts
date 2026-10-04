import type {ResolvedDisplayRoute} from '../drawing/displayRoutes';
import {createDrawingPathMaterialFrame,resolveDrawingMaterialPath,type DrawingPathMaterialPoint,type DrawingPathMaterialFrame} from '../drawing/pathMaterialSupport';
import {evaluatedControlParameter,evaluatedMaterialSource} from '../drawing/evaluatedDeformation';
import {snapshotSplitParameterParts,snapshotSplitUsesCurrentMaterialFrame} from './splitParameterField';
import {curveMaterialParameterMap} from '../drawing/materialParameter';
import {displayPath} from '../drawing/displayIntervals';
import {endpointPairDisplayField} from './endpointPairMaterial';
import {shapeOf,type Cubic,type CurveUse,type DrawingDocument,type Endpoint,type Point2,type StrokeDisplayIntervals} from '../drawing/model';
import {subcurve} from '../drawing/roundedJoin';
import type {StrokePath} from '../drawing/strokes';
import {snapshotRouteMaterialSource} from './routeMaterialSource';

/** Recorder-owned measurement lineage. The historical identity labels a
 * parameter domain only; every control is recovered from its LIVE leaves. */
export interface SnapshotMaterialPathLineage {
 sourceTrackId:string;
 curves:{sourceCurveId:string;parts:{curveId:string;parameterRange:[number,number]}[]}[];
}
/** ARC s is oriented from the relation's a port toward its b port. A display
 * link has its own stable identity even if its synthetic join name changes. */
export type SnapshotPathMaterialPoint=DrawingPathMaterialPoint;
export interface SnapshotPathMaterialFrame extends DrawingPathMaterialFrame {
 /** A transported support belongs to this live basis's native child frame. */
 positionOf:(point:SnapshotPathMaterialPoint,sourceDrawing?:DrawingDocument)=>number;
}
type LineagePart=SnapshotMaterialPathLineage['curves'][number]['parts'][number];
interface Run {id:string;parts:LineagePart[];shape:Cubic;lo:number;hi:number}
const fail=(message:string):never=>{throw Error(`Path material frame: ${message}`);};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const sameEnd=(a:Endpoint,b:Endpoint)=>a.curveId===b.curveId&&a.end===b.end;
const endKey=(e:Endpoint)=>JSON.stringify([e.curveId,e.end]);
const caches=new WeakMap<DrawingDocument,Map<string,SnapshotPathMaterialFrame>>();

/** Algebraic reconstruction, never a curve fit. Relative domains also permit
 * recomposing a freshly split edited child when its whole root no longer is a
 * cubic. Only declared siblings can be combined. */
function recompose(drawing:DrawingDocument,parts:LineagePart[]):Cubic|undefined {
 const first=parts[0],last=parts.at(-1)!,a=shapeOf(drawing,first.curveId),b=shapeOf(drawing,last.curveId),lo=first.parameterRange[0],hi=last.parameterRange[1],span=hi-lo;
 const left=span/(first.parameterRange[1]-lo),right=span/(hi-last.parameterRange[0]);
 const shape:Cubic=[a[0],a[0].map((n,axis)=>n+(a[1][axis]-n)*left) as Point2,b[3].map((n,axis)=>n+(b[2][axis]-n)*right) as Point2,b[3]];
 return parts.every(part=>{const wanted=subcurve(shape,(part.parameterRange[0]-lo)/span,(part.parameterRange[1]-lo)/span),actual=shapeOf(drawing,part.curveId);return actual.every((p,i)=>p.every((n,axis)=>Math.abs(n-wanted[i][axis])<=1e-11*Math.max(1,Math.abs(n),Math.abs(wanted[i][axis]))));})?shape:undefined;
}
function lineageRuns(drawing:DrawingDocument,path:StrokePath,lineage:SnapshotMaterialPathLineage):Run[] {
 const curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),uses=new Map(path.segments.map((use,index)=>[use.id,{...use,index}])),claimed=new Set<string>(),runs:Run[]=[];
 const adjacent=(a:LineagePart,b:LineagePart)=>{
  const left=uses.get(a.curveId)!,right=uses.get(b.curveId)!;
  if(left.reverse!==right.reverse)return false;
  const next=left.index+(left.reverse?-1:1),index=path.closed?(next+path.segments.length)%path.segments.length:next;
  if(index!==right.index||curves.get(a.curveId)!.nodes[1]!==curves.get(b.curveId)!.nodes[0])return false;
  const exit:Endpoint={curveId:a.curveId,end:1},entry:Endpoint={curveId:b.curveId,end:0};
  // Interior ports cannot be represented by a contracted cubic endpoint.
  if(drawing.endpointLinks?.some(link=>[link.a,link.b].some(e=>sameEnd(e,exit)||sameEnd(e,entry))))return false;
  return !drawing.joins.some(join=>[join.a,join.b].some(e=>sameEnd(e,exit)||sameEnd(e,entry))&&(join.mode==='ARC'||!([join.a,join.b].some(e=>sameEnd(e,exit))&&[join.a,join.b].some(e=>sameEnd(e,entry)))));
 };
 for(const nativeRoot of lineage.curves){
  const root={...nativeRoot,parts:snapshotSplitParameterParts(drawing,nativeRoot.parts).map(part=>({...part,parameterRange:[...part.parameterRange] as [number,number]}))};
  let boundary=0;
  for(const part of root.parts){const [lo,hi]=part.parameterRange;if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo!==boundary||hi<=lo||hi>1||claimed.has(part.curveId))fail('invalid live parameter partition.');boundary=hi;claimed.add(part.curveId);if(!curves.has(part.curveId)||!uses.has(part.curveId))fail(`lineage curve ${part.curveId} is absent from its live path.`);}
  if(!root.parts.length||boundary!==1)fail('a live parameter partition must cover 0…1.');
  for(let i=0;i<root.parts.length;){
   let end=i+1,shape=shapeOf(drawing,root.parts[i].curveId);
   while(end<root.parts.length&&adjacent(root.parts[end-1],root.parts[end])){const candidate=recompose(drawing,root.parts.slice(i,end+1));if(!candidate)break;shape=candidate;end++;}
   const parts=root.parts.slice(i,end);if(parts.length>1)runs.push({id:parts[0].curveId,parts,shape,lo:parts[0].parameterRange[0],hi:parts.at(-1)!.parameterRange[1]});i=end;
  }
 }
 return runs;
}
function contract(drawing:DrawingDocument,resolved:ResolvedDisplayRoute,runs:Run[]){
 const byChild=new Map(runs.flatMap(run=>run.parts.map(part=>[part.curveId,{run,part}] as const))),internal=new Set<string>();
 for(const run of runs)for(let i=1;i<run.parts.length;i++){internal.add(endKey({curveId:run.parts[i-1].curveId,end:1}));internal.add(endKey({curveId:run.parts[i].curveId,end:0}));}
 const endpoint=(e:Endpoint):Endpoint=>{const found=byChild.get(e.curveId);return found?{curveId:found.run.id,end:e.end}:e;};
 const collapse=(uses:CurveUse[])=>{const mapped=uses.map(use=>({...use,id:byChild.get(use.id)?.run.id??use.id})).filter((use,i,all)=>!i||all[i-1].id!==use.id);if(mapped.length>1&&mapped[0].id===mapped.at(-1)!.id)mapped.pop();return mapped;};
 const curves=new Map(drawing.curves.map(curve=>[curve.id,curve]));
 const document:DrawingDocument={...drawing,
  // A new geometry identity must not inherit the actual document's deferred
  // affine WeakMap entry. Its material-space source was selected beforehand.
  nodes:[...drawing.nodes],
  curves:drawing.curves.flatMap(curve=>{const found=byChild.get(curve.id);if(!found)return [curve];const run=found.run;if(curve.id!==run.id)return [];return [{...curve,nodes:[curves.get(run.parts[0].curveId)!.nodes[0],curves.get(run.parts.at(-1)!.curveId)!.nodes[1]] as [string,string],handles:[run.shape[1],run.shape[2]] as [Point2,Point2]}];}),
  joins:drawing.joins.filter(join=>!internal.has(endKey(join.a))&&!internal.has(endKey(join.b))).map(join=>({...join,a:endpoint(join.a),b:endpoint(join.b)})),
  endpointLinks:drawing.endpointLinks?.map(link=>({...link,a:endpoint(link.a),b:endpoint(link.b)})),
  layers:drawing.layers.map(layer=>({...layer,items:[...new Set(layer.items.map(id=>byChild.get(id)?.run.id??id))]})),
 };
 return {document,resolved:{...resolved,path:{...resolved.path,segments:collapse(resolved.path.segments)}},byChild};
}

/** Read a track in the actual display frame, or its retained pre-split material
 * measurement. Logical output supports always name CURRENT live children.
 * This helper derives material only; it never runs rendering or onion passes. */
export function createSnapshotPathMaterialFrame(drawing:DrawingDocument,track:StrokeDisplayIntervals,lineage?:SnapshotMaterialPathLineage,logical=false):SnapshotPathMaterialFrame {
 if(lineage&&lineage.sourceTrackId!==track.id)fail('lineage and material identities disagree.');
 const key=JSON.stringify([track.id,track.anchor,track.scope,track.displayRoute,logical?lineage:null]),cache=caches.get(drawing),known=cache?.get(key);if(known)return known;
 let source=snapshotRouteMaterialSource(drawing,track);if(!logical||!lineage)return createDrawingPathMaterialFrame(source,track);
 let resolved=resolveDrawingMaterialPath(source,track);
 const currentMaterial=snapshotSplitUsesCurrentMaterialFrame(source);if(!currentMaterial)source=evaluatedMaterialSource(source);resolved=resolveDrawingMaterialPath(source,track);
 const originalPath=resolved.path,runs=lineageRuns(source,originalPath,lineage),contracted=contract(source,resolved,runs),actualCurveIds=new Set(originalPath.segments.map(use=>use.id)),runById=new Map(runs.map(run=>[run.id,run]));
 const virtualPoint=(point:SnapshotPathMaterialPoint,sourceDrawing?:DrawingDocument)=>{
  if(point.kind==='join')return point;
  if(!actualCurveIds.has(point.curveId)||!Number.isFinite(point.t)||point.t<0||point.t>1)fail(`material curve ${point.curveId} is absent or has an invalid parameter.`);
  if(sourceDrawing){
   const root=lineage.curves.find(root=>root.parts.some(part=>part.curveId===point.curveId));
   if(root){const native=snapshotSplitParameterParts(sourceDrawing,root.parts).find(part=>part.curveId===point.curveId)!,local=evaluatedControlParameter(sourceDrawing,point.curveId,point.t),fitted=native.parameterRange[0]+local*(native.parameterRange[1]-native.parameterRange[0]);
    const current=snapshotSplitParameterParts(source,root.parts),target=current.find(part=>fitted<=part.parameterRange[1])??current.at(-1)!,found=contracted.byChild.get(target.curveId),lo=found?.run.lo??target.parameterRange[0],hi=found?.run.hi??target.parameterRange[1];
    return {kind:'curve' as const,curveId:found?.run.id??target.curveId,t:clamp((fitted-lo)/(hi-lo))};
   }
   return {...point,t:evaluatedControlParameter(sourceDrawing,point.curveId,point.t)};
  }
  const local=currentMaterial?evaluatedControlParameter(drawing,point.curveId,point.t):point.t,found=contracted.byChild.get(point.curveId);return found?{kind:'curve' as const,curveId:found.run.id,t:clamp((found.part.parameterRange[0]+local*(found.part.parameterRange[1]-found.part.parameterRange[0])-found.run.lo)/(found.run.hi-found.run.lo))}:{...point,t:local};
 };
 const first=originalPath.segments[0],anchor={start:virtualPoint({kind:'curve',curveId:track.anchor.id,t:0}),end:virtualPoint({kind:'curve',curveId:track.anchor.id,t:1})},materialTrack={...track,anchor:{...track.anchor,id:contracted.byChild.get(track.anchor.id)?.run.id??track.anchor.id}},base=createDrawingPathMaterialFrame(contracted.document,materialTrack,{resolvedPath:contracted.resolved,anchor,routeOrigin:virtualPoint({kind:'curve',curveId:first.id,t:first.reverse?1:0})});
 const nativeMaps=new Map<string,(t:number)=>number>(),nativeLocal=(curveId:string,t:number)=>{if(!currentMaterial)return t;let map=nativeMaps.get(curveId);if(!map){const path=displayPath(drawing,curveId),field=endpointPairDisplayField(drawing,path),native=curveMaterialParameterMap(field,path,curveId),fitted=curveMaterialParameterMap({...field,sourcePieceParameter:undefined,fittedPieceParameter:undefined},path,curveId);map=value=>native.parameterAt(fitted.valueAt(value));nativeMaps.set(curveId,map);}return map(t);};
 const frame:SnapshotPathMaterialFrame={closed:base.closed,total:base.total,
  materialAt(value){
   const point=base.materialAt(value);if(point.kind==='join')return point;
   const run=runById.get(point.curveId);if(!run)return {...point,t:nativeLocal(point.curveId,point.t)};
   const t=run.lo+point.t*(run.hi-run.lo),part=run.parts.find(part=>t<=part.parameterRange[1]+1e-14)??run.parts.at(-1)!;
   return {kind:'curve',curveId:part.curveId,t:nativeLocal(part.curveId,clamp((t-part.parameterRange[0])/(part.parameterRange[1]-part.parameterRange[0])))};
  },
  positionOf(point,sourceDrawing){return base.positionOf(virtualPoint(point,sourceDrawing));},
 };
 if(cache)cache.set(key,frame);else caches.set(drawing,new Map([[key,frame]]));return frame;
}
