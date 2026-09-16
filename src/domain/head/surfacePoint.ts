import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {toRelative,rotateFrame} from './frame';
import {add,scale,dot} from '../geometry/core';
export function unitDirection(v:Vec3):Vec3 {const n=Math.hypot(...v);if(!v.every(Number.isFinite)||n<1e-12)throw Error('球面方向无效');return scale(v,1/n);}
/** Solve a normalized sphere quadratic after inverse frame transform. No display mesh input. */
export function intersectLoomis(p:LandmarkProject,origin:Vec3,direction:Vec3):Vec3|null {
 const f=p.headFrame;if(!f)throw Error('缺少 Loomis HeadFrame');
 const o=toRelative(p,origin),rot=rotateFrame(direction,f,true),d:Vec3=[rot[0]/f.radiusX,rot[1]/f.radiusY,rot[2]/f.radiusZ];
 const a=dot(d,d),b=dot(o,d),c=dot(o,o)-1;if(!Number.isFinite(a)||a<1e-24)return null;
 const disc=b*b-a*c,tolerance=1e-12*Math.max(1,b*b,Math.abs(a*c));if(disc< -tolerance)return null;
 const root=Math.sqrt(Math.max(0,disc)),q=-b-(b>=0?root:-root),roots=q===0?[-b/a]:[q/a,c/q];
 const t=roots.filter(t=>Number.isFinite(t)&&t>=-1e-10).sort((a,b)=>a-b)[0];return t===undefined?null:unitDirection(add(o,scale(d,Math.max(0,t))));
}
export function setSurfaceDirection(p:LandmarkProject,id:string,direction:Vec3):LandmarkProject {
 const l=p.landmarks.find(x=>x.id===id);if(l?.placement.kind!=='ON_LOOMIS_SURFACE'||!p.headFrame)throw Error('请选择 Loomis 面上点');
 const d=unitDirection(l.type==='CENTERLINE'?[0,direction[1],direction[2]]:direction);
 return {...p,landmarks:p.landmarks.map(x=>x.id===l.id?{...x,placement:{...x.placement,kind:'ON_LOOMIS_SURFACE',hostFrameId:'head',direction:d}}:x.id===l.mirrorPartnerId?{...x,placement:{...x.placement,kind:'ON_LOOMIS_SURFACE',hostFrameId:'head',direction:[-d[0],d[1],d[2]]}}:x)};
}
export function addSurfacePoint(p:LandmarkProject,direction:Vec3,centerline=false){
 if(!p.headFrame)throw Error('缺少 Loomis HeadFrame');const d=unitDirection(centerline?[0,direction[1],direction[2]]:direction),id=crypto.randomUUID(),partner=crypto.randomUUID(),n=p.landmarks.filter(l=>l.placement.kind==='ON_LOOMIS_SURFACE').length+1;
 const point=(id:string,d:Vec3,type:SemanticLandmark['type'],mirrorPartnerId?:string):SemanticLandmark=>({id,name:(type==='CENTERLINE'?'中线':type==='RIGHT'?'右':'左')+'球面定位点 '+n,type,placement:{kind:'ON_LOOMIS_SURFACE',hostFrameId:'head',direction:d},viewLocks:{},...(mirrorPartnerId?{mirrorPartnerId}:{})});
 const side=d[0]<0?'LEFT':'RIGHT';return {selectedId:id,project:{...p,landmarks:[...p.landmarks,...(centerline?[point(id,d,'CENTERLINE')]:[point(id,d,side,partner),point(partner,[-d[0],d[1],d[2]],side==='RIGHT'?'LEFT':'RIGHT',id)])],centerlineOrder:centerline?[...p.centerlineOrder,id]:p.centerlineOrder}};
}
