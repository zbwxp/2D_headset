import {ballCoordVector} from './coord';
import {Quaternion,Vector3} from 'three';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {eyeballCenter} from './scaffold';
import {add,scale} from '../geometry/core';
import {rotateFrame} from '../head/frame';
export type EyeSource=Pick<LandmarkProject,'headFrame'|'eyeScaffold'|'gazeEyeball'>;
export const gazeFacing=(q:readonly number[]):Vec3=>new Vector3(0,0,1).applyQuaternion(new Quaternion(...q as [number,number,number,number]).normalize()).toArray();
/** Scale HeadFrame-local yaw/pitch, never the already-solved per-eye rotation. */
export function gazeTargetDirection(p:EyeSource,facing:Vec3):Vec3{
 const f=p.headFrame!,strength=p.gazeEyeball?.followStrength??1;
 const local=rotateFrame(facing,f,true),horizontal=Math.hypot(local[0],local[2]);
 const sourceYaw=horizontal<1e-10?0:Math.atan2(local[0],local[2]);
 const yaw=Math.max(-Math.PI/4,Math.min(Math.PI/4,sourceYaw))*strength,pitch=Math.atan2(local[1],horizontal)*strength;
 return rotateFrame([Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)],f);
}
/** View-derived only: one target, independently solved centers, no source mutation. */
export function gazePose(p:EyeSource,side:'left'|'right',facing?:Vec3){
 const f=p.headFrame!,q=p.eyeScaffold!.parameters;
 const center=add(f.center,rotateFrame(scale(eyeballCenter(q,side),f.radiusX),f));
 const base=rotateFrame(ballCoordVector(p,side,[0,0,1]),f),target=facing?add(f.center,scale(gazeTargetDirection(p,facing),(p.gazeEyeball?.viewDistance??50)*f.radiusX)):add(center,base);
 const rotation=new Quaternion();
 if(facing&&p.gazeEyeball&&p.gazeEyeball.tracking!==false)rotation.setFromUnitVectors(new Vector3(...base).normalize(),new Vector3(...target).sub(new Vector3(...center)).normalize());
 const transform=(v:Vec3):Vec3=>new Vector3(...v).sub(new Vector3(...center)).applyQuaternion(rotation).add(new Vector3(...center)).toArray();
 return {center,target,rotation,transform};
}
/** Scaffold is displayed by the view-derived eye layer (including cylinder). */
export function gazeGuide(p:EyeSource,id:string){if(!p.eyeScaffold)return false;return (['left','right'] as const).some(side=>p.eyeScaffold![side].pointIds.includes(id)||p.eyeScaffold![side].curveIds.includes(id)||p.eyeScaffold![side].frontCurveIds?.includes(id));}
