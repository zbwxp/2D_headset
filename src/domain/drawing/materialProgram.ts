import {remapCageSplitLineages} from '../recordingSnapshot/cageSplitLineage';
import type {Affine2D} from '../geometry/affine2d';
import {validAffine2D} from '../geometry/affine2d';
import {validateLayerCageDomain,type SnapshotLayerCageDomain} from '../recordingSnapshot/layerCageDomain';
import type {SceneShapeValue} from '../recordingScene/model';
import {validateSceneShape} from '../recordingScene/validation';

/** An owned material program contains only authored parameters. Reflections
 * retain the original fitting frame, including each curve's endpoint parity. */
export type EvaluatedMaterialStep=
 | {kind:'affine';matrix:Affine2D}
 | {kind:'cage';domain:SnapshotLayerCageDomain}
 | {kind:'post-shape';value:SceneShapeValue}
 | {kind:'reflected';axisX:number;reverseCurveIds:string[];steps:EvaluatedMaterialStep[]};
export interface MaterialReflectionFrame {axisX:number;reverseCurveIds:string[]}
const id=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=16384;
const keys=(value:unknown,allowed:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function validateMaterialProgram(program:unknown):asserts program is EvaluatedMaterialStep[] {
 let count=0;
 const visit=(steps:unknown,depth:number)=>{
  if(!Array.isArray(steps)||depth>32||steps.length>1000)throw Error('Invalid owned material program.');
  for(const step of steps){if(++count>1000)throw Error('Owned material program exceeds its stage limit.');
   if(step?.kind==='affine'&&keys(step,['kind','matrix'])&&validAffine2D(step.matrix))continue;
   if(step?.kind==='cage'&&keys(step,['kind','domain'])){validateLayerCageDomain(step.domain);continue;}
   if(step?.kind==='post-shape'&&keys(step,['kind','value'])&&keys(step.value,['nodes','handles'])){validateSceneShape(step.value);continue;}
   if(step?.kind==='reflected'&&keys(step,['kind','axisX','reverseCurveIds','steps'])&&Number.isFinite(step.axisX)&&Array.isArray(step.reverseCurveIds)&&step.reverseCurveIds.length<=16384&&step.reverseCurveIds.every(id)&&new Set(step.reverseCurveIds).size===step.reverseCurveIds.length){visit(step.steps,depth+1);continue;}
   throw Error('Invalid owned material program stage.');
  }
 };
 visit(program,0);
}
export const materialProgramIsNonlinear=(program:readonly EvaluatedMaterialStep[]):boolean=>program.some(step=>step.kind==='cage'||step.kind==='reflected'&&materialProgramIsNonlinear(step.steps));
export function remapMaterialProgram(program:readonly EvaluatedMaterialStep[],id:(id:string)=>string,options:{layerIds?:readonly string[];keepObject?:(id:string)=>boolean}={}):EvaluatedMaterialStep[] {
 const keep=options.keepObject??(()=>true),shape=(value:SceneShapeValue):SceneShapeValue=>({nodes:Object.fromEntries(Object.entries(value.nodes).filter(([key])=>keep(key)).map(([key,value])=>[id(key),structuredClone(value)])),handles:Object.fromEntries(Object.entries(value.handles).filter(([key])=>keep(key)).map(([key,value])=>[id(key),structuredClone(value)]))});
 return program.map(step=>step.kind==='affine'?structuredClone(step):step.kind==='cage'?{kind:'cage',domain:{...structuredClone(step.domain),id:id(step.domain.id),layerIds:options.layerIds?[...options.layerIds]:step.domain.layerIds.map(id),...(step.domain.fitLineages?{fitLineages:remapCageSplitLineages(step.domain.fitLineages,id,keep)}:{})}}:step.kind==='post-shape'?{kind:'post-shape',value:shape(step.value)}:{kind:'reflected',axisX:step.axisX,reverseCurveIds:step.reverseCurveIds.filter(keep).map(id),steps:remapMaterialProgram(step.steps,id,options)});
}
