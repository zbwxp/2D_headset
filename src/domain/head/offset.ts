import type {LandmarkProject,SemanticLandmark,LoomisOffset} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {isSection} from '../curves/model';
export const offsetVector=(q:LoomisOffset):Vec3=>[q.offsetX??0,q.offsetY??0,q.offsetZ??0];
export const offsetFields=(q:LoomisOffset):LoomisOffset=>Object.fromEntries(['offsetX','offsetY','offsetZ'].filter(k=>k in q).map(k=>[k,q[k as keyof LoomisOffset]]));
export function hasLoomisOffset(p:LandmarkProject,l:SemanticLandmark){const q=l.placement;return q.kind==='LOOMIS_SCAFFOLD'?q.role.startsWith('APEX'):q.kind==='ON_LOOMIS_SURFACE'||q.kind==='ON_SECTION_CAP'||q.kind==='ON_CURVE'&&!(q.role==='canonical'&&q.ringEndpoint)&&p.curves.some(c=>c.id===q.hostCurveId&&isSection(c));}
export function validateOffsets(p:LandmarkProject){for(const l of p.landmarks){const o=offsetVector(l.placement);if(Object.values(offsetFields(l.placement)).some(v=>!Number.isFinite(v))||!o.every(v=>Number.isFinite(v)&&Math.abs(v)<=2)||(!hasLoomisOffset(p,l)&&o.some(v=>v!==0))||(l.type==='CENTERLINE'&&o[0]!==0))throw Error('Loomis Offset 无效或违反中线约束');if(l.mirrorPartnerId){const partner=p.landmarks.find(x=>x.id===l.mirrorPartnerId);if(partner){const b=offsetVector(partner.placement);if(b[0]!==-o[0]||b[1]!==o[1]||b[2]!==o[2])throw Error('Loomis Offset 镜像不一致');}}}}
export function setLoomisOffset(p:LandmarkProject,id:string,axis:0|1|2,value:number):LandmarkProject{
 const l=p.landmarks.find(l=>l.id===id);if(!l||!hasLoomisOffset(p,l)||!Number.isFinite(value))throw Error('请选择 Loomis 定位点');
 const o=offsetVector(l.placement);o[axis]=l.type==='CENTERLINE'&&axis===0?0:Math.max(-2,Math.min(2,value));
 return {...p,landmarks:p.landmarks.map(x=>x.id===id||x.id===l.mirrorPartnerId?{...x,placement:{...x.placement,offsetX:x.id===id?o[0]:-o[0],offsetY:o[1],offsetZ:o[2]}}:x)};
}
