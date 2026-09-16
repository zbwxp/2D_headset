import {evaluationContext} from '../geometry/evaluation';
import type {LandmarkProject} from '../landmarks/model';
import {scaffoldHostIds,scaffoldPointRelative} from './scaffold';
import {isSection} from '../curves/model';
import {cross,dot,sub,scale} from '../geometry/core';
import {sectionProvider,logicalSectionProvider} from '../curves/section';
export function curveMemberships(p:LandmarkProject,id:string){const l=p.landmarks.find(l=>l.id===id);if(l?.placement.kind!=='LOOMIS_SCAFFOLD')return [];const v=scaffoldPointRelative(p,l.placement.role);return scaffoldHostIds(l.placement.role).map(curveId=>{
 const c=p.curves.find(c=>c.id===curveId);if(!c||!isSection(c))throw Error('系统交点宿主丢失');const owner=c.role==='canonical'?c:p.curves.find(x=>x.id===c.canonicalCurveId);if(!owner||!isSection(owner)||owner.role!=='canonical')throw Error('系统环缺失');
 const q=c.role==='mirror'?[-v[0],v[1],v[2]] as typeof v:v,s=owner.section,rel=sub(q,scale(s.planeNormal,s.planeOffset));let t=Math.atan2(dot(rel,cross(s.planeNormal,s.reference)),dot(rel,s.reference))/(2*Math.PI);t=(t+1)%1;
 const lut=evaluationContext(p).curve(owner.id).arcLengthLUT(),at=t*(lut.length-1),i=Math.floor(at),length=lut[i]+(lut[Math.min(i+1,lut.length-1)]-lut[i])*(at-i);return {curveId,t,s:length/lut.at(-1)!};
 });}
