import {remapCurveSource,transformCurveSource} from './curveProvenance';
import type {Affine2D} from '../geometry/affine2d';
import {createFittedGeometryProjector,type CageFitDiagnostic} from './cageGeometry';
import {evaluatedAffine,evaluatedAffineSource,affineShape,type EvaluatedAffine} from './evaluatedAffine';
import {mappedParameter,mappedParameterSlope,type CurveParameterMap} from '../deformation/cubicDeformation';
import type {DrawingDocument,Cubic,Point2} from './model';
import type {DrawingPiece} from './roundedJoin';
import {remapMaterialProgram,materialProgramIsNonlinear,type MaterialReflectionFrame,type EvaluatedMaterialStep} from './materialProgram';
export type {EvaluatedMaterialStep} from './materialProgram';

type Projector=ReturnType<typeof createFittedGeometryProjector>;
type Geometry={shapes:Cubic[];pieces:DrawingPiece[];error?:string};
type Material=Parameters<Projector['projectMaterialField']>[0];
interface Program {key:string;steps:Projector[];data?:EvaluatedMaterialStep[];parameter:(t:number)=>number;slope:(t:number)=>number;fitRange?:readonly [number,number]}
interface Evaluation {source:DrawingDocument;programs:Map<string,Program>;sources:WeakMap<DrawingDocument,DrawingDocument>;diagnostics:Map<string,CageFitDiagnostic>}
const evaluations=new WeakMap<DrawingDocument['nodes'],Evaluation>();
const identityValues=Array.from({length:129},(_,i)=>i/128);
const affinePrograms=new WeakMap<EvaluatedAffine,Program>();
const affineProgram=(affine:EvaluatedAffine):Program=>{
 let program=affinePrograms.get(affine);if(program)return program;
 const fit=(shape:Cubic)=>({shape:affineShape(shape,affine),parameters:{values:identityValues},maxError:0}),projector=createFittedGeometryProjector(piece=>fit(piece.shape),fit);
 const origin=affine.point([0,0]),x=affine.point([1,0]),y=affine.point([0,1]),matrix:Affine2D=[x[0]-origin[0],x[1]-origin[1],y[0]-origin[0],y[1]-origin[1],origin[0],origin[1]];
 program={key:JSON.stringify(['affine',origin,x,y]),steps:[projector],data:[{kind:'affine',matrix}],parameter:t=>t,slope:()=>1};affinePrograms.set(affine,program);return program;
};
function programsFor(drawing:DrawingDocument){
 const existing=evaluations.get(drawing.nodes);if(existing)return new Map(existing.programs);
 const result=new Map<string,Program>();for(const curve of drawing.curves){const affine=evaluatedAffine(drawing,curve.id);if(!affine)continue;const program=affineProgram(affine);result.set(curve.id,program);for(const node of curve.nodes)result.set(node,program);}return result;
}
export const hasEvaluatedDeformation=(drawing:DrawingDocument)=>evaluations.has(drawing.nodes);
export const hasEvaluatedDeformationFor=(drawing:DrawingDocument,id:string)=>evaluations.get(drawing.nodes)?.programs.has(id)??false;
export const hasNonlinearDeformationFor=(drawing:DrawingDocument,id:string)=>{const program=evaluations.get(drawing.nodes)?.programs.get(id);return !!program&&(!program.data||materialProgramIsNonlinear(program.data));};
/** Original material controls with today's style/relations. Every retained
 * program starts here; it contains no sampled geometry or authored source copy. */
export function evaluatedDeformationSource(drawing:DrawingDocument):DrawingDocument|undefined {
 const evaluation=evaluations.get(drawing.nodes);if(!evaluation)return undefined;
 const hit=evaluation.sources.get(drawing);if(hit)return hit;
 const nodes=new Map(evaluation.source.nodes.map(n=>[n.id,n])),curves=new Map(evaluation.source.curves.map(c=>[c.id,c]));
 const source={...drawing,nodes:drawing.nodes.map(n=>evaluation.programs.has(n.id)?nodes.get(n.id)??n:n),curves:drawing.curves.map(c=>evaluation.programs.has(c.id)&&curves.has(c.id)?{...c,handles:curves.get(c.id)!.handles}:c)};
 evaluation.sources.set(drawing,source);return source;
}
/** Material measurements must strip the complete output program, including a
 * prior nonuniform affine. Identity and topology are retained by the caller. */
export const evaluatedMaterialSource=(drawing:DrawingDocument)=>evaluatedDeformationSource(drawing)??evaluatedAffineSource(drawing)??drawing;
export const evaluatedFitRange=(drawing:DrawingDocument,id:string)=>evaluations.get(drawing.nodes)?.programs.get(id)?.fitRange;
export function evaluatedControlParameter(drawing:DrawingDocument,id:string,t:number):number {return evaluations.get(drawing.nodes)?.programs.get(id)?.parameter(t)??t;}
export function evaluatedControlParameterSlope(drawing:DrawingDocument,id:string,t:number):number {return evaluations.get(drawing.nodes)?.programs.get(id)?.slope(t)??1;}

/** Append one stage while retaining live canonical identities and material
 * control provenance. The stage's pure projector owns all fitting math. */
export function appendEvaluatedDeformation(drawing:DrawingDocument,before:DrawingDocument,curveIds:ReadonlySet<string>,projector:Projector,key:string,parameters:ReadonlyMap<string,CurveParameterMap>=new Map(),data?:EvaluatedMaterialStep,fitRanges:ReadonlyMap<string,readonly [number,number]>=new Map()):DrawingDocument {
 if(!curveIds.size)return drawing;
 const programs=programsFor(before),source=evaluatedMaterialSource(before);
 for(const curve of before.curves){if(!curveIds.has(curve.id))continue;const prior=programs.get(curve.id),map=parameters.get(curve.id),program:Program={fitRange:fitRanges.get(curve.id)??prior?.fitRange,key:JSON.stringify([prior?.key??'',key]),steps:[...prior?.steps??[],projector],data:data&&(!prior||prior.data)?[...prior?.data??[],structuredClone(data)]:undefined,parameter:t=>mappedParameter(prior?.parameter(t)??t,map),slope:t=>(prior?.slope(t)??1)*mappedParameterSlope(prior?.parameter(t)??t,map)};
  programs.set(curve.id,program);for(const node of curve.nodes)programs.set(node,program);
 }
 evaluations.set(drawing.nodes,{source,programs,sources:new WeakMap(),diagnostics:new Map()});return drawing;
}
/** Identity-preserving Snapshot assembly/material clones retain the exact same
 * programs. A topology edit must supply its own explicit lineage adaptation. */
export function retainEvaluatedDeformations(drawing:DrawingDocument,sources:readonly DrawingDocument[]):DrawingDocument {
 if(!sources.some(hasEvaluatedDeformation))return drawing;
 const available=new Set([...drawing.nodes,...drawing.curves].map(value=>value.id)),programs=new Map<string,Program>(),nodes=new Map<string,DrawingDocument['nodes'][number]>(),curves=new Map<string,DrawingDocument['curves'][number]>();
 for(const input of sources){const source=evaluatedMaterialSource(input),values=programsFor(input);for(const [id,program] of values)if(available.has(id))programs.set(id,program);for(const node of source.nodes)if(values.has(node.id))nodes.set(node.id,node);for(const curve of source.curves)if(values.has(curve.id))curves.set(curve.id,curve);}
 if(!programs.size)return drawing;
 const source={...drawing,nodes:drawing.nodes.map(node=>nodes.get(node.id)??node),curves:drawing.curves.map(curve=>curves.has(curve.id)?{...curve,handles:curves.get(curve.id)!.handles}:curve)};
 evaluations.set(drawing.nodes,{source,programs,sources:new WeakMap(),diagnostics:new Map()});return drawing;
}
function groups(drawing:DrawingDocument,geometry:Geometry){
 const evaluation=evaluations.get(drawing.nodes);if(!evaluation)throw Error('Missing evaluated deformation program.');
 const groups=new Map<string,{program:Program;ids:Set<string>}>();
 for(const piece of geometry.pieces){const programs=piece.owners.map(id=>evaluation.programs.get(id)),first=programs[0];if(programs.some(value=>value?.key!==first?.key))throw Error('A derived join crosses incompatible deformation programs.');
  if(!first)continue;let group=groups.get(first.key);if(!group){group={program:first,ids:new Set()};groups.set(first.key,group);}piece.owners.forEach(id=>group.ids.add(id));
 }
 return {evaluation,groups:[...groups.values()]};
}
export function projectEvaluatedGeometry<G extends Geometry>(drawing:DrawingDocument,input:G):G {
 const values=groups(drawing,input);let geometry=input;
 for(const {program,ids} of values.groups)for(const [index,step] of program.steps.entries()){const next=step.projectGeometry(geometry,piece=>piece.owners.some(id=>ids.has(id)));geometry=next.geometry;rememberDiagnostics(values.evaluation,program.key,index,next.diagnostics);}
 return geometry;
}
export function projectEvaluatedMaterial<F extends Material>(drawing:DrawingDocument,input:F):F {
 const values=groups(drawing,input.geometry);let field=input;
 for(const {program,ids} of values.groups)for(const [index,step] of program.steps.entries()){const next=step.projectMaterialField(field,piece=>piece.owners.some(id=>ids.has(id)));field=next.field;rememberDiagnostics(values.evaluation,program.key,index,next.diagnostics);}
 return field;
}
function rememberDiagnostics(evaluation:Evaluation,program:string,index:number,diagnostics:CageFitDiagnostic[]){for(const value of diagnostics){const key=JSON.stringify([program,index,value.owners,value.joinId,value.pieceIndex]),prior=evaluation.diagnostics.get(key);if(!prior||value.maxError>prior.maxError)evaluation.diagnostics.set(key,value);}}
export const evaluatedDeformationDiagnostics=(drawing:DrawingDocument)=>[...evaluations.get(drawing.nodes)?.diagnostics.values()??[]];

/** Pure data for an independent copy: own the material source, remap
 * these steps and replay them. No old Snapshot or recursive ancestor is needed.
 * Undefined means this runtime program has no proved serializable descriptor. */
export function evaluatedMaterialProgram(drawing:DrawingDocument,curveId:string):EvaluatedMaterialStep[]|undefined {
 const program=programsFor(drawing).get(curveId);return program?.data?structuredClone(program.data):program?undefined:[];
}

/** Presentation namespaces are adapters only. Wrap each existing projector's
 * IDs, preserving its numeric fit and material correspondence exactly. */
export function remapEvaluatedDeformations(drawing:DrawingDocument,input:DrawingDocument,material:DrawingDocument,id:(id:string)=>string,originalId:(id:string)=>string,reflection?:{point:(p:Point2)=>Point2;reverse:(id:string)=>boolean;key:string;frame?:MaterialReflectionFrame}):DrawingDocument {
 const evaluation=evaluations.get(input.nodes);if(!evaluation)return drawing;
 const wrapped=new Map<Projector,Projector>(),mapShape=(shape:Cubic,map:(id:string)=>string)=>reflection?transformCurveSource(shape,shape.map(reflection.point) as Cubic,map,reflection.reverse):remapCurveSource(shape,shape.map(p=>[...p]) as Cubic,map);
 const project=(step:Projector)=>{let cached=wrapped.get(step);if(cached)return cached;
  const fitted=(result:ReturnType<Projector['fit']>)=>({...result,shape:mapShape(result.shape,id)}),fit=(shape:Cubic)=>fitted(step.fit(mapShape(shape,originalId)));
  const canonicalPiece=(piece:DrawingPiece)=>({...piece,shape:mapShape(piece.shape,originalId),owners:piece.owners.map(originalId),...(piece.joinId?{joinId:originalId(piece.joinId)}:{}),...(piece.inkOwner?{inkOwner:originalId(piece.inkOwner)}:{})});
  cached=createFittedGeometryProjector(piece=>({shape:piece.shape,parameters:{values:[0,1]},maxError:0}),fit,.00004,(geometry,initial)=>{
   // Relation-constrained stages need neighbouring pieces after ID/reflection
   // adaptation too. Replaying pieces independently would lose ARC tangency.
   const pieces=geometry.pieces.map(canonicalPiece),selected=new Set(pieces.filter((_,i)=>initial[i]));
   return step.projectGeometry({...geometry,pieces,shapes:pieces.map(piece=>piece.shape)},piece=>selected.has(piece)).fits.map(result=>result?fitted(result):undefined);
  });wrapped.set(step,cached);return cached;
 };
 const data=(steps:EvaluatedMaterialStep[]|undefined):EvaluatedMaterialStep[]|undefined=>{
  if(!steps)return undefined;const mapped=remapMaterialProgram(steps,id);if(!reflection)return mapped;
  return reflection.frame?[{kind:'reflected',axisX:reflection.frame.axisX,reverseCurveIds:reflection.frame.reverseCurveIds.map(id),steps:mapped}]:undefined;
 };
 const programs=new Map([...evaluation.programs].map(([key,program])=>[id(key),{...program,key:reflection?JSON.stringify([reflection.key,program.key]):program.key,steps:program.steps.map(project),parameter:reflection?.reverse(key)?(t:number)=>1-program.parameter(1-t):program.parameter,slope:reflection?.reverse(key)?(t:number)=>program.slope(1-t):program.slope,data:data(program.data)}]));
 evaluations.set(drawing.nodes,{source:material,programs,sources:new WeakMap(),diagnostics:new Map()});return drawing;
}
