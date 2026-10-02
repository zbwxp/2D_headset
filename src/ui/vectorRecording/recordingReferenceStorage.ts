import type {ReferenceImage} from '../../domain/project/types';
import {validateRecordingReference} from '../../domain/recording/reference';

export interface SavedRecordingReference {reference?:ReferenceImage}
export interface RecordingReferenceStorage {
 load:()=>Promise<SavedRecordingReference|null>;
 save:(reference:ReferenceImage|undefined)=>Promise<void>;
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
   if(!value||typeof value!=='object'||!('version' in value)||value.version!==1)throw Error('Invalid local reference record');
   const reference=(value as SavedRecordingReference).reference;validateRecordingReference(reference);
   return {reference};
  },
  async save(reference){
   validateRecordingReference(reference);const db=await openDatabase();
   await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction(storeName,'readwrite');
    const request=transaction.objectStore(storeName).put({version:1,reference},sceneKey);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=transaction.onabort=()=>reject(transaction.error??request.error??Error('Cannot save local reference'));
   });
  },
 };
}
