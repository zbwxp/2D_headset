import type {LandmarkProject} from './model';
import {activateDriver,allowedBasis} from './model';
import {pointPosition} from '../geometry/evaluation';
import {toHead,mirrorPoint,spatialPlacement} from '../head/frame';
import {hasLoomisOffset,offsetVector,setLoomisOffset} from '../head/offset';
import type {Vec3} from '../project/types';
export function arrowAxis(view:string,key:string):{axis:0|1|2;sign:number}|null{
 const horizontal=key==='ArrowLeft'||key==='ArrowRight',vertical=key==='ArrowUp'||key==='ArrowDown';if(!horizontal&&!vertical)return null;
 const sign=key==='ArrowRight'||key==='ArrowUp'?1:-1;
 if(view==='front')return {axis:horizontal?0:1,sign};
 if(view==='side')return {axis:horizontal?2:1,sign:horizontal?-sign:sign};
 if(view==='top')return {axis:horizontal?0:2,sign:horizontal?sign:-sign};
 if(/^(left|right)\d+$/.test(view)&&vertical)return {axis:2,sign};
 return null;
}
/** Pure model-axis motion: reject a blocked axis rather than slide onto another axis. */
export function nudgePoint(p:LandmarkProject,id:string,axis:0|1|2,amount:number):LandmarkProject{
 const l=p.landmarks.find(l=>l.id===id);if(!l)return p;
 if(hasLoomisOffset(p,l))return setLoomisOffset(p,id,axis,offsetVector(l.placement)[axis]+amount);
 if(l.placement.kind!=='WORLD'&&l.placement.kind!=='FRAME_RELATIVE')throw Error('此点由宿主或系统交点定位，不能沿空间轴移动。');
 const active=activateDriver(p,id),origin=toHead(p,[0,0,0]),v:Vec3=[0,0,0];v[axis]=amount;
 const delta=toHead(p,v).map((x,i)=>x-origin[i]) as Vec3,basis=allowedBasis(active,id);
 const projected:Vec3=[0,0,0];for(const b of basis){const dot=b.reduce((s,x,i)=>s+x*delta[i],0);b.forEach((x,i)=>projected[i]+=x*dot);}
 if(Math.hypot(...delta.map((x,i)=>x-projected[i]))>1e-8)throw Error('该轴受中线或 View Lock 约束，请先 Unlock。');
 const position=pointPosition(active,id).map((x,i)=>x+delta[i]) as Vec3;
 return {...active,landmarks:active.landmarks.map(x=>x.id===id?{...x,placement:spatialPlacement(p,position)}:x.id===l.mirrorPartnerId?{...x,placement:spatialPlacement(p,mirrorPoint(p,position))}:x)};
}
