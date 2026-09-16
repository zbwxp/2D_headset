import {validateOffsets} from '../head/offset';
import {isSection} from '../curves/model';
import {toRelative,mirrorPoint} from '../head/frame';
import type {LandmarkProject,SemanticLandmark} from './model';
import {GeometryEvaluationContext} from '../geometry/evaluation';
import {dependencyGraph} from '../geometry/dependencies';
import {normalizedArcLengthToT,arcLengthLUT} from '../geometry/bezier';
export function validatePlacements(p:LandmarkProject){
 validateOffsets(p);dependencyGraph(p);const ctx=new GeometryEvaluationContext(p);
 for(const l of p.landmarks){const q=l.placement;
  if(q.kind==='ON_SECTION_CAP'){const cap=p.loomisCaps?.find(c=>c.id===q.hostSurfaceId),host=p.curves.find(c=>c.id===cap?.hostSectionCurveId);if(!cap||!host||!isSection(host)||(!host.logicalRing&&host.side!==l.type)||![q.u,q.v].every(Number.isFinite)||q.u*q.u+q.v*q.v>1+1e-8||Object.keys(l.viewLocks).length)throw Error('封闭面定位点无效');}
  if(q.kind==='ON_LOOMIS_SURFACE'){if(!p.headFrame||q.hostFrameId!=='head'||Math.abs(Math.hypot(...q.direction)-1)>1e-8||!q.direction.every(Number.isFinite)||Object.keys(l.viewLocks).length)throw Error('Loomis 面上点定位无效');}
  if(q.kind==='ON_CURVE'){
   const host=p.curves.find(c=>c.id===q.hostCurveId);if(!host)throw Error('定位点宿主不存在。');
   if(Object.keys(l.viewLocks).length)throw Error('结构线定位点不能保存视图锁。');
   if(q.role==='canonical'){
    if(host.role!=='canonical'||!Number.isFinite(q.s)||q.s<0||q.s>1)throw Error('定位点宿主或在线位置无效。');
    ctx.curve(host.id).atArcLength(q.s);
    if(q.ringEndpoint&&(!(isSection(host)&&host.logicalRing)||!host.logicalEndpoints?.includes(l.id)||(q.s!==0&&q.s!==.5)))throw Error('逻辑 Ring endpoint 无效');
    if(l.type==='CENTERLINE'&&!(isSection(host)&&host.logicalRing&&q.ringEndpoint)){
     if(l.mirrorPartnerId||host.mirrorPartnerCurveId||!(isSection(host)?host.side==='CENTERLINE':[host.startLandmarkId,host.endLandmarkId].every(id=>p.landmarks.find(x=>x.id===id)?.type==='CENTERLINE'))||ctx.curve(host.id).sample().some(v=>Math.abs(toRelative(p,v)[0])>1e-9))throw Error('中心线定位点的宿主必须位于中线平面。');
    }else if(l.type!=='CENTERLINE'&&l.type!=='LEFT'&&l.type!=='RIGHT')throw Error('定位点必须属于中线或左右对称结构。');
   }else {
    const owner=p.landmarks.find(x=>x.id===q.canonicalPointId),oq=owner?.placement;
    if(!owner||owner.mirrorPartnerId!==l.id||l.mirrorPartnerId!==owner.id||oq?.kind!=='ON_CURVE'||oq.role!=='canonical'||(!(isSection(host)&&host.logicalRing)&& (host.role!=='mirror'||host.canonicalCurveId!==oq.hostCurveId)))throw Error('定位点镜像宿主关系无效。');
   }
   const sides=isSection(host)?(host.logicalRing?[]:[host.side]):[host.startLandmarkId,host.endLandmarkId].map(id=>p.landmarks.find(x=>x.id===id)!.type).filter(t=>t!=='CENTERLINE');
   if(sides.some(t=>t!==l.type))throw Error('定位点类型与宿主左右侧不匹配。');
  }
  const position=ctx.pointPosition(l.id);
  if(l.type==='CENTERLINE'&&Math.abs(toRelative(p,position)[0])>1e-9)throw Error('中心线点偏离中线平面。');
  if(l.mirrorPartnerId){const partner=p.landmarks.find(x=>x.id===l.mirrorPartnerId)!;
   if(partner.placement.kind!==q.kind)throw Error('镜像点定位方式不一致。');
   if(q.kind==='ON_CURVE'&&partner.placement.kind==='ON_CURVE'&&q.role===partner.placement.role)throw Error('定位点必须由唯一一侧保存在线位置。');
   if(q.kind==='ON_SECTION_CAP'&&partner.placement.kind==='ON_SECTION_CAP'){const a=p.loomisCaps?.find(c=>c.id===q.hostSurfaceId),b=p.loomisCaps?.find(c=>c.id===(partner.placement.kind==='ON_SECTION_CAP'?partner.placement.hostSurfaceId:'')),host=p.curves.find(c=>c.id===a?.hostSectionCurveId);if(!b||(host&&isSection(host)&&host.logicalRing?host.id!==b.hostSectionCurveId||q.u!==partner.placement.u||q.v!==-partner.placement.v:host?.mirrorPartnerCurveId!==b.hostSectionCurveId||q.u!==partner.placement.u||q.v!==partner.placement.v))throw Error('封闭面定位点镜像宿主关系无效');}
   const other=ctx.pointPosition(partner.id);if(Math.hypot(...mirrorPoint(p,position).map((v,i)=>v-other[i]))>1e-8)throw Error('镜像点坐标不一致。');
  }
 }
}
export function addOnCurvePoint(p:LandmarkProject,curveId:string){
 const selected=p.curves.find(c=>c.id===curveId);if(!selected)throw Error('请先选择结构线。');
 const host=selected.role==='canonical'?selected:p.curves.find(c=>c.id===selected.canonicalCurveId)!;
 const logical=isSection(host)&&!!host.logicalRing;
 const other=logical?host:host.mirrorPartnerCurveId?p.curves.find(c=>c.id===host.mirrorPartnerCurveId):undefined;
 const id=crypto.randomUUID(),otherId=other?crypto.randomUUID():undefined;
 const side=logical?'RIGHT':isSection(host)?host.side:[host.startLandmarkId,host.endLandmarkId].map(id=>p.landmarks.find(l=>l.id===id)!.type).find(t=>t!=='CENTERLINE')??'CENTERLINE';
 const baseName=host.name.replace(/^[左右]/,'')+'定位点';
 const count=p.landmarks.filter(l=>l.placement.kind==='ON_CURVE'&&l.placement.hostCurveId===host.id).length;
 const suffix=count?` ${count+1}`:'';const name=baseName.slice(0,79-suffix.length)+suffix;
 const a:SemanticLandmark={id,name:side==='CENTERLINE'?name:(side==='LEFT'?'左':'右')+name,type:side,placement:{kind:'ON_CURVE',role:'canonical',hostCurveId:host.id,s:logical?.25:.5},viewLocks:{},...(otherId?{mirrorPartnerId:otherId}:{})};
 const added=[a];if(other&&otherId)added.push({id:otherId,name:(side==='LEFT'?'右':'左')+name,type:side==='LEFT'?'RIGHT':'LEFT',mirrorPartnerId:id,placement:{kind:'ON_CURVE',role:'mirror',hostCurveId:other.id,canonicalPointId:id},viewLocks:{}});
 const project={...p,version:'landmarks-0.4.9' as const,landmarks:[...p.landmarks,...added]};validatePlacements(project);
 return {project,selectedId:selected.id===host.id?id:otherId!};
}
export function setOnCurveS(p:LandmarkProject,id:string,s:number):LandmarkProject {
 if(!Number.isFinite(s))throw Error('在线位置必须是有限数值。');
 const l=p.landmarks.find(l=>l.id===id),q=l?.placement;if(q?.kind!=='ON_CURVE')throw Error('请选择结构线定位点。');
 if(q.role==='canonical'&&q.ringEndpoint)return p;
 const owner=q.role==='canonical'?id:q.canonicalPointId;
 return {...p,landmarks:p.landmarks.map(x=>x.id===owner&&x.placement.kind==='ON_CURVE'&&x.placement.role==='canonical'?{...x,placement:{...x.placement,s:Math.max(0,Math.min(1,s))}}:x)};
}
