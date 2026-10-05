import {add,sub,length,shapeOf,type Cubic,type DrawingDocument as Doc,type FillRegion,type EndpointLink,type Point2} from './model';
import {derivedUses,subcurve,type DerivedUses,type DrawingPiece} from './roundedJoin';
import {copyCurveSource} from './curveProvenance';
import {adoptedDisplayRoutes,deriveDisplayRouteCornerGeometry,type DisplayRoute,type DisplayRouteCornerGeometry} from './displayRoutes';
import {drawingMaterialPathDependencies,withDrawingReadScope} from './readContext';
import {evaluatedMaterialSource,evaluatedDeformationSource,projectEvaluatedGeometry} from './evaluatedDeformation';
import {evaluatedAffine,affineShape} from './evaluatedAffine';

export interface FillBoundaryRoutePlan {routes:DisplayRoute[];dependencyCurveIds:string[]}
/** Geometry-free dependency discovery for the paint-product cache. An ARC's
 * budget can depend on a foreign member's other end, so retain the complete
 * selected route, not just the fill's immediate linked neighbours. */
export function fillBoundaryRoutePlan(d:Doc,fill:FillRegion):FillBoundaryRoutePlan {
 return withDrawingReadScope(()=>{
  const ids=fill.boundary.map(use=>use.id),dependencies=drawingMaterialPathDependencies(d,ids),links=dependencies?dependencies.dependencies.linkIds.map(id=>dependencies.context.endpointLinks.get(id)!):(d.endpointLinks??[]).filter(link=>ids.includes(link.a.curveId)||ids.includes(link.b.curveId));
  const eligible=links.filter(link=>link.throughDisplay&&link.joinBrush?.kind==='ARC');if(!eligible.length)return {routes:[],dependencyCurveIds:ids};
  const active=adoptedDisplayRoutes(d),routes=new Set<DisplayRoute>(),all=new Set(ids);
  for(const id of ids){const route=active.byOwner.get(id),resolved=route&&active.resolved.get(route);if(!route||!resolved||!eligible.some(link=>(link.a.curveId===id||link.b.curveId===id)&&resolved.usedLinkIds.includes(link.id)))continue;
   routes.add(route);for(const use of resolved.path.segments)all.add(use.id);
  }
  return {routes:[...routes],dependencyCurveIds:[...all]};
 });
}
interface BorrowedPiece {route:DisplayRoute;index:number;reverse:boolean}
interface ArcEnd {link:EndpointLink;route:DisplayRoute;corner:DisplayRouteCornerGeometry;joinId:string;end:0|1}
interface Closure {index:number;end:0|1;arcIndex:number;arcEnd:0|1}
interface NativeFill {geometry:DerivedUses;borrowed:Map<number,BorrowedPiece>;closures:Closure[]}
const routeDocuments=new WeakMap<ReturnType<typeof adoptedDisplayRoutes>,Map<string,Doc>>();
const reversed=(shape:Cubic)=>copyCurveSource(shape,[...shape].reverse() as Cubic,1,0);
const orient=(piece:DrawingPiece,reverse:boolean):DrawingPiece=>reverse?{...piece,shape:reversed(piece.shape),...(piece.sourceRange?{sourceRange:[1-piece.sourceRange[1],1-piece.sourceRange[0]] as [number,number]}:{})}:piece;
const close=(a:Point2,b:Point2)=>length(sub(a,b))<1e-7;
function moveEnd(piece:DrawingPiece,end:0|1,point:Point2):DrawingPiece {
 const shape=[...piece.shape] as Cubic,index=end?3:0,handle=end?2:1,delta=sub(point,shape[index]);shape[index]=point;shape[handle]=add(shape[handle],delta);
 return {...piece,shape:copyCurveSource(piece.shape,shape)};
}
const fail=(message:string):never=>{throw Error(message);};

function nativeFill(d:Doc,fill:FillRegion,plan:FillBoundaryRoutePlan):NativeFill {
 const active=adoptedDisplayRoutes(d),uses=new Map(fill.boundary.map(use=>[use.id,use])),ends=new Map<string,ArcEnd[]>(),displaced=new Set<string>(),corners:DisplayRouteCornerGeometry[]=[];
 for(const route of plan.routes){const corner=deriveDisplayRouteCornerGeometry(d,route);if(corner.resolved.diagnostics.length||corner.geometry.error)continue;
  corners.push(corner);const context=drawingMaterialPathDependencies(d,corner.resolved.path.segments.map(use=>use.id))?.context;
  for(const item of corner.brushes.links){if(item.brush.kind!=='ARC'||!item.resolved||!item.joinId||!item.geometry?.shapes.length)continue;
   const link=context?.endpointLinks.get(item.linkId)??d.endpointLinks?.find(link=>link.id===item.linkId);if(!link)continue;
   for(const endpoint of [link.a,link.b]){if(!uses.has(endpoint.curveId)||active.byOwner.get(endpoint.curveId)!==route)continue;
    const list=ends.get(endpoint.curveId)??[];if(list.some(value=>value.end===endpoint.end&&value.link.id!==link.id))fail('Fill boundary has conflicting ARC continuations.');
    list.push({link,route,corner,joinId:item.joinId,end:endpoint.end});ends.set(endpoint.curveId,list);for(const id of corner.resolved.displacedJoinIds)displaced.add(id);
   }
  }
 }
 if(!ends.size)return {geometry:derivedUses(d,fill.boundary,true),borrowed:new Map(),closures:[]};
 let routeDocument:Doc;
 if(corners.length===1)routeDocument=corners[0].brushes.inkDocument;
 else {
  let documents=routeDocuments.get(active);if(!documents){documents=new Map();routeDocuments.set(active,documents);}const key=JSON.stringify(plan.routes);
  routeDocument=documents.get(key)!;if(!routeDocument){const joins=new Map(d.joins.filter(join=>!displaced.has(join.id)).map(join=>[join.id,join]));
   for(const corner of corners){const synthetic=new Set(corner.brushes.links.flatMap(link=>link.joinId?[link.joinId]:[]));for(const join of corner.brushes.inkDocument.joins)if(synthetic.has(join.id))joins.set(join.id,join);}
   routeDocument={...d,joins:[...joins.values()]};documents.set(key,routeDocument);
  }
 }
 const base=derivedUses(routeDocument,fill.boundary,true);if(base.error)return {geometry:base,borrowed:new Map(),closures:[]};
 const replacedJoins=new Set([...ends.values()].flatMap(values=>values.map(value=>value.joinId)));
 const pieces:DrawingPiece[]=[],borrowed=new Map<number,BorrowedPiece>(),arcIndices=new Set<number>();
 const push=(piece:DrawingPiece,reference?:BorrowedPiece,arc=false)=>{const index=pieces.length;pieces.push(piece);if(reference)borrowed.set(index,reference);if(arc)arcIndices.add(index);};
 for(const original of base.pieces){if(original.joinId&&replacedJoins.has(original.joinId))continue;const id=original.owners[0],affected=!original.joinId&&ends.get(id),use=uses.get(id);if(!affected||!use){push(original);continue;}
  const range=[...original.sourceRange??[0,1]] as [number,number],arcs:[Array<{piece:DrawingPiece;reference:BorrowedPiece}>,Array<{piece:DrawingPiece;reference:BorrowedPiece}>]=[[],[]];let sourceReference:BorrowedPiece|undefined,sourcePiece:DrawingPiece|undefined;
  for(const value of affected){const routeUse=value.corner.resolved.path.segments.find(value=>value.id===id)!,reverse=routeUse.reverse!==use.reverse,index=value.corner.geometry.pieces.findIndex(piece=>!piece.joinId&&piece.owners[0]===id);if(index<0)fail('ARC fill has no retained source piece.');
   const routePiece=orient(value.corner.geometry.pieces[index],reverse),end=(use.reverse?1-value.end:value.end) as 0|1;
   range[end]=routePiece.sourceRange?.[end]??end;sourceReference={route:value.route,index,reverse};sourcePiece=routePiece;
   let owned=value.corner.geometry.pieces.flatMap((piece,index)=>piece.joinId===value.joinId&&piece.inkOwner===id?[{piece:orient(piece,reverse),reference:{route:value.route,index,reverse}}]:[]);if(reverse)owned=owned.reverse();
   if(!owned.length)fail('ARC fill has no owned bridge half.');arcs[end].push(...owned);
  }
  if(range[1]<=range[0])fail('ARC fill trims overlap.');
  for(const value of arcs[0])push(value.piece,value.reference,true);
  const shape=shapeOf(d,id),own={...original,shape:subcurve(use.reverse?reversed(shape):shape,range[0],range[1]),sourceRange:range};
  const sameRange=sourcePiece?.sourceRange?.every((value,index)=>Math.abs(value-range[index])<1e-12);push(sameRange?{...own,shape:sourcePiece!.shape}:own,sameRange?sourceReference:undefined);
  for(const value of arcs[1])push(value.piece,value.reference,true);
 }
 const closures:Closure[]=[];
 for(let index=0;index<pieces.length;index++){const next=(index+1)%pieces.length;if(close(pieces[index].shape[3],pieces[next].shape[0]))continue;
  const leftArc=arcIndices.has(index),rightArc=arcIndices.has(next);if(leftArc===rightArc)fail('ARC fill boundary has incompatible closure endpoints.');
  const target=leftArc?next:index,end:0|1=leftArc?0:1,arcIndex=leftArc?index:next,arcEnd:0|1=leftArc?1:0;
  if(pieces[target].joinId)fail('ARC fill cannot replace an unrelated local join.');
  pieces[target]=moveEnd(pieces[target],end,pieces[arcIndex].shape[arcEnd?3:0]);closures.push({index:target,end,arcIndex,arcEnd});
 }
 return {geometry:{pieces,shapes:pieces.map(piece=>piece.shape)},borrowed,closures};
}
const affineKey=(d:Doc,id:string)=>{const affine=evaluatedAffine(d,id);return JSON.stringify(affine?[[0,0],[1,0],[0,1]].map(point=>affine.point(point as Point2)):[[0,0],[1,0],[0,1]]);};
function project(d:Doc,geometry:DerivedUses):DerivedUses {
 if(evaluatedDeformationSource(d))return projectEvaluatedGeometry(d,geometry);
 const pieces=geometry.pieces.map(piece=>{
  const key=affineKey(d,piece.owners[0]);if(piece.owners.some(id=>affineKey(d,id)!==key))fail('A fill ARC crosses incompatible affine programs.');
  const affine=evaluatedAffine(d,piece.owners[0]);return affine?{...piece,shape:affineShape(piece.shape,affine)}:piece;
 });return {...geometry,pieces,shapes:pieces.map(piece=>piece.shape)};
}
export interface ResolvedFillGeometry extends DerivedUses {diagnostics?:string[]}
/** The boundary stays authored in source IDs. Only this derived product follows
 * each active circular endpoint onto the ink-owned common seam. Hidden ink and
 * display ranges never choose a different structural fill contour. */
export function resolvedFillGeometry(d:Doc,fill:FillRegion):ResolvedFillGeometry {
 return withDrawingReadScope(()=>{
  const plan=fillBoundaryRoutePlan(d,fill);if(!plan.routes.length)return derivedUses(d,fill.boundary,true);
  try {
   const source=evaluatedMaterialSource(d),native=nativeFill(source,fill,source===d?plan:fillBoundaryRoutePlan(source,fill));if(native.geometry.error)return native.geometry;
   const geometry=source===d?native.geometry:project(d,native.geometry),pieces=[...geometry.pieces];
   if(source!==d){const routes=new Map<DisplayRoute,DisplayRouteCornerGeometry>();
    for(const [index,value] of native.borrowed){let route=routes.get(value.route);if(!route){
      const nativeRoute=deriveDisplayRouteCornerGeometry(source,value.route),keys=new Set(nativeRoute.resolved.path.segments.map(use=>affineKey(d,use.id)));if(!evaluatedDeformationSource(d)&&keys.size>1)fail('A fill ARC crosses incompatible affine programs.');
      route=deriveDisplayRouteCornerGeometry(d,value.route);routes.set(value.route,route);
     }
     pieces[index]={...pieces[index],shape:orient(route.geometry.pieces[value.index],value.reverse).shape};
    }
   }
   // Projected ARC pieces are exactly the ink pieces. A retained fit may move a
   // closure endpoint slightly differently; re-close onto that same seam and
   // translate only its derived adjacent handle, never the author's controls.
   for(const closure of native.closures)pieces[closure.index]=moveEnd(pieces[closure.index],closure.end,pieces[closure.arcIndex].shape[closure.arcEnd?3:0]);
   if(pieces.some((piece,index)=>!close(piece.shape[3],pieces[(index+1)%pieces.length].shape[0])))fail('The resolved ARC fill boundary is disconnected.');
   return {...geometry,pieces,shapes:pieces.map(piece=>piece.shape)};
  }catch(error){return {...derivedUses(d,fill.boundary,true),diagnostics:[(error as Error).message]};}
 });
}
