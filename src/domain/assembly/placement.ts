import type {AssemblyDocument,AssemblyFrame,AssemblyPose} from './model';
import type {Point2} from '../drawing/model';

/** Rig-local values only: no drawing copy, binding calibration or perspective. */
export interface PlacementValues {
 planes:Record<string,number>;
 locators:Record<string,Point2>;
 offsets:Record<string,{locatorId:string;value:Point2}>;
}
export interface PlacementKey {id:string;name:string;yaw:number;pitch:number;values:PlacementValues}
export interface PlacementRecording {version:1;sparse?:boolean;enabled:boolean;loop:boolean;base:PlacementValues;keys:PlacementKey[];drafts:PlacementKey[]}
type WithPlacement=AssemblyFrame&{placement?:PlacementRecording};
export const yawAngle=(n:number)=>{const y=((Math.round(n*1000)/1000+180)%360+360)%360-180;return Math.round(y*1000)/1000||0;};
export const pitchAngle=(n:number)=>Math.max(-90,Math.min(90,Math.round(n*1000)/1000));
export const sameAngle=(a:{yaw:number;pitch:number},b:{yaw:number;pitch:number})=>Math.abs(yawAngle(a.yaw-b.yaw))<.0005&&Math.abs(pitchAngle(a.pitch)-pitchAngle(b.pitch))<.0005;
export const placementName=(p:{yaw:number;pitch:number})=>`Yaw ${yawAngle(p.yaw)}° · Pitch ${pitchAngle(p.pitch)}°`;
export function placementValues(a:AssemblyFrame):PlacementValues {
 return {planes:Object.fromEntries(a.planes.map(p=>[p.id,p.height])),locators:Object.fromEntries(a.locators.map(l=>[l.id,[l.x,l.z] as Point2])),offsets:Object.fromEntries(a.bindings.map(b=>[b.layerId,{locatorId:b.locatorId,value:[...b.offset] as Point2}]))};
}
type AngleKey={yaw:number;pitch:number};
export interface AngleEvaluation<K> {samples:{key:K;weight:number}[];covered:boolean;exact?:K}
export type PlacementEvaluation=AngleEvaluation<PlacementKey>;
const smooth=(t:number)=>t*t*(3-2*t);
const positive=(n:number)=>(n%360+360)%360;
const yawDistance=(a:number,b:number)=>Math.abs(yawAngle(a-b));
function yawSamples<K extends AngleKey>(keys:K[],yaw:number,loop:boolean):AngleEvaluation<K> {
 const sorted=keys.slice().sort((a,b)=>a.yaw-b.yaw),exact=sorted.find(k=>yawDistance(k.yaw,yaw)<.0005);
 if(exact)return {samples:[{key:exact,weight:1}],covered:true,exact};
 if(sorted.length===1)return {samples:[{key:sorted[0],weight:1}],covered:false};
 let gapIndex=0,gap=-1;
 for(let i=0;i<sorted.length;i++){const distance=positive(sorted[(i+1)%sorted.length].yaw-sorted[i].yaw);if(distance>gap){gap=distance;gapIndex=i;}}
 // For partial recordings, the largest unrecorded arc is outside coverage. This
 // also allows 170 -> -170 to interpolate over the seam, not through front view.
 const start=sorted[(gapIndex+1)%sorted.length].yaw,position=positive(yaw-start),span=360-gap;
 if(!loop&&position>span+1e-8){const nearest=sorted.reduce((a,b)=>yawDistance(a.yaw,yaw)<=yawDistance(b.yaw,yaw)?a:b);return {samples:[{key:nearest,weight:1}],covered:false};}
 const i=sorted.findIndex(k=>k.yaw>yawAngle(yaw)),hi=i<0?0:i,lo=(hi+sorted.length-1)%sorted.length;
 const length=positive(sorted[hi].yaw-sorted[lo].yaw),t=smooth(positive(yaw-sorted[lo].yaw)/length);
 return {samples:[{key:sorted[lo],weight:1-t},{key:sorted[hi],weight:t}],covered:true};
}
export function angleWeights<K extends AngleKey>(keys:K[],pose:Pick<AssemblyPose,'yaw'|'pitch'>,loop=false):AngleEvaluation<K> {
 if(!keys.length)return {samples:[],covered:false};
 const pitches=[...new Set(keys.map(k=>k.pitch))].sort((a,b)=>a-b),p=pitchAngle(pose.pitch);
 const row=(pitch:number)=>yawSamples(keys.filter(k=>k.pitch===pitch),pose.yaw,loop);
 const exactPitch=pitches.find(v=>Math.abs(v-p)<.0005);
 if(exactPitch!==undefined)return row(exactPitch);
 if(p<pitches[0]||p>pitches.at(-1)!){const e=row(p<pitches[0]?pitches[0]:pitches.at(-1)!);return {...e,covered:false,exact:undefined};}
 const hi=pitches.findIndex(v=>v>p),lo=hi-1,t=smooth((p-pitches[lo])/(pitches[hi]-pitches[lo])),a=row(pitches[lo]),b=row(pitches[hi]);
 return {samples:[...a.samples.map(s=>({...s,weight:s.weight*(1-t)})),...b.samples.map(s=>({...s,weight:s.weight*t}))],covered:a.covered&&b.covered};
}
export const placementWeights=(r:PlacementRecording,pose:Pick<AssemblyPose,'yaw'|'pitch'>):PlacementEvaluation=>angleWeights(r.keys,pose,r.loop);
const frameCache=new WeakMap<object,AssemblyFrame>();
/** Return a plain frame: projection functions can consume it without evaluating twice. */
export function resolvePlacement(a:WithPlacement,pose=a.pose,includeDraft=true):AssemblyFrame {
 const r=a.placement;
 if((a as AssemblyDocument).timeline?.editingBase)return {pose,planes:a.planes,locators:a.locators,bindings:a.bindings,perspectives:a.perspectives};
 if(!r?.enabled)return pose===a.pose?a:{...a,pose,placement:undefined} as AssemblyFrame;
 if(pose===a.pose&&includeDraft){const hit=frameCache.get(a);if(hit)return hit;}
 const draft=includeDraft?r.drafts.find(k=>sameAngle(k,pose)):undefined;
 const samples=draft?[{key:draft,weight:1}]:placementWeights(r,pose).samples;
 const number=(read:(v:PlacementValues)=>number|undefined,fallback:number)=>{
  const safe=(v:PlacementValues,otherwise:number)=>{const n=read(v);return typeof n==='number'&&Number.isFinite(n)?n:otherwise;};const base=safe(r.base,fallback);
  const ownDraft=r.sparse&&draft&&read(draft.values)!==undefined?draft:undefined;
  const relevant=r.sparse?(ownDraft?[{key:ownDraft,weight:1}]:angleWeights(r.keys.filter(k=>read(k.values)!==undefined),pose,r.loop).samples):samples;
  return relevant.length?relevant.reduce((sum,s)=>sum+s.weight*safe(s.key.values,base),0):base;
 };
 const result:AssemblyFrame={pose,perspectives:a.perspectives,
  planes:a.planes.map(p=>({...p,height:number(v=>v.planes[p.id],p.height)})),
  locators:a.locators.map(l=>({...l,x:number(v=>v.locators[l.id]?.[0],l.x),z:number(v=>v.locators[l.id]?.[1],l.z)})),
  bindings:a.bindings.map(b=>({...b,offset:[0,1].map(i=>number(v=>v.offsets[b.layerId]?.locatorId===b.locatorId?v.offsets[b.layerId].value[i]:undefined,b.offset[i])) as Point2}))};
 if(pose===a.pose&&includeDraft)frameCache.set(a,result);return result;
}
function keyAt(a:WithPlacement,values:PlacementValues):PlacementKey {
 const old=a.placement?.drafts.find(k=>sameAngle(k,a.pose))??a.placement?.keys.find(k=>sameAngle(k,a.pose));
 return {id:old?.id??crypto.randomUUID(),name:old?.name??placementName(a.pose),yaw:yawAngle(a.pose.yaw),pitch:pitchAngle(a.pose.pitch),values};
}
export function savePlacement(a:AssemblyDocument,name?:string):AssemblyDocument {
 const frame=resolvePlacement(a),values=placementValues(frame),key=keyAt(a,values);
 if(name!==undefined){name=name.trim();if(!name||name.length>80)throw Error('定位姿态名称请输入 1–80 个字符。');key.name=name;}
 const r=a.placement??{version:1 as const,enabled:true,loop:false,base:placementValues(a),keys:[],drafts:[]};
 return {...a,placement:{...r,enabled:true,keys:[...r.keys.filter(k=>!sameAngle(k,key)),key],drafts:r.drafts.filter(k=>!sameAngle(k,key))}};
}
/** Unsaved values stay attached to their angle, including after navigation/reload. */
function edit(a:AssemblyDocument,change:(frame:AssemblyFrame)=>AssemblyFrame):AssemblyDocument {
 if(a.timeline?.editingBase||!a.timeline&&!a.placement?.enabled)return {...a,...change(a)};
 if(!a.placement){const base=placementValues(a),angle=a.timeline!.base;
  a={...a,placement:{version:1,enabled:true,sparse:true,loop:a.timeline!.loop,base,keys:[{id:crypto.randomUUID(),name:placementName(angle),...angle,values:base}],drafts:[]}};
 }
 const before=resolvePlacement(a),next=change(before),all=placementValues(next),previous=placementValues(before);
 const old=a.placement!.drafts.find(k=>sameAngle(k,a.pose));
 const values=a.placement!.sparse?{planes:{...old?.values.planes},locators:{...old?.values.locators},offsets:{...old?.values.offsets}}:all;
 if(a.placement!.sparse)for(const kind of ['planes','locators','offsets'] as const)for(const [id,v] of Object.entries(all[kind]))if(JSON.stringify(v)!==JSON.stringify(previous[kind][id]))(values[kind] as Record<string,unknown>)[id]=v;
 const key=keyAt(a,values);
 return {...a,placement:{...a.placement!,enabled:true,drafts:[...a.placement!.drafts.filter(k=>!sameAngle(k,key)),key]}};
}
export const setPlacementPoint=(a:AssemblyDocument,id:string,axis:'x'|'z',value:number)=>edit(a,f=>({...f,locators:f.locators.map(l=>l.id===id?{...l,[axis]:value}:l)}));
export const setPlacementPlane=(a:AssemblyDocument,id:string,value:number)=>edit(a,f=>({...f,planes:f.planes.map(p=>p.id===id?{...p,height:value}:p)}));
export const setPlacementOffset=(a:AssemblyDocument,id:string,index:number,value:number)=>edit(a,f=>({...f,bindings:f.bindings.map(b=>b.layerId===id?{...b,offset:b.offset.map((n,i)=>i===index?value:n) as Point2}:b)}));
export function discardPlacementDraft(a:AssemblyDocument):AssemblyDocument {
 return a.placement?{...a,placement:{...a.placement,drafts:a.placement.drafts.filter(k=>!sameAngle(k,a.pose))}}:a;
}
export function deletePlacement(a:AssemblyDocument,id:string):AssemblyDocument {
 const r=a.placement,k=r?.keys.find(k=>k.id===id);if(!r||!k)return a;
 const keys=r.keys.filter(k=>k.id!==id),drafts=r.drafts.filter(d=>!sameAngle(d,k));return {...a,placement:{...r,keys,enabled:keys.length||drafts.length?r.enabled:false,drafts}};
}
export function visitPlacement(a:AssemblyDocument,id:string):AssemblyDocument {
 const k=[...a.placement?.keys??[],...a.placement?.drafts??[]].find(k=>k.id===id);
 return k?{...a,pose:{...a.pose,yaw:k.yaw,pitch:k.pitch},placement:{...a.placement!,enabled:true}}:a;
}
/** Import only compatible locator values from a full Assembly snapshot. */
export function importPlacement(a:AssemblyDocument,snapshotId:string):AssemblyDocument {
 const f=a.frames[snapshotId],snapshot=a.drawingSnapshots?.items.find(s=>s.id===snapshotId);
 if(!f||!snapshot)throw Error('此快照没有定位数据。');
 if(!f.locators.some(l=>a.locators.some(x=>x.id===l.id&&x.planeId===l.planeId)))throw Error('快照与当前构造没有对应定位点。');
 const imported=placementValues(f);
 const values:PlacementValues={planes:Object.fromEntries(Object.entries(imported.planes).filter(([id])=>a.planes.some(p=>p.id===id))),locators:Object.fromEntries(Object.entries(imported.locators).filter(([id])=>f.locators.some(l=>l.id===id&&a.locators.some(c=>c.id===id&&c.planeId===l.planeId)))),offsets:Object.fromEntries(Object.entries(imported.offsets).filter(([id,b])=>a.bindings.some(c=>c.layerId===id&&c.locatorId===b.locatorId)))};
 const key:PlacementKey={id:a.placement?.keys.find(k=>sameAngle(k,f.pose))?.id??crypto.randomUUID(),name:snapshot.name,yaw:yawAngle(f.pose.yaw),pitch:pitchAngle(f.pose.pitch),values};
 const r=a.placement??{version:1 as const,enabled:true,loop:false,base:placementValues(a),keys:[],drafts:[]};
 return {...a,pose:{...a.pose,yaw:key.yaw,pitch:key.pitch},placement:{...r,enabled:true,keys:[...r.keys.filter(k=>!sameAngle(k,key)),key],drafts:r.drafts.filter(k=>!sameAngle(k,key))}};
}
export function parsePlacement(value:unknown):PlacementRecording|undefined {
 if(value===undefined)return;
 const fail=():never=>{throw Error('定位录制数据无效');},r=value as PlacementRecording;
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v),point=(v:unknown)=>Array.isArray(v)&&v.length===2&&v.every(number);
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const values=(v:PlacementValues)=>{if(!v||!record(v.planes)||!record(v.locators)||!record(v.offsets))fail();
  if(!Object.values(v.planes).every(number)||!Object.values(v.locators).every(point)||!Object.values(v.offsets).every(b=>b&&typeof b.locatorId==='string'&&!!b.locatorId&&point(b.value)))fail();};
 if(!r||r.version!==1||typeof r.enabled!=='boolean'||typeof r.loop!=='boolean'||!Array.isArray(r.keys)||!Array.isArray(r.drafts))return fail();
 if(r.sparse!==undefined&&typeof r.sparse!=='boolean')fail();
 values(r.base);
 for(const list of [r.keys,r.drafts]){const ids=new Set<string>(),angles=new Set<string>();for(const k of list){
  if(!k||typeof k.id!=='string'||!k.id||ids.has(k.id)||typeof k.name!=='string'||!k.name.trim()||k.name.length>80||![k.yaw,k.pitch].every(number)||k.yaw!==yawAngle(k.yaw)||k.pitch!==pitchAngle(k.pitch))fail();
  const angle=`${k.yaw}:${k.pitch}`;if(angles.has(angle))fail();ids.add(k.id);angles.add(angle);values(k.values);
 }}
 return structuredClone(r);
}
