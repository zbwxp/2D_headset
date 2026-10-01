import {refinementEvaluation,saveRefinements,deleteCurveRefinement,type RefineTrack} from './refinement';
import {locatorProjection,type AssemblyDocument} from './model';
import {angleWeights,placementName,sameAngle,yawAngle,pitchAngle,type PlacementValues} from './placement';
import {bendEvaluation,saveBend,assertBend,type BendTrack} from './bending';
import {deformEvaluation,saveLayerDeform} from './deformRecording';
import {displayPath} from '../drawing/displayIntervals';
import {blendPoseIntervals} from '../recording/poseIntervals';
import {parseDrawing,type DrawingDocument,type StrokeDisplayIntervals} from '../drawing/model';

export type AssemblyStage='BASE'|'PLACEMENT'|'PERSPECTIVE'|'BEND'|'REFINE';
export type PoseChannel='placement'|'perspective'|'intervals'|'bend'|'refine';
export interface PoseAngle {yaw:number;pitch:number}
export interface PoseLabel extends PoseAngle {name:string}
export interface IntervalKey extends PoseAngle {id:string;tracks:StrokeDisplayIntervals[];curveIds?:string[]}
export interface LayerIntervalTrack {layerId:string;keys:IntervalKey[];drafts:IntervalKey[]}
/** Artwork stays shared. These are sparse authoring records, never screenshots. */
export interface AssemblyTimeline {
 version:1;base:PoseAngle;stage:AssemblyStage;applyIntervals:boolean;editingBase:boolean;
 loop:boolean;labels:PoseLabel[];intervals:LayerIntervalTrack[];bends?:BendTrack[];refinements?:RefineTrack[];
}
export const angleOf=(p:PoseAngle):PoseAngle=>({yaw:yawAngle(p.yaw),pitch:pitchAngle(p.pitch)});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const hasPlacementValues=(v:PlacementValues)=>Object.values(v).some(o=>Object.keys(o).length>0);

/** Existing recordings retain their authored values and angle coverage. */
export function ensureTimeline(a:AssemblyDocument,base?:PoseAngle):AssemblyDocument {
 if(a.timeline)return a;
 const recorded=!!(a.placement?.keys.length||a.deformRecording?.tracks.some(t=>t.keys.length));
 const initial=angleOf(base??(recorded?{yaw:0,pitch:0}:a.pose));
 const labels:PoseLabel[]=[];
 for(const k of a.placement?.keys??[])labels.push({...angleOf(k),name:k.name});
 return {...a,timeline:{version:1,base:initial,stage:a.perspectives?.some(p=>p.enabled)?'PERSPECTIVE':'PLACEMENT',applyIntervals:true,editingBase:false,loop:a.placement?.loop??a.deformRecording?.loop??false,labels,intervals:[]},
  ...(a.placement?{placement:{...a.placement,sparse:true,enabled:true}}:{}),...(a.deformRecording?{deformRecording:{...a.deformRecording,enabled:true,loop:a.placement?.loop??a.deformRecording.loop}}:{})};
}
export function setTimelineLoop(a:AssemblyDocument,loop:boolean):AssemblyDocument {
 a=ensureTimeline(a);return {...a,timeline:{...a.timeline!,loop},...(a.placement?{placement:{...a.placement,loop}}:{}),...(a.deformRecording?{deformRecording:{...a.deformRecording,loop}}:{})};
}
export function setTimelineStage(a:AssemblyDocument,stage:AssemblyStage):AssemblyDocument {
 a=ensureTimeline(a);return {...a,timeline:{...a.timeline!,stage,editingBase:false},...(a.placement?{placement:{...a.placement,enabled:true}}:{}),...(a.deformRecording?{deformRecording:{...a.deformRecording,enabled:true}}:{})};
}
export function setBaseEditing(a:AssemblyDocument,editingBase:boolean):AssemblyDocument {
 a=ensureTimeline(a);return {...a,timeline:{...a.timeline!,editingBase},...(!editingBase&&a.placement?{placement:{...a.placement,enabled:true}}:{}),...(!editingBase&&a.deformRecording?{deformRecording:{...a.deformRecording,enabled:true}}:{})};
}
export function setBaseAngle(a:AssemblyDocument,base:PoseAngle):AssemblyDocument {
 a=ensureTimeline(a);const old=a.timeline!.base;
 if(poseRows(a).some(r=>!sameAngle(r,old)&&r.saved))throw Error('已有其他角度的记录。请先保留当前基准，或在导入原稿时指定新基准。');
 const next=angleOf(base),pose={...a.pose,...angleOf(base)},bindings=a.bindings.map(b=>{const p=locatorProjection({...a,pose},b.locatorId);return {...b,reference:p.point,referenceScale:p.scale,offset:[0,0] as [number,number]};}),move=<T extends PoseAngle>(k:T):T=>sameAngle(k,old)?{...k,...next}:k;
 return {...a,pose,bindings,timeline:{...a.timeline!,base:next,refinements:a.timeline!.refinements?.map(t=>({...t,keys:t.keys.map(move),drafts:t.drafts.map(move)})),labels:a.timeline!.labels.map(move),bends:a.timeline!.bends?.map(t=>({...t,keys:t.keys.map(move),drafts:t.drafts.map(move)})),intervals:a.timeline!.intervals.map(t=>({...t,keys:t.keys.map(move),drafts:t.drafts.map(move)}))},
  ...(a.placement?{placement:{...a.placement,keys:a.placement.keys.map(move),drafts:a.placement.drafts.map(move)}}:{}),
  ...(a.deformRecording?{deformRecording:{...a.deformRecording,tracks:a.deformRecording.tracks.map(t=>({...t,keys:t.keys.map(move),drafts:t.drafts.map(move)}))}}:{})};
}

function layerIntervals(d:DrawingDocument,id:string):StrokeDisplayIntervals[]{
 const layer=d.layers.find(l=>l.id===id);return (d.displayIntervals??[]).filter(t=>layer?.items.includes(t.anchor.id));
}
const intervalDocuments=new WeakMap<DrawingDocument,WeakMap<IntervalKey,Map<string,DrawingDocument>>>();
function intervalDocument(d:DrawingDocument,key:IntervalKey,ids:string[]){
 let cache=intervalDocuments.get(d);if(!cache){cache=new WeakMap();intervalDocuments.set(d,cache);}
 let entry=cache.get(key);if(!entry){entry=new Map();cache.set(key,entry);}const group=ids.slice().sort().join(':');
 let doc=entry.get(group);if(!doc){doc={...d,displayIntervals:key.tracks.filter(t=>ids.includes(t.anchor.id))};entry.set(group,doc);}return doc;
}
const groupsCache=new WeakMap<DrawingDocument,Map<string,string[][]>>();
function strokeGroups(d:DrawingDocument,layerId:string):string[][] {
 let cache=groupsCache.get(d);if(!cache){cache=new Map();groupsCache.set(d,cache);}const hit=cache.get(layerId);if(hit)return hit;
 const seen=new Set<string>(),groups:string[][]=[];
 for(const c of d.curves.filter(c=>d.layers.find(l=>l.id===layerId)?.items.includes(c.id))){if(seen.has(c.id))continue;const ids=displayPath(d,c.id).segments.map(s=>s.id);ids.forEach(id=>seen.add(id));groups.push(ids);}
 cache.set(layerId,groups);return groups;
}
/** A switch holds the inner key until the next authored angle is reached.
 * Start at the source pose and travel outwards on either side; exact keys are
 * handled first. Pitch rows follow the same base-outward rule. */
function intervalStateSample(samples:{key:PoseAngle}[],base:PoseAngle):number {
 const distance=(p:PoseAngle)=>[Math.abs(p.pitch-base.pitch),Math.abs(yawAngle(p.yaw-base.yaw))];
 return samples.reduce((best,s,i)=>{const a=distance(s.key),b=distance(samples[best].key);return a[0]<b[0]||a[0]===b[0]&&a[1]<b[1]?i:best;},0);
}
export function intervalEvaluation(a:AssemblyDocument,id:string,includeDraft=true){
 const track=a.timeline?.intervals.find(t=>t.layerId===id),draft=includeDraft?track?.drafts.find(k=>sameAngle(k,a.pose)):undefined;
 if(a.timeline?.editingBase||!track)return {tracks:layerIntervals(a.drawing,id),draft:undefined,exact:undefined,covered:false};
 const global=angleWeights(track.keys,a.pose,a.timeline?.loop),tracks:StrokeDisplayIntervals[]=[];
 let covered=true;
 for(const ids of strokeGroups(a.drawing,id)){
  const owns=(k:IntervalKey)=>!k.curveIds||k.curveIds.some(id=>ids.includes(id));
  if(draft&&owns(draft)){tracks.push(...draft.tracks.filter(t=>ids.includes(t.anchor.id)));continue;}
  const keys=track.keys.filter(owns),e=angleWeights(keys,a.pose,a.timeline?.loop);if(keys.length>1)covered&&=e.covered;
  if(e.exact){tracks.push(...e.exact.tracks.filter(t=>ids.includes(t.anchor.id)));continue;}
  if(!e.samples.length){tracks.push(...layerIntervals(a.drawing,id).filter(t=>ids.includes(t.anchor.id)));continue;}
  tracks.push(...blendPoseIntervals(a.drawing,e.samples.map(s=>({drawing:intervalDocument(a.drawing,s.key,ids),weight:s.weight})),intervalStateSample(e.samples,a.timeline!.base)));
 }
 return {tracks,draft,exact:global.exact,covered};
}
const intervalCache=new WeakMap<AssemblyDocument,DrawingDocument>();
/** Kept separate from the apply switch, so hiding effects cannot erase their data. */
export function evaluatedIntervalDrawing(a:AssemblyDocument):DrawingDocument {
 if(!a.timeline?.intervals.length||a.timeline.editingBase)return a.drawing;
 const hit=intervalCache.get(a);if(hit)return hit;
 const owners=new Map(a.drawing.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const))),tracked=new Set(a.timeline.intervals.map(t=>t.layerId));
 const intervals=[...(a.drawing.displayIntervals??[]).filter(t=>!tracked.has(owners.get(t.anchor.id)!)),...a.timeline.intervals.flatMap(t=>intervalEvaluation(a,t.layerId).tracks)];
 const d={...a.drawing,displayIntervals:intervals};intervalCache.set(a,d);return d;
}
export function writeIntervalChanges(a:AssemblyDocument,edited:DrawingDocument):AssemblyDocument {
 if(!a.timeline||a.timeline.editingBase)return {...a,drawing:{...a.drawing,displayIntervals:edited.displayIntervals}};
 let tracks=a.timeline.intervals;
 for(const layer of a.drawing.layers){
  const before=intervalEvaluation(a,layer.id).tracks,next=layerIntervals(edited,layer.id);if(equal(before,next))continue;
  const old=tracks.find(t=>t.layerId===layer.id),previous=old?.drafts.find(k=>sameAngle(k,a.pose))??old?.keys.find(k=>sameAngle(k,a.pose));
  const changed=strokeGroups(a.drawing,layer.id).filter(ids=>!equal(before.filter(t=>ids.includes(t.anchor.id)),next.filter(t=>ids.includes(t.anchor.id)))).flat();
  const curveIds=[...new Set([...(old?.drafts.find(k=>sameAngle(k,a.pose))?.curveIds??[]),...changed])];
  const key:IntervalKey={...angleOf(a.pose),id:previous?.id??crypto.randomUUID(),tracks:structuredClone(next),curveIds};
  const baseline:IntervalKey={...a.timeline.base,id:crypto.randomUUID(),tracks:structuredClone(layerIntervals(a.drawing,layer.id))};
  const track={layerId:layer.id,keys:old?.keys??[baseline],drafts:[...(old?.drafts??[]).filter(k=>!sameAngle(k,key)),key]};
  tracks=old?tracks.map(t=>t.layerId===layer.id?track:t):[...tracks,track];
 }
 return tracks===a.timeline.intervals?a:{...a,timeline:{...a.timeline,intervals:tracks}};
}

/** Curve IDs survive a list move. Move their interval records with them instead
 * of dropping all non-base masks when an artist reorganizes the source layers. */
export function rehomeIntervalRecords(before:AssemblyDocument,after:AssemblyDocument):AssemblyDocument {
 if(!after.timeline?.intervals.length)return after;
 const owners=new Map(after.drawing.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const))),oldOwners=new Map(before.drawing.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const)));
 const curves=new Set(after.drawing.curves.map(c=>c.id));
 if(before.drawing.curves.every(c=>curves.has(c.id)&&owners.get(c.id)===oldOwners.get(c.id)))return after;
 const result=new Map<string,LayerIntervalTrack>();
 for(const track of after.timeline.intervals)for(const kind of ['keys','drafts'] as const)for(const key of track[kind]){
  const candidates=key.curveIds??before.drawing.curves.filter(c=>oldOwners.get(c.id)===track.layerId).map(c=>c.id);
  const grouped=new Map<string,string[]>();for(const id of candidates){const owner=owners.get(id);if(!owner||!curves.has(id))continue;grouped.set(owner,[...grouped.get(owner)??[],id]);}
  for(const [layerId,curveIds] of grouped){
   const dest=result.get(layerId)??{layerId,keys:[],drafts:[]},old=dest[kind].find(k=>sameAngle(k,key));
   const masks=key.tracks.filter(t=>owners.get(t.anchor.id)===layerId&&curves.has(t.anchor.id));
   const entry:IntervalKey={...key,id:old?.id??key.id,curveIds:[...new Set([...old?.curveIds??[],...curveIds])],tracks:[...(old?.tracks??[]).filter(t=>!masks.some(m=>m.id===t.id)),...masks]};
   dest[kind]=[...dest[kind].filter(k=>!sameAngle(k,key)),entry];result.set(layerId,dest);
  }
 }
 return {...after,timeline:{...after.timeline,intervals:[...result.values()]}};
}

export interface PoseRow extends PoseLabel {saved:boolean;dirty:boolean;channels:PoseChannel[]}
export function poseRows(a:AssemblyDocument):PoseRow[]{
 const rows:PoseRow[]=[],add=(k:PoseAngle,name?:string,channel?:PoseChannel,draft=false)=>{
  let r=rows.find(r=>sameAngle(r,k));if(!r){r={...angleOf(k),name:name??placementName(k),saved:false,dirty:false,channels:[]};rows.push(r);}
  if(draft)r.dirty=true;else r.saved=true;if(channel&&!r.channels.includes(channel))r.channels.push(channel);
 };
 if(a.timeline)add(a.timeline.base,'基准原稿');
 for(const l of a.timeline?.labels??[])add(l,l.name);
 for(const k of a.placement?.keys??[])if(hasPlacementValues(k.values))add(k,k.name,'placement');
 for(const k of a.placement?.drafts??[])if(hasPlacementValues(k.values))add(k,undefined,'placement',true);
 for(const t of a.deformRecording?.tracks??[]){t.keys.forEach(k=>add(k,undefined,'perspective'));t.drafts.forEach(k=>add(k,undefined,'perspective',true));}
 for(const t of a.timeline?.intervals??[]){t.keys.forEach(k=>add(k,undefined,'intervals'));t.drafts.forEach(k=>add(k,undefined,'intervals',true));}
 for(const t of a.timeline?.bends??[]){t.keys.forEach(k=>add(k,undefined,'bend'));t.drafts.forEach(k=>add(k,undefined,'bend',true));}
 for(const t of a.timeline?.refinements??[]){t.keys.forEach(k=>add(k,undefined,'refine'));t.drafts.forEach(k=>add(k,undefined,'refine',true));}
 for(const r of rows){const label=a.timeline?.labels.find(k=>sameAngle(k,r));if(label)r.name=label.name;}
 return rows.sort((a,b)=>a.pitch-b.pitch||a.yaw-b.yaw);
}
export function savePose(a:AssemblyDocument,name?:string):AssemblyDocument {
 a=ensureTimeline(a);if(a.timeline!.editingBase)throw Error('请先完成原稿编辑，再保存角度姿态。');
 let next=saveRefinements(a);
 const r=next.placement,d=r?.drafts.find(k=>sameAngle(k,a.pose));
 if(r&&d){
  const old=r.keys.find(k=>sameAngle(k,d)),values:PlacementValues={planes:{...old?.values.planes,...d.values.planes},locators:{...old?.values.locators,...d.values.locators},offsets:{...old?.values.offsets,...d.values.offsets}};
  next={...next,placement:{...r,enabled:true,keys:[...r.keys.filter(k=>!sameAngle(k,d)),{...d,values}],drafts:r.drafts.filter(k=>!sameAngle(k,d))}};
 }
 for(const t of a.deformRecording?.tracks??[])if(t.drafts.some(k=>sameAngle(k,a.pose)))next=saveLayerDeform(next,t.layerId);
 for(const t of a.timeline?.bends??[])if(t.drafts.some(k=>sameAngle(k,a.pose)))next=saveBend(next,t.layerId);
 const intervals=next.timeline!.intervals.map(t=>{const k=t.drafts.find(k=>sameAngle(k,a.pose));if(!k)return t;const old=t.keys.find(x=>sameAngle(x,k));
  const curveIds=k.curveIds&&(!old||old.curveIds)?[...new Set([...(old?.curveIds??[]),...k.curveIds])]:undefined;
  return {...t,keys:[...t.keys.filter(x=>!sameAngle(x,k)),{...k,curveIds}],drafts:t.drafts.filter(x=>!sameAngle(x,k))};});
 const label=name?.trim()||next.timeline!.labels.find(k=>sameAngle(k,a.pose))?.name||placementName(a.pose);if(label.length>80)throw Error('姿态名称最多 80 个字符。');
 return {...next,timeline:{...next.timeline!,intervals,labels:[...next.timeline!.labels.filter(k=>!sameAngle(k,a.pose)),{...angleOf(a.pose),name:label}]}};
}
export function discardPose(a:AssemblyDocument):AssemblyDocument {
 const keep=(k:PoseAngle)=>!sameAngle(k,a.pose);
 return {...a,...(a.placement?{placement:{...a.placement,drafts:a.placement.drafts.filter(keep)}}:{}),
  ...(a.deformRecording?{deformRecording:{...a.deformRecording,tracks:a.deformRecording.tracks.map(t=>({...t,drafts:t.drafts.filter(keep)}))}}:{}),
  ...(a.timeline?{timeline:{...a.timeline,refinements:a.timeline.refinements?.map(t=>({...t,drafts:t.drafts.filter(keep)})),bends:a.timeline.bends?.map(t=>({...t,drafts:t.drafts.filter(keep)})),intervals:a.timeline.intervals.map(t=>({...t,drafts:t.drafts.filter(keep)}))}}:{})};
}
export function visitPose(a:AssemblyDocument,angle:PoseAngle):AssemblyDocument {
 const next=a.timeline?setBaseEditing(a,false):a;
 return {...next,pose:{...next.pose,...angleOf(angle)}};
}
export function layerPoseStatus(a:AssemblyDocument,id:string,channel:PoseChannel):'draft'|'key'|'interpolated'|'outside'|'base'|'zero' {
 if(channel==='refine'){const ids=new Set(a.drawing.layers.find(l=>l.id===id)?.items);const tracks=a.timeline?.refinements?.filter(t=>ids.has(t.curveId))??[];if(!tracks.some(t=>t.keys.length||t.drafts.length))return 'zero';const es=tracks.map(t=>refinementEvaluation(a,t.curveId));return es.some(e=>e.draft)?'draft':es.some(e=>e.exact)?'key':es.every(e=>e.defaultZero)?'zero':es.some(e=>e.covered)?'interpolated':'outside';}
 if(channel==='bend'){const track=a.timeline?.bends?.find(t=>t.layerId===id);if(!track?.keys.length&&!track?.drafts.length)return 'base';const e=bendEvaluation(a,id);return e.draft?'draft':e.exact?'key':e.covered?'interpolated':'outside';}
 if(channel==='perspective'){
  const t=a.deformRecording?.tracks.find(t=>t.layerId===id);if(!t?.keys.length&&!t?.drafts.length)return 'base';
  const e=deformEvaluation(a,id);return e.draft?'draft':e.exact?'key':e.covered?'interpolated':'outside';
 }
 if(channel==='intervals'){
  const t=a.timeline?.intervals.find(t=>t.layerId===id);if(!t?.keys.length&&!t?.drafts.length)return 'base';
  const e=intervalEvaluation(a,id);return e.draft?'draft':e.exact?'key':e.covered?'interpolated':'outside';
 }
 const r=a.placement;if(!r)return 'base';
 // Shared locator/plane values are managed explicitly in the shared-point row.
 const keys=r.keys.filter(k=>k.values.offsets[id]),draft=r.drafts.find(k=>sameAngle(k,a.pose)&&k.values.offsets[id]);
 if(draft)return 'draft';if(!keys.length)return 'base';const e=angleWeights(keys,a.pose,r.loop);return e.exact?'key':e.covered?'interpolated':'outside';
}
export function deleteLayerPose(a:AssemblyDocument,id:string,channel?:PoseChannel):AssemblyDocument {
 const keep=(k:PoseAngle)=>!sameAngle(k,a.pose);let next=a;
 if(!channel||channel==='placement'){
  const remove=<T extends {values:PlacementValues}>(k:T):T=>{if(!sameAngle(k as T&PoseAngle,a.pose))return k;const offsets={...k.values.offsets};delete offsets[id];return {...k,values:{...k.values,offsets}};};
  if(a.placement)next={...next,placement:{...a.placement,keys:a.placement.keys.map(remove).filter(k=>hasPlacementValues(k.values)),drafts:a.placement.drafts.map(remove).filter(k=>hasPlacementValues(k.values))}};
 }
 if((!channel||channel==='perspective')&&a.deformRecording)next={...next,deformRecording:{...a.deformRecording,tracks:a.deformRecording.tracks.map(t=>t.layerId===id?{...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)}:t)}};
 if((!channel||channel==='intervals')&&a.timeline)next={...next,timeline:{...a.timeline,intervals:a.timeline.intervals.map(t=>t.layerId===id?{...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)}:t)}};
 if((!channel||channel==='bend')&&next.timeline)next={...next,timeline:{...next.timeline,bends:next.timeline.bends?.map(t=>t.layerId===id?{...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)}:t)}};
 if(!channel||channel==='refine')for(const curveId of a.drawing.layers.find(l=>l.id===id)?.items??[])next=deleteCurveRefinement(next,curveId);
 return next;
}
/** Shared geometry is visibly separate; deleting a layer must never delete it. */
export function deleteSharedPose(a:AssemblyDocument,kind:'locators'|'planes',id:string):AssemblyDocument {
 const r=a.placement;if(!r)return a;
 const remove=<T extends PoseAngle&{values:PlacementValues}>(k:T):T=>{if(!sameAngle(k,a.pose))return k;const values={...k.values,[kind]:{...k.values[kind]}};delete values[kind][id];return {...k,values};};
 return {...a,placement:{...r,keys:r.keys.map(remove).filter(k=>hasPlacementValues(k.values)),drafts:r.drafts.map(remove).filter(k=>hasPlacementValues(k.values))}};
}
export function deletePose(a:AssemblyDocument):AssemblyDocument {
 const keep=(k:PoseAngle)=>!sameAngle(k,a.pose);
 return {...a,...(a.placement?{placement:{...a.placement,keys:a.placement.keys.filter(keep),drafts:a.placement.drafts.filter(keep)}}:{}),
  ...(a.deformRecording?{deformRecording:{...a.deformRecording,tracks:a.deformRecording.tracks.map(t=>({...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)}))}}:{}),
  ...(a.timeline?{timeline:{...a.timeline,labels:a.timeline.labels.filter(keep),refinements:a.timeline.refinements?.map(t=>({...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)})),bends:a.timeline.bends?.map(t=>({...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)})),intervals:a.timeline.intervals.map(t=>({...t,keys:t.keys.filter(keep),drafts:t.drafts.filter(keep)}))}}:{})};
}
/** Add an intentional hold without sampling unrelated layers or channels. */
export function pinLayerPose(a:AssemblyDocument,id:string,channel:PoseChannel):AssemblyDocument {
 a=ensureTimeline(a);
 if(channel==='bend')return saveBend(a,id);
 if(channel==='perspective')return saveLayerDeform(a,id);
 if(channel==='intervals'){
  const old=a.timeline!.intervals.find(t=>t.layerId===id),k:IntervalKey={...angleOf(a.pose),id:old?.keys.find(k=>sameAngle(k,a.pose))?.id??crypto.randomUUID(),tracks:structuredClone(intervalEvaluation(a,id).tracks)};
  const baseline:IntervalKey={...a.timeline!.base,id:crypto.randomUUID(),tracks:structuredClone(layerIntervals(a.drawing,id))};
  const track={layerId:id,keys:[...(old?.keys??[baseline]).filter(x=>!sameAngle(x,k)),k],drafts:(old?.drafts??[]).filter(x=>!sameAngle(x,k))};
  return {...a,timeline:{...a.timeline!,intervals:old?a.timeline!.intervals.map(t=>t.layerId===id?track:t):[...a.timeline!.intervals,track]}};
 }
 return a;
}

export function parseTimeline(value:unknown,drawing:DrawingDocument):AssemblyTimeline|undefined {
 if(value===undefined)return;const t=value as AssemblyTimeline,fail=():never=>{throw Error('组装姿态数据无效');};
 const angle=(p:PoseAngle)=>p&&Number.isFinite(p.yaw)&&p.yaw===yawAngle(p.yaw)&&Number.isFinite(p.pitch)&&p.pitch===pitchAngle(p.pitch);
 if(!t||t.version!==1||!angle(t.base)||!['BASE','PLACEMENT','PERSPECTIVE','BEND','REFINE'].includes(t.stage)||![t.applyIntervals,t.editingBase,t.loop].every(x=>typeof x==='boolean')||!Array.isArray(t.labels)||!Array.isArray(t.intervals))return fail();
 const angles=new Set<string>();for(const l of t.labels){if(!angle(l)||typeof l.name!=='string'||!l.name.trim()||l.name.length>80||angles.has(`${l.yaw}:${l.pitch}`))fail();angles.add(`${l.yaw}:${l.pitch}`);}
 const layers=new Set<string>();for(const track of t.intervals){
  const layer=drawing.layers.find(l=>l.id===track?.layerId);if(!layer||layers.has(track.layerId)||!Array.isArray(track.keys)||!Array.isArray(track.drafts))fail();layers.add(track.layerId);
  for(const list of [track.keys,track.drafts]){const seen=new Set<string>(),ids=new Set<string>();for(const k of list){
   if(!angle(k)||typeof k.id!=='string'||!k.id||ids.has(k.id)||seen.has(`${k.yaw}:${k.pitch}`)||!Array.isArray(k.tracks)||k.tracks.some(t=>!layer!.items.includes(t?.anchor?.id)))fail();
   if(k.curveIds!==undefined&&(!Array.isArray(k.curveIds)||new Set(k.curveIds).size!==k.curveIds.length||k.curveIds.some(id=>!drawing.curves.some(c=>c.id===id)||!layer!.items.includes(id))))fail();
   ids.add(k.id);seen.add(`${k.yaw}:${k.pitch}`);parseDrawing({...drawing,displayIntervals:k.tracks});
  }}
 }
 if(t.bends!==undefined){
  if(!Array.isArray(t.bends))fail();const layers=new Set<string>();
  for(const track of t.bends){
   if(!drawing.layers.some(l=>l.id===track?.layerId)||layers.has(track.layerId)||!Array.isArray(track.keys)||!Array.isArray(track.drafts))fail();layers.add(track.layerId);
   for(const list of [track.keys,track.drafts]){const seen=new Set<string>(),ids=new Set<string>();for(const k of list){if(!angle(k)||typeof k.id!=='string'||!k.id||ids.has(k.id)||seen.has(`${k.yaw}:${k.pitch}`))fail();assertBend(k);ids.add(k.id);seen.add(`${k.yaw}:${k.pitch}`);}}
  }
 }
 if(t.refinements!==undefined){
  if(!Array.isArray(t.refinements))fail();const curves=new Set<string>();
  for(const track of t.refinements){if(!drawing.curves.some(c=>c.id===track?.curveId)||curves.has(track.curveId)||!Array.isArray(track.size)||track.size.length!==2||track.size.some(n=>!Number.isFinite(n)||n<=0)||!Array.isArray(track.keys)||!Array.isArray(track.drafts))fail();curves.add(track.curveId);
   for(const list of [track.keys,track.drafts]){const seen=new Set<string>();for(const k of list){if(!angle(k)||typeof k.id!=='string'||!k.id||seen.has(`${k.yaw}:${k.pitch}`)||!Array.isArray(k.delta)||k.delta.length!==4||k.delta.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>100)))fail();if(k.controls!==undefined&&(!Array.isArray(k.controls)||new Set(k.controls).size!==k.controls.length||k.controls.some(i=>!Number.isInteger(i)||i<0||i>3)))fail();seen.add(`${k.yaw}:${k.pitch}`);}}
  }
 }
 return structuredClone(t);
}
