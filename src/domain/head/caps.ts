import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {PatchMesh} from '../patches/geometry';
import {isSection} from '../curves/model';
import {sectionProvider} from '../curves/section';
import {mirrorPoint} from './frame';
import {add,sub,scale,dot,cross} from '../geometry/core';
import {InputCache} from '../geometry/cache';
export interface LoomisSectionCap {id:string;name:string;hostSectionCurveId:string}
export function capFrame(p:LandmarkProject,id:string){
 const cap=p.loomisCaps?.find(c=>c.id===id),c=p.curves.find(c=>c.id===cap?.hostSectionCurveId);
 if(!cap||!c||!isSection(c))throw Error('封闭面宿主 Section 不存在');
 const source=c.role==='canonical'?c:p.curves.find(x=>x.id===c.canonicalCurveId)!;
 if(!isSection(source)||source.role!=='canonical')throw Error('封闭面宿主无效');
 const g=sectionProvider(p,source.section),point=(t:number)=>c.role==='canonical'?g.evaluate(t):mirrorPoint(p,g.evaluate(t));
 const a=point(0),b=point(.5),center=scale(add(a,b),.5),u=sub(a,center),v=sub(point(.25),center);
 return {cap,host:c,center,u,v,key:JSON.stringify([id,c.role,source.section,p.headFrame])};
}
export function capPosition(p:LandmarkProject,id:string,u:number,v:number):Vec3{const f=capFrame(p,id);return add(f.center,add(scale(f.u,u),scale(f.v,v)));}
export function capPartner(p:LandmarkProject,id:string){const f=capFrame(p,id);return f.host.logicalRing?f.cap:p.loomisCaps?.find(x=>x.hostSectionCurveId===f.host.mirrorPartnerCurveId);}
export function addCap(p:LandmarkProject,hostId:string):LandmarkProject {
 const host=p.curves.find(c=>c.id===hostId);if(!host||!isSection(host))throw Error('请选择 Loomis Section');
 const caps=[...(p.loomisCaps??[])];for(const id of [host.id,host.mirrorPartnerCurveId].filter(Boolean) as string[])if(!caps.some(c=>c.hostSectionCurveId===id))caps.push({id:crypto.randomUUID(),name:p.curves.find(c=>c.id===id)!.name+'封闭面',hostSectionCurveId:id});
 return {...p,version:'landmarks-0.5.3',loomisCaps:caps};
}
const meshes=new InputCache<PatchMesh>(256);
export function capMesh(p:LandmarkProject,cap:LoomisSectionCap):PatchMesh{
 try{const f=capFrame(p,cap.id),hit=meshes.get(f.key);if(hit)return hit;
 const n=96,vertices=[f.center],triangles:number[][]=[];
 for(let i=0;i<n;i++){const a=i*2*Math.PI/n;vertices.push(add(f.center,add(scale(f.u,Math.cos(a)),scale(f.v,Math.sin(a)))));triangles.push(f.host.role==='mirror'?[0,(i+1)%n+1,i+1]:[0,i+1,(i+1)%n+1]);}
 return meshes.set(f.key,{vertices,triangles});
 }catch(e){return {vertices:[],triangles:[],invalid:(e as Error).message};}
}
/** Analytic plane/disk hit: independent of renderer triangles and quality. */
export function hitCap(p:LandmarkProject,id:string,origin:Vec3,ray:Vec3){
 const f=capFrame(p,id),n=cross(f.u,f.v),den=dot(n,ray);if(Math.abs(den)<1e-12*Math.hypot(...n)*Math.hypot(...ray))return null;
 const t=dot(n,sub(f.center,origin))/den;if(t<0)return null;
 const q=sub(add(origin,scale(ray,t)),f.center),a=dot(f.u,f.u),b=dot(f.u,f.v),c=dot(f.v,f.v),det=a*c-b*b;
 if(det<=1e-24)return null;const u=(dot(q,f.u)*c-dot(q,f.v)*b)/det,v=(dot(q,f.v)*a-dot(q,f.u)*b)/det;
 return u*u+v*v<=1+1e-10?{id,u,v,t}:null;
}
export function nearestCap(p:LandmarkProject,origin:Vec3,ray:Vec3){return (p.loomisCaps??[]).map(c=>hitCap(p,c.id,origin,ray)).filter(x=>x!==null).sort((a,b)=>a.t-b.t)[0]??null;}
export function setCapPoint(p:LandmarkProject,id:string,u:number,v:number):LandmarkProject{
 const l=p.landmarks.find(l=>l.id===id);if(l?.placement.kind!=='ON_SECTION_CAP'||![u,v].every(Number.isFinite))throw Error('请选择封闭面定位点');
 const logical=!!capFrame(p,l.placement.hostSurfaceId).host.logicalRing;if(logical&&l.type==='CENTERLINE')v=0;
 const r=Math.hypot(u,v);if(r>1){u/=r;v/=r;}
 return {...p,landmarks:p.landmarks.map(x=>(x.id===id||x.id===l.mirrorPartnerId)&&x.placement.kind==='ON_SECTION_CAP'?{...x,placement:{...x.placement,u,v:logical&&x.id!==id?-v:v}}:x)};
}
export function addCapPoint(p:LandmarkProject,capId:string,u:number,v:number,centerline=false){
 const f=capFrame(p,capId),logical=!!f.host.logicalRing,partner=centerline&&logical?undefined:capPartner(p,capId);if(centerline&&logical)v=0;if(centerline&&f.host.side!=='CENTERLINE')throw Error('中线点请点击中线 Section 封闭面；侧面请使用成对点');
 if(![u,v].every(Number.isFinite)||u*u+v*v>1+1e-8)throw Error('定位点超出封闭面');
 const id=crypto.randomUUID(),otherId=crypto.randomUUID(),n=p.landmarks.filter(l=>l.placement.kind==='ON_SECTION_CAP').length+1;
 const make=(id:string,hostSurfaceId:string,type:SemanticLandmark['type'],mirrorPartnerId?:string):SemanticLandmark=>({id,name:(type==='CENTERLINE'?'中线':type==='RIGHT'?'右':'左')+'封闭面定位点 '+n,type,placement:{kind:'ON_SECTION_CAP',hostSurfaceId,u,v},viewLocks:{},...(mirrorPartnerId?{mirrorPartnerId}:{})});
 const side=logical?(centerline?'CENTERLINE':v<0?'LEFT':'RIGHT'):f.host.side;
 const points=[make(id,capId,side,partner?otherId:undefined)];if(partner){const other=make(otherId,partner.id,side==='RIGHT'?'LEFT':'RIGHT',id);if(logical&&other.placement.kind==='ON_SECTION_CAP')other.placement.v=-v;points.push(other);}
 return {selectedId:id,project:{...p,landmarks:[...p.landmarks,...points],centerlineOrder:side==='CENTERLINE'?[...p.centerlineOrder,id]:p.centerlineOrder}};
}
export function parseCaps(raw:unknown,p:LandmarkProject):LoomisSectionCap[]{
 if(!Array.isArray(raw))throw Error('封闭面数据无效');const ids=new Set<string>(),hosts=new Set<string>();
 const result=raw.map(c=>{if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.name!=='string'||typeof c.hostSectionCurveId!=='string'||hosts.has(c.hostSectionCurveId)||!p.curves.some(x=>x.id===c.hostSectionCurveId&&isSection(x)))throw Error('封闭面数据或宿主无效');ids.add(c.id);hosts.add(c.hostSectionCurveId);return {id:c.id,name:c.name,hostSectionCurveId:c.hostSectionCurveId};});
 for(const c of result){const host=p.curves.find(x=>x.id===c.hostSectionCurveId)!;if(host.mirrorPartnerCurveId&&!hosts.has(host.mirrorPartnerCurveId))throw Error('封闭面镜像对不完整');}
 return result;
}
