import type {AssemblyDocument,AssemblyFrame,AssemblyPose} from './model';
import {angleWeights,sameAngle,yawAngle,pitchAngle,placementName,resolvePlacement} from './placement';
import {assertPerspective,neutralQuad,type LayerPerspective} from './perspective';
import {quadProjection,type Quad} from '../drawing/deform';
import type {Point2} from '../drawing/model';

export interface DeformValue {quad:Quad;enabled:boolean}
export interface DeformKey extends DeformValue {id:string;name:string;yaw:number;pitch:number}
export interface LayerDeformTrack {layerId:string;keys:DeformKey[];drafts:DeformKey[]}
export interface DeformRecording {version:1;enabled:boolean;loop:boolean;tracks:LayerDeformTrack[]}
type WithRecording=AssemblyFrame&{deformRecording?:DeformRecording};
const unit={min:[0,0] as Point2,max:[1,1] as Point2};
const shortAngle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
function parameters(q:Quad){
 const {matrix:m,map}=quadProjection(unit,q),g=m[6],h=m[7];
 const ax=m[0]-m[2]*g,ay=m[3]-m[5]*g,bx=m[1]-m[2]*h,by=m[4]-m[5]*h;
 const sx=Math.hypot(ax,ay),sy=(ax*by-ay*bx)/sx;
 return {center:map([.5,.5]),angle:Math.atan2(ay,ax),sx,sy,shear:(ax*bx+ay*by)/(sx*sy),g,h};
}
/** Interpolate a homography's translation, shortest rotation, positive QR scales,
 * shear and perspective denominator. Raw corner/matrix lerp can collapse a 180°
 * rotation; positive scales and positive corner denominators avoid that fold. */
export function interpolateDeform(a:DeformValue,b:DeformValue,t:number):DeformValue {
 if(t<=1e-12)return a;if(t>=1-1e-12)return b;
 const p=parameters(a.enabled?a.quad:neutralQuad()),q=parameters(b.enabled?b.quad:neutralQuad());
 const mix=(a:number,b:number)=>a+(b-a)*t,angle=p.angle+shortAngle(q.angle-p.angle)*t;
 const sx=Math.exp(mix(Math.log(p.sx),Math.log(q.sx))),sy=Math.exp(mix(Math.log(p.sy),Math.log(q.sy)));
 const shear=mix(p.shear,q.shear),g=mix(p.g,q.g),h=mix(p.h,q.h),c=Math.cos(angle),s=Math.sin(angle);
 const ax=c*sx,ay=s*sx,bx=sy*(c*shear-s),by=sy*(s*shear+c);
 const cx=mix(p.center[0],q.center[0]),cy=mix(p.center[1],q.center[1]),den=1+(g+h)/2;
 const x0=cx-(ax+bx)/2/den,y0=cy-(ay+by)/2/den;
 const quad=neutralQuad().map(([u,v])=>[x0+(ax*u+bx*v)/(1+g*u+h*v),y0+(ay*u+by*v)/(1+g*u+h*v)] as Point2) as Quad;
 const value={quad,enabled:a.enabled||b.enabled};assertValue(value);return value;
}
const assertValue=(v:DeformValue)=>assertPerspective({layerId:'validate',source:unit,quad:v?.quad,enabled:v?.enabled});
export function deformEvaluation(a:WithRecording,layerId:string,includeDraft=true){
 const r=a.deformRecording,track=r?.tracks.find(t=>t.layerId===layerId),base=a.perspectives?.find(p=>p.layerId===layerId);
 if(!r?.enabled||!track||!base)return {value:base,covered:false,issue:false,draft:undefined as DeformKey|undefined,exact:undefined as DeformKey|undefined};
 const draft=includeDraft?track.drafts.find(k=>sameAngle(k,a.pose)):undefined;
 if(draft)return {value:{...base,quad:draft.quad,enabled:draft.enabled},covered:true,issue:false,draft,exact:undefined};
 const e=angleWeights(track.keys,a.pose,r.loop);
 if(!e.samples.length)return {value:base,covered:false,issue:false,draft,exact:e.exact};
 try{
  // Blend yaw within each pitch row first, then blend rows. This keeps shortest
  // rotation choices consistent instead of averaging four unrelated angle wraps.
  const rows=new Map<number,{value:DeformValue;weight:number}>();
  for(const sample of e.samples){if(sample.weight<=0)continue;const old=rows.get(sample.key.pitch);
   rows.set(sample.key.pitch,old?{value:interpolateDeform(old.value,sample.key,sample.weight/(old.weight+sample.weight)),weight:old.weight+sample.weight}:{value:sample.key,weight:sample.weight});
  }
  let value:DeformValue|undefined,weight=0;
  for(const row of rows.values()){value=value?interpolateDeform(value,row.value,row.weight/(weight+row.weight)):row.value;weight+=row.weight;}
  return {value:{...base,quad:value!.quad,enabled:value!.enabled},covered:e.covered,issue:false,draft,exact:e.exact};
 }catch{
  // Extreme imported values must not bring down the entire editor/render tree.
  const nearest=e.samples.reduce((a,b)=>a.weight>=b.weight?a:b).key;
  return {value:{...base,quad:nearest.quad,enabled:nearest.enabled},covered:e.covered,issue:true,draft,exact:e.exact};
 }
}
const cache=new WeakMap<object,LayerPerspective[]>();
export function resolvedPerspectives(a:WithRecording):LayerPerspective[]{
 if(!a.deformRecording?.enabled)return a.perspectives??[];
 let result=cache.get(a);if(!result){result=(a.perspectives??[]).map(p=>deformEvaluation(a,p.layerId).value!);cache.set(a,result);}return result;
}
export function resolvedAssemblyFrame(a:WithRecording):AssemblyFrame {
 const perspectives=resolvedPerspectives(a);return {...resolvePlacement(a),perspectives:perspectives.length?perspectives:undefined};
}
export function sameDeformSnapshotFrame(a:AssemblyDocument,f:AssemblyFrame|undefined):boolean {
 if(!f)return false;const current=resolvedAssemblyFrame(a);
 // Disabled frames retained solely for a paused motion track are not edits to
 // a snapshot that predates the deformer. Keep them available for playback.
 const perspectives=current.perspectives?.filter(p=>a.deformRecording?.enabled||p.enabled||f.perspectives?.some(q=>q.layerId===p.layerId)||!deformTrack(a,p.layerId));
 const plain=(v:AssemblyFrame)=>({pose:v.pose,planes:v.planes,locators:v.locators,bindings:v.bindings,...(v.perspectives?.length?{perspectives:v.perspectives}:{})});
 return JSON.stringify(plain({...current,perspectives}))===JSON.stringify(plain(f));
}
export const deformTrack=(a:WithRecording,id:string)=>a.deformRecording?.tracks.find(t=>t.layerId===id);
const keyAt=(pose:AssemblyPose,value:DeformValue,old?:DeformKey):DeformKey=>({id:old?.id??crypto.randomUUID(),name:old?.name??placementName(pose),yaw:yawAngle(pose.yaw),pitch:pitchAngle(pose.pitch),quad:structuredClone(value.quad),enabled:value.enabled});
function trackChange(a:AssemblyDocument,track:LayerDeformTrack):AssemblyDocument {
 const r=a.deformRecording!;return {...a,deformRecording:{...r,tracks:r.tracks.map(t=>t.layerId===track.layerId?track:t)}};
}
/** A recorded layer edits an angle-local draft. Other layers keep the existing
 * static deformer behavior until their first explicit recording. */
export function writeLayerPerspective(a:AssemblyDocument,p:LayerPerspective):AssemblyDocument {
 assertPerspective(p);let track=deformTrack(a,p.layerId);const old=a.perspectives?.find(x=>x.layerId===p.layerId);
 if(a.timeline&&!a.timeline.editingBase&&!track){
  const base=old??{...p,quad:neutralQuad(),enabled:true};
  track={layerId:p.layerId,keys:[keyAt({...a.pose,...a.timeline.base},base)],drafts:[]};
  a={...a,perspectives:old?a.perspectives:[...a.perspectives??[],base],deformRecording:{version:1,enabled:true,loop:a.timeline.loop,tracks:[...a.deformRecording?.tracks??[],track]}};
 }
 if(track&&(a.timeline?!a.timeline.editingBase:a.deformRecording?.enabled)){
  const current=deformEvaluation(a,p.layerId).value!;
  if(JSON.stringify([current.quad,current.enabled])===JSON.stringify([p.quad,p.enabled]))return a;
  const key=keyAt(a.pose,p,track.drafts.find(k=>sameAngle(k,a.pose))??track.keys.find(k=>sameAngle(k,a.pose)));
  return trackChange(a,{...track,drafts:[...track.drafts.filter(k=>!sameAngle(k,key)),key]});
 }
 if(JSON.stringify(old)===JSON.stringify(p))return a;
 return {...a,perspectives:old?a.perspectives!.map(x=>x.layerId===p.layerId?p:x):[...a.perspectives??[],p]};
}
export function saveLayerDeform(a:AssemblyDocument,layerId:string):AssemblyDocument {
 const value=resolvedPerspectives(a).find(p=>p.layerId===layerId);if(!value)throw Error('先为当前图层创建四角变形。');
 const track=deformTrack(a,layerId);if(track&&!a.deformRecording?.enabled&&!a.timeline)throw Error('请先开启变形录制预览。');
 const key=keyAt(a.pose,value,track?.drafts.find(k=>sameAngle(k,a.pose))??track?.keys.find(k=>sameAngle(k,a.pose)));
 // Artwork is the front reference. Starting from a turned pose preserves that
 // reference explicitly, instead of silently applying the side shape everywhere.
 const front:DeformKey=keyAt({...a.pose,...a.timeline?.base??{yaw:0,pitch:0}},{quad:neutralQuad(),enabled:true});
 const keys=track?.keys??(sameAngle(key,front)?[]:[front]);
 const next={layerId,keys:[...keys.filter(k=>!sameAngle(k,key)),key],drafts:(track?.drafts??[]).filter(k=>!sameAngle(k,key))};
 const r=a.deformRecording??{version:1 as const,enabled:true,loop:a.placement?.loop??false,tracks:[]};
 return {...a,deformRecording:{...r,enabled:true,tracks:track?r.tracks.map(t=>t.layerId===layerId?next:t):[...r.tracks,next]}};
}
export function discardLayerDeform(a:AssemblyDocument,id:string):AssemblyDocument {
 const track=deformTrack(a,id);return track?trackChange(a,{...track,drafts:track.drafts.filter(k=>!sameAngle(k,a.pose))}):a;
}
export function deleteLayerDeformKey(a:AssemblyDocument,id:string,keyId:string):AssemblyDocument {
 const track=deformTrack(a,id),key=track?.keys.find(k=>k.id===keyId);if(!track||!key)return a;
 return trackChange(a,{...track,keys:track.keys.filter(k=>k.id!==keyId),drafts:track.drafts.filter(k=>!sameAngle(k,key))});
}
export function visitLayerDeform(a:AssemblyDocument,id:string,keyId:string):AssemblyDocument {
 const track=deformTrack(a,id),key=[...track?.keys??[],...track?.drafts??[]].find(k=>k.id===keyId);
 return key?{...a,pose:{...a.pose,yaw:key.yaw,pitch:key.pitch},deformRecording:{...a.deformRecording!,enabled:true}}:a;
}
export function parseDeformRecording(value:unknown,perspectives:LayerPerspective[]=[]):DeformRecording|undefined {
 if(value===undefined)return;
 const r=value as DeformRecording,fail=():never=>{throw Error('图层变形录制数据无效');};
 if(!r||r.version!==1||typeof r.enabled!=='boolean'||typeof r.loop!=='boolean'||!Array.isArray(r.tracks))return fail();
 const layers=new Set<string>();
 for(const track of r.tracks){
  if(!track||typeof track.layerId!=='string'||layers.has(track.layerId)||!perspectives.some(p=>p.layerId===track.layerId)||!Array.isArray(track.keys)||!Array.isArray(track.drafts))fail();
  layers.add(track.layerId);
  for(const list of [track.keys,track.drafts]){const ids=new Set<string>(),angles=new Set<string>();for(const k of list){
   if(!k||typeof k.id!=='string'||!k.id||ids.has(k.id)||typeof k.name!=='string'||!k.name.trim()||k.name.length>80||!Number.isFinite(k.yaw)||!Number.isFinite(k.pitch)||k.yaw!==yawAngle(k.yaw)||k.pitch!==pitchAngle(k.pitch))fail();
   const angle=`${k.yaw}:${k.pitch}`;if(angles.has(angle))fail();ids.add(k.id);angles.add(angle);assertValue(k);
  }}
 }
 return structuredClone(r);
}
