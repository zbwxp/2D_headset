import {ballCoordVector} from './coord';
import {eyePerspectiveMatrix} from './perspective';
import {Vector3} from 'three';
import {gazePose,type EyeSource} from './tracking';
import {eyeballCenter} from './scaffold';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {rotateFrame} from '../head/frame';
import {add,scale} from '../geometry/core';
export interface GazeEyeball {version:1;leftId:string;rightId:string;irisScale:number;recessDepth:number;tracking?:boolean;viewDistance?:number;followStrength?:number}
export function gazeSide(p:Pick<LandmarkProject,'gazeEyeball'>,id:string){return p.gazeEyeball?.leftId===id?'left':p.gazeEyeball?.rightId===id?'right':undefined;}
export function parseGaze(value:unknown):GazeEyeball|undefined {
 if(value===undefined)return;const g=value as GazeEyeball;
 if(g?.followStrength!==undefined&&(!Number.isFinite(g.followStrength)||g.followStrength<0||g.followStrength>1))throw Error('Invalid gaze follow strength');
 if(g?.viewDistance!==undefined&&(!Number.isFinite(g.viewDistance)||g.viewDistance<10||g.viewDistance>200))throw Error('Invalid gaze view distance');
 if(!g||(g.tracking!==undefined&&typeof g.tracking!=='boolean')||g.version!==1||![g.leftId,g.rightId].every(id=>typeof id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))||g.leftId===g.rightId||!Number.isFinite(g.irisScale)||g.irisScale<.05||g.irisScale>.95||!Number.isFinite(g.recessDepth)||g.recessDepth<0||g.recessDepth>.5)throw Error('Invalid Gaze Eyeball');
 return {version:1,leftId:g.leftId,rightId:g.rightId,irisScale:g.irisScale,recessDepth:g.recessDepth,tracking:g.tracking??true,...(g.followStrength===undefined?{}:{followStrength:g.followStrength}),...(g.viewDistance===undefined?{}:{viewDistance:g.viewDistance})};
}
/** True ellipsoid section: a=rx*k, b=ry*k, z=rz*sqrt(1-k²).
 * Depth is relative to rz. The dish is a scaled spherical cap; its boundary
 * explicitly uses the same rim function so no independent perimeter can drift. */
export function irisGeometry(p:EyeSource,side:'left'|'right',facing?:Vec3){
 const f=p.headFrame,q=p.eyeScaffold?.parameters,g=p.gazeEyeball;if(!f||!q||!g)return;
 const k=g.irisScale,z=q.ballZ*Math.sqrt(1-k*k),d=g.recessDepth;
 const pose=gazePose(p,side,facing);
 const warp=facing?eyePerspectiveMatrix(p,side,facing):undefined;
 const toWorld=(v:Vec3)=>{const posed=pose.transform(add(f.center,rotateFrame(scale(add(eyeballCenter(q,side),p.eyeScaffold?.coord?ballCoordVector(p,side,v):v),f.radiusX),f)));return warp?new Vector3(...posed).applyMatrix4(warp).toArray():posed;};
 const rim=(angle:number):Vec3=>toWorld([q.ballX*k*Math.cos(angle),q.ballY*k*Math.sin(angle),z]);
 const evaluate=(r:number,angle:number):Vec3=>{
 if(r===1)return rim(angle);
 const sphere=d>0?(1+d*d)/(2*d):0;
 // Rationalized difference of square roots avoids cancellation for shallow caps.
 const drop=d===0?0:(1-r*r)/(Math.sqrt(sphere*sphere-r*r)+Math.sqrt(sphere*sphere-1));
 return toWorld([q.ballX*k*r*Math.cos(angle),q.ballY*k*r*Math.sin(angle),z-q.ballZ*drop]);
 };
 return {rim,evaluate,id:side==='left'?g.leftId:g.rightId};
}
export function irisMeshes(p:EyeSource,facing?:Vec3){
 return (['left','right'] as const).flatMap(side=>{const g=irisGeometry(p,side,facing);if(!g)return [];const N=96,L=16,vertices:Vec3[]=[g.evaluate(0,0)],triangles:number[][]=[];
 for(let j=1;j<=L;j++)for(let i=0;i<N;i++)vertices.push(g.evaluate(j/L,i*2*Math.PI/N));
 for(let i=0;i<N;i++)triangles.push([0,1+i,1+(i+1)%N]);
 for(let j=1;j<L;j++)for(let i=0;i<N;i++){const a=1+(j-1)*N+i,b=1+(j-1)*N+(i+1)%N,c=a+N,d=b+N;triangles.push([a,c,d],[a,d,b]);}
 const rim=vertices.slice(1+(L-1)*N);rim.push(rim[0]);return [{id:g.id,side,vertices,triangles,rim}];});
}
export function irisRims(p:EyeSource,facing?:Vec3){return (['left','right'] as const).flatMap(side=>{const g=irisGeometry(p,side,facing);if(!g)return [];const line=Array.from({length:192},(_,i)=>g.rim(i*2*Math.PI/192));line.push(line[0]);return [line];});}
