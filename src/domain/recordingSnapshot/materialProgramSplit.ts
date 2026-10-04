import type {EvaluatedMaterialStep} from '../drawing/materialProgram';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import {splitCageLineages,splitCageShapeLineages} from './cageSplitLineage';

/** Restriction commutes with a reflection by carrying its explicit endpoint
 * parity through the existing split plan. Children keep their allocated IDs;
 * only their order in the inner fitting frame and the native cut are reversed.
 * Cage and correction restrictions use the same native lineage kernels. */
export function splitMaterialProgram(steps:readonly EvaluatedMaterialStep[],intent:CurveSplitIntent):EvaluatedMaterialStep[] {
 return steps.map(step=>{
  if(step.kind==='affine')return structuredClone(step);
  if(step.kind==='cage')return {...structuredClone(step),domain:{...structuredClone(step.domain),...(step.domain.strokeScope?{strokeScope:{...step.domain.strokeScope,curveIds:step.domain.strokeScope.curveIds.flatMap(id=>id===intent.curveId?[...intent.childCurveIds]:[id])}}:{}),fitLineages:splitCageLineages(step.domain.fitLineages,intent)}};
  if(step.kind==='post-shape'){
   const shaped=splitCageShapeLineages(step.shapeLineages,step.value,intent);
   return {kind:'post-shape',value:shaped.value!,...(shaped.lineages.length?{shapeLineages:shaped.lineages}:{})};
  }
  const reverse=step.reverseCurveIds.includes(intent.curveId),inner:CurveSplitIntent=reverse?{...intent,t:1-intent.t,childCurveIds:[intent.childCurveIds[1],intent.childCurveIds[0]],sourceNodeIds:[intent.sourceNodeIds[1],intent.sourceNodeIds[0]]}:intent;
  return {...step,reverseCurveIds:step.reverseCurveIds.flatMap(id=>id===intent.curveId?[...intent.childCurveIds]:[id]),steps:splitMaterialProgram(step.steps,inner)};
 });
}
