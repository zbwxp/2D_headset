import {basis} from '../domain/geometry/core';
import type {Vec2,Vec3,ViewState} from '../domain/project/types';
export const EDIT_VIEWBOX={width:600,height:560,unitsPerWorld:160} as const;
const UNIT=EDIT_VIEWBOX.unitsPerWorld;
export interface OrthographicViewState {
 readonly target:Vec3;
 readonly right:Vec3;
 readonly up:Vec3;
 /** Points toward the observer; larger depth is nearer. */
 readonly forward:Vec3;
 readonly zoom:number;
 /** Existing SVG viewBox units, preserved for project compatibility. */
 readonly pan:Vec2;
 readonly viewportWidth:number;
 readonly viewportHeight:number;
 /** Raster allocation only. Never changes CSS coordinates or hit-test distances. */
 readonly devicePixelRatio:number;
 readonly orientationToken:string;
}
export function orthographicView(camera:ViewState['camera'],canvas:{zoom:number;pan:Vec2},width:number,height:number,dpr=1):OrthographicViewState{
 const axes=basis({camera});
 return {...axes,target:camera.target,zoom:canvas.zoom,pan:canvas.pan,viewportWidth:Math.max(1,width),viewportHeight:Math.max(1,height),devicePixelRatio:dpr,orientationToken:JSON.stringify([camera.target,axes.right,axes.up,axes.forward])};
}
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function worldToPlane(p:readonly number[],v:OrthographicViewState):Vec3{
 const d=p.map((x,i)=>x-v.target[i]);return [dot(d,v.right),dot(d,v.up),dot(d,v.forward)];
}
/** Local, untransformed SVG layer coordinates. Shared by ordinary renderer and overlay. */
export function worldToSvg(p:readonly number[],v:OrthographicViewState):Vec3{
 const q=worldToPlane(p,v);return [q[0]*EDIT_VIEWBOX.unitsPerWorld,-q[1]*EDIT_VIEWBOX.unitsPerWorld,q[2]];
}
export const svgFit=(v:OrthographicViewState)=>Math.min(v.viewportWidth/EDIT_VIEWBOX.width,v.viewportHeight/EDIT_VIEWBOX.height);
export function screenToSvg(p:Vec2,v:OrthographicViewState):Vec2{const f=svgFit(v);return [(p[0]-v.viewportWidth/2)/f,(p[1]-v.viewportHeight/2)/f];}
export function screenToPlane(p:Vec2,v:OrthographicViewState):Vec2{const q=screenToSvg(p,v);return [(q[0]-v.pan[0])/v.zoom/UNIT,-(q[1]-v.pan[1])/v.zoom/UNIT];}
export function worldToScreen(p:readonly number[],v:OrthographicViewState):Vec2{
 const q=worldToSvg(p,v),f=svgFit(v);return [v.viewportWidth/2+f*(v.pan[0]+v.zoom*q[0]),v.viewportHeight/2+f*(v.pan[1]+v.zoom*q[1])];
}
/** Orthographic inversion requires a depth; default is the plane through camera target. */
export function screenToWorld(p:Vec2,v:OrthographicViewState,depth=0):Vec3{
 const q=screenToPlane(p,v);return v.target.map((x,i)=>x+q[0]*v.right[i]+q[1]*v.up[i]+depth*v.forward[i]) as Vec3;
}
/** Column-major matrices, directly usable with Three.Matrix4.fromArray(). Camera looks along -Z. */
export function viewMatrix(v:OrthographicViewState):Float64Array{
 const r=v.right,u=v.up,f=v.forward,t=v.target;
 return new Float64Array([r[0],u[0],f[0],0,r[1],u[1],f[1],0,r[2],u[2],f[2],0,-dot(r,t),-dot(u,t),-dot(f,t),1]);
}
export function projectionMatrix(v:OrthographicViewState,depthRange=1000):Float64Array{
 const fit=svgFit(v),sx=2*fit*v.zoom*UNIT/v.viewportWidth,sy=2*fit*v.zoom*UNIT/v.viewportHeight;
 return new Float64Array([sx,0,0,0,0,sy,0,0,0,0,-1/depthRange,0,2*fit*v.pan[0]/v.viewportWidth,-2*fit*v.pan[1]/v.viewportHeight,0,1]);
}
export function framebufferSize(v:OrthographicViewState){return [Math.round(v.viewportWidth*v.devicePixelRatio),Math.round(v.viewportHeight*v.devicePixelRatio)] as const;}
