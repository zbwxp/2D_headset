import {dominantSnapshotBasis} from './simplexSupport';
import {emptyDrawing,type DrawingDocument,type Point2} from '../drawing/model';
import {applyEndpointPairSmoothConstraints,endpointPairNodeAuthorities} from './endpointPair';

export type SnapshotScalarTarget={kind:'node';nodeId:string}|{kind:'handle';curveId:string;end:0|1};
/** Response evaluation changes geometry only. These weights never decide which
 * source IDs, relationships or discrete authoring values are present. */
export type SnapshotScalarWeights=(target:SnapshotScalarTarget,axis:0|1,coordinates:readonly number[],geometricWeights:readonly number[])=>readonly number[];
/** Value responses represent inherited motion even when all active basis values agree. */
export type SnapshotScalarValue=((target:SnapshotScalarTarget,axis:0|1,coordinates:readonly number[],geometricWeights:readonly number[])=>number)&{projectSmooth?:(drawing:DrawingDocument)=>{drawing:DrawingDocument;diagnostics:string[]};unprojectSmooth?:(drawing:DrawingDocument,available:(target:SnapshotScalarTarget,axis:0|1)=>boolean)=>DrawingDocument;rawScalar?:(target:SnapshotScalarTarget,axis:0|1)=>number|undefined};
export type SnapshotScalarResponse=SnapshotScalarWeights|SnapshotScalarValue;
export interface SnapshotSimplexBasis {snapshotId:string;drawing:DrawingDocument;/** Recorder binding, only for deterministic discrete ties. */angle?:{x:number;y:number}}
export interface SnapshotSimplexGeometry {drawing:DrawingDocument;diagnostics:string[];nodeAuthorities:Map<string,string>}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const keys=<T extends {id:string}>(items:readonly T[])=>new Map(items.map(item=>[item.id,item]));

/** Final-control geometry for one real vertex, one shared edge or one triangle.
 * The caller supplies only geometrically active vertices. No nearest-member
 * fill, hidden-line filtering, ink construction or material parsing occurs here.
 * This is deliberately independent of the recorder's response storage. */
export function interpolateSnapshotSimplexGeometry(bases:readonly SnapshotSimplexBasis[],geometricWeights:readonly number[],response?:SnapshotScalarResponse):SnapshotSimplexGeometry {
 if(bases.length<1||bases.length>3||bases.length!==geometricWeights.length||new Set(bases.map(b=>b.snapshotId)).size!==bases.length)throw Error('A snapshot simplex needs one to three distinct active bases.');
 if(geometricWeights.some(w=>!Number.isFinite(w)||w<=0)||Math.abs(geometricWeights.reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('Active geometric weights must be positive and sum to one.');
 if(bases.length===1)return {drawing:bases[0].drawing,diagnostics:[],nodeAuthorities:endpointPairNodeAuthorities(bases[0].drawing)};
 const diagnostics:string[]=[],dominant=dominantSnapshotBasis(bases,geometricWeights);
 const selected=bases[dominant].drawing,curveMaps=bases.map(b=>keys(b.drawing.curves)),nodeMaps=bases.map(b=>keys(b.drawing.nodes));
 const curves=selected.curves.filter(curve=>{
  if(!curveMaps.every(map=>map.has(curve.id)))return false;
  if(!curveMaps.every(map=>same(map.get(curve.id)!.nodes,curve.nodes))){diagnostics.push(`Curve ${curve.id} has incompatible canonical endpoint topology in the active snapshots and is inactive.`);return false;}
  if(!curve.nodes.every(id=>nodeMaps.every(map=>map.has(id)))){diagnostics.push(`Curve ${curve.id} is missing an endpoint dependency and is inactive.`);return false;}
  return true;
 });
 const curveIds=new Set(curves.map(c=>c.id)),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 const shared=<T extends {id:string}>(name:string,collections:readonly (readonly T[])[],shape:(item:T)=>unknown,valid:(item:T)=>boolean):T[]=>{
  const maps=collections.map(keys);return collections[dominant].filter(item=>{
   if(!valid(item))return false;
   if(maps.some(map=>!map.has(item.id)||!same(shape(map.get(item.id)!),shape(item)))){diagnostics.push(`${name} ${item.id} is not shared with compatible references by every active snapshot and is inactive.`);return false;}
   return true;
  });
 };
 const endpointsPresent=(item:{a:{curveId:string};b:{curveId:string}})=>curveIds.has(item.a.curveId)&&curveIds.has(item.b.curveId);
 const joins=shared('Join',bases.map(b=>b.drawing.joins),j=>[j.a,j.b,j.mode],endpointsPresent);
 const endpointLinks=shared('EndpointLink',bases.map(b=>b.drawing.endpointLinks??[]),l=>[l.a,l.b,l.throughDisplay,l.joinBrush?.kind],endpointsPresent).filter(link=>{
  const coherent=bases.every((_,index)=>{const a=curveMaps[index].get(link.a.curveId)!,b=curveMaps[index].get(link.b.curveId)!,p=nodeMaps[index].get(a.nodes[link.a.end])!.position,q=nodeMaps[index].get(b.nodes[link.b.end])!.position;return Math.hypot(p[0]-q[0],p[1]-q[1])<=64*Number.EPSILON*Math.max(1,...p.map(Math.abs),...q.map(Math.abs));});
  if(!coherent)diagnostics.push(`EndpointLink ${link.id} has different endpoint positions in an active basis and is inactive; its curves are not silently snapped.`);return coherent;
 });
 const fills=shared('Fill',bases.map(b=>b.drawing.fills),f=>f.boundary,f=>f.boundary.every(u=>curveIds.has(u.id)));
 const offsets=shared('Offset',bases.map(b=>b.drawing.offsets),o=>o.source,o=>o.source.every(u=>curveIds.has(u.id)));
 const present=new Set([...curveIds,...fills.map(f=>f.id),...offsets.map(o=>o.id)]),drawing:DrawingDocument={...emptyDrawing(),...selected,curves,nodes:selected.nodes.filter(n=>nodeIds.has(n.id)),fills,offsets,joins,endpointLinks,
  layers:selected.layers.map(layer=>({...layer,items:layer.items.filter(id=>present.has(id))})),
  groups:selected.groups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})).filter(group=>group.curveIds.length),
  displayIntervals:[],mirrorEditing:undefined};
 const linkIds=new Set(endpointLinks.map(link=>link.id));
 drawing.displayIntervals=shared('Display interval',bases.map(b=>b.drawing.displayIntervals??[]),t=>[t.anchor,t.scope,t.displayRoute,t.ranges.map(r=>r.id)],t=>curveIds.has(t.anchor.id)&&(!t.displayRoute||t.displayRoute.seed.segments.every(u=>curveIds.has(u.id))&&t.displayRoute.throughLinkIds.every(id=>linkIds.has(id))));
 const authorities=endpointPairNodeAuthorities(drawing);
 const sample=(target:SnapshotScalarTarget,axis:0|1,coordinates:number[]):number=>{
  const sampled=response?.(target,axis,coordinates,geometricWeights)??geometricWeights;
  if(typeof sampled==='number'){if(!Number.isFinite(sampled))throw Error('A simplex response produced a non-finite coordinate.');return sampled;}
  const weights=sampled;
  if(weights.length!==bases.length||weights.some(w=>!Number.isFinite(w))||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('A scalar response must return finite sum-one weights for its active bases.');
  const result=coordinates.reduce((sum,p,index)=>sum+p*weights[index],0);if(!Number.isFinite(result))throw Error('A simplex response produced a non-finite coordinate.');return result;
 };
 const positions=new Map<string,Point2>();
 for(const node of drawing.nodes){const authority=authorities.get(node.id)!;let position=positions.get(authority);if(!position){position=([0,1] as const).map(axis=>sample({kind:'node',nodeId:authority},axis,nodeMaps.map(map=>map.get(authority)!.position[axis]))) as Point2;positions.set(authority,position);}positions.set(node.id,position);}
 drawing.nodes=drawing.nodes.map(node=>({...node,position:positions.get(node.id)!}));
 drawing.curves=drawing.curves.map(curve=>({...curve,handles:([0,1] as const).map(end=>{
  const node=positions.get(curve.nodes[end])!;return ([0,1] as const).map(axis=>node[axis]+sample({kind:'handle',curveId:curve.id,end},axis,curveMaps.map((map,index)=>map.get(curve.id)!.handles[end][axis]-nodeMaps[index].get(curve.nodes[end])!.position[axis]))) as Point2;
 }) as [Point2,Point2]}));
 // Brush/offset numeric parameters retain the ordinary geometric interpolation
 // policy; a control's response does not remap appearance switching or material.
 const scalar=(values:number[])=>values.reduce((sum,value,index)=>sum+value*geometricWeights[index],0);
 drawing.joins=drawing.joins.map(join=>join.mode==='ARC'?{...join,radius:scalar(bases.map(b=>b.drawing.joins.find(j=>j.id===join.id)!.radius!))}:join);
 drawing.endpointLinks=drawing.endpointLinks?.map(link=>link.joinBrush?.kind==='ARC'?{...link,joinBrush:{...link.joinBrush,trimDistance:scalar(bases.map(b=>{const brush=b.drawing.endpointLinks!.find(l=>l.id===link.id)!.joinBrush!;return brush.kind==='ARC'?brush.trimDistance:0;}))}}:link);
 drawing.offsets=drawing.offsets.map(offset=>{const sources=bases.map(b=>b.drawing.offsets.find(o=>o.id===offset.id)!);return sources.some(o=>o.translation)?{...offset,translation:([0,1] as const).map(axis=>scalar(sources.map(o=>o.translation?.[axis]??0))) as Point2}:offset;});
 const smooth=response&&'projectSmooth' in response&&response.projectSmooth?response.projectSmooth(drawing):applyEndpointPairSmoothConstraints(drawing);diagnostics.push(...smooth.diagnostics);
 return {drawing:smooth.drawing,diagnostics:[...new Set(diagnostics)],nodeAuthorities:authorities};
}
