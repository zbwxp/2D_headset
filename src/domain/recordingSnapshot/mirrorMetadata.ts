import type {DrawingDocument} from '../drawing/model';
import {validateMirrorEditing,type MirrorCurvePair} from '../drawing/mirrorEditing';
import type {CurveSplitIntent,PairedCurveSplitIntent} from '../drawing/layerEditIntent';
import {patchSnapshotRelations} from './relationAuthoringIntent';
import type {RecordingSnapshot,RecordingSnapshotWorkspace,SnapshotRelationPatch} from './model';

/** Discrete editor relations: omission inherits; no field constrains geometry. */
export interface SnapshotMirrorMetadata {axisX?:number;enabled?:boolean;axisNodeIds?:string[];curvePairs?:SnapshotRelationPatch<MirrorCurvePair>}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const validId=(value:unknown)=>typeof value==='string'&&!!value&&value.length<=16384;
export function validateSnapshotMirrorMetadata(value:unknown):asserts value is SnapshotMirrorMetadata {
 const fail=():never=>{throw Error('Invalid snapshot mirror metadata.');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const patch=value as SnapshotMirrorMetadata;
 if(Object.keys(patch).some(key=>!['axisX','enabled','axisNodeIds','curvePairs'].includes(key))||patch.axisX!==undefined&&!Number.isFinite(patch.axisX)||patch.enabled!==undefined&&typeof patch.enabled!=='boolean')fail();
 if(patch.axisNodeIds!==undefined&&(!Array.isArray(patch.axisNodeIds)||patch.axisNodeIds.some(id=>!validId(id))||new Set(patch.axisNodeIds).size!==patch.axisNodeIds.length))fail();
 const pairs=patch.curvePairs;if(pairs===undefined)return;
 if(!pairs||typeof pairs!=='object'||Array.isArray(pairs)||Object.keys(pairs).some(key=>!['add','update','disable'].includes(key)))fail();
 for(const values of [pairs.add,pairs.update])if(values!==undefined){if(!Array.isArray(values)||values.some(pair=>!pair||Object.keys(pair).some(key=>!['id','a','b','reverse'].includes(key))||![pair.id,pair.a,pair.b].every(validId)||typeof pair.reverse!=='boolean')||new Set(values.map(pair=>pair.id)).size!==values.length)fail();}
 if(pairs.disable!==undefined&&(!Array.isArray(pairs.disable)||pairs.disable.some(id=>!validId(id))||new Set(pairs.disable).size!==pairs.disable.length))fail();
 if(pairs.add?.some(pair=>pairs.update?.some(other=>other.id===pair.id)||pairs.disable?.includes(pair.id))||pairs.update?.some(pair=>pairs.disable?.includes(pair.id)))fail();
 const used=new Set<string>();for(const pair of [...pairs.add??[],...pairs.update??[]]){if(used.has(pair.a)||used.has(pair.b))fail();used.add(pair.a);used.add(pair.b);}
}
/** Inherited parent metadata stays live; an enabled-only patch never copies pairs. */
export function applySnapshotMirrorMetadata(drawing:DrawingDocument,snapshot:RecordingSnapshot,parents:readonly DrawingDocument[]):DrawingDocument {
 const inherited=[...(snapshot.source?[snapshot.source]:[]),...parents],local=snapshot.relations.mirrorEditing;
 if(!local&&!inherited.some(value=>value.mirrorEditing!==undefined||value.mirrorAxisX!==undefined))return drawing;
 const curves=new Set(drawing.curves.map(curve=>curve.id)),nodes=new Set(drawing.nodes.map(node=>node.id)),pairs=new Map<string,MirrorCurvePair>();
 for(const source of inherited)for(const pair of source.mirrorEditing?.curvePairs??[])if(curves.has(pair.a)&&curves.has(pair.b)){
  const prior=pairs.get(pair.id);if(prior&&!same(prior,pair)&&!local?.curvePairs?.update?.some(value=>value.id===pair.id)&&!local?.curvePairs?.disable?.includes(pair.id))throw Error(`Inherited mirror pair ${pair.id} has conflicting definitions.`);pairs.set(pair.id,pair);
 }
 for(const id of local?.curvePairs?.disable??[])pairs.delete(id);
 for(const pair of [...local?.curvePairs?.add??[],...local?.curvePairs?.update??[]])if(curves.has(pair.a)&&curves.has(pair.b))pairs.set(pair.id,pair);
 const axisX=local?.axisX??inherited.find(value=>value.mirrorAxisX!==undefined)?.mirrorAxisX;
 const enabled=local?.enabled??inherited.find(value=>value.mirrorEditing!==undefined)?.mirrorEditing?.enabled??false;
 const axisNodeIds=(local?.axisNodeIds??[...new Set(inherited.flatMap(value=>value.mirrorEditing?.axisNodeIds??[]))]).filter(id=>nodes.has(id));
 const result={...drawing,...(axisX!==undefined?{mirrorAxisX:axisX}:{}),mirrorEditing:{enabled,curvePairs:[...pairs.values()],...(axisNodeIds.length?{axisNodeIds}:{})}};
 validateMirrorEditing(result);return result;
}
/** Patch only authored differences, leaving unrelated parent defaults live. */
export function snapshotWithMirrorMetadata(snapshot:RecordingSnapshot,before:DrawingDocument,after:DrawingDocument):RecordingSnapshot {
 validateMirrorEditing(after);
 const prior=snapshot.relations.mirrorEditing,patch:SnapshotMirrorMetadata={...prior};
 if((before.mirrorAxisX??0)!==(after.mirrorAxisX??0))patch.axisX=after.mirrorAxisX??0;
 if((before.mirrorEditing?.enabled??false)!==(after.mirrorEditing?.enabled??false))patch.enabled=after.mirrorEditing?.enabled??false;
 if(!same(before.mirrorEditing?.axisNodeIds??[],after.mirrorEditing?.axisNodeIds??[]))patch.axisNodeIds=after.mirrorEditing?.axisNodeIds??[];
 const pairs=patchSnapshotRelations(prior?.curvePairs,before.mirrorEditing?.curvePairs??[],after.mirrorEditing?.curvePairs??[],()=>false);if(pairs)patch.curvePairs=pairs;else delete patch.curvePairs;
 if(!Object.keys(patch).length&&!prior||same(prior,patch))return snapshot;
 validateSnapshotMirrorMetadata(patch);return {...snapshot,relations:{...snapshot.relations,mirrorEditing:patch}};
}
export function pruneSnapshotMirrorMetadata(patch:SnapshotMirrorMetadata,removed:ReadonlySet<string>):SnapshotMirrorMetadata {
 const pairs=patch.curvePairs,keep=(pair:MirrorCurvePair)=>![pair.id,pair.a,pair.b].some(id=>removed.has(id));
 return {...patch,...(patch.axisNodeIds?{axisNodeIds:patch.axisNodeIds.filter(id=>!removed.has(id))}:{}),...(pairs?{curvePairs:{...(pairs.add?{add:pairs.add.filter(keep)}:{}),...(pairs.update?{update:pairs.update.filter(keep)}:{}),...(pairs.disable?{disable:pairs.disable.filter(id=>!removed.has(id))}:{})}}:{})};
}
export function remapSnapshotMirrorMetadata(patch:SnapshotMirrorMetadata,map:(id:string)=>string):SnapshotMirrorMetadata {
 const pair=(value:MirrorCurvePair)=>({...value,id:map(value.id),a:map(value.a),b:map(value.b)}),pairs=patch.curvePairs;
 return {...patch,...(patch.axisNodeIds?{axisNodeIds:patch.axisNodeIds.map(map)}:{}),...(pairs?{curvePairs:{...(pairs.add?{add:pairs.add.map(pair)}:{}),...(pairs.update?{update:pairs.update.map(pair)}:{}),...(pairs.disable?{disable:pairs.disable.map(map)}:{})}}:{})};
}
export function splitSnapshotMirrorMetadata(patch:SnapshotMirrorMetadata,intent:CurveSplitIntent,replacements:PairedCurveSplitIntent['mirrorPairs']=[]):SnapshotMirrorMetadata {
 const pairs=patch.curvePairs;if(!pairs)return patch;
 const split=(values:MirrorCurvePair[])=>values.flatMap(pair=>{const replacement=replacements.find(value=>value.oldPairId===pair.id);return replacement?[replacement.left,replacement.right]:pair.a===intent.curveId||pair.b===intent.curveId?[]:[pair];});
 return {...patch,curvePairs:{...(pairs.add?{add:split(pairs.add)}:{}),...(pairs.update?{update:split(pairs.update)}:{}),...(pairs.disable?{disable:pairs.disable.flatMap(id=>{const replacement=replacements.find(value=>value.oldPairId===id);return replacement?[replacement.left.id,replacement.right.id]:[id];})}:{})}};
}
