import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import type {ReferenceImage} from '../../domain/project/types';
import {RECORDING_REFERENCE_IMAGE,validateRecordingReference} from '../../domain/recording/reference';
import {recordingReferenceStorage,type RecordingReferenceStorage} from './recordingReferenceStorage';

interface Snapshot {document:DrawingDocument;preview:DrawingDocument|null;moving:boolean;busy:boolean;error:string;hydrating:boolean;saving:boolean;persistenceError:string;persistenceFailure:'restore'|'save'|null}
type ReadImage=(file:File,options:typeof RECORDING_REFERENCE_IMAGE)=>Promise<ReferenceImage>;
const copy=(reference:ReferenceImage|undefined)=>reference?{...reference,offset:[...reference.offset] as [number,number]}:undefined;
const sameImageTransform=(a:ReferenceImage,b:ReferenceImage)=>a.name===b.name&&a.dataUrl===b.dataUrl&&a.width===b.width&&a.height===b.height&&a.opacity===b.opacity&&a.scale===b.scale&&a.rotation===b.rotation&&a.offset.every((value,i)=>value===b.offset[i]);

/** View-only session state. No project, source drawing, history, scene or export writes. */
export function createRecordingReferenceState(seed?:ReferenceImage,storage?:RecordingReferenceStorage){
 let snapshot:Snapshot={document:{...emptyDrawing(),reference:copy(seed)},preview:null,moving:false,busy:false,error:'',hydrating:false,saving:false,persistenceError:'',persistenceFailure:null};
 let active=true,request=0,revision=0,saveVersion=0;
 let restorePromise:Promise<void>|undefined,writeQueue=Promise.resolve();
 const listeners=new Set<()=>void>();
 function publish(patch:Partial<Snapshot>){snapshot={...snapshot,...patch};for(const listener of listeners)listener();}
 function persist(reference:ReferenceImage|undefined){
  if(!storage)return;
  const version=++saveVersion,saved=copy(reference);publish({saving:true,persistenceError:'',persistenceFailure:null});
  // Keep writes in edit order, including a removal that follows a large upload.
  writeQueue=writeQueue.then(()=>storage.save(saved)).then(()=>{if(version===saveVersion)publish({saving:false,persistenceError:'',persistenceFailure:null});},error=>{if(version===saveVersion)publish({saving:false,persistenceError:error instanceof Error?error.message:String(error),persistenceFailure:'save'});});
 }
 function restore(){
  if(!storage||revision!==0&&!restorePromise)return Promise.resolve();
  if(restorePromise)return restorePromise;
  const initialRevision=revision;publish({hydrating:true,persistenceError:'',persistenceFailure:null});
  restorePromise=storage.load().then(saved=>{
   if(revision!==initialRevision)return;
   if(saved){validateRecordingReference(saved.reference);publish({document:{...snapshot.document,reference:copy(saved.reference)},preview:null});}
   else persist(snapshot.document.reference);
  }).catch(error=>{restorePromise=undefined;if(revision===initialRevision)publish({persistenceError:error instanceof Error?error.message:String(error),persistenceFailure:'restore'});}).finally(()=>publish({hydrating:false}));
  return restorePromise;
 }
 function editable(next:ReferenceImage|undefined){
  const current=snapshot.document.reference;
  return !current?.locked||!!next&&sameImageTransform(current,next);
 }
 function change(reference:ReferenceImage|undefined){
  if(!active||!editable(reference))return;
  validateRecordingReference(reference);request++;revision++;
  publish({document:{...snapshot.document,reference:copy(reference)},preview:null,busy:false,error:'',moving:snapshot.moving&&!!reference?.visible&&!reference.locked});
  persist(reference);
 }
 function preview(reference:ReferenceImage|null){
  if(!active)return;
  if(reference===null){if(snapshot.preview)publish({preview:null});return;}
  if(snapshot.document.reference?.locked||!snapshot.document.reference)return;
  validateRecordingReference(reference);revision++;
  publish({preview:{...snapshot.document,reference:copy(reference)}});
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},
  current:()=>snapshot.document.reference,
  currentDocument:()=>snapshot.document,
  change,
  preview,
  run(changeDocument:()=>DrawingDocument){if(active)change(changeDocument().reference);},
  previewDocument(drawing:DrawingDocument|null){preview(drawing?.reference??null);},
  setMoving(value:boolean|((previous:boolean)=>boolean)){
   if(!active)return;
   const next=typeof value==='function'?value(snapshot.moving):value,reference=snapshot.document.reference;revision++;
   publish({moving:next&&!!reference?.visible&&!reference.locked,preview:null});
  },
  restore,
  whenSaved:()=>writeQueue,
  retrySave(){persist(snapshot.document.reference);return writeQueue;},
  retryStorage(){if(snapshot.persistenceFailure==='restore'&&revision===0)return restore();persist(snapshot.document.reference);return writeQueue;},
  activate(){active=true;void restore();},
  deactivate(){active=false;request++;publish({preview:null,moving:false,busy:false,error:''});},
  async upload(file:File,readImage:ReadImage){
   if(!active||snapshot.document.reference?.locked)return;
   const ticket=++request;revision++;publish({busy:true,preview:null,moving:false,error:''});
   try{
    const reference=await readImage(file,RECORDING_REFERENCE_IMAGE);
    if(!active||ticket!==request)return;
    validateRecordingReference(reference);
    publish({document:{...snapshot.document,reference:copy({...reference,locked:true})},preview:null,moving:false,busy:false,error:''});
    persist(snapshot.document.reference);
   }catch(error){if(active&&ticket===request)publish({busy:false,error:error instanceof Error?error.message:String(error)});}
  },
 };
}
export type RecordingReferenceState=ReturnType<typeof createRecordingReferenceState>;
// View state survives scene switches; committed images also live in a dedicated
// local IndexedDB store, never in project JSON, snapshots, history or keys.
const sessions=new Map<string,RecordingReferenceState>();
export function recordingReferenceSession(sceneKey:string,seed?:ReferenceImage){
 let state=sessions.get(sceneKey);
 if(!state){state=createRecordingReferenceState(seed,recordingReferenceStorage(sceneKey));sessions.set(sceneKey,state);}
 return state;
}
