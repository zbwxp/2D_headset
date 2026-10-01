/** Local, JSON-oriented vector authoring. No network, evaluation of code, or mode switching. */
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useEditor} from './store';
import {canEditSource,useWorkspaceMode,type WorkspaceMode} from './workspaceMode';
import {useDrawing} from '../ui/drawing/session';
import PaintScene from '../ui/drawing/PaintScene';
import AIGuideOverlay,{MAX_AI_GUIDE_CURVES,type AIGuideOptions} from '../ui/drawing/AIGuideOverlay';
import type {LandmarkProject} from '../domain/landmarks/model';
import {emptyDrawing,parseDrawing,shapeOf,layerFor,members,objectById,validFillMist,type FillMist,type InkEndStyle,type DisplayIntervalMode,type DrawingDocument,type Point2,type Cubic} from '../domain/drawing/model';
import {moveNode,moveHandle,transform,curveChange,renameStroke,widthChange,RelatedSelection,addLayer,duplicateLayer,deleteLayers,reorderLayers,layerChange,deleteObjects,moveToLayer,createCurve,splitCurve,setMirrorAxis} from '../domain/drawing/commands';
import {setObjectState} from '../domain/drawing/objectState';
import {createFill,changePaint,reorderPaint,setInk,setInkEnd} from '../domain/drawing/paintCommands';
import {setDepthOffset} from '../domain/drawing/depth';
import {setFillMist} from '../domain/drawing/fillMist';
import {planArtworkLayerImport} from '../domain/drawing/importArtworkLayers';
import {deformDrawing,transportDeformedIntervals,type Quad,type DeformRect} from '../domain/drawing/deform';
import {strokes,strokeName,strokeIds} from '../domain/drawing/strokes';
import {linkedNodeIds} from '../domain/drawing/endpointLinks';
import {displayField,displayPath,addDisplayInterval,changeDisplayInterval,removeDisplayInterval,setDisplayIntervalEnd} from '../domain/drawing/displayIntervals';
import {fillGeometry,offsetGeometry} from '../domain/drawing/appearance';
import {roundedJoins} from '../domain/drawing/roundedJoin';

export const VECTOR_AI_VERSION='1.1';
export const VECTOR_AI_LIMITS={coordinate:10000,batch:1000,dimension:4096,name:256} as const;
export interface Bounds {min:Point2;max:Point2;center:Point2}
/** SVG affine convention: x'=a*x+c*y+e, y'=b*x+d*y+f. Source Y points up. */
export type Affine=[number,number,number,number,number,number];
export type VectorCommand=
 | {op:'moveNode';nodeId:string;position:Point2}
 | {op:'moveHandle';curveId:string;end:0|1;position:Point2}
 | {op:'transformCurves';curveIds:string[];matrix:Affine;allowRelated?:boolean}
 | {op:'deformCurves';curveIds:string[];bounds:DeformRect;quad:Quad;allowRelated?:boolean}
 | {op:'renameCurve';curveId:string;name:string}
 | {op:'renameStroke';curveId:string;name:string}
 | {op:'setCurveWidth';curveIds:string[];width:number}
 | {op:'createLayer';name:string;ref?:string}
 | {op:'duplicateLayer';layerId:string;ref?:string}
 | {op:'deleteLayers';layerIds:string[]}
 | {op:'reorderLayer';layerId:string;targetLayerId:string;after?:boolean}
 | {op:'setLayer';layerId:string;name?:string;visible?:boolean;locked?:boolean}
 | {op:'setObjectState';objectIds:string[];visible?:boolean;locked?:boolean}
 | {op:'deleteObjects';objectIds:string[]}
 | {op:'moveToLayer';curveIds:string[];layerId:string}
 | {op:'createFill';curveIds:string[];color:'white'|'black'|'transparent';kind?:'SOLID'|'MIST';ref?:string}
 | {op:'setFill';fillId:string;name?:string;color?:'white'|'black'|'transparent';visible?:boolean;locked?:boolean;mist?:FillMist}
 | {op:'reorderObject';objectId:string;targetObjectId:string;after?:boolean}
 | {op:'transformLayers';layerIds:string[];matrix:Affine;allowRelated?:boolean}
 | {op:'createCurve';layerId:string;shape:Cubic;width?:number;name?:string;ref?:string}
 | {op:'splitCurve';curveId:string;t:number;ref?:string}
 | {op:'setMirrorAxis';x:number}
 | {op:'setInkVisibility';curveIds:string[];visible:boolean}
 | {op:'setCurveInkEnd';curveId:string;end:0|1;style:InkEndStyle}
 | {op:'setDepth';curveId:string;offset:number;scope?:'PARENT'|'LAYER'}
 | {op:'addDisplayInterval';curveId:string;mode?:DisplayIntervalMode;start?:number;end?:number;enabled?:boolean;ref?:string}
 | {op:'changeDisplayInterval';rangeId:string;mode?:DisplayIntervalMode;start?:number;end?:number;enabled?:boolean}
 | {op:'removeDisplayInterval';rangeId:string}
 | {op:'setDisplayIntervalEnd';rangeId:string;end:0|1;style:InkEndStyle};
export interface CreatedEntity {commandIndex:number;kind:'layer'|'fill'|'curve'|'displayRange';id:string;ref?:string;idMap?:Record<string,string>}
const commandNames=['moveNode','moveHandle','transformCurves','deformCurves','renameCurve','renameStroke','setCurveWidth','createLayer','duplicateLayer','deleteLayers','reorderLayer','setLayer','setObjectState','deleteObjects','moveToLayer','createFill','setFill','reorderObject','transformLayers','createCurve','splitCurve','setMirrorAxis','setInkVisibility','setCurveInkEnd','setDepth','addDisplayInterval','changeDisplayInterval','removeDisplayInterval','setDisplayIntervalEnd'];
export interface VectorBatch {commands:VectorCommand[];expectedRevision?:string;dryRun?:boolean}
export interface VectorQuery {layerIds?:string[];layerNames?:string[];curveIds?:string[];curveNames?:string[];strokeNames?:string[];nameIncludes?:string}
/** center is the source-space point at the middle of the output. origin is optional client-space offset. */
export interface VectorViewport {width:number;height:number;center:Point2;pixelsPerUnit:number;origin?:Point2}
export interface PreviewOptions {commands?:VectorCommand[];expectedRevision?:string;width?:number;height?:number;center?:Point2;pixelsPerUnit?:number;showFills?:boolean;annotations?:AIGuideOptions}
export type CoordinateSpace='source'|'canvas'|'client'|'reference';
export type VectorResult<T>={ok:true;revision:string;value:T}|{ok:false;revision:string;error:{code:string;message:string;commandIndex?:number;relatedCurveIds?:string[]}};
export interface VectorEditingHost {
 getState():{project:LandmarkProject;past:readonly LandmarkProject[];future:readonly LandmarkProject[]};
 getMode():WorkspaceMode;
 commitDrawing(drawing:DrawingDocument):void;
 undo():void;redo():void;
 selectCurveIds?(ids:string[]):void;
 getSelection?():unknown;
 getActiveLayerId?():string|null;
 getViewport?():VectorViewport|undefined;
}
class ApiError extends Error {
 constructor(readonly code:string,message:string,readonly commandIndex?:number,readonly relatedCurveIds?:string[]){super(message);}
}
const fail=(code:string,message:string):never=>{throw new ApiError(code,message);};
const clone=<T,>(x:T):T=>structuredClone(x);
const record=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))fail('INVALID_REQUEST','Expected a JSON object.');
 return x as Record<string,unknown>;
};
function keys(value:Record<string,unknown>,allowed:readonly string[]){
 const unknown=Object.keys(value).filter(k=>!allowed.includes(k));
 if(unknown.length)fail('INVALID_REQUEST',`Unknown field(s): ${unknown.join(', ')}.`);
}
function string(value:unknown,label:string,max=256):string{
 if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_REQUEST',`${label} must be a nonempty string of at most ${max} characters.`);
 return value as string;
}
function bool(value:unknown,label:string){if(value!==undefined&&typeof value!=='boolean')fail('INVALID_REQUEST',`${label} must be a boolean.`);}
function num(value:unknown,label:string,min:number=-VECTOR_AI_LIMITS.coordinate,max:number=VECTOR_AI_LIMITS.coordinate):number{
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('INVALID_REQUEST',`${label} must be finite and between ${min} and ${max}.`);
 return value as number;
}
function point(value:unknown,label:string):Point2{
 if(!Array.isArray(value)||value.length!==2)fail('INVALID_REQUEST',`${label} must be [x, y].`);
 return (value as unknown[]).map((v,i)=>num(v,`${label}[${i}]`)) as Point2;
}
function ids(value:unknown,label:string,empty=false):string[]{
 if(!Array.isArray(value)||(!empty&&!value.length)||value.length>10000)fail('INVALID_REQUEST',`${label} must be an array of ${empty?'0':'1'}–10000 IDs or names.`);
 const result=(value as unknown[]).map(v=>string(v,label));
 if(new Set(result).size!==result.length)fail('INVALID_REQUEST',`${label} must not contain duplicates.`);
 return result;
}
function curveExists(d:DrawingDocument,id:unknown){const key=string(id,'curveId');if(!d.curves.some(c=>c.id===key))fail('NOT_FOUND',`Unknown curve ID: ${key}.`);return key;}
function curvesExist(d:DrawingDocument,value:unknown){return ids(value,'curveIds').map(id=>curveExists(d,id));}
function layerExists(d:DrawingDocument,value:unknown){const id=string(value,'layerId');if(!d.layers.some(l=>l.id===id))fail('NOT_FOUND',`Unknown layer ID: ${id}.`);return id;}
function objectExists(d:DrawingDocument,value:unknown){const id=string(value,'objectId');if(!objectById(d,id))fail('NOT_FOUND',`Unknown object ID: ${id}.`);return id;}
function color(value:unknown):'white'|'black'|'transparent'{if(value!=='white'&&value!=='black'&&value!=='transparent')fail('INVALID_REQUEST','color must be white, black or transparent.');return value as 'white'|'black'|'transparent';}
function stateChange(c:Record<string,unknown>){bool(c.visible,'visible');bool(c.locked,'locked');return {...(c.visible===undefined?{}:{visible:c.visible as boolean}),...(c.locked===undefined?{}:{locked:c.locked as boolean})};}
function nonemptyChange(c:object){if(!Object.keys(c).length)fail('INVALID_REQUEST','Provide at least one property to change.');return c;}
function affineMap(matrix:unknown){
 if(!Array.isArray(matrix)||matrix.length!==6)fail('INVALID_REQUEST','matrix must contain [a,b,c,d,e,f].');
 const [a,b,c,d,e,f]=(matrix as unknown[]).map((v,i)=>num(v,`matrix[${i}]`));
 if(Math.abs(a*d-b*c)<1e-12)fail('INVALID_REQUEST','The affine transform must be nonsingular.');
 return (p:Point2):Point2=>[a*p[0]+c*p[1]+e,b*p[0]+d*p[1]+f];
}
function end(value:unknown):0|1{if(value!==0&&value!==1)fail('INVALID_REQUEST','end must be 0 or 1.');return value as 0|1;}
function intervalChange(c:Record<string,unknown>){
 if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');bool(c.enabled,'enabled');
 return {...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.enabled===undefined?{}:{enabled:c.enabled as boolean}),...(c.start===undefined?{}:{start:num(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:num(c.end,'end',0,1)})};
}
function rangeExists(d:DrawingDocument,value:unknown){const id=string(value,'rangeId'),track=d.displayIntervals?.find(t=>t.ranges.some(r=>r.id===id));if(!track)fail('NOT_FOUND',`Unknown display range ID: ${id}.`);return {id,track:track!};}
function inkEndStyle(value:unknown):InkEndStyle{
 const s=record(value);keys(s,['taper','extension','taperWidthScale','interior']);nonemptyChange(s);bool(s.interior,'interior');
 if(s.taper!==undefined&&s.taperWidthScale!==undefined)fail('INVALID_REQUEST','Choose taper or taperWidthScale, not both.');
 return {...(s.taper===undefined?{}:{taper:num(s.taper,'taper',0,20)}),...(s.extension===undefined?{}:{extension:num(s.extension,'extension',0,2)}),...(s.taperWidthScale===undefined?{}:{taperWidthScale:num(s.taperWidthScale,'taperWidthScale',0,200)}),...(s.interior===undefined?{}:{interior:s.interior as boolean})};
}
function validateBounds(d:DrawingDocument){
 for(const n of d.nodes)point(n.position,`node ${n.id}`);
 for(const c of d.curves)c.handles.forEach((p,i)=>point(p,`curve ${c.id} handle ${i}`));
}
function combineBounds(bounds:Bounds[]):Bounds|null{
 if(!bounds.length)return null;
 const min:Point2=[Math.min(...bounds.map(b=>b.min[0])),Math.min(...bounds.map(b=>b.min[1]))];
 const max:Point2=[Math.max(...bounds.map(b=>b.max[0])),Math.max(...bounds.map(b=>b.max[1]))];
 return {min,max,center:[(min[0]+max[0])/2,(min[1]+max[1])/2]};
}
/** Exact centerline extrema of a cubic, not a sampling-dependent estimate or ink bounds. */
export function cubicBounds(s:Cubic):Bounds{
 const ts=new Set([0,1]);
 for(const axis of [0,1]){
  const [p0,p1,p2,p3]=s.map(p=>p[axis]);
  const a=-p0+3*p1-3*p2+p3,b=2*(p0-2*p1+p2),c=p1-p0;
  if(Math.abs(a)<1e-14){if(Math.abs(b)>1e-14){const t=-c/b;if(t>0&&t<1)ts.add(t);}}
  else {const disc=b*b-4*a*c;if(disc>=0){for(const t of [(-b+Math.sqrt(disc))/(2*a),(-b-Math.sqrt(disc))/(2*a)])if(t>0&&t<1)ts.add(t);}}
 }
 const points=[...ts].map(t=>{const u=1-t;return [0,1].map(i=>u*u*u*s[0][i]+3*u*u*t*s[1][i]+3*u*t*t*s[2][i]+t*t*t*s[3][i]) as Point2;});
 const min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 return {min,max,center:[(min[0]+max[0])/2,(min[1]+max[1])/2]};
}
const drawingBounds=(d:DrawingDocument)=>combineBounds(d.curves.map(c=>cubicBounds(shapeOf(d,c.id))));
function changedIds(before:DrawingDocument,after:DrawingDocument){
 const changed=<T extends {id:string}>(a:T[],b:T[])=>b.filter(x=>JSON.stringify(x)!==JSON.stringify(a.find(y=>y.id===x.id))).map(x=>x.id);
 const nodes=changed(before.nodes,after.nodes),curves=after.curves.filter(c=>nodes.some(n=>c.nodes.includes(n))||JSON.stringify(c)!==JSON.stringify(before.curves.find(a=>a.id===c.id))).map(c=>c.id);
 const removed=<T extends {id:string}>(a:T[],b:T[])=>a.filter(x=>!b.some(y=>y.id===x.id)).map(x=>x.id);
 return {curveIds:curves,nodeIds:nodes,layerIds:changed(before.layers,after.layers),fillIds:changed(before.fills,after.fills),offsetIds:changed(before.offsets,after.offsets),displayTrackIds:changed(before.displayIntervals??[],after.displayIntervals??[]),affectedFillIds:after.fills.filter(f=>f.boundary.some(u=>curves.includes(u.id))).map(f=>f.id),affectedOffsetIds:after.offsets.filter(o=>o.source.some(u=>curves.includes(u.id))).map(o=>o.id),removed:{curveIds:removed(before.curves,after.curves),nodeIds:removed(before.nodes,after.nodes),layerIds:removed(before.layers,after.layers),fillIds:removed(before.fills,after.fills),offsetIds:removed(before.offsets,after.offsets),displayTrackIds:removed(before.displayIntervals??[],after.displayIntervals??[])}};
}
function diagnostics(d:DrawingDocument){
 return [
  ...[...roundedJoins(d)].flatMap(([id,g])=>g.error?[{kind:'join',id,message:g.error}]:[]),
  ...d.fills.flatMap(f=>{const g=fillGeometry(d,f);return g.error?[{kind:'fill',id:f.id,message:g.error}]:[];}),
  ...d.offsets.flatMap(o=>{const g=offsetGeometry(d,o);return g.error?[{kind:'offset',id:o.id,message:g.error}]:[];}),
 ];
}
function intervalLocations(d:DrawingDocument,track:NonNullable<DrawingDocument['displayIntervals']>[number]){
 const path=displayPath(d,track.anchor.id),field=displayField(d,path);
 return {trackId:track.id,approximation:'existing arc-length table',ranges:track.ranges.map(range=>({rangeId:range.id,ends:([0,1] as const).map(end=>{
  const normalizedArc=end===0?range.start:range.end,s=field.native(track,normalizedArc),distance=s*field.total;
  let index=field.parts.findIndex(p=>distance<=p.start+p.length);if(index<0)index=field.parts.length-1;
  const sample=field.at(s),piece=field.geometry.pieces[index],span=piece.sourceRange??[0,1],orientedT=span[0]+(span[1]-span[0])*sample.t;
  const source=piece.joinId?{kind:'join' as const,joinId:piece.joinId,curveIds:piece.owners,derivedPiece:index,localT:sample.t}:{kind:'curve' as const,curveId:piece.owners[0],t:path.segments.find(u=>u.id===piece.owners[0])!.reverse?1-orientedT:orientedT};
  return {end,normalizedArc,position:sample.p,source};
 })}))};
}
function checkNewDiagnostics(before:DrawingDocument,after:DrawingDocument){
 const prior=new Set(diagnostics(before).map(x=>`${x.kind}:${x.id}:${x.message}`));
 const added=diagnostics(after).filter(x=>!prior.has(`${x.kind}:${x.id}:${x.message}`));
 if(added.length)fail('GEOMETRY_INVALID',`Edit would introduce invalid derived geometry: ${added.map(x=>`${x.kind} ${x.id}: ${x.message}`).join('; ')}`);
}
function applyCommand(d:DrawingDocument,raw:unknown,report:(sampledMaxError:number)=>void,created:(kind:CreatedEntity['kind'],id:string,ref:unknown,idMap?:Record<string,string>)=>void):DrawingDocument{
 const c=record(raw),op=c.op;
 switch(op){
  case 'moveNode':{
   keys(c,['op','nodeId','position']);const id=string(c.nodeId,'nodeId');
   if(!d.nodes.some(n=>n.id===id))fail('NOT_FOUND',`Unknown node ID: ${id}.`);
   return moveNode(d,id,point(c.position,'position'));
  }
  case 'moveHandle':{
   keys(c,['op','curveId','end','position']);const id=curveExists(d,c.curveId);
   if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');
   return moveHandle(d,{curveId:id,end:c.end as 0|1},point(c.position,'position'));
  }
  case 'transformCurves':{
   keys(c,['op','curveIds','matrix','allowRelated']);const selected=curvesExist(d,c.curveIds);bool(c.allowRelated,'allowRelated');
   return transform(d,selected,affineMap(c.matrix),c.allowRelated===true);
  }
  case 'deformCurves':{
   keys(c,['op','curveIds','bounds','quad','allowRelated']);const selected=curvesExist(d,c.curveIds);bool(c.allowRelated,'allowRelated');
   const b=record(c.bounds);keys(b,['min','max']);const bounds={min:point(b.min,'bounds.min'),max:point(b.max,'bounds.max')};
   if(bounds.max.some((v,i)=>v-bounds.min[i]<1e-7))fail('INVALID_REQUEST','bounds must have positive width and height.');
   if(!Array.isArray(c.quad)||c.quad.length!==4)fail('INVALID_REQUEST','quad needs four points: bottom-left, bottom-right, top-right, top-left.');
   const result=deformDrawing(d,selected,bounds,(c.quad as unknown[]).map((p,i)=>point(p,`quad[${i}]`)) as Quad,c.allowRelated===true);
   report(result.maxError);return result.document;
  }
  case 'renameCurve':keys(c,['op','curveId','name']);return curveChange(d,curveExists(d,c.curveId),{name:string(c.name,'name',VECTOR_AI_LIMITS.name).trim()});
  case 'renameStroke':keys(c,['op','curveId','name']);return renameStroke(d,curveExists(d,c.curveId),string(c.name,'name',VECTOR_AI_LIMITS.name).trim());
  case 'setCurveWidth':keys(c,['op','curveIds','width']);return widthChange(d,curvesExist(d,c.curveIds),num(c.width,'width',1e-8,1));
  case 'createLayer':{
   keys(c,['op','name','ref']);const n=addLayer(d,string(c.name,'name',VECTOR_AI_LIMITS.name).trim());created('layer',n.layers[0].id,c.ref);return n;
  }
  case 'duplicateLayer':{
   keys(c,['op','layerId','ref']);const id=layerExists(d,c.layerId),plan=planArtworkLayerImport(d,[id]);
   if(plan.additionalLayerIds.length)fail('DEPENDENCY_REQUIRED',`Layer has cross-layer dependencies: ${plan.additionalLayerIds.join(', ')}. Import dependency-closed artwork layers instead.`);
   const n=duplicateLayer(d,id),source=d.layers.find(l=>l.id===id)!,target=n.layers[0],idMap:Record<string,string>={[id]:target.id};
   source.items.forEach((id,i)=>{idMap[id]=target.items[i];});
   for(const old of d.curves.filter(x=>Object.hasOwn(idMap,x.id))){const copy=n.curves.find(x=>x.id===idMap[old.id])!;old.nodes.forEach((id,i)=>{idMap[id]=copy.nodes[i];});}
   created('layer',target.id,c.ref,idMap);return n;
  }
  case 'deleteLayers':keys(c,['op','layerIds']);return deleteLayers(d,ids(c.layerIds,'layerIds').map(id=>layerExists(d,id)));
  case 'reorderLayer':keys(c,['op','layerId','targetLayerId','after']);bool(c.after,'after');return reorderLayers(d,layerExists(d,c.layerId),layerExists(d,c.targetLayerId),c.after===true);
  case 'setLayer':{
   keys(c,['op','layerId','name','visible','locked']);const change={...stateChange(c),...(c.name===undefined?{}:{name:string(c.name,'name',VECTOR_AI_LIMITS.name).trim()})};nonemptyChange(change);return layerChange(d,layerExists(d,c.layerId),change);
  }
  case 'setObjectState':{
   keys(c,['op','objectIds','visible','locked']);const change=stateChange(c);nonemptyChange(change);return setObjectState(d,ids(c.objectIds,'objectIds').map(id=>objectExists(d,id)),change);
  }
  case 'deleteObjects':keys(c,['op','objectIds']);return deleteObjects(d,ids(c.objectIds,'objectIds').map(id=>objectExists(d,id)));
  case 'moveToLayer':keys(c,['op','curveIds','layerId']);return moveToLayer(d,curvesExist(d,c.curveIds),layerExists(d,c.layerId));
  case 'createFill':{
   keys(c,['op','curveIds','color','kind','ref']);if(c.kind!==undefined&&c.kind!=='SOLID'&&c.kind!=='MIST')fail('INVALID_REQUEST','kind must be SOLID or MIST.');
   const n=createFill(d,curvesExist(d,c.curveIds),color(c.color),c.kind as 'SOLID'|'MIST'|undefined);created('fill',n.fills.at(-1)!.id,c.ref);return n;
  }
  case 'setFill':{
   keys(c,['op','fillId','name','color','visible','locked','mist']);const id=string(c.fillId,'fillId');if(!d.fills.some(f=>f.id===id))fail('NOT_FOUND',`Unknown fill ID: ${id}.`);
   if(c.mist!==undefined){keys(record(c.mist),['enabled','side','width','opacity']);if(!validFillMist(c.mist))fail('INVALID_REQUEST','mist requires enabled, side (INSIDE/OUTSIDE/BOTH), width 0.001–0.8 and opacity 0–1.');}
   const change={...stateChange(c),...(c.name===undefined?{}:{name:string(c.name,'name',VECTOR_AI_LIMITS.name).trim()}),...(c.color===undefined?{}:{color:color(c.color)})};if(c.mist===undefined)nonemptyChange(change);
   const n=changePaint(d,id,change);return c.mist===undefined?n:setFillMist(n,id,c.mist as FillMist);
  }
  case 'reorderObject':{
   keys(c,['op','objectId','targetObjectId','after']);bool(c.after,'after');const id=objectExists(d,c.objectId),target=objectExists(d,c.targetObjectId);
   if(layerFor(d,id)?.id!==layerFor(d,target)?.id)fail('INVALID_REQUEST','Reordering requires objects in the same layer; move first.');return reorderPaint(d,id,target,c.after===true);
  }
  case 'transformLayers':{
   keys(c,['op','layerIds','matrix','allowRelated']);bool(c.allowRelated,'allowRelated');const layers=ids(c.layerIds,'layerIds').map(id=>layerExists(d,id)),selected=d.curves.filter(c=>layers.includes(layerFor(d,c.id)!.id)).map(c=>c.id);return transform(d,selected,affineMap(c.matrix),c.allowRelated===true);
  }
  case 'createCurve':{
   keys(c,['op','layerId','shape','width','name','ref']);const layer=layerExists(d,c.layerId);if(!Array.isArray(c.shape)||c.shape.length!==4)fail('INVALID_REQUEST','shape must contain [P0,H0,H1,P1].');
   const n=createCurve(d,layer,(c.shape as unknown[]).map((p,i)=>point(p,`shape[${i}]`)) as Cubic,c.width===undefined?undefined:num(c.width,'width',1e-8,1),c.name===undefined?undefined:string(c.name,'name',VECTOR_AI_LIMITS.name).trim());created('curve',n.curves.at(-1)!.id,c.ref);return n;
  }
  case 'splitCurve':{
   keys(c,['op','curveId','t','ref']);const result=splitCurve(d,curveExists(d,c.curveId),num(c.t,'t',0,1));created('curve',result.ids[1],c.ref);return result.document;
  }
  case 'setMirrorAxis':keys(c,['op','x']);return setMirrorAxis(d,num(c.x,'x'));
  case 'setInkVisibility':keys(c,['op','curveIds','visible']);if(typeof c.visible!=='boolean')fail('INVALID_REQUEST','visible must be a boolean.');return setInk(d,curvesExist(d,c.curveIds),{inkVisible:c.visible as boolean});
  case 'setCurveInkEnd':keys(c,['op','curveId','end','style']);return setInkEnd(d,curveExists(d,c.curveId),end(c.end),inkEndStyle(c.style));
  case 'setDepth':{
   keys(c,['op','curveId','offset','scope']);if(c.scope!==undefined&&c.scope!=='PARENT'&&c.scope!=='LAYER')fail('INVALID_REQUEST','scope must be PARENT or LAYER.');const offset=num(c.offset,'offset');if(!Number.isSafeInteger(offset))fail('INVALID_REQUEST','offset must be an integer.');return setDepthOffset(d,curveExists(d,c.curveId),offset,c.scope as 'PARENT'|'LAYER'|undefined);
  }
  case 'addDisplayInterval':{
   keys(c,['op','curveId','mode','start','end','enabled','ref']);const id=curveExists(d,c.curveId),change=intervalChange(c),prior=new Set((d.displayIntervals??[]).flatMap(t=>t.ranges.map(r=>r.id)));let n=addDisplayInterval(d,id,change.mode);
   const track=n.displayIntervals!.find(t=>t.ranges.some(r=>!prior.has(r.id)))!,range=track.ranges.find(r=>!prior.has(r.id))!;n=changeDisplayInterval(n,track.id,range.id,change);created('displayRange',range.id,c.ref);return n;
  }
  case 'changeDisplayInterval':keys(c,['op','rangeId','mode','start','end','enabled']);{const r=rangeExists(d,c.rangeId),change=intervalChange(c);nonemptyChange(change);return changeDisplayInterval(d,r.track.id,r.id,change);}
  case 'removeDisplayInterval':keys(c,['op','rangeId']);{const r=rangeExists(d,c.rangeId);return removeDisplayInterval(d,r.track.id,r.id);}
  case 'setDisplayIntervalEnd':keys(c,['op','rangeId','end','style']);{const r=rangeExists(d,c.rangeId);return setDisplayIntervalEnd(d,r.track.id,r.id,end(c.end),inkEndStyle(c.style));}
  default:return fail('UNKNOWN_COMMAND',`Unknown command: ${String(op)}.`);
 }
}
function validateViewport(raw:unknown):VectorViewport{
 const v=record(raw);keys(v,['width','height','center','pixelsPerUnit','origin']);
 return {width:num(v.width,'width',1,4096),height:num(v.height,'height',1,4096),center:point(v.center,'center'),pixelsPerUnit:num(v.pixelsPerUnit,'pixelsPerUnit',1e-6,1e6),...(v.origin===undefined?{}:{origin:point(v.origin,'origin')})};
}
const sourceToCanvas=(p:Point2,v:VectorViewport):Point2=>[v.width/2+(p[0]-v.center[0])*v.pixelsPerUnit,v.height/2-(p[1]-v.center[1])*v.pixelsPerUnit];
const canvasToSource=(p:Point2,v:VectorViewport):Point2=>[v.center[0]+(p[0]-v.width/2)/v.pixelsPerUnit,v.center[1]-(p[1]-v.height/2)/v.pixelsPerUnit];

function defaultHost():VectorEditingHost{
 return {
  getState:useEditor.getState,getMode:()=>useWorkspaceMode.getState().mode,
  commitDrawing(drawing){
   if(!canEditSource())fail('MODE_RESTRICTED','Source edits require Drawing mode. Change modes in the workspace first.');
   const e=useEditor.getState();e.beginEdit();try{e.setDrawing(drawing);}finally{e.endEdit();}
  },
  undo:()=>useEditor.getState().undo(),redo:()=>useEditor.getState().redo(),
  selectCurveIds:ids=>useDrawing.getState().set({selection:{ids},tool:'direct'}),
  getSelection:()=>useDrawing.getState().selection,getActiveLayerId:()=>useDrawing.getState().layerId,
  getViewport(){
   if(typeof document==='undefined')return;
   const canvas=document.querySelector('[data-testid="drawing-canvas"]');if(!canvas)return;
   const r=canvas.getBoundingClientRect(),s=useDrawing.getState(),unit=Math.min(r.width,r.height)/2.8*s.zoom;
   if(unit<=0)return;
   return {width:r.width,height:r.height,center:[-s.pan[0]/unit,s.pan[1]/unit],pixelsPerUnit:unit,origin:[r.left,r.top]};
  },
 };
}

/** Supply a host for headless tests/integrations. All writes still pass through its one store transaction. */
export function createVectorEditingApi(host:VectorEditingHost=defaultHost()){
 const instance=crypto.randomUUID();let current=host.getState().project,serial=0;
 const revision=()=>{const next=host.getState().project;if(next!==current){current=next;serial++;}return `${instance}:${serial}`;};
 function run<T>(action:()=>T):VectorResult<T>{
  try{return {ok:true,value:action(),revision:revision()};}
  catch(error){const e=error as Error;return {ok:false,revision:revision(),error:{code:e instanceof ApiError?e.code:'CONSTRAINT_VIOLATION',message:e.message??String(error),...(e instanceof ApiError&&e.commandIndex!==undefined?{commandIndex:e.commandIndex}:{}),...(e instanceof ApiError&&e.relatedCurveIds?{relatedCurveIds:e.relatedCurveIds}:e instanceof RelatedSelection?{relatedCurveIds:e.ids}:{})}};}
 }
 function expected(value:unknown){if(value!==undefined&&string(value,'expectedRevision')!==revision())fail('STALE_REVISION','The project changed. Inspect again and recompute the edit.');}
 const source=()=>host.getState().project.drawing??emptyDrawing();
 function prepare(input:unknown){
  const r=record(input);keys(r,['commands','expectedRevision','dryRun']);expected(r.expectedRevision);bool(r.dryRun,'dryRun');
  if(host.getMode()!=='drawing')fail('MODE_RESTRICTED','Source edits require Drawing mode. Recording does not change source geometry or topology.');
  if(!Array.isArray(r.commands)||r.commands.length>VECTOR_AI_LIMITS.batch)fail('INVALID_REQUEST',`commands must be an array of at most ${VECTOR_AI_LIMITS.batch} commands.`);
  const before=source(),approximations:{commandIndex:number;sampledMaxError:number}[]=[],created:CreatedEntity[]=[],refs=new Map<string,string>();let next=clone(before);
  const resolve=(value:unknown,key=''):unknown=>{
   if(typeof value==='string'&&(/Id$|Ids$/.test(key))&&value.startsWith('$')){const id=refs.get(value.slice(1));if(!id)fail('UNKNOWN_REFERENCE',`Unknown batch reference: ${value}. References must be created earlier in this batch.`);return id;}
   if(Array.isArray(value))return value.map(v=>resolve(v,key));
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,k)]));
   return value;
  };
  for(const [index,c] of (r.commands as unknown[]).entries()){
   try{
    const previous=next;next=applyCommand(next,resolve(c),error=>approximations.push({commandIndex:index,sampledMaxError:error}),(kind,id,rawRef,idMap)=>{
     const ref=rawRef===undefined?undefined:string(rawRef,'ref',80);if(ref!==undefined){if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(ref))fail('INVALID_REQUEST','ref must begin with a letter and contain only letters, digits, _ or -.');if(refs.has(ref))fail('DUPLICATE_REFERENCE',`Repeated batch reference: ${ref}.`);refs.set(ref,id);}
     created.push({commandIndex:index,kind,id,...(ref===undefined?{}:{ref}),...(idMap?{idMap}:{})});
    });
    // Quad deformation already transports material cut positions; other geometry edits do so here.
    if(['moveNode','moveHandle','transformCurves','transformLayers'].includes((c as VectorCommand).op))next=transportDeformedIntervals(previous,next);
    validateBounds(next);next=parseDrawing(next);checkNewDiagnostics(previous,next);
   }catch(error){const e=error as Error;throw new ApiError(e instanceof ApiError?e.code:'CONSTRAINT_VIOLATION',e.message,index,e instanceof RelatedSelection?e.ids:undefined);}
  }
  return {before,next,changed:JSON.stringify(before)!==JSON.stringify(next),dryRun:r.dryRun===true,approximations,created};
 }
 function inspectQuery(raw:unknown){
  const q=record(raw);keys(q,['layerIds','layerNames','curveIds','curveNames','strokeNames','nameIncludes']);
  for(const k of ['layerIds','layerNames','curveIds','curveNames','strokeNames'])if(q[k]!==undefined)ids(q[k],k,true);
  if(q.nameIncludes!==undefined)string(q.nameIncludes,'nameIncludes');
  const d=source(),allStrokes=d.layers.flatMap(l=>strokes(d,l.id).map(s=>({...s,name:strokeName(d,s),layerId:l.id,derived:true as const}))),byCurve=new Map(allStrokes.flatMap(s=>strokeIds(s).map(id=>[id,s] as const)));
  for(const id of (q.curveIds??[]) as string[])curveExists(d,id);
  for(const id of (q.layerIds??[]) as string[])if(!d.layers.some(l=>l.id===id))fail('NOT_FOUND',`Unknown layer ID: ${id}.`);
  const match=(key:string,value:string)=>q[key]===undefined||(q[key] as string[]).includes(value);
  const selected=d.curves.filter(c=>{const layer=layerFor(d,c.id)!,s=byCurve.get(c.id)!;return match('curveIds',c.id)&&match('curveNames',c.name)&&match('layerIds',layer.id)&&match('layerNames',layer.name)&&match('strokeNames',s.name)&&(q.nameIncludes===undefined||[c.name,c.strokeName??'',layer.name].some(n=>n.toLocaleLowerCase().includes((q.nameIncludes as string).toLocaleLowerCase())));});
  const selectedIds=new Set(selected.map(c=>c.id)),nodeIds=new Set(selected.flatMap(c=>c.nodes));
  const chosenStrokes=allStrokes.filter(s=>s.segments.some(x=>selectedIds.has(x.id)));
  const reference=d.reference?(({dataUrl,...r})=>({...r,pixelsIncluded:false}))(d.reference):null;
  return clone({
   apiVersion:VECTOR_AI_VERSION,mode:host.getMode(),sourceEditable:host.getMode()==='drawing',
   sourceId:host.getState().project.drawingSnapshots?.activeId??'$working',mirrorAxisX:d.mirrorAxisX??0,coordinateSystem:{unit:'source',x:'right',y:'up',handles:'absolute',bounds:'exact cubic centerline; excludes width, mist, offsets and extensions'},
   layers:d.layers.filter(l=>l.items.some(id=>selectedIds.has(id))||(!['curveIds','curveNames','strokeNames','nameIncludes'].some(k=>q[k]!==undefined)&&match('layerIds',l.id)&&match('layerNames',l.name))),
   strokes:chosenStrokes,curves:selected.map(c=>({...c,layerId:layerFor(d,c.id)!.id,strokeId:byCurve.get(c.id)!.id,shape:shapeOf(d,c.id),controls:shapeOf(d,c.id).map((position,index)=>({targetKind:index===0||index===3?'node':'handle',role:['P0','H0','H1','P1'][index],curveId:c.id,...(index===0||index===3?{nodeId:c.nodes[index===0?0:1]}:{end:index===1?0:1}),position})),bounds:cubicBounds(shapeOf(d,c.id))})),
   nodes:d.nodes.filter(n=>nodeIds.has(n.id)).map(n=>({...n,endpoints:members(d,n.id),linkedNodeIds:[...linkedNodeIds(d,n.id)]})),
   fills:d.fills.filter(f=>f.boundary.some(u=>selectedIds.has(u.id))),offsets:d.offsets.filter(o=>o.source.some(u=>selectedIds.has(u.id))),groups:(d.groups??[]).filter(g=>g.curveIds.some(id=>selectedIds.has(id))),
   joins:d.joins.filter(j=>selectedIds.has(j.a.curveId)||selectedIds.has(j.b.curveId)),
   endpointLinks:(d.endpointLinks??[]).filter(l=>selectedIds.has(l.a.curveId)||selectedIds.has(l.b.curveId)),
   displayIntervals:(d.displayIntervals??[]).filter(t=>chosenStrokes.some(s=>s.segments.some(x=>x.id===t.anchor.id))),
   displayIntervalLocations:(d.displayIntervals??[]).filter(t=>chosenStrokes.some(s=>s.segments.some(x=>x.id===t.anchor.id))).map(t=>intervalLocations(d,t)),
   bounds:combineBounds(selected.map(c=>cubicBounds(shapeOf(d,c.id)))),reference,
   displayIntervalCoordinates:{unit:'normalized arc length, not Bezier t',scope:'CURVE means anchor-curve arc length; otherwise derived stroke arc length',direction:'anchor.reverse defines orientation; closed strokes may wrap start > end'},
   selection:host.getSelection?.()??null,activeCreationLayerId:host.getActiveLayerId?.()??null,viewport:host.getViewport?.()??null,
   recording:(host.getState().project as LandmarkProject&{vectorRecording?:unknown}).vectorRecording??null,
   diagnostics:diagnostics(d),
  });
 }
 function history(direction:'undo'|'redo',raw:unknown){
  const r=record(raw);keys(r,['expectedRevision']);expected(r.expectedRevision);
  const state=host.getState(),target=direction==='undo'?state.past.at(-1):state.future[0];
  if(!target)return {changed:false,mode:host.getMode()};
  if(host.getMode()==='recording'&&(target.drawing!==state.project.drawing||target.drawingSnapshots!==state.project.drawingSnapshots))fail('MODE_RESTRICTED','This history step changes source artwork. Return to Drawing mode to undo or redo it.');
  host[direction]();return {changed:host.getState().project!==state.project,mode:host.getMode()};
 }
 return Object.freeze({
  version:VECTOR_AI_VERSION,
  help:()=>({version:VECTOR_AI_VERSION,localOnly:true,sourceWrites:'Drawing mode only; never switches mode',commands:commandNames,limits:VECTOR_AI_LIMITS,coordinateSpaces:['source','canvas','client','reference'],notes:['Use inspect() revision as expectedRevision.','Batches are sequential; shared nodes, links, smooth joins and locks use existing drawing commands.','Creation may name a ref; use $ref in later ID fields in the same batch. Dry-run IDs are provisional, not reserved.','Visibility tracks are transported with geometry; no angle-specific visibility commands.','Dry runs, previews and failed validation create no history entries.','Stroke IDs are derived anchors; curve/node/layer IDs are canonical.','SVG is clean by default; annotations explicitly enable transient selection-scoped AI guides. Reference images are excluded.']}),
  inspect:(query:VectorQuery={})=>run(()=>inspectQuery(query)),
  execute:(request:VectorBatch)=>run(()=>{
   const {before,next,changed,dryRun,approximations,created}=prepare(request),changes=changedIds(before,next);
   const beforeAfter=changes.curveIds.filter(id=>before.curves.some(c=>c.id===id)).map(id=>({curveId:id,layerId:layerFor(next,id)!.id,before:{name:before.curves.find(c=>c.id===id)!.name,shape:clone(shapeOf(before,id)),width:before.curves.find(c=>c.id===id)!.width},after:{name:next.curves.find(c=>c.id===id)!.name,shape:clone(shapeOf(next,id)),width:next.curves.find(c=>c.id===id)!.width}}));
   const addedCurves=next.curves.filter(c=>!before.curves.some(x=>x.id===c.id)).map(c=>({curveId:c.id,layerId:layerFor(next,c.id)!.id,name:c.name,shape:clone(shapeOf(next,c.id))}));
   const result={applied:changed&&!dryRun,dryRun,changed,...changes,created,addedCurves,approximations,beforeBounds:drawingBounds(before),afterBounds:drawingBounds(next),beforeAfter,diagnostics:diagnostics(next)};
   if(changed&&!dryRun)host.commitDrawing(next);
   return result;
  }),
  select:(request:{curveIds:string[];expectedRevision?:string})=>run(()=>{
   const r=record(request);keys(r,['curveIds','expectedRevision']);expected(r.expectedRevision);const selected=ids(r.curveIds,'curveIds',true);selected.forEach(id=>curveExists(source(),id));
   if(!host.selectCurveIds)fail('UNAVAILABLE','Selection is unavailable in this host.');
   host.selectCurveIds!(selected);return {curveIds:selected};
  }),
  undo:(request:{expectedRevision?:string}={})=>run(()=>history('undo',request)),
  redo:(request:{expectedRevision?:string}={})=>run(()=>history('redo',request)),
  exportSource:(request:{includeReference?:boolean;expectedRevision?:string}={})=>run(()=>{
   const r=record(request);keys(r,['includeReference','expectedRevision']);expected(r.expectedRevision);bool(r.includeReference,'includeReference');
   const d=clone(source());if(!r.includeReference)delete d.reference;
   return {mediaType:'application/json',document:d,json:JSON.stringify(d,null,2),includesReference:r.includeReference===true};
  }),
  preview:(options:PreviewOptions={})=>run(()=>{
   const o=record(options);keys(o,['commands','expectedRevision','width','height','center','pixelsPerUnit','showFills','annotations']);expected(o.expectedRevision);bool(o.showFills,'showFills');
   const d=o.commands===undefined?source():prepare({commands:o.commands,expectedRevision:o.expectedRevision,dryRun:true}).next;
   const width=num(o.width??800,'width',1,4096),height=num(o.height??800,'height',1,4096),b=drawingBounds(d);
   const padding=Math.max(.1,...d.curves.map(c=>c.width*2+(c.mist?.enabled?c.mist.width:0)),...d.offsets.map(c=>Math.abs(c.distance)+c.width));
   const viewport:VectorViewport={width,height,center:o.center===undefined?(b?.center??[0,0]):point(o.center,'center'),pixelsPerUnit:num(o.pixelsPerUnit??Math.min(width/((b?b.max[0]-b.min[0]:2.8)+2*padding),height/((b?b.max[1]-b.min[1]:2.8)+2*padding)),'pixelsPerUnit',1e-6,1e6)};
   if(o.showFills!==false&&d.fills.some(f=>f.visible&&f.mist?.enabled)&&(typeof document==='undefined'||typeof Path2D==='undefined'))fail('BROWSER_REQUIRED','Mist-fill SVG export uses the existing Canvas renderer. Run preview in the local app browser, or use showFills:false for an explicit ink-only preview.');
   let annotations:AIGuideOptions|undefined;
   if(o.annotations!==undefined){
    const a=record(o.annotations);keys(a,['curveIds','grid','labels','handles','diagnostics']);for(const flag of ['grid','labels','handles','diagnostics'])bool(a[flag],`annotations.${flag}`);
    const curveIds=a.curveIds===undefined?[]:ids(a.curveIds,'annotations.curveIds',true);
    if(curveIds.length>MAX_AI_GUIDE_CURVES)fail('INVALID_REQUEST',`Annotate at most ${MAX_AI_GUIDE_CURVES} selected curves; narrow the query first.`);
    curveIds.forEach(id=>curveExists(d,id));annotations={...a,curveIds} as AIGuideOptions;
   }
   const noop=()=>{},svg=renderToStaticMarkup(createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width,height,viewBox:`0 0 ${width} ${height}`},createElement(PaintScene,{d,screen:(p:Point2)=>sourceToCanvas(p,viewport),unit:viewport.pixelsPerUnit,pixelsPerUnit:viewport.pixelsPerUnit,preview:true,showFills:o.showFills!==false,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop}),annotations?createElement(AIGuideOverlay,{...annotations,d,curveIds:annotations.curveIds??[],screen:(p:Point2)=>sourceToCanvas(p,viewport),unit:viewport.pixelsPerUnit,width,height}):null));
   return {mediaType:'image/svg+xml',svg,viewport,bounds:b,showFills:o.showFills!==false,annotated:!!annotations,diagnostics:diagnostics(d),sourceRevision:revision()};
  }),
  convertPoint:(request:{point:Point2;from:CoordinateSpace;to:CoordinateSpace;viewport?:VectorViewport})=>run(()=>{
   const r=record(request);keys(r,['point','from','to','viewport']);const spaces=['source','canvas','client','reference'];
   if(!spaces.includes(String(r.from))||!spaces.includes(String(r.to)))fail('INVALID_REQUEST','from/to must be source, canvas, client, or reference.');
   const p=point(r.point,'point'),needsViewport=[r.from,r.to].some(x=>x==='canvas'||x==='client'),view=r.viewport??host.getViewport?.();
   const v=needsViewport?(view?validateViewport(view):fail('VIEWPORT_REQUIRED','Pass a viewport or open the Drawing canvas.')):undefined;
   const ref=source().reference,needsReference=[r.from,r.to].includes('reference');if(needsReference&&!ref)fail('NO_REFERENCE','The source artwork has no reference image.');
   const k=ref?2.6*ref.scale/Math.max(ref.width,ref.height):1,a=(ref?.rotation??0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
   let world:Point2=p;
   if(r.from==='canvas'||r.from==='client')world=canvasToSource(r.from==='client'?[p[0]-(v!.origin?.[0]??0),p[1]-(v!.origin?.[1]??0)]:p,v!);
   if(r.from==='reference'){const x=(p[0]-ref!.width/2)*k,y=-(p[1]-ref!.height/2)*k;world=[ref!.offset[0]+c*x+s*y,ref!.offset[1]-s*x+c*y];}
   let result:Point2=world;
   if(r.to==='canvas'||r.to==='client'){result=sourceToCanvas(world,v!);if(r.to==='client')result=[result[0]+(v!.origin?.[0]??0),result[1]+(v!.origin?.[1]??0)];}
   if(r.to==='reference'){const x=world[0]-ref!.offset[0],y=world[1]-ref!.offset[1];result=[ref!.width/2+(c*x-s*y)/k,ref!.height/2-(s*x+c*y)/k];}
   if(!result.every(Number.isFinite))fail('INVALID_REQUEST','Coordinate conversion exceeded finite bounds.');
   return {point:result,from:r.from as CoordinateSpace,to:r.to as CoordinateSpace,...(v?{viewport:v}:{})};
  }),
 });
}
export type VectorEditingApi=ReturnType<typeof createVectorEditingApi>;
declare global {interface Window {contourAI?:VectorEditingApi}}
/** Returns cleanup; importing the module has no UI/global registration side effects. */
export function registerVectorEditingApi(target:Pick<Window,'contourAI'>=window,api=createVectorEditingApi()){
 const previous=target.contourAI;target.contourAI=api;
 return ()=>{if(target.contourAI===api){if(previous)target.contourAI=previous;else delete target.contourAI;}};
}
