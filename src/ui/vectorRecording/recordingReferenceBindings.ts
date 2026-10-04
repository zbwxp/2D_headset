import type {ReferenceImage} from '../../domain/project/types';
import {matchesBackgroundState,validateRecordingReference,type ReferenceTransform} from '../../domain/recording/reference';

/** Workspace-local image alignment. These angles never create geometry views. */
export interface ReferenceAngle {x:number;y:number}
export interface RecordingReferenceBinding extends ReferenceTransform {angle:ReferenceAngle}
export interface RecordingReferenceMetadata {imageId?:string;bindings?:readonly RecordingReferenceBinding[]}

export function referenceAngleKey(angle:ReferenceAngle){
 if(!Number.isFinite(angle.x)||!Number.isFinite(angle.y))throw Error('Invalid reference binding angle');
 return JSON.stringify([angle.x,angle.y]);
}
export const copyReferenceTransform=(reference:ReferenceTransform):ReferenceTransform=>({offset:[...reference.offset],scale:reference.scale,rotation:reference.rotation,opacity:reference.opacity});
export const copyReferenceBindings=(bindings:readonly RecordingReferenceBinding[]=[])=>bindings.map(binding=>({angle:{...binding.angle},...copyReferenceTransform(binding)}));
export const referenceBindingAt=(bindings:readonly RecordingReferenceBinding[],angle:ReferenceAngle|undefined)=>angle?bindings.find(binding=>binding.angle.x===angle.x&&binding.angle.y===angle.y):undefined;
export const matchesReferenceBinding=matchesBackgroundState;

export function validateReferenceMetadata(reference:ReferenceImage|undefined,metadata:RecordingReferenceMetadata){
 if(metadata.imageId!==undefined&&(typeof metadata.imageId!=='string'||!metadata.imageId.trim()||!reference))throw Error('Invalid reference image identity');
 if(metadata.bindings===undefined)return;
 if(!Array.isArray(metadata.bindings)||metadata.bindings.length>0&&(!reference||!metadata.imageId))throw Error('Invalid reference angle bindings');
 const keys=new Set<string>();
 for(const binding of metadata.bindings){
  if(!binding?.angle)throw Error('Invalid reference angle binding');
  const key=referenceAngleKey(binding.angle);if(keys.has(key))throw Error('Duplicate reference angle binding');keys.add(key);
  validateRecordingReference({...reference!,...copyReferenceTransform(binding)});
 }
}
