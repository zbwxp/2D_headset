import {projectSmoothComponent,projectSmoothComponentCorrection,type SmoothComponent} from './smoothComponent';
import {createSnapshotSplitParameterField} from './splitParameterField';
import type {Cubic} from '../drawing/model';
import type {SnapshotScalarTarget} from './simplexGeometry';
import {describeSnapshotScalarResponseSupport} from './scalarResponseSupport';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import {prepareTriangularResponse,type BarycentricWeights,type InteriorResponseSample,type OrientedEdgeResponse,type ScalarResponseKnot} from './triangularResponses';

/** Recorder-only algebra. No saved control coordinate, drawing, snapshot,
 * sampled curve or recursive object can occur in this schema. Each field keeps
 * its own interpolation support. Linear terms address live basis leaves; the
 * optional bounded projection program uses strictly backward references. */
export interface SnapshotResponseBasisReference {
 snapshotId:string;target:SnapshotScalarTarget;axis:0|1;
}
export interface SnapshotResponseFitParameterReference {
 snapshotId:string;parts:readonly {curveId:string;parameterRange:readonly [number,number]}[];t:number;
}
export type SnapshotResponseFitParameterDomain=Pick<SnapshotResponseFitParameterReference,'parts'|'t'>;
export interface SnapshotResponseBasisScalarResolver {
 (basis:SnapshotResponseBasisReference):number|undefined;
 fitParameter?:(reference:SnapshotResponseFitParameterReference)=>number|undefined;
 recordFitParameter?:(domain:SnapshotResponseFitParameterDomain,parameter:number,parent?:Cubic)=>void;
}
export type SnapshotResponseBasisResolver=SnapshotResponseBasisScalarResolver;
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
export interface SnapshotSmoothProjectionContract {id:string;component:SmoothComponent;targets:readonly {endpoint:{curveId:string;end:0|1};scale:number}[]}
export type SnapshotResponseOperation=
 |{kind:'constant';value:number}
 |{kind:'basis';basis:SnapshotResponseBasisReference}
 |{kind:'fit-parameter';reference:SnapshotResponseFitParameterReference}
 |{kind:'product';left:number;right:number}
 |{kind:'quotient';left:number;right:number}
 |{kind:'curve-material-parameter';controls:readonly (readonly [number,number])[];parameters:readonly number[];fieldId:string;domain?:SnapshotResponseFitParameterDomain}
 |{kind:'at';source:number;weights:readonly {fieldId:string;values:readonly number[]}[]}
 |{kind:'weighted';source:number;fieldId:string;coordinate:0|1|2;weight?:'residual'|'geometric'}
 |{kind:'linear';terms:readonly SnapshotResponseExpressionTerm[]}
 |{kind:'sum';inputs:readonly {coefficient:number;operation:number}[]}
 |{kind:'smooth';component:SmoothComponent;inputs:readonly {node:readonly [number,number];vector:readonly [number,number]}[];member:number;axis:0|1}
 |{kind:'smooth-correction';component:SmoothComponent;inputs:readonly {node:readonly [number,number];vector:readonly [number,number]}[];baselineInputs:readonly {node:readonly [number,number];vector:readonly [number,number]}[];scales:readonly number[];member:number;axis:0|1};
export interface SnapshotResponseExpression {
 version:1;fields:readonly SnapshotResponseExpressionField[];terms:readonly SnapshotResponseExpressionTerm[];
 /** A bounded topologically ordered scalar/vector program. All references point
  * strictly backward; leaves are the same live controls and scalar fields. */
 operations?:readonly SnapshotResponseOperation[];
 /** This final control already owns its original component projection. */
 smoothOwned?:true;
 smoothContracts?:readonly SnapshotSmoothProjectionContract[];
 /** Live-control recipe before a transfer introduced independent real bases.
  * Restriction may add projected corner values using the same bounded DAG. */
 sourceBaseline?:readonly SnapshotResponseExpressionTerm[];
 sourceBaselineOperations?:readonly SnapshotResponseOperation[];
}
export type SnapshotResponseExpressionErrorCode='EXPRESSION_INVALID'|'EXPRESSION_LIMIT'|'EXPRESSION_NONLINEAR_DEPENDENCY'|'EXPRESSION_MISSING_BASIS'|'EXPRESSION_MISSING_SUPPORT';
export class SnapshotResponseExpressionError extends Error {
 constructor(public readonly code:SnapshotResponseExpressionErrorCode,message:string){super(message);this.name='SnapshotResponseExpressionError';}
}
const fail=(code:SnapshotResponseExpressionErrorCode,message:string):never=>{throw new SnapshotResponseExpressionError(code,message);};
const invalid=(message:string):never=>fail('EXPRESSION_INVALID',message);
export const snapshotResponseExpressionLimits=Object.freeze({fields:256,terms:4096,basisTerms:16384,samples:16384,knots:16384,idLength:16384,operations:4096,operationInputs:16384});
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
 validateBasisReference(term.basis);
}
function validateBasisReference(value:unknown):void {
 const basis=object(value,['snapshotId','target','axis']);id(basis.snapshotId);validateTarget(basis.target);
 if(basis.axis!==0&&basis.axis!==1)invalid('Basis axis must be zero or one.');
}
function validateFitParameterReference(value:unknown):number {
 const reference=object(value,['snapshotId','parts','t']);id(reference.snapshotId);
 if(!finite(reference.t)||reference.t<0||reference.t>1)invalid('A fitted parameter reference needs a finite native t within 0…1.');
 const parts=array(reference.parts,256,'Fitted parameter pieces'),ids=new Set<string>();let boundary=0;
 if(!parts.length)invalid('A fitted parameter reference needs current live pieces.');
 for(const raw of parts){const part=object(raw,['curveId','parameterRange']);id(part.curveId);if(ids.has(part.curveId))invalid('Fitted parameter pieces must have distinct live identities.');ids.add(part.curveId);const range=array(part.parameterRange,2,'Fitted parameter interval');if(range.length!==2||!range.every(finite)||range[0]!==boundary||!(Number(range[1])>boundary)||Number(range[1])>1)invalid('Fitted parameter pieces must form a contiguous native partition.');boundary=Number(range[1]);}
 if(boundary!==1)invalid('Fitted parameter pieces must cover 0…1.');return parts.length;
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
 const optional=value&&typeof value==='object'?['operations','smoothOwned','smoothContracts','sourceBaseline','sourceBaselineOperations'].filter(key=>Object.hasOwn(value,key)):[];
 const expression=object(value,['version','fields','terms',...optional]);if(expression.version!==1)invalid('Unsupported response expression version.');
 const fields=array(expression.fields,snapshotResponseExpressionLimits.fields,'Expression fields'),byId=new Map<string,SnapshotResponseExpressionField>();
 let totalSamples=0,totalKnots=0,totalBasis=0,totalTerms=0;
 for(const value of fields){validateField(value);const field=value as SnapshotResponseExpressionField;if(byId.has(field.id))invalid(`Duplicate expression field ${field.id}.`);byId.set(field.id,field);
  totalSamples+=field.samples.length;totalKnots+=field.edges.reduce((sum,edge)=>sum+(edge.knots?.length??0),0);
  if(totalSamples>snapshotResponseExpressionLimits.samples||totalKnots>snapshotResponseExpressionLimits.knots)fail('EXPRESSION_LIMIT','The total expression field support exceeds its bounded limit.');
 }
 const validateTerms=(raw:unknown)=>{const terms=array(raw,snapshotResponseExpressionLimits.terms,'Expression terms');totalTerms+=terms.length;if(totalTerms>snapshotResponseExpressionLimits.terms)fail('EXPRESSION_LIMIT','The total expression term count exceeds its bounded limit.');for(const value of terms){
  const term=object(value,['fieldId','coordinate','weight','basis']);id(term.fieldId);
  const field=byId.get(term.fieldId);if(!field)invalid(`Expression references missing field ${term.fieldId}.`);
  if(!Number.isInteger(term.coordinate)||(term.coordinate as number)<0||(term.coordinate as number)>=field!.vertexIds.length)invalid('Expression weight coordinate is outside its field support.');
  if(term.weight!=='residual'&&term.weight!=='geometric')invalid('Unknown expression weight operation.');
  const basis=array(term.basis,snapshotResponseExpressionLimits.basisTerms,'Linear basis');totalBasis+=basis.length;
  if(totalBasis>snapshotResponseExpressionLimits.basisTerms)fail('EXPRESSION_LIMIT','The total expression basis support exceeds its bounded limit.');basis.forEach(validateBasis);
 }
 };validateTerms(expression.terms);
 if(expression.sourceBaseline!==undefined)validateTerms(expression.sourceBaseline);
 if(expression.smoothOwned!==undefined&&expression.smoothOwned!==true)invalid('Projection ownership must be true when present.');
 if(expression.smoothContracts!==undefined){const ids=new Set<string>();for(const raw of array(expression.smoothContracts,256,'SMOOTH contracts')){const contract=object(raw,['id','component','targets']);id(contract.id);if(ids.has(contract.id))invalid('Duplicate SMOOTH contract.');ids.add(contract.id);const component=object(contract.component,['relationId','members','conflict']);id(component.relationId);if(typeof component.conflict!=='boolean')invalid('Invalid SMOOTH conflict.');const members=array(component.members,256,'SMOOTH members'),targets=array(contract.targets,256,'SMOOTH targets');if(!members.length||targets.length!==members.length)invalid('A SMOOTH contract needs corresponding component targets.');for(const rawMember of members){const member=object(rawMember,['endpoint','sign']),endpoint=object(member.endpoint,['curveId','end']);id(endpoint.curveId);if(endpoint.end!==0&&endpoint.end!==1||member.sign!==1&&member.sign!==-1)invalid('Invalid SMOOTH contract member.');}if((members[0] as {sign:number}).sign!==1)invalid('Invalid SMOOTH driver sign.');const keys=new Set<string>();for(const rawTarget of targets){const target=object(rawTarget,['endpoint','scale']),endpoint=object(target.endpoint,['curveId','end']);id(endpoint.curveId);if(endpoint.end!==0&&endpoint.end!==1||!finite(target.scale)||target.scale<=0)invalid('Invalid SMOOTH contract scale or target.');const key=JSON.stringify([endpoint.curveId,endpoint.end]);if(keys.has(key))invalid('Duplicate SMOOTH contract target.');keys.add(key);}}}
 let totalInputs=0,evaluationWork=0,totalOperations=0;
 for(const rawProgram of [expression.operations,expression.sourceBaselineOperations])if(rawProgram!==undefined){const program=array(rawProgram,snapshotResponseExpressionLimits.operations,'Expression operations'),depths:number[]=[];totalOperations+=program.length;if(totalOperations>snapshotResponseExpressionLimits.operations)fail('EXPRESSION_LIMIT','The expression and source baseline exceed their shared operation limit.');
 for(const [index,raw] of program.entries()){
  const kind=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,'kind')?.value:undefined;
  let depth=0;evaluationWork++;const reference=(value:unknown)=>{totalInputs++;if(!Number.isInteger(value)||(value as number)<0||(value as number)>=index)invalid('Operation references must point strictly backward.');depth=Math.max(depth,depths[value as number]);};
  if(kind==='constant'){const operation=object(raw,['kind','value']);if(!finite(operation.value))invalid('Expression constants must be finite.');}
  else if(kind==='basis'){const operation=object(raw,['kind','basis']);validateBasisReference(operation.basis);totalBasis++;}
  else if(kind==='fit-parameter'){const operation=object(raw,['kind','reference']);totalBasis+=validateFitParameterReference(operation.reference);}
  else if(kind==='product'||kind==='quotient'){const operation=object(raw,['kind','left','right']);reference(operation.left);reference(operation.right);}
  else if(kind==='curve-material-parameter'){const operation=object(raw,['kind','controls','parameters','fieldId',...Object.hasOwn(raw as object,'domain')?['domain']:[]]);id(operation.fieldId);const field=byId.get(operation.fieldId);if(!field)invalid('A material parameter needs a known field.');const controls=array(operation.controls,4,'Material parameter controls');if(controls.length!==4)invalid('A material parameter needs four cubic controls.');for(const raw of controls){const pair=array(raw,2,'Material parameter control');if(pair.length!==2)invalid('A material parameter control needs two scalar references.');pair.forEach(reference);}const parameters=array(operation.parameters,3,'Material basis parameters');if(parameters.length!==field!.vertexIds.length)invalid('A material parameter needs one cut per field vertex.');parameters.forEach(reference);if(operation.domain!==undefined){const domain=object(operation.domain,['parts','t']);totalBasis+=validateFitParameterReference({snapshotId:'material-domain',...domain});}}
  else if(kind==='linear'){const operation=object(raw,['kind','terms']);validateTerms(operation.terms);}
  else if(kind==='sum'){const operation=object(raw,['kind','inputs']);for(const rawInput of array(operation.inputs,snapshotResponseExpressionLimits.operationInputs,'Operation inputs')){const input=object(rawInput,['coefficient','operation']);if(!finite(input.coefficient))invalid('Operation coefficients must be finite.');reference(input.operation);}}
  else if(kind==='at'){const operation=object(raw,['kind','source','weights']);reference(operation.source);evaluationWork+=(operation.source as number)+1;const keys=new Set<string>();for(const rawWeight of array(operation.weights,snapshotResponseExpressionLimits.fields,'Anchor weights')){const weight=object(rawWeight,['fieldId','values']);id(weight.fieldId);const field=byId.get(weight.fieldId);if(!field||keys.has(weight.fieldId))invalid('An anchor needs distinct known field weights.');keys.add(weight.fieldId);const values=array(weight.values,3,'Anchor coordinates');totalInputs+=values.length;if(values.length!==field!.vertexIds.length||!values.every(finite)||Math.abs((values as number[]).reduce((sum,value)=>sum+value,0)-1)>1e-10)invalid('Anchor coordinates must be finite affine weights.');}}
  else if(kind==='weighted'){const operation=object(raw,['kind','source','fieldId','coordinate',...Object.hasOwn(raw as object,'weight')?['weight']:[]]);reference(operation.source);id(operation.fieldId);const field=byId.get(operation.fieldId);if(!field||!Number.isInteger(operation.coordinate)||(operation.coordinate as number)<0||(operation.coordinate as number)>=field.vertexIds.length)invalid('A weighted operation needs a coordinate in a known field.');if(operation.weight!==undefined&&operation.weight!=='geometric'&&operation.weight!=='residual')invalid('Unknown weighted response operation.');}
  else if(kind==='smooth'||kind==='smooth-correction'){
   const operation=object(raw,['kind','component','inputs','member','axis',...kind==='smooth-correction'?['baselineInputs','scales']:[]]),component=object(operation.component,['relationId','members','conflict']);id(component.relationId);if(typeof component.conflict!=='boolean')invalid('SMOOTH conflict must be boolean.');
   const members=array(component.members,snapshotResponseExpressionLimits.operationInputs,'SMOOTH members');if(!members.length)invalid('A SMOOTH component needs a driver.');
   const endpoints=new Set<string>();for(const rawMember of members){const member=object(rawMember,['endpoint','sign']),endpoint=object(member.endpoint,['curveId','end']);id(endpoint.curveId);if(endpoint.end!==0&&endpoint.end!==1||member.sign!==1&&member.sign!==-1)invalid('Invalid SMOOTH endpoint or sign.');const key=JSON.stringify([endpoint.curveId,endpoint.end]);if(endpoints.has(key))invalid('Duplicate SMOOTH component member.');endpoints.add(key);}
   if((members[0] as {sign:number}).sign!==1)invalid('The original SMOOTH driver must have positive sign.');
   const inputs=array(operation.inputs,snapshotResponseExpressionLimits.operationInputs,'SMOOTH inputs');if(inputs.length!==members.length)invalid('Every SMOOTH component member needs original node and vector inputs.');
   for(const rawInput of inputs){const input=object(rawInput,['node','vector']);for(const pair of [input.node,input.vector]){const tuple=array(pair,2,'SMOOTH vector');if(tuple.length!==2)invalid('A SMOOTH vector needs two scalar inputs.');tuple.forEach(reference);}}
   if(kind==='smooth-correction'){const baseline=array(operation.baselineInputs,256,'SMOOTH correction baseline'),scales=array(operation.scales,256,'SMOOTH correction scales');if(baseline.length!==members.length||scales.length!==members.length||!scales.every(value=>finite(value)&&value>0))invalid('Invalid SMOOTH correction inputs.');for(const rawInput of baseline){const input=object(rawInput,['node','vector']);for(const pair of [input.node,input.vector]){const tuple=array(pair,2,'SMOOTH correction vector');if(tuple.length!==2)invalid('A SMOOTH correction vector needs two scalar inputs.');tuple.forEach(reference);}}}
   if(!Number.isInteger(operation.member)||(operation.member as number)<0||(operation.member as number)>=members.length||operation.axis!==0&&operation.axis!==1)invalid('Invalid SMOOTH output.');
  }else invalid('Unknown response operation.');
  depths.push(depth+(kind==='at'?1:0));if(depths[index]>32||evaluationWork>65536)fail('EXPRESSION_LIMIT','The expression exceeds its bounded anchor evaluation budget.');
  if(totalInputs>snapshotResponseExpressionLimits.operationInputs)fail('EXPRESSION_LIMIT','The expression operation graph exceeds its bounded work limit.');
 }
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

/** Visit every live leaf, including the original inputs of nonlinear programs. */
export function snapshotResponseExpressionTerms(expression:SnapshotResponseExpression):readonly SnapshotResponseExpressionTerm[]{return [...expression.terms,...expression.sourceBaseline??[],...[...expression.operations??[],...expression.sourceBaselineOperations??[]].flatMap(operation=>operation.kind==='linear'?operation.terms:[])];}
export function snapshotResponseExpressionBasisReferences(expression:SnapshotResponseExpression):SnapshotResponseBasisReference[]{
 const references=[...snapshotResponseExpressionTerms(expression).flatMap(term=>term.basis.map(value=>value.basis)),...[...expression.operations??[],...expression.sourceBaselineOperations??[]].flatMap(operation=>operation.kind==='basis'?[operation.basis]:[])];
 return [...new Map(references.map(reference=>[snapshotResponseBasisKey(reference),reference])).values()].map(copyBasis);
}
export function snapshotResponseExpressionFitParameters(expression:SnapshotResponseExpression):SnapshotResponseFitParameterReference[]{
 const references=[...expression.operations??[],...expression.sourceBaselineOperations??[]].flatMap(operation=>operation.kind==='fit-parameter'?[operation.reference]:[]);
 return [...new Map(references.map(reference=>[JSON.stringify(reference),reference])).values()].map(reference=>structuredClone(reference));
}
export function snapshotResponseExpressionMaterialDomains(expression:SnapshotResponseExpression):SnapshotResponseFitParameterDomain[]{
 const domains=[...expression.operations??[],...expression.sourceBaselineOperations??[]].flatMap(operation=>operation.kind==='curve-material-parameter'&&operation.domain?[operation.domain]:[]);
 return [...new Map(domains.map(domain=>[JSON.stringify(domain),domain])).values()].map(domain=>structuredClone(domain));
}
export const snapshotResponseExpressionHasValue=(expression:SnapshotResponseExpression):boolean=>!!expression.terms.length||!!expression.operations?.length;
function mapOperationReferences(operation:SnapshotResponseOperation,map:(index:number)=>number):SnapshotResponseOperation {
 if(operation.kind==='constant')return {...operation};
 if(operation.kind==='basis')return {...operation,basis:copyBasis(operation.basis)};
 if(operation.kind==='fit-parameter')return {...operation,reference:structuredClone(operation.reference)};
 if(operation.kind==='product'||operation.kind==='quotient')return {...operation,left:map(operation.left),right:map(operation.right)};
 if(operation.kind==='curve-material-parameter')return {...operation,controls:operation.controls.map(pair=>pair.map(map) as [number,number]),parameters:operation.parameters.map(map),...operation.domain?{domain:structuredClone(operation.domain)}:{}};
 if(operation.kind==='linear')return {kind:'linear',terms:operation.terms.map(term=>({...term,basis:canonicalBasis(term.basis)}))};
 if(operation.kind==='at')return {...operation,source:map(operation.source),weights:operation.weights.map(weight=>({fieldId:weight.fieldId,values:[...weight.values]}))};
 if(operation.kind==='weighted')return {...operation,source:map(operation.source)};
 if(operation.kind==='sum')return {kind:'sum',inputs:operation.inputs.map(input=>({...input,operation:map(input.operation)}))};
 const inputs=(values:typeof operation.inputs)=>values.map(input=>({node:input.node.map(map) as [number,number],vector:input.vector.map(map) as [number,number]}));
 return {...operation,component:structuredClone(operation.component),inputs:inputs(operation.inputs),...operation.kind==='smooth-correction'?{baselineInputs:inputs(operation.baselineInputs),scales:[...operation.scales]}:{}};
}
/** Select one live scalar program without evaluating unrelated earlier roots.
 * The original bounded backward DAG supplies dependency order and provenance. */
export function extractSnapshotResponseOperation(expression:SnapshotResponseExpression,rootIndex:number):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);const source=expression.operations;
 if(!source||!Number.isInteger(rootIndex)||rootIndex<0||rootIndex>=source.length)invalid('An extracted response root must address an existing operation.');
 const reachable=new Set<number>(),pending=[rootIndex];while(pending.length){const index=pending.pop()!;if(reachable.has(index))continue;reachable.add(index);mapOperationReferences(source![index],reference=>{pending.push(reference);return reference;});}
 const ordered=[...reachable].sort((a,b)=>a-b),indices=new Map(ordered.map((old,index)=>[old,index])),result:SnapshotResponseExpression={version:1,fields:expression.fields.map(cloneField),terms:[],operations:ordered.map(index=>mapOperationReferences(source![index],reference=>indices.get(reference)!))};validateSnapshotResponseExpression(result);return result;
}

function programBuilder(){
 const operations:SnapshotResponseOperation[]=[],byKey=new Map<string,number>();
 const append=(input:SnapshotResponseOperation)=>{let operation=input;if(operation.kind==='sum'){const coefficients=new Map<number,number>();for(const term of operation.inputs){const value=operations[term.operation],terms=value?.kind==='sum'?value.inputs.map(child=>({operation:child.operation,coefficient:child.coefficient*term.coefficient})):[term];for(const child of terms)coefficients.set(child.operation,(coefficients.get(child.operation)??0)+child.coefficient);}const inputs=[...coefficients].sort(([a],[b])=>a-b).filter(([,coefficient])=>coefficient!==0).map(([operation,coefficient])=>({operation,coefficient}));if(inputs.length===1&&inputs[0].coefficient===1)return inputs[0].operation;operation={kind:'sum',inputs};}const key=JSON.stringify(operation),known=byKey.get(key);if(known!==undefined)return known;if(operations.length>=snapshotResponseExpressionLimits.operations)fail('EXPRESSION_LIMIT','The expression program exceeds its operation limit.');const index=operations.length;operations.push(operation);byKey.set(key,index);return index;};
 const importProgram=(expression:SnapshotResponseExpression)=>{const indices:number[]=[];for(const operation of expression.operations??[])indices.push(append(mapOperationReferences(operation,index=>indices[index])));return indices.at(-1);};
 const finish=(index:number)=>{if(index!==operations.length-1)operations.push({kind:'sum',inputs:[{coefficient:1,operation:index}]});};
 return {operations,append,importProgram,finish};
}
function scalarOperation(builder:ReturnType<typeof programBuilder>,expression:SnapshotResponseExpression):number {
 const program=builder.importProgram(expression),linear=expression.terms.length?builder.append({kind:'linear',terms:expression.terms}):undefined;
 const inputs=[program,linear].filter((value):value is number=>value!==undefined).map(operation=>({coefficient:1,operation}));
 return builder.append({kind:'sum',inputs});
}
/** Build bounded scalar arithmetic while retaining the same field supports and
 * original source-baseline program. Nothing here captures evaluated geometry. */
function arithmeticExpression(inputs:readonly SnapshotResponseExpression[],operation:(indices:readonly number[])=>SnapshotResponseOperation,extraFields:readonly SnapshotResponseExpressionField[]=[],baseline=true):SnapshotResponseExpression {
 const fields=new Map<string,SnapshotResponseExpressionField>(),contracts=new Map<string,SnapshotSmoothProjectionContract>(),builder=programBuilder();let smoothOwned=false;
 const addField=(field:SnapshotResponseExpressionField)=>{validateField(field);const owned=cloneField(field),prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(owned))invalid('Arithmetic operands have conflicting field support.');fields.set(field.id,owned);};
 for(const expression of inputs){validateSnapshotResponseExpression(expression);expression.fields.forEach(addField);smoothOwned ||= !!expression.smoothOwned;for(const contract of expression.smoothContracts??[]){const prior=contracts.get(contract.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(contract))invalid('Arithmetic operands have conflicting SMOOTH contracts.');contracts.set(contract.id,structuredClone(contract));}}
 extraFields.forEach(addField);builder.finish(builder.append(operation(inputs.map(expression=>scalarOperation(builder,expression)))));
 let result:SnapshotResponseExpression={version:1,fields:[...fields.values()],terms:[],operations:builder.operations,...smoothOwned?{smoothOwned:true}:{},...contracts.size?{smoothContracts:[...contracts.values()]}:{}};
 if(baseline&&inputs.some(expression=>snapshotResponseSourceBaseline(expression)!==undefined)){
  const source=arithmeticExpression(inputs.map(expression=>snapshotResponseSourceBaseline(expression)??{version:1,fields:expression.fields,terms:expression.terms,...expression.operations?{operations:expression.operations}:{}}),operation,extraFields,false);
  result={...result,sourceBaseline:[],sourceBaselineOperations:source.operations};
 }
 return combineSnapshotResponseExpressions([{coefficient:1,expression:result}]);
}
export const createSnapshotResponseConstant=(value:number):SnapshotResponseExpression=>arithmeticExpression([],()=>({kind:'constant',value}));
export const createSnapshotResponseBasisValue=(basis:SnapshotResponseBasisReference):SnapshotResponseExpression=>arithmeticExpression([],()=>({kind:'basis',basis:copyBasis(basis)}));
export const createSnapshotResponseFitParameter=(reference:SnapshotResponseFitParameterReference):SnapshotResponseExpression=>arithmeticExpression([],()=>({kind:'fit-parameter',reference:structuredClone(reference)}));
export const multiplySnapshotResponseExpressions=(left:SnapshotResponseExpression,right:SnapshotResponseExpression):SnapshotResponseExpression=>arithmeticExpression([left,right],([left,right])=>({kind:'product',left,right}));
export const divideSnapshotResponseExpressions=(left:SnapshotResponseExpression,right:SnapshotResponseExpression):SnapshotResponseExpression=>arithmeticExpression([left,right],([left,right])=>({kind:'quotient',left,right}));
export const weightSnapshotResponseExpression=(expression:SnapshotResponseExpression,field:SnapshotResponseExpressionField,coordinate:0|1|2,weight:'geometric'|'residual'='geometric'):SnapshotResponseExpression=>arithmeticExpression([expression],([source])=>({kind:'weighted',source,fieldId:field.id,coordinate,weight}),[field]);
export function createSnapshotResponseMaterialParameter(controls:readonly (readonly [SnapshotResponseExpression,SnapshotResponseExpression])[],parameters:readonly SnapshotResponseExpression[],field:SnapshotResponseExpressionField,domain?:SnapshotResponseFitParameterDomain):SnapshotResponseExpression {
 if(controls.length!==4||controls.some(pair=>pair.length!==2)||parameters.length!==field.vertexIds.length)invalid('A material parameter needs four two-axis controls and one cut per field vertex.');
 return arithmeticExpression([...controls.flat(),...parameters],indices=>({kind:'curve-material-parameter',controls:controls.map((_,i)=>[indices[2*i],indices[2*i+1]]),parameters:indices.slice(8),fieldId:field.id,...domain?{domain:structuredClone(domain)}:{}}),[field]);
}
/** Construct one projection over complete original scalar values. Its leaves
 * remain live, and repeated operations are shared by structural identity. */
export function createSnapshotSmoothProjectionExpression(component:SmoothComponent,inputs:readonly {node:readonly [SnapshotResponseExpression,SnapshotResponseExpression];vector:readonly [SnapshotResponseExpression,SnapshotResponseExpression]}[],member:number,axis:0|1,correction?:{baselineInputs:typeof inputs;scales:readonly number[]}):SnapshotResponseExpression {
 if(inputs.length>256)fail('EXPRESSION_LIMIT','A projected component exceeds its bounded member count.');
 const expressions=[...inputs,...correction?.baselineInputs??[]].flatMap(input=>[...input.node,...input.vector]),fields=new Map<string,SnapshotResponseExpressionField>(),builder=programBuilder();
 for(const expression of expressions){validateSnapshotResponseExpression(expression);for(const field of expression.fields){const prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(field))invalid('Projection input fields disagree.');fields.set(field.id,cloneField(field));}}
 const scalar=(expression:SnapshotResponseExpression)=>{const program=builder.importProgram(expression),linear=expression.terms.length?builder.append({kind:'linear',terms:expression.terms}):undefined;if(program===undefined&&linear===undefined)return builder.append({kind:'sum',inputs:[]});if(program===undefined)return linear!;if(linear===undefined)return program;return builder.append({kind:'sum',inputs:[{coefficient:1,operation:linear},{coefficient:1,operation:program}]});};
 const references=inputs.map(input=>({node:input.node.map(scalar) as [number,number],vector:input.vector.map(scalar) as [number,number]}));
 builder.finish(builder.append(correction?{kind:'smooth-correction',component:structuredClone(component),inputs:references,member,axis,baselineInputs:correction.baselineInputs.map(input=>({node:input.node.map(scalar) as [number,number],vector:input.vector.map(scalar) as [number,number]})),scales:[...correction.scales]}:{kind:'smooth',component:structuredClone(component),inputs:references,member,axis}));
 const result:SnapshotResponseExpression={version:1,fields:[...fields.values()],terms:[],operations:builder.operations,smoothOwned:true};validateSnapshotResponseExpression(result);return result;
}

/** Combine only algebraic terms. Different fields never union sample supports.
 * Same-ID different fields are a provenance conflict, never last-write-wins. */
export function combineSnapshotResponseExpressions(inputs:readonly {coefficient:number;expression:SnapshotResponseExpression}[]):SnapshotResponseExpression {
 const fields=new Map<string,SnapshotResponseExpressionField>(),terms=new Map<string,SnapshotResponseExpressionTerm>(),baselineTerms=new Map<string,SnapshotResponseExpressionTerm>();
 let basisCount=0,workBasis=0,workFields=0,workSamples=0,workKnots=0,workOperations=0;
 const program=programBuilder(),sourceProgram=programBuilder(),outputs:{coefficient:number;operation:number}[]=[],sourceOutputs:{coefficient:number;operation:number}[]=[],contracts=new Map<string,SnapshotSmoothProjectionContract>();let smoothOwned=false;
 if(inputs.length>snapshotResponseExpressionLimits.terms)fail('EXPRESSION_LIMIT','Too many expression operands.');
 for(const {coefficient,expression} of inputs){
  if(!finite(coefficient))invalid('Expression scale must be finite.');validateSnapshotResponseExpression(expression);
  if(coefficient===0)continue;
  workOperations+=(expression.operations?.length??0)+(expression.sourceBaselineOperations?.length??0);workFields+=expression.fields.length;workBasis+=snapshotResponseExpressionTerms(expression).reduce((sum,term)=>sum+term.basis.length,0);
  workSamples+=expression.fields.reduce((sum,field)=>sum+field.samples.length,0);workKnots+=expression.fields.reduce((sum,field)=>sum+field.edges.reduce((sum,edge)=>sum+(edge.knots?.length??0),0),0);
  if(workOperations>4*snapshotResponseExpressionLimits.operations||workFields>4*snapshotResponseExpressionLimits.fields||workBasis>4*snapshotResponseExpressionLimits.basisTerms||workSamples>4*snapshotResponseExpressionLimits.samples||workKnots>4*snapshotResponseExpressionLimits.knots)fail('EXPRESSION_LIMIT','Combining operands exceeds the bounded expression work budget.');
  smoothOwned ||= expression.smoothOwned===true;
  for(const contract of expression.smoothContracts??[]){const prior=contracts.get(contract.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(contract))invalid('SMOOTH projection contracts disagree.');contracts.set(contract.id,structuredClone(contract));}
  const output=program.importProgram(expression);if(output!==undefined)outputs.push({coefficient,operation:output});
  if(expression.sourceBaselineOperations){const output=sourceProgram.importProgram({version:1,fields:expression.fields,terms:[],operations:expression.sourceBaselineOperations});if(output!==undefined)sourceOutputs.push({coefficient,operation:output});}
  for(const field of expression.fields){
   if(!fields.has(field.id)&&fields.size===snapshotResponseExpressionLimits.fields)fail('EXPRESSION_LIMIT','Combining operands exceeds the field limit.');
   const owned=cloneField(field),prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(owned))invalid(`Field ${field.id} has conflicting interpolation supports.`);fields.set(field.id,owned);
  }
  for(const term of expression.sourceBaseline??[]){const key=JSON.stringify([term.fieldId,term.coordinate,term.weight]),basis=canonicalBasis([...(baselineTerms.get(key)?.basis??[]),...term.basis.map(value=>({basis:value.basis,coefficient:value.coefficient*coefficient}))]);baselineTerms.set(key,{...term,basis});}
  for(const term of expression.terms){
   const key=JSON.stringify([term.fieldId,term.coordinate,term.weight]),basis=canonicalBasis([...(terms.get(key)?.basis??[]),...term.basis.map(value=>({basis:value.basis,coefficient:value.coefficient*coefficient}))]);
   basisCount+=basis.length-(terms.get(key)?.basis.length??0);
   if(basisCount>snapshotResponseExpressionLimits.basisTerms||!terms.has(key)&&terms.size===snapshotResponseExpressionLimits.terms)fail('EXPRESSION_LIMIT','Combining operands exceeds the expression term limit.');
   terms.set(key,{fieldId:term.fieldId,coordinate:term.coordinate,weight:term.weight,basis});
  }
 }
 if(outputs.length)program.finish(program.append({kind:'sum',inputs:outputs}));
 if(sourceOutputs.length)sourceProgram.finish(sourceProgram.append({kind:'sum',inputs:sourceOutputs}));
 const kept=[...terms].sort(([a],[b])=>compare(a,b)).map(([,term])=>term).filter(term=>term.basis.length),used=new Set([...kept,...baselineTerms.values(),...[...program.operations,...sourceProgram.operations].flatMap(operation=>operation.kind==='linear'?operation.terms:[])].map(term=>term.fieldId));
 for(const operation of [...program.operations,...sourceProgram.operations]){if(operation.kind==='at')operation.weights.forEach(weight=>used.add(weight.fieldId));if(operation.kind==='weighted'||operation.kind==='curve-material-parameter')used.add(operation.fieldId);}
 const result:SnapshotResponseExpression={version:1,fields:[...fields.values()].filter(field=>used.has(field.id)).sort((a,b)=>compare(a.id,b.id)),terms:kept,...outputs.length?{operations:program.operations}:{},...smoothOwned?{smoothOwned:true as const}:{},...contracts.size?{smoothContracts:[...contracts.values()].sort((a,b)=>compare(a.id,b.id))}:{},...baselineTerms.size||sourceOutputs.length?{sourceBaseline:[...baselineTerms.values()]}:{},...sourceOutputs.length?{sourceBaselineOperations:sourceProgram.operations}:{}};
 validateSnapshotResponseExpression(result);return result;
}

/** Expose the retained source recipe as the same nonrecursive scalar algebra. */
export function snapshotResponseSourceBaseline(expression:SnapshotResponseExpression):SnapshotResponseExpression|undefined {
 return expression.sourceBaseline!==undefined||expression.sourceBaselineOperations?{version:1,fields:expression.fields,terms:expression.sourceBaseline??[],...expression.sourceBaselineOperations?{operations:expression.sourceBaselineOperations}:{}}:undefined;
}
export function withSnapshotResponseSourceBaseline(expression:SnapshotResponseExpression,baseline:SnapshotResponseExpression):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);validateSnapshotResponseExpression(baseline);const fields=new Map(expression.fields.map(field=>[field.id,field]));
 for(const field of baseline.fields){const prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(field))invalid('A source baseline has conflicting field provenance.');fields.set(field.id,field);}
 const {sourceBaselineOperations:ignored,...rest}=expression;void ignored;
 const result:SnapshotResponseExpression={...rest,fields:[...fields.values()],sourceBaseline:baseline.terms,...baseline.operations?{sourceBaselineOperations:baseline.operations}:{}};validateSnapshotResponseExpression(result);return result;
}
function restrictedSourceBaseline(expression:SnapshotResponseExpression,restricted:SnapshotResponseExpression):SnapshotResponseExpression {
 const baseline=snapshotResponseSourceBaseline(expression);if(!baseline)return restricted;
 // New geometric controls contain the old response at each new real corner.
 // Add that same live corner interpolation to the retained source recipe.
 const plain=(value:SnapshotResponseExpression):SnapshotResponseExpression=>({version:1,fields:value.fields,terms:value.terms,...value.operations?{operations:value.operations}:{}});
 return withSnapshotResponseSourceBaseline(restricted,combineSnapshotResponseExpressions([{coefficient:1,expression:baseline},{coefficient:1,expression:plain(expression)},{coefficient:-1,expression:plain(restricted)}]));
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
 if([...expression.operations??[],...expression.sourceBaselineOperations??[]].some(operation=>operation.kind==='basis'))return substituteSnapshotResponseBasisValues(expression,basis=>{const replaced=replacement(basis);if(replaced===undefined)return undefined;return combineSnapshotResponseExpressions(replaced.map(value=>({coefficient:value.coefficient,expression:createSnapshotResponseBasisValue(value.basis)})));});
 let expanded=0;
 const rewrite=(terms:readonly SnapshotResponseExpressionTerm[])=>terms.map(term=>({...term,basis:term.basis.flatMap(value=>{
  const replaced=replacement(copyBasis(value.basis)),values=replaced===undefined?[value]:array(replaced,snapshotResponseExpressionLimits.basisTerms,'Replacement basis');
  expanded+=values.length;if(expanded>snapshotResponseExpressionLimits.basisTerms)fail('EXPRESSION_LIMIT','Substituting live bases exceeds the bounded expression expansion limit.');
  if(replaced===undefined)return [value];
  for(const candidate of values)validateBasis(candidate);
  return replaced.map(candidate=>({basis:copyBasis(candidate.basis),coefficient:candidate.coefficient*value.coefficient}));
 })}));
 const next:SnapshotResponseExpression={...expression,terms:rewrite(expression.terms),...expression.sourceBaseline?{sourceBaseline:rewrite(expression.sourceBaseline)}:{},...expression.operations?{operations:expression.operations.map(operation=>operation.kind==='linear'?{...operation,terms:rewrite(operation.terms)}:operation)}:{},...expression.sourceBaselineOperations?{sourceBaselineOperations:expression.sourceBaselineOperations.map(operation=>operation.kind==='linear'?{...operation,terms:rewrite(operation.terms)}:operation)}:{}};
 return combineSnapshotResponseExpressions([{coefficient:1,expression:next}]);
}

/** Replace a live scalar leaf with another bounded expression in one pass.
 * Weighted linear leaves become arithmetic only where a substitution needs it.
 * Existing support fields, projections and independent source baselines remain
 * intact; replacement values are never recursively substituted into themselves. */
export function substituteSnapshotResponseBasisValues(expression:SnapshotResponseExpression,replacement:(basis:SnapshotResponseBasisReference)=>SnapshotResponseExpression|undefined):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);
 const fields=new Map(expression.fields.map(field=>[field.id,cloneField(field)])),contracts=new Map((expression.smoothContracts??[]).map(contract=>[contract.id,structuredClone(contract)])),replacements=new Map<string,SnapshotResponseExpression|undefined>();let smoothOwned=!!expression.smoothOwned,work=0;
 const replaced=(basis:SnapshotResponseBasisReference)=>{
  const key=snapshotResponseBasisKey(basis);if(replacements.has(key))return replacements.get(key);
  const value=replacement(copyBasis(basis));if(value){validateSnapshotResponseExpression(value);work+=(value.operations?.length??0)+value.terms.length+snapshotResponseExpressionTerms(value).reduce((sum,term)=>sum+term.basis.length,0);if(work>4*snapshotResponseExpressionLimits.operationInputs)fail('EXPRESSION_LIMIT','Substituting scalar basis values exceeds its bounded expansion budget.');
   for(const field of value.fields){const owned=cloneField(field),prior=fields.get(field.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(owned))invalid('A substituted basis value has conflicting field support.');fields.set(field.id,owned);}
   smoothOwned ||= !!value.smoothOwned;for(const contract of value.smoothContracts??[]){const prior=contracts.get(contract.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(contract))invalid('A substituted basis value has conflicting SMOOTH contracts.');contracts.set(contract.id,structuredClone(contract));}
  }replacements.set(key,value);return value;
 };
 const build=(terms:readonly SnapshotResponseExpressionTerm[],operations:readonly SnapshotResponseOperation[])=>{
  const builder=programBuilder(),replacementIndices=new Map<string,number>();
  const basis=(reference:SnapshotResponseBasisReference):number=>{const key=snapshotResponseBasisKey(reference),known=replacementIndices.get(key);if(known!==undefined)return known;const value=replaced(reference),index=value?scalarOperation(builder,value):builder.append({kind:'basis',basis:copyBasis(reference)});replacementIndices.set(key,index);return index;};
  const sum=(inputs:readonly {coefficient:number;operation:number}[])=>builder.append({kind:'sum',inputs});
  const linearBasis=(values:SnapshotResponseLinearBasis):number=>{
   const canonical=canonicalBasis(values);if(!canonical.length)return sum([]);
   const first=basis(canonical[0].basis),coefficient=canonical.reduce((total,value)=>total+value.coefficient,0),inputs=[{coefficient,operation:first}];
   for(const value of canonical.slice(1))inputs.push({coefficient:value.coefficient,operation:sum([{coefficient:1,operation:basis(value.basis)},{coefficient:-1,operation:first}])});
   return sum(inputs);
  };
  const rewriteTerms=(values:readonly SnapshotResponseExpressionTerm[]):number=>{
   const outputs:{coefficient:number;operation:number}[]=[],unchanged:SnapshotResponseExpressionTerm[]=[];
   for(const fieldId of new Set(values.map(term=>term.fieldId))){
    const terms=values.filter(term=>term.fieldId===fieldId),residual=terms.filter(term=>term.weight==='residual'),geometric=terms.filter(term=>term.weight==='geometric');
    if(residual.some(term=>term.basis.some(value=>replaced(value.basis)!==undefined))){
     const field=fields.get(fieldId)!,anchor=field.vertexIds.length-1,byCoordinate=field.vertexIds.map((_,coordinate)=>linearBasis(residual.filter(term=>term.coordinate===coordinate).flatMap(term=>term.basis))),origin=byCoordinate[anchor];
     for(let coordinate=0;coordinate<anchor;coordinate++){const source=sum([{coefficient:1,operation:byCoordinate[coordinate]},{coefficient:-1,operation:origin}]);outputs.push({coefficient:1,operation:builder.append({kind:'weighted',source,fieldId,coordinate:coordinate as 0|1|2,weight:'residual'})});}
    }else unchanged.push(...residual);
    for(const term of geometric)if(term.basis.some(value=>replaced(value.basis)!==undefined))outputs.push({coefficient:1,operation:builder.append({kind:'weighted',source:linearBasis(term.basis),fieldId,coordinate:term.coordinate,weight:'geometric'})});else unchanged.push(term);
   }
   if(unchanged.length)outputs.push({coefficient:1,operation:builder.append({kind:'linear',terms:unchanged})});return sum(outputs);
  };
  const indices:number[]=[];for(const operation of operations)indices.push(operation.kind==='basis'?basis(operation.basis):operation.kind==='linear'?rewriteTerms(operation.terms):builder.append(mapOperationReferences(operation,index=>indices[index])));
  const roots:{coefficient:number;operation:number}[]=[];if(indices.length)roots.push({coefficient:1,operation:indices.at(-1)!});if(terms.length)roots.push({coefficient:1,operation:rewriteTerms(terms)});builder.finish(sum(roots));return builder.operations;
 };
 const operations=build(expression.terms,expression.operations??[]),sourceBaselineOperations=expression.sourceBaseline!==undefined||expression.sourceBaselineOperations?build(expression.sourceBaseline??[],expression.sourceBaselineOperations??[]):undefined;
 const next:SnapshotResponseExpression={version:1,fields:[...fields.values()],terms:[],operations,...smoothOwned?{smoothOwned:true}:{},...contracts.size?{smoothContracts:[...contracts.values()]}:{},...sourceBaselineOperations?{sourceBaseline:[],sourceBaselineOperations}:{}};
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
 if(expression.operations?.length)return restrictedSourceBaseline(expression,rebaseSnapshotResponseExpression(expression,newSupport,originalWeightsAtVertex));
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
 return restrictedSourceBaseline(expression,combineSnapshotResponseExpressions([{coefficient:1,expression},{coefficient:1,expression:{version:1,fields:[newSupport],terms}}]));
}

/** Subtract the complete live program evaluated at real support corners.
 * Anchors store only dimensionless field coordinates, so real source controls
 * remain independent degrees of freedom after repeated splits or insertions. */
export function rebaseSnapshotResponseExpression(expression:SnapshotResponseExpression,support:SnapshotResponseExpressionField,weightsAtVertex:(field:SnapshotResponseExpressionField,index:number)=>readonly number[]):SnapshotResponseExpression {
 validateSnapshotResponseExpression(expression);validateField(support);if(support.edges.length||support.samples.length)invalid('A projection baseline support must be geometric.');
 const builder=programBuilder(),program=builder.importProgram(expression),linear=expression.terms.length?builder.append({kind:'linear',terms:expression.terms}):undefined,inputs=[program,linear].filter((value):value is number=>value!==undefined).map(operation=>({coefficient:1,operation})),root=builder.append({kind:'sum',inputs}),terms=[{coefficient:1,operation:root}];
 for(let index=0;index<support.vertexIds.length;index++){
  const at=builder.append({kind:'at',source:root,weights:expression.fields.map(field=>({fieldId:field.id,values:[...weightsAtVertex(field,index)]}))});
  const weighted=builder.append({kind:'weighted',source:at,fieldId:support.id,coordinate:index as 0|1|2});terms.push({coefficient:-1,operation:weighted});
 }
 builder.finish(builder.append({kind:'sum',inputs:terms}));const fields=new Map(expression.fields.map(field=>[field.id,field]));const prior=fields.get(support.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(support))invalid('Rebase support has conflicting provenance.');fields.set(support.id,support);
 const result:SnapshotResponseExpression={...expression,fields:[...fields.values()],terms:[],operations:builder.operations};validateSnapshotResponseExpression(result);return result;
}

export interface SnapshotResponseExpressionEvaluation {
 basisScalar:SnapshotResponseBasisScalarResolver;
 fitParameter?:(reference:SnapshotResponseFitParameterReference)=>number|undefined;
 recordFitParameter?:(domain:SnapshotResponseFitParameterDomain,parameter:number,parent?:Cubic)=>void;
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
 const fields=owned.fields.map(field=>({field,sample:prepareTriangularResponse(field.edges,field.samples)}));
 return evaluation=>{
  const bases=new Map<string,number>();
  const fitParameters=new Map<string,number>();
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
  const contexts=new Map<string,{values:number[];weights:Map<string,{original:readonly number[];difference:readonly number[]}>;projections:Map<string,ReturnType<typeof projectSmoothComponent>>}>();let steps=0;
  const context=(overrides:readonly {fieldId:string;values:readonly number[]}[])=>{const key=JSON.stringify(overrides);let cached=contexts.get(key);if(!cached){cached={values:[],weights:new Map(),projections:new Map()};contexts.set(key,cached);}return cached;};
  const weight=(fieldId:string,overrides:readonly {fieldId:string;values:readonly number[]}[])=>{
   const current=context(overrides),known=current.weights.get(fieldId);if(known)return known;const compiled=fields.find(value=>value.field.id===fieldId)!;
   const original=[...(overrides.find(value=>value.fieldId===fieldId)?.values??evaluation.geometricWeights(compiled.field))];if(original.length!==compiled.field.vertexIds.length)fail('EXPRESSION_MISSING_SUPPORT',`Field ${fieldId} needs its complete original angle support.`);
   const padded=original.length===2?[...original,0]:original;let response:readonly number[];try{response=compiled.sample(padded as unknown as BarycentricWeights);}catch(error){return invalid(error instanceof Error?error.message:String(error));}
   const result={original,difference:residualWeights(original,response)};current.weights.set(fieldId,result);return result;
  };
  const sampleTerms=(terms:readonly SnapshotResponseExpressionTerm[],overrides:readonly {fieldId:string;values:readonly number[]}[])=>{let result=0;
   for(const fieldId of new Set(terms.map(term=>term.fieldId))){
    const fieldTerms=terms.filter(term=>term.fieldId===fieldId),{original,difference}=weight(fieldId,overrides),residual=new Map(fieldTerms.filter(term=>term.weight==='residual').map(term=>[term.coordinate,term.basis])),anchor=lastNonzero(difference);
    if(residual.size&&anchor>=0){const origin=scalar(residual.get(anchor as 0|1|2)??[]);difference.forEach((weight,index)=>{if(weight!==0&&index!==anchor)result+=weight*(scalar(residual.get(index as 0|1|2)??[])-origin);});}
    for(const term of fieldTerms)if(term.weight==='geometric'&&original[term.coordinate]!==0)result+=original[term.coordinate]*scalar(term.basis);
   }return result;
  };
  const evaluate=(last:number,overrides:readonly {fieldId:string;values:readonly number[]}[],depth=0):number=>{
   if(depth>32)fail('EXPRESSION_LIMIT','Projection anchor nesting exceeds its bounded evaluation depth.');
   const current=context(overrides),values=current.values;
   while(values.length<=last){if(++steps>65536)fail('EXPRESSION_LIMIT','Response operation evaluation exceeds its bounded work budget.');const operation=owned.operations![values.length];let result:number;
    if(operation.kind==='constant')result=operation.value;
    else if(operation.kind==='basis')result=scalar([{coefficient:1,basis:operation.basis}]);
    else if(operation.kind==='fit-parameter'){const key=JSON.stringify(operation.reference),known=fitParameters.get(key);if(known!==undefined)result=known;else{const value=(evaluation.fitParameter??evaluation.basisScalar.fitParameter)?.(structuredClone(operation.reference));if(!finite(value)||value<0||value>1)fail('EXPRESSION_MISSING_BASIS',`Missing or invalid live fitted parameter ${key}.`);result=value!;fitParameters.set(key,result);}}
    else if(operation.kind==='product')result=values[operation.left]*values[operation.right];
    else if(operation.kind==='quotient'){const denominator=values[operation.right];if(denominator===0)invalid('Response quotient has a zero live denominator.');result=values[operation.left]/denominator;}
    else if(operation.kind==='curve-material-parameter'){const shape=operation.controls.map(pair=>pair.map(index=>values[index])) as Cubic;result=createSnapshotSplitParameterField(shape).parameterAt(operation.parameters.map(index=>values[index]),weight(operation.fieldId,overrides).original);if(operation.domain&&!overrides.length)(evaluation.recordFitParameter??evaluation.basisScalar.recordFitParameter)?.(structuredClone(operation.domain),result,shape);}
    else if(operation.kind==='linear')result=sampleTerms(operation.terms,overrides);
    else if(operation.kind==='sum')result=operation.inputs.reduce((sum,input)=>sum+input.coefficient*values[input.operation],0);
    else if(operation.kind==='weighted')result=values[operation.source]*weight(operation.fieldId,overrides)[operation.weight==='residual'?'difference':'original'][operation.coordinate];
    else if(operation.kind==='at')result=evaluate(operation.source,operation.weights,depth+1);
    else {const key=JSON.stringify({...operation,member:0,axis:0});let projected=current.projections.get(key);if(!projected){const inputs=(raw:typeof operation.inputs)=>raw.map(input=>({node:input.node.map(index=>values[index]) as [number,number],vector:input.vector.map(index=>values[index]) as [number,number]}));projected=operation.kind==='smooth-correction'?projectSmoothComponentCorrection(operation.component,inputs(operation.baselineInputs),inputs(operation.inputs),operation.scales):projectSmoothComponent(operation.component,inputs(operation.inputs));current.projections.set(key,projected);}result=projected.controls[operation.member].vector[operation.axis];}
    if(!finite(result))invalid('Response operation produced a nonfinite scalar.');values.push(result);
   }return values[last];
  };
  const result=sampleTerms(owned.terms,[])+(owned.operations?.length?evaluate(owned.operations.length-1,[]):0);if(!finite(result))invalid('Response expression produced a nonfinite scalar.');return result;
 };
}

/** Same input signature as SnapshotScalarWeights, but the result is a value.
 * A weight-only adapter cannot express nonconstant responses at equal child
 * endpoint coordinates. Membership must still use the untouched geometric λ. */
export type SnapshotScalarResponseValueSampler=(target:SnapshotScalarTarget,axis:0|1,coordinates:readonly number[],geometricWeights:readonly number[])=>number;
/** Compiled expressions and support matrices are independent of the resolver
 * that records fitted parameters for one sample. Only compiled operands are
 * shared; every expression evaluation still owns its numeric scratch maps. */
export function prepareSnapshotExpressionValueProgram(location:Pick<SnapshotSimplexLocation,'vertexIds'>,source:{expression:(target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression|undefined;geometricWeights?:(field:SnapshotResponseExpressionField,weights:readonly number[])=>readonly number[];onCompile?:()=>void}) {
 const ids=array(location.vertexIds,3,'Active simplex vertices');ids.forEach(id);if(!ids.length||new Set(ids).size!==ids.length)invalid('An active simplex needs one to three distinct vertex IDs.');
 const cache=new Map<string,ReturnType<typeof prepareSnapshotResponseExpression>|null>(),vertexIds=[...location.vertexIds];
 const createSampler=(basisScalar:SnapshotResponseBasisScalarResolver):SnapshotScalarResponseValueSampler=>(target,axis,coordinates,weights)=>{
  array(coordinates,3,'Active basis coordinates');array(weights,3,'Original geometric weights');
  if(coordinates.length!==weights.length||weights.length!==vertexIds.length||!coordinates.every(finite)||!weights.every(w=>finite(w)&&w>=0)||Math.abs(weights.reduce((sum,w)=>sum+w,0)-1)>64*Number.EPSILON)invalid('A scalar value sampler needs finite bases and original geometric weights.');
  const key=JSON.stringify([target,axis]);let sample=cache.get(key);
  if(sample===undefined){const expression=source.expression({...target},axis);sample=expression?prepareSnapshotResponseExpression(expression):null;if(sample)source.onCompile?.();cache.set(key,sample);}
  const baseline=coordinates.reduce((sum,value,index)=>sum+value*weights[index],0);
  const callbackWeights=source.geometricWeights?Object.freeze([...weights]):weights;
  const residual=sample?.({basisScalar,geometricWeights:field=>{
   if(source.geometricWeights)return source.geometricWeights(field,callbackWeights);
   if(vertexIds.some((id,index)=>weights[index]!==0&&!field.vertexIds.includes(id)))fail('EXPRESSION_MISSING_SUPPORT',`Field ${field.id} needs an explicit map from the new simplex into its original angle support.`);
   return field.vertexIds.map(id=>{const index=vertexIds.indexOf(id);return index<0?0:weights[index];});
  }})??0;
  const result=baseline+residual;if(!finite(result))invalid('Response expression value is nonfinite.');return result;
 };
 return Object.freeze({createSampler});
}

/** Compatibility adapter for one independently owned sampling session. */
export function createSnapshotExpressionValueSampler(location:Pick<SnapshotSimplexLocation,'vertexIds'>,source:{expression:(target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression|undefined;basisScalar:SnapshotResponseExpressionEvaluation['basisScalar'];geometricWeights?:(field:SnapshotResponseExpressionField,weights:readonly number[])=>readonly number[]}):SnapshotScalarResponseValueSampler {
 return prepareSnapshotExpressionValueProgram(location,source).createSampler(source.basisScalar);
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
