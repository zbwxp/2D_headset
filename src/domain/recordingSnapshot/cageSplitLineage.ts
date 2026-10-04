import {add,sub,type Cubic,type Point2} from '../drawing/model';
import type {SceneShapeValue} from '../recordingScene/model';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
/** A split is a restriction of one existing fit. Only current identities and
 * the shared native parameter partition are saved, never sampled geometry. */
export interface CageSplitLineage {id:string;parts:{curveId:string;parameterRange:[number,number]}[]}
export function validateCageSplitLineages(value:unknown):asserts value is CageSplitLineage[]{
 if(!Array.isArray(value)||value.length>4096)throw Error('Invalid cage split lineage list.');const ids=new Set<string>(),curves=new Set<string>();
 const id=(x:unknown)=>typeof x==='string'&&!!x&&x.length<=16384;
 for(const root of value){if(!root||typeof root!=='object'||Object.keys(root).some(k=>!['id','parts'].includes(k))||!id(root.id)||ids.has(root.id)||!Array.isArray(root.parts)||!root.parts.length||root.parts.length>256)throw Error('Invalid cage split lineage.');ids.add(root.id);let end=0;
  for(const part of root.parts){const range=part?.parameterRange;if(!part||Object.keys(part).some(k=>!['curveId','parameterRange'].includes(k))||!id(part.curveId)||curves.has(part.curveId)||!Array.isArray(range)||range.length!==2||!range.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||range[0]<end||range[0]<0||range[1]>1||range[1]<=range[0])throw Error('Invalid cage split live parameter range.');curves.add(part.curveId);end=range[1];}
 }
}
export function splitCageLineages(before:readonly CageSplitLineage[]|undefined,intent:CurveSplitIntent):CageSplitLineage[]{
 const result=structuredClone(before??[]) as CageSplitLineage[];let found=false;
 for(const root of result){const index=root.parts.findIndex(part=>part.curveId===intent.curveId);if(index<0)continue;found=true;const part=root.parts[index],cut=part.parameterRange[0]+(part.parameterRange[1]-part.parameterRange[0])*intent.t;root.parts.splice(index,1,{curveId:intent.childCurveIds[0],parameterRange:[part.parameterRange[0],cut]},{curveId:intent.childCurveIds[1],parameterRange:[cut,part.parameterRange[1]]});}
 if(!found)result.push({id:intent.curveId,parts:[{curveId:intent.childCurveIds[0],parameterRange:[0,intent.t]},{curveId:intent.childCurveIds[1],parameterRange:[intent.t,1]}]});validateCageSplitLineages(result);return result;
}
export function remapCageSplitLineages(before:readonly CageSplitLineage[],id:(id:string)=>string,keep:(id:string)=>boolean=()=>true):CageSplitLineage[]{return before.flatMap(root=>{const parts=root.parts.filter(part=>keep(part.curveId)).map(part=>({...part,curveId:id(part.curveId)}));return parts.length?[{id:id(root.id),parts}]:[];});}

/** These are the pre-existing authored displacement scalars, transferred out
 * of a retired control identity. They are never source geometry or new keys. */
export interface CageSplitShapeLineage extends CageSplitLineage {offsets:Cubic}
export function validateCageSplitShapeLineages(value:unknown):asserts value is CageSplitShapeLineage[]{
 if(!Array.isArray(value)||value.length>4096)throw Error('Invalid split shape lineage list.');
 const ids=new Set<string>();for(const item of value){if(!item||Object.keys(item).some(key=>!['id','parts','offsets'].includes(key)))throw Error('Invalid split shape lineage.');validateCageSplitLineages([{id:item.id,parts:item.parts}]);if(ids.has(item.id)||!Array.isArray(item.offsets)||item.offsets.length!==4||item.offsets.some((p:unknown)=>!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n))))throw Error('Invalid split shape displacement.');ids.add(item.id);}
}
export function splitCageShapeLineages(before:readonly CageSplitShapeLineage[]|undefined,value:SceneShapeValue|undefined,intent:CurveSplitIntent):{lineages:CageSplitShapeLineage[];value:SceneShapeValue|undefined}{
 const lineages=(before??[]).map(root=>({...root,parts:splitCageLineages([{id:root.id,parts:root.parts}],intent).find(next=>next.id===root.id)!.parts})),shape=value&&structuredClone(value);if(!shape)return {lineages,value:shape};
 const zero=():Point2=>[0,0],already=(end:0|1)=>(before??[]).filter(root=>root.parts[end?root.parts.length-1:0].curveId===intent.curveId).reduce((sum,root)=>add(sum,root.offsets[end?3:0]),zero()),a=sub(shape.nodes[intent.sourceNodeIds[0]]??zero(),already(0)),b=sub(shape.nodes[intent.sourceNodeIds[1]]??zero(),already(1)),handles=shape.handles[intent.curveId]??[zero(),zero()],offsets:Cubic=[a,add(a,handles[0]),add(b,handles[1]),b];delete shape.handles[intent.curveId];
 if(offsets.some(p=>p.some(n=>n!==0)))lineages.push({...splitCageLineages(undefined,intent)[0],offsets});validateCageSplitShapeLineages(lineages);return {lineages,value:shape};
}
export function remapCageSplitShapeLineages(before:readonly CageSplitShapeLineage[],id:(id:string)=>string,keep:(id:string)=>boolean=()=>true):CageSplitShapeLineage[]{return before.flatMap(root=>remapCageSplitLineages([{id:root.id,parts:root.parts}],id,keep).map(mapped=>({...mapped,offsets:structuredClone(root.offsets)})));}
