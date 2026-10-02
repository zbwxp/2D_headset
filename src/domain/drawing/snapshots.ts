import {emptyDrawing,parseDrawing,uid,type DrawingDocument} from './model';
import type {ReferenceImage} from '../project/types';
import {RECORDING_REFERENCE_IMAGE} from '../recording/reference';
import {markDrawingWorkingCopyIntent} from './workingCopyIntent';

/** Authored drawing poses, deliberately independent of Recording view angles/placement. */
export interface DrawingSnapshot {
 id:string;
 name:string;
 drawing:Omit<DrawingDocument,'reference'>;
 reference?:Omit<ReferenceImage,'dataUrl'>&{imageId:string};
}
export interface DrawingSnapshots {
 version:1;
 activeId?:string;
 items:DrawingSnapshot[];
 /** Share reference pixels; each pose keeps its own background alignment. */
 images:{id:string;dataUrl:string}[];
}
export interface DrawingSnapshotState {drawing?:DrawingDocument;drawingSnapshots?:DrawingSnapshots;drawingWorkingCopies?:Record<string,DrawingDocument>}
const empty=():DrawingSnapshots=>({version:1,items:[],images:[]});
const title=(name:string)=>{name=name.trim();if(!name||name.length>80)throw Error('快照名称请输入 1–80 个字符。');return name;};
const find=(s:DrawingSnapshots,id:string)=>{const item=s.items.find(x=>x.id===id);if(!item)throw Error('快照不存在。');return item;};
const prune=(s:DrawingSnapshots)=>({...s,images:s.images.filter(i=>s.items.some(x=>x.reference?.imageId===i.id))});

export function snapshotDrawing(s:DrawingSnapshots,id:string):DrawingDocument {
 const item=find(s,id),drawing=item.drawing;
 const r=item.reference;
 if(!r)return structuredClone(drawing);
 const image=s.images.find(i=>i.id===r.imageId);if(!image)throw Error('快照背景图缺失。');
 const {imageId,...meta}=r;void imageId;
 return structuredClone({...drawing,reference:{...meta,dataUrl:image.dataUrl}});
}

/** Keep unsaved edits under their existing artwork identity. Checkpoints remain
 * separate, and no extra named artwork is created for an ordinary switch. */
export function stashDrawingWorkingCopy(state:DrawingSnapshotState,discardIds:readonly string[]=[]):DrawingSnapshotState{
 const copies=new Map(Object.entries(state.drawingWorkingCopies??{})),active=state.drawingSnapshots?.activeId;
 if(active&&state.drawing&&state.drawingSnapshots!.items.some(a=>a.id===active)&&!discardIds.includes(active)){
  if(snapshotMatches(state.drawing,state.drawingSnapshots!,active))copies.delete(active);else copies.set(active,state.drawing);
 }
 for(const id of discardIds)copies.delete(id);
 return {...state,drawingWorkingCopies:Object.fromEntries(copies)};
}

export function parseDrawingWorkingCopies(value:unknown,library:DrawingSnapshots|undefined):Record<string,DrawingDocument>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>1000)throw Error('绘制工作副本数据无效');
 return Object.fromEntries(Object.entries(value).map(([id,drawing])=>{if(!id||!library?.items.some(a=>a.id===id))throw Error('绘制工作副本引用了不存在的画稿');return [id,parseDrawing(drawing)];}));
}

/** Capture is a checkpoint, never a live link to subsequent authoring edits. */
export function saveDrawingSnapshot(state:DrawingSnapshotState,name:string,replaceId?:string):DrawingSnapshotState {
 state=stashDrawingWorkingCopy(state);
 const library=state.drawingSnapshots??empty(),drawing=state.drawing??emptyDrawing();
 if(replaceId)find(library,replaceId);
 const {reference,...geometry}=drawing,images=[...library.images];
 let savedReference:DrawingSnapshot['reference'];
 if(reference){
  let image=images.find(x=>x.dataUrl===reference.dataUrl);
  if(!image){image={id:uid(),dataUrl:reference.dataUrl};images.push(image);}
  const {dataUrl,...meta}=reference;void dataUrl;savedReference={...structuredClone(meta),imageId:image.id};
 }
 const item:DrawingSnapshot={id:replaceId??uid(),name:title(name),drawing:structuredClone(geometry),...(savedReference?{reference:savedReference}:{})};
 const items=replaceId?library.items.map(x=>x.id===replaceId?item:x):[...library.items,item];
 const copies=new Map(Object.entries(state.drawingWorkingCopies??{}));copies.delete(item.id);
 return markDrawingWorkingCopyIntent({...state,drawing,drawingWorkingCopies:Object.fromEntries(copies),drawingSnapshots:prune({...library,activeId:item.id,items,images})},{checkpointIds:[item.id]});
}
export function restoreDrawingSnapshot(state:DrawingSnapshotState,id:string,options:{discardCurrent?:boolean}={}):DrawingSnapshotState {
 const discardIds=options.discardCurrent?[state.drawingSnapshots?.activeId??'$working']:[];
 state=stashDrawingWorkingCopy(state,discardIds);
 const library=state.drawingSnapshots??empty();
 const drawing=Object.hasOwn(state.drawingWorkingCopies??{},id)?structuredClone(state.drawingWorkingCopies![id]):snapshotDrawing(library,id);
 return markDrawingWorkingCopyIntent({...state,drawing,drawingSnapshots:{...library,activeId:id}},{discardIds});
}
export function renameDrawingSnapshot(state:DrawingSnapshotState,id:string,name:string):DrawingSnapshotState {
 const library=state.drawingSnapshots??empty();find(library,id);name=title(name);
 return {...state,drawingSnapshots:{...library,items:library.items.map(x=>x.id===id?{...x,name}:x)}};
}
export function deleteDrawingSnapshot(state:DrawingSnapshotState,id:string):DrawingSnapshotState {
 state=stashDrawingWorkingCopy(state);
 const library=state.drawingSnapshots??empty();find(library,id);
 const next=prune({...library,items:library.items.filter(x=>x.id!==id)});
 if(next.activeId===id)delete next.activeId;
 // Deleting a checkpoint never removes the working drawing.
 const copies=new Map(Object.entries(state.drawingWorkingCopies??{}));copies.delete(id);
 return markDrawingWorkingCopyIntent({...state,drawingSnapshots:next,drawingWorkingCopies:Object.fromEntries(copies)},{discardIds:[id]});
}

const geometryJSON=new WeakMap<object,string>();
function geometrySignature(d:Omit<DrawingDocument,'reference'>){let signature=geometryJSON.get(d);if(signature===undefined){const {reference,...geometry}=d as DrawingDocument;void reference;signature=JSON.stringify(geometry);geometryJSON.set(d,signature);}return signature;}
export function snapshotMatches(drawing:DrawingDocument,library:DrawingSnapshots,id:string):boolean {
 const item=find(library,id),ref=item.reference,current=drawing.reference;
 if(!!ref!==!!current)return false;
 if(ref&&current){const {imageId,...meta}=ref,{dataUrl,...currentMeta}=current;if(library.images.find(i=>i.id===imageId)?.dataUrl!==dataUrl||JSON.stringify(meta)!==JSON.stringify(currentMeta))return false;}
 return geometrySignature(item.drawing)===geometrySignature(drawing);
}

export function parseDrawingSnapshots(value:unknown):DrawingSnapshots {
 const s=value as DrawingSnapshots,fail=():never=>{throw Error('绘制间快照数据无效');};
 if(!s||s.version!==1||!Array.isArray(s.items)||!Array.isArray(s.images))return fail();
 const ids=new Set<string>();const id=(v:unknown)=>{if(typeof v!=='string'||!v||ids.has(v))fail();ids.add(v as string);};
 for(const image of s.images){if(!image)return fail();id(image.id);if(typeof image.dataUrl!=='string'||image.dataUrl.length>RECORDING_REFERENCE_IMAGE.maxDataUrlLength||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl))fail();}
 const items=s.items.map(item=>{
  if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>80||!item.drawing||Object.hasOwn(item.drawing,'reference'))return fail();
  id(item.id);
  const doc=parseDrawing(snapshotDrawing(s,item.id)),{reference,...drawing}=doc;
  if(!reference)return {id:item.id,name:item.name,drawing};
  const {dataUrl,...meta}=reference;void dataUrl;
  return {id:item.id,name:item.name,drawing,reference:{...meta,imageId:item.reference!.imageId}};
 });
 if(s.activeId!==undefined&&(typeof s.activeId!=='string'||!items.some(x=>x.id===s.activeId)))return fail();
 return {version:1,...(s.activeId?{activeId:s.activeId}:{}),items,images:s.images.map(i=>({id:i.id,dataUrl:i.dataUrl}))};
}
