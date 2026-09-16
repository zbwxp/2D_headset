import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {SectionCurve,CurveEdge} from '../curves/model';
import type {Vec3} from '../project/types';
import {toHead} from './frame';
export interface LoomisScaffold {version:2;sidePosition:number;roundness:number;rimSag:number;apexHeight:number;visible:boolean}
export const SCAFFOLD_DEFAULTS:LoomisScaffold={version:2,sidePosition:.75,roundness:.5,rimSag:.2,apexHeight:.85,visible:true};
export const roles=['BROW','OCCIPUT','CROWN','NECK','POLE_R','POLE_L','SIDE_R_0','SIDE_R_1','SIDE_R_2','SIDE_R_3','SIDE_L_0','SIDE_L_1','SIDE_L_2','SIDE_L_3','APEX_R','APEX_L'] as const;
export type ScaffoldPointRole=typeof roles[number];
export const systemId=(n:number)=>`05500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const RING_X=systemId(1),RING_Y=systemId(2),RING_Z=systemId(3),SIDE_R=systemId(4),SIDE_L=systemId(5),HELMET=systemId(6),RIM_R=systemId(7),RIM_L=systemId(8);
export function scaffoldRings(s:LoomisScaffold):SectionCurve[]{
 const make=(id:string,name:string,n:Vec3,reference:Vec3,role:string,extra:Partial<SectionCurve>={}):SectionCurve=>({id,name,geometryType:'LOOMIS_SECTION',side:'CENTERLINE',role:'canonical',systemRole:role,section:{hostFrameId:'head',planeNormal:n,planeOffset:0,reference},...extra} as SectionCurve);
 return [make(RING_X,'主环 X · 中线纵环',[1,0,0],[0,0,1],'MAIN_X'),make(RING_Y,'主环 Y · 中间横环',[0,1,0],[0,0,1],'MAIN_Y',{logicalRing:'COMPOSITE',logicalEndpoints:[systemId(100),systemId(101)]}),make(RING_Z,'主环 Z · 冠状环',[0,0,1],[0,-1,0],'MAIN_Z',{logicalRing:'SYMMETRIC',logicalEndpoints:[systemId(103),systemId(102)]}),make(SIDE_R,'右侧环',[1,0,0],[0,1,0],'SIDE_R',{side:'RIGHT',mirrorPartnerCurveId:SIDE_L,section:{hostFrameId:'head',planeNormal:[1,0,0],planeOffset:s.sidePosition,reference:[0,1,0]}}),{id:SIDE_L,name:'左侧环',geometryType:'LOOMIS_SECTION',side:'LEFT',role:'mirror',canonicalCurveId:SIDE_R,mirrorPartnerCurveId:SIDE_R,systemRole:'SIDE_L'}];
}
export function scaffoldRims():CurveEdge[]{return [
 {id:RIM_R,name:'右 Helmet Rim',geometryType:'HELMET_RIM',systemRole:'RIM_R',role:'canonical',startLandmarkId:systemId(107),endLandmarkId:systemId(109),mirrorPartnerCurveId:RIM_L},
 {id:RIM_L,name:'左 Helmet Rim',geometryType:'HELMET_RIM',systemRole:'RIM_L',role:'mirror',canonicalCurveId:RIM_R,startLandmarkId:systemId(111),endLandmarkId:systemId(113),mirrorPartnerCurveId:RIM_R}];}
export function scaffoldPointRelative(p:LandmarkProject,role:ScaffoldPointRole):Vec3{
 const s=p.loomisScaffold;if(!s)throw Error('缺少 Default Scaffold');const c=s.sidePosition,r=Math.sqrt(1-c*c);
 const fixed:Partial<Record<ScaffoldPointRole,Vec3>>={BROW:[0,0,1],OCCIPUT:[0,0,-1],CROWN:[0,1,0],NECK:[0,-1,0],POLE_R:[1,0,0],POLE_L:[-1,0,0]};if(fixed[role])return fixed[role]!;
 const sign=role.includes('_L')?-1:1;
 if(role.startsWith('APEX')){const y=s.apexHeight*r;return [sign*sideShellX(s,y,0),y,0];}
 const i=Number(role.at(-1));return [sign*c,...([[r,0],[0,r],[-r,0],[0,-r]][i])] as Vec3;
}
/** One continuous field on the original normalized sphere; domain is separate. */
/** Canonical radial graph: concave x(rho) defines a convex side shell. */
export function sideShellProfile(c:number,a:number,rho:number){
 const r2=1-c*c,p=Math.max(6,1/(c*c)),q=r2/c;
 const sphere=Math.sqrt(Math.max(0,1-r2*rho*rho));
 const flat=c+q*(1-rho**(p+1))/(p+1);
 return (1-a)*flat+a*sphere;
}
export function sideShellX(s:LoomisScaffold,y:number,z:number){
 const radius2=y*y+z*z,r2=1-s.sidePosition*s.sidePosition;
 return radius2>=r2?Math.sqrt(Math.max(0,1-radius2)):sideShellProfile(s.sidePosition,s.roundness,Math.sqrt(radius2/r2));
}
export function helmetRelative(s:LoomisScaffold,v:Vec3):Vec3 {return [Math.sign(v[0])*sideShellX(s,v[1],v[2]),v[1],v[2]];}
export function scaffoldHostIds(role:ScaffoldPointRole):string[]{if(role.startsWith('APEX'))return [];if(role==='BROW'||role==='OCCIPUT')return [RING_X,RING_Y];if(role==='CROWN'||role==='NECK')return [RING_X,RING_Z];if(role.startsWith('POLE'))return [RING_Y,RING_Z];return [role.includes('_R')?SIDE_R:SIDE_L,Number(role.at(-1))%2===0?RING_Z:RING_Y];}
export function ensureScaffold(p:LandmarkProject):LandmarkProject{
 if(!p.headFrame)throw Error('缺少 HeadFrame');const old=p.loomisScaffold;const s:LoomisScaffold={version:2,sidePosition:old?.sidePosition??.75,roundness:old?.version===2?old.roundness:.5,rimSag:old?.rimSag??.2,apexHeight:old?.apexHeight??.85,visible:old?.visible??true};
 if(!Number.isFinite(s.rimSag)||s.rimSag<0||s.rimSag>.5)throw Error('Rim Sag 参数无效');
 if(s.version!==2||!Number.isFinite(s.sidePosition)||s.sidePosition<.1||s.sidePosition>.95||!Number.isFinite(s.roundness)||s.roundness<0||s.roundness>1||!Number.isFinite(s.apexHeight)||s.apexHeight<0||s.apexHeight>1||typeof s.visible!=='boolean')throw Error('Default Scaffold 参数无效');
 const names=['眉心','枕骨','颅顶','颈部中心','右极点','左极点',...Array.from({length:4},(_,i)=>'右侧交点 '+(i+1)),...Array.from({length:4},(_,i)=>'左侧交点 '+(i+1)),'右侧壳上锚点','左侧壳上锚点'];
 const points:SemanticLandmark[]=roles.map((role,i)=>{const type=i<4?'CENTERLINE':role.includes('_L')?'LEFT':'RIGHT',partner=i===4?5:i===5?4:i>=6&&i<10?i+4:i>=10&&i<14?i-4:i===14?15:i===15?14:undefined;return {id:systemId(100+i),name:names[i],systemRole:role,type,placement:{kind:'LOOMIS_SCAFFOLD',role},viewLocks:{},...(partner!==undefined?{mirrorPartnerId:systemId(100+partner)}:{})};});
 const rings=[...scaffoldRings(s),...scaffoldRims()];const merge=<T extends {id:string}>(existing:T[],defaults:T[])=>{const by=new Map(existing.map(x=>[x.id,x]));return [...defaults.map(x=>({...x,name:((by.get(x.id) as any)?.name?.replace('Side Shell Apex','侧壳上锚点'))??(x as any).name,...((x as any).placement?.role?.startsWith('APEX')?{placement:{...(x as any).placement,offsetX:(by.get(x.id) as any)?.placement?.offsetX??0,offsetY:(by.get(x.id) as any)?.placement?.offsetY??0,offsetZ:(by.get(x.id) as any)?.placement?.offsetZ??0}}:{})})),...existing.filter(x=>!defaults.some(d=>d.id===x.id))];};
 return {...p,version:'landmarks-0.5.5',loomisScaffold:s,curves:merge(p.curves,rings),landmarks:merge(p.landmarks,points),centerlineOrder:p.centerlineOrder.filter(id=>!points.some(x=>x.id===id))};
}
export function systemPointPosition(p:LandmarkProject,role:ScaffoldPointRole){return toHead(p,scaffoldPointRelative(p,role));}
export function systemOwned(p:LandmarkProject,id:string){return id===HELMET||id==='frame:head'||p.landmarks.some(l=>l.id===id&&!!l.systemRole)||p.curves.some(c=>c.id===id&&'systemRole' in c&&!!c.systemRole);}
