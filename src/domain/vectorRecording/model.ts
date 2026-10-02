import {displayPath} from '../drawing/displayIntervals';
import {sourceStructureSignature} from './sourceCompatibility';
import {applyIntervalOverrides,blendIntervalOverrides,missingCornerIntervals} from './intervals';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {uid,type DrawingDocument,type Point2,type StrokeDisplayIntervals} from '../drawing/model';
import {blendWarpGrids,createWarpGrid,type WarpGrid} from '../vectorWarp/model';
import {bracket,clampAngle,latticeWeights,sameAngle,type Angle} from './interpolation';

export interface VectorDeformer {id:string;name:string;parentId?:string;grid:WarpGrid}
export interface VectorPose {grids:Record<string,WarpGrid>;visibility:Record<string,boolean>;intervals:Record<string,boolean>;intervalOverrides?:StrokeDisplayIntervals[]}
export interface VectorKeyform extends VectorPose {id:string;name:string;angle:Angle}
export interface ArtworkRig {
 id:string;artworkId:string;sourceSignature?:string;/** Structural evidence for source compatibility; never a replacement for material coordinates. */sourceStructureSignature?:string;sourceIntervalFrames?:Record<string,{signature:string;curveIds:string[];rangeIds:string[]}>;deformers:VectorDeformer[];bindings:Record<string,string>;
 keys:VectorKeyform[];angle:Angle;draft?:VectorPose;
 /** Reserved driver contract; future tracking/physics can supply bounded parameters. */
 driver?:{kind:'manual'|'external';parameterX:string;parameterY:string};
}
export interface VectorRecording {version:1;rigs:ArtworkRig[];tolerance:number}
export const emptyVectorRecording=():VectorRecording=>({version:1,rigs:[],tolerance:1/250});
export const sourceArtworkId=(activeId?:string)=>activeId??'$working';
export const emptyPose=():VectorPose=>({grids:{},visibility:{},intervals:{}});
const signatures=new WeakMap<DrawingDocument,string>();
/** Change detector, not a security hash. Reference pixels do not alter a rig's source. */
export function drawingSignature(d:DrawingDocument):string{
 const cached=signatures.get(d);if(cached)return cached;const {reference,mirrorEditing,mirrorAxisX,...geometry}=d;void reference;void mirrorEditing;void mirrorAxisX;
 const json=JSON.stringify(geometry);let a=2166136261,b=2246822519;for(let i=0;i<json.length;i++){a=Math.imul(a^json.charCodeAt(i),16777619);b=Math.imul(b^json.charCodeAt(i),3266489917);}const signature=`${json.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;signatures.set(d,signature);return signature;
}
export function sourceIntervalFrames(drawing:DrawingDocument):NonNullable<ArtworkRig['sourceIntervalFrames']>{return Object.fromEntries((drawing.displayIntervals??[]).map(t=>[t.id,{signature:JSON.stringify([t.anchor,t.scope??null,t.displayRoute??null]),curveIds:displayPath(drawing,t.anchor.id).segments.map(u=>u.id),rangeIds:t.ranges.map(r=>r.id)}]));}
/** Route-frame changes invalidate only the affected angle appearance channels.
 * Their old per-loop SHOW meaning cannot be carried into global SHOW union. */
export function changedIntervalTracks(rig:ArtworkRig,drawing:DrawingDocument):Set<string>{
 const next=sourceIntervalFrames(drawing),old=rig.sourceIntervalFrames,changed=new Set<string>();
 if(old){const touched=new Set(Object.entries(old).flatMap(([id,frame])=>next[id]?.signature===frame.signature?[]:frame.curveIds));for(const [id,frame] of Object.entries(next))if(old[id]?old[id].signature!==frame.signature:frame.curveIds.some(cid=>touched.has(cid)))changed.add(id);}
 else{for(const t of drawing.displayIntervals??[])if(t.displayRoute)changed.add(t.id);for(const pose of [...rig.keys,...(rig.draft?[rig.draft]:[])])for(const t of pose.intervalOverrides??[]){const current=drawing.displayIntervals?.find(x=>x.id===t.id);if(current&&JSON.stringify(current.displayRoute)!==JSON.stringify(t.displayRoute))changed.add(t.id);}}
 return changed;
}
export function acceptArtworkSource(rig:ArtworkRig,drawing:DrawingDocument):ArtworkRig{
 const changed=changedIntervalTracks(rig,drawing),layers=new Set(drawing.layers.map(l=>l.id)),items=new Set(drawing.layers.flatMap(l=>l.items)),intervals=new Set((drawing.displayIntervals??[]).flatMap(t=>t.ranges.map(r=>r.id)));
 const clean=(p:VectorPose):VectorPose=>({...p,visibility:Object.fromEntries(Object.entries(p.visibility).filter(([id])=>items.has(id))),intervals:Object.fromEntries((drawing.displayIntervals??[]).filter(t=>!changed.has(t.id)).flatMap(t=>t.ranges).flatMap(r=>{const flag=p.intervals[r.id]??(r.originId?p.intervals[r.originId]:undefined);return flag===undefined?[]:[[r.id,flag]]})),...(p.intervalOverrides?{intervalOverrides:p.intervalOverrides.flatMap(track=>{const base=drawing.displayIntervals?.find(base=>base.id===track.id&&base.anchor.id===track.anchor.id&&base.anchor.reverse===track.anchor.reverse&&base.scope===track.scope&&JSON.stringify(base.displayRoute)===JSON.stringify(track.displayRoute));return base&&!changed.has(base.id)?[{...base,ranges:track.ranges}]:[];})}:{})});
 return {...rig,sourceSignature:drawingSignature(drawing),sourceStructureSignature:sourceStructureSignature(drawing),sourceIntervalFrames:sourceIntervalFrames(drawing),bindings:Object.fromEntries(Object.entries(rig.bindings).filter(([id])=>layers.has(id))),keys:rig.keys.map(k=>({...k,...clean(k)})),...(rig.draft?{draft:clean(rig.draft)}:{})};
}
export function createArtworkRig(artworkId:string,drawing?:DrawingDocument):ArtworkRig {
 const keys:VectorKeyform[]=[['正面',0,0],['左',-90,0],['右',90,0],['上',0,90],['下',0,-90]].map(([name,x,y])=>({id:uid(),name:String(name),angle:{x:Number(x),y:Number(y)},...emptyPose()}));
 return {id:uid(),artworkId,...(drawing?{sourceSignature:drawingSignature(drawing),sourceStructureSignature:sourceStructureSignature(drawing),sourceIntervalFrames:sourceIntervalFrames(drawing)}:{}),deformers:[],bindings:{},keys,angle:{x:0,y:0},driver:{kind:'manual',parameterX:'Angle X',parameterY:'Angle Y'}};
}
export function ensureArtworkRig(recording:VectorRecording,artworkId:string,drawing?:DrawingDocument){return recording.rigs.some(r=>r.artworkId===artworkId)?recording:{...recording,rigs:[...recording.rigs,createArtworkRig(artworkId,drawing)]};}
export function replaceRig(recording:VectorRecording,rig:ArtworkRig):VectorRecording{return {...recording,rigs:recording.rigs.map(r=>r.id===rig.id?rig:r)};}
export function drawingBounds(d:DrawingDocument,layerIds?:string[]):{min:Point2;max:Point2}{
 const ids=layerIds&&new Set(d.layers.filter(l=>layerIds.includes(l.id)).flatMap(l=>l.items));
 const curves=d.curves.filter(c=>!ids||ids.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
 const points=[...d.nodes.filter(n=>nodes.has(n.id)).map(n=>n.position),...curves.flatMap(c=>c.handles)];
 if(!points.length)return {min:[-1,-1],max:[1,1]};
 const min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 const pad=Math.max(max[0]-min[0],max[1]-min[1],.1)*.08;
 return {min:[min[0]-pad,min[1]-pad],max:[max[0]+pad,max[1]+pad]};
}
export function addDeformer(rig:ArtworkRig,d:DrawingDocument,layerIds:string[],parentId?:string,rows=3,columns=3):ArtworkRig{
 if(parentId&&!rig.deformers.some(x=>x.id===parentId))throw Error('父变形器不存在');
 const node:VectorDeformer={id:uid(),name:`Warp ${rig.deformers.length+1}`,grid:createWarpGrid(drawingBounds(d,layerIds.length?layerIds:undefined),rows,columns),...(parentId?{parentId}:{})};
 const bindings={...rig.bindings};for(const id of layerIds)bindings[id]=node.id;
 const install=(p:VectorPose):VectorPose=>({...p,grids:{...p.grids,[node.id]:node.grid}});
 return {...rig,deformers:[...rig.deformers,node],bindings,keys:rig.keys.map(k=>({...k,...install(k)})),...(rig.draft?{draft:install(rig.draft)}:{})};
}
export function removeDeformer(rig:ArtworkRig,id:string):ArtworkRig{
 const removed=rig.deformers.find(d=>d.id===id);if(!removed)return rig;
 const strip=(p:VectorPose):VectorPose=>({...p,grids:Object.fromEntries(Object.entries(p.grids).filter(([key])=>key!==id))});
 return {...rig,deformers:rig.deformers.filter(d=>d.id!==id).map(d=>d.parentId===id?{...d,parentId:removed.parentId}:d),bindings:Object.fromEntries(Object.entries(rig.bindings).filter(([,value])=>value!==id)),keys:rig.keys.map(k=>({...k,...strip(k)})),...(rig.draft?{draft:strip(rig.draft)}:{})};
}
export function setDeformerParent(rig:ArtworkRig,id:string,parentId?:string):ArtworkRig{
 if(id===parentId)throw Error('变形器不能挂接自身');
 let parent=parentId;const seen=new Set([id]);while(parent){if(seen.has(parent))throw Error('变形器层级不能循环');seen.add(parent);const d=rig.deformers.find(d=>d.id===parent);if(!d)throw Error('父变形器不存在');parent=d.parentId;}
 return {...rig,deformers:rig.deformers.map(d=>d.id===id?{...d,parentId}:d)};
}
export function deformerChain(rig:ArtworkRig,layerId:string,pose:VectorPose,stopAt?:string):WarpGrid[]{
 const chain:WarpGrid[]=[];let id=rig.bindings[layerId];const seen=new Set<string>();
 while(id&&!seen.has(id)){seen.add(id);const d=rig.deformers.find(x=>x.id===id);if(!d)break;chain.push(pose.grids[id]??d.grid);if(id===stopAt)break;id=d.parentId??'';}
 return chain;
}
function gridAt(rig:ArtworkRig,pose:VectorPose,id:string){return pose.grids[id]??rig.deformers.find(d=>d.id===id)!.grid;}
function mixPose(rig:ArtworkRig,weighted:{pose:VectorPose;weight:number}[],drawing?:DrawingDocument):VectorPose{
 const strongest=weighted.reduce((a,b)=>b.weight>a.weight?b:a,weighted[0]);
 return {grids:Object.fromEntries(rig.deformers.map(d=>[d.id,blendWarpGrids(weighted.map(w=>({grid:gridAt(rig,w.pose,d.id),weight:w.weight})))])),visibility:{...strongest.pose.visibility},intervals:{...strongest.pose.intervals},...(drawing?{intervalOverrides:blendIntervalOverrides(drawing,weighted.map(w=>({overrides:w.pose.intervalOverrides,weight:w.weight})))}:strongest.pose.intervalOverrides?{intervalOverrides:strongest.pose.intervalOverrides}:{})};
}
function axisPose(rig:ArtworkRig,axis:'x'|'y',value:number,neutral:VectorPose,drawing?:DrawingDocument):VectorPose{
 const keys=rig.keys.filter(k=>k.angle[axis==='x'?'y':'x']===0);
 const [lo,hi,t]=bracket(keys.map(k=>k.angle[axis]),value);
 const a=keys.find(k=>k.angle[axis]===lo)??neutral,b=keys.find(k=>k.angle[axis]===hi)??neutral;
 return mixPose(rig,[{pose:a,weight:1-t},{pose:b,weight:t}],drawing);
}
export function evaluatePose(rig:ArtworkRig,angle:Angle=rig.angle,drawing?:DrawingDocument):VectorPose{
 const exact=rig.keys.find(k=>sameAngle(k.angle,angle));if(exact)return {grids:exact.grids,visibility:exact.visibility,intervals:exact.intervals,...(exact.intervalOverrides?{intervalOverrides:exact.intervalOverrides}:{})};
 if(!drawing&&rig.keys.some(k=>k.intervalOverrides?.length))throw Error('Interpolating interval overrides requires the source artwork.');
 const neutral=rig.keys.find(k=>sameAngle(k.angle,{x:0,y:0}))??emptyPose();
 const sample=(a:Angle):VectorPose=>{
  const exact=rig.keys.find(k=>sameAngle(k.angle,a));if(exact)return exact;
  const x=axisPose(rig,'x',a.x,neutral,drawing),y=axisPose(rig,'y',a.y,neutral,drawing);
  const grids=Object.fromEntries(rig.deformers.map(d=>[d.id,blendWarpGrids([{grid:gridAt(rig,x,d.id),weight:1},{grid:gridAt(rig,y,d.id),weight:1},{grid:gridAt(rig,neutral,d.id),weight:-1}])]));
  return {grids,visibility:{...neutral.visibility,...x.visibility,...y.visibility},intervals:{...neutral.intervals,...x.intervals,...y.intervals},...(drawing?{intervalOverrides:missingCornerIntervals(drawing,neutral.intervalOverrides,x.intervalOverrides,y.intervalOverrides,a)}:{})};
 };
 return mixPose(rig,latticeWeights(rig.keys.map(k=>k.angle),angle).map(w=>({pose:sample(w.angle),weight:w.weight})),drawing);
}
export const currentPose=(rig:ArtworkRig,drawing?:DrawingDocument)=>rig.draft??evaluatePose(rig,rig.angle,drawing);
export function saveKeyform(rig:ArtworkRig,name?:string,drawing?:DrawingDocument):ArtworkRig{
 const old=rig.keys.find(k=>sameAngle(k.angle,rig.angle)),pose=currentPose(rig,drawing),key:VectorKeyform={...structuredClone(pose),id:old?.id??uid(),name:name?.trim()||old?.name||`X ${rig.angle.x}° / Y ${rig.angle.y}°`,angle:{...rig.angle}};
 const {draft,...rest}=rig;void draft;return {...rest,keys:old?rig.keys.map(k=>k.id===old.id?key:k):[...rig.keys,key]};
}
export function setRigAngle(rig:ArtworkRig,angle:Angle):ArtworkRig{
 if(rig.draft)throw Error('请先保存或放弃姿态草稿，再切换角度');
 return {...rig,angle:{x:clampAngle(angle.x),y:clampAngle(angle.y)}};
}
export function discardDraft(rig:ArtworkRig):ArtworkRig{const {draft,...rest}=rig;void draft;return rest;}
export function applyVisibility(d:DrawingDocument,pose:VectorPose):DrawingDocument{
 d=applyIntervalOverrides(d,pose.intervalOverrides);
 const flag=(id:string,base:boolean)=>pose.visibility[id]??base;
 return {...d,curves:d.curves.map(c=>({...c,visible:flag(c.id,c.visible)})),fills:d.fills.map(f=>({...f,visible:flag(f.id,f.visible)})),offsets:d.offsets.map(o=>({...o,visible:flag(o.id,o.visible)})),displayIntervals:d.displayIntervals?.map(t=>({...t,ranges:t.ranges.map(r=>withIntervalPinch({...r,enabled:pose.intervals[r.id]??r.enabled},intervalPinch(r)))}))};
}
