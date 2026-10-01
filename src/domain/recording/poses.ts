import {parseDrawing,finitePoint,type DrawingDocument,type Point2} from '../drawing/model';
import type {DrawingSnapshot,DrawingSnapshots} from '../drawing/snapshots';
import type {View} from './model';
import {parsePoseInferences,type PoseInference} from './poseInference';

/** Snapshot-linked poses. drawing is the last resolved content, also retained
 * when the source snapshot is deleted. Angles/placement belong to Recording. */
export interface RecordedPose extends View {
 id:string;name:string;sourceSnapshotId:string;offset:Point2;
 drawing:Omit<DrawingDocument,'reference'>;
}
export interface PoseRecording {version:1;poses:RecordedPose[];inferences?:PoseInference[];/** Display-only HeadSet alignment scale, shared by all views. */referenceScale?:number}
export const emptyPoseRecording=():PoseRecording=>({version:1,poses:[]});
/** Resolve immutable snapshot content once per source/record change, not per
 * view frame. Missing sources keep their last content; no implicit deletion. */
export function syncPoseSnapshots(r:PoseRecording,library?:DrawingSnapshots):PoseRecording {
 if(!library||!r.poses.length)return r;
 const sources=new Map(library.items.map(s=>[s.id,s.drawing]));let changed=false;
 const poses=r.poses.map(p=>{const drawing=sources.get(p.sourceSnapshotId);if(!drawing||drawing===p.drawing)return p;changed=true;return {...p,drawing};});
 return changed?{...r,poses}:r;
}
export const samePoseView=(a:View,b:View)=>Math.abs(a.yaw-b.yaw)<=1e-6&&Math.abs(a.pitch-b.pitch)<=1e-6;
const validView=(v:View)=>[v.yaw,v.pitch].every(Number.isFinite)&&Math.abs(v.yaw)<=180&&Math.abs(v.pitch)<=89;
export function recordSnapshot(r:PoseRecording,s:DrawingSnapshot,view:View,replaceId?:string):PoseRecording {
 if(!validView(view))throw Error('录制角度超出范围。');
 if(r.poses.some(p=>p.id!==replaceId&&samePoseView(p,view)))throw Error('此视角已有姿态，请选择替换此视角。');
 const previous=r.poses.find(p=>p.id===replaceId);
 if(replaceId&&!previous)throw Error('录制姿态不存在。');
 const pose:RecordedPose={id:previous?.id??crypto.randomUUID(),name:s.name,sourceSnapshotId:s.id,...view,offset:previous?.offset??[0,0],drawing:structuredClone(s.drawing)};
 return {...r,poses:previous?r.poses.map(p=>p===previous?pose:p):[...r.poses,pose]};
}
export function changePose(r:PoseRecording,id:string,change:Partial<Pick<RecordedPose,'name'|'yaw'|'pitch'|'offset'>>):PoseRecording {
 const old=r.poses.find(p=>p.id===id);if(!old)return r;
 const pose={...old,...change};
 if(!validView(pose)||!finitePoint(pose.offset))throw Error('录制角度或平移无效。');
 if(!pose.name.trim())throw Error('请输入姿态名称。');
 if(r.poses.some(p=>p.id!==id&&samePoseView(p,pose)))throw Error('此视角已有姿态，请选择其它角度。');
 return {...r,poses:r.poses.map(p=>p===old?pose:p)};
}
export function parsePoseRecording(value:unknown):PoseRecording {
 const r=value as PoseRecording,ids=new Set<string>();
 if(!r||r.version!==1||!Array.isArray(r.poses))throw Error('快照录制数据无效。');
 if(r.referenceScale!==undefined&&(!Number.isFinite(r.referenceScale)||r.referenceScale<.1||r.referenceScale>5))throw Error('头壳参考大小无效。');
 const poses=r.poses.map((p,i)=>{
  if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||typeof p.sourceSnapshotId!=='string'||!p.sourceSnapshotId||!validView(p)||!finitePoint(p.offset)||r.poses.slice(0,i).some(x=>samePoseView(x,p)))throw Error('快照录制数据无效。');
  ids.add(p.id);const {reference,...drawing}=parseDrawing(p.drawing);void reference;
  return {...p,offset:[...p.offset] as Point2,drawing};
 });
 return {version:1,...(r.referenceScale!==undefined?{referenceScale:r.referenceScale}:{}),poses,...(r.inferences!==undefined?{inferences:parsePoseInferences(r.inferences,poses)}:{})};
}
