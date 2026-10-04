import type {DrawingDocument,Cubic} from '../drawing/model';
import type {SnapshotResponseFitParameterDomain} from './responseExpressions';
import {recordSnapshotSplitParameterRanges,recordSnapshotSplitMaterialFrames} from './splitParameterField';
/** Values are produced by the same scalar DAG as the final controls. Only
 * original-frame evaluations report; rebasing corner evaluations are ignored. */
export function createSnapshotFitParameterCollector(){
 const reports=new Map<string,{domain:SnapshotResponseFitParameterDomain;q:number;parent?:Cubic}>();
 const record=(domain:SnapshotResponseFitParameterDomain,q:number,parent?:Cubic)=>{const key=JSON.stringify(domain),prior=reports.get(key);if(prior&&Math.abs(prior.q-q)>1e-12)throw Error('A split material parameter has conflicting scalar field provenance.');reports.set(key,{domain,q,parent:parent??prior?.parent});};
 const apply=(drawing:DrawingDocument)=>{
  const values=[...reports.values()],groups=new Map(values.map(value=>[JSON.stringify(value.domain.parts),value.domain.parts])),roots=[...groups.values()].filter(parts=>![...groups.values()].some(other=>other.length>parts.length&&parts.every(part=>other.some(value=>value.curveId===part.curveId)))),ranges=new Map<string,readonly [number,number]>();
  for(const parts of roots){const ids=new Set(parts.map(part=>part.curveId)),cuts=new Map<number,number>([[0,0],[1,1]]),pending=values.filter(value=>value.domain.parts.every(part=>ids.has(part.curveId)));
   for(let pass=0;pass<=pending.length;pass++){let progress=false;for(const {domain,q} of pending){const first=parts.find(part=>part.curveId===domain.parts[0].curveId)!,last=parts.find(part=>part.curveId===domain.parts.at(-1)!.curveId)!,lo=first.parameterRange[0],hi=last.parameterRange[1],a=cuts.get(lo),b=cuts.get(hi);if(a===undefined||b===undefined)continue;const at=lo+(hi-lo)*domain.t;if(!cuts.has(at)){cuts.set(at,a+(b-a)*q);progress=true;}}if(!progress)break;}
   for(const part of parts){const a=cuts.get(part.parameterRange[0]),b=cuts.get(part.parameterRange[1]);if(a===undefined||b===undefined)throw Error(`Split material ${part.curveId} has no complete live parameter restriction.`);ranges.set(part.curveId,[a,b]);}
  }
  recordSnapshotSplitParameterRanges(drawing,ranges);return recordSnapshotSplitMaterialFrames(drawing,[...groups.values()].flatMap(parts=>{const candidates=values.filter(value=>value.parent&&JSON.stringify(value.domain.parts)===JSON.stringify(parts));return candidates.length&&candidates.every(value=>JSON.stringify(value.parent)===JSON.stringify(candidates[0].parent))?[{parts,parent:candidates[0].parent!}]:[];}));
 };
 return {record,apply};
}
