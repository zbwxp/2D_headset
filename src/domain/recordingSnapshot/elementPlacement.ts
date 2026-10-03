import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {scaleEvaluatedDisplayRouteBrush} from '../drawing/displayRouteBrush';
import type {DrawingDocument,Point2} from '../drawing/model';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine,type EvaluatedAffine} from '../drawing/evaluatedAffine';
import {identityScenePlacement,type ScenePlacementValue} from '../recordingScene/model';
import {applyScenePlacement,placementMatrix,scenePlacementMaxScale,isScenePlacementSimilarity} from '../recordingScene/tracks';

export function sameElementPlacement(a:ScenePlacementValue,b:ScenePlacementValue):boolean {
 const right=placementMatrix(b);return placementMatrix(a).every((n,i)=>Math.abs(n-right[i])<=1e-10);
}
/** Snapshot references copy IDs and controls, not geometry ownership. Retain
 * their runtime material adapters across that identity-preserving copy. */
export function retainSnapshotAffines(drawing:DrawingDocument,sources:DrawingDocument[]):DrawingDocument {
 const affines=new Map<string,EvaluatedAffine>(),nodes=new Map<string,DrawingDocument['nodes'][number]>(),curves=new Map<string,DrawingDocument['curves'][number]>();
 const available=new Set([...drawing.nodes,...drawing.curves,...drawing.fills,...drawing.offsets].map(value=>value.id));
 for(const source of sources){const material=evaluatedAffineSource(source);if(!material)continue;for(const item of [...source.nodes,...source.curves,...source.fills,...source.offsets]){const affine=evaluatedAffine(source,item.id);if(available.has(item.id)&&affine)affines.set(item.id,affine);}for(const node of material.nodes)if(affines.has(node.id))nodes.set(node.id,node);for(const curve of material.curves)if(affines.has(curve.id))curves.set(curve.id,curve);}
 if(affines.size)registerEvaluatedAffine(drawing,{...drawing,nodes:drawing.nodes.map(node=>nodes.get(node.id)??node),curves:drawing.curves.map(curve=>curves.has(curve.id)?{...curve,handles:curves.get(curve.id)!.handles}:curve)},id=>affines.get(id));return drawing;
}
/** One material route must have one affine: never reconcile unlike transforms
 * by averaging a shared endpoint or silently changing the unselected curves. */
export function elementPlacementConflicts(drawing:DrawingDocument,placements:Record<string,ScenePlacementValue>):string[] {
 const identity=identityScenePlacement(),value=(id:string)=>placements[id]??identity,conflicts=new Set<string>();
 const check=(ids:string[])=>{if(ids.length>1&&ids.some(id=>!sameElementPlacement(value(ids[0]),value(id))))ids.forEach(id=>conflicts.add(id));};
 const nodes=new Map<string,string[]>();for(const curve of drawing.curves)for(const id of curve.nodes)nodes.set(id,[...(nodes.get(id)??[]),curve.id]);
 for(const ids of nodes.values())check(ids);
 for(const link of [...drawing.joins,...drawing.endpointLinks??[]])check([link.a.curveId,link.b.curveId]);
 for(const fill of drawing.fills)check(fill.boundary.map(use=>use.id));
 for(const offset of drawing.offsets)check(offset.source.map(use=>use.id));
 for(const interval of drawing.displayIntervals??[])if(interval.displayRoute)check([...interval.displayRoute.seed.segments,...resolveDisplayRoute(drawing,interval.displayRoute).path.segments].map(use=>use.id));
 return [...conflicts];
}
/** Curve-owned placement sits before layer placement and retains its
 * material source. Compose runtime affine adapters so ARC remains an affine
 * image of the original ARC even when both stages are nonuniform or singular. */
export function placeSnapshotElements(before:DrawingDocument,placements:Record<string,ScenePlacementValue>):DrawingDocument {
 const identity=identityScenePlacement(),active=new Set(Object.entries(placements).filter(([,p])=>!sameElementPlacement(p,identity)).map(([id])=>id));if(!active.size)return before;
 const owners=new Map<string,string>();for(const curve of before.curves){owners.set(curve.id,curve.id);for(const id of curve.nodes)owners.set(id,curve.id);}
 for(const fill of before.fills)if(fill.boundary[0])owners.set(fill.id,fill.boundary[0].id);for(const offset of before.offsets)if(offset.source[0])owners.set(offset.id,offset.source[0].id);
 const value=(id:string)=>placements[owners.get(id)??id]??identity,similarity=(id:string)=>active.has(id)&&isScenePlacementSimilarity(value(id))&&!evaluatedAffine(before,id);
 const drawing:DrawingDocument={...before,joins:before.joins.map(j=>j.radius!==undefined&&similarity(j.a.curveId)?{...j,radius:j.radius*scenePlacementMaxScale(value(j.a.curveId))}:j),endpointLinks:before.endpointLinks?.map(link=>link.joinBrush?.kind==='ARC'&&similarity(link.a.curveId)?{...link,joinBrush:scaleEvaluatedDisplayRouteBrush(link.joinBrush,scenePlacementMaxScale(value(link.a.curveId)))}:link),nodes:before.nodes.map(n=>active.has(owners.get(n.id)??'')?{...n,position:applyScenePlacement(value(n.id),n.position)}:n),curves:before.curves.map(c=>active.has(c.id)?{...c,handles:c.handles.map(p=>applyScenePlacement(value(c.id),p)) as [Point2,Point2]}:c),offsets:before.offsets.map(o=>o.translation&&active.has(o.source[0]?.id)?{...o,translation:applyScenePlacement({...value(o.source[0].id),translation:[0,0]},o.translation)}:o)};
 const source=evaluatedAffineSource(before)??before,affines=new Map<string,EvaluatedAffine>();
 for(const id of owners.keys()){
  const prior=evaluatedAffine(before,id),placement=value(id);if((!active.has(owners.get(id)??id)||isScenePlacementSimilarity(placement))&&!prior)continue;
  affines.set(id,{point:p=>applyScenePlacement(placement,prior?prior.point(p):p),maxScale:scenePlacementMaxScale(placement)*(prior?.maxScale??1)});
 }
 if(affines.size)registerEvaluatedAffine(drawing,source,id=>affines.get(id));return drawing;
}
