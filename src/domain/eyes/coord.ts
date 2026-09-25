import {Euler,Quaternion,Vector3} from 'three';
import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {CurveEdge} from '../curves/model';
import {rotateFrame} from '../head/frame';
import {add,scale,sub} from '../geometry/core';
import {deleteClosure} from '../geometry/dependencies';
export interface EyeCoord {version:1;position?:Vec3;width:number;height:number;tilt:number;orientation:Vec3;left:{points:string[];curves:string[]};right:{points:string[];curves:string[]}}
const defaults:Vec3[]=[[-.5,0,.22],[.5,.08,.22],[-.25,.65,.24],[.25,.7,.24],[-.25,-.45,.24],[.25,-.4,.24]];
export function coordVector(p:Pick<LandmarkProject,'eyeScaffold'>,side:'left'|'right',v:Vec3,inverse=false):Vec3{
 const q=p.eyeScaffold?.coord,o=q?.orientation??[0,0,0],rotation=new Quaternion().setFromEuler(new Euler(...o.map(a=>a*Math.PI/180) as Vec3,'XYZ'));
 const a=new Vector3(...v);if(inverse){if(side==='left')a.x=-a.x;a.applyQuaternion(rotation.invert());}else{a.applyQuaternion(rotation);if(side==='left')a.x=-a.x;}return a.toArray();
}
/** Proper mirrored rotation, preserving legacy ball parameterization at identity. */
export function ballCoordVector(p:Pick<LandmarkProject,'eyeScaffold'>,side:'left'|'right',v:Vec3):Vec3{const e=p.eyeScaffold;return coordVector({eyeScaffold:e?{...e,coord:e.coord?{...e.coord,orientation:e.ballOrientation??e.coord.orientation}:undefined}:undefined},side,side==='left'?[-v[0],v[1],v[2]]:v);}
export function lidCenter(p:Pick<LandmarkProject,'eyeScaffold'>,side:'left'|'right'):Vec3{const e=p.eyeScaffold!,v=e.coord?.position??[e.parameters.x,e.parameters.y,e.parameters.z];return [(side==='left'?-1:1)*v[0],v[1],v[2]];}
/** Freeze the former shared transform once, preserving the displayed geometry. */
export function independentEyeFrames(p:LandmarkProject):LandmarkProject{const e=p.eyeScaffold;if(!e?.coord||e.coord.position&&e.ballOrientation&&e.perspectiveOrigin)return p;return {...p,eyeScaffold:{...e,coord:{...e.coord,position:e.coord.position??[e.parameters.x,e.parameters.y,e.parameters.z]},ballOrientation:e.ballOrientation??[...e.coord.orientation],perspectiveOrigin:e.perspectiveOrigin??[e.parameters.x,e.parameters.y,e.parameters.z]}};}
export function eyeLocalPosition(p:LandmarkProject,side:'left'|'right',local:Vec3):Vec3{
 const f=p.headFrame!,e=p.eyeScaffold!,q=e.coord!,a=q.tilt*Math.PI/180,x=local[0]*q.width,y=local[1]*q.height;
 const v=coordVector(p,side,[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a),local[2]]),center=lidCenter(p,side);
 return add(f.center,rotateFrame(scale(add(center,v),f.radiusX),f));
}
export function setEyeLocal(p:LandmarkProject,id:string,local:Vec3):LandmarkProject{
 const l=p.landmarks.find(x=>x.id===id);if(l?.placement.kind!=='EYE_LOCAL'||!local.every(Number.isFinite))return p;
 return {...p,landmarks:p.landmarks.map(x=>(x.id===id||x.id===l.mirrorPartnerId)&&x.placement.kind==='EYE_LOCAL'?{...x,placement:{...x.placement,local:[...local]}}:x)};
}
export function moveEyeLocal(p:LandmarkProject,id:string,world:Vec3):LandmarkProject{
 const l=p.landmarks.find(x=>x.id===id);if(l?.placement.kind!=='EYE_LOCAL')return p;
 const e=p.eyeScaffold!,q=e.coord!,f=p.headFrame!,side=l.placement.side,head=scale(rotateFrame(sub(world,f.center),f,true),1/f.radiusX),v=coordVector(p,side,sub(head,lidCenter(p,side)),true),a=q.tilt*Math.PI/180;
 return setEyeLocal(p,id,[(v[0]*Math.cos(a)+v[1]*Math.sin(a))/q.width,(-v[0]*Math.sin(a)+v[1]*Math.cos(a))/q.height,v[2]]);
}
/** Explicit source migration: remove the retired cylinder's full dependency closure. */
export function migrateEyeCoord(p:LandmarkProject):LandmarkProject{
 const e=p.eyeScaffold;if(!e||e.coord)return p;
 const next=deleteClosure(p,(['left','right'] as const).flatMap(side=>{const a=e[side];return [...a.pointIds.slice(0,8).map(id=>`point:${id}` as const),...a.curveIds.slice(0,12).map(id=>`curve:${id}` as const),...(a.frontCurveIds??[]).map(id=>`curve:${id}` as const)];}));
 const member=()=>({points:Array.from({length:6},()=>crypto.randomUUID()),curves:Array.from({length:2},()=>crypto.randomUUID())});
 const coord:EyeCoord={version:1,width:.5,height:.24,tilt:0,orientation:[0,0,0],left:member(),right:member()};
 const points:SemanticLandmark[]=[],curves:CurveEdge[]=[];const names=['内眼角','外眼角','上睑控制点 A','上睑控制点 B','下睑控制点 A','下睑控制点 B'];
 for(const side of ['left','right'] as const){const m=coord[side],other=coord[side==='left'?'right':'left'];for(let i=0;i<6;i++)points.push({id:m.points[i],name:(side==='left'?'左':'右')+names[i],type:side==='left'?'LEFT':'RIGHT',mirrorPartnerId:other.points[i],viewLocks:{},placement:{kind:'EYE_LOCAL',side,local:[...defaults[i]]}});
 for(let i=0;i<2;i++)curves.push({id:m.curves[i],name:(side==='left'?'左':'右')+(i?'下眼睑':'上眼睑'),geometryType:'CONTROL_POINTS',startLandmarkId:m.points[0],endLandmarkId:m.points[1],controlPointIds:[m.points[2+i*2],m.points[3+i*2]],role:'canonical',mirrorPartnerCurveId:other.curves[i],contourRole:'OPEN_EDGE'});
 }
 return {...next,eyeScaffold:{...e,coord,parameters:{...e.parameters,x:e.parameters.x+e.parameters.ballOffsetX,ballOffsetX:0},left:{...e.left,frontCurveIds:undefined},right:{...e.right,frontCurveIds:undefined}},landmarks:[...next.landmarks,...points],curves:[...next.curves,...curves],geometryModules:{...next.geometryModules,...Object.fromEntries([...points,...curves].map(x=>[x.id,'EYES' as const]))}};
}
export function parseEyeCoord(raw:unknown):EyeCoord|undefined{
 if(raw===undefined)return;const q=raw as EyeCoord;
 if(q?.position&&(!Array.isArray(q.position)||q.position.length!==3||!q.position.every(Number.isFinite)))throw Error('Invalid EyeCoord position');
 if(!q||q.version!==1||![q.width,q.height,q.tilt,...(q.orientation??[])].every(Number.isFinite)||q.width<=0||q.height<=0||q.orientation?.length!==3)throw Error('Invalid EyeCoord');
 const ids=new Set<string>();for(const side of ['left','right'] as const){const m=q[side];if(m?.points?.length!==6||m.curves?.length!==2)throw Error('Invalid EyeCoord identities');for(const id of [...m.points,...m.curves]){if(typeof id!=='string'||! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)||ids.has(id))throw Error('Invalid EyeCoord identity');ids.add(id);}}
 return structuredClone(q);
}
