import type {LandmarkProject,PointPlacement} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {add,sub,scale,dot,cross} from '../geometry/core';
export interface HeadFrame {center:Vec3;orientation:[number,number,number,number];radiusX:number;radiusY:number;radiusZ:number}
export const defaultHeadFrame=():HeadFrame=>({center:[0,.2,-.08],orientation:[0,0,0,1],radiusX:1,radiusY:1.05,radiusZ:1.05});
export function rotateFrame(v:Vec3,f:HeadFrame,inverse=false):Vec3 {const [x,y,z,w]=f.orientation,q:Vec3=inverse?[-x,-y,-z]:[x,y,z];const t=scale(cross(q,v),2);return add(v,add(scale(t,w),cross(q,t)));}
export function toHead(p:LandmarkProject,v:Vec3):Vec3 {const f=p.headFrame;if(!f)return v;return add(f.center,rotateFrame([v[0]*f.radiusX,v[1]*f.radiusY,v[2]*f.radiusZ],f));}
export function toRelative(p:LandmarkProject,v:Vec3):Vec3 {const f=p.headFrame;if(!f)return v;const q=rotateFrame(sub(v,f.center),f,true);return [q[0]/f.radiusX,q[1]/f.radiusY,q[2]/f.radiusZ];}
export function symmetryNormal(p:LandmarkProject):Vec3{return p.headFrame?rotateFrame([1,0,0],p.headFrame):[1,0,0];}
export function mirrorVector(p:LandmarkProject,v:Vec3):Vec3 {const n=symmetryNormal(p);if(n[0]===1&&n[1]===0&&n[2]===0)return [-v[0],v[1],v[2]];return sub(v,scale(n,2*dot(n,v)));}
export function mirrorPoint(p:LandmarkProject,v:Vec3):Vec3 {const c=p.headFrame?.center??[0,0,0],n=symmetryNormal(p);if(n[0]===1&&n[1]===0&&n[2]===0)return [c[0]===0?-v[0]:2*c[0]-v[0],v[1],v[2]];return sub(v,scale(n,2*dot(n,sub(v,c))));}
export function spatialPlacement(p:LandmarkProject,position:Vec3):PointPlacement{return p.headFrame?{kind:'FRAME_RELATIVE',position:toRelative(p,position)}:{kind:'WORLD',position};}
/** Migration changes representation only; curve handles, planes, locks and fullness remain untouched. */
export function migrateHeadFrame(p:LandmarkProject):LandmarkProject {const framed={...p,headFrame:p.headFrame??defaultHeadFrame(),version:p.loomisScaffold?'landmarks-0.5.5' as const:p.version==='landmarks-0.5.4'?'landmarks-0.5.4' as const:p.loomisCaps?.length?'landmarks-0.5.3' as const:p.landmarks.some(l=>l.placement.kind==='ON_LOOMIS_SURFACE')?'landmarks-0.5.2' as const:p.curves.some(c=>'geometryType' in c&&c.geometryType==='LOOMIS_SECTION')?'landmarks-0.5.1' as const:'landmarks-0.5' as const};return {...framed,landmarks:p.landmarks.map(l=>l.placement.kind==='WORLD'?{...l,placement:spatialPlacement(framed,l.placement.position)}:l)};}
export function frameWire(p:LandmarkProject):Vec3[][] {if(!p.headFrame||p.loomisScaffold)return [];return [0,1,2].map(axis=>Array.from({length:97},(_,i)=>{const a=i*Math.PI/48,q:Vec3=[0,0,0];q[(axis+1)%3]=Math.cos(a);q[(axis+2)%3]=Math.sin(a);return toHead(p,q);}));}
