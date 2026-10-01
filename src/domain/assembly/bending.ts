import type {AssemblyDocument} from './model';
import {angleWeights,sameAngle} from './placement';
import {createPerspective} from './perspective';
import type {Cubic,Point2} from '../drawing/model';

/** Counterclockwise: bottom, right, top, left. Each edge has two handles;
 * its endpoints are the shared corners of the perspective frame. */
export type BendHandles=[[Point2,Point2],[Point2,Point2],[Point2,Point2],[Point2,Point2]];
export interface BendValue {handles:BendHandles;enabled:boolean}
export interface BendKey extends BendValue {id:string;yaw:number;pitch:number}
export interface BendTrack {layerId:string;keys:BendKey[];drafts:BendKey[]}
const corners:Point2[]=[[0,0],[1,0],[1,1],[0,1]];
export const neutralHandles=():BendHandles=>corners.map((a,i)=>{const b=corners[(i+1)%4];return [1/3,2/3].map(t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}) as BendHandles;
export const neutralBend=():BendValue=>({handles:neutralHandles(),enabled:true});
export const bendEdges=(value:BendValue):Cubic[]=>corners.map((p,i)=>[p,...value.handles[i],corners[(i+1)%4]] as Cubic);
/** Classical bilinearly blended Coons patch in the asset's normalized frame.
 * H(Coons(u,v)) keeps the old homography EXACT when all edges are straight. */
const straight=neutralHandles();
export function bendPoint(value:BendValue,[u,v]:Point2):Point2 {
 if(!value.enabled)return [u,v];
 // Sum boundary displacements directly; this is the Coons formula with the
 // identity bilinear term canceled. No cubic evaluations per vertex.
 let x=u,y=v;const ts=[u,v,1-u,1-v],weights=[1-v,u,v,1-u];
 for(let i=0;i<4;i++){const t=ts[i],a=3*(1-t)*(1-t)*t*weights[i],b=3*(1-t)*t*t*weights[i];x+=a*(value.handles[i][0][0]-straight[i][0][0])+b*(value.handles[i][1][0]-straight[i][1][0]);y+=a*(value.handles[i][0][1]-straight[i][0][1])+b*(value.handles[i][1][1]-straight[i][1][1]);}
 return [x,y];
}
export function assertBend(value:BendValue){
 if(!value||typeof value.enabled!=='boolean'||!Array.isArray(value.handles)||value.handles.length!==4||!value.handles.every(e=>Array.isArray(e)&&e.length===2&&e.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=8))))throw Error('曲边变形参数无效');
 // Guard the full region, not just the four edges. Invalid drags retain the last
 // valid shape. Sampling is intentionally small and independent of art density.
 const h=1e-4;
 for(let j=0;j<=16;j++)for(let i=0;i<=16;i++){
  const u=i/16,v=j/16,p=bendPoint(value,[u,v]),x=bendPoint(value,[u+h,v]),y=bendPoint(value,[u,v+h]);
  const determinant=((x[0]-p[0])*(y[1]-p[1])-(x[1]-p[1])*(y[0]-p[0]))/(h*h);
  if(!Number.isFinite(determinant)||determinant<.015)throw Error('曲边发生折叠或压扁，已保留最后有效形状。');
 }
}
export function inverseBend(value:BendValue,target:Point2):Point2 {
 if(!value.enabled)return target;let p=[...target] as Point2;
 for(let k=0;k<18;k++){
  const q=bendPoint(value,p),dx=q[0]-target[0],dy=q[1]-target[1];if(Math.hypot(dx,dy)<1e-8)return p;
  const h=1e-4,x=bendPoint(value,[p[0]+h,p[1]]),y=bendPoint(value,[p[0],p[1]+h]),a=(x[0]-q[0])/h,b=(y[0]-q[0])/h,c=(x[1]-q[1])/h,d=(y[1]-q[1])/h,det=a*d-b*c;
  if(Math.abs(det)<1e-8)break;const step:Point2=[(d*dx-b*dy)/det,(a*dy-c*dx)/det];
  let rate=1;while(rate>.015){const next:Point2=[p[0]-step[0]*rate,p[1]-step[1]*rate],v=bendPoint(value,next);if(Math.hypot(v[0]-target[0],v[1]-target[1])<Math.hypot(dx,dy)){p=next;break;}rate/=2;}
 }
 throw Error('这里的弯曲过大，请靠近曲线调整区间。');
}
export function bendEvaluation(a:AssemblyDocument,id:string,includeDraft=true){
 const track=a.timeline?.bends?.find(t=>t.layerId===id),draft=includeDraft?track?.drafts.find(k=>sameAngle(k,a.pose)):undefined;
 if(draft)return {value:draft,covered:true,draft,exact:undefined as BendKey|undefined,issue:false};
 const e=angleWeights(track?.keys??[],a.pose,a.timeline?.loop??false);
 if(!e.samples.length)return {value:neutralBend(),covered:false,draft,exact:e.exact,issue:false};
 if(e.exact)return {value:e.exact,covered:true,draft,exact:e.exact,issue:false};
 const handles=neutralHandles(),neutral=neutralHandles();
 for(let i=0;i<4;i++)for(let j=0;j<2;j++)for(let k=0;k<2;k++)handles[i][j][k]=e.samples.reduce((n,s)=>n+s.weight*(s.key.enabled?s.key.handles[i][j][k]:neutral[i][j][k]),0);
 let value:BendValue={handles,enabled:e.samples.some(s=>s.key.enabled)},issue=false;
 try{assertBend(value);}catch{issue=true;value=e.samples.reduce((a,b)=>a.weight>=b.weight?a:b).key;}
 return {value,covered:e.covered,draft,exact:e.exact,issue};
}
export function writeBend(a:AssemblyDocument,id:string,value:BendValue):AssemblyDocument {
 assertBend(value);if(!a.timeline)throw Error('请先打开组装姿态');
 let next=a;if(!a.perspectives?.some(p=>p.layerId===id))next={...a,perspectives:[...a.perspectives??[],{...createPerspective(a.drawing,id),enabled:false}]};
 const old=next.timeline!.bends?.find(t=>t.layerId===id),current=bendEvaluation(next,id).value;
 if(JSON.stringify(current.handles)===JSON.stringify(value.handles)&&current.enabled===value.enabled)return next;
 const existing=old?.drafts.find(k=>sameAngle(k,a.pose))??old?.keys.find(k=>sameAngle(k,a.pose));
 const key:BendKey={...structuredClone(value),id:existing?.id??crypto.randomUUID(),yaw:a.pose.yaw,pitch:a.pose.pitch};
 const track:BendTrack={layerId:id,keys:old?.keys??[{...neutralBend(),...a.timeline.base,id:crypto.randomUUID()}],drafts:[...(old?.drafts??[]).filter(k=>!sameAngle(k,a.pose)),key]};
 return {...next,timeline:{...next.timeline!,bends:old?next.timeline!.bends!.map(t=>t.layerId===id?track:t):[...next.timeline!.bends??[],track]}};
}
export function saveBend(a:AssemblyDocument,id:string):AssemblyDocument {
 const old=a.timeline?.bends?.find(t=>t.layerId===id);if(!old)return a;
 const value=bendEvaluation(a,id).value,key:BendKey={...structuredClone(value),id:old.keys.find(k=>sameAngle(k,a.pose))?.id??crypto.randomUUID(),yaw:a.pose.yaw,pitch:a.pose.pitch};
 return {...a,timeline:{...a.timeline!,bends:a.timeline!.bends!.map(t=>t===old?{...t,keys:[...t.keys.filter(k=>!sameAngle(k,a.pose)),key],drafts:t.drafts.filter(k=>!sameAngle(k,a.pose))}:t)}};
}
