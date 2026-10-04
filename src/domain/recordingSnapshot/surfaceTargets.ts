import {preparedSnapshotSimplexProgram} from './preparedSimplexPrograms';
import {createSnapshotFitParameterCollector} from './responseFitParameterRanges';
import {projectSnapshotResponseCorrections,unprojectSnapshotResponseTarget,snapshotProjectionScalarKey,snapshotResponseProjectionContracts,type SnapshotProjectionScalarSample} from './responseExpressionProjection';
import type {SnapshotSurfaceMirrorContext,SnapshotSurfaceMirrorSample} from './surfaceMirrorContext';
import {finitePoint,sub,type DrawingDocument,type Point2} from '../drawing/model';
import type {Angle,SnapshotAngleGraph,SnapshotControlResponse,SnapshotCorrectionFrame,SnapshotEndpointResponses,SnapshotTriangleControlResponse,SnapshotTriangleResponses,SnapshotResponseExpressionRegistry,SnapshotExpressionControlResponse} from './model';
import {endpointPairNodeAuthorities} from './endpointPair';
import {markNativeSnapshotScalarResponse,interpolateSnapshotSimplexGeometry,type SnapshotScalarTarget,type SnapshotScalarWeights,type SnapshotScalarValue,type SnapshotSimplexBasis} from './simplexGeometry';
import {locateSnapshotSimplex,type SnapshotSimplexLocation} from './triangulation';
import {solveClosestBarycentricWeights,upsertInteriorResponseSample,type BarycentricWeights} from './triangularResponses';
import {createSnapshotExpressionValueSampler,prepareSnapshotExpressionValueProgram,snapshotResponseSourceBaseline,type SnapshotResponseBasisScalarResolver,type SnapshotResponseExpression} from './responseExpressions';
import {createSnapshotResponseBasisResolver,createSnapshotResponseFieldWeightMapper,snapshotResponseExpressionFor} from './responseExpressionRegistry';
import {describeSnapshotScalarResponseSupport,createSnapshotScalarResponseWeightSampler} from './scalarResponseSupport';

const axes=['x','y'] as const;
const own=<T>(record:Record<string,T>|undefined,id:string):T|undefined=>record&&Object.hasOwn(record,id)?record[id]:undefined;
const put=<T>(record:Record<string,T>,id:string,value:T)=>Object.defineProperty(record,id,{value,writable:true,enumerable:true,configurable:true});
const sameAngle=(a:Angle,b:Angle)=>a.x===b.x&&a.y===b.y;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scalarTolerance=(...values:number[])=>64*Number.EPSILON*Math.max(1,...values.map(Math.abs));
const changedScalar=(a:number,b:number)=>Math.abs(a-b)>scalarTolerance(a,b);
const sameWeights=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((weight,index)=>weight===b[index]);
const label=(target:SnapshotScalarTarget)=>target.kind==='node'?`Node ${target.nodeId}`:`Handle ${target.curveId} end ${target.end}`;
const frozenTargetKeys=new WeakMap<SnapshotScalarTarget,readonly [string,string]>();
const targetKey=(target:SnapshotScalarTarget,axis:0|1):string=>{
 const known=frozenTargetKeys.get(target);if(known)return known[axis];
 const key=(axis:0|1)=>JSON.stringify(target.kind==='node'?['node',target.nodeId,axis]:['handle',target.curveId,target.end,axis]);
 const fields=target.kind==='node'?['kind','nodeId']:['kind','curveId','end'];
 if(Object.isFrozen(target)&&fields.every(field=>{const descriptor=Object.getOwnPropertyDescriptor(target,field);return !!descriptor&&'value' in descriptor&&(typeof descriptor.value==='string'||typeof descriptor.value==='number');})){
  const keys=[key(0),key(1)] as const;frozenTargetKeys.set(target,keys);return keys[axis];
 }
 return key(axis);
};

export const snapshotSurfaceOwnsBasisDraft=(graph:SnapshotAngleGraph|undefined,snapshotId:string)=>graph?.correctionFrames?.some(frame=>frame.status==='draft'&&frame.basisAdjustment?.snapshotIds.includes(snapshotId))??false;

export type SnapshotSurfaceTargetEditErrorCode='SURFACE_AXIS_UNAVAILABLE'|'SURFACE_CONSTRAINT_UNSOLVABLE'|'OBJECT_DRAFT_AT_OTHER_ANGLE'|'SURFACE_ARC_BASIS_REQUIRED'|'SURFACE_CORRECTION_REQUIRES_INTERIOR'|'SURFACE_OUTSIDE_COVERAGE'|'SURFACE_INVALID_TARGET';
export class SnapshotSurfaceTargetEditError extends Error {
 constructor(public readonly code:SnapshotSurfaceTargetEditErrorCode,message:string){super(message);this.name='SnapshotSurfaceTargetEditError';}
}
function fail(code:SnapshotSurfaceTargetEditErrorCode,message:string):never {throw new SnapshotSurfaceTargetEditError(code,message);}

/** Saved maps are authoritative. A single draft replaces only the simplex maps
 * it contains, and is effective throughout that simplex, including ghosts. */
export function effectiveSnapshotSurfaceResponses(graph:SnapshotAngleGraph):{edgeResponses:Record<string,SnapshotEndpointResponses>;triangleResponses:Record<string,SnapshotTriangleResponses>;responseExpressions:SnapshotResponseExpressionRegistry;draft?:SnapshotCorrectionFrame} {
 const drafts=(graph.correctionFrames??[]).filter(frame=>frame.status==='draft');
 if(drafts.length>1)fail('SURFACE_INVALID_TARGET','This recorder contains multiple correction drafts. Save or discard them before editing its response surface.');
 const draft=drafts[0];
 return {edgeResponses:draft?.edgeResponses?{...graph.edgeResponses,...draft.edgeResponses}:graph.edgeResponses,
  triangleResponses:draft?.triangleResponses?{...graph.triangleResponses,...draft.triangleResponses}:graph.triangleResponses,responseExpressions:{...graph.responseExpressions,...draft?.responseExpressions},...draft?{draft}:{}};
}

/** The genuine zero column is authored on the negative side. Its response
 * reaches 0+ and positive triangles through B, exactly once. This view masks
 * only that inherited native field, including captured expression fields;
 * saved maps, positive interior corrections, and geometric terms stay intact. */
function positiveMirrorResponseGraph(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,mirror:SnapshotSurfaceMirrorContext|undefined):SnapshotAngleGraph {
 const vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.angle]));
 if(!mirror||location.vertexIds.reduce((sum,id,index)=>sum+vertices.get(id)!.x*location.geometricWeights[index],0)<=0)return graph;
 const zero=new Set(graph.mesh.vertices.filter(vertex=>vertex.angle.x===0).map(vertex=>vertex.id)),excluded=new Set(graph.mesh.edges.filter(edge=>edge.vertexIds.every(id=>zero.has(id))).map(edge=>edge.id));
 if(!excluded.size)return graph;
 const effective=effectiveSnapshotSurfaceResponses(graph),responses=own(effective.responseExpressions,location.simplexId);
 const control=(value:SnapshotExpressionControlResponse):SnapshotExpressionControlResponse=>Object.fromEntries((Object.entries(value) as [string,SnapshotResponseExpression][]).map(([axis,expression])=>[axis,{...expression,fields:expression.fields.map(field=>({...field,edges:field.edges.map(edge=>zero.has(field.vertexIds[edge.from])&&zero.has(field.vertexIds[edge.to])?{from:edge.from,to:edge.to}:edge)}))}]));
 const mapped=responses?{nodes:Object.fromEntries(Object.entries(responses.nodes).map(([id,value])=>[id,control(value)])),handles:Object.fromEntries(Object.entries(responses.handles).map(([id,pair])=>[id,[control(pair[0]),control(pair[1])] as const]))}:undefined;
 return {...graph,edgeResponses:Object.fromEntries(Object.entries(effective.edgeResponses).filter(([id])=>!excluded.has(id))),triangleResponses:effective.triangleResponses,responseExpressions:{...effective.responseExpressions,...mapped?{[location.simplexId]:mapped}:{}},correctionFrames:[]};
}

/** Both geometry and attributes use the same persisted simplex orientation. */
const surfaceDescriptor=(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation)=>describeSnapshotScalarResponseSupport(graph.mesh,location,message=>fail('SURFACE_INVALID_TARGET',message));

/** Compile at most once per control/axis. Scalar responses change final control
 * geometry only; they never change membership or the original geometric λ. */
export function createSnapshotSurfaceResponseSampler(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation):SnapshotScalarWeights {
 const descriptor=surfaceDescriptor(graph,location),effective=effectiveSnapshotSurfaceResponses(graph);
 const sample=createSnapshotScalarResponseWeightSampler<{target:SnapshotScalarTarget;axis:0|1}>(descriptor,{
  key:({target,axis})=>targetKey(target,axis),
  edgeKnots:(edgeId,{target,axis})=>{
   const responses=own(effective.edgeResponses,edgeId),control=target.kind==='node'?own(responses?.nodes,target.nodeId):own(responses?.handles,target.curveId)?.[target.end];
   return control?.[axes[axis]];
  },
  triangleSamples:(triangleId,{target,axis})=>{
   const responses=own(effective.triangleResponses,triangleId),control=target.kind==='node'?own(responses?.nodes,target.nodeId):own(responses?.handles,target.curveId)?.[target.end];
   return control?.[axes[axis]];
  },
 });
 return (target,axis,_coordinates,geometricWeights)=>sample({target,axis},geometricWeights);
}

export interface SnapshotSurfaceValueProgram {
 /** A sampler owns fitted parameters, projection inputs and mirror diagnostics
  * for one complete geometry sample. Never reuse it for another frame. */
 createSampler:()=>SnapshotScalarValue;
}
export interface SnapshotSurfaceValueProgramOptions {onPrepare?:()=>void}
export interface SnapshotSurfaceValueSamplerOptions extends SnapshotSurfaceValueProgramOptions {/** All graph and drawing dependencies remain immutable. */immutableInputs?:boolean}
const surfaceProgramStats={programCompilations:0,expressionCompilations:0};
export const getSnapshotSurfaceValueProgramStats=()=>({...surfaceProgramStats});
export const resetSnapshotSurfaceValueProgramStats=()=>{surfaceProgramStats.programCompilations=0;surfaceProgramStats.expressionCompilations=0;};
interface SurfaceProgramCache {inputs:WeakMap<object,SurfaceProgramCache>;programs:Map<string,SnapshotSurfaceValueProgram>}
const surfaceProgramCache:SurfaceProgramCache={inputs:new WeakMap(),programs:new Map()},absentSurfaceProgramInput=Object.freeze({});

/** Share compiled controls across angles only inside an immutable input
 * lifetime. A support signature includes orientation and the mirror side;
 * drawing identities, not temporary basis arrays, identify the live leaves. */
export function prepareSnapshotSurfaceValueProgram(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],mirror?:SnapshotSurfaceMirrorContext,options:SnapshotSurfaceValueProgramOptions={}):SnapshotSurfaceValueProgram {
 // Weights are request data, so validate them even when compilation is cached.
 const count=location.kind==='vertex'?1:location.kind==='edge'?2:3;
 if(location.geometricWeights.length!==count||location.geometricWeights.some(weight=>!Number.isFinite(weight)||weight<=0)||Math.abs(location.geometricWeights.reduce((sum,weight)=>sum+weight,0)-1)>64*Number.EPSILON)fail('SURFACE_INVALID_TARGET','A response surface needs the original positive geometric support of its active simplex.');
 const mirroredPositive=!!mirror&&location.vertexIds.reduce((sum,id,index)=>sum+graph.mesh.vertices.find(vertex=>vertex.id===id)!.angle.x*location.geometricWeights[index],0)>0;
 const key=JSON.stringify([location.kind,location.simplexId,location.vertexIds,location.snapshotIds,bases.map(basis=>basis.snapshotId),mirroredPositive]);
 let cache=surfaceProgramCache;
 for(const input of [graph.mesh,graph.edgeResponses,graph.triangleResponses,graph.responseExpressions??absentSurfaceProgramInput,graph.correctionFrames??absentSurfaceProgramInput,mirror??absentSurfaceProgramInput,...bases.map(basis=>basis.drawing)]){
  let next=cache.inputs.get(input);if(!next){next={inputs:new WeakMap(),programs:new Map()};cache.inputs.set(input,next);}cache=next;
 }
 let program=cache.programs.get(key);if(!program){program=compileSnapshotSurfaceValueProgram(graph,location,bases,mirror);cache.programs.set(key,program);options.onPrepare?.();}return program;
}

/** Native response and expression programs own no per-angle output buffers. */
function compileSnapshotSurfaceValueProgram(graph:SnapshotAngleGraph,originalLocation:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],mirror?:SnapshotSurfaceMirrorContext):SnapshotSurfaceValueProgram {
 const location={...originalLocation,vertexIds:[...originalLocation.vertexIds],snapshotIds:[...originalLocation.snapshotIds],geometricWeights:[...originalLocation.geometricWeights]};
 const samplingGraph=positiveMirrorResponseGraph(graph,location,mirror),native=createSnapshotSurfaceResponseSampler(samplingGraph,location),effective=effectiveSnapshotSurfaceResponses(samplingGraph),responses=own(effective.responseExpressions,location.simplexId);
 const geometricWeights=createSnapshotResponseFieldWeightMapper(graph.mesh,location),onCompile=()=>{surfaceProgramStats.expressionCompilations++;};
 const hasExpressions=!!responses&&[...Object.values(responses.nodes),...Object.values(responses.handles).flat()].some(control=>control.x!==undefined||control.y!==undefined);
 const basisScalar:SnapshotResponseBasisScalarResolver=hasExpressions?createSnapshotResponseBasisResolver(bases):()=>undefined;
 const inheritedProgram=prepareSnapshotExpressionValueProgram(location,{expression:hasExpressions?(target,axis)=>snapshotResponseExpressionFor(responses,target,axis):undefined,geometricWeights,onCompile});
 const hasProjection=Object.values(responses?.handles??{}).some(pair=>pair.some(control=>Object.values(control).some(expression=>expression.smoothContracts?.length)));
 const sourceBaselines=prepareSnapshotExpressionValueProgram(location,{expression:hasExpressions?(target,axis)=>{const expression=snapshotResponseExpressionFor(responses,target,axis);return expression?snapshotResponseSourceBaseline(expression):undefined;}:undefined,geometricWeights,onCompile}).createSampler(basisScalar);
 // Unit support and the zero residual input are immutable program operands,
 // shared by all scalars and frames. Public mutable coordinate arrays still
 // take the original map path so malformed/sparse inputs retain validation.
 const zeroCoordinates=Object.freeze(location.vertexIds.map(()=>0)),cornerWeights=Object.freeze(location.vertexIds.map((_,index)=>Object.freeze(location.vertexIds.map((_,coordinate)=>coordinate===index?1:0))));
 const coordinatePlans=new WeakSet<readonly number[]>(),projectionKeys=new WeakMap<SnapshotScalarTarget,readonly [string,string]>();
 const residualCoordinates=(coordinates:readonly number[])=>{
  if(coordinatePlans.has(coordinates))return zeroCoordinates;
  if(coordinates.length===zeroCoordinates.length&&Object.isFrozen(coordinates)&&zeroCoordinates.every((_,index)=>{const descriptor=Object.getOwnPropertyDescriptor(coordinates,index);return !!descriptor&&'value' in descriptor;})){coordinatePlans.add(coordinates);return zeroCoordinates;}
  return coordinates.map(()=>0);
 };
 const projectionKey=(target:SnapshotScalarTarget,axis:0|1)=>{
  let keys=projectionKeys.get(target);if(keys)return keys[axis];
  const fields=target.kind==='node'?['kind','nodeId']:['kind','curveId','end'];
  if(Object.isFrozen(target)&&fields.every(field=>{const descriptor=Object.getOwnPropertyDescriptor(target,field);return !!descriptor&&'value' in descriptor&&(typeof descriptor.value==='string'||typeof descriptor.value==='number');})){keys=[snapshotProjectionScalarKey(target,0),snapshotProjectionScalarKey(target,1)];projectionKeys.set(target,keys);return keys[axis];}
  return snapshotProjectionScalarKey(target,axis);
 };
 surfaceProgramStats.programCompilations++;
 const createSampler=():SnapshotScalarValue=>{
  const fittedParameters=createSnapshotFitParameterCollector();let recordParameters=true;
  const sampleBasis:SnapshotResponseBasisScalarResolver=reference=>basisScalar(reference);sampleBasis.fitParameter=basisScalar.fitParameter;sampleBasis.recordFitParameter=(domain,q,parent)=>{if(recordParameters)fittedParameters.record(domain,q,parent);};
  const inherited=inheritedProgram.createSampler(sampleBasis);
  const samples=new Map<string,SnapshotProjectionScalarSample>();
  let mirrored:SnapshotSurfaceMirrorSample|undefined,mirrorWeights:readonly number[]|undefined;const mirrorDiagnostics=new Set<string>();
  const mirrorAt=(weights:readonly number[])=>{if(!mirrorWeights||!sameWeights(mirrorWeights,weights)){mirrored=mirror?.sample({...location,geometricWeights:[...weights]},weights);mirrorWeights=[...weights];}return mirrored;};
  const sample:SnapshotScalarValue=(target,axis,coordinates,weights)=>{
   if(location.kind==='vertex')return coordinates[0];
   const emptyCoordinates=residualCoordinates(coordinates),nativeWeights=native(target,axis,coordinates,weights),residual=inherited(target,axis,emptyCoordinates,weights),candidateSource=mirrorAt(weights),candidateCorners=candidateSource?.corners(target,axis),mirroredValue=candidateSource?.scalar(target,axis),source=mirroredValue!==undefined&&candidateCorners?.every(value=>value!==undefined)?candidateSource:undefined,sourceCorners=source?candidateCorners as readonly number[]:undefined;
   if(candidateSource&&!source)mirrorDiagnostics.add(`View mirror source has no matching ${label(target).toLowerCase()} throughout this support; its positive local controls remain authoritative.`);
   // Form target-local differences before adding them to B. An exact zero
   // correction preserves the inherited source sample without cancellation.
   const corrected=source?mirroredValue!+residual+coordinates.reduce((sum,value,index)=>sum+(value-sourceCorners![index])*weights[index]+value*(nativeWeights[index]-weights[index]),0):coordinates.reduce((sum,value,index)=>sum+value*nativeWeights[index],0)+residual;
   if(!hasProjection&&!source)return corrected;
   const currentExpression=snapshotResponseExpressionFor(responses,target,axis),hasSourceBaseline=!!currentExpression&&(currentExpression.sourceBaseline!==undefined||!!currentExpression.sourceBaselineOperations),geometric=(sampleWeights:readonly number[])=>hasSourceBaseline?sourceBaselines(target,axis,emptyCoordinates,sampleWeights):coordinates.reduce((sum,value,index)=>sum+value*sampleWeights[index],0);
   const baseline=source?mirroredValue!+(geometric(weights)-coordinates.reduce((sum,value,index)=>sum+value*weights[index],0))+residual:geometric(weights)+residual;
   const cornerResiduals=currentExpression?cornerWeights.map(weights=>{recordParameters=false;try{return inherited(target,axis,emptyCoordinates,weights);}finally{recordParameters=true;}}):zeroCoordinates;
   samples.set(projectionKey(target,axis),{baseline,corrected,baselineCorners:cornerWeights.map((weights,index)=>geometric(weights)+cornerResiduals[index]+(sourceCorners?sourceCorners[index]-coordinates[index]:0)),correctedCorners:coordinates.map((value,index)=>value+cornerResiduals[index]),weights});return corrected;
  };
  sample.projectSmooth=drawing=>{const result=projectSnapshotResponseCorrections(drawing,responses,samples,mirrored?.contracts);return {...result,drawing:fittedParameters.apply(result.drawing),diagnostics:[...result.diagnostics,...mirrored?.diagnostics??[],...mirrorDiagnostics]};};sample.unprojectSmooth=(drawing,available)=>unprojectSnapshotResponseTarget(drawing,responses,samples,available,mirrored?.contracts);sample.rawScalar=(target,axis)=>samples.get(projectionKey(target,axis))?.corrected;if(!hasExpressions&&!mirror)markNativeSnapshotScalarResponse(sample);return sample;
 };
 return Object.freeze({createSampler});
}

/** Shared final-control path for runtime, correction replay, and onion frames.
 * Mutable legacy callers keep an isolated program; prepared callers explicitly
 * opt into identity reuse and always receive independent sampling scratch. */
export function createSnapshotSurfaceValueSampler(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],mirror?:SnapshotSurfaceMirrorContext,options:SnapshotSurfaceValueSamplerOptions={}):SnapshotScalarValue {
 if(options.immutableInputs)return prepareSnapshotSurfaceValueProgram(graph,location,bases,mirror,options).createSampler();
 const program=compileSnapshotSurfaceValueProgram(graph,location,bases,mirror);options.onPrepare?.();return program.createSampler();
}

export interface SnapshotSurfaceTargetEditOptions {immutableInputs?:boolean;angle:Angle;frameId:string;/** Includes expression leaves outside the active child simplex. */allBases?:readonly SnapshotSimplexBasis[];mirror?:SnapshotSurfaceMirrorContext}
export interface SnapshotSurfaceTargetEditResult {graph:SnapshotAngleGraph;changed:boolean;/** Ephemeral exact solved outputs; never persisted in the graph. */responseControls?:readonly SnapshotScalarTarget[]}
type TargetUpdate={target:SnapshotScalarTarget;axis:0|1;weights:BarycentricWeights};

/** One inverse transaction for A and V. Read the frozen frame and bases once,
 * solve each changed authority/vector coordinate from ORIGINAL λ, then replay
 * the complete candidate through the runtime sampler and SMOOTH projection.
 * No drawing geometry, pose key, or sampled intermediate enters persistence. */
export function prepareSnapshotSurfaceTargetEdit(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],currentDrawing:DrawingDocument,wantedDrawing:DrawingDocument,options:SnapshotSurfaceTargetEditOptions):SnapshotSurfaceTargetEditResult {
 return prepareSnapshotSurfaceTargetEditWithReplay(graph,location,bases,currentDrawing,wantedDrawing,options);
}

/** Internal prepared-context adapter. Only the context's ordinary sample path
 * produces retained products; this solver still verifies every target control.
 * Standalone and mutable callers retain the same local replay below. */
export function prepareSnapshotSurfaceTargetEditWithReplay(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],currentDrawing:DrawingDocument,wantedDrawing:DrawingDocument,options:SnapshotSurfaceTargetEditOptions,replayCandidate?:(candidate:SnapshotAngleGraph,responseControls:readonly SnapshotScalarTarget[])=>DrawingDocument):SnapshotSurfaceTargetEditResult {
 const actualLocation=locateSnapshotSimplex(graph.mesh,options.angle);
 if(!actualLocation)fail('SURFACE_OUTSIDE_COVERAGE','This angle is outside saved snapshot coverage. The projected red preview is read-only; return inside coverage to correct controls.');
 const descriptor=surfaceDescriptor(graph,location);
 if(actualLocation.kind!==location.kind||actualLocation.simplexId!==location.simplexId||location.vertexIds.some((id,index)=>actualLocation.geometricWeights[actualLocation.vertexIds.indexOf(id)]!==location.geometricWeights[index]))fail('SURFACE_INVALID_TARGET','The supplied frame is not the original geometric support at this angle. Re-evaluate the recording before editing.');
 if(location.kind==='vertex')fail('SURFACE_CORRECTION_REQUIRES_INTERIOR','A real saved vertex has no response correction degree of freedom. Edit its snapshot basis directly.');
 const effective=effectiveSnapshotSurfaceResponses(graph),draft=effective.draft;
 if(draft&&!sameAngle(draft.angle,options.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','A correction draft exists at another angle. Return to that angle and save or discard it before editing a different angle.');
 if(!options.frameId||typeof options.frameId!=='string')fail('SURFACE_INVALID_TARGET','A correction frame needs a nonempty stable ID.');
 if(!draft&&(graph.correctionFrames??[]).some(frame=>frame.id===options.frameId))fail('SURFACE_INVALID_TARGET','This correction frame ID is already saved. Use a new draft frame ID.');
 const basisMap=new Map(bases.map(basis=>[basis.snapshotId,basis]));
 if(bases.length!==location.snapshotIds.length||basisMap.size!==bases.length||location.snapshotIds.some(id=>!basisMap.has(id)))fail('SURFACE_INVALID_TARGET','Supply exactly the active saved snapshot bases for this correction angle.');
 const orderedBases=location.snapshotIds.map(id=>basisMap.get(id)!);
 const index=(drawing:DrawingDocument)=>({nodes:new Map(drawing.nodes.map(node=>[node.id,node.position])),curves:new Map(drawing.curves.map(curve=>[curve.id,curve]))});
 const before=index(currentDrawing),wanted=index(wantedDrawing),basisIndices=orderedBases.map(basis=>index(basis.drawing));
 if(before.nodes.size!==currentDrawing.nodes.length||wanted.nodes.size!==wantedDrawing.nodes.length||before.curves.size!==currentDrawing.curves.length||wanted.curves.size!==wantedDrawing.curves.length||before.nodes.size!==wanted.nodes.size||before.curves.size!==wanted.curves.size||[...before.nodes.keys()].some(id=>!wanted.nodes.has(id))||[...before.curves].some(([id,curve])=>!same(curve.nodes,wanted.curves.get(id)?.nodes)))fail('SURFACE_INVALID_TARGET','A correction target must preserve the current active node and curve topology. Edit membership at a saved snapshot.');
 for(const [kind,left,right] of [['Join',currentDrawing.joins,wantedDrawing.joins],['EndpointLink',currentDrawing.endpointLinks??[],wantedDrawing.endpointLinks??[]]] as const){
  const prior=new Map(left.map(item=>[item.id,item]));
  if(left.length!==right.length||right.some(item=>!prior.has(item.id)||!same([item.a,item.b],[prior.get(item.id)!.a,prior.get(item.id)!.b])))fail('SURFACE_INVALID_TARGET',`${kind} topology cannot change in a control response correction.`);
 }
 const priorJoins=new Map(currentDrawing.joins.map(join=>[join.id,join]));
 for(const join of wantedDrawing.joins){const prior=priorJoins.get(join.id)!;
  if(join.mode!==prior.mode)fail('SURFACE_INVALID_TARGET',`Join ${join.id} mode cannot change in a control response correction.`);
  if(join.mode==='ARC'&&(typeof join.radius!=='number'||typeof prior.radius!=='number'||!Number.isFinite(join.radius)||!Number.isFinite(prior.radius)||changedScalar(join.radius,prior.radius)))fail('SURFACE_ARC_BASIS_REQUIRED',`ARC ${join.id} radius changes in this target. Responses store nodes and handle vectors only; edit the ARC brush in a saved snapshot basis first.`);
 }
 const priorLinks=new Map((currentDrawing.endpointLinks??[]).map(link=>[link.id,link]));
 for(const link of wantedDrawing.endpointLinks??[]){const prior=priorLinks.get(link.id)!;
  if((link.joinBrush?.kind==='ARC'||prior.joinBrush?.kind==='ARC')&&!same(link.joinBrush,prior.joinBrush))fail('SURFACE_ARC_BASIS_REQUIRED',`ARC ${link.id} brush or trim changes in this target. Edit the ARC brush in a saved snapshot basis first.`);
  if(link.joinBrush?.kind!==prior.joinBrush?.kind)fail('SURFACE_INVALID_TARGET',`EndpointLink ${link.id} brush kind cannot change in a control response correction.`);
 }
 const authorities=endpointPairNodeAuthorities(currentDrawing),updates:TargetUpdate[]=[];
 const inheritedResponses=effectiveSnapshotSurfaceResponses(positiveMirrorResponseGraph(graph,location,options.mirror)).responseExpressions;
 const inherited=createSnapshotExpressionValueSampler(location,{expression:(target,axis)=>snapshotResponseExpressionFor(own(inheritedResponses,location.simplexId),target,axis),basisScalar:createSnapshotResponseBasisResolver(options.allBases??orderedBases),geometricWeights:createSnapshotResponseFieldWeightMapper(graph.mesh,location)});
 const mirrored=options.mirror?.sample(location,location.geometricWeights),mirrorResidual=(target:SnapshotScalarTarget,axis:0|1)=>{const value=mirrored?.scalar(target,axis),corners=mirrored?.corners(target,axis);return value!==undefined&&corners?.every(value=>value!==undefined)?value-(corners as readonly number[]).reduce((sum,value,index)=>sum+value*location.geometricWeights[index],0):0;};
 const original=[...location.geometricWeights] as number[];if(original.length===2)original.push(0);
 const solve=(target:SnapshotScalarTarget,prior:Point2,desired:Point2,coordinates:Point2[])=>{
  if(!finitePoint(prior)||!finitePoint(desired)||coordinates.some(point=>!finitePoint(point)))fail('SURFACE_INVALID_TARGET',`${label(target)} must have finite current, target and saved basis coordinates.`);
  for(const axis of [0,1] as const){
   if(!changedScalar(prior[axis],desired[axis]))continue;
   const scalarCoordinates=coordinates.map(point=>point[axis]);if(scalarCoordinates.length===2)scalarCoordinates.push(0);
   const result=solveClosestBarycentricWeights(original as unknown as BarycentricWeights,scalarCoordinates as unknown as BarycentricWeights,desired[axis]-inherited(target,axis,location.geometricWeights.map(()=>0),location.geometricWeights)-mirrorResidual(target,axis));
   if(!result.available)fail('SURFACE_AXIS_UNAVAILABLE',`${label(target)} ${axes[axis].toUpperCase()}: ${result.reason} Edit that coordinate in a saved snapshot basis first.`);
   updates.push({target,axis,weights:result.weights});
  }
 };
 for(const node of wantedDrawing.nodes){
  const authority=authorities.get(node.id)!;
  if(!finitePoint(node.position))fail('SURFACE_INVALID_TARGET',`Node ${node.id} target must be finite.`);
  if(authority!==node.id){const position=wanted.nodes.get(authority)!;if(node.position.some((value,axis)=>changedScalar(value,position[axis])))fail('SURFACE_CONSTRAINT_UNSOLVABLE',`Node ${node.id} conflicts with linked position authority ${authority}. Move the linked component together.`);continue;}
  const coordinates=basisIndices.map(basis=>basis.nodes.get(authority));
  if(coordinates.some(point=>!point))fail('SURFACE_INVALID_TARGET',`Node ${authority} is missing from an active saved snapshot basis.`);
  solve({kind:'node',nodeId:authority},before.nodes.get(authority)!,node.position,coordinates as Point2[]);
 }
 const vector=(drawing:ReturnType<typeof index>,curveId:string,end:0|1):Point2=>{
  const curve=drawing.curves.get(curveId),node=curve&&drawing.nodes.get(curve.nodes[end]);
  if(!curve||!node)fail('SURFACE_INVALID_TARGET',`Handle ${curveId} end ${end} is missing from an active saved snapshot basis.`);
  return sub(curve.handles[end],node);
 };
 const owned=own(effective.responseExpressions,location.simplexId),contracts=snapshotResponseProjectionContracts(owned,mirrored?.contracts),projectedEndpoints=new Set(contracts.flatMap(contract=>contract.targets.map(target=>JSON.stringify([target.endpoint.curveId,target.endpoint.end])))),sampler=contracts.length?createSnapshotSurfaceValueSampler(graph,location,options.allBases??orderedBases,options.mirror,{immutableInputs:options.immutableInputs}):undefined;
 // Populate the shared raw component inputs without changing the user's graph.
 if(sampler){if(options.immutableInputs)preparedSnapshotSimplexProgram(orderedBases).sample(location.geometricWeights,sampler);else interpolateSnapshotSimplexGeometry(orderedBases,location.geometricWeights,sampler);}
 const available=(target:SnapshotScalarTarget,axis:0|1)=>{if(target.kind==='node')return true;const values=basisIndices.map(basis=>vector(basis,target.curveId,target.end)[axis]);return Math.max(...values)-Math.min(...values)>scalarTolerance(...values);};
 let unprojected:DrawingDocument;try{unprojected=sampler?.unprojectSmooth?.(wantedDrawing,available)??wantedDrawing;}catch(error){return fail('SURFACE_CONSTRAINT_UNSOLVABLE',error instanceof Error?error.message:String(error));}
 const rawWanted=index(unprojected);
 for(const curve of wantedDrawing.curves)for(const end of [0,1] as const){const target:SnapshotScalarTarget={kind:'handle',curveId:curve.id,end},projected=projectedEndpoints.has(JSON.stringify([curve.id,end]));
  const prior=vector(before,curve.id,end),raw=projected?([0,1] as const).map(axis=>sampler?.rawScalar?.(target,axis)??prior[axis]) as Point2:prior;
  solve(target,raw,vector(rawWanted,curve.id,end),basisIndices.map(basis=>vector(basis,curve.id,end)));
 }
 if(!updates.length)return {graph,changed:false};

 const frameId=draft?.id??options.frameId;
 let nextFrame:SnapshotCorrectionFrame;
 if(location.kind==='edge'){
  const prior=own(effective.edgeResponses,location.simplexId),responses:SnapshotEndpointResponses={nodes:{...prior?.nodes},handles:{...prior?.handles}};
  const progress=location.geometricWeights[descriptor.ownerToLocation[1]];
  for(const {target,axis,weights} of updates){
   const control:SnapshotControlResponse={...(target.kind==='node'?own(responses.nodes,target.nodeId):own(responses.handles,target.curveId)?.[target.end])};
   const knots=(control[axes[axis]]??[]).filter(point=>point[0]!==progress);knots.push([progress,weights[descriptor.ownerToLocation[1]]]);knots.sort((a,b)=>a[0]-b[0]);control[axes[axis]]=knots;
   if(target.kind==='node')put(responses.nodes,target.nodeId,control);
   else{const pair=own(responses.handles,target.curveId)??[{},{}];put(responses.handles,target.curveId,target.end===0?[control,pair[1]]:[pair[0],control]);}
  }
  nextFrame={...draft,id:frameId,angle:{...options.angle},status:'draft',edgeResponses:{...draft?.edgeResponses,[location.simplexId]:responses}};
 }else{
  const prior=own(effective.triangleResponses,location.simplexId),responses:SnapshotTriangleResponses={nodes:{...prior?.nodes},handles:{...prior?.handles}};
  const at=descriptor.ownerToLocation.map(index=>location.geometricWeights[index]) as unknown as BarycentricWeights;
  for(const {target,axis,weights} of updates){
   const control:SnapshotTriangleControlResponse={...(target.kind==='node'?own(responses.nodes,target.nodeId):own(responses.handles,target.curveId)?.[target.end])};
   const samples=control[axes[axis]]??[],existing=samples.filter(sample=>sameWeights(sample.at,at)).sort((a,b)=>a.id.localeCompare(b.id))[0];
   const id=existing?.id??JSON.stringify([frameId,targetKey(target,axis)]),sampleWeights=descriptor.ownerToLocation.map(index=>weights[index]) as unknown as BarycentricWeights;
   control[axes[axis]]=upsertInteriorResponseSample(samples.filter(sample=>!sameWeights(sample.at,at)),{id,at,weights:sampleWeights});
   if(target.kind==='node')put(responses.nodes,target.nodeId,control);
   else{const pair=own(responses.handles,target.curveId)??[{},{}];put(responses.handles,target.curveId,target.end===0?[control,pair[1]]:[pair[0],control]);}
  }
  nextFrame={...draft,id:frameId,angle:{...options.angle},status:'draft',triangleResponses:{...draft?.triangleResponses,[location.simplexId]:responses}};
 }
 const candidate:SnapshotAngleGraph={...graph,correctionFrames:draft?graph.correctionFrames!.map(frame=>frame===draft?nextFrame:frame):[...graph.correctionFrames??[],nextFrame]};
 const responseControls=[...new Map(updates.map(({target})=>[targetKey(target,0),target])).values()];
 const replay=index(replayCandidate?replayCandidate(candidate,responseControls):(()=>{const sampler=createSnapshotSurfaceValueSampler(candidate,location,options.allBases??orderedBases,options.mirror,{immutableInputs:options.immutableInputs});return (options.immutableInputs?preparedSnapshotSimplexProgram(orderedBases).sample(location.geometricWeights,sampler):interpolateSnapshotSimplexGeometry(orderedBases,location.geometricWeights,sampler)).drawing;})());
 const verify=(name:string,position:Point2|undefined,target:Point2)=>{
  if(!position||position.some((value,axis)=>!Number.isFinite(value)||Math.abs(value-target[axis])>Math.max(1e-7,4*scalarTolerance(value,target[axis]))))fail('SURFACE_CONSTRAINT_UNSOLVABLE',`${name}: the complete correction cannot reproduce the target after linked-node and SMOOTH constraints. Edit the responsible basis control or its SMOOTH driver first.`);
 };
 for(const node of wantedDrawing.nodes)verify(`Node ${node.id}`,replay.nodes.get(node.id),node.position);
 for(const curve of wantedDrawing.curves)for(const end of [0,1] as const)verify(`Handle ${curve.id} end ${end}`,replay.curves.get(curve.id)?.handles[end],curve.handles[end]);
 return {graph:candidate,changed:true,responseControls};
}
