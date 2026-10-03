import {projectSnapshotResponseCorrections,unprojectSnapshotResponseTarget,snapshotProjectionScalarKey,type SnapshotProjectionScalarSample} from './responseExpressionProjection';
import {finitePoint,sub,type DrawingDocument,type Point2} from '../drawing/model';
import type {Angle,SnapshotAngleGraph,SnapshotControlResponse,SnapshotCorrectionFrame,SnapshotEndpointResponses,SnapshotTriangleControlResponse,SnapshotTriangleResponses,SnapshotResponseExpressionRegistry} from './model';
import {endpointPairNodeAuthorities} from './endpointPair';
import {interpolateSnapshotSimplexGeometry,type SnapshotScalarTarget,type SnapshotScalarWeights,type SnapshotScalarValue,type SnapshotSimplexBasis} from './simplexGeometry';
import {locateSnapshotSimplex,type SnapshotSimplexLocation} from './triangulation';
import {solveClosestBarycentricWeights,upsertInteriorResponseSample,type BarycentricWeights} from './triangularResponses';
import {createSnapshotExpressionValueSampler} from './responseExpressions';
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
const targetKey=(target:SnapshotScalarTarget,axis:0|1)=>JSON.stringify(target.kind==='node'?['node',target.nodeId,axis]:['handle',target.curveId,target.end,axis]);

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

/** Shared final-control sampler for runtime, correction replay, and full-curve
 * onion frames. Native corrections and inherited expressions add as values. */
export function createSnapshotSurfaceValueSampler(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[]):SnapshotScalarValue {
 const native=createSnapshotSurfaceResponseSampler(graph,location),effective=effectiveSnapshotSurfaceResponses(graph),responses=own(effective.responseExpressions,location.simplexId);
 const inherited=createSnapshotExpressionValueSampler(location,{expression:(target,axis)=>snapshotResponseExpressionFor(responses,target,axis),basisScalar:createSnapshotResponseBasisResolver(bases),geometricWeights:createSnapshotResponseFieldWeightMapper(graph.mesh,location)});
 const hasProjection=Object.values(responses?.handles??{}).some(pair=>pair.some(control=>Object.values(control).some(expression=>expression.smoothContracts?.length)));
 const sourceBaselines=createSnapshotExpressionValueSampler(location,{expression:(target,axis)=>{const expression=snapshotResponseExpressionFor(responses,target,axis);return expression?.sourceBaseline?{version:1,fields:expression.fields,terms:expression.sourceBaseline}:undefined;},basisScalar:createSnapshotResponseBasisResolver(bases),geometricWeights:createSnapshotResponseFieldWeightMapper(graph.mesh,location)});
 const samples=new Map<string,SnapshotProjectionScalarSample>();
 const sample:SnapshotScalarValue=(target,axis,coordinates,weights)=>{
  if(location.kind==='vertex')return coordinates[0];
  const nativeWeights=native(target,axis,coordinates,weights),residual=inherited(target,axis,coordinates.map(()=>0),weights);
  if(!hasProjection)return coordinates.reduce((sum,value,index)=>sum+value*nativeWeights[index],0)+residual;
  const hasSourceBaseline=!!snapshotResponseExpressionFor(responses,target,axis)?.sourceBaseline,geometric=(sampleWeights:readonly number[])=>hasSourceBaseline?sourceBaselines(target,axis,coordinates.map(()=>0),sampleWeights):coordinates.reduce((sum,value,index)=>sum+value*sampleWeights[index],0);
  const baseline=geometric(weights)+residual,corrected=coordinates.reduce((sum,value,index)=>sum+value*nativeWeights[index],0)+residual;
  const corners=weights.map((_,index)=>weights.map((_,coordinate)=>coordinate===index?1:0)),cornerResiduals=corners.map(weights=>inherited(target,axis,coordinates.map(()=>0),weights));
  samples.set(snapshotProjectionScalarKey(target,axis),{baseline,corrected,baselineCorners:corners.map((weights,index)=>geometric(weights)+cornerResiduals[index]),correctedCorners:coordinates.map((value,index)=>value+cornerResiduals[index]),weights});return corrected;
 };
 sample.projectSmooth=drawing=>projectSnapshotResponseCorrections(drawing,responses,samples);sample.unprojectSmooth=(drawing,available)=>unprojectSnapshotResponseTarget(drawing,responses,samples,available);sample.rawScalar=(target,axis)=>samples.get(snapshotProjectionScalarKey(target,axis))?.corrected;return sample;
}

export interface SnapshotSurfaceTargetEditOptions {angle:Angle;frameId:string;/** Includes expression leaves outside the active child simplex. */allBases?:readonly SnapshotSimplexBasis[]}
export interface SnapshotSurfaceTargetEditResult {graph:SnapshotAngleGraph;changed:boolean}
type TargetUpdate={target:SnapshotScalarTarget;axis:0|1;weights:BarycentricWeights};

/** One inverse transaction for A and V. Read the frozen frame and bases once,
 * solve each changed authority/vector coordinate from ORIGINAL λ, then replay
 * the complete candidate through the runtime sampler and SMOOTH projection.
 * No drawing geometry, pose key, or sampled intermediate enters persistence. */
export function prepareSnapshotSurfaceTargetEdit(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,bases:readonly SnapshotSimplexBasis[],currentDrawing:DrawingDocument,wantedDrawing:DrawingDocument,options:SnapshotSurfaceTargetEditOptions):SnapshotSurfaceTargetEditResult {
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
 const inherited=createSnapshotExpressionValueSampler(location,{expression:(target,axis)=>snapshotResponseExpressionFor(own(effective.responseExpressions,location.simplexId),target,axis),basisScalar:createSnapshotResponseBasisResolver(options.allBases??orderedBases),geometricWeights:createSnapshotResponseFieldWeightMapper(graph.mesh,location)});
 const original=[...location.geometricWeights] as number[];if(original.length===2)original.push(0);
 const solve=(target:SnapshotScalarTarget,prior:Point2,desired:Point2,coordinates:Point2[])=>{
  if(!finitePoint(prior)||!finitePoint(desired)||coordinates.some(point=>!finitePoint(point)))fail('SURFACE_INVALID_TARGET',`${label(target)} must have finite current, target and saved basis coordinates.`);
  for(const axis of [0,1] as const){
   if(!changedScalar(prior[axis],desired[axis]))continue;
   const scalarCoordinates=coordinates.map(point=>point[axis]);if(scalarCoordinates.length===2)scalarCoordinates.push(0);
   const result=solveClosestBarycentricWeights(original as unknown as BarycentricWeights,scalarCoordinates as unknown as BarycentricWeights,desired[axis]-inherited(target,axis,location.geometricWeights.map(()=>0),location.geometricWeights));
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
 const owned=own(effective.responseExpressions,location.simplexId),hasProjectedInputs=Object.values(owned?.handles??{}).some(pair=>pair.some(control=>Object.values(control).some(expression=>expression.smoothContracts?.length))),sampler=hasProjectedInputs?createSnapshotSurfaceValueSampler(graph,location,options.allBases??orderedBases):undefined;
 // Populate the shared raw component inputs without changing the user's graph.
 if(sampler)interpolateSnapshotSimplexGeometry(orderedBases,location.geometricWeights,sampler);
 const available=(target:SnapshotScalarTarget,axis:0|1)=>{if(target.kind==='node')return true;const values=basisIndices.map(basis=>vector(basis,target.curveId,target.end)[axis]);return Math.max(...values)-Math.min(...values)>scalarTolerance(...values);};
 let unprojected:DrawingDocument;try{unprojected=sampler?.unprojectSmooth?.(wantedDrawing,available)??wantedDrawing;}catch(error){return fail('SURFACE_CONSTRAINT_UNSOLVABLE',error instanceof Error?error.message:String(error));}
 const rawWanted=index(unprojected);
 for(const curve of wantedDrawing.curves)for(const end of [0,1] as const){const target:SnapshotScalarTarget={kind:'handle',curveId:curve.id,end},projected=!!owned?.handles[curve.id]?.[end].x?.smoothContracts?.some(contract=>contract.targets.some(value=>value.endpoint.curveId===curve.id&&value.endpoint.end===end))||!!owned?.handles[curve.id]?.[end].y?.smoothContracts?.some(contract=>contract.targets.some(value=>value.endpoint.curveId===curve.id&&value.endpoint.end===end));
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
 const replay=index(interpolateSnapshotSimplexGeometry(orderedBases,location.geometricWeights,createSnapshotSurfaceValueSampler(candidate,location,options.allBases??orderedBases)).drawing);
 const verify=(name:string,position:Point2|undefined,target:Point2)=>{
  if(!position||position.some((value,axis)=>!Number.isFinite(value)||Math.abs(value-target[axis])>Math.max(1e-7,4*scalarTolerance(value,target[axis]))))fail('SURFACE_CONSTRAINT_UNSOLVABLE',`${name}: the complete correction cannot reproduce the target after linked-node and SMOOTH constraints. Edit the responsible basis control or its SMOOTH driver first.`);
 };
 for(const node of wantedDrawing.nodes)verify(`Node ${node.id}`,replay.nodes.get(node.id),node.position);
 for(const curve of wantedDrawing.curves)for(const end of [0,1] as const)verify(`Handle ${curve.id} end ${end}`,replay.curves.get(curve.id)?.handles[end],curve.handles[end]);
 return {graph:candidate,changed:true};
}
