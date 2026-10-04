import {dominantSnapshotBasis} from './simplexSupport';
import {emptyDrawing,type DrawingDocument,type Point2} from '../drawing/model';
import {applyEndpointPairSmoothConstraints,endpointPairNodeAuthorities} from './endpointPair';
import {deriveSmoothComponents,projectSmoothComponent,type SmoothComponent} from './smoothComponent';

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
export interface PreparedSnapshotSimplexGeometry {sample(geometricWeights:readonly number[],response?:SnapshotScalarResponse,options?:{retainLineage?:boolean}):SnapshotSimplexGeometry}
/** Complete, typed output dependency changes from an immutable recording
 * transaction. The producer proves unchanged source, membership, array order,
 * relations, discrete metadata and geometric appearance parameters. These are
 * never inferred from selection and are not accepted by the mutable adapter. */
export interface SnapshotSimplexRevisionChanges {
 structureUnchanged:true;
 basisControls:ReadonlyMap<string,readonly SnapshotScalarTarget[]>;
 responseControls:readonly SnapshotScalarTarget[];
}
const nativeResponses=new WeakSet<SnapshotScalarResponse>();
/** Internal capability: only the compiled native field adapter may register.
 * Generic callbacks still run and validate every coordinate through sample(). */
export function markNativeSnapshotScalarResponse<T extends SnapshotScalarResponse>(response:T):T {nativeResponses.add(response);return response;}
const nativeResponse=(response:SnapshotScalarResponse|undefined)=>!response||nativeResponses.has(response);
const samplingStats={scalarEvaluations:0,basisCoordinateReads:0,projectedComponents:0,revisionSamples:0,fullSamples:0,copiedControlSlots:0};
/** Actual scalar calls and retained-native kernel projections. Arbitrary custom
 * projection hooks are opaque; their internal work is not included. Container
 * slot copies are reported separately from numerical dependency work. */
export const getSnapshotSimplexSamplingStats=()=>({...samplingStats});
export const resetSnapshotSimplexSamplingStats=()=>{for(const key of Object.keys(samplingStats) as (keyof typeof samplingStats)[])samplingStats[key]=0;};
type ReviseSample=(bases:readonly SnapshotSimplexBasis[],weights:readonly number[],response:SnapshotScalarResponse|undefined,changes:SnapshotSimplexRevisionChanges)=>SnapshotSimplexGeometry|undefined;
const sampleLineages=new WeakMap<SnapshotSimplexGeometry,ReviseSample>();
export interface SnapshotSimplexDrawingRevision {readonly previous:DrawingDocument;readonly dirtyCurveIds:readonly string[]}
const drawingRevisions=new WeakMap<DrawingDocument,SnapshotSimplexDrawingRevision>();
/** Proven complete native output closure for downstream geometry-dependent
 * products. The previous token is the pre-material projected sample, and the
 * frozen addresses include every affected SMOOTH member, not just its driver. */
export const snapshotSimplexDrawingRevision=(drawing:DrawingDocument):SnapshotSimplexDrawingRevision|undefined=>drawingRevisions.get(drawing);
/** No ID-only cache: the previous complete immutable sample is the capability.
 * Unsupported response/program dependencies return to canonical preparation. */
export function reviseSnapshotSimplexGeometry(previous:SnapshotSimplexGeometry,bases:readonly SnapshotSimplexBasis[],weights:readonly number[],response:SnapshotScalarResponse|undefined,changes:SnapshotSimplexRevisionChanges):SnapshotSimplexGeometry|undefined {
 return nativeResponse(response)?sampleLineages.get(previous)?.(bases,weights,response,changes):undefined;
}
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
 if(count===1){const drawing=bases[0].drawing,authorities=endpointPairNodeAuthorities(drawing);return {sample(weights){samplingStats.fullSamples++;validateWeights(count,weights);return {drawing,diagnostics:[],nodeAuthorities:new Map(authorities)};}};}
 const bindings=bases.map(({snapshotId,angle})=>({snapshotId,angle:angle&&{...angle}}));
 const curveMaps=bases.map(b=>keys(b.drawing.curves)),nodeMaps=bases.map(b=>keys(b.drawing.nodes));
 const joinMaps=bases.map(b=>keys(b.drawing.joins)),linkMaps=bases.map(b=>keys(b.drawing.endpointLinks??[])),fillMaps=bases.map(b=>keys(b.drawing.fills)),offsetMaps=bases.map(b=>keys(b.drawing.offsets)),intervalMaps=bases.map(b=>keys(b.drawing.displayIntervals??[]));
 const coordinates=(value:(index:number,axis:0|1)=>number):ScalarCoordinates=>axes.map(axis=>Object.freeze(bases.map((_,index)=>{samplingStats.basisCoordinateReads++;return value(index,axis);}))) as unknown as ScalarCoordinates;
 const nodeAddresses=bases.map(b=>new Map(b.drawing.nodes.map((node,index)=>[node.id,index]))),curveAddresses=bases.map(b=>new Map(b.drawing.curves.map((curve,index)=>[curve.id,index])));
 const sourceNode=(sources:readonly SnapshotSimplexBasis[],index:number,id:string)=>{const node=sources[index].drawing.nodes[nodeAddresses[index].get(id)!];return node?.id===id?node:undefined;};
 const sourceCurve=(sources:readonly SnapshotSimplexBasis[],index:number,id:string)=>{const curve=sources[index].drawing.curves[curveAddresses[index].get(id)!];return curve?.id===id?curve:undefined;};
 const nodeControls=new Map<string,ControlPlan>(),handleControls=new Map<string,readonly [ControlPlan,ControlPlan]>();
 const nodeControl=(id:string):ControlPlan=>{
  let control=nodeControls.get(id);if(!control){control={target:Object.freeze({kind:'node',nodeId:id}),coordinates:coordinates((index,axis)=>nodeMaps[index].get(id)!.position[axis])};nodeControls.set(id,control);}return control;
 };
 const curveControls=(curve:DrawingDocument['curves'][number]):readonly [ControlPlan,ControlPlan]=>{
  let controls=handleControls.get(curve.id);if(!controls){controls=axes.map(end=>({target:Object.freeze({kind:'handle' as const,curveId:curve.id,end}),coordinates:coordinates((index,axis)=>curveMaps[index].get(curve.id)!.handles[end][axis]-nodeMaps[index].get(curve.nodes[end])!.position[axis])})) as [ControlPlan,ControlPlan];handleControls.set(curve.id,controls);}return controls;
 };
 const prepareVariant=(selected:DrawingDocument)=>{
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
 const candidateLinks=shared('EndpointLink',selected.endpointLinks??[],linkMaps,l=>[l.a,l.b,l.throughDisplay,l.joinBrush?.kind],endpointsPresent);
 const endpointLinks=candidateLinks.filter(link=>{
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
 const allControls=[...positions,...controls.flatMap(value=>value.handles)],inputNodes=new Map<string,Set<ControlPlan>>(),positionNodes=new Map<ControlPlan,number[]>(),positionEnds=new Map<ControlPlan,{curve:number;end:0|1}[]>(),handleEnds=new Map<ControlPlan,{curve:number;end:0|1}>(),outputNodes=new Map<string,ControlPlan>(),outputHandles=new Map<string,readonly [ControlPlan,ControlPlan]>();
 const input=(id:string,control:ControlPlan)=>{let set=inputNodes.get(id);if(!set){set=new Set();inputNodes.set(id,set);}set.add(control);};
 positions.forEach(control=>{if(control.target.kind==='node')input(control.target.nodeId,control);});
 nodes.forEach(({node,position},index)=>{const control=positions[position];outputNodes.set(node.id,control);positionNodes.set(control,[...positionNodes.get(control)??[],index]);});
 controls.forEach(({curve,handles,positions:indices},index)=>{outputHandles.set(curve.id,handles);axes.forEach(end=>{input(curve.nodes[end],handles[end]);handleEnds.set(handles[end],{curve:index,end});const position=positions[indices[end]];positionEnds.set(position,[...positionEnds.get(position)??[],{curve:index,end}]);});});
 const components=deriveSmoothComponents([...drawing.joins.filter(join=>join.mode==='SMOOTH'),...endpointLinks.filter(link=>link.joinBrush?.kind==='SMOOTH')]),curveIndices=new Map(controls.map(({curve},index)=>[curve.id,index])),nodeIndices=new Map(nodes.map(({node},index)=>[node.id,index])),handleComponents=new Map<ControlPlan,number[]>();
 components.forEach((component,index)=>component.members.forEach(({endpoint})=>{const control=outputHandles.get(endpoint.curveId)![endpoint.end];handleComponents.set(control,[...handleComponents.get(control)??[],index]);}));
 const incidentLinks=new Map<string,typeof candidateLinks>();
 for(const link of candidateLinks)for(const endpoint of [link.a,link.b]){const nodeId=curveMaps[0].get(endpoint.curveId)!.nodes[endpoint.end];incidentLinks.set(nodeId,[...incidentLinks.get(nodeId)??[],link]);}
 return {drawing,diagnostics,authorities,positions,nodes,controls,joinRadii,linkTrims,offsetTranslations,allControls,inputNodes,positionNodes,positionEnds,handleEnds,outputNodes,outputHandles,components,curveIndices,nodeIndices,handleComponents,incidentLinks};
 };
 // A fresh standalone call needs only its selected variant. Retained immutable
 // plans compile the other metadata/order variants only when an angle uses them.
 type Variant=ReturnType<typeof prepareVariant>;
 const projectNative=(variant:Variant,raw:DrawingDocument,diagnostics:string[][],previous?:DrawingDocument,dirty?:ReadonlySet<number>,changedEnds?:ReadonlyMap<number,ReadonlySet<0|1>>):DrawingDocument=>{
  if(previous)samplingStats.copiedControlSlots+=previous.curves.length;
  const curves=previous?[...previous.curves]:raw.curves.map(curve=>({...curve,handles:curve.handles.map(point=>[...point]) as [Point2,Point2]}));
  const owned=new Set<number>();
  const setHandle=(index:number,end:0|1,point:Point2)=>{if(!owned.has(index)){curves[index]={...curves[index],handles:[...curves[index].handles]};owned.add(index);}curves[index].handles[end]=point;};
  for(const [index,ends] of changedEnds??[])for(const end of ends)setHandle(index,end,raw.curves[index].handles[end]);
  const project=(component:SmoothComponent,index:number)=>{samplingStats.projectedComponents++;const result=projectSmoothComponent(component,component.members.map(({endpoint})=>{const curve=raw.curves[variant.curveIndices.get(endpoint.curveId)!];return {node:raw.nodes[variant.nodeIndices.get(curve.nodes[endpoint.end])!].position,handle:curve.handles[endpoint.end]};}));diagnostics[index]=result.diagnostics;for(const {endpoint,handle} of result.controls)setHandle(variant.curveIndices.get(endpoint.curveId)!,endpoint.end,handle);};
  if(dirty)for(const index of dirty)project(variant.components[index],index);else variant.components.forEach(project);
  return {...raw,curves};
 };
 const retainSample=(variant:Variant,sources:readonly SnapshotSimplexBasis[],weights:readonly number[],values:ReadonlyMap<ControlPlan,Point2>,coordinates:ReadonlyMap<ControlPlan,ScalarCoordinates>,raw:DrawingDocument,projected:DrawingDocument,componentDiagnostics:readonly string[][]):SnapshotSimplexGeometry=>{
  const result={drawing:projected,diagnostics:[...new Set([...variant.diagnostics,...componentDiagnostics.flat()])],nodeAuthorities:new Map(variant.authorities)},originalWeights=[...weights];
  sampleLineages.set(result,(next,nextWeights,response,changes)=>{
   validateWeights(next.length,nextWeights);
   if(!changes.structureUnchanged||next.length!==sources.length||nextWeights.some((weight,index)=>weight!==originalWeights[index])||next.some((basis,index)=>basis.snapshotId!==sources[index].snapshotId||basis.angle?.x!==sources[index].angle?.x||basis.angle?.y!==sources[index].angle?.y||basis.drawing.nodes.length!==sources[index].drawing.nodes.length||basis.drawing.curves.length!==sources[index].drawing.curves.length||basis.drawing!==sources[index].drawing&&!changes.basisControls.has(basis.snapshotId)))return undefined;
   const dirty=new Set<ControlPlan>(),nextCoordinates=new Map(coordinates),changedLinks=new Set<NonNullable<DrawingDocument['endpointLinks']>[number]>();
   samplingStats.copiedControlSlots+=coordinates.size;
   for(let basisIndex=0;basisIndex<next.length;basisIndex++){
    const targets=changes.basisControls.get(next[basisIndex].snapshotId);if(!targets)continue;
    const affected=new Set<ControlPlan>();
    for(const target of targets){if(target.kind==='node'){for(const control of variant.inputNodes.get(target.nodeId)??[])affected.add(control);for(const link of variant.incidentLinks.get(target.nodeId)??[])changedLinks.add(link);}else{const control=variant.outputHandles.get(target.curveId)?.[target.end];if(control)affected.add(control);}}
    for(const control of affected){const target=control.target,prior=nextCoordinates.get(control)!,updated=prior.map(axis=>[...axis]) as [number[],number[]];
     const node=target.kind==='node'?sourceNode(next,basisIndex,target.nodeId):undefined,curve=target.kind==='handle'?sourceCurve(next,basisIndex,target.curveId):undefined,endpoint=curve&&target.kind==='handle'?sourceNode(next,basisIndex,curve.nodes[target.end]):undefined;
     if(target.kind==='node'&&!node||target.kind==='handle'&&(!curve||!endpoint||curve.nodes.some((id,end)=>id!==sourceCurve(sources,basisIndex,target.curveId)?.nodes[end])))return undefined;
     for(const axis of axes){samplingStats.basisCoordinateReads++;updated[axis][basisIndex]=target.kind==='node'?node!.position[axis]:curve!.handles[target.end][axis]-endpoint!.position[axis];}
     if(updated.some((axis,index)=>!Object.is(axis[basisIndex],prior[index][basisIndex]))){nextCoordinates.set(control,updated.map(axis=>Object.freeze(axis)) as unknown as ScalarCoordinates);dirty.add(control);}
    }
   }
   // Coherence changes alter membership/authority. Reprepare before sampling;
   // only links incident to changed source nodes need this geometric guard.
   const coherent=(input:readonly SnapshotSimplexBasis[],link:NonNullable<DrawingDocument['endpointLinks']>[number])=>input.every((_,index)=>{const a=sourceCurve(input,index,link.a.curveId),b=sourceCurve(input,index,link.b.curveId),p=a&&sourceNode(input,index,a.nodes[link.a.end])?.position,q=b&&sourceNode(input,index,b.nodes[link.b.end])?.position;return !!p&&!!q&&Math.hypot(p[0]-q[0],p[1]-q[1])<=64*Number.EPSILON*Math.max(1,...p.map(Math.abs),...q.map(Math.abs));});
   for(const link of changedLinks)if(coherent(sources,link)!==coherent(next,link))return undefined;
   for(const target of changes.responseControls){const control=target.kind==='node'?variant.outputNodes.get(target.nodeId):variant.outputHandles.get(target.curveId)?.[target.end];if(control)dirty.add(control);}
   const nextValues=new Map(values);samplingStats.copiedControlSlots+=values.size;
   for(const control of dirty){const value=axes.map(axis=>{samplingStats.scalarEvaluations++;const input=nextCoordinates.get(control)![axis],sampled=response?.(control.target,axis,input,nextWeights)??nextWeights;
    if(typeof sampled==='number'){if(!Number.isFinite(sampled))throw Error('A simplex response produced a non-finite coordinate.');return sampled;}
    if(sampled.length!==count||sampled.some(weight=>!Number.isFinite(weight))||Math.abs(sampled.reduce((sum,weight)=>sum+weight,0)-1)>1e-9)throw Error('A scalar response must return finite sum-one weights for its active bases.');
    const result=input.reduce((sum,value,index)=>sum+value*sampled[index],0);if(!Number.isFinite(result))throw Error('A simplex response produced a non-finite coordinate.');return result;
   }) as Point2;nextValues.set(control,value);}
   samplingStats.copiedControlSlots+=raw.nodes.length+raw.curves.length;
   const nodes=[...raw.nodes],curves=[...raw.curves],changedEnds=new Map<number,Set<0|1>>(),dirtyComponents=new Set<number>();
   const end=(index:number,side:0|1)=>{let ends=changedEnds.get(index);if(!ends){ends=new Set();changedEnds.set(index,ends);}ends.add(side);};
   for(const control of dirty){for(const index of variant.positionNodes.get(control)??[])nodes[index]={...nodes[index],position:nextValues.get(control)!};for(const endpoint of variant.positionEnds.get(control)??[])end(endpoint.curve,endpoint.end);const handle=variant.handleEnds.get(control);if(handle)end(handle.curve,handle.end);}
   for(const [index,ends] of changedEnds){const plan=variant.controls[index],handles=[...curves[index].handles] as [Point2,Point2];for(const side of ends){const position=nextValues.get(variant.positions[plan.positions[side]])!,vector=nextValues.get(plan.handles[side])!;handles[side]=[position[0]+vector[0],position[1]+vector[1]];for(const component of variant.handleComponents.get(plan.handles[side])??[])dirtyComponents.add(component);}curves[index]={...curves[index],handles};}
   const nextRaw={...raw,nodes,curves},nextDiagnostics=componentDiagnostics.map(value=>value),nextProjected=projectNative(variant,nextRaw,nextDiagnostics,projected,dirtyComponents,changedEnds);
   const dirtyCurves=new Set([...changedEnds.keys()].map(index=>variant.controls[index].curve.id));
   for(const index of dirtyComponents)for(const {endpoint} of variant.components[index].members)dirtyCurves.add(endpoint.curveId);
   drawingRevisions.set(nextProjected,Object.freeze({previous:projected,dirtyCurveIds:Object.freeze([...dirtyCurves])}));
   samplingStats.revisionSamples++;
   return retainSample(variant,next,nextWeights,nextValues,nextCoordinates,nextRaw,nextProjected,nextDiagnostics);
  });return result;
 };
 const variants:(ReturnType<typeof prepareVariant>|undefined)[]=new Array(count);
 return {sample(geometricWeights,response,options){
 samplingStats.fullSamples++;
 validateWeights(count,geometricWeights);
 const dominant=dominantSnapshotBasis(bindings,geometricWeights),variant=variants[dominant]??(variants[dominant]=prepareVariant(bases[dominant].drawing)),template=variant.drawing,diagnostics=[...variant.diagnostics];
 const sample=(control:ControlPlan,axis:0|1):number=>{
  samplingStats.scalarEvaluations++;const coordinates=control.coordinates[axis],sampled=response?.(control.target,axis,coordinates,geometricWeights)??geometricWeights;
  if(typeof sampled==='number'){if(!Number.isFinite(sampled))throw Error('A simplex response produced a non-finite coordinate.');return sampled;}
  const weights=sampled;
  if(weights.length!==count||weights.some(w=>!Number.isFinite(w))||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('A scalar response must return finite sum-one weights for its active bases.');
  const result=coordinates.reduce((sum,p,index)=>sum+p*weights[index],0);if(!Number.isFinite(result))throw Error('A simplex response produced a non-finite coordinate.');return result;
 };
 // Only authored discrete values are shared with immutable bases. Every array
 // and point constructed for a sample is owned by that sample, including the
 // filtered layer/group collections and the caller-visible authority map.
 const values=new Map<ControlPlan,Point2>(),samplePoint=(control:ControlPlan):Point2=>{const value:Point2=[sample(control,0),sample(control,1)];values.set(control,value);return value;};
 const positions=variant.positions.map(samplePoint);
 const drawing:DrawingDocument={...template,
  nodes:variant.nodes.map(({node,position})=>({...node,position:positions[position]})),
  curves:variant.controls.map(({curve,handles,positions:indices})=>({...curve,handles:axes.map(end=>{const node=positions[indices[end]],control=handles[end];const vector=samplePoint(control);return [node[0]+vector[0],node[1]+vector[1]] as Point2;}) as [Point2,Point2]})),
  fills:[...template.fills],displayIntervals:[...template.displayIntervals!],
  layers:template.layers.map(layer=>({...layer,items:[...layer.items]})),
  groups:template.groups?.map(group=>({...group,curveIds:[...group.curveIds]}))};
 // Brush/offset numeric parameters retain the ordinary geometric interpolation
 // policy; a control's response does not remap appearance switching or material.
 const scalar=(values:readonly number[])=>values.reduce((sum,value,index)=>sum+value*geometricWeights[index],0);
 drawing.joins=template.joins.map((join,index)=>variant.joinRadii[index]?{...join,radius:scalar(variant.joinRadii[index]!)}:join);
 drawing.endpointLinks=template.endpointLinks!.map((link,index)=>link.joinBrush?.kind==='ARC'?{...link,joinBrush:{...link.joinBrush,trimDistance:scalar(variant.linkTrims[index]!)}}:link);
 drawing.offsets=template.offsets.map((offset,index)=>{const coordinates=variant.offsetTranslations[index];return coordinates?{...offset,translation:[scalar(coordinates[0]),scalar(coordinates[1])]}:offset;});
 if(options?.retainLineage&&nativeResponse(response)){
  const componentDiagnostics=variant.components.map(()=>[] as string[]),projected=projectNative(variant,drawing,componentDiagnostics);
  return retainSample(variant,bases,geometricWeights,values,new Map(variant.allControls.map(control=>[control,control.coordinates])),drawing,projected,componentDiagnostics);
 }
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
