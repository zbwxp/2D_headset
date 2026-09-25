import type {LandmarkProject} from '../landmarks/model';
import type {OnPatchCurve,SurfacePath} from './model';
import {isOnPatch} from './model';
import {surfacePointLocation,endpointLocations} from '../patches/domain';
import {evaluator} from '../patches/geometry';
import {patchInputKey} from '../geometry/revisions';
import {evaluationToken} from '../continuity/evaluation';
import {provider} from '../geometry/curveProvider';
import {InputCache} from '../geometry/cache';
import {dependencyGraph} from '../geometry/dependencies';
const cache=new InputCache<ReturnType<typeof provider>>(512);
export function clampSurfaceHandle(type:string,q:[number,number]):[number,number]{
 let u=type==='loop'?Math.max(-9,Math.min(10,q[0])):Math.max(0,Math.min(1,q[0])),v=Math.max(0,Math.min(1,q[1]));
 if(type==='tri'&&u+v>1){const d=(u+v-1)/2;u-=d;v-=d;}
 return [u,v];
}
export function onPatchControls(p:LandmarkProject,curve:OnPatchCurve){
 const c=curve.role==='canonical'?curve:p.curves.find(x=>x.id===curve.canonicalCurveId) as Extract<OnPatchCurve,{role:'canonical'}>;
 const host=p.patches?.find(x=>x.id===c.hostPatchId);if(!host)throw Error('ON_PATCH Host Patch 不存在');
 const a=surfacePointLocation(p,host,c.startLandmarkId,c.path.startBoundary).uv,b=surfacePointLocation(p,host,c.endLandmarkId,c.path.endBoundary).uv;
 if(host.type==='loop'&&c.path.referenceU){a[0]+=Math.round(c.path.referenceU[0]-a[0]);b[0]+=Math.round(c.path.referenceU[1]-b[0]);}
 const B:[number,number]=[b[0]+(host.type==='loop'?c.path.winding:0),b[1]];
 const offsets=c.path.handleOffsets??[[ (B[0]-a[0])/3,(B[1]-a[1])/3 ],[(a[0]-B[0])/3,(a[1]-B[1])/3]];
 const controls:[number,number][]=[a,clampSurfaceHandle(host.type,[a[0]+offsets[0][0],a[1]+offsets[0][1]]),clampSurfaceHandle(host.type,[B[0]+offsets[1][0],B[1]+offsets[1][1]]),B];
 return {c,host,controls};
}
export function setOnPatchHandle(p:LandmarkProject,id:string,index:0|1,uv:[number,number]):LandmarkProject{
 const curve=p.curves.find(x=>x.id===id);if(!curve||!isOnPatch(curve)||!uv.every(Number.isFinite))return p;
 const {c,host,controls}=onPatchControls(p,curve),value=clampSurfaceHandle(host.type,uv);
 const offsets=([0,1] as const).map(i=>{const anchor=controls[i===0?0:3],handle=i===index?value:controls[i+1];return [handle[0]-anchor[0],handle[1]-anchor[1]] as [number,number];}) as [[number,number],[number,number]];
 return {...p,curves:p.curves.map(x=>x.id===c.id?{...c,path:{...c.path,handleOffsets:offsets}}:x)};
}
export function onPatchProvider(p:LandmarkProject,c:Extract<OnPatchCurve,{role:'canonical'}>){
 const {host,controls}=onPatchControls(p,c);
 const key=JSON.stringify(['ON_PATCH',c.id,patchInputKey(p,host),evaluationToken(p,host),controls,c.path]),hit=cache.get(key);if(hit)return hit;
 const surface=evaluator(p,host),at=(t:number)=>{const s=1-t,w=[s*s*s,3*s*s*t,3*s*t*t,t*t*t];let u=controls.reduce((n,q,i)=>n+w[i]*q[0],0);let v=controls.reduce((n,q,i)=>n+w[i]*q[1],0);if(!c.path.handleOffsets){u=controls[0][0]+(controls[3][0]-controls[0][0])*t;v=controls[0][1]+(controls[3][1]-controls[0][1])*t;}if(host.type==='loop')u=(u%1+1)%1;return surface(u,v);};
 const g=provider(key,false,at,t=>{const lo=Math.max(0,t-1e-5),hi=Math.min(1,t+1e-5),A=at(lo),Z=at(hi);return A.map((x,i)=>(Z[i]-x)/(hi-lo)) as [number,number,number];});
 return cache.set(key,g);
}
export function createOnPatch(p:LandmarkProject,hostId:string,aId:string,bId:string,path?:SurfacePath){
 const host=p.patches?.find(x=>x.id===hostId),a=p.landmarks.find(x=>x.id===aId),b=p.landmarks.find(x=>x.id===bId);
 if(!host||!a||!b||aId===bId)throw Error('请选择 Host Patch 上两个不同的 Point');
 const A=endpointLocations(p,host,aId),B=endpointLocations(p,host,bId);
 if(!A.length||!B.length)throw Error('Endpoint 必须附着于 Host Patch，或位于其合法边界区间且未被 Offset 移离');
 const chosen=path??{startBoundary:A[0].occurrence,endBoundary:B[0].occurrence,winding:host.type==='loop'?Math.round(A[0].uv[0]-B[0].uv[0]):0,...(host.type==='loop'?{referenceU:[A[0].uv[0],B[0].uv[0]] as [number,number]}:{})};
 const side=a.type==='CENTERLINE'?b.type:a.type;
 if(a.type!=='CENTERLINE'&&b.type!=='CENTERLINE'&&a.type!==b.type)throw Error('端点需在同一侧或中线上');
 const ma=a.mirrorPartnerId??a.id,mb=b.mirrorPartnerId??b.id,mh=host.mirrorPartnerId??host.id;
 const self=ma===a.id&&mb===b.id&&mh===host.id,id=crypto.randomUUID(),mid=self?undefined:crypto.randomUUID();
 const c:OnPatchCurve={id,name:(self?'':side==='LEFT'?'左':'右')+'On Surface Curve',geometryType:'ON_PATCH',role:'canonical',hostPatchId:hostId,startLandmarkId:aId,endLandmarkId:bId,path:chosen,contourRole:'OPEN_EDGE',...(mid?{mirrorPartnerCurveId:mid}:{})};
 const curves=[...p.curves,c];if(mid)curves.push({id:mid,name:(side==='LEFT'?'右':'左')+'On Surface Curve',geometryType:'ON_PATCH',role:'mirror',canonicalCurveId:id,hostPatchId:mh,startLandmarkId:ma,endLandmarkId:mb,mirrorPartnerCurveId:id,contourRole:'OPEN_EDGE'});
 const next={...p,curves};dependencyGraph(next);onPatchProvider(next,c);return {project:next,selectedId:id};
}
export function validateOnPatch(p:LandmarkProject){
 for(const c of p.curves)if(isOnPatch(c)){
 if(c.role==='canonical'){if(!c.path||!Number.isInteger(c.path.winding)||Math.abs(c.path.winding)>8)throw Error('ON_PATCH path winding 无效');onPatchProvider(p,c);}
 else {const owner=p.curves.find(x=>x.id===c.canonicalCurveId);if(!owner||!isOnPatch(owner)||owner.role!=='canonical')throw Error('ON_PATCH canonical 无效');const h=p.patches?.find(x=>x.id===owner.hostPatchId);if(c.hostPatchId!==(h?.mirrorPartnerId??h?.id))throw Error('ON_PATCH mirror Host 不匹配');}
 }
}
