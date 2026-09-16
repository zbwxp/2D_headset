import {toRelative,mirrorVector} from '../head/frame';
import type {LoomisSectionGeometry,SectionCurve} from './model';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {add,scale,cross,dot} from '../geometry/core';
import {toHead,rotateFrame,migrateHeadFrame} from '../head/frame';
import {provider} from '../geometry/curveProvider';
export function validateSection(s:LoomisSectionGeometry){
 if(!s||s.hostFrameId!=='head'||!Number.isFinite(s.planeOffset)||Math.abs(s.planeOffset)>=1)throw Error('Section 平面必须满足 |Offset| < 1；相切或无交线不能创建。');
 for(const v of [s.planeNormal,s.reference])if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||Math.abs(Math.hypot(...v)-1)>1e-7)throw Error('Section 平面方向或起点参考无效。');
 if(Math.abs(dot(s.planeNormal,s.reference))>1e-7)throw Error('Section 起点参考必须位于平面内。');
}
export function sectionProvider(p:LandmarkProject,s:LoomisSectionGeometry){
 validateSection(s);const n=s.planeNormal,u=s.reference,v=cross(n,u),r=Math.sqrt(1-s.planeOffset*s.planeOffset),center=scale(n,s.planeOffset);
 const vector=(q:Vec3)=>p.headFrame?rotateFrame([q[0]*p.headFrame.radiusX,q[1]*p.headFrame.radiusY,q[2]*p.headFrame.radiusZ],p.headFrame):q;
 return provider(JSON.stringify([s,p.headFrame]),true,t=>{const a=(t-Math.floor(t))*Math.PI*2;return toHead(p,add(center,scale(add(scale(u,Math.cos(a)),scale(v,Math.sin(a))),r)));},t=>{const a=t*Math.PI*2;return vector(scale(add(scale(u,-Math.sin(a)),scale(v,Math.cos(a))),r*Math.PI*2));});
}
/** Plane angles have a stable analytic reference, independent of frame size. */
export function sectionFromAngles(x:number,y:number,d:number):LoomisSectionGeometry {
 const a=x*Math.PI/180,b=y*Math.PI/180;
 return {hostFrameId:'head',planeOffset:d,planeNormal:[Math.sin(b)*Math.cos(a),-Math.sin(a)||0,Math.cos(b)*Math.cos(a)],reference:[Math.cos(b),0,-Math.sin(b)||0]};
}
export function sectionAngles(s:LoomisSectionGeometry){return {x:Math.asin(Math.max(-1,Math.min(1,-s.planeNormal[1])))*180/Math.PI,y:Math.atan2(-s.reference[2],s.reference[0])*180/Math.PI};}
export function createSection(p:LandmarkProject,centerline=false){
 if(!p.headFrame)p=migrateHeadFrame(p);
 const id=crypto.randomUUID(),other=crypto.randomUUID(),name=centerline?'Loomis 中线剖面':'Loomis Section';
 const c:SectionCurve={id,name:centerline?name:'右'+name,geometryType:'LOOMIS_SECTION',side:centerline?'CENTERLINE':'RIGHT',role:'canonical',section:centerline?{hostFrameId:'head',planeNormal:[1,0,0],planeOffset:0,reference:[0,1,0]}:sectionFromAngles(0,35,.25),...(!centerline?{mirrorPartnerCurveId:other}:{})};
 const curves=[...p.curves,c];if(!centerline)curves.push({id:other,name:'左'+name,geometryType:'LOOMIS_SECTION',side:'LEFT',role:'mirror',canonicalCurveId:id,mirrorPartnerCurveId:id});
 return {project:{...p,curves},selectedId:id};
}

/** A logical ring evaluates a right half and the reversed reflected half, sharing endpoints. */
export function logicalSectionProvider(p:LandmarkProject,c:Extract<SectionCurve,{role:'canonical'}>){
 const g=sectionProvider(p,c.section);if(!c.logicalRing)return g;
 const reflect=(v:Vec3)=>{const q=toRelative(p,v);return toHead(p,[-q[0],q[1],q[2]]);};
 return provider(g.key+':'+c.logicalRing,true,t=>{t=(t%1+1)%1;return t<=.5?g.evaluate(t):reflect(g.evaluate(1-t));},t=>{t=(t%1+1)%1;return t<=.5?g.derivative(t):scale(mirrorVector(p,g.derivative(1-t)),-1);});
}
