import {objectById,type DrawingDocument} from '../drawing/model';
import {retainEvaluatedDeformations} from '../drawing/evaluatedDeformation';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import type {RecordingSnapshot} from './model';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';

/** Editor locks are discrete, live inherited flags, never pose channels.
 * Missing follows the parent; false explicitly unlocks this snapshot's object. */
export type SnapshotObjectLocks=Record<string,boolean>;
export function validateSnapshotObjectLocks(value:unknown):asserts value is SnapshotObjectLocks {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>65536||Object.entries(value).some(([id,locked])=>!id||id.length>16384||typeof locked!=='boolean'))throw Error('Invalid snapshot object locks.');
}
export function applySnapshotObjectLocks(drawing:DrawingDocument,locks:SnapshotObjectLocks|undefined):DrawingDocument {
 if(!locks||![...drawing.curves,...drawing.fills,...drawing.offsets].some(value=>Object.hasOwn(locks,value.id)&&locks[value.id]!==value.locked))return drawing;
 const apply=<T extends {id:string;locked:boolean}>(value:T):T=>Object.hasOwn(locks,value.id)?{...value,locked:locks[value.id]}:value;
 const result={...drawing,curves:drawing.curves.map(apply),fills:drawing.fills.map(apply),offsets:drawing.offsets.map(apply)};
 return retainSnapshotRouteMaterialInput(retainEvaluatedDeformations(result,[drawing]),drawing);
}
/** Shared write authority. Callers resolve the actual target before writing. */
export function snapshotWithObjectLocks(snapshot:RecordingSnapshot,drawing:DrawingDocument,changes:SnapshotObjectLocks):RecordingSnapshot {
 validateSnapshotObjectLocks(changes);
 for(const id of Object.keys(changes))if(!objectById(drawing,id))throw Error(`Cannot lock missing snapshot object ${id}.`);
 if(Object.entries(changes).every(([id,value])=>snapshot.objectLocks?.[id]===value))return snapshot;
 return {...snapshot,objectLocks:{...snapshot.objectLocks,...changes}};
}
export function splitSnapshotObjectLocks(locks:SnapshotObjectLocks,intent:CurveSplitIntent):SnapshotObjectLocks {
 if(!Object.hasOwn(locks,intent.curveId))return locks;
 const result={...locks};delete result[intent.curveId];for(const id of intent.childCurveIds)Object.defineProperty(result,id,{value:locks[intent.curveId],enumerable:true,writable:true,configurable:true});return result;
}
export function pruneSnapshotObjectLocks(locks:SnapshotObjectLocks,removed:ReadonlySet<string>):SnapshotObjectLocks|undefined {
 const result=Object.fromEntries(Object.entries(locks).filter(([id])=>!removed.has(id)));return Object.keys(result).length?result:undefined;
}

export function assertSnapshotObjectsUnlocked(drawing:DrawingDocument,ids:readonly string[]):void {
 if(ids.some(id=>objectById(drawing,id)?.locked))throw Error('对象已锁定。Unlock the selected objects before editing.');
}
