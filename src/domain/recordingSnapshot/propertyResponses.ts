import type {Angle,SnapshotAngleGraph,SnapshotCorrectionFrame,SnapshotEdgePropertyResponse,SnapshotPropertyResponses,SnapshotScalarPropertyTarget,SnapshotTrianglePropertyResponse} from './model';
import {locateSnapshotSimplex,type SnapshotSimplexLocation,type SnapshotTriangulation} from './triangulation';
import {solveClosestBarycentricWeights,upsertInteriorResponseSample,validateInteriorResponseSamples,type BarycentricInverseResult,type BarycentricWeights,type InteriorResponseSample} from './triangularResponses';
import {describeSnapshotScalarResponseSupport,createSnapshotScalarResponseWeightSampler} from './scalarResponseSupport';

export type SnapshotPropertyResponseErrorCode='PROPERTY_INVALID_TARGET'|'PROPERTY_AXIS_UNAVAILABLE'|'PROPERTY_CONSTRAINT_UNSOLVABLE'|'PROPERTY_OUTSIDE_COVERAGE'|'PROPERTY_REQUIRES_INTERIOR'|'OBJECT_DRAFT_AT_OTHER_ANGLE';
export class SnapshotPropertyResponseError extends Error {
 constructor(public readonly code:SnapshotPropertyResponseErrorCode,message:string){super(message);this.name='SnapshotPropertyResponseError';}
}
function fail(code:SnapshotPropertyResponseErrorCode,message:string):never {throw new SnapshotPropertyResponseError(code,message);}
function invalid(message:string):never {return fail('PROPERTY_INVALID_TARGET',message);}
const own=<T>(map:Record<string,T>|undefined,key:string):T|undefined=>map&&Object.hasOwn(map,key)?map[key]:undefined;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sameAngle=(a:Angle,b:Angle)=>a.x===b.x&&a.y===b.y;
const sameWeights=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const tolerance=64*Number.EPSILON;
const id=(value:unknown)=>{if(typeof value!=='string'||!value.length||value.length>16384)invalid('Property response identifiers must be nonempty strings of at most 16384 characters.');};
const object=(value:unknown,allowed?:readonly string[]):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Property response must be an object.');
 const result=value as Record<string,unknown>,keys=Object.keys(result);
 if(keys.length>65536||allowed&&keys.some(key=>!allowed.includes(key)))invalid('Property response contains an unknown field or exceeds the map limit.');
 return result;
};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)return invalid('Property response array is missing or exceeds its limit.');return value;};
const finiteTuple=(value:unknown,size:number):number[]=>{const tuple=list(value,size);if(tuple.length!==size||!Array.from(tuple).every(value=>typeof value==='number'&&Number.isFinite(value)))invalid('Property response coordinates must be finite numeric tuples.');return tuple as number[];};
const validateAngle=(value:Angle)=>{const angle=object(value,['x','y']);if(![angle.x,angle.y].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=-90&&value<=90))invalid('Property response angle must be finite and within the Recorder angle domain.');};
const empty=():SnapshotPropertyResponses=>({edges:{},triangles:{}});

/** This strict discriminator intentionally rejects unimplemented continuous and
 * discrete channels, rather than persisting constraints with no runtime. */
export function validateSnapshotScalarPropertyTarget(value:unknown):asserts value is SnapshotScalarPropertyTarget {
 const target=object(value,['kind','layerId','sourceTrackId','rangeId','end']);
 if(target.kind!=='interval-endpoint'||target.end!=='start'&&target.end!=='end')invalid('Only typed interval start/end scalar property targets are supported.');
 id(target.layerId);id(target.sourceTrackId);id(target.rangeId);
}

/** Collision-free address; source/node IDs are never rewritten or overloaded. */
export function snapshotScalarPropertyTargetKey(target:SnapshotScalarPropertyTarget):string {
 validateSnapshotScalarPropertyTarget(target);
 return JSON.stringify([target.kind,target.layerId,target.sourceTrackId,target.rangeId,target.end]);
}

/** Strict persistence boundary. No clamp, epsilon gap, coercion, unknown fields,
 * duplicate targets or dangling simplex addresses are accepted. */
export function validateSnapshotPropertyResponses(value:unknown,mesh:SnapshotTriangulation):asserts value is SnapshotPropertyResponses {
 const responses=object(value,['edges','triangles']);
 const validateTargets=(raw:unknown,kind:'edges'|'triangles')=>{
  const seen=new Set<string>();
  for(const value of list(raw,16384)){
   const response=object(value,kind==='edges'?['target','knots']:['target','samples']);
   validateSnapshotScalarPropertyTarget(response.target);
   const key=snapshotScalarPropertyTargetKey(response.target);if(seen.has(key))invalid('A simplex may have only one response per scalar property target.');seen.add(key);
   if(kind==='edges'){
    let previous=0;
    for(const raw of list(response.knots,256)){
     const knot=finiteTuple(raw,2);
     if(knot[0]<=previous||knot[0]>=1)invalid('Property edge knots must have strictly increasing interior progress.');
     previous=knot[0];
    }
   }else{
    const samples=list(response.samples,4096);
    for(const raw of samples){const sample=object(raw,['id','at','weights']);id(sample.id);finiteTuple(sample.at,3);finiteTuple(sample.weights,3);}
    try{validateInteriorResponseSamples(samples as InteriorResponseSample[]);}catch(error){invalid(error instanceof Error?error.message:String(error));}
   }
  }
 };
 for(const kind of ['edges','triangles'] as const){
  const ids=new Set(mesh[kind].map(simplex=>simplex.id));
  for(const [simplexId,responsesAtSimplex] of Object.entries(object(responses[kind]))){
   id(simplexId);if(!ids.has(simplexId))invalid(`Property ${kind} reference a missing simplex ${simplexId}; retain retired constraints with their original mesh.`);
   validateTargets(responsesAtSimplex,kind);
  }
 }
}

export interface SnapshotPropertyResponseOptions {useDraft?:boolean;/** The mirrored source supplies the authored 0− column to positive material. */omitZeroEdgeResponses?:boolean}
/** Draft maps replace only the simplex entries they contain. Saved responses
 * stay independent, and a geometry-only draft does not mask saved properties. */
export function effectiveSnapshotPropertyResponses(graph:SnapshotAngleGraph,options:SnapshotPropertyResponseOptions={}):SnapshotPropertyResponses&{draft?:SnapshotCorrectionFrame} {
 const saved=graph.propertyResponses??empty();
 const drafts=options.useDraft===false?[]:(graph.correctionFrames??[]).filter(frame=>frame.status==='draft');
 if(drafts.length>1)invalid('This Recorder contains multiple correction drafts. Save or discard them before editing properties.');
 const draft=drafts[0],replacement=draft?.propertyResponses;
 return {edges:replacement?{...saved.edges,...replacement.edges}:saved.edges,triangles:replacement?{...saved.triangles,...replacement.triangles}:saved.triangles,...draft?{draft}:{}};
}

/** Shared dependency projection for defensive content keys and trusted compact
 * keys. A fragment mapper may change representation, never the selected inputs. */
export function snapshotPropertyResponsesKeyInputs(graph:SnapshotAngleGraph,options:SnapshotPropertyResponseOptions={},fragment:(value:object)=>unknown=value=>value):unknown[] {
 return ['scalar-properties-v1',fragment(graph.mesh),graph.propertyResponses==null?null:fragment(graph.propertyResponses),options.useDraft!==false,
  options.useDraft===false?null:(graph.correctionFrames??[]).filter(frame=>frame.status==='draft').map(frame=>[frame.id,frame.angle,frame.propertyResponses==null?null:fragment(frame.propertyResponses)])];
}
/** Explicit response-only cache dependency. Caller must also include its saved
 * material-basis key, location and geometric weights. Geometry response changes
 * belong in the caller's final-material-frame key. No object identity cache can
 * conceal an in-place property edit or saved/draft selection. */
export function snapshotPropertyResponsesCacheKey(graph:SnapshotAngleGraph,options:SnapshotPropertyResponseOptions={}):string {
 return JSON.stringify(snapshotPropertyResponsesKeyInputs(graph,options));
}

const descriptor=(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation)=>describeSnapshotScalarResponseSupport(graph.mesh,location,invalid);
const padded=(values:readonly number[]):BarycentricWeights=>[values[0],values[1]??0,values[2]??0];
function validateScalarInputs(weights:readonly number[],coordinates:readonly number[],count:number):void {
 if(!Array.isArray(weights)||weights.length!==count||!Array.from(weights).every(value=>Number.isFinite(value)&&value>=0&&value<=1)||Math.abs(weights.reduce((sum,value)=>sum+value,0)-1)>tolerance||
    !Array.isArray(coordinates)||coordinates.length!==count||!Array.from(coordinates).every(Number.isFinite))invalid('Property basis values must be finite, and their original geometric weights must be nonnegative and sum to one.');
}
export const blendSnapshotPropertyValues=(values:readonly number[],weights:readonly number[]):number=>{
 // Preserve exact constant bases and endpoint plateaus, including nonzero ones.
 const active=weights.flatMap((weight,index)=>weight===0?[]:[index]);
 if(active.length&&active.every(index=>values[index]===values[active[0]]))return values[active[0]];
 const value=values.reduce((sum,value,index)=>sum+value*weights[index],0);
 if(!Number.isFinite(value))invalid('This scalar response cannot be evaluated to a finite property value.');return value;
};

export type SnapshotPropertyResponseSampler=(target:SnapshotScalarPropertyTarget,basisValues:readonly number[],geometricWeights?:readonly number[])=>number;
/** Prepare once for a simplex and reuse all scalar fields. Basis values must
 * already be transported into the same material frame. No drawing evaluation,
 * membership decision, interval clipping or geometry correction occurs here. */
export function createSnapshotPropertyResponseSampler(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,options:SnapshotPropertyResponseOptions={}):SnapshotPropertyResponseSampler {
 const support=descriptor(graph,location),effective=effectiveSnapshotPropertyResponses(graph,options),responses={edges:effective.edges,triangles:effective.triangles};
 validateSnapshotPropertyResponses(responses,graph.mesh);
 // Freeze the field's inputs at preparation; lazy compilation cannot see later
 // editor mutations. Compilation and field validation happen once per target.
 const owned=structuredClone(responses),original=[...location.geometricWeights],zero=new Set(graph.mesh.vertices.filter(vertex=>vertex.angle.x===0).map(vertex=>vertex.id)),excluded=new Set(options.omitZeroEdgeResponses?graph.mesh.edges.filter(edge=>edge.vertexIds.every(id=>zero.has(id))).map(edge=>edge.id):[]);
 const sample=createSnapshotScalarResponseWeightSampler<SnapshotScalarPropertyTarget>(support,{
  key:snapshotScalarPropertyTargetKey,
  edgeKnots:(edgeId,target)=>excluded.has(edgeId)?undefined:own(owned.edges,edgeId)?.find(response=>snapshotScalarPropertyTargetKey(response.target)===snapshotScalarPropertyTargetKey(target))?.knots,
  triangleSamples:(triangleId,target)=>own(owned.triangles,triangleId)?.find(response=>snapshotScalarPropertyTargetKey(response.target)===snapshotScalarPropertyTargetKey(target))?.samples,
 });
 return (target,basisValues,geometricWeights=original)=>{
  validateSnapshotScalarPropertyTarget(target);validateScalarInputs(geometricWeights,basisValues,support.count);
  return blendSnapshotPropertyValues(basisValues,sample(target,geometricWeights));
 };
}

/** Scalar inverse with the same support and conditioning rules as geometry.
 * Returned weights are padded to three coordinates; absent vertices stay zero. */
export function solveSnapshotPropertyResponseWeights(geometricWeights:readonly number[],basisValues:readonly number[],value:number):BarycentricInverseResult {
 try{
  if(geometricWeights.length<1||geometricWeights.length>3)invalid('A scalar property inverse needs one, two or three genuine saved bases.');
  validateScalarInputs(geometricWeights,basisValues,geometricWeights.length);
  if(!Number.isFinite(value))invalid('A scalar property target value must be finite.');
  const result=solveClosestBarycentricWeights(padded(geometricWeights),padded(basisValues),value);
  // A two-basis endpoint has a unique exact solution. Preserve it explicitly so
  // a plateau never leaves a floating-point sliver between coincident endpoints.
  if(result.available&&geometricWeights.length===2&&basisValues[0]!==basisValues[1]){
   if(value===basisValues[0])return {...result,weights:[1,0,0]};
   if(value===basisValues[1])return {...result,weights:[0,1,0]};
  }
  return result;
 }catch(error){return {available:false,reason:error instanceof Error?error.message:String(error)};}
}

export interface SnapshotPropertyTargetEdit {target:SnapshotScalarPropertyTarget;basisValues:readonly number[];value:number;/** Existing retained material contribution, held fixed during this scalar inverse. */residual?:number}
export interface SnapshotPropertyTargetEditOptions extends Pick<SnapshotPropertyResponseOptions,'omitZeroEdgeResponses'> {angle:Angle;frameId:string}
export interface SnapshotPropertyTargetEditResult {graph:SnapshotAngleGraph;changed:boolean}
/** One transaction for all supplied endpoints/properties. Every inverse and the
 * complete replay must succeed before a candidate draft is returned. A real
 * vertex stays a Snapshot-local attribute edit; this API never inserts views. */
export function prepareSnapshotPropertyTargetEdit(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation,edits:readonly SnapshotPropertyTargetEdit[],options:SnapshotPropertyTargetEditOptions):SnapshotPropertyTargetEditResult {
 validateAngle(options.angle);id(options.frameId);
 const actual=locateSnapshotSimplex(graph.mesh,options.angle);
 if(!actual)fail('PROPERTY_OUTSIDE_COVERAGE','This property correction is outside saved snapshot coverage. Return inside coverage before editing.');
 const support=descriptor(graph,location);
 if(actual.kind!==location.kind||actual.simplexId!==location.simplexId||location.vertexIds.some((id,index)=>actual.geometricWeights[actual.vertexIds.indexOf(id)]!==location.geometricWeights[index]))invalid('The property edit location is not the original geometric support at this angle.');
 if(location.kind==='vertex')fail('PROPERTY_REQUIRES_INTERIOR','A real saved vertex has no scalar response degree of freedom. Edit its Snapshot-local material attribute directly.');
 const effective=effectiveSnapshotPropertyResponses(graph),draft=effective.draft;
 if(draft&&!sameAngle(draft.angle,options.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','A correction draft exists at another angle. Save or discard it before editing another angle.');
 if(!draft&&(graph.correctionFrames??[]).some(frame=>frame.id===options.frameId))invalid('This correction frame ID is already saved. Use a new draft frame ID.');
 const current=createSnapshotPropertyResponseSampler(graph,location,options),seen=new Set<string>();
 const updates:{edit:SnapshotPropertyTargetEdit;key:string;weights:BarycentricWeights}[]=[];
 for(const edit of edits){
  const key=snapshotScalarPropertyTargetKey(edit.target);if(seen.has(key))invalid('An atomic property edit contains a duplicate target.');seen.add(key);
  validateScalarInputs(location.geometricWeights,edit.basisValues,support.count);if(!Number.isFinite(edit.value))invalid('A scalar property target value must be finite.');
  if(current(edit.target,edit.basisValues)+(edit.residual??0)===edit.value)continue;
  if(!Number.isFinite(edit.residual??0))invalid('Inherited property residual must be finite.');
  const solved=solveSnapshotPropertyResponseWeights(location.geometricWeights,edit.basisValues,edit.value-(edit.residual??0));
  if(!solved.available)fail('PROPERTY_AXIS_UNAVAILABLE',`${key}: ${solved.reason}`);
  updates.push({edit,key,weights:solved.weights});
 }
 if(!updates.length)return {graph,changed:false};
 const frameId=draft?.id??options.frameId;
 const propertyResponses:SnapshotPropertyResponses={edges:{...draft?.propertyResponses?.edges},triangles:{...draft?.propertyResponses?.triangles}};
 if(location.kind==='edge'){
  const responses:SnapshotEdgePropertyResponse[]=structuredClone(own(effective.edges,location.simplexId)??[]),progress=location.geometricWeights[support.ownerToLocation[1]];
  for(const {edit,key,weights} of updates){
   const index=responses.findIndex(response=>snapshotScalarPropertyTargetKey(response.target)===key),knots=(index<0?[]:responses[index].knots).filter(knot=>knot[0]!==progress);
   knots.push([progress,weights[support.ownerToLocation[1]]]);knots.sort((a,b)=>a[0]-b[0]);
   const response:SnapshotEdgePropertyResponse={target:{...edit.target},knots};if(index<0)responses.push(response);else responses[index]=response;
  }
  responses.sort((a,b)=>compare(snapshotScalarPropertyTargetKey(a.target),snapshotScalarPropertyTargetKey(b.target)));
  Object.defineProperty(propertyResponses.edges,location.simplexId,{value:responses,enumerable:true,writable:true,configurable:true});
 }else{
  const responses:SnapshotTrianglePropertyResponse[]=structuredClone(own(effective.triangles,location.simplexId)??[]),at=padded(support.ownerToLocation.map(index=>location.geometricWeights[index]));
  for(const {edit,key,weights} of updates){
   const index=responses.findIndex(response=>snapshotScalarPropertyTargetKey(response.target)===key),samples=index<0?[]:responses[index].samples;
   const existing=samples.filter(sample=>sameWeights(sample.at,at)).sort((a,b)=>compare(a.id,b.id))[0];
   const sample={id:existing?.id??JSON.stringify([frameId,key]),at,weights:padded(support.ownerToLocation.map(index=>weights[index]))};
   const response:SnapshotTrianglePropertyResponse={target:{...edit.target},samples:upsertInteriorResponseSample(samples.filter(sample=>!sameWeights(sample.at,at)),sample)};
   if(index<0)responses.push(response);else responses[index]=response;
  }
  responses.sort((a,b)=>compare(snapshotScalarPropertyTargetKey(a.target),snapshotScalarPropertyTargetKey(b.target)));
  Object.defineProperty(propertyResponses.triangles,location.simplexId,{value:responses,enumerable:true,writable:true,configurable:true});
 }
 validateSnapshotPropertyResponses(propertyResponses,graph.mesh);
 const nextFrame:SnapshotCorrectionFrame={...draft,id:frameId,angle:{...options.angle},status:'draft',propertyResponses};
 const candidate:SnapshotAngleGraph={...graph,correctionFrames:draft?graph.correctionFrames!.map(frame=>frame===draft?nextFrame:frame):[...graph.correctionFrames??[],nextFrame]};
 const replay=createSnapshotPropertyResponseSampler(candidate,location,options);
 for(const edit of edits){
  const value=replay(edit.target,edit.basisValues)+(edit.residual??0);
  if(Math.abs(value-edit.value)>256*Number.EPSILON*Math.max(1,Math.abs(value),Math.abs(edit.value)))fail('PROPERTY_CONSTRAINT_UNSOLVABLE',`${snapshotScalarPropertyTargetKey(edit.target)}: the complete response cannot reproduce the requested finite material value.`);
 }
 return {graph:candidate,changed:true};
}

/** Save/discard only property maps, optionally for selected layers. A retained
 * draft simplex remains a complete replacement map, including saved entries
 * from already-finished layers. The caller owns draft-frame removal/status and
 * can finish node/handle maps separately in the same workspace transaction. */
export function finishSnapshotPropertyDraft(graph:SnapshotAngleGraph,save:boolean,selectedLayerIds?:readonly string[]):SnapshotAngleGraph {
 const effective=effectiveSnapshotPropertyResponses(graph),draft=effective.draft;
 if(!draft?.propertyResponses)return graph;
 const prior=graph.propertyResponses??empty();validateSnapshotPropertyResponses(prior,graph.mesh);validateSnapshotPropertyResponses(draft.propertyResponses,graph.mesh);
 const selected=selectedLayerIds===undefined?undefined:new Set(selectedLayerIds);selected?.forEach(id);
 const accepts=(target:SnapshotScalarPropertyTarget)=>!selected||selected.has(target.layerId);
 const saved:SnapshotPropertyResponses={edges:{...prior.edges},triangles:{...prior.triangles}},remaining=empty();
 const canonical=(values:readonly (SnapshotEdgePropertyResponse|SnapshotTrianglePropertyResponse)[])=>JSON.stringify([...values].sort((a,b)=>compare(snapshotScalarPropertyTargetKey(a.target),snapshotScalarPropertyTargetKey(b.target))));
 const finish=<T extends SnapshotEdgePropertyResponse|SnapshotTrianglePropertyResponse>(savedMap:Record<string,T[]>,draftMap:Record<string,T[]>,remainingMap:Record<string,T[]>)=>{
  for(const [simplexId,values] of Object.entries(draftMap)){
   const before=own(savedMap,simplexId)??[];
   const after=save?[...before.filter(response=>!accepts(response.target)),...values.filter(response=>accepts(response.target))]:before;
   const pending=[...after.filter(response=>accepts(response.target)),...values.filter(response=>!accepts(response.target))];
   if(save)Object.defineProperty(savedMap,simplexId,{value:after,enumerable:true,writable:true,configurable:true});
   if(canonical(pending)!==canonical(after))Object.defineProperty(remainingMap,simplexId,{value:pending,enumerable:true,writable:true,configurable:true});
  }
 };
 finish(saved.edges,draft.propertyResponses.edges,remaining.edges);finish(saved.triangles,draft.propertyResponses.triangles,remaining.triangles);
 const {propertyResponses:ignored,...frame}=draft;void ignored;
 const nextFrame:SnapshotCorrectionFrame={...frame,...Object.keys(remaining.edges).length||Object.keys(remaining.triangles).length?{propertyResponses:remaining}:{}};
 return {...graph,...save?{propertyResponses:saved}:{},correctionFrames:graph.correctionFrames!.map(value=>value===draft?nextFrame:value)};
}
