import {evaluatedFitRange,evaluatedFitContext} from '../drawing/evaluatedDeformation';
import {subcurve} from '../drawing/roundedJoin';
import {add,sub,type DrawingDocument,type Point2} from '../drawing/model';
import type {SceneShapeValue} from '../recordingScene/model';
import type {CageSplitShapeLineage} from './cageSplitLineage';
/** Logical parent corrections remain authored once. Their cubic displacement
 * is restricted at the same fitted boundaries as the live child controls. */
export function expandCageSplitPostShape(drawing:DrawingDocument,value:SceneShapeValue,lineages:readonly CageSplitShapeLineage[]):SceneShapeValue {
 const result=structuredClone(value),curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),zero=():Point2=>[0,0];
 for(const root of lineages){const delta=root.offsets,first=curves.get(root.parts[0].curveId),last=curves.get(root.parts.at(-1)!.curveId);
  const complete=root.parts[0].parameterRange[0]===0&&root.parts.at(-1)!.parameterRange[1]===1&&root.parts.every((part,i)=>!i||part.parameterRange[0]===root.parts[i-1].parameterRange[1]);
  let lo=complete&&first?(evaluatedFitRange(drawing,first.id)??root.parts[0].parameterRange)[0]:0,hi=complete&&last?(evaluatedFitRange(drawing,last.id)??root.parts.at(-1)!.parameterRange)[1]:1;
  const reference=root.parts.find(part=>curves.has(part.curveId)),context=reference&&evaluatedFitContext(drawing,reference.curveId);
  if(reference&&context?.sourceRange&&context.parentParameter){const [a,b]=reference.parameterRange,[c,d]=context.sourceRange,scale=(d-c)/(b-a),start=c-a*scale;lo=context.parentParameter(start);hi=context.parentParameter(start+scale);}
  const span=hi-lo;
  if(!delta.some(point=>point.some(n=>n!==0)))continue;
  const seen=new Set<string>();for(const part of root.parts){const curve=curves.get(part.curveId);if(!curve)continue;const range=evaluatedFitRange(drawing,part.curveId)??part.parameterRange,piece=subcurve(delta,(range[0]-lo)/span,(range[1]-lo)/span),own=result.handles[part.curveId]??[zero(),zero()];result.handles[part.curveId]=[add(own[0],sub(piece[1],piece[0])),add(own[1],sub(piece[2],piece[3]))];
   for(const endpoint of [0,1] as const){const id=curve.nodes[endpoint];if(part.parameterRange[endpoint]===0||part.parameterRange[endpoint]===1||seen.has(id))continue;seen.add(id);result.nodes[id]=add(result.nodes[id]??zero(),piece[endpoint?3:0]);}
  }
 }
 return result;
}
