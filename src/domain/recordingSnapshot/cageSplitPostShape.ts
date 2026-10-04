import {evaluatedFitRange} from '../drawing/evaluatedDeformation';
import {subcurve} from '../drawing/roundedJoin';
import {add,sub,type DrawingDocument,type Point2} from '../drawing/model';
import type {SceneShapeValue} from '../recordingScene/model';
import type {CageSplitShapeLineage} from './cageSplitLineage';
/** Logical parent corrections remain authored once. Their cubic displacement
 * is restricted at the same fitted boundaries as the live child controls. */
export function expandCageSplitPostShape(drawing:DrawingDocument,value:SceneShapeValue,lineages:readonly CageSplitShapeLineage[]):SceneShapeValue {
 const result=structuredClone(value),curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),zero=():Point2=>[0,0];
 for(const root of lineages){const first=curves.get(root.parts[0].curveId),last=curves.get(root.parts.at(-1)!.curveId);if(!first||!last)continue;const a=first.nodes[0],b=last.nodes[1],delta=root.offsets,firstRange=evaluatedFitRange(drawing,first.id)??root.parts[0].parameterRange,lastRange=evaluatedFitRange(drawing,last.id)??root.parts.at(-1)!.parameterRange,lo=firstRange[0],span=lastRange[1]-lo;
  if(!delta.some(point=>point.some(n=>n!==0)))continue;
  const seen=new Set<string>();for(const part of root.parts){const curve=curves.get(part.curveId);if(!curve)continue;const range=evaluatedFitRange(drawing,part.curveId)??part.parameterRange,piece=subcurve(delta,(range[0]-lo)/span,(range[1]-lo)/span),own=result.handles[part.curveId]??[zero(),zero()];result.handles[part.curveId]=[add(own[0],sub(piece[1],piece[0])),add(own[1],sub(piece[2],piece[3]))];
   for(const endpoint of [0,1] as const){const id=curve.nodes[endpoint];if(id===a||id===b||seen.has(id))continue;seen.add(id);result.nodes[id]=add(result.nodes[id]??zero(),piece[endpoint?3:0]);}
  }
 }
 return result;
}
