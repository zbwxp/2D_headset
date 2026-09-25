import type {ReferenceImage} from '../project/types';

export type ReferenceTransform=Pick<ReferenceImage,'offset'|'scale'|'rotation'|'opacity'>;
export interface RecordingBackgroundState extends ReferenceTransform {id:string;name:string;slot:number}
export interface RecordingReferenceImage extends ReferenceImage {
 states?:RecordingBackgroundState[];
 activeStateId?:string;
}
export const RECORDING_REFERENCE_LIMIT = 10;
export const RECORDING_REFERENCE_IMAGE = {maxDimension:4200,maxDataUrlLength:1_200_000};
const validTransform=(r:ReferenceTransform)=>[r.scale,r.rotation,r.opacity].every(Number.isFinite)&&r.scale>=.1&&r.scale<=10&&Math.abs(r.rotation)<=180&&r.opacity>=0&&r.opacity<=1&&Array.isArray(r.offset)&&r.offset.length===2&&r.offset.every(x=>Number.isFinite(x)&&Math.abs(x)<=RECORDING_REFERENCE_LIMIT);
/** Room-wide authoring image; never a view key or part of final geometry. */
export function validateRecordingReference(r:RecordingReferenceImage|undefined){
 if(r===undefined)return;
 if(!r||typeof r.name!=='string'||typeof r.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.dataUrl)||r.dataUrl.length>RECORDING_REFERENCE_IMAGE.maxDataUrlLength||
  ![r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0||Math.max(r.width,r.height)>RECORDING_REFERENCE_IMAGE.maxDimension||
  !validTransform(r)||typeof r.visible!=='boolean'||typeof r.locked!=='boolean')throw Error('录制间背景图数据无效');
 if(r.states!==undefined){
  if(!Array.isArray(r.states))throw Error('录制间背景状态无效');
  const ids=new Set<string>(),slots=new Set<number>();
  for(const s of r.states){if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!Number.isSafeInteger(s.slot)||s.slot<0||slots.has(s.slot)||typeof s.name!=='string'||!s.name.trim()||!validTransform(s))throw Error('录制间背景状态无效');ids.add(s.id);slots.add(s.slot);}
 }
 if(r.activeStateId!==undefined&&(typeof r.activeStateId!=='string'||!r.states?.some(s=>s.id===r.activeStateId)))throw Error('录制间背景状态无效');
}
const snapshot=(r:ReferenceTransform):ReferenceTransform=>({offset:[...r.offset],scale:r.scale,rotation:r.rotation,opacity:r.opacity});
export const matchesBackgroundState=(r:ReferenceTransform,s:ReferenceTransform)=>r.scale===s.scale&&r.rotation===s.rotation&&r.opacity===s.opacity&&r.offset.every((x,i)=>x===s.offset[i]);
export function saveBackgroundState(r:RecordingReferenceImage,id:string,name:string,slot?:number):RecordingReferenceImage {
 name=name.trim();if(!name||!id||r.states?.some(s=>s.id===id))return r;
 if(slot===undefined){slot=0;while(r.states?.some(s=>s.slot===slot))slot++;}
 if(!Number.isSafeInteger(slot)||slot<0||r.states?.some(s=>s.slot===slot))return r;
 return {...r,states:[...(r.states??[]),{id,name,slot,...snapshot(r)}],activeStateId:id};
}
export function applyBackgroundState(r:RecordingReferenceImage,id:string):RecordingReferenceImage {
 const state=r.states?.find(s=>s.id===id);if(!state||r.activeStateId===id&&matchesBackgroundState(r,state))return r;
 // Explicit preset navigation is permitted while manual image transforms are locked.
 return {...r,...snapshot(state),activeStateId:id};
}
export function updateBackgroundState(r:RecordingReferenceImage,id:string):RecordingReferenceImage {
 const state=r.states?.find(s=>s.id===id);if(!state||matchesBackgroundState(r,state))return r;
 return {...r,states:r.states!.map(s=>s===state?{...s,...snapshot(r)}:s)};
}
export function renameBackgroundState(r:RecordingReferenceImage,id:string,name:string):RecordingReferenceImage {
 name=name.trim();const state=r.states?.find(s=>s.id===id);if(!state||!name||name===state.name)return r;
 return {...r,states:r.states!.map(s=>s===state?{...s,name}:s)};
}
export function deleteBackgroundState(r:RecordingReferenceImage,id:string):RecordingReferenceImage {
 if(!r.states?.some(s=>s.id===id))return r;
 return {...r,states:r.states.filter(s=>s.id!==id),...(r.activeStateId===id?{activeStateId:undefined}:{})};
}
export const clampReferenceOffset=(x:number)=>Math.max(-RECORDING_REFERENCE_LIMIT,Math.min(RECORDING_REFERENCE_LIMIT,x));
/** Same 2.6-unit image size as the modeling viewport; yaw never warps the photo. */
export function recordingReferenceLayout(r:ReferenceImage,width:number,height:number,zoom:number,pan:[number,number]){
 const unit=Math.min(width,height)/2.8*zoom,max=Math.max(r.width,r.height);
 return {unit,width:r.width/max*2.6*unit*r.scale,height:r.height/max*2.6*unit*r.scale,
  x:width/2+pan[0]+r.offset[0]*unit,y:height/2+pan[1]-r.offset[1]*unit};
}
