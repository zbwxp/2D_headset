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
/** A plan belongs to one exact ordered tuple of immutable basis drawings and
 * recorder bindings. Rebuild it when any drawing or binding changes. */
export interface PreparedSnapshotSimplexGeometry {sample(geometricWeights:readonly number[],response?:SnapshotScalarResponse):SnapshotSimplexGeometry}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const keys=<T extends {id:string}>(items:readonly T[])=>new Map(items.map(item=>[item.id,item]));
const axes=[0,1] as const;
type ScalarCoordinates=readonly [readonly number[],readonly number[]];
interface ControlPlan {target:SnapshotScalarTarget;coordinates:ScalarCoordinates}

const validateWeights=(count:number,weights:readonly number[])=>{
 if(count!==weights.length)throw Error('A snapshot simplex needs one to three distinct active bases.');
 if(weights.some(w=>!Number.isFinite(w)||w<=0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('Active geometric weights must be positive and sum to one.');
};

/** Compile the same final-control geometry for repeated angles on one immutable
 * simplex. Membership, relation compatibility, linked-node coherence and scalar
 * basis coordinates are angle-independent; only the selected metadata/order,
 * response values and shared SMOOTH projection vary while sampling. */
export function prepareSnapshotSimplexGeometry(bases:readonly SnapshotSimplexBasis[]):PreparedSnapshotSimplexGeometry {
 if(bases.length<1||bases.length>3||new Set(bases.map(b=>b.snapshotId)).size!==bases.length)throw Error('A snapshot simplex needs one to three distinct active bases.');
 const count=bases.length;
 if(count===1){const drawing=bases[0].drawing,authorities=endpointPairNodeAuthorities(drawing);return {sample(weights){validateWeights(count,weights);return {drawing,diagnostics:[],nodeAuthorities:new Map(authorities)};}};}
 const bindings=bases.map(({snapshotId,angle})=>({snapshotId,angle:angle&&{...angle}}));
 const curveMaps=bases.map(b=>keys(b.drawing.curves)),nodeMaps=bases.map(b=>keys(b.drawing.nodes));
 const joinMaps=bases.map(b=>keys(b.drawing.joins)),linkMaps=bases.map(b=>keys(b.drawing.endpointLinks??[])),fillMaps=bases.map(b=>keys(b.drawing.fills)),offsetMaps=bases.map(b=>keys(b.drawing.offsets)),intervalMaps=bases.map(b=>keys(b.drawing.displayIntervals??[]));
 const coordinates=(value:(index:number,axis:0|1)=>number):ScalarCoordinates=>axes.map(axis=>Object.freeze(bases.map((_,index)=>value(index,axis)))) as unknown as ScalarCoordinates;
 const nodeControls=new Map<string,ControlPlan>(),handleControls=new Map<string,readonly [ControlPlan,ControlPlan]>();
 const nodeControl=(id:string):ControlPlan=>{
  let control=nodeControls.get(id);if(!control){control={target:Object.freeze({kind:'node',nodeId:id}),coordinates:coordinates((index,axis)=>nodeMaps[index].get(id)!.position[axis])};nodeControls.set(id,control);}return control;
 };
 const curveControls=(curve:DrawingDocument['curves'][number]):readonly [ControlPlan,ControlPlan]=>{
  let controls=handleControls.get(curve.id);if(!controls){controls=axes.map(end=>({target:Object.freeze({kind:'handle' as const,curveId:curve.id,end}),coordinates:coordinates((index,axis)=>curveMaps[index].get(curve.id)!.handles[end][axis]-nodeMaps[index].get(curve.nodes[end])!.position[axis])})) as [ControlPlan,ControlPlan];handleControls.set(curve.id,controls);}return controls;
 };
 const variants=bases.map(({drawing:selected})=>{
 const diagnostics:string[]=[];
 const curves=selected.curves.filter(curve=>{
  if(!curveMaps.every(map=>map.has(curve.id)))return false;
  if(!curveMaps.every(map=>same(map.get(curve.id)!.nodes,curve.nodes))){diagnostics.push(`Curve ${curve.id} has incompatible canonical endpoint topology in the active snapshots and is inactive.`);return false;}
  if(!curve.nodes.every(id=>nodeMaps.every(map=>map.has(id)))){diagnostics.push(`Curve ${curve.id} is missing an endpoint dependency and is inactive.`);return false;}
  return true;
 });
 const curveIds=new Set(curves.map(c=>c.id)),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 const shared=<T extends {id:string}>(name:string,collection:readonly T[],maps:readonly ReadonlyMap<string,T>[],shape:(item:T)=>unknown,valid:(item:T)=>boolean):T[]=>{
  return collection.filter(item=>{
   if(!valid(item))return false;
   if(maps.some(map=>!map.has(item.id)||!same(shape(map.get(item.id)!),shape(item)))){diagnostics.push(`${name} ${item.id} is not shared with compatible references by every active snapshot and is inactive.`);return false;}
   return true;
  });
 };
 const endpointsPresent=(item:{a:{curveId:string};b:{curveId:string}})=>curveIds.has(item.a.curveId)&&curveIds.has(item.b.curveId);
 const joins=shared('Join',selected.joins,joinMaps,j=>[j.a,j.b,j.mode],endpointsPresent);
 const endpointLinks=shared('EndpointLink',selected.endpointLinks??[],linkMaps,l=>[l.a,l.b,l.throughDisplay,l.joinBrush?.kind],endpointsPresent).filter(link=>{
  const coherent=bases.every((_,index)=>{const a=curveMaps[index].get(link.a.curveId)!,b=curveMaps[index].get(link.b.curveId)!,p=nodeMaps[index].get(a.nodes[link.a.end])!.position,q=nodeMaps[index].get(b.nodes[link.b.end])!.position;return Math.hypot(p[0]-q[0],p[1]-q[1])<=64*Number.EPSILON*Math.max(1,...p.map(Math.abs),...q.map(Math.abs));});
  if(!coherent)diagnostics.push(`EndpointLink ${link.id} has different endpoint positions in an active basis and is inactive; its curves are not silently snapped.`);return coherent;
 });
 const fills=shared('Fill',selected.fills,fillMaps,f=>f.boundary,f=>f.boundary.every(u=>curveIds.has(u.id)));
 const offsets=shared('Offset',selected.offsets,offsetMaps,o=>o.source,o=>o.source.every(u=>curveIds.has(u.id)));
 const present=new Set([...curveIds,...fills.map(f=>f.id),...offsets.map(o=>o.id)]),drawing:DrawingDocument={...emptyDrawing(),...selected,curves,nodes:selected.nodes.filter(n=>nodeIds.has(n.id)),fills,offsets,joins,endpointLinks,
  layers:selected.layers.map(layer=>({...layer,items:layer.items.filter(id=>present.has(id))})),
  groups:selected.groups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})).filter(group=>group.curveIds.length),
  displayIntervals:[],mirrorEditing:undefined};
 const linkIds=new Set(endpointLinks.map(link=>link.id));
 drawing.displayIntervals=shared('Display interval',selected.displayIntervals??[],intervalMaps,t=>[t.anchor,t.scope,t.displayRoute,t.ranges.map(r=>r.id)],t=>curveIds.has(t.anchor.id)&&(!t.displayRoute||t.displayRoute.seed.segments.every(u=>curveIds.has(u.id))&&t.displayRoute.throughLinkIds.every(id=>linkIds.has(id))));
 const authorities=endpointPairNodeAuthorities(drawing);
 const positionIndices=new Map<string,number>(),positions:ControlPlan[]=[];
 const nodes=drawing.nodes.map(node=>{const authority=authorities.get(node.id)!;let position=positionIndices.get(authority);if(position===undefined){position=positions.length;positionIndices.set(authority,position);positions.push(nodeControl(authority));}return {node,position};});
 const controls=drawing.curves.map(curve=>({curve,handles:curveControls(curve),positions:curve.nodes.map(id=>positionIndices.get(authorities.get(id)!)!) as [number,number]}));
 const joinRadii=drawing.joins.map(join=>join.mode==='ARC'?Object.freeze(joinMaps.map(map=>map.get(join.id)!.radius!)):undefined);
 const linkTrims=drawing.endpointLinks!.map(link=>link.joinBrush?.kind==='ARC'?Object.freeze(linkMaps.map(map=>{const brush=map.get(link.id)!.joinBrush!;return brush.kind==='ARC'?brush.trimDistance:0;})):undefined);
 const offsetTranslations=drawing.offsets.map(offset=>offsetMaps.some(map=>map.get(offset.id)!.translation)?coordinates((index,axis)=>offsetMaps[index].get(offset.id)!.translation?.[axis]??0):undefined);
 return {drawing,diagnostics,authorities,positions,nodes,controls,joinRadii,linkTrims,offsetTranslations};
 });
 return {sample(geometricWeights,response){
 validateWeights(count,geometricWeights);
 const variant=variants[dominantSnapshotBasis(bindings,geometricWeights)],template=variant.drawing,diagnostics=[...variant.diagnostics];
 const sample=(control:ControlPlan,axis:0|1):number=>{
  const coordinates=control.coordinates[axis],sampled=response?.(control.target,axis,coordinates,geometricWeights)??geometricWeights;
  if(typeof sampled==='number'){if(!Number.isFinite(sampled))throw Error('A simplex response produced a non-finite coordinate.');return sampled;}
  const weights=sampled;
  if(weights.length!==count||weights.some(w=>!Number.isFinite(w))||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('A scalar response must return finite sum-one weights for its active bases.');
  const result=coordinates.reduce((sum,p,index)=>sum+p*weights[index],0);if(!Number.isFinite(result))throw Error('A simplex response produced a non-finite coordinate.');return result;
 };
 // Only authored discrete values are shared with immutable bases. Every array
 // and point constructed for a sample is owned by that sample, including the
 // filtered layer/group collections and the caller-visible authority map.
 const positions=variant.positions.map(control=>[sample(control,0),sample(control,1)] as Point2);
 const drawing:DrawingDocument={...template,
  nodes:variant.nodes.map(({node,position})=>({...node,position:positions[position]})),
  curves:variant.controls.map(({curve,handles,positions:indices})=>({...curve,handles:axes.map(end=>{const node=positions[indices[end]],control=handles[end];return [node[0]+sample(control,0),node[1]+sample(control,1)] as Point2;}) as [Point2,Point2]})),
  fills:[...template.fills],displayIntervals:[...template.displayIntervals!],
  layers:template.layers.map(layer=>({...layer,items:[...layer.items]})),
  groups:template.groups?.map(group=>({...group,curveIds:[...group.curveIds]}))};
 // Brush/offset numeric parameters retain the ordinary geometric interpolation
 // policy; a control's response does not remap appearance switching or material.
 const scalar=(values:readonly number[])=>values.reduce((sum,value,index)=>sum+value*geometricWeights[index],0);
 drawing.joins=template.joins.map((join,index)=>variant.joinRadii[index]?{...join,radius:scalar(variant.joinRadii[index]!)}:join);
 drawing.endpointLinks=template.endpointLinks!.map((link,index)=>link.joinBrush?.kind==='ARC'?{...link,joinBrush:{...link.joinBrush,trimDistance:scalar(variant.linkTrims[index]!)}}:link);
 drawing.offsets=template.offsets.map((offset,index)=>{const coordinates=variant.offsetTranslations[index];return coordinates?{...offset,translation:[scalar(coordinates[0]),scalar(coordinates[1])]}:offset;});
 const smooth=response&&'projectSmooth' in response&&response.projectSmooth?response.projectSmooth(drawing):applyEndpointPairSmoothConstraints(drawing);diagnostics.push(...smooth.diagnostics);
 return {drawing:smooth.drawing,diagnostics:[...new Set(diagnostics)],nodeAuthorities:new Map(variant.authorities)};
 }};
}

/** Final-control geometry for one real vertex, shared edge or triangle. Mutable
 * external callers retain fresh preparation on every call; immutable recording
 * contexts explicitly retain a prepared plan instead. No nearest-member fill,
 * hidden-line filtering, ink construction or material parsing occurs here. */
export function interpolateSnapshotSimplexGeometry(bases:readonly SnapshotSimplexBasis[],geometricWeights:readonly number[],response?:SnapshotScalarResponse):SnapshotSimplexGeometry {
 return prepareSnapshotSimplexGeometry(bases).sample(geometricWeights,response);
}
