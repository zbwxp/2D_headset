import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import {eyeSide} from '../eyes/scaffold';
export function addPatchPoint(p:LandmarkProject,hostPatchId:string,u:number,v:number){
 const host=p.patches?.find(x=>x.id===hostPatchId);if(!host)throw Error('Host Patch 不存在');
 const id=crypto.randomUUID(),partner=host.mirrorPartnerId?crypto.randomUUID():undefined;
 const side=eyeSide(p,host.boundaryUses[0].curveId),type=side==='left'?'LEFT':side==='right'?'RIGHT':'FREE';
 const point:SemanticLandmark={id,name:(type==='LEFT'?'左':type==='RIGHT'?'右':'')+'眼柱面定位点',type,viewLocks:{},placement:{kind:'ON_PATCH',hostPatchId,u,v},...(partner?{mirrorPartnerId:partner}:{})};
 const points=[point];if(partner)points.push({...point,id:partner,name:(type==='LEFT'?'右':'左')+'眼柱面定位点',type:type==='LEFT'?'RIGHT':'LEFT',mirrorPartnerId:id,placement:{kind:'ON_PATCH',hostPatchId:host.mirrorPartnerId!,u,v}});
 return {project:{...p,landmarks:[...p.landmarks,...points]},id};
}
export function setPatchPoint(p:LandmarkProject,id:string,u:number,v:number):LandmarkProject{
 const point=p.landmarks.find(x=>x.id===id);if(point?.placement.kind!=='ON_PATCH')return p;
 if(![u,v].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Surface coordinates out of range');
 return {...p,landmarks:p.landmarks.map(x=>(x.id===id||x.id===point.mirrorPartnerId)&&x.placement.kind==='ON_PATCH'?{...x,placement:{...x.placement,u,v}}:x)};
}
