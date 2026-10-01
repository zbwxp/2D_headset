import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {evaluatedIntervalDrawing,parseTimeline,type AssemblyTimeline} from './timeline';
import {resolvePlacement,parsePlacement,type PlacementRecording} from './placement';
import {parseDeformRecording,type DeformRecording} from './deformRecording';
import {assertPerspective,rebasePerspective,type LayerPerspective} from './perspective';
import {emptyDrawing,parseDrawing,layerFor,type DrawingDocument,type Point2,type InkEnds} from '../drawing/model';
import {parseDrawingSnapshots,type DrawingSnapshots} from '../drawing/snapshots';
import {parseViewSlots,type AssemblyViewSlot} from './viewSlots';
export type Vec3=[number,number,number];
export interface AssemblyPose {yaw:number;pitch:number;roll:number;position:Vec3;distance:number}
export interface LocatorPlane {id:string;name:string;height:number}
export interface Locator {id:string;name:string;planeId:string;x:number;z:number}
export interface LayerBinding {layerId:string;locatorId:string;anchor:Point2;reference:Point2;referenceScale:number;offset:Point2}
export interface AssemblyFrame {pose:AssemblyPose;planes:LocatorPlane[];locators:Locator[];bindings:LayerBinding[];perspectives?:LayerPerspective[]}
export interface AssemblyDocument extends AssemblyFrame {version:1;timeline?:AssemblyTimeline;drawing:DrawingDocument;drawingSnapshots?:DrawingSnapshots;frames:Record<string,AssemblyFrame>;placement?:PlacementRecording;deformRecording?:DeformRecording;viewSlots?:AssemblyViewSlot[];activeViewSlotId?:string;followAxisRotation?:boolean}
export const frontPose=():AssemblyPose=>({yaw:0,pitch:0,roll:0,position:[0,0,0],distance:6});
export function createAssembly(drawing:DrawingDocument=emptyDrawing()):AssemblyDocument {
 return {version:1,drawing:structuredClone(drawing),pose:frontPose(),planes:[{id:'eyes',name:'眉眼定位面',height:.35},{id:'nose',name:'鼻部定位面',height:0},{id:'jaw',name:'下颌定位面',height:-.65}],locators:[
 {id:'brow',name:'眉心',planeId:'eyes',x:0,z:.8},{id:'eye-l',name:'左眼',planeId:'eyes',x:-.4,z:.7},{id:'eye-r',name:'右眼',planeId:'eyes',x:.4,z:.7},
 {id:'nose-tip',name:'鼻尖',planeId:'nose',x:0,z:1},{id:'ear-l',name:'左耳根',planeId:'nose',x:-.85,z:0},{id:'ear-r',name:'右耳根',planeId:'nose',x:.85,z:0},
 {id:'chin',name:'下巴',planeId:'jaw',x:0,z:.6}],bindings:[],frames:{}};
}
export const frameOf=(a:AssemblyFrame):AssemblyFrame=>({pose:a.pose,planes:a.planes,locators:a.locators,bindings:a.bindings,...(a.perspectives?.length?{perspectives:a.perspectives}:{})});
/** Rz(roll) Rx(pitch) Ry(yaw): pitch/roll tilt the main axis; yaw spins around it.
 * Applying yaw last in world space would make tilted locators orbit world Y instead. */
export function rotateLocal([x,y,z]:Vec3,p:AssemblyPose):Vec3 {
 const r=p.roll*Math.PI/180,t=p.pitch*Math.PI/180,w=p.yaw*Math.PI/180;
 const wx=x*Math.cos(w)+z*Math.sin(w),wz=-x*Math.sin(w)+z*Math.cos(w);
 const ty=y*Math.cos(t)-wz*Math.sin(t),tz=y*Math.sin(t)+wz*Math.cos(t);
 return [wx*Math.cos(r)-ty*Math.sin(r),wx*Math.sin(r)+ty*Math.cos(r),tz];
}
export function worldPoint(local:Vec3,p:AssemblyPose):Vec3 {const q=rotateLocal(local,p);return q.map((v,i)=>v+p.position[i]) as Vec3;}
export function projectWorld(q:Vec3,p:AssemblyPose){const scale=p.distance/Math.max(.5,p.distance-q[2]);return {point:[q[0]*scale,q[1]*scale] as Point2,scale,depth:q[2]};}
export function locatorProjection(a:AssemblyFrame,id:string){a=resolvePlacement(a);const l=a.locators.find(x=>x.id===id);if(!l)throw Error('定位点不存在');const plane=a.planes.find(p=>p.id===l.planeId);if(!plane)throw Error('定位面不存在');const world=worldPoint([l.x,plane.height,l.z],a.pose);return {...projectWorld(world,a.pose),world};}
export interface LayerTransform {scale:number;translation:Point2}
const identity:LayerTransform={scale:1,translation:[0,0]};
export function layerTransform(a:AssemblyFrame,layerId:string):LayerTransform {
 const timeline=(a as AssemblyDocument).timeline;if(timeline&&(timeline.stage==='BASE'||timeline.editingBase))return identity;
 a=resolvePlacement(a);const b=a.bindings.find(b=>b.layerId===layerId);if(!b)return identity;
 const p=locatorProjection(a,b.locatorId),scale=p.scale/b.referenceScale;
 return {scale,translation:[b.anchor[0]*(1-scale)+p.point[0]-b.reference[0]+b.offset[0],b.anchor[1]*(1-scale)+p.point[1]-b.reference[1]+b.offset[1]]};
}
function scaleEnds(ends:InkEnds|undefined,s:number):InkEnds|undefined{return ends?.map(e=>({...e,...(e.taper===undefined?{}:{taper:e.taper*s}),...(e.extension===undefined?{}:{extension:e.extension*s})})) as InkEnds|undefined;}
/** Similarities preserve cubic geometry exactly. Hidden members and fill boundaries participate. */
export function transformDrawing(d:DrawingDocument,a:AssemblyFrame,inverse=false):DrawingDocument {
 if(!a.bindings.length)return d;
 const transforms=new Map(d.layers.map(l=>{const t=layerTransform(a,l.id);return [l.id,inverse?{scale:1/t.scale,translation:t.translation.map(v=>-v/t.scale) as Point2}:t] as const;}));
 const owners=new Map(d.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const))),nodeOwners=new Map(d.curves.flatMap(c=>c.nodes.map(id=>[id,owners.get(c.id)!] as const)));
 const tr=(id:string)=>transforms.get(owners.get(id)!)??identity;
 const point=(p:Point2,t:LayerTransform):Point2=>[p[0]*t.scale+t.translation[0],p[1]*t.scale+t.translation[1]];
 const style=<T extends {inkEnds?:InkEnds;mist?:{width:number}}>(c:T,s:number):T=>({...c,...(c.inkEnds?{inkEnds:scaleEnds(c.inkEnds,s)}:{}),...(c.mist?{mist:{...c.mist,width:c.mist.width*s}}:{})});
 return {...d,nodes:d.nodes.map(n=>({...n,position:point(n.position,transforms.get(nodeOwners.get(n.id)!)??identity)})),
 curves:d.curves.map(c=>{const t=tr(c.id);return {...style(c,t.scale),width:c.width,handles:c.handles.map(p=>point(p,t)) as [Point2,Point2]};}),
 fills:d.fills.map(f=>style(f,tr(f.id).scale)),
 offsets:d.offsets.map(o=>{const s=tr(o.id).scale;return {...style(o,s),width:o.width,distance:o.distance*s,...(o.translation?{translation:o.translation.map(v=>v*s) as Point2}:{})};}),
 joins:d.joins.map(j=>j.radius===undefined?j:{...j,radius:j.radius*tr(j.a.curveId).scale}),
 displayIntervals:d.displayIntervals?.map(track=>({...track,ranges:track.ranges.map(r=>withIntervalPinch({...r,...(r.inkEnds?{inkEnds:scaleEnds(r.inkEnds,tr(track.anchor.id).scale)}:{})},intervalPinch(r)))}))};
}
const cache=new WeakMap<AssemblyDocument,DrawingDocument>();
export function assemblyDrawing(a:AssemblyDocument){let d=cache.get(a);if(!d){d=transformDrawing(evaluatedIntervalDrawing(a),a);cache.set(a,d);}return d;}
function dependencies(d:DrawingDocument,layerId:string){
 for(const link of d.endpointLinks??[]){const a=layerFor(d,link.a.curveId)?.id,b=layerFor(d,link.b.curveId)?.id;if(a!==b&&(a===layerId||b===layerId))throw Error('此图层有跨层端点联动，请先解除联动再挂接；各层需要独立移动。');}
 for(const o of [...d.fills,...d.offsets]){const owner=layerFor(d,o.id)?.id;for(const c of ('boundary' in o?o.boundary:o.source)){const source=layerFor(d,c.id)?.id;if(owner!==source&&(owner===layerId||source===layerId))throw Error('此图层有跨层填充或跟随曲线，请先将边界与对象放在同一图层。');}}
}
export function bindLayer(a:AssemblyDocument,layerId:string,locatorId:string,anchor?:Point2):AssemblyDocument {
 if(!a.drawing.layers.some(l=>l.id===layerId))throw Error('请先选择图层');dependencies(a.drawing,layerId);
 const displayed=transformDrawing(a.drawing,a),without={...a,bindings:a.bindings.filter(b=>b.layerId!==layerId)};
 const drawing=transformDrawing(displayed,without,true),p=locatorProjection(a,locatorId);
 const binding:LayerBinding={layerId,locatorId,anchor:anchor??p.point,reference:p.point,referenceScale:p.scale,offset:[0,0]};
 // Existing per-angle offsets may survive an asset replacement or reattachment.
 // Include the current evaluated offset in calibration, so attachment is still jump-free.
 const candidate={...without,drawing,bindings:[...without.bindings,binding]},offset=resolvePlacement(candidate).bindings.find(b=>b.layerId===layerId)!.offset;
 const calibrated={...binding,reference:[p.point[0]+offset[0],p.point[1]+offset[1]] as Point2};
 return rebaseLayerPerspective(a,{...candidate,bindings:[...without.bindings,calibrated]},layerId);
}
/** One locator can drive several independent layers. Commit the result once for atomic Undo. */
export function bindLayers(a:AssemblyDocument,layerIds:string[],locatorId:string,anchor?:Point2):AssemblyDocument {
 let next=a;
 for(const id of new Set(layerIds)){
  // Adding another layer must not reset an existing layer's calibration or art-directed offset.
  if(next.bindings.some(b=>b.layerId===id&&b.locatorId===locatorId))continue;
  next=bindLayer(next,id,locatorId,anchor);
 }
 return next;
}
function rebaseLayerPerspective(before:AssemblyDocument,after:AssemblyDocument,id:string):AssemblyDocument {
 const old=layerTransform(before,id),next=layerTransform(after,id);
 if(!before.perspectives?.some(p=>p.layerId===id))return after;
 return {...after,perspectives:before.perspectives.map(p=>p.layerId!==id?p:rebasePerspective(p,old.scale/next.scale,old.translation.map((v,i)=>(v-next.translation[i])/next.scale) as Point2))};
}
export function unbindLayer(a:AssemblyDocument,layerId:string):AssemblyDocument {const displayed=transformDrawing(a.drawing,a),next={...a,bindings:a.bindings.filter(b=>b.layerId!==layerId)};return rebaseLayerPerspective(a,{...next,drawing:transformDrawing(displayed,next,true)},layerId);}
export function updateDrawing(a:AssemblyDocument,d:DrawingDocument):AssemblyDocument {const bindings=a.bindings.filter(b=>d.layers.some(l=>l.id===b.layerId));for(const b of bindings)dependencies(d,b.layerId);const next={...a,bindings,...(a.timeline?{timeline:{...a.timeline,refinements:a.timeline.refinements?.filter(t=>d.curves.some(c=>c.id===t.curveId)),bends:a.timeline.bends?.filter(t=>d.layers.some(l=>l.id===t.layerId))}}:{}),...(a.deformRecording?{deformRecording:{...a.deformRecording,tracks:a.deformRecording.tracks.filter(t=>d.layers.some(l=>l.id===t.layerId))}}:{}),...(a.perspectives?{perspectives:a.perspectives.filter(p=>d.layers.some(l=>l.id===p.layerId))}:{}),drawing:transformDrawing(d,{...a,bindings},true)};cache.set(next,d);return next;}
export function parseAssembly(value:unknown):AssemblyDocument {
 const a=value as AssemblyDocument,fail=():never=>{throw Error('组装间数据无效');};
 const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n),vec=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(finite);
 const frame=(f:AssemblyFrame)=>{if(!f||!f.pose||![f.planes,f.locators,f.bindings].every(Array.isArray))fail();
  const p=f.pose;if(![p.yaw,p.pitch,p.roll,p.distance].every(finite)||!vec(p.position,3)||p.distance<2||p.distance>100)fail();
  const ids=new Set<string>(),id=(v:string)=>{if(typeof v!=='string'||!v||ids.has(v))fail();ids.add(v);};
  f.planes.forEach(p=>{id(p.id);if(typeof p.name!=='string'||!p.name.trim()||!finite(p.height))fail();});
  f.locators.forEach(l=>{id(l.id);if(typeof l.name!=='string'||!l.name.trim()||!f.planes.some(p=>p.id===l.planeId)||![l.x,l.z].every(finite))fail();});
  if(f.perspectives!==undefined){if(!Array.isArray(f.perspectives))fail();const seen=new Set<string>();for(const p of f.perspectives){assertPerspective(p);if(seen.has(p.layerId))fail();seen.add(p.layerId);}}
  const layers=new Set<string>();f.bindings.forEach(b=>{if(typeof b.layerId!=='string'||layers.has(b.layerId)||!f.locators.some(l=>l.id===b.locatorId)||!vec(b.anchor,2)||!vec(b.reference,2)||!vec(b.offset,2)||!finite(b.referenceScale)||b.referenceScale<=0)fail();layers.add(b.layerId);});
 };
 if(!a||a.version!==1||!a.frames||typeof a.frames!=='object'||Array.isArray(a.frames))return fail();frame(a);
 if(a.followAxisRotation!==undefined&&typeof a.followAxisRotation!=='boolean')fail();
 const drawing=parseDrawing(a.drawing),drawingSnapshots=a.drawingSnapshots?parseDrawingSnapshots(a.drawingSnapshots):undefined;
 if([...a.bindings,...a.perspectives??[]].some(b=>!drawing.layers.some(l=>l.id===b.layerId)))fail();
 if(a.timeline?.bends?.some(t=>!a.perspectives?.some(p=>p.layerId===t.layerId)))fail();
 const frames:Record<string,AssemblyFrame>={};for(const [id,f] of Object.entries(a.frames)){if(!drawingSnapshots?.items.some(s=>s.id===id))continue;frame(f);if(f.perspectives?.some(p=>!drawingSnapshots!.items.find(s=>s.id===id)!.drawing.layers.some(l=>l.id===p.layerId)))fail();frames[id]=structuredClone(frameOf(f));}
 return {version:1,...structuredClone(frameOf(a)),drawing,...(a.timeline===undefined?{}:{timeline:parseTimeline(a.timeline,drawing)}),...(drawingSnapshots?{drawingSnapshots}:{}),frames,...(a.placement===undefined?{}:{placement:parsePlacement(a.placement)}),...(a.deformRecording===undefined?{}:{deformRecording:parseDeformRecording(a.deformRecording,a.perspectives)}),...parseViewSlots(a.viewSlots,a.activeViewSlotId),...(a.followAxisRotation===undefined?{}:{followAxisRotation:a.followAxisRotation})};
}

const snapshotCache=new WeakMap<DrawingSnapshots,{frames:AssemblyDocument['frames'];raw:boolean;library:DrawingSnapshots}>();
/** Snapshots persist canonical geometry, so arbitrary pose scale never invalidates authoring limits. */
export function assemblySnapshots(a:AssemblyDocument):DrawingSnapshots|undefined {
 const library=a.drawingSnapshots;if(!library)return;const raw=!!a.timeline&&(a.timeline.editingBase||a.timeline.stage==='BASE'),hit=snapshotCache.get(library);if(hit?.frames===a.frames&&hit.raw===raw)return hit.library;
 const projected={...library,items:library.items.map(item=>({...item,drawing:raw?item.drawing:transformDrawing(item.drawing,a.frames[item.id]??a)}))};
 snapshotCache.set(library,{frames:a.frames,raw,library:projected});return projected;
}
