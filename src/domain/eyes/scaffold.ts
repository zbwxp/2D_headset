import {independentEyeFrames,ballCoordVector,parseEyeCoord,type EyeCoord} from './coord';
import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {BezierCurve} from '../curves/model';
import type {Vec3} from '../project/types';
import {rotateFrame} from '../head/frame';
import {add,sub,scale,dot,cross,normalize} from '../geometry/core';
export interface EyeParameters {x:number;y:number;z:number;radiusX:number;radiusZ:number;height:number;ballX:number;ballY:number;ballZ:number;ballOffsetX:number}
export interface EyeConstruction {pointIds:string[];curveIds:string[];frontCurveIds?:string[]}
export interface EyeScaffold {ballOrientation?:Vec3;perspectiveOrigin?:Vec3;coord?:EyeCoord;perspective?:{x:number;y:number};version:2;parameters:EyeParameters;left:EyeConstruction;right:EyeConstruction}
export const EYE_DEFAULTS:EyeParameters={x:.5,y:-.3665315937744661,z:.5911634322080732,radiusX:.25,radiusZ:.25,height:.7,ballX:.25,ballY:.25,ballZ:.25,ballOffsetX:0};
export function eyeballCenter(q:EyeParameters,side:'left'|'right'):Vec3{return [(side==='left'?-1:1)*(q.x+(q.ballOffsetX??0)),q.y,q.z];}
export function eyeSide(p:LandmarkProject,id:string):'left'|'right'|undefined {return (['left','right'] as const).find(side=>p.eyeScaffold?.[side].pointIds.includes(id)||p.eyeScaffold?.[side].curveIds.includes(id)||p.eyeScaffold?.[side].frontCurveIds?.includes(id));}
export function createEyeScaffold(p:LandmarkProject):LandmarkProject {
 if(p.eyeScaffold)return p;
 const eye=():EyeConstruction=>({pointIds:Array.from({length:23},()=>crypto.randomUUID()),curveIds:Array.from({length:25},()=>crypto.randomUUID())});
 return rebuildEyeScaffold({...p,eyeScaffold:{version:2,perspective:{x:.234422041418454,y:0},parameters:{...EYE_DEFAULTS},left:eye(),right:eye()}});
}
export function parseEyeScaffold(value:unknown):EyeScaffold|undefined {
 if(value===undefined)return;
 const s=value as EyeScaffold & {left:EyeConstruction & {parameters?:EyeParameters};right:EyeConstruction & {parameters?:EyeParameters}},ids=new Set<string>();
 if(!s||![1,2].includes(s.version))throw Error('Invalid Eye Scaffold');
 // V1 stored independent sides. Adopt the right eye as canonical, retaining all IDs.
 const raw=s.version===2?s.parameters:s.right?.parameters;
 const q=raw?{...raw,ballOffsetX:raw.ballOffsetX??0}:undefined;
 if(!q)throw Error('Invalid Eye parameter');
 for(const k of Object.keys(EYE_DEFAULTS) as (keyof EyeParameters)[])if(!Number.isFinite(q[k])||(!['x','y','z','ballOffsetX'].includes(k)&&q[k]<=.001))throw Error('Invalid Eye parameter');
 const parameters=Object.fromEntries(Object.keys(EYE_DEFAULTS).map(k=>[k,q[k as keyof EyeParameters]])) as unknown as EyeParameters;
 if(!s.coord)parameters.x=Math.abs(parameters.x);
 const members={} as Record<'left'|'right',EyeConstruction>;
 for(const side of ['left','right'] as const){const e=s[side];if(!e||!Array.isArray(e.pointIds)||e.pointIds.length!==23||!Array.isArray(e.curveIds)||e.curveIds.length!==25)throw Error('Invalid Eye Scaffold');
 if(e.frontCurveIds&&(!Array.isArray(e.frontCurveIds)||e.frontCurveIds.length!==2))throw Error("Invalid Eye front arcs");
 for(const id of [...e.pointIds,...e.curveIds,...(e.frontCurveIds??[])]){if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)||ids.has(id))throw Error('Invalid Eye identity');ids.add(id);}
 members[side]={pointIds:[...e.pointIds],curveIds:[...e.curveIds],...(e.frontCurveIds?{frontCurveIds:[...e.frontCurveIds]}:{})};}
 const perspective=s.perspective??{x:0,y:0};
 if(![perspective.x,perspective.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error("Invalid Eye perspective");
 const coord=parseEyeCoord(s.coord);if(coord&&!coord.position)coord.position=[parameters.x,parameters.y,parameters.z];
 for(const v of [s.ballOrientation,s.perspectiveOrigin])if(v!==undefined&&(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))throw Error('Invalid eye transform');
 return {version:2,ballOrientation:s.ballOrientation??(coord?[...coord.orientation]:undefined),perspectiveOrigin:s.perspectiveOrigin??(coord?[parameters.x,parameters.y,parameters.z]:undefined),coord,parameters,perspective:{x:perspective.x,y:perspective.y},...members};
}

/** Construction guides use ordinary cubic geometry, with stable topology. Quarter ellipses use kappa. */
export function rebuildEyeScaffold(p:LandmarkProject):LandmarkProject {
 p=independentEyeFrames(p);const scaffold=p.eyeScaffold,f=p.headFrame;if(!scaffold||!f)return p;
 const points:SemanticLandmark[]=[],curves:BezierCurve[]=[],kappa=4*(Math.sqrt(2)-1)/3;
 for(const side of ['left','right'] as const){const e=scaffold[side],q=scaffold.parameters,R=f.radiusX,center:Vec3=[(side==='left'?-1:1)*q.x,q.y,q.z];let pi=0,ci=0;const positions=new Map<string,Vec3>();
 const world=(v:Vec3)=>{if(scaffold.coord){const c=eyeballCenter(q,side);v=add(c,ballCoordVector(p,side,sub(v,c)));}return add(f.center,rotateFrame(scale(v,R),f));};
 const point=(v:Vec3,name:string)=>{const id=e.pointIds[pi++];positions.set(id,world(v));points.push({id,name:`${side==='left'?'左':'右'}眼 · ${name}`,type:'FREE',viewLocks:{},placement:{kind:'FRAME_RELATIVE',position:(()=>{const w=rotateFrame(sub(world(v),f.center),f,true);return [w[0]/f.radiusX,w[1]/f.radiusY,w[2]/f.radiusZ] as Vec3;})()}});return id;};
 const curve=(a:string,b:string,h0:Vec3,h1:Vec3,n:Vec3,name:string)=>{const av=positions.get(a)!,bv=positions.get(b)!,chord=sub(bv,av),L=Math.hypot(...chord),d=normalize(chord),normal=rotateFrame(scaffold.coord?ballCoordVector(p,side,n):n,f),lateral=normalize(cross(normal,d));const handle=(v:Vec3,end:boolean)=>{const delta=sub(world(v),end?bv:av);return {along:dot(delta,d)/L*(end?-1:1),offset:dot(delta,lateral)/L};};curves.push({id:e.curveIds[ci++],name:`${side==='left'?'左':'右'}眼 · ${name}`,startLandmarkId:a,endLandmarkId:b,role:'canonical',contourRole:'NONE',shape:{planeNormal:normal,startHandle:handle(h0,false),endHandle:handle(h1,true)}});};
 const ellipse=(c:Vec3,u:Vec3,v:Vec3,name:string)=>{const pos=Array.from({length:4},(_,i)=>add(c,add(scale(u,Math.cos(i*Math.PI/2)),scale(v,Math.sin(i*Math.PI/2)))));const ids=pos.map((p,i)=>point(p,`${name} ${i+1}`));for(let i=0;i<4;i++){const a=i*Math.PI/2,b=(i+1)*Math.PI/2,tangent=(t:number)=>add(scale(u,-Math.sin(t)),scale(v,Math.cos(t)));curve(ids[i],ids[(i+1)%4],add(pos[i],scale(tangent(a),kappa)),sub(pos[(i+1)%4],scale(tangent(b),kappa)),normalize(cross(u,v)),`${name} ${i+1}`);}return {pos,ids};};
 if(!scaffold.coord){const top=ellipse(add(center,[0,q.height/2,0]),[q.radiusX,0,0],[0,0,q.radiusZ],'柱体上环'),bottom=ellipse(add(center,[0,-q.height/2,0]),[q.radiusX,0,0],[0,0,q.radiusZ],'柱体下环');
 for(let i=0;i<4;i++){const a=top.pos[i],b=bottom.pos[i];curve(top.ids[i],bottom.ids[i],add(a,scale(sub(b,a),1/3)),add(a,scale(sub(b,a),2/3)),[1,0,0],`柱体母线 ${i+1}`);}
 for(const [i,id] of (e.frontCurveIds??[]).entries()){const a=(i?bottom:top),normal=rotateFrame([0,-1,0],f);curves.push({id,name:`${side==='left'?'左':'右'}眼 · 柱体前半环 ${i+1}`,startLandmarkId:a.ids[0],endLandmarkId:a.ids[2],role:'canonical',contourRole:'NONE',shape:{planeNormal:normal,startHandle:{along:0,offset:2/3},endHandle:{along:0,offset:2/3}}});}
 }else{pi=8;ci=12;}
 const ballCenter=eyeballCenter(q,side);
 ellipse(ballCenter,[q.ballX,0,0],[0,q.ballY,0],'眼球 XY');ellipse(ballCenter,[q.ballX,0,0],[0,0,q.ballZ],'眼球 XZ');ellipse(ballCenter,[0,q.ballY,0],[0,0,q.ballZ],'眼球 YZ');
 point(center,'中心');const a=add(center,[0,-q.height/2,0]),b=add(center,[0,q.height/2,0]),aid=point(a,'轴底'),bid=point(b,'轴顶');curve(aid,bid,add(a,scale(sub(b,a),1/3)),add(a,scale(sub(b,a),2/3)),[1,0,0],'竖直中轴');

 if(pi!==23||ci!==25)throw Error('Eye topology mismatch');
 }
 const ids=new Set([...scaffold.left.pointIds,...scaffold.right.pointIds,...scaffold.left.curveIds,...scaffold.right.curveIds,...(scaffold.left.frontCurveIds??[]),...(scaffold.right.frontCurveIds??[])]);
 return {...p,landmarks:[...p.landmarks.filter(l=>!ids.has(l.id)),...points],curves:[...p.curves.filter(c=>!ids.has(c.id)),...curves],geometryModules:{...p.geometryModules,...Object.fromEntries([...ids].map(id=>[id,'EYES' as const]))}};
}

/** Identity mapping for the cylinder scaffold, whose two source sides are generated
 * from shared parameters rather than ordinary FREE-point mirror records. */
export function eyeCylinderMirror(p:LandmarkProject,id:string):string|undefined{
 const e=p.eyeScaffold;if(!e)return;
 for(const side of ['left','right'] as const){const a=e[side],b=e[side==='left'?'right':'left'];
  const front=a.frontCurveIds?.indexOf(id)??-1;if(front>=0)return b.frontCurveIds?.[front];
  const point=a.pointIds.indexOf(id);if(point>=0&&point<8)return b.pointIds[Math.floor(point/4)*4+[2,1,0,3][point%4]];
  const curve=a.curveIds.indexOf(id);if(curve>=0&&curve<8)return b.curveIds[Math.floor(curve/4)*4+[1,0,3,2][curve%4]];
  if(curve>=8&&curve<12)return b.curveIds[8+[2,1,0,3][curve-8]];
 }
}
