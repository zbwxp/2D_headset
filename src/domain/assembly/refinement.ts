import {layerProjection} from './projection';
import type {AssemblyDocument} from './model';
import {angleWeights,sameAngle,yawAngle,pitchAngle} from './placement';
import {createPerspective} from './perspective';
import {curveById,layerFor,shapeOf,members,nodeAt,type Cubic,type Point2} from '../drawing/model';
import {point} from '../drawing/sampling';
import {curveSamples} from '../drawing/curveProvenance';
export interface RefineKey {id:string;yaw:number;pitch:number;delta:Cubic;controls?:number[]}
export interface RefineTrack {curveId:string;size:Point2;keys:RefineKey[];drafts:RefineKey[]}
export const zeroCorrection=():Cubic=>[[0,0],[0,0],[0,0],[0,0]];
type Angle={yaw:number;pitch:number};
interface RefineFrames {saved:Angle[];draft:boolean}
const frameCache=new WeakMap<AssemblyDocument,Map<string,RefineFrames>>();
/** A layer pose with no authored correction is a zero-offset boundary. Keep
 * these implicit: do not serialize four zero vectors for every curve/pose.
 * Unrelated layer keys and mere angle labels must not stop interpolation. */
function refinementFrames(a:AssemblyDocument,layerId:string):RefineFrames {
 let cache=frameCache.get(a);if(!cache){cache=new Map();frameCache.set(a,cache);}const hit=cache.get(layerId);if(hit)return hit;
 const saved:Angle[]=[],add=(k:Angle)=>{if(!saved.some(s=>sameAngle(s,k)))saved.push({yaw:k.yaw,pitch:k.pitch});};
 if(a.timeline)add(a.timeline.base);
 const items=new Set(a.drawing.layers.find(l=>l.id===layerId)?.items);
 const tracks=[...a.deformRecording?.tracks.filter(t=>t.layerId===layerId)??[],...a.timeline?.bends?.filter(t=>t.layerId===layerId)??[],...a.timeline?.intervals.filter(t=>t.layerId===layerId)??[],...a.timeline?.refinements?.filter(t=>items.has(t.curveId))??[]];
 let draft=false;
 for(const t of tracks){t.keys.forEach(add);draft ||= t.drafts.some(k=>sameAngle(k,a.pose));}
 const binding=a.bindings.find(b=>b.layerId===layerId),locator=a.locators.find(l=>l.id===binding?.locatorId);
 const relevant=(k:NonNullable<AssemblyDocument['placement']>['keys'][number])=>k.values.offsets[layerId]!==undefined||!!binding&&(k.values.locators[binding.locatorId]!==undefined||!!locator&&k.values.planes[locator.planeId]!==undefined);
 a.placement?.keys.filter(relevant).forEach(add);
 draft ||= !!a.placement?.drafts.some(k=>sameAngle(k,a.pose)&&relevant(k));
 const result={saved,draft};cache.set(layerId,result);return result;
}
export function refinementEvaluation(a:AssemblyDocument,id:string){
 const track=a.timeline?.refinements?.find(t=>t.curveId===id),draft=track?.drafts.find(k=>sameAngle(k,a.pose)),e=angleWeights(track?.keys??[],a.pose,a.timeline?.loop);
 const layer=layerFor(a.drawing,id),frames=layer?refinementFrames(a,layer.id):{saved:[],draft:false};
 const saved=frames.saved.map(k=>({...k,delta:zeroCorrection(),...track?.keys.find(s=>sameAngle(s,k))})),weights=angleWeights(saved,a.pose,a.timeline?.loop);
 const owns=(k:RefineKey,i:number)=>!k.controls||k.controls.includes(i);
 const delta=zeroCorrection().map((_,i)=>{
  if(draft&&owns(draft,i))return draft.delta[i];
  // Starting a new layer frame uses zero, not the currently interpolated offset.
  // When revising an existing frame, retain its authored controls.
  if(frames.draft)return e.exact&&owns(e.exact,i)?e.exact.delta[i]:[0,0];
  return [0,1].map(j=>weights.samples.reduce((n,s)=>n+s.weight*(!s.key.controls||s.key.controls.includes(i)?s.key.delta[i][j]:0),0));
 }) as Cubic;
 return {delta,size:track?.size??[1,1] as Point2,draft,exact:e.exact,covered:weights.covered,defaultZero:!draft&&!e.exact&&(frames.draft||!!weights.exact)};
}
/** Explicitly entering correction authoring at a new, unrecorded angle starts
 * the layer at zero. Visiting/rotating through an intermediate angle only
 * evaluates it and must never create keys. */
export function beginRefinementFrame(a:AssemblyDocument,layerIds:string[]):AssemblyDocument {
 let next=a;
 for(const layerId of layerIds){
  const frames=refinementFrames(next,layerId);if(frames.draft||frames.saved.some(k=>sameAngle(k,next.pose)))continue;
  const layer=next.drawing.layers.find(l=>l.id===layerId);if(layer?.locked)continue;
  const ids=new Set(layer?.items);
  for(const tr of next.timeline?.refinements??[])if(ids.has(tr.curveId)&&!curveById(next.drawing,tr.curveId)?.locked)next=writeRefinement(next,tr.curveId,zeroCorrection());
 }
 return next;
}
export const refinementApplied=(a:AssemblyDocument)=>!a.timeline?.editingBase&&a.timeline?.stage==='REFINE';
export function refinementProjector(a:AssemblyDocument,map:(p:Point2)=>Point2,vector:(p:Point2)=>Point2=p=>p){
 const values=new Map((a.timeline?.refinements??[]).map(t=>[t.curveId,refinementEvaluation(a,t.curveId)]));
 return (p:Point2,s?:Cubic,t=0):Point2=>{
  const q=map(p);if(!s||!refinementApplied(a))return q;let x=0,y=0;
  for(const sample of curveSamples(s,t)){const v=values.get(sample.id);if(!v)continue;const d=point(v.delta,sample.t);x+=d[0]*v.size[0]*sample.weight;y+=d[1]*v.size[1]*sample.weight;}
  const delta=vector([x,y]);return [q[0]+delta[0],q[1]+delta[1]];
 };
}
/** Tangent handles of F(C), not F(control points). Zero correction keeps F(C)
 * exactly; a cubic displacement is added AFTER all region/placement transforms. */
export function refinedControls(a:AssemblyDocument,id:string,map:(p:Point2)=>Point2,vector:(p:Point2)=>Point2=p=>p):Cubic {
 const s=shapeOf(a.drawing,id),f=(t:number)=>map(point(s,t)),p=f(0),q=f(1),h=1e-5,v=f(h),w=f(1-h),delta=refinementEvaluation(a,id),enabled=refinementApplied(a);
 const controls:Cubic=[p,[p[0]+(v[0]-p[0])/(3*h),p[1]+(v[1]-p[1])/(3*h)],[q[0]-(q[0]-w[0])/(3*h),q[1]-(q[1]-w[1])/(3*h)],q];
 return controls.map((p,i)=>{const d=enabled?vector([delta.delta[i][0]*delta.size[0],delta.delta[i][1]*delta.size[1]]):[0,0];return [p[0]+d[0],p[1]+d[1]];}) as Cubic;
}
export function writeRefinement(a:AssemblyDocument,id:string,delta:Cubic,controls:number[]=[0,1,2,3]):AssemblyDocument {
 if(!a.timeline||a.timeline.editingBase)throw Error('单线微调只写入角度姿态，请先退出原稿编辑。');
 if(!curveById(a.drawing,id)||curveById(a.drawing,id).locked)throw Error('相连曲线已锁定，无法微调。');
 if(delta.length!==4||delta.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>100)))throw Error('微调数据无效');
 const old=a.timeline.refinements?.find(t=>t.curveId===id);let size=old?.size;
 if(!size){const layer=layerFor(a.drawing,id)!;const frame=a.perspectives?.find(p=>p.layerId===layer.id)??createPerspective(a.drawing,layer.id);size=[Math.max(.001,frame.source.max[0]-frame.source.min[0]),Math.max(.001,frame.source.max[1]-frame.source.min[1])];}
 const previous=old?.drafts.find(k=>sameAngle(k,a.pose))??old?.keys.find(k=>sameAngle(k,a.pose));
 const key:RefineKey={controls:[...new Set([...(previous?(previous.controls??[0,1,2,3]):[]),...controls])],id:old?.drafts.find(k=>sameAngle(k,a.pose))?.id??old?.keys.find(k=>sameAngle(k,a.pose))?.id??crypto.randomUUID(),yaw:yawAngle(a.pose.yaw),pitch:pitchAngle(a.pose.pitch),delta:structuredClone(delta)};
 const track:RefineTrack={curveId:id,size,keys:old?.keys??[{...a.timeline.base,id:crypto.randomUUID(),delta:zeroCorrection()}],drafts:[...old?.drafts.filter(k=>!sameAngle(k,a.pose))??[],key]};
 return {...a,timeline:{...a.timeline,refinements:[...a.timeline.refinements?.filter(t=>t.curveId!==id)??[],track]}};
}
/** A logical node remains one node, including explicit endpoint bindings. */
export function moveRefinedControl(a:AssemblyDocument,id:string,index:0|1|2|3,movement:Point2):AssemblyDocument {
 if(Math.hypot(...movement)<1e-10)return a;
 const layer=layerFor(a.drawing,id);if(layer)a=beginRefinementFrame(a,[layer.id]);
 const edits=new Map<string,Map<number,Point2>>(),add=(id:string,index:number)=>{const e=edits.get(id)??new Map<number,Point2>();e.set(index,movement);edits.set(id,e);};
 if(index===1||index===2){
  add(id,index);const end=index===1?0:1;
  const controls=(id:string)=>{const p=layerProjection(a,layerFor(a.drawing,id)!.id,{width:0,height:0,unit:1,pan:[0,0]});return refinedControls(a,id,q=>{const s=p.mapCanonical(q);return [s[0],-s[1]];});};
  for(const join of a.drawing.joins.filter(j=>j.mode==='SMOOTH')){
   const other=join.a.curveId===id&&join.a.end===end?join.b:join.b.curveId===id&&join.b.end===end?join.a:undefined;if(!other)continue;
   const c=controls(id),q=controls(other.curveId),anchor=c[end?3:0],handle=q[other.end?2:1],origin=q[other.end?3:0],v=[c[index][0]+movement[0]-anchor[0],c[index][1]+movement[1]-anchor[1]],length=Math.hypot(handle[0]-origin[0],handle[1]-origin[1]),size=Math.hypot(...v);if(size<1e-8)continue;
   const map=new Map<number,Point2>();map.set(other.end?2:1,[origin[0]-v[0]*length/size-handle[0],origin[1]-v[1]*length/size-handle[1]]);edits.set(other.curveId,map);
  }
 }
 else {
  const nodeIds=new Set([curveById(a.drawing,id).nodes[index===0?0:1]]);let more=true;
  while(more){more=false;for(const link of a.drawing.endpointLinks??[]){const x=nodeAt(a.drawing,link.a).id,y=nodeAt(a.drawing,link.b).id;if(nodeIds.has(x)!==nodeIds.has(y)){nodeIds.add(x);nodeIds.add(y);more=true;}}}
  for(const node of nodeIds)for(const e of members(a.drawing,node)){add(e.curveId,e.end?3:0);add(e.curveId,e.end?2:1);}
 }
 let next=a;
 for(const [curveId,changes] of edits){
  // Initialize a fixed local normalization frame before converting world deltas.
  if(!next.timeline?.refinements?.some(t=>t.curveId===curveId))next=writeRefinement(next,curveId,zeroCorrection(),[]);
  const v=refinementEvaluation(next,curveId),delta=structuredClone(v.delta);for(const [i,m] of changes){delta[i][0]+=m[0]/v.size[0];delta[i][1]+=m[1]/v.size[1];}
  next=writeRefinement(next,curveId,delta,[...changes.keys()]);
 }
 return next;
}
export function saveRefinements(a:AssemblyDocument):AssemblyDocument {
 if(!a.timeline?.refinements)return a;return {...a,timeline:{...a.timeline,refinements:a.timeline.refinements.map(t=>{const k=t.drafts.find(k=>sameAngle(k,a.pose));return k?{...t,keys:[...t.keys.filter(x=>!sameAngle(x,k)),k],drafts:t.drafts.filter(x=>!sameAngle(x,k))}:t;})}};
}
export function deleteCurveRefinement(a:AssemblyDocument,id:string):AssemblyDocument {
 if(!a.timeline)return a;
 const affected=new Map<string,Set<number>>([[id,new Set([0,1,2,3])]]),track=a.timeline.refinements?.find(t=>t.curveId===id),keys=[...track?.keys??[],...track?.drafts??[]].filter(k=>sameAngle(k,a.pose)),c=curveById(a.drawing,id);
 if(c)for(const end of [0,1] as const){
  if(!keys.some(k=>!k.controls||k.controls.includes(end?3:0)))continue;
  const nodes=new Set([c.nodes[end]]);let more=true;while(more){more=false;for(const link of a.drawing.endpointLinks??[]){const x=nodeAt(a.drawing,link.a).id,y=nodeAt(a.drawing,link.b).id;if(nodes.has(x)!==nodes.has(y)){nodes.add(x);nodes.add(y);more=true;}}}
  for(const node of nodes)for(const other of members(a.drawing,node)){const set=affected.get(other.curveId)??new Set<number>();set.add(other.end?3:0);set.add(other.end?2:1);affected.set(other.curveId,set);}
 }
 return {...a,timeline:{...a.timeline,refinements:a.timeline.refinements?.map(t=>{
  const controls=affected.get(t.curveId);if(!controls)return t;
  const remove=(list:RefineKey[])=>list.flatMap(k=>{if(!sameAngle(k,a.pose))return [k];const remaining=(k.controls??[0,1,2,3]).filter(i=>!controls.has(i));return remaining.length?[{...k,controls:remaining}]:[];});
  return {...t,keys:remove(t.keys),drafts:remove(t.drafts)};
 })}};
}
