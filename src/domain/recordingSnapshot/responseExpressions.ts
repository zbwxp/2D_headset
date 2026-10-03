import type {SnapshotScalarTarget} from './simplexGeometry';
import {describeSnapshotScalarResponseSupport} from './scalarResponseSupport';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {prepareTriangularResponse,type BarycentricWeights,type InteriorResponseSample,type OrientedEdgeResponse,type ScalarResponseKnot} from './triangularResponses';

/** Recorder-only algebra. No coordinate value, drawing, snapshot, sampled curve,
 * or recursive expression can occur in this schema. Each field keeps its own
 * interpolation support: merging different sample sets changes the IDW kernel.
 * Terms form a depth-two acyclic graph: expression -> field / live basis leaf. */
export interface SnapshotResponseBasisReference {
 snapshotId:string;target:SnapshotScalarTarget;axis:0|1;
}
export interface SnapshotResponseBasisTerm {coefficient:number;basis:SnapshotResponseBasisReference}
export type SnapshotResponseLinearBasis=readonly SnapshotResponseBasisTerm[];
export interface SnapshotResponseExpressionField {
 id:string;
 /** Persisted field order, independent of the current active simplex order. */
 vertexIds:readonly string[];
 edges:readonly OrientedEdgeResponse[];
 samples:readonly InteriorResponseSample[];
}
export interface SnapshotResponseExpressionTerm {
 fieldId:string;coordinate:0|1|2;
 /** Geometric terms allow exact baseline rebasing after a real-view insertion.
  * Residual terms use w-lambda, including signed and overshooting responses. */
 weight:'residual'|'geometric';basis:SnapshotResponseLinearBasis;
}
export interface SnapshotResponseExpression {
 version:1;fields:readonly SnapshotResponseExpressionField[];terms:readonly SnapshotResponseExpressionTerm[];
}
export type SnapshotResponseExpressionErrorCode='EXPRESSION_INVALID'|'EXPRESSION_LIMIT'|'EXPRESSION_NONLINEAR_DEPENDENCY'|'EXPRESSION_MISSING_BASIS'|'EXPRESSION_MISSING_SUPPORT';
export class SnapshotResponseExpressionError extends Error {
 constructor(public readonly code:SnapshotResponseExpressionErrorCode,message:string){super(message);this.name='SnapshotResponseExpressionError';}
}
const fail=(code:SnapshotResponseExpressionErrorCode,message:string):never=>{throw new SnapshotResponseExpressionError(code,message);};
const invalid=(message:string):never=>fail('EXPRESSION_INVALID',message);
export const snapshotResponseExpressionLimits=Object.freeze({fields:256,terms:4096,basisTerms:16384,samples:16384,knots:16384,idLength:16384});
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const lastNonzero=(values:readonly number[])=>{for(let index=values.length-1;index>=0;index--)if(values[index]!==0)return index;return -1;};
/** Both weight vectors satisfy the affine partition. Complete one active
 * difference from zero-sum, so common offsets cannot become a deformation. */
function residualWeights(original:readonly number[],response:readonly number[]):number[]{
 const difference=original.map((value,index)=>response[index]-value),last=lastNonzero(original);
 if(last>=0)difference[last]=-difference.reduce((sum,value,index)=>index===last?sum:sum+value,0);
 return difference;
}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid('Expression data must contain plain objects.');
 const own=Reflect.ownKeys(value);
 if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))return invalid('Expression object has missing, unknown, or accessor fields.');
 return value as Record<string,unknown>;
}
function array(value:unknown,max:number,label:string):unknown[]{
 if(!Array.isArray(value))return invalid(`${label} must be an array.`);
 if(value.length>max)fail('EXPRESSION_LIMIT',`${label} exceeds the bounded expression limit.`);
 if(Reflect.ownKeys(value).length!==value.length+1||Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i)||!('value' in Object.getOwnPropertyDescriptor(value,i)!)))return invalid(`${label} must be a dense data array.`);
 return value;
}
function id(value:unknown):asserts value is string {if(typeof value!=='string'||!value.length||value.length>snapshotResponseExpressionLimits.idLength)invalid('Expression identifiers must be nonempty bounded strings.');}
function validateTarget(value:unknown):void {
 const kind=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'kind')?.value:undefined;
 if(kind==='node'){const target=object(value,['kind','nodeId']);id(target.nodeId);}
 else if(kind==='handle'){const target=object(value,['kind','curveId','end']);id(target.curveId);if(target.end!==0&&target.end!==1)invalid('Handle end must be zero or one.');}
 else invalid('Expressions address only nodes or relative handle vectors.');
}
function validateBasis(value:unknown):void {
 const term=object(value,['coefficient','basis']);if(!finite(term.coefficient))invalid('Basis coefficients must be finite.');
 const basis=object(term.basis,['snapshotId','target','axis']);id(basis.snapshotId);validateTarget(basis.target);
 if(basis.axis!==0&&basis.axis!==1)invalid('Basis axis must be zero or one.');
}
function validateField(value:unknown):void {
 const field=object(value,['id','vertexIds','edges','samples']);id(field.id);
 const vertices=array(field.vertexIds,3,'Field vertices');
 if(vertices.length<2)invalid('A response field needs an edge or triangle support.');
 vertices.forEach(id);if(new Set(vertices).size!==vertices.length)invalid('Field vertex IDs must be distinct.');
 for(const value of array(field.edges,3,'Field edges')){
  const edge=value as OrientedEdgeResponse;
  object(value,value&&typeof value==='object'&&Object.hasOwn(value,'knots')?['from','to','knots']:['from','to']);
  if(!Number.isInteger(edge.from)||!Number.isInteger(edge.to)||edge.from<0||edge.to<0||edge.from>=vertices.length||edge.to>=vertices.length)invalid('Field edge orientation is outside its support.');
  if(edge.knots!==undefined)for(const knot of array(edge.knots,snapshotResponseExpressionLimits.knots,'Response knots')){
   const tuple=array(knot,2,'Response knot');if(tuple.length!==2||!tuple.every(finite))invalid('Response knots must be finite numeric pairs.');
  }
 }
 const samples=array(field.samples,snapshotResponseExpressionLimits.samples,'Response samples');
 if(vertices.length===2&&samples.length)invalid('An edge field cannot own triangle samples.');
 for(const value of samples){
  const sample=object(value,['id','at','weights']);id(sample.id);
  for(const tuple of [sample.at,sample.weights])if(array(tuple,3,'Sample weights').length!==3)invalid('Sample weights must contain three coordinates.');
 }
 try{prepareTriangularResponse(field.edges as OrientedEdgeResponse[],samples as InteriorResponseSample[]);}catch(error){invalid(error instanceof Error?error.message:String(error));}
}

/** Strict nonrecursive parser: cycles, unknown expression/reference nodes,
 * dangling field IDs and nested geometry are rejected rather than traversed. */
export function validateSnapshotResponseExpression(value:unknown):asserts value is SnapshotResponseExpression {
 const expression=object(value,['version','fields','terms']);if(expression.version!==1)invalid('Unsupported response expression version.');
 const fields=array(expression.fields,snapshotResponseExpressionLimits.fields,'Expression fields'),byId=new Map<string,SnapshotResponseExpressionField>();
 let totalSamples=0,totalKnots=0,totalBasis=0;
 for(const value of fields){validateField(value);const field=value as SnapshotResponseExpressionField;if(byId.has(field.id))invalid(`Duplicate expression field ${field.id}.`);byId.set(field.id,field);
  totalSamples+=field.samples.length;totalKnots+=field.edges.reduce((sum,edge)=>sum+(edge.knots?.length??0),0);
  if(totalSamples>snapshotResponseExpressionLimits.samples||totalKnots>snapshotResponseExpressionLimits.knots)fail('EXPRESSION_LIMIT','The total expression field support exceeds its bounded limit.');
 }
 for(const value of array(expression.terms,snapshotResponseExpressionLimits.terms,'Expression terms')){
  const term=object(value,['fieldId','coordinate','weight','basis']);id(term.fieldId);
  const field=byId.get(term.fieldId);if(!field)invalid(`Expression references missing field ${term.fieldId}.`);
  if(!Number.isInteger(term.coordinate)||(term.coordinate as number)<0||(term.coordinate as number)>=field!.vertexIds.length)invalid('Expression weight coordinate is outside its field support.');
  if(term.weight!=='residual'&&term.weight!=='geometric')invalid('Unknown expression weight operation.');
  const basis=array(term.basis,snapshotResponseExpressionLimits.basisTerms,'Linear basis');totalBasis+=basis.length;
  if(totalBasis>snapshotResponseExpressionLimits.basisTerms)fail('EXPRESSION_LIMIT','The total expression basis support exceeds its bounded limit.');basis.forEach(validateBasis);
 }
 if(totalSamples>snapshotResponseExpressionLimits.samples||totalKnots>snapshotResponseExpressionLimits.knots||totalBasis>snapshotResponseExpressionLimits.basisTerms)fail('EXPRESSION_LIMIT','The total expression support exceeds its bounded limit.');
}

export const snapshotResponseBasisKey=(basis:SnapshotResponseBasisReference):string=>JSON.stringify([basis.snapshotId,basis.target.kind,basis.target.kind==='node'?basis.target.nodeId:basis.target.curveId,basis.target.kind==='handle'?basis.target.end:null,basis.axis]);
const copyBasis=(basis:SnapshotResponseBasisReference):SnapshotResponseBasisReference=>({...basis,target:{...basis.target}});
function canonicalBasis(terms:SnapshotResponseLinearBasis):SnapshotResponseBasisTerm[]{
 const byKey=new Map<string,SnapshotResponseBasisTerm>();
 for(const term of terms){const key=snapshotResponseBasisKey(term.basis),coefficient=(byKey.get(key)?.coefficient??0)+term.coefficient;if(!finite(coefficient))invalid('Combining expression coefficients overflowed.');byKey.set(key,{coefficient,basis:copyBasis(term.basis)});}
 return [...byKey].sort(([a],[b])=>compare(a,b)).map(([,term])=>term).filter(term=>term.coefficient!==0);
}
function cloneField(field:SnapshotResponseExpressionField):SnapshotResponseExpressionField {
 return {id:field.id,vertexIds:[...field.vertexIds],edges:field.edges.map(edge=>({...edge,...edge.knots?{knots:edge.knots.map(knot=>[...knot] as ScalarResponseKnot)}:{}})).sort((a,b)=>a.from-b.from||a.to-b.to),samples:field.samples.map(sample=>({id:sample.id,at:[...sample.at] as BarycentricWeights,weights:[...sample.weights] as BarycentricWeights})).sort((a,b)=>compare(a.id,b.id))};
}
export function emptySnapshotResponseExpression():SnapshotResponseExpression{return {version:1,fields:[],terms:[]};}

/** Combine only algebraic terms. Different fields never union sample supports.
 * Same-ID different fields are a provenance conflict, never last-write-wins. */
export function combineSnapshotResponseExpressions(inputs:readonly {coefficient:number;expression:SnapshotResponseExpression}[]):SnapshotResponseExpression {
 const fields=new Map<string,SnapshotResponseExpressionField>(),terms=new Map<string,SnapshotResponseExpressionTerm>();
 let basisCount=0,workBasis=0,workFields=0,workSamples=0,workKnots=0;
 if(inputs.length>snapshotResponseExpressionLimits.terms)fail('EXPRESSION_LIMIT','Too many expression operands.');
 for(const {coefficient,expression} of inputs){
  if(!finite(coefficient))invalid('Expression scale must be finite.');validateSnapshotResponseExpression(expression);
  if(coefficient===0)continue;
  workFields+=expression.fields.length;workBasis+=expression.terms.reduce((sum,term)=>sum+term.basis.length,0);
  workSamples+=expression.fields.reduce((sum,field)=>sum+field.samples.length,0);workKnots+=expression.fields.reduce((sum,field)=>sum+field.edges.reduce((sum,edge)=>sum+(edge.knots?.length??0),0),0);
  if(workFields>4*snapshotResponseExpressionLimits.fields||workBasis>4*snapshotResponseExpressionLimits.basisTerms||workSamples>4*snapshotResponseExpressionLimits.samples||workKnots>4*snapshotResponseExpressionLimits.knots)fail('EXPRESSION_LIMIT','Combining operands exceeds the bounded expression work budget.');
  for(const field of expression.fields){
   if(!fields.has(field.id)&&fields.size===snapshotResponseExpressionLimits.fields)fail('EXPRESSION_LIMIT','Combining operands exceeds the field limit.');
   const owned=cloneField(field),prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(owned))invalid(`Field ${field.id} has conflicting interpolation supports.`);fields.set(field.id,owned);
  }
  for(const term of expression.terms){
   const key=JSON.stringify([term.fieldId,term.coordinate,term.weight]),basis=canonicalBasis([...(terms.get(key)?.basis??[]),...term.basis.map(value=>({basis:value.basis,coefficient:value.coefficient*coefficient}))]);
   basisCount+=basis.length-(terms.get(key)?.basis.length??0);
   if(basisCount>snapshotResponseExpressionLimits.basisTerms||!terms.has(key)&&terms.size===snapshotResponseExpressionLimits.terms)fail('EXPRESSION_LIMIT','Combining operands exceeds the expression term limit.');
   terms.set(key,{fieldId:term.fieldId,coordinate:term.coordinate,weight:term.weight,basis});
  }
 }
 const kept=[...terms].sort(([a],[b])=>compare(a,b)).map(([,term])=>term).filter(term=>term.basis.length),used=new Set(kept.map(term=>term.fieldId));
 const result:SnapshotResponseExpression={version:1,fields:[...fields.values()].filter(field=>used.has(field.id)).sort((a,b)=>compare(a.id,b.id)),terms:kept};
 validateSnapshotResponseExpression(result);return result;
}

/** Snapshot supports are supplied in persisted field order. No absolute basis
 * coordinates are captured; all leaves are resolved afresh at evaluation. */
export function createSnapshotResponseResidual(field:SnapshotResponseExpressionField,bases:readonly SnapshotResponseLinearBasis[]):SnapshotResponseExpression {
 if(bases.length!==field.vertexIds.length)invalid('A residual needs one live basis recipe per field vertex.');
 const expression:SnapshotResponseExpression={version:1,fields:[field],terms:bases.map((basis,coordinate)=>({fieldId:field.id,coordinate:coordinate as 0|1|2,weight:'residual',basis}))};
 return combineSnapshotResponseExpressions([{coefficient:1,expression}]);
}

/** Capture only scalar field data using the common support/orientation authority.
 * Callers supply effective saved/draft responses, with their normal ownership. */
export function captureSnapshotResponseField(id:string,mesh:SnapshotTriangulation,location:SnapshotSimplexLocation,source:{edgeKnots:(edgeId:string)=>readonly ScalarResponseKnot[]|undefined;triangleSamples:(triangleId:string)=>readonly InteriorResponseSample[]|undefined}):SnapshotResponseExpressionField {
 const support=describeSnapshotScalarResponseSupport(mesh,location,invalid);
 if(support.kind==='vertex')invalid('A real vertex has no response field to transfer.');
 const field:SnapshotResponseExpressionField={id,vertexIds:support.ownerToLocation.map(index=>location.vertexIds[index]),edges:support.edges.map(edge=>{const knots=source.edgeKnots(edge.id);return {from:edge.from,to:edge.to,...knots?{knots}:{}};}),samples:support.kind==='triangle'?source.triangleSamples(support.simplexId)??[]:[]};
 validateField(field);return cloneField(field);
}

/** A single substitution pass followed by canonical flattening. Replacements
 * are live linear recipes, never expressions that could form a dependency cycle. */
export function substituteSnapshotResponseBases(expression:SnapshotResponseExpression,replacement:(basis:SnapshotResponseBasisReference)=>SnapshotResponseLinearBasis|undefined):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);
 let expanded=0;
 const next:SnapshotResponseExpression={version:1,fields:expression.fields,terms:expression.terms.map(term=>({...term,basis:term.basis.flatMap(value=>{
  const replaced=replacement(copyBasis(value.basis)),values=replaced===undefined?[value]:array(replaced,snapshotResponseExpressionLimits.basisTerms,'Replacement basis');
  expanded+=values.length;if(expanded>snapshotResponseExpressionLimits.basisTerms)fail('EXPRESSION_LIMIT','Substituting live bases exceeds the bounded expression expansion limit.');
  if(replaced===undefined)return [value];
  for(const candidate of values)validateBasis(candidate);
  return replaced.map(candidate=>({basis:copyBasis(candidate.basis),coefficient:candidate.coefficient*value.coefficient}));
 })}))};
 return combineSnapshotResponseExpressions([{coefficient:1,expression:next}]);
}

/** Restrict to a new simplex whose real bases were created from the old full
 * response. Subtract the affine interpolation of the OLD residual at its new
 * corners. Only dimensionless field coefficients are stored, never sampled
 * geometry. The resulting residual is zero at every new real vertex, so edits
 * to that vertex remain authoritative. Original per-field kernels stay intact.
 * Repeated restrictions flatten into the same bounded algebra. */
export function restrictSnapshotResponseExpression(expression:SnapshotResponseExpression,newSupport:SnapshotResponseExpressionField,originalWeightsAtVertex:(field:SnapshotResponseExpressionField,newVertexIndex:number)=>readonly number[]):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);validateField(newSupport);
 if(newSupport.edges.length||newSupport.samples.length)invalid('A restriction support supplies geometric coordinates only, not another response field.');
 const fields=new Map(expression.fields.map(field=>[field.id,field])),terms:SnapshotResponseExpressionTerm[]=[];
 const anchors=new Map<string,readonly {original:readonly number[];response:readonly number[]}[]>();
 for(const field of expression.fields){
  const sample=prepareTriangularResponse(field.edges,field.samples);
  anchors.set(field.id,newSupport.vertexIds.map((_,index)=>{
   const original=[...originalWeightsAtVertex(cloneField(field),index)];
   if(original.length!==field.vertexIds.length)fail('EXPRESSION_MISSING_SUPPORT',`Restriction of field ${field.id} needs its full original support.`);
   const padded=original.length===2?[...original,0]:original;
   let response:readonly number[];try{response=sample(padded as unknown as BarycentricWeights);}catch(error){return invalid(error instanceof Error?error.message:String(error));}
   return {original,response};
  }));
 }
 for(const term of expression.terms){
  if(!fields.has(term.fieldId))invalid('Missing restriction field.');
  anchors.get(term.fieldId)!.forEach(({original,response},index)=>{
   const weight=term.weight==='geometric'?original[term.coordinate]:residualWeights(original,response)[term.coordinate];
   if(weight!==0)terms.push({fieldId:newSupport.id,coordinate:index as 0|1|2,weight:'geometric',basis:term.basis.map(value=>({basis:value.basis,coefficient:-weight*value.coefficient}))});
  });
 }
 return combineSnapshotResponseExpressions([{coefficient:1,expression},{coefficient:1,expression:{version:1,fields:[newSupport],terms}}]);
}

export interface SnapshotResponseExpressionEvaluation {
 basisScalar:(basis:SnapshotResponseBasisReference)=>number|undefined;
 /** Return ORIGINAL geometric weights in this operand's persisted vertex order.
  * After mesh insertion, map the new simplex into the retained old angle frame.
  * The operand's sample support and edge extension remain completely unchanged. */
 geometricWeights:(field:SnapshotResponseExpressionField)=>readonly number[];
}
export function prepareSnapshotResponseExpression(expression:SnapshotResponseExpression):(evaluation:SnapshotResponseExpressionEvaluation)=>number {
 const owned=combineSnapshotResponseExpressions([{coefficient:1,expression}]);
 // The support callback sees this metadata. Freeze the private copy so it
 // cannot alter the prepared operand or future calls through that reference.
 for(const field of owned.fields){
  Object.freeze(field.vertexIds);
  for(const edge of field.edges){for(const knot of edge.knots??[])Object.freeze(knot);if(edge.knots)Object.freeze(edge.knots);Object.freeze(edge);}Object.freeze(field.edges);
  for(const sample of field.samples){Object.freeze(sample.at);Object.freeze(sample.weights);Object.freeze(sample);}Object.freeze(field.samples);Object.freeze(field);
 }
 const fields=owned.fields.map(field=>({field,sample:prepareTriangularResponse(field.edges,field.samples),terms:owned.terms.filter(term=>term.fieldId===field.id)}));
 return evaluation=>{
  const bases=new Map<string,number>();
  const scalar=(terms:SnapshotResponseLinearBasis)=>{
   let origin:number|undefined,coefficient=0,offset=0;
   for(const value of terms){
    const key=snapshotResponseBasisKey(value.basis);let scalar=bases.get(key);
    if(scalar===undefined){scalar=evaluation.basisScalar(copyBasis(value.basis));if(!finite(scalar))fail('EXPRESSION_MISSING_BASIS',`Missing or nonfinite live basis ${key}.`);bases.set(key,scalar!);}
    origin??=scalar!;coefficient+=value.coefficient;offset+=value.coefficient*(scalar!-origin);
   }
   // Restriction compensation is a linear form too. Center before scaling so
   // zero-sum recipes do not multiply a large common offset and then cancel it.
   return offset+(origin??0)*coefficient;
  };
  let result=0;
  for(const compiled of fields){
   const original=[...evaluation.geometricWeights(compiled.field)];
   if(original.length!==compiled.field.vertexIds.length)fail('EXPRESSION_MISSING_SUPPORT',`Field ${compiled.field.id} needs its complete original angle support.`);
   const padded=original.length===2?[...original,0]:original;
   let response:readonly number[];try{response=compiled.sample(padded as unknown as BarycentricWeights);}catch(error){return invalid(error instanceof Error?error.message:String(error));}
   const difference=residualWeights(original,response),residual=new Map(compiled.terms.filter(term=>term.weight==='residual').map(term=>[term.coordinate,term.basis]));
   const anchor=lastNonzero(difference);
   // Center each independent field before multiplication. Exactly equal live
   // source coordinates have exactly zero residual, even at large offsets.
   if(residual.size&&anchor>=0){
    const origin=scalar(residual.get(anchor as 0|1|2)??[]);
    difference.forEach((weight,index)=>{if(weight!==0&&index!==anchor)result+=weight*(scalar(residual.get(index as 0|1|2)??[])-origin);});
   }
   for(const term of compiled.terms)if(term.weight==='geometric'&&original[term.coordinate]!==0)result+=original[term.coordinate]*scalar(term.basis);
  }
  if(!finite(result))invalid('Response expression produced a nonfinite scalar.');return result;
 };
}

/** Same input signature as SnapshotScalarWeights, but the result is a value.
 * A weight-only adapter cannot express nonconstant responses at equal child
 * endpoint coordinates. Membership must still use the untouched geometric λ. */
export type SnapshotScalarResponseValueSampler=(target:SnapshotScalarTarget,axis:0|1,coordinates:readonly number[],geometricWeights:readonly number[])=>number;
export function createSnapshotExpressionValueSampler(location:Pick<SnapshotSimplexLocation,'vertexIds'>,source:{expression:(target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression|undefined;basisScalar:SnapshotResponseExpressionEvaluation['basisScalar'];geometricWeights?:(field:SnapshotResponseExpressionField,weights:readonly number[])=>readonly number[]}):SnapshotScalarResponseValueSampler {
 const ids=array(location.vertexIds,3,'Active simplex vertices');ids.forEach(id);if(!ids.length||new Set(ids).size!==ids.length)invalid('An active simplex needs one to three distinct vertex IDs.');
 const cache=new Map<string,ReturnType<typeof prepareSnapshotResponseExpression>|null>(),vertexIds=[...location.vertexIds];
 return (target,axis,coordinates,weights)=>{
  array(coordinates,3,'Active basis coordinates');array(weights,3,'Original geometric weights');
  if(coordinates.length!==weights.length||weights.length!==vertexIds.length||!coordinates.every(finite)||!weights.every(w=>finite(w)&&w>=0)||Math.abs(weights.reduce((sum,w)=>sum+w,0)-1)>64*Number.EPSILON)invalid('A scalar value sampler needs finite bases and original geometric weights.');
  const key=JSON.stringify([target,axis]);let sample=cache.get(key);
  if(sample===undefined){const expression=source.expression({...target},axis);sample=expression?prepareSnapshotResponseExpression(expression):null;cache.set(key,sample);}
  const baseline=coordinates.reduce((sum,value,index)=>sum+value*weights[index],0);
  const callbackWeights=source.geometricWeights?Object.freeze([...weights]):weights;
  const residual=sample?.({basisScalar:source.basisScalar,geometricWeights:field=>{
   if(source.geometricWeights)return source.geometricWeights(field,callbackWeights);
   if(vertexIds.some((id,index)=>weights[index]!==0&&!field.vertexIds.includes(id)))fail('EXPRESSION_MISSING_SUPPORT',`Field ${field.id} needs an explicit map from the new simplex into its original angle support.`);
   return field.vertexIds.map(id=>{const index=vertexIds.indexOf(id);return index<0?0:weights[index];});
  }})??0;
  const result=baseline+residual;if(!finite(result))invalid('Response expression value is nonfinite.');return result;
 };
}

/** P0, H0-P0, H1-P1, P1 in final snapshot coordinates. */
export type SnapshotCubicResponseExpressions=readonly [SnapshotResponseExpression,SnapshotResponseExpression,SnapshotResponseExpression,SnapshotResponseExpression];
export interface SnapshotCubicResponseSplit {
 curveId:string;t:number;childCurveIds:readonly [string,string];
 /** Required even when empty: SMOOTH projection is nonlinear and cannot be
  * hidden behind this linear transfer. The transaction must diagnose it first. */
 nonlinearDependencies:readonly string[];
}
export function splitSnapshotCubicResponseExpressions(input:SnapshotCubicResponseExpressions,split:SnapshotCubicResponseSplit):{left:SnapshotCubicResponseExpressions;right:SnapshotCubicResponseExpressions} {
 id(split.curveId);const children=array(split.childCurveIds,2,'Split child IDs');children.forEach(id);
 if(children.length!==2||new Set([split.curveId,...children]).size!==3)invalid('A response split needs two distinct fresh child curve IDs.');
 if(!finite(split.t)||split.t<=0||split.t>=1)invalid('A response split needs a finite strict interior parameter.');
 const dependencies=array(split.nonlinearDependencies,snapshotResponseExpressionLimits.basisTerms,'Nonlinear dependencies');dependencies.forEach(id);
 if(dependencies.length)fail('EXPRESSION_NONLINEAR_DEPENDENCY',`Exact linear response transfer requires an explicit projection expression for SMOOTH dependencies: ${dependencies.join(', ')}.`);
 if(array(input,4,'Cubic responses').length!==4)invalid('A cubic response needs four scalar control expressions.');
 input.forEach(validateSnapshotResponseExpression);
 const t=split.t,u=1-t;
 const rows=[
  [1,0,0,0], [0,t,0,0], [2*u*t*t,u*t*(3*t-1),t*t*(3*t-2),-2*u*t*t],
  [u*u*u+3*u*u*t,3*u*u*t,3*u*t*t,3*u*t*t+t*t*t],
  [-2*u*u*t,u*u*(1-3*t),u*t*(2-3*t),2*u*u*t], [0,0,u,0], [0,0,0,1],
 ];
 const transformed=rows.map(row=>substituteSnapshotResponseBases(combineSnapshotResponseExpressions(input.map((expression,index)=>({expression,coefficient:row[index]}))),basis=>{
  if(basis.target.kind!=='handle'||basis.target.curveId!==split.curveId)return undefined;
  const end=basis.target.end,divisor=end===0?t:u;
  return [{coefficient:1/divisor,basis:{...basis,target:{kind:'handle',curveId:split.childCurveIds[end],end}}}];
 }));
 return {left:[transformed[0],transformed[1],transformed[2],transformed[3]],right:[transformed[3],transformed[4],transformed[5],transformed[6]]};
}
