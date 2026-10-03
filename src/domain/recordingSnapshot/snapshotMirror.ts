import type {CurveUse,DrawingDocument,Endpoint,End,Point2,StrokeDisplayIntervals} from '../drawing/model';
import type {MirrorCurvePair} from '../drawing/mirrorEditing';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from '../drawing/evaluatedAffine';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {scaleEvaluatedDisplayRouteBrush} from '../drawing/displayRouteBrush';

export interface SnapshotMirrorOptions {
 /** A caller-selected coordinate, never inferred from geometry or names. */
 axisX:number;
 curvePairs:readonly MirrorCurvePair[];
 /** Legacy axis references; explicit pair endpoints remain authoritative.
  * Distinct left/right axis nodes can exchange IDs and are never clamped. */
 axisNodeIds?:readonly string[];
}
export interface SnapshotMirrorCurveCorrespondence {id:string;reverse:boolean}
export interface SnapshotMirrorCorrespondence {
 curves:Record<string,SnapshotMirrorCurveCorrespondence>;
 nodes:Record<string,string>;
 fills:Record<string,string>;
 offsets:Record<string,string>;
 layers:Record<string,string>;
 joins:Record<string,string>;
 endpointLinks:Record<string,string>;
 groups:Record<string,string>;
 displayIntervals:Record<string,string>;
 ranges:Record<string,string>;
}
export type SnapshotMirrorEntityKind=Exclude<keyof SnapshotMirrorCorrespondence,'curves'|'nodes'>;
export interface SnapshotMirrorDiagnostic {
 code:'UNMATCHED_ENTITY'|'AMBIGUOUS_ENTITY';
 entityKind:SnapshotMirrorEntityKind;
 entityId:string;
 message:string;
}
export type SnapshotMirrorErrorCode='INVALID_AXIS'|'INVALID_REFERENCE'|'PAIR_CONFLICT'|'NODE_CONFLICT';
/** A failed compile leaves the complete source document untouched. */
export class SnapshotMirrorError extends Error {
 constructor(readonly code:SnapshotMirrorErrorCode,message:string){super(message);this.name='SnapshotMirrorError';}
}
export interface SnapshotMirrorResult {
 drawing:DrawingDocument;
 correspondence:SnapshotMirrorCorrespondence;
 diagnostics:SnapshotMirrorDiagnostic[];
}
const fail=(code:SnapshotMirrorErrorCode,message:string):never=>{throw new SnapshotMirrorError(code,message);};
const flip=(end:End,reverse:boolean):End=>reverse?(end===0?1:0):end;
const encoded=(value:unknown)=>JSON.stringify(value);
const endSignature=(end:Endpoint)=>encoded([end.curveId,end.end]);
const usesSignature=(uses:readonly CurveUse[])=>encoded(uses.map(use=>[use.id,use.reverse]));
const setSignature=(ids:readonly string[])=>encoded([...ids].sort());
const relationSignature=(relation:{a:Endpoint;b:Endpoint})=>setSignature([endSignature(relation.a),endSignature(relation.b)]);
/** A fill is a closed boundary: its starting segment and winding do not select
 * different material. No other directed path receives this normalization. */
function boundarySignature(uses:readonly CurveUse[]):string {
 if(!uses.length)return '[]';
 const reverse=[...uses].reverse().map(use=>({...use,reverse:!use.reverse}));
 return [uses,reverse].flatMap(path=>path.map((_,i)=>usesSignature([...path.slice(i),...path.slice(0,i)]))).sort()[0];
}

/** Match only reciprocal unique topologies. In particular, two same-boundary
 * masks or offsets cannot silently steal one another's canonical identity. */
function entityCorrespondence<T extends {id:string}>(
 values:readonly T[],kind:SnapshotMirrorEntityKind,
 signature:(value:T,mapped:boolean)=>string,diagnostics:SnapshotMirrorDiagnostic[],
 semanticRole?:(value:T)=>string,
):Record<string,string> {
 const originals=new Map<string,string[]>();
 for(const value of values){const key=signature(value,false);originals.set(key,[...(originals.get(key)??[]),value.id]);}
 const byId=new Map(values.map(value=>[value.id,value]));
 const topologicalCandidates=new Map(values.map(value=>[value.id,originals.get(signature(value,true))??[]]));
 const candidates=new Map(values.map(value=>{
  const matches=topologicalCandidates.get(value.id)!;
  // A solid fill and a mist fill may intentionally share one boundary. Their
  // explicit semantic roles can resolve this ambiguity; numeric geometry,
  // labels, order and distance are never candidate-selection heuristics.
  const ambiguous=matches.length>1||(originals.get(signature(value,false))?.length??0)>1;
  return [value.id,semanticRole&&ambiguous?matches.filter(id=>semanticRole(byId.get(id)!)===semanticRole(value)):matches];
 }));
 const result:Record<string,string>=Object.fromEntries(values.map(value=>[value.id,value.id]));
 for(const value of values){
  const matches=candidates.get(value.id)!,target=matches[0];
  if(matches.length===1&&candidates.get(target)?.length===1&&candidates.get(target)![0]===value.id){result[value.id]=target;continue;}
  // An already self-corresponding entity needs no choice between identical
  // neighboring objects; retaining its identity is the exact safe operation.
  if(signature(value,true)===signature(value,false))continue;
  const ambiguous=topologicalCandidates.get(value.id)!.length>0;
  diagnostics.push({code:ambiguous?'AMBIGUOUS_ENTITY':'UNMATCHED_ENTITY',entityKind:kind,entityId:value.id,
   message:`${kind} ${value.id} has ${ambiguous?'no unique reciprocal':'no exact'} mirrored topology counterpart; its ID is retained and its references follow the mirror.${kind==='layers'?' Canonical layer ownership/order correspondence needs local review.':''}`});
 }
 return result;
}

/** Reflect one evaluated drawing using canonical semantic identities. This is
 * a pure input-domain operation, not an editing constraint or a geometry store.
 * Every directed route keeps its original travel parameter: only each use's
 * end parity changes. No ranges, path order, or interval brushes are reversed.
 *
 * Array traversal and layer item traversal follow the source, with IDs mapped
 * in place. This preserves reflected paint order, including unequal depth.
 * All entity maps are involutions; missing/ambiguous counterparts stay local.
 */
export function mirrorSnapshotDrawing(drawing:DrawingDocument,options:SnapshotMirrorOptions):SnapshotMirrorResult {
 if(!options||!Number.isFinite(options.axisX))fail('INVALID_AXIS','Snapshot reflection requires an explicit finite axisX.');
 const curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),nodes=new Set(drawing.nodes.map(node=>node.id));
 if(curves.size!==drawing.curves.length||nodes.size!==drawing.nodes.length)fail('INVALID_REFERENCE','Canonical curve and node IDs must be unique.');
 const curveMap:SnapshotMirrorCorrespondence['curves']=Object.fromEntries(drawing.curves.map(curve=>[curve.id,{id:curve.id,reverse:false}]));
 const paired=new Set<string>(),pairIds=new Set<string>();
 if(!Array.isArray(options.curvePairs))fail('INVALID_REFERENCE','Snapshot reflection requires explicit curvePairs.');
 for(const pair of options.curvePairs){
  if(!pair||typeof pair.id!=='string'||!pair.id||pairIds.has(pair.id)||typeof pair.reverse!=='boolean')fail('PAIR_CONFLICT','Mirror pair IDs and directions must be valid and unique.');
  if(!curves.has(pair.a)||!curves.has(pair.b))fail('INVALID_REFERENCE',`Mirror pair ${pair.id} refers to a missing curve.`);
  if(paired.has(pair.a)||paired.has(pair.b))fail('PAIR_CONFLICT',`Mirror pair ${pair.id} reuses an already paired curve.`);
  pairIds.add(pair.id);paired.add(pair.a);paired.add(pair.b);
  curveMap[pair.a]={id:pair.b,reverse:pair.reverse};curveMap[pair.b]={id:pair.a,reverse:pair.reverse};
 }
 const nodeMap:Record<string,string>=Object.create(null),nodeTargets=new Map<string,string>();
 const bindNode=(source:string,target:string)=>{
  if(!nodes.has(source)||!nodes.has(target))fail('INVALID_REFERENCE','A mirror endpoint refers to a missing canonical node.');
  if(Object.hasOwn(nodeMap,source)&&nodeMap[source]!==target||nodeTargets.has(target)&&nodeTargets.get(target)!==source)
   fail('NODE_CONFLICT',`Mirror endpoint correspondence is not one-to-one at node ${source}.`);
  nodeMap[source]=target;nodeTargets.set(target,source);
 };
 // Only explicit pairs infer node correspondence. An unpaired new curve can
 // share a paired node: it keeps its own curve ID and follows that node's map,
 // without inventing a partner or breaking its genuine shared-node connection.
 for(const curve of drawing.curves){
  if(curve.nodes.some(id=>!nodes.has(id)))fail('INVALID_REFERENCE',`Curve ${curve.id} refers to a missing canonical node.`);
  if(paired.has(curve.id)){const map=curveMap[curve.id],target=curves.get(map.id)!;for(const end of [0,1] as const)bindNode(curve.nodes[end],target.nodes[flip(end,map.reverse)]);}
 }
 for(const id of options.axisNodeIds??[])if(!nodes.has(id))fail('INVALID_REFERENCE',`Mirror axis refers to missing canonical node ${id}.`);
 for(const id of nodes)if(!Object.hasOwn(nodeMap,id))bindNode(id,id);
 for(const id of nodes)if(nodeMap[nodeMap[id]]!==id)fail('NODE_CONFLICT',`Mirror node correspondence is not an involution at ${id}.`);

 const mappedCurve=(id:string)=>curveMap[id]??fail('INVALID_REFERENCE',`Mirror reference points to missing curve ${id}.`);
 const use=(value:CurveUse):CurveUse=>{const map=mappedCurve(value.id);return {...value,id:map.id,reverse:value.reverse!==map.reverse};};
 const endpoint=(value:Endpoint):Endpoint=>{const map=mappedCurve(value.curveId);return {...value,curveId:map.id,end:flip(value.end,map.reverse)};};
 const diagnostics:SnapshotMirrorDiagnostic[]=[];
 const joins=entityCorrespondence(drawing.joins,'joins',(value,mapped)=>relationSignature(mapped?{a:endpoint(value.a),b:endpoint(value.b)}:value),diagnostics);
 const links=entityCorrespondence(drawing.endpointLinks??[],'endpointLinks',(value,mapped)=>relationSignature(mapped?{a:endpoint(value.a),b:endpoint(value.b)}:value),diagnostics);
 const fills=entityCorrespondence(drawing.fills,'fills',(value,mapped)=>boundarySignature(mapped?value.boundary.map(use):value.boundary),diagnostics,value=>encoded([value.color,value.mist?[value.mist.enabled,value.mist.side]:null]));
 const offsets=entityCorrespondence(drawing.offsets,'offsets',(value,mapped)=>usesSignature(mapped?value.source.map(use):value.source),diagnostics);
 const groups=entityCorrespondence(drawing.groups??[],'groups',(value,mapped)=>setSignature(mapped?value.curveIds.map(id=>mappedCurve(id).id):value.curveIds),diagnostics);
 const linkId=(id:string)=>links[id]??fail('INVALID_REFERENCE',`Mirror route points to missing endpoint link ${id}.`);
 const trackSignature=(track:StrokeDisplayIntervals,mapped:boolean)=>encoded([
  track.scope??'STROKE',usesSignature([mapped?use(track.anchor):track.anchor]),
  track.displayRoute?[track.displayRoute.seed.closed,usesSignature(mapped?track.displayRoute.seed.segments.map(use):track.displayRoute.seed.segments),setSignature(mapped?track.displayRoute.throughLinkIds.map(linkId):track.displayRoute.throughLinkIds)]:null,
 ]);
 const intervals=entityCorrespondence(drawing.displayIntervals??[],'displayIntervals',trackSignature,diagnostics);
 const allRanges=(drawing.displayIntervals??[]).flatMap(track=>track.ranges.map(range=>({...range,trackId:track.id})));
 // Range equality is an exact material parameter match within its mapped track,
 // never ordinal pairing or a nearest-cut heuristic. Unequal authored cuts keep
 // their own IDs and remain fully editable in the mirrored track.
 const ranges=entityCorrespondence(allRanges,'ranges',(range,mapped)=>encoded([mapped?intervals[range.trackId]:range.trackId,range.start,range.end,range.fullLoop??false,range.mode??'SHOW']),diagnostics);
 const objectId=(id:string)=>curveMap[id]?.id??fills[id]??offsets[id]??fail('INVALID_REFERENCE',`Mirror layer points to missing object ${id}.`);
 const layers=entityCorrespondence(drawing.layers,'layers',(layer,mapped)=>setSignature(mapped?layer.items.map(objectId):layer.items),diagnostics);
 const correspondence:SnapshotMirrorCorrespondence={curves:curveMap,nodes:nodeMap,fills,offsets,layers,joins,endpointLinks:links,groups,displayIntervals:intervals,ranges};
 const reflect=([x,y]:Point2):Point2=>[2*options.axisX-x,y];
 const pinches=new Map((drawing.displayIntervals??[]).flatMap(track=>track.ranges.map(range=>[range.id,intervalPinch(range)] as const)));
 const d=structuredClone(drawing);
 const result:DrawingDocument={...d,
  nodes:d.nodes.map(node=>({...node,id:nodeMap[node.id],position:reflect(node.position)})),
  curves:d.curves.map(curve=>{
   const map=curveMap[curve.id],target=curves.get(map.id)!;
   const order=map.reverse?[1,0] as const:[0,1] as const;
   const next={...curve,id:map.id,nodes:order.map(end=>nodeMap[curve.nodes[end]]) as [string,string],handles:order.map(end=>reflect(curve.handles[end])) as [Point2,Point2],
    ...(curve.inkEnds?{inkEnds:order.map(end=>curve.inkEnds![end]) as typeof curve.inkEnds}:{}),
   };
   // Canonical profile direction remains attached to its semantic counterpart.
   // Toggling an omitted legacy profileReverse would make an exact data
   // involution impossible (undefined and false both denote forward).
   for(const key of ['profile','profileReverse'] as const){delete next[key];if(Object.hasOwn(target,key))Object.assign(next,{[key]:target[key]});}
   return next;
  }),
  fills:d.fills.map(fill=>({...fill,id:fills[fill.id],boundary:fill.boundary.map(use)})),
  offsets:d.offsets.map(offset=>({...offset,id:offsets[offset.id],source:offset.source.map(use),distance:-offset.distance,...(offset.translation?{translation:[-offset.translation[0],offset.translation[1]] as Point2}:{})})),
  layers:d.layers.map(layer=>({...layer,id:layers[layer.id],items:layer.items.map(objectId)})),
  // Matching is undirected; payload a/b is deliberately not normalized. This
  // carries a SMOOTH relation's existing driver through the reflection exactly.
  joins:d.joins.map(join=>({...join,id:joins[join.id],a:endpoint(join.a),b:endpoint(join.b)})),
  ...(d.endpointLinks?{endpointLinks:d.endpointLinks.map((link,index)=>({...link,id:links[link.id],a:endpoint(link.a),b:endpoint(link.b),
   ...(link.joinBrush?.kind==='ARC'?{joinBrush:scaleEvaluatedDisplayRouteBrush(drawing.endpointLinks![index].joinBrush!,1)}:{}),
  }))}:{}),
  ...(d.groups?{groups:d.groups.map(group=>({...group,id:groups[group.id],curveIds:group.curveIds.map(id=>mappedCurve(id).id)}))}:{}),
  ...(d.displayIntervals?{displayIntervals:d.displayIntervals.map(track=>({...track,id:intervals[track.id],anchor:use(track.anchor),
   ...(track.revealFrom!==undefined?{revealFrom:flip(track.revealFrom,mappedCurve(track.anchor.id).reverse)}:{}),
   ...(track.displayRoute?{displayRoute:{...track.displayRoute,seed:{...track.displayRoute.seed,segments:track.displayRoute.seed.segments.map(use)},throughLinkIds:track.displayRoute.throughLinkIds.map(linkId)}}:{}),
   ranges:track.ranges.map(range=>withIntervalPinch({...range,id:ranges[range.id],...(range.originId?{originId:ranges[range.originId]??range.originId}:{})},pinches.get(range.id)??0)),
  }))}:{}),
  ...(d.mirrorAxisX!==undefined?{mirrorAxisX:2*options.axisX-d.mirrorAxisX}:{}),
 };
 // Preserve the existing deferred-derived-geometry adapter. Reflecting its
 // material document and conjugating A by R gives R(A(p)) exactly, including
 // nonuniform/singular affine images of ARC joins. Rebuilding a circle from
 // the already-placed controls would silently change that geometry.
 const material=evaluatedAffineSource(drawing);
 if(material){
  const mirroredMaterial=mirrorSnapshotDrawing(material,options).drawing;
  const sourceId=(id:string)=>nodeMap[id]??curveMap[id]?.id??fills[id]??offsets[id]??id;
  registerEvaluatedAffine(result,mirroredMaterial,id=>{
   const affine=evaluatedAffine(drawing,sourceId(id));
   return affine?{point:point=>reflect(affine.point(reflect(point))),maxScale:affine.maxScale}:undefined;
  });
 }
 return {drawing:result,correspondence,diagnostics};
}
