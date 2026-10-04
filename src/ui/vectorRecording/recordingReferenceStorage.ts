import type {ReferenceImage} from '../../domain/project/types';
import {validateRecordingReference} from '../../domain/recording/reference';
import {validateReferenceMetadata,type RecordingReferenceMetadata} from './recordingReferenceBindings';

export interface SavedRecordingReference extends RecordingReferenceMetadata {reference?:ReferenceImage}
export interface RecordingReferenceStorage {
 load:()=>Promise<SavedRecordingReference|null>;
 save:(reference:ReferenceImage|undefined,metadata?:RecordingReferenceMetadata)=>Promise<void>;
}
const databaseName='contour-recording-viewport',storeName='scene-references';
let database:Promise<IDBDatabase>|undefined;
function openDatabase(){
 if(database)return database;
 database=new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('Local reference storage is unavailable'));return;}
  let request:IDBOpenDBRequest;
  try{request=indexedDB.open(databaseName,1);}catch(error){reject(error);return;}
  let failed=false;
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName);};
  request.onerror=()=>{failed=true;reject(request.error??Error('Cannot open local reference storage'));};
  request.onblocked=()=>{failed=true;reject(Error('Local reference storage is blocked by another window'));};
  request.onsuccess=()=>{
   const db=request.result;if(failed){db.close();return;}
   db.onversionchange=()=>{db.close();database=undefined;};resolve(db);
  };
 }).catch(error=>{database=undefined;throw error;});
 return database;
}
/** Dedicated local workspace records; absent images are saved as tombstones. */
export function recordingReferenceStorage(sceneKey:string):RecordingReferenceStorage {
 return {
  async load(){
   const db=await openDatabase();
   const value=await new Promise<unknown>((resolve,reject)=>{
    const transaction=db.transaction(storeName,'readonly'),request=transaction.objectStore(storeName).get(sceneKey);
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=transaction.onabort=()=>reject(transaction.error??request.error??Error('Cannot read local reference'));
   });
   if(value===undefined)return null;
   return decodeRecordingReferenceRecord(value);
  },
  async save(reference,metadata={}){
   validateRecordingReference(reference);validateReferenceMetadata(reference,metadata);const db=await openDatabase();
   await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction(storeName,'readwrite');
    const request=transaction.objectStore(storeName).put({version:2,reference,...metadata},sceneKey);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=transaction.onabort=()=>reject(transaction.error??request.error??Error('Cannot save local reference'));
   });
  },
 };
}

/** Version 1 has no angle defaults; keep its current alignment unchanged. */
export function decodeRecordingReferenceRecord(value:unknown):SavedRecordingReference {
 if(!value||typeof value!=='object'||!('version' in value)||(value.version!==1&&value.version!==2))throw Error('Invalid local reference record');
 const saved=value as SavedRecordingReference,reference=saved.reference;validateRecordingReference(reference);
 if(value.version===1)return {reference};
 const metadata={imageId:saved.imageId,bindings:saved.bindings};validateReferenceMetadata(reference,metadata);
 return {reference,...metadata};
}

/** Prefer current workspace edits (including explicit image removal). Legacy
 * storage is read only when no current record has ever been saved. */
export function withRecordingReferenceFallback(primary:RecordingReferenceStorage,fallback:RecordingReferenceStorage):RecordingReferenceStorage{
 return {save:(reference,metadata)=>metadata===undefined?primary.save(reference):primary.save(reference,metadata),load:async()=>{const current=await primary.load();return current===null?fallback.load():current;}};
}
