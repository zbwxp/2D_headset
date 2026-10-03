import {captureSnapshotProjectedResponses,remapSnapshotSmoothContracts,type SnapshotProjectionComponent} from './responseExpressionProjection';
import {smoothEndpointKey} from './smoothComponent';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import type {Point2} from '../drawing/model';
import type {SnapshotAngleGraph,SnapshotControlResponse,SnapshotExpressionControlResponse,SnapshotExpressionResponses,SnapshotResponseExpressionRegistry,SnapshotTriangleControlResponse} from './model';
import type {SnapshotScalarTarget} from './simplexGeometry';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {
 captureSnapshotResponseField,combineSnapshotResponseExpressions,createSnapshotResponseResidual,emptySnapshotResponseExpression,
 splitSnapshotCubicResponseExpressions,substituteSnapshotResponseBases,snapshotResponseBasisKey,SnapshotResponseExpressionError,
 snapshotResponseExpressionHasValue,type SnapshotCubicResponseExpressions,type SnapshotResponseBasisReference,type SnapshotResponseExpression,type SnapshotResponseExpressionField,
} from './responseExpressions';

type Split=Pick<CurveSplitIntent,'curveId'|'sourceNodeIds'|'t'|'childCurveIds'|'seamNodeId'>;
export type SnapshotResponseExpressionSurface=Pick<SnapshotAngleGraph,'edgeResponses'|'triangleResponses'|'responseExpressions'>;
type Surface=SnapshotResponseExpressionSurface;
const axes=['x','y'] as const;
const own=<T>(record:Record<string,T>|undefined,key:string):T|undefined=>record&&Object.hasOwn(record,key)?record[key]:undefined;
const put=<T>(record:Record<string,T>,key:string,value:T)=>Object.defineProperty(record,key,{value,enumerable:true,writable:true,configurable:true});
const fail=(message:string):never=>{throw new SnapshotResponseExpressionError('EXPRESSION_INVALID',message);};
const expressionControl=(responses:SnapshotExpressionResponses|undefined,target:SnapshotScalarTarget)=>target.kind==='node'?own(responses?.nodes,target.nodeId):own(responses?.handles,target.curveId)?.[target.end];
const control=<T extends SnapshotControlResponse|SnapshotTriangleControlResponse>(responses:{nodes:Record<string,T>;handles:Record<string,readonly [T,T]>}|undefined,target:SnapshotScalarTarget):T|undefined=>target.kind==='node'?own(responses?.nodes,target.nodeId):own(responses?.handles,target.curveId)?.[target.end];

/** Reuse one capture authority for source splits and real-view insertion. Scope
 * must identify this transfer (e.g. fresh child IDs or new real snapshot ID),
 * including saved/draft provenance, so an older retained field can never be
 * overwritten by a newer independent set of constraints under the same ID. */
export function createSnapshotResponseExpressionCapture(mesh:SnapshotTriangulation,source:SnapshotResponseExpressionSurface,scope:string):(location:SnapshotSimplexLocation,target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression {
 if(typeof scope!=='string'||!scope)fail('A response capture needs a stable transfer scope.');
 const snapshots=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex.snapshotId])),empty=emptySnapshotResponseExpression();
 return (location,target,axis)=>{
  const inherited=expressionControl(own(source.responseExpressions,location.simplexId),target)?.[axes[axis]]??empty;
  const field=captureSnapshotResponseField(JSON.stringify(['response-field',scope,location.simplexId,target,axis]),mesh,location,{
   edgeKnots:edgeId=>control(own(source.edgeResponses,edgeId),target)?.[axes[axis]],
   triangleSamples:triangleId=>control(own(source.triangleResponses,triangleId),target)?.[axes[axis]],
  });
  if(!field.samples.length&&!field.edges.some(edge=>edge.knots?.length))return inherited;
  const native=createSnapshotResponseResidual(field,field.vertexIds.map(vertexId=>[{coefficient:1,basis:{snapshotId:snapshots.get(vertexId)!,target:{...target},axis}}]));
  return combineSnapshotResponseExpressions([{coefficient:1,expression:inherited},{coefficient:1,expression:native}]);
 };
}

export type SnapshotSmoothResponseIdentity={available:true;ratio:number}|{available:false;reason:string};
export interface SnapshotSmoothResponseBasis {
 a:Point2;b:Point2;
 /** Optional arithmetic evidence from these actual live controls, per axis:
  * |absolute H| + |absolute P| for the subtraction H-P. Not a user tolerance,
  * sampled projection movement, or persisted geometric correction. */
 aSubtractionScale?:Point2;bSubtractionScale?:Point2;
}
/** Certify that a SMOOTH projection is already the identity, using one constant
 * positive r with A+r*B=0 in every real basis AND every independent expression
 * coefficient on every affected simplex. No sampled-angle fitting is involved.
 * A de Casteljau seam has r=t/(1-t). Unmatched field provenance is deliberately
 * not guessed equivalent, and there is no absolute epsilon for tiny vectors.
 * Symbolic coefficients retain their strict relative bound. Real bases may also
 * carry the source magnitudes that bound H-P cancellation and ratio-estimation
 * uncertainty. Those arithmetic bounds never apply to expression coefficients. */
export function certifySnapshotSmoothResponseIdentity(bases:readonly SnapshotSmoothResponseBasis[],surfaces:readonly {a:SnapshotExpressionControlResponse;b:SnapshotExpressionControlResponse}[]):SnapshotSmoothResponseIdentity {
 type Equation={a:number;b:number;label:string;kind:'basis'|'coefficient';aError:number;bError:number;aMagnitude:number;bMagnitude:number};
 const unavailable=(reason:string):SnapshotSmoothResponseIdentity=>({available:false,reason}),equations:Equation[]=[];
 const finitePoint=(point:unknown):point is Point2=>Array.isArray(point)&&point.length===2&&[0,1].every(axis=>typeof point[axis]==='number'&&Number.isFinite(point[axis]));
 // One subtraction of the supplied finite source coordinates. MIN_VALUE is
 // only the IEEE subnormal rounding quantum, never an ordinary geometry halo.
 const subtractionError=(scale:number|undefined)=>scale?Math.max(Number.MIN_VALUE,Number.EPSILON*scale):0;
 if(!bases.length)return unavailable('A SMOOTH identity proof needs the actual real-basis handle vectors.');
 for(const [index,pair] of bases.entries()){
  if(![pair.a,pair.b].every(finitePoint))return unavailable('A SMOOTH identity proof needs finite two-axis vectors.');
  for(const scale of [pair.aSubtractionScale,pair.bSubtractionScale])if(scale!==undefined&&(!finitePoint(scale)||scale.some(value=>value<0)))return unavailable('Source subtraction scales must be finite nonnegative two-axis magnitudes.');
  const aMagnitude=Math.hypot(...pair.a),bMagnitude=Math.hypot(...pair.b);
  if(!Number.isFinite(aMagnitude)||!Number.isFinite(bMagnitude))return unavailable('The SMOOTH vector magnitudes cannot be represented finitely.');
  for(const axis of [0,1] as const)equations.push({a:pair.a[axis],b:pair.b[axis],label:`real basis ${index} ${axes[axis]}`,kind:'basis',aError:subtractionError(pair.aSubtractionScale?.[axis]),bError:subtractionError(pair.bSubtractionScale?.[axis]),aMagnitude,bMagnitude});
 }
 const fields=new Map<string,string>();
 const coefficients=(expression:SnapshotResponseExpression|undefined)=>{
  const result=new Map<string,number>();if(!expression)return result;
  const canonical=combineSnapshotResponseExpressions([{coefficient:1,expression}]);
  if(canonical.operations?.length)fail('A projected SMOOTH program requires its original component composition.');
  for(const field of canonical.fields){const serialized=JSON.stringify(field),prior=fields.get(field.id);if(prior&&prior!==serialized)fail(`SMOOTH proof field ${field.id} has incompatible retained support.`);fields.set(field.id,serialized);}
  for(const term of canonical.terms)for(const value of term.basis)result.set(JSON.stringify([term.fieldId,term.coordinate,term.weight,snapshotResponseBasisKey(value.basis)]),value.coefficient);
  return result;
 };
 try{
  for(const [index,pair] of surfaces.entries())for(const axis of axes){
   const a=coefficients(pair.a[axis]),b=coefficients(pair.b[axis]);
   for(const key of new Set([...a.keys(),...b.keys()]))equations.push({a:a.get(key)??0,b:b.get(key)??0,label:`response simplex ${index} ${axis}`,kind:'coefficient',aError:0,bError:0,aMagnitude:Math.abs(a.get(key)??0),bMagnitude:Math.abs(b.get(key)??0)});
  }
 }catch(error){return unavailable(error instanceof Error?error.message:String(error));}
 // Prefer a symbolic ratio, whose source arithmetic is independent of H-P.
 const symbolic=equations.filter(value=>value.kind==='coefficient'&&value.b!==0).reduce<Equation|undefined>((best,value)=>!best||Math.abs(value.b)>Math.abs(best.b)?value:best,undefined);
 const candidates=equations.filter(value=>value.kind==='basis'&&value.b!==0).flatMap(value=>{
  const ratio=-value.a/value.b,denominator=Math.abs(value.b)-value.bError;
  if(!Number.isFinite(ratio)||ratio<=0||denominator<=0)return [];
  const uncertainty=(value.aError+ratio*value.bError)/denominator;
  return Number.isFinite(uncertainty)?[{ratio,uncertainty,size:Math.abs(value.b)}]:[];
 });
 const basisReference=candidates.reduce<(typeof candidates)[number]|undefined>((best,value)=>!best||value.uncertainty/value.ratio<best.uncertainty/best.ratio||value.uncertainty/value.ratio===best.uncertainty/best.ratio&&value.size>best.size?value:best,undefined);
 const ratio=symbolic?-symbolic.a/symbolic.b:basisReference?.ratio??1,ratioUncertainty=symbolic?0:basisReference?.uncertainty??0;
 if(!symbolic&&!basisReference&&equations.some(value=>value.a!==0||value.b!==0))return unavailable('The SMOOTH handle ratio is not resolvable at its source subtraction precision.');
 if(!Number.isFinite(ratio)||ratio<=0)return unavailable('The SMOOTH handles do not have one finite opposite direction ratio.');
 for(const equation of equations){
  const paired=ratio*equation.b,pairedMagnitude=ratio*equation.bMagnitude,scale=Math.max(equation.aMagnitude,pairedMagnitude);
  if(!Number.isFinite(paired)||!Number.isFinite(pairedMagnitude))return unavailable('The SMOOTH ratio cannot be represented with finite coordinates.');
  if(scale===0)continue;
  // A direction's numeric scale is the complete vector, including a near-zero
  // component produced by normalization/reflection. Coefficients retain their
  // own scalar magnitude; there is no shared geometric scale for symbols.
  const normalized=equation.a/scale+paired/scale,relative=128*Number.EPSILON*(equation.aMagnitude/scale+pairedMagnitude/scale);
  const source=equation.kind==='basis'?equation.aError/scale+ratio*(equation.bError/scale)+ratioUncertainty*(Math.abs(equation.b)/scale):0;
  const bound=relative+source;
  if(Math.abs(normalized)>bound)return unavailable(`SMOOTH projection is not the identity at ${equation.label}; its normalized handle direction is nonlinear.`);
 }
 return {available:true,ratio};
}

export interface SnapshotSplitResponseOptions {
 /** The workspace compiler must inspect actual shared projection dependencies.
  * Supplying none asserts that this response transfer is linear. */
 nonlinearDependencies:readonly string[];
 /** Exact original component contracts, shared by every active real basis. */
 smoothComponents?:(location:SnapshotSimplexLocation)=>readonly SnapshotProjectionComponent[];
 /** Resolve the actual shared node authority in the ORIGINAL active simplex.
  * Default is appropriate only when each source endpoint is its own authority. */
 nodeAuthority?:(nodeId:string,location:SnapshotSimplexLocation)=>string;
}

/** Remap a Recorder's saved and draft residuals for one explicit source split.
 * The caller owns canonical identity/membership checks and real Snapshot pose
 * propagation. This function touches no geometry, mesh, properties or archives.
 * Endpoint node native responses remain authoritative; new seam/handle targets
 * receive combined native + inherited residual expressions. */
export function remapSnapshotSplitResponses(graph:SnapshotAngleGraph,intent:Split,options:SnapshotSplitResponseOptions):SnapshotAngleGraph {
 const empty=emptySnapshotResponseExpression();
 splitSnapshotCubicResponseExpressions([empty,empty,empty,empty],{...intent,nonlinearDependencies:options.smoothComponents?[]:options.nonlinearDependencies});
 if(!intent.seamNodeId||!Array.isArray(intent.sourceNodeIds)||intent.sourceNodeIds.length!==2||intent.sourceNodeIds.some(id=>typeof id!=='string'||!id)||intent.sourceNodeIds.includes(intent.seamNodeId))fail('A response split needs the original endpoint identities and a fresh seam node.');
 const snapshotByVertex=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.snapshotId]));
 const locations:SnapshotSimplexLocation[]=[...graph.mesh.edges.map(edge=>({kind:'edge' as const,simplexId:edge.id,vertexIds:[...edge.vertexIds],snapshotIds:edge.vertexIds.map(id=>snapshotByVertex.get(id)!),geometricWeights:[.5,.5]})),...graph.mesh.triangles.map(triangle=>({kind:'triangle' as const,simplexId:triangle.id,vertexIds:[...triangle.vertexIds],snapshotIds:triangle.vertexIds.map(id=>snapshotByVertex.get(id)!),geometricWeights:[1/3,1/3,1/3]}))];
 const replacement=(basis:SnapshotResponseBasisReference)=>{
  if(basis.target.kind!=='handle'||basis.target.curveId!==intent.curveId)return undefined;
  const end=basis.target.end;return [{coefficient:1/(end===0?intent.t:1-intent.t),basis:{...basis,target:{kind:'handle' as const,curveId:intent.childCurveIds[end],end}}}];
 };
 const rewrite=(expression:SnapshotResponseExpression)=>remapSnapshotSmoothContracts(substituteSnapshotResponseBases(expression,replacement),intent);
 const rewriteControl=(value:SnapshotExpressionControlResponse):SnapshotExpressionControlResponse=>({...value,...value.x?{x:rewrite(value.x)}:{},...value.y?{y:rewrite(value.y)}:{}});

 const transfer=(source:Surface,scope:string):Surface=>{
  const registry:SnapshotResponseExpressionRegistry={};
  const capture=createSnapshotResponseExpressionCapture(graph.mesh,source,JSON.stringify(['split',scope,intent.curveId,intent.childCurveIds,intent.t]));
  const components=new Map(locations.map(location=>[location.simplexId,options.smoothComponents?.(location)??[]]));
  const projected=new Map(locations.map(location=>[location.simplexId,captureSnapshotProjectedResponses(graph.mesh,location,components.get(location.simplexId)!,capture,scope,(target,axis)=>expressionControl(own(source.responseExpressions,location.simplexId),target)?.[axes[axis]]??empty)]));
  if(options.nonlinearDependencies.length&&![...components.values()].some(values=>values.length))throw new SnapshotResponseExpressionError('EXPRESSION_NONLINEAR_DEPENDENCY','No original SMOOTH component was supplied for this nonlinear split.');
  const capturedNodes=new Set([...components.values()].flatMap(components=>components.flatMap(component=>[...component.nodeIds])));
  const ownedEndpoints=new Map([...projected.values()].flatMap(values=>[...values]));
  const captured=(location:SnapshotSimplexLocation,target:SnapshotScalarTarget,axis:0|1)=>target.kind==='handle'?projected.get(location.simplexId)?.get(smoothEndpointKey(target))?.response[axes[axis]]??capture(location,target,axis):capture(location,target,axis);
  const stripOwned=<T extends SnapshotControlResponse|SnapshotTriangleControlResponse>(map:Record<string,{nodes:Record<string,T>;handles:Record<string,[T,T]>}>)=>Object.fromEntries(Object.entries(map).map(([id,responses])=>[id,{...responses,nodes:capturedNodes.size?Object.fromEntries(Object.entries(responses.nodes).filter(([nodeId])=>!capturedNodes.has(nodeId))):responses.nodes,handles:Object.fromEntries(Object.entries(responses.handles).filter(([curveId])=>curveId!==intent.curveId).map(([curveId,pair])=>[curveId,([0,1] as const).some(end=>ownedEndpoints.has(smoothEndpointKey({curveId,end})))?pair.map((value,end)=>ownedEndpoints.has(smoothEndpointKey({curveId,end:end as 0|1}))?{} as T:value) as [T,T]:pair]))}])) as typeof map;

  // References to this retired handle may occur in any surviving target after
  // previous splits, including a sibling curve outside the current split.
  for(const [simplexId,responses] of Object.entries(source.responseExpressions??{}))put(registry,simplexId,{
   nodes:Object.fromEntries(Object.entries(responses.nodes).map(([nodeId,value])=>[nodeId,rewriteControl(value)])),
   handles:Object.fromEntries(Object.entries(responses.handles).filter(([curveId])=>curveId!==intent.curveId).map(([curveId,pair])=>[curveId,[rewriteControl(pair[0]),rewriteControl(pair[1])] as const])),
  });
  for(const location of locations){
   const existing=own(source.responseExpressions,location.simplexId);
   const native=location.kind==='edge'?own(source.edgeResponses,location.simplexId):own(source.triangleResponses,location.simplexId);
   if(intent.childCurveIds.some(id=>own(existing?.handles,id)||native&&Object.hasOwn(native.handles,id))||own(existing?.nodes,intent.seamNodeId)||native&&Object.hasOwn(native.nodes,intent.seamNodeId))fail(`Split response identity already exists in ${location.simplexId}.`);
   for(const nodeId of capturedNodes){const prior=own(registry,location.simplexId)??{nodes:{},handles:{}};put(prior.nodes,nodeId,{x:rewrite(capture(location,{kind:'node',nodeId},0)),y:rewrite(capture(location,{kind:'node',nodeId},1))});put(registry,location.simplexId,prior);}
   for(const {endpoint} of ownedEndpoints.values())if(endpoint.curveId!==intent.curveId){
    const response:SnapshotExpressionControlResponse={x:rewrite(captured(location,{kind:'handle',...endpoint},0)),y:rewrite(captured(location,{kind:'handle',...endpoint},1))},prior=own(registry,location.simplexId)??{nodes:{},handles:{}},pair=own(prior.handles,endpoint.curveId)??[{},{}];
    put(prior.handles,endpoint.curveId,endpoint.end===0?[response,pair[1]]:[pair[0],response]);put(registry,location.simplexId,prior);
   }
   const targets:readonly SnapshotScalarTarget[]=[{kind:'node',nodeId:options.nodeAuthority?.(intent.sourceNodeIds[0],location)??intent.sourceNodeIds[0]},{kind:'handle',curveId:intent.curveId,end:0},{kind:'handle',curveId:intent.curveId,end:1},{kind:'node',nodeId:options.nodeAuthority?.(intent.sourceNodeIds[1],location)??intent.sourceNodeIds[1]}];
   const seam:SnapshotExpressionControlResponse={},left:[SnapshotExpressionControlResponse,SnapshotExpressionControlResponse]=[{},{}],right:[SnapshotExpressionControlResponse,SnapshotExpressionControlResponse]=[{},{}];
   for(const axis of [0,1] as const){
    const expressions=targets.map(target=>{const expression=captured(location,target,axis);if(!projected.get(location.simplexId)?.size&&!expression.smoothContracts?.length)return expression;
     const field:SnapshotResponseExpressionField={id:JSON.stringify(['split-source-baseline',scope,location.simplexId,intent.childCurveIds]),vertexIds:[...location.vertexIds],edges:[],samples:[]};
     return {...expression,fields:[...expression.fields.filter(value=>value.id!==field.id),field],sourceBaseline:location.snapshotIds.map((snapshotId,coordinate)=>({fieldId:field.id,coordinate:coordinate as 0|1|2,weight:'geometric' as const,basis:[{coefficient:1,basis:{snapshotId,target,axis}}]}))};
    }) as unknown as SnapshotCubicResponseExpressions;
    if(expressions.every(expression=>!snapshotResponseExpressionHasValue(expression)&&!expression.smoothOwned))continue;
    const transformed=splitSnapshotCubicResponseExpressions(expressions,{...intent,nonlinearDependencies:options.smoothComponents?[]:options.nonlinearDependencies});
    if(snapshotResponseExpressionHasValue(transformed.left[3])||transformed.left[3].smoothOwned)seam[axes[axis]]=remapSnapshotSmoothContracts(transformed.left[3],intent);
    for(const end of [0,1] as const){
     if(snapshotResponseExpressionHasValue(transformed.left[end+1])||transformed.left[end+1].smoothOwned)left[end][axes[axis]]=remapSnapshotSmoothContracts(transformed.left[end+1],intent);
     if(snapshotResponseExpressionHasValue(transformed.right[end+1])||transformed.right[end+1].smoothOwned)right[end][axes[axis]]=remapSnapshotSmoothContracts(transformed.right[end+1],intent);
    }
   }
   if(left.some(value=>value.x?.smoothOwned||value.y?.smoothOwned)||right.some(value=>value.x?.smoothOwned||value.y?.smoothOwned)){
    const a={curveId:intent.childCurveIds[0],end:1 as const},b={curveId:intent.childCurveIds[1],end:0 as const},contract={id:JSON.stringify(['split-seam-contract',scope,location.simplexId,intent.childCurveIds]),component:{relationId:JSON.stringify(['split-seam',intent.childCurveIds]),members:[{endpoint:a,sign:1},{endpoint:b,sign:-1}],conflict:false},targets:[{endpoint:a,scale:1},{endpoint:b,scale:1}]};
    for(const value of [left[1],right[0]])for(const axis of axes){const expression=value[axis]??empty;value[axis]={...expression,smoothOwned:true,smoothContracts:[...expression.smoothContracts??[],contract]};}
   }
   if(Object.keys(seam).length||left.some(value=>Object.keys(value).length)||right.some(value=>Object.keys(value).length)){
    const prior=own(registry,location.simplexId)??{nodes:{},handles:{}},nodes={...prior.nodes},handles={...prior.handles};
    if(Object.keys(seam).length)put(nodes,intent.seamNodeId,seam);
    if(left.some(value=>Object.keys(value).length))put(handles,intent.childCurveIds[0],left);
    if(right.some(value=>Object.keys(value).length))put(handles,intent.childCurveIds[1],right);
    put(registry,location.simplexId,{nodes,handles});
   }
  }
  return {edgeResponses:stripOwned(source.edgeResponses),triangleResponses:stripOwned(source.triangleResponses),...(Object.keys(registry).length?{responseExpressions:registry}:{})};
 };
 const saved=transfer(graph,'saved');
 const frames=graph.correctionFrames?.map(frame=>{
  const changed=new Set([...Object.keys(frame.edgeResponses??{}),...Object.keys(frame.triangleResponses??{}),...Object.keys(frame.responseExpressions??{})]);
  for(const triangle of graph.mesh.triangles)if(triangle.edgeIds.some(id=>Object.hasOwn(frame.edgeResponses??{},id)))changed.add(triangle.id);
  if(!changed.size)return frame;
  const effective=transfer({edgeResponses:{...graph.edgeResponses,...frame.edgeResponses},triangleResponses:{...graph.triangleResponses,...frame.triangleResponses},responseExpressions:{...graph.responseExpressions,...frame.responseExpressions}},`frame:${frame.id}`);
  const overlays:SnapshotResponseExpressionRegistry={};
  for(const simplexId of changed){const after=own(effective.responseExpressions,simplexId),before=own(saved.responseExpressions,simplexId);if(after||before)put(overlays,simplexId,after??{nodes:{},handles:{}});}
  return {...frame,...frame.edgeResponses?{edgeResponses:Object.fromEntries(Object.keys(frame.edgeResponses).map(id=>[id,effective.edgeResponses[id]]))}:{},...frame.triangleResponses?{triangleResponses:Object.fromEntries(Object.keys(frame.triangleResponses).map(id=>[id,effective.triangleResponses[id]]))}:{},...(Object.keys(overlays).length?{responseExpressions:overlays}:{})};
 });
 // Delete a now-empty registry explicitly; spreading the old graph must not
 // retain retired parent-handle expression targets when none survive.
 const {responseExpressions:ignored,...rest}=graph;void ignored;
 return {...rest,...saved,...frames?{correctionFrames:frames}:{}};
}
