import {useEditor} from '../../app/store';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import type {ReferenceImage} from '../../domain/project/types';
import {RECORDING_REFERENCE_IMAGE,validateRecordingReference} from '../../domain/recording/reference';
import {recordingReferenceStorage,withRecordingReferenceFallback,type RecordingReferenceStorage,type SavedRecordingReference} from './recordingReferenceStorage';
import {copyReferenceBindings,copyReferenceTransform,matchesReferenceBinding,referenceAngleKey,referenceBindingAt,validateReferenceMetadata,type RecordingReferenceBinding,type ReferenceAngle} from './recordingReferenceBindings';

interface Snapshot {document:DrawingDocument;imageId?:string;bindings:readonly RecordingReferenceBinding[];angle?:ReferenceAngle;preview:DrawingDocument|null;moving:boolean;busy:boolean;error:string;hydrating:boolean;saving:boolean;persistenceError:string;persistenceFailure:'restore'|'save'|null}
type ReadImage=(file:File,options:typeof RECORDING_REFERENCE_IMAGE)=>Promise<ReferenceImage>;
const copy=(reference:ReferenceImage|undefined)=>reference?{...reference,offset:[...reference.offset] as [number,number]}:undefined;
const sameImage=(a:ReferenceImage,b:ReferenceImage)=>a.name===b.name&&a.dataUrl===b.dataUrl&&a.width===b.width&&a.height===b.height;
const sameImageTransform=(a:ReferenceImage,b:ReferenceImage)=>sameImage(a,b)&&matchesReferenceBinding(a,b);
const imageId=()=>crypto.randomUUID();
const copyAngle=(angle:ReferenceAngle|undefined)=>angle?{...angle}:undefined;
const copyRecord=(record:SavedRecordingReference):SavedRecordingReference=>({reference:copy(record.reference),imageId:record.imageId,bindings:copyReferenceBindings(record.bindings)});

export type RecordingReferenceHistory=(effect:import('../../app/editorHistory').WorkspaceHistoryEffect)=>void;
/** Local reference state. Committed edits can join global history without
 * placing pixels in project/source/snapshot/key data. Previews never do. */
export function createRecordingReferenceState(seed?:ReferenceImage,storage?:RecordingReferenceStorage,history?:RecordingReferenceHistory){
 let snapshot:Snapshot={document:{...emptyDrawing(),reference:copy(seed)},imageId:seed?imageId():undefined,bindings:[],preview:null,moving:false,busy:false,error:'',hydrating:false,saving:false,persistenceError:'',persistenceFailure:null};
 let active=true,request=0,revision=0,saveVersion=0;
 let replayActivationAngle:string|undefined;
 let restorePromise:Promise<void>|undefined,writeQueue=Promise.resolve();
 const listeners=new Set<()=>void>();
 function publish(patch:Partial<Snapshot>){snapshot={...snapshot,...patch};for(const listener of listeners)listener();}
 const currentRecord=():SavedRecordingReference=>({reference:snapshot.document.reference,imageId:snapshot.imageId,bindings:snapshot.bindings});
 function persist(record=currentRecord()){
  if(!storage)return;
  const version=++saveVersion,saved=copyRecord(record);publish({saving:true,persistenceError:'',persistenceFailure:null});
  // Keep writes in edit order, including a removal that follows a large upload.
  writeQueue=writeQueue.then(()=>storage.save(saved.reference,{imageId:saved.imageId,bindings:saved.bindings})).then(()=>{if(version===saveVersion)publish({saving:false,persistenceError:'',persistenceFailure:null});},error=>{if(version===saveVersion)publish({saving:false,persistenceError:error instanceof Error?error.message:String(error),persistenceFailure:'save'});});
 }
 function restore(){
  if(!storage||revision!==0&&!restorePromise)return Promise.resolve();
  if(restorePromise)return restorePromise;
  const initialRevision=revision;publish({hydrating:true,persistenceError:'',persistenceFailure:null});
  restorePromise=storage.load().then(saved=>{
   if(revision!==initialRevision)return;
   if(saved){
    validateRecordingReference(saved.reference);validateReferenceMetadata(saved.reference,saved);
    const record=copyRecord(saved),binding=referenceBindingAt(record.bindings??[],snapshot.angle);
    if(record.reference){record.imageId??=imageId();if(binding)record.reference={...record.reference,...copyReferenceTransform(binding)};}
    publish({document:{...snapshot.document,reference:record.reference},imageId:record.imageId,bindings:record.bindings??[],preview:null});
    if(record.reference&&binding&&!matchesReferenceBinding(saved.reference!,binding))persist();
   }else persist();
  }).catch(error=>{restorePromise=undefined;if(revision===initialRevision)publish({persistenceError:error instanceof Error?error.message:String(error),persistenceFailure:'restore'});}).finally(()=>publish({hydrating:false}));
  return restorePromise;
 }
 function editable(next:ReferenceImage|undefined){
  const current=snapshot.document.reference;
  return !current?.locked||!!next&&sameImageTransform(current,next);
 }
 function install(record:SavedRecordingReference,angle=snapshot.angle){
  request++;revision++;
  const next=copyRecord(record);
  publish({document:{...snapshot.document,reference:next.reference},imageId:next.imageId,bindings:next.bindings??[],angle:copyAngle(angle),preview:null,busy:false,error:'',moving:false});
  persist();
 }
 function replay(record:SavedRecordingReference,angle:ReferenceAngle|undefined){
  // Store Undo/Redo installs its project angle before invoking this effect.
  // Mark that angle as entered so a later React layout effect cannot replace
  // the explicit historical transform with its saved angle default.
  replayActivationAngle=!active&&angle?referenceAngleKey(angle):undefined;
  install(record,angle);
 }
 function commitRecord(after:SavedRecordingReference){
  const before=copyRecord(currentRecord()),a=before.reference,b=after.reference;
  if((!a&&!b||a&&b&&sameImageTransform(a,b)&&a.visible===b.visible&&a.locked===b.locked)&&before.imageId===after.imageId&&JSON.stringify(before.bindings)===JSON.stringify(after.bindings??[])){request++;publish({preview:null,busy:false,error:''});return;}
  const saved=copyRecord(after),angle=copyAngle(snapshot.angle);
  install(saved);history?.({kind:'reference',undo:()=>replay(before,angle),redo:()=>replay(saved,angle)});
 }
 function commit(reference:ReferenceImage|undefined,replacement=false){
  const current=snapshot.document.reference,reuse=!replacement&&current&&reference&&sameImage(current,reference);
  commitRecord({reference,imageId:reference?(reuse?snapshot.imageId:imageId()):undefined,bindings:reuse?snapshot.bindings:[]});
 }
 function enterAngle(angle:ReferenceAngle|undefined,force=false){
  if(!angle)return;
  const key=referenceAngleKey(angle);if(!force&&snapshot.angle&&referenceAngleKey(snapshot.angle)===key)return;
  replayActivationAngle=undefined;
  const binding=referenceBindingAt(snapshot.bindings,angle),reference=snapshot.document.reference;
  if(reference&&binding)install({...currentRecord(),reference:{...reference,...copyReferenceTransform(binding)}},angle);
  else {request++;publish({angle:copyAngle(angle),preview:null,moving:false,busy:false,error:''});}
 }
 function bindCurrentAngle(){
  const reference=snapshot.document.reference,angle=snapshot.angle;
  if(!active||!reference||!angle||snapshot.busy||snapshot.hydrating||snapshot.preview)return;
  const previous=referenceBindingAt(snapshot.bindings,angle);
  if(previous&&matchesReferenceBinding(reference,previous))return;
  const binding={angle:{...angle},...copyReferenceTransform(reference)};
  commitRecord({...currentRecord(),bindings:previous?snapshot.bindings.map(item=>item===previous?binding:item):[...snapshot.bindings,binding]});
 }
 function change(reference:ReferenceImage|undefined){
  if(!active||!editable(reference))return;
  validateRecordingReference(reference);const moving=snapshot.moving;
  commit(reference);
  if(moving&&reference?.visible&&!reference.locked)publish({moving:true});
 }
 function cancelPending(){request++;publish({preview:null,busy:false,error:''});}
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
  enterAngle,
  bindCurrentAngle,
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
  retrySave(){persist();return writeQueue;},
  retryStorage(){if(snapshot.persistenceFailure==='restore'&&revision===0)return restore();persist();return writeQueue;},
  activate(angle=snapshot.angle){active=true;if(typeof window!=='undefined')window.addEventListener('contour:cancel-recording-gesture',cancelPending);const replay=angle&&replayActivationAngle===referenceAngleKey(angle);replayActivationAngle=undefined;if(!replay)enterAngle(angle,true);void restore();},
  deactivate(){active=false;if(typeof window!=='undefined')window.removeEventListener('contour:cancel-recording-gesture',cancelPending);request++;publish({preview:null,moving:false,busy:false,error:''});},
  async upload(file:File,readImage:ReadImage){
   if(!active||snapshot.document.reference?.locked)return;
   const ticket=++request;revision++;publish({busy:true,preview:null,moving:false,error:''});
   try{
    const reference=await readImage(file,RECORDING_REFERENCE_IMAGE);
    if(!active||ticket!==request)return;
    validateRecordingReference(reference);
    commit({...reference,locked:true},true);
   }catch(error){if(active&&ticket===request)publish({busy:false,error:error instanceof Error?error.message:String(error)});}
  },
 };
}
export type RecordingReferenceState=ReturnType<typeof createRecordingReferenceState>;
// View state survives scene switches; committed images also live in a dedicated
// local IndexedDB store. Runtime history restores edits; project JSON, source
// snapshots and keys never contain these workspace images.
const sessions=new Map<string,RecordingReferenceState>();
export function recordingReferenceSession(sceneKey:string,seed?:ReferenceImage,fallbackSceneKey?:string){
 let state=sessions.get(sceneKey);
 if(!state){state=createRecordingReferenceState(seed,fallbackSceneKey&&fallbackSceneKey!==sceneKey?withRecordingReferenceFallback(recordingReferenceStorage(sceneKey),recordingReferenceStorage(fallbackSceneKey)):recordingReferenceStorage(sceneKey),effect=>useEditor.getState().commitWorkspaceEdit(effect));sessions.set(sceneKey,state);}
 return state;
}
