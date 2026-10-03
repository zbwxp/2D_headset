import type {AssemblyDocument} from './model';
import {angleWeights,sameAngle} from './placement';
import {createPerspective} from './perspective';
import {neutralHandles,neutralBend,assertBend,type BendValue} from '../deformation/coons';
export {neutralHandles,neutralBend,bendEdges,bendPoint,assertBend,inverseBend} from '../deformation/coons';
export type {BendHandles,BendValue} from '../deformation/coons';
export interface BendKey extends BendValue {id:string;yaw:number;pitch:number}
export interface BendTrack {layerId:string;keys:BendKey[];drafts:BendKey[]}

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
