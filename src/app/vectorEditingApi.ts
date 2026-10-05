import {isLayerCageDomain} from '../domain/recordingSnapshot/layerDomains';
import {createLayerCageIntent} from '../domain/drawing/layerDomainIntent';
import {adoptDisplayRoute,detachDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {setEndpointLinkBrush} from '../domain/drawing/endpointRelationAuthoring';
import {createSnapshotRelationAuthoringIntent,snapshotRelationWriteOwner} from '../domain/recordingSnapshot/relationAuthoringIntent';
import {prepareDrawingSnapshotEdit,prepareDrawingSnapshotObjectLocks} from './drawingSnapshotEdit';
import {assertDisplayRouteSupport} from '../domain/drawing/displayRouteInk';
/** Local, JSON-oriented vector authoring. No network, evaluation of code, or mode switching. */
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useEditor} from './store';
import {canEditSource,useWorkspaceMode,type WorkspaceMode} from './workspaceMode';
import {useDrawing} from '../ui/drawing/session';
import PaintScene from '../ui/drawing/PaintScene';
import AIGuideOverlay,{MAX_AI_GUIDE_CURVES,type AIGuideOptions} from '../ui/drawing/AIGuideOverlay';
import type {LandmarkProject} from '../domain/landmarks/model';
import {emptyDrawing,parseDrawing,shapeOf,curveById,layerFor,members,nodeAt,objectById,validFillMist,type FillMist,type TerminusBrushStyle,type TerminusJoinBrush,type DisplayIntervalMode,type DrawingDocument,type Point2,type Cubic} from '../domain/drawing/model';
import {moveNode,moveHandle,transform,curveChange,renameStroke,widthChange,RelatedSelection,addLayer,duplicateLayer,deleteLayers,reorderLayers,layerChange,deleteObjects,moveToLayer,createCurve,setMirrorAxis,linkEndpoints,unlinkEndpoints,connect} from '../domain/drawing/commands';
import {setObjectState,objectState} from '../domain/drawing/objectState';
import {createFill,changePaint,reorderPaint,setInk,setInkEnd} from '../domain/drawing/paintCommands';
import {setDepthOffset} from '../domain/drawing/depth';
import {setFillMist} from '../domain/drawing/fillMist';
import {planArtworkLayerImport} from '../domain/drawing/importArtworkLayers';
import {deformDrawing,transportDeformedIntervals,type Quad,type DeformRect} from '../domain/drawing/deform';
import type {BendHandles,BendValue} from '../domain/deformation/coons';
import {strokes,strokeName,strokeIds,strokeFor} from '../domain/drawing/strokes';
import {linkedNodeIds} from '../domain/drawing/endpointLinks';
import {displayField,displayPath,addDisplayInterval,changeDisplayInterval,removeDisplayInterval,setDisplayIntervalEnd} from '../domain/drawing/displayIntervals';
import {fillGeometry,offsetGeometry} from '../domain/drawing/appearance';
import {roundedJoins} from '../domain/drawing/roundedJoin';
import {ArtworkApiError,artworkOverview,prepareArtworkAction,type ArtworkRequest} from './vectorArtworkApi';
import type {DrawingSnapshotState} from '../domain/drawing/snapshots';
import {applyElementCommand,elementCommandNames,ElementCommandError,type ElementCommand,type ElementCreation} from './vectorElementCommands';
import {applyMirrorCommand,mirrorCommandNames,MirrorApiError,MirrorBatchIntent,type MirrorEditingCommand} from './vectorMirrorEditingApi';
import {MirrorEditingError,validateMirrorEditing} from '../domain/drawing/mirrorEditing';
import {markFinalizedGeometry} from '../domain/drawing/geometryEdit';
import {createLayerCurveSplitIntent,applyLayerEditIntent,curveSplitIntents,type LayerEditIntent} from '../domain/drawing/layerEditIntent';
import {createLayerDomainIntent,createLayerAffineIntent,layerSimilarityFromMatrix,type LayerDomainIntent} from '../domain/drawing/layerDomainIntent';
import {currentDrawingPresentation,drawingSnapshotPresentation} from './drawingSnapshotPresentation';
import {composePreparedSnapshotEdits,prepareSnapshotEdit,snapshotEditContext,type SnapshotEditPlan} from './snapshotEditTransaction';
import {drawingSnapshotForArtwork,remapDrawingIdentities} from '../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {RecordingApiError,prepareRecordingBatch,recordingOverview,evaluateRecording,type RecordingBatch,type RecordingQuery,type RecordingCommand} from './vectorRecordingApi';
import type {VectorRecording} from '../domain/vectorRecording/model';
import {SceneApiError,prepareSceneBatch,sceneOverview,evaluateRecordingScene,type SceneBatch,type SceneQuery,type SceneCommand} from './recordingSceneApi';
import type {RecordingScenes} from '../domain/recordingScene/model';
import {SnapshotApiError,prepareSnapshotBatch,snapshotOverview,evaluateRecordingSnapshot,snapshotCommandNames,recordingRetiredReason,type SnapshotBatch,type SnapshotQuery,type SnapshotCommand} from './recordingSnapshotApi';
import type {RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import type {PaintBatch} from '../domain/drawing/depth';
import {getWorkspaceView,prepareWorkspaceView,replaceWorkspaceView,type WorkspaceView,type WorkspaceViewCommand} from './workspaceView';
import {snapWorkspacePoint} from './workspaceViewSnap';

export const VECTOR_AI_VERSION='2.0';
export const VECTOR_AI_LIMITS=Object.freeze({coordinate:10000,batch:1000,dimension:4096,name:256} as const);
export interface Bounds {min:Point2;max:Point2;center:Point2}
/** SVG affine convention: x'=a*x+c*y+e, y'=b*x+d*y+f. Source Y points up. */
export type Affine=[number,number,number,number,number,number];
export type VectorCommand=MirrorEditingCommand|DisplayRouteCommand|ElementCommand|GeometryLinkCommand
 | {op:'moveNode';nodeId:string;position:Point2}
 | {op:'moveHandle';curveId:string;end:0|1;position:Point2}
 | {op:'transformCurves';curveIds:string[];matrix:Affine;allowRelated?:boolean}
 | {op:'deformCurves';curveIds:string[];bounds:DeformRect;quad:Quad;allowRelated?:boolean;bend?:BendValue}
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
 | {op:'deformLayers';layerIds:string[];bounds:DeformRect;quad:Quad;bend?:BendValue;allowRelated?:boolean}
 | {op:'setLayerDomain';domainId:string;matrix?:Affine;enabled?:boolean;bounds?:DeformRect;quad?:Quad;bend?:BendValue}
 | {op:'createCurve';layerId:string;shape:Cubic;width?:number;name?:string;ref?:string}
 | {op:'splitCurve';curveId:string;t:number;ref?:string}
 | {op:'setMirrorAxis';x:number}
 | {op:'setInkVisibility';curveIds:string[];visible:boolean}
 | {op:'setCurveInkEnd';curveId:string;end:0|1;style:TerminusBrushStyle}
 | {op:'setDepth';curveId:string;offset:number;scope?:'PARENT'|'LAYER'}
 | {op:'addDisplayInterval';curveId:string;mode?:DisplayIntervalMode;start?:number;end?:number;enabled?:boolean;fullLoop?:boolean;ref?:string}
 | {op:'changeDisplayInterval';rangeId:string;mode?:DisplayIntervalMode;start?:number;end?:number;enabled?:boolean;fullLoop?:boolean}
 | {op:'removeDisplayInterval';rangeId:string}
 | {op:'setDisplayIntervalEnd';rangeId:string;end:0|1;style:TerminusBrushStyle};
export type GeometryLinkCommand={op:'linkEndpoints';a:{curveId:string;end:0|1};b:{curveId:string;end:0|1};ref?:string}|{op:'unlinkEndpoints';linkId:string}|{op:'connectGeometry';a:{curveId:string;end:0|1};b:{curveId:string;end:0|1};mode?:'POSITION'};
export type DisplayRouteCommand={op:'adoptDisplayRoute';trackId:string;linkId:string}|{op:'setLinkJoinBrush';linkId:string;brush:TerminusJoinBrush}|{op:'detachDisplayRoute';trackId:string};
export interface CreatedEntity {commandIndex:number;kind:ElementCreation['kind']|'fill'|'displayRange'|'endpointLink'|'mirrorPair';id:string;ref?:string;idMap?:Record<string,string>}
const commandNames=['moveNode','moveHandle','transformCurves','deformCurves','renameCurve','renameStroke','setCurveWidth','createLayer','duplicateLayer','deleteLayers','reorderLayer','setLayer','setObjectState','deleteObjects','moveToLayer','createFill','setFill','reorderObject','transformLayers','deformLayers','setLayerDomain','createCurve','splitCurve','setMirrorAxis','setInkVisibility','setCurveInkEnd','setDepth','addDisplayInterval','changeDisplayInterval','removeDisplayInterval','setDisplayIntervalEnd','linkEndpoints','unlinkEndpoints','connectGeometry','adoptDisplayRoute','detachDisplayRoute','setLinkJoinBrush',...elementCommandNames,...mirrorCommandNames];
const relationCommandNames=new Set(['linkEndpoints','unlinkEndpoints','adoptDisplayRoute','detachDisplayRoute','setLinkJoinBrush','addDisplayInterval','changeDisplayInterval','removeDisplayInterval','setDisplayIntervalEnd']);
/** Direct controls read the same resolved relation/geometry context as Drawing.
 * The app adapter then writes source originals or local state by actual owner. */
function snapshotCommandView(project:LandmarkProject,command:Record<string,unknown>){
 const view=project.recordingSnapshots&&drawingSnapshotPresentation(project.recordingSnapshots,project.drawingSnapshots?.activeId??'$working');if(!view)return undefined;
 if(command.op==='setLayer')return typeof command.layerId==='string'&&view.layerOwners.get(command.layerId)?.kind==='snapshot-local'?view:undefined;
 if(command.op==='setObjectState')return Array.isArray(command.objectIds)&&command.objectIds.some(id=>view.layerOwners.get(layerFor(view.drawing,String(id))?.id??'')?.kind==='snapshot-local')?view:undefined;
 if(command.op==='createCurve')return typeof command.layerId==='string'&&view.layerOwners.get(command.layerId)?.kind==='snapshot-local'?view:undefined;
 if(command.op==='moveHandle')return view.drawing.curves.some(curve=>curve.id===command.curveId)?view:undefined;
 if(command.op==='moveNode')return view.drawing.nodes.some(node=>node.id===command.nodeId)?view:undefined;
 if(!relationCommandNames.has(String(command.op)))return undefined;
 const snapshot=project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id===view.snapshotId)!,drawing=remapDrawingIdentities(view.drawing,view.canonicalId),id=(value:unknown)=>typeof value==='string'?view.canonicalId(value):'';
 const link=command.op==='linkEndpoints'?{id:'$new-relation',a:{curveId:id((command.a as {curveId?:unknown}|undefined)?.curveId),end:(command.a as {end?:0|1}|undefined)?.end??0},b:{curveId:id((command.b as {curveId?:unknown}|undefined)?.curveId),end:(command.b as {end?:0|1}|undefined)?.end??0}}:drawing.endpointLinks?.find(link=>link.id===id(command.linkId));
 if(link&&[link.a,link.b].every(endpoint=>drawing.curves.some(curve=>curve.id===endpoint.curveId))&&snapshotRelationWriteOwner(snapshot,drawing,'endpointLinks',link)==='snapshot-local')return view;
 const tracks=(drawing.displayIntervals??[]).filter(track=>track.id===id(command.trackId)||track.ranges.some(range=>range.id===id(command.rangeId))||command.op==='addDisplayInterval'&&displayPath(drawing,track.anchor.id).segments.some(use=>use.id===id(command.curveId)));
 if(tracks.some(track=>snapshotRelationWriteOwner(snapshot,drawing,'displayIntervals',track)==='snapshot-local'))return view;
 return command.op==='addDisplayInterval'&&view.layerOwners.get(layerFor(view.drawing,String(command.curveId))?.id??'')?.kind==='snapshot-local'?view:undefined;
}
export interface VectorBatch {commands:VectorCommand[];expectedRevision?:string;dryRun?:boolean}
export interface VectorQuery {layerIds?:string[];layerNames?:string[];curveIds?:string[];curveNames?:string[];strokeNames?:string[];nameIncludes?:string;includeRecording?:boolean}
/** center is the source-space point at the middle of the output. origin is optional client-space offset. */
export interface VectorViewport {width:number;height:number;center:Point2;pixelsPerUnit:number;origin?:Point2}
export interface PreviewOptions {commands?:VectorCommand[];expectedRevision?:string;width?:number;height?:number;center?:Point2;pixelsPerUnit?:number;showFills?:boolean;annotations?:AIGuideOptions}
export interface RecordingPreviewOptions extends Omit<PreviewOptions,'commands'> {commands?:RecordingCommand[];angle?:{x:number;y:number};useDraft?:boolean}
export interface RecordingFramesOptions extends Omit<PreviewOptions,'commands'|'annotations'> {angles?:Array<{x:number;y:number}>}
export type CoordinateSpace='source'|'canvas'|'client'|'reference';
export type VectorResult<T>={ok:true;revision:string;value:T}|{ok:false;revision:string;error:{code:string;message:string;commandIndex?:number;relatedCurveIds?:string[]}};
export interface VectorEditingHost {
 getState():{project:LandmarkProject;past:readonly LandmarkProject[];future:readonly LandmarkProject[]};
 getMode():WorkspaceMode;
 commitDrawing(drawing:DrawingDocument):void;
 /** Atomically commit a fully preflighted source/Snapshot candidate in one Undo. */
 commitSnapshotEditPlan?(plan:SnapshotEditPlan):void;
 commitArtwork?(state:DrawingSnapshotState):void;
 commitRecording?(recording:VectorRecording):void;
 commitRecordingScenes?(recording:RecordingScenes):void;
 commitRecordingSnapshots?(recording:RecordingSnapshotWorkspace):void;
 commitRecordingSnapshotEditPlan?(plan:SnapshotEditPlan):void;
 getView?():WorkspaceView;
 replaceView?(view:WorkspaceView):void;
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
function bendValue(value:unknown):BendValue {
 const b=record(value);keys(b,['enabled','handles']);
 if(typeof b.enabled!=='boolean')fail('INVALID_REQUEST','bend.enabled must be a boolean.');
 if(!Array.isArray(b.handles)||b.handles.length!==4)fail('INVALID_REQUEST','bend.handles must contain bottom, right, top and left edge handles.');
 const handles=(b.handles as unknown[]).map((edge,i)=>{
  if(!Array.isArray(edge)||edge.length!==2)fail('INVALID_REQUEST',`bend.handles[${i}] must contain two points.`);
  return (edge as unknown[]).map((p,j)=>{
   if(!Array.isArray(p)||p.length!==2)fail('INVALID_REQUEST',`bend.handles[${i}][${j}] must be [x, y].`);
   return (p as unknown[]).map((n,k)=>num(n,`bend.handles[${i}][${j}][${k}]`,-8,8)) as Point2;
  });
 }) as BendHandles;
 return {handles,enabled:b.enabled as boolean};
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
function affineCoefficients(matrix:unknown):Affine {
 if(!Array.isArray(matrix)||matrix.length!==6)fail('INVALID_REQUEST','matrix must contain [a,b,c,d,e,f].');
 return (matrix as unknown[]).map((v,i)=>num(v,`matrix[${i}]`)) as Affine;
}
function affineMap(matrix:unknown){
 const [a,b,c,d,e,f]=affineCoefficients(matrix);
 if(Math.abs(a*d-b*c)<1e-12)fail('INVALID_REQUEST','The affine transform must be nonsingular.');
 return (p:Point2):Point2=>[a*p[0]+c*p[1]+e,b*p[0]+d*p[1]+f];
}
function end(value:unknown):0|1{if(value!==0&&value!==1)fail('INVALID_REQUEST','end must be 0 or 1.');return value as 0|1;}
function geometryEndpoint(d:DrawingDocument,raw:unknown){const e=record(raw);keys(e,['curveId','end']);return {curveId:curveExists(d,e.curveId),end:end(e.end)};}
function intervalChange(c:Record<string,unknown>){
 if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');bool(c.enabled,'enabled');bool(c.fullLoop,'fullLoop');
 return {...(c.fullLoop===undefined?{}:{fullLoop:c.fullLoop as boolean}),...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.enabled===undefined?{}:{enabled:c.enabled as boolean}),...(c.start===undefined?{}:{start:num(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:num(c.end,'end',0,1)})};
}
function rangeExists(d:DrawingDocument,value:unknown){const id=string(value,'rangeId'),track=d.displayIntervals?.find(t=>t.ranges.some(r=>r.id===id));if(!track)fail('NOT_FOUND',`Unknown display range ID: ${id}.`);return {id,track:track!};}
function terminusBrushStyle(value:unknown):TerminusBrushStyle{
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
 return {mirrorEditingChanged:JSON.stringify(before.mirrorEditing)!==JSON.stringify(after.mirrorEditing),mirrorPairIds:changed(before.mirrorEditing?.curvePairs??[],after.mirrorEditing?.curvePairs??[]),curveIds:curves,nodeIds:nodes,layerIds:changed(before.layers,after.layers),fillIds:changed(before.fills,after.fills),offsetIds:changed(before.offsets,after.offsets),groupIds:changed(before.groups??[],after.groups??[]),joinIds:changed(before.joins,after.joins),endpointLinkIds:changed(before.endpointLinks??[],after.endpointLinks??[]),displayTrackIds:changed(before.displayIntervals??[],after.displayIntervals??[]),affectedFillIds:after.fills.filter(f=>f.boundary.some(u=>curves.includes(u.id))).map(f=>f.id),affectedOffsetIds:after.offsets.filter(o=>o.source.some(u=>curves.includes(u.id))).map(o=>o.id),removed:{mirrorPairIds:removed(before.mirrorEditing?.curvePairs??[],after.mirrorEditing?.curvePairs??[]),curveIds:removed(before.curves,after.curves),nodeIds:removed(before.nodes,after.nodes),layerIds:removed(before.layers,after.layers),fillIds:removed(before.fills,after.fills),offsetIds:removed(before.offsets,after.offsets),groupIds:removed(before.groups??[],after.groups??[]),joinIds:removed(before.joins,after.joins),endpointLinkIds:removed(before.endpointLinks??[],after.endpointLinks??[]),displayTrackIds:removed(before.displayIntervals??[],after.displayIntervals??[])}};
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
function applyCommand(d:DrawingDocument,raw:unknown,report:(sampledMaxError:number)=>void,created:(kind:CreatedEntity['kind'],id:string,ref:unknown,idMap?:Record<string,string>)=>void,prepareSplit:(drawing:DrawingDocument,curveId:string,t:number)=>ReturnType<typeof applyLayerEditIntent>):DrawingDocument{
 const c=record(raw),op=c.op;
 if(mirrorCommandNames.includes(op as string))return applyMirrorCommand(d,c,(id,ref)=>created('mirrorPair',id,ref));
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
   keys(c,['op','curveIds','bounds','quad','allowRelated','bend']);const selected=curvesExist(d,c.curveIds);bool(c.allowRelated,'allowRelated');
   const b=record(c.bounds);keys(b,['min','max']);const bounds={min:point(b.min,'bounds.min'),max:point(b.max,'bounds.max')};
   if(bounds.max.some((v,i)=>v-bounds.min[i]<1e-7))fail('INVALID_REQUEST','bounds must have positive width and height.');
   if(!Array.isArray(c.quad)||c.quad.length!==4)fail('INVALID_REQUEST','quad needs four points: bottom-left, bottom-right, top-right, top-left.');
   const result=deformDrawing(d,selected,bounds,(c.quad as unknown[]).map((p,i)=>point(p,`quad[${i}]`)) as Quad,c.allowRelated===true,c.bend===undefined?undefined:bendValue(c.bend));
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
   const n=duplicateLayer(d,id),source=d.layers.find(l=>l.id===id)!,target=n.layers[0],idMap:Record<string,string>=Object.create(null);idMap[id]=target.id;
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
   keys(c,['op','curveId','t','ref']);const curveId=curveExists(d,c.curveId),result=prepareSplit(d,curveId,num(c.t,'t',0,1));created('curve',result.ids[1],c.ref,Object.fromEntries(curveSplitIntents(result.intent).map(split=>[split.curveId,split.childCurveIds[0]])));for(const id of curveSplitIntents(result.intent).flatMap(split=>[...split.childCurveIds]))if(id!==result.ids[1])created('curve',id,undefined);return result.document;
  }
  case 'setMirrorAxis':keys(c,['op','x']);return setMirrorAxis(d,num(c.x,'x'));
  case 'setInkVisibility':keys(c,['op','curveIds','visible']);if(typeof c.visible!=='boolean')fail('INVALID_REQUEST','visible must be a boolean.');return setInk(d,curvesExist(d,c.curveIds),{inkVisible:c.visible as boolean});
  case 'setCurveInkEnd':keys(c,['op','curveId','end','style']);return setInkEnd(d,curveExists(d,c.curveId),end(c.end),terminusBrushStyle(c.style));
  case 'setDepth':{
   keys(c,['op','curveId','offset','scope']);if(c.scope!==undefined&&c.scope!=='PARENT'&&c.scope!=='LAYER')fail('INVALID_REQUEST','scope must be PARENT or LAYER.');const offset=num(c.offset,'offset');if(!Number.isSafeInteger(offset))fail('INVALID_REQUEST','offset must be an integer.');return setDepthOffset(d,curveExists(d,c.curveId),offset,c.scope as 'PARENT'|'LAYER'|undefined);
  }
  case 'addDisplayInterval':{
   keys(c,['op','curveId','mode','start','end','enabled','fullLoop','ref']);const id=curveExists(d,c.curveId),change=intervalChange(c),prior=new Set((d.displayIntervals??[]).flatMap(t=>t.ranges.map(r=>r.id)));let n=addDisplayInterval(d,id,change.mode);
   const track=n.displayIntervals!.find(t=>t.ranges.some(r=>!prior.has(r.id)))!,range=track.ranges.find(r=>!prior.has(r.id))!;n=changeDisplayInterval(n,track.id,range.id,change);created('displayRange',range.id,c.ref);return n;
  }
  case 'changeDisplayInterval':keys(c,['op','rangeId','mode','start','end','enabled','fullLoop']);{const r=rangeExists(d,c.rangeId),change=intervalChange(c);nonemptyChange(change);return changeDisplayInterval(d,r.track.id,r.id,change);}
  case 'removeDisplayInterval':keys(c,['op','rangeId']);{const r=rangeExists(d,c.rangeId);return removeDisplayInterval(d,r.track.id,r.id);}
  case 'setDisplayIntervalEnd':keys(c,['op','rangeId','end','style']);{const r=rangeExists(d,c.rangeId);return setDisplayIntervalEnd(d,r.track.id,r.id,end(c.end),terminusBrushStyle(c.style));}
  case 'adoptDisplayRoute':{
   keys(c,['op','trackId','linkId']);const result=adoptDisplayRoute(d,string(c.trackId,'trackId'),string(c.linkId,'linkId'));for(const id of result.generatedRangeIds)created('displayRange',id,undefined);return result.document;
  }
  case 'detachDisplayRoute':{keys(c,['op','trackId']);return detachDisplayRoute(d,string(c.trackId,'trackId')).document;}
  case 'setLinkJoinBrush':{
   keys(c,['op','linkId','brush']);const id=string(c.linkId,'linkId'),link=d.endpointLinks?.find(l=>l.id===id);if(!link)fail('NOT_FOUND',`Unknown geometry link ID: ${id}.`);if([link!.a,link!.b].some(e=>curveById(d,e.curveId).locked))fail('CONSTRAINT_VIOLATION','A linked curve is locked.');const b=record(c.brush);keys(b,b.kind==='ARC'?['kind','trimDistance']:['kind']);if(!['SHARP','SMOOTH','ARC'].includes(b.kind as string))fail('INVALID_REQUEST','Unknown terminus join brush.');const brush:TerminusJoinBrush=b.kind==='ARC'?{kind:'ARC',trimDistance:num(b.trimDistance,'trimDistance',1e-7,2)}:{kind:b.kind as 'SHARP'|'SMOOTH'};return setEndpointLinkBrush(d,id,brush);
  }
  case 'linkEndpoints':{
   keys(c,['op','a','b','ref']);const n=linkEndpoints(d,geometryEndpoint(d,c.a),geometryEndpoint(d,c.b),true),added=n.endpointLinks?.find(l=>!d.endpointLinks?.some(old=>old.id===l.id));
   if(added)created('endpointLink',added.id,c.ref);else if(c.ref!==undefined)fail('ALREADY_CONNECTED','These geometry endpoints are already connected; no new link ID was created. Inspect the existing links or omit ref.');
   return n;
  }
  case 'unlinkEndpoints':{
   keys(c,['op','linkId']);const id=string(c.linkId,'linkId');if(!d.endpointLinks?.some(l=>l.id===id))fail('NOT_FOUND',`Unknown geometry endpoint link ID: ${id}.`);return unlinkEndpoints(d,id);
  }
  case 'connectGeometry':{
   keys(c,['op','a','b','mode']);if(c.mode!==undefined&&c.mode!=='POSITION')fail('INVALID_REQUEST','connectGeometry currently supports POSITION only, with no implied joint brush.');
   const a=geometryEndpoint(d,c.a),b=geometryEndpoint(d,c.b);if(a.curveId===b.curveId&&a.end===b.end)fail('INVALID_REQUEST','Choose two different geometry endpoints.');
   if(layerFor(d,a.curveId)!.id!==layerFor(d,b.curveId)!.id)fail('INVALID_REQUEST','Geometry node merging requires one layer; use linkEndpoints for cross-layer position coupling.');
   if(nodeAt(d,a).id===nodeAt(d,b).id)return d;
   const source=d.curves.find(x=>x.id===a.curveId)!,scope=new Set([...strokeIds(strokeFor(d,a.curveId)),...strokeIds(strokeFor(d,b.curveId))]);
   if(d.displayIntervals?.some(t=>t.scope!=='CURVE'&&scope.has(t.anchor.id)))fail('INTERVAL_TOPOLOGY_CONFLICT','Merging these strokes would change existing stroke-wide interval coordinates. Connect the source topology before authoring visibility ranges; no automatic range migration was applied.');
   if(d.curves.some(x=>scope.has(x.id)&&(x.width!==source.width||x.profile!==source.profile||x.profileReverse!==source.profileReverse)))fail('STYLE_CONFLICT','Node merging would synchronize differing width/profile styles. Explicitly align those styles first.');
   return connect(d,a,b,'POSITION',undefined,true);
  }
  default:{const result=applyElementCommand(d,c);if(!result)return fail('UNKNOWN_COMMAND',`Unknown command: ${String(op)}.`);for(const item of result.created??[])created(item.kind,item.id,item.ref,item.idMap);return result.document;}
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
  commitSnapshotEditPlan(plan){if(!canEditSource())fail('MODE_RESTRICTED','Source edits require Drawing mode.');useEditor.getState().commitPreparedSnapshotEdit(plan);},
  commitDrawing(drawing){
   if(!canEditSource())fail('MODE_RESTRICTED','Source edits require Drawing mode. Change modes in the workspace first.');
   const e=useEditor.getState();e.beginEdit();try{e.setDrawing(drawing);}finally{e.endEdit();}
  },
  commitArtwork(state){
   if(!canEditSource())fail('MODE_RESTRICTED','Artwork writes require Drawing mode. Change modes in the workspace first.');
   const e=useEditor.getState();e.beginEdit();try{e.setDrawingSnapshotState(state);}finally{e.endEdit();}
  },
  getView:getWorkspaceView,replaceView:replaceWorkspaceView,
  commitRecording(recording){if(useWorkspaceMode.getState().mode!=='recording')fail('MODE_RESTRICTED','Recording commands require Recording mode.');useEditor.getState().commitVectorRecording(recording);},
  commitRecordingScenes(recording){if(useWorkspaceMode.getState().mode!=='recording')fail('MODE_RESTRICTED','Scene commands require Recording mode.');useEditor.getState().commitRecordingScenes(recording);},
  commitRecordingSnapshots(recording){if(useWorkspaceMode.getState().mode!=='recording')fail('MODE_RESTRICTED','Snapshot commands require Recording mode.');useEditor.getState().commitRecordingSnapshots(recording);},
  commitRecordingSnapshotEditPlan(plan){if(useWorkspaceMode.getState().mode!=='recording')fail('MODE_RESTRICTED','Snapshot commands require Recording mode.');useEditor.getState().commitPreparedSnapshotEdit(plan);},
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
 const instance=crypto.randomUUID();let current=host.getState().project,currentDrawing=current.drawing,currentLibrary=current.drawingSnapshots,currentWorkingCopies=current.drawingWorkingCopies,currentScenes=current.recordingScenes,currentSnapshots=current.recordingSnapshots,serial=0;
 // Source/library identity participates even if an integration replaces a field
 // on its project wrapper. Scene batches never key revisions to scene alone.
 const revision=()=>{const next=host.getState().project;if(next!==current||next.drawing!==currentDrawing||next.drawingSnapshots!==currentLibrary||next.drawingWorkingCopies!==currentWorkingCopies||next.recordingScenes!==currentScenes||next.recordingSnapshots!==currentSnapshots){current=next;currentDrawing=next.drawing;currentLibrary=next.drawingSnapshots;currentWorkingCopies=next.drawingWorkingCopies;currentScenes=next.recordingScenes;currentSnapshots=next.recordingSnapshots;serial++;}return `${instance}:${serial}`;};
 function run<T>(action:()=>T):VectorResult<T>{
  try{return {ok:true,value:action(),revision:revision()};}
  catch(error){const e=error as Error;return {ok:false,revision:revision(),error:{code:e instanceof ApiError||e instanceof ArtworkApiError||e instanceof RecordingApiError||e instanceof SceneApiError||e instanceof SnapshotApiError?e.code:'CONSTRAINT_VIOLATION',message:e.message??String(error),...((e instanceof ApiError||e instanceof RecordingApiError||e instanceof SceneApiError||e instanceof SnapshotApiError)&&e.commandIndex!==undefined?{commandIndex:e.commandIndex}:{}),...(e instanceof ApiError&&e.relatedCurveIds?{relatedCurveIds:e.relatedCurveIds}:e instanceof RelatedSelection?{relatedCurveIds:e.ids}:{})}};}
 }
 function runView<T>(action:()=>T):{ok:true;value:T}|{ok:false;error:{code:string;message:string;commandIndex?:number}}{try{return {ok:true,value:action()};}catch(error){const e=error as Error;return {ok:false,error:{code:e instanceof ApiError?e.code:'VIEW_INVALID',message:e.message,...(e instanceof ApiError&&e.commandIndex!==undefined?{commandIndex:e.commandIndex}:{})}};}}
 function expected(value:unknown){if(value!==undefined&&string(value,'expectedRevision')!==revision())fail('STALE_REVISION','The project changed. Inspect again and recompute the edit.');}
 const source=()=>host.getState().project.drawing??emptyDrawing();
 function legacySceneAvailable(){fail('LEGACY_SCENE_RETIRED',recordingRetiredReason);}
 function legacyRecordingAvailable(){fail('LEGACY_RECORDING_RETIRED',recordingRetiredReason);}
 function prepare(input:unknown){
  const r=record(input);keys(r,['commands','expectedRevision','dryRun']);expected(r.expectedRevision);bool(r.dryRun,'dryRun');
  if(host.getMode()!=='drawing')fail('MODE_RESTRICTED','Source edits require Drawing mode. Recording does not change source geometry or topology.');
  if(!Array.isArray(r.commands)||r.commands.length>VECTOR_AI_LIMITS.batch)fail('INVALID_REQUEST',`commands must be an array of at most ${VECTOR_AI_LIMITS.batch} commands.`);
  const mirrorIntent=new MirrorBatchIntent(),beforeProject=host.getState().project;let candidateProject=beforeProject,pendingSource=false,domainChanged=false,snapshotContextChanged=false;const topologyIntents:LayerEditIntent[]=[],domainIntents:LayerDomainIntent[]=[],steps:SnapshotEditPlan[]=[];
  const accept=(plan:SnapshotEditPlan)=>{steps.push(plan);return plan.project;};
  const before=source(),approximations:{commandIndex:number;sampledMaxError:number}[]=[],created:CreatedEntity[]=[],refs=new Map<string,string>();let next=clone(before);
  const canonicalIdExists=(id:string)=>[...next.layers,...next.curves,...next.nodes,...next.fills,...next.offsets,...next.joins,...(next.endpointLinks??[]),...(next.groups??[]),...(next.displayIntervals??[]),...(next.displayIntervals??[]).flatMap(t=>t.ranges),...(next.mirrorEditing?.curvePairs??[])].some(x=>x.id===id);
  const resolve=(value:unknown,key='',mirrorPair=false):unknown=>{
   if(typeof value==='string'&&(/Id$|Ids$/.test(key)||mirrorPair&&['a','b'].includes(key))&&value.startsWith('$')){if(canonicalIdExists(value))return value;const id=refs.get(value.slice(1));if(!id)fail('UNKNOWN_REFERENCE',`Unknown batch reference: ${value}. References must be created earlier in this batch.`);return id;}
   if(Array.isArray(value))return value.map(v=>resolve(v,key,mirrorPair));
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,k,mirrorPair)]));
   return value;
  };
  for(const [index,c] of (r.commands as unknown[]).entries()){
   try{
    let topologyIntent:LayerEditIntent|undefined;
    const raw=record(c),resolved=record(resolve(c,'',raw.op==='createMirrorPair'||raw.op==='setMirrorPair'));let previous=next;
    // Layer scope survives the API boundary. Resolve ownership against the
    // current candidate, after prior source edits, before expanding members.
    if(resolved.op==='transformLayers'||resolved.op==='deformLayers'||resolved.op==='setLayerDomain'){
     const replacing=resolved.op==='setLayerDomain';keys(resolved,replacing?['op','domainId','matrix','enabled','bounds','quad','bend']:resolved.op==='deformLayers'?['op','layerIds','bounds','quad','bend','allowRelated']:['op','layerIds','matrix','allowRelated']);bool(resolved.allowRelated,'allowRelated');bool(resolved.enabled,'enabled');
     if(replacing&&resolved.matrix===undefined&&resolved.enabled===undefined&&resolved.bounds===undefined&&resolved.quad===undefined&&resolved.bend===undefined)fail('INVALID_REQUEST','Provide authored parameters or an enabled state for the saved layer domain.');
     if(pendingSource){candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(next)}));pendingSource=false;}
     const view=candidateProject.recordingSnapshots&&drawingSnapshotPresentation(candidateProject.recordingSnapshots,candidateProject.drawingSnapshots?.activeId??'$working'),presentation=view?.drawing??next,prior=replacing?view?.evaluation.state.layerDomains?.find(domain=>domain.id===string(resolved.domainId,'domainId')):undefined;
     if(replacing&&!prior)fail('NOT_FOUND','The saved layer domain no longer exists.');
     const requested=replacing?prior!.layerIds.map(view!.presentationId):ids(resolved.layerIds,'layerIds'),cage=resolved.op==='deformLayers'||!!prior&&isLayerCageDomain(prior);
     requested.forEach(id=>layerExists(presentation,id));
     if(cage&&resolved.matrix!==undefined||!cage&&[resolved.bounds,resolved.quad,resolved.bend].some(value=>value!==undefined))fail('INVALID_REQUEST','Replace a domain using its authored parameter kind.');
     const previousCage=prior&&isLayerCageDomain(prior)?prior:undefined,matrix=cage?undefined:resolved.matrix===undefined&&prior&&!isLayerCageDomain(prior)?prior.matrix:affineCoefficients(resolved.matrix),value=!cage&&!replacing?layerSimilarityFromMatrix(matrix!):undefined;
     const intent=cage?createLayerCageIntent(requested,{kind:'h-coons',restRect:(resolved.bounds??previousCage?.restRect) as DeformRect,quad:(resolved.quad??previousCage?.quad) as Quad,bend:(resolved.bend??previousCage?.bend) as BendValue|undefined,...(previousCage?.strokeScope?{strokeScope:{...previousCage.strokeScope,curveIds:previousCage.strokeScope.curveIds.map(view!.presentationId)}}:{}),...(resolved.enabled===undefined?(prior?.enabled===undefined?{}:{enabled:prior.enabled}):{enabled:resolved.enabled as boolean})},prior?{operationId:prior.id,replace:true}:{}):value?createLayerDomainIntent(requested,value):createLayerAffineIntent(requested,matrix!,{...(prior?{operationId:prior.id,replace:true,enabled:resolved.enabled===undefined?prior.enabled:resolved.enabled as boolean}:{})}),plan=prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'layer-domain',intent,allowRelated:resolved.allowRelated===true}),sourceAfter=clone(plan.project.drawing??emptyDrawing());
     if(previous.mirrorEditing?.enabled)mirrorIntent.capture(sourceAfter,resolved);
     accept(plan);const mirrored=mirrorIntent.apply(previous,sourceAfter),candidate=JSON.stringify(mirrored)===JSON.stringify(sourceAfter)?plan.project:accept(prepareSnapshotEdit(snapshotEditContext(plan.project,true),{kind:'original-geometry',drawing:markFinalizedGeometry(transportDeformedIntervals(sourceAfter,mirrored))})),wanted=currentDrawingPresentation(candidate);
     validateBounds(wanted);assertDisplayRouteSupport(wanted);checkNewDiagnostics(presentation,wanted);
     domainChanged=domainChanged||plan.changed||candidate!==plan.project;domainIntents.push(intent);candidateProject=candidate;next=clone(candidateProject.drawing??emptyDrawing());continue;
    }
    if(relationCommandNames.has(String(resolved.op))&&pendingSource){candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(next)}));pendingSource=false;}
    let localView=snapshotCommandView(candidateProject,resolved);
    if(localView){if(pendingSource){candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(next)}));pendingSource=false;localView=snapshotCommandView(candidateProject,resolved);}
     if(localView)previous=clone(localView.drawing);
    }
    // Ordinary runs share one source synchronization. A split is the explicit
    // boundary: flush prior edits before freezing any real Snapshot controls.
    if(resolved.op==='splitCurve'&&pendingSource){candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(previous)}));pendingSource=false;}
    next=applyCommand(previous,resolved,error=>approximations.push({commandIndex:index,sampledMaxError:error}),(kind,id,rawRef,idMap)=>{
     const ref=rawRef===undefined?undefined:string(rawRef,'ref',80);if(ref!==undefined){if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(ref))fail('INVALID_REQUEST','ref must begin with a letter and contain only letters, digits, _ or -.');if(refs.has(ref))fail('DUPLICATE_REFERENCE',`Repeated batch reference: ${ref}.`);
      for(const alias of [ref,...Object.keys(idMap??{}).map(old=>`${ref}/${old}`)])if(canonicalIdExists(`$${alias}`))fail('REFERENCE_COLLISION',`Reference $${alias} collides with an existing canonical ID. Choose another ref.`);
      refs.set(ref,id);for(const [old,newId] of Object.entries(idMap??{}))refs.set(`${ref}/${old}`,newId);
     }
     created.push({commandIndex:index,kind,id,...(ref===undefined?{}:{ref}),...(idMap?{idMap}:{})});
    },(drawing,curveId,t)=>{
     const workspace=candidateProject.recordingSnapshots,source=workspace&&drawingSnapshotForArtwork(workspace,candidateProject.drawingSnapshots?.activeId??'$working'),pair=drawing.mirrorEditing?.enabled?drawing.mirrorEditing.curvePairs.find(pair=>pair.a===curveId||pair.b===curveId):undefined,rawTargets=new Set([curveId,...(pair?[pair.a,pair.b]:[])]),canonicalTargets=new Set(Object.entries(source?.source?.originIds??{}).filter(([,raw])=>rawTargets.has(raw)).map(([id])=>id));
     const relatedDrawings=workspace&&source?workspace.snapshots.flatMap(snapshot=>[resolveSnapshot(workspace,snapshot.id,{useDraft:false,diagnostics:'preview'}).drawing,...(snapshot.draft?[resolveSnapshot(workspace,snapshot.id,{useDraft:true,angle:snapshot.draft.angle,diagnostics:'preview'}).drawing]:[])].filter(evaluated=>evaluated.curves.some(curve=>canonicalTargets.has(curve.id))).map(evaluated=>remapDrawingIdentities(evaluated,id=>source.source!.originIds[id]??id))):[];
     topologyIntent=createLayerCurveSplitIntent(drawing,curveId,t,{relatedDrawings});topologyIntents.push(topologyIntent);return applyLayerEditIntent(drawing,topologyIntent);
    });
    if(!localView&&mirrorCommandNames.includes(resolved.op as string)){if(JSON.stringify(previous.mirrorEditing)!==JSON.stringify(next.mirrorEditing))mirrorIntent.clear();}
    else if(!localView||resolved.op==='moveNode'||resolved.op==='moveHandle'){if(previous.mirrorEditing?.enabled)mirrorIntent.capture(next,resolved);next=mirrorIntent.apply(previous,next);}
    // Quad deformation already transports material cut positions; other geometry edits do so here.
    if(['moveNode','moveHandle','transformCurves','transformLayers','linkEndpoints','connectGeometry'].includes((c as VectorCommand).op))next=transportDeformedIntervals(previous,next);
    validateBounds(next);assertDisplayRouteSupport(next);next=parseDrawing(next);checkNewDiagnostics(previous,next);
    if(localView){const intent=relationCommandNames.has(String(resolved.op))?createSnapshotRelationAuthoringIntent(localView.snapshotId,previous,next):undefined,plan=prepareDrawingSnapshotEdit(candidateProject,markFinalizedGeometry(next),intent);candidateProject=accept(plan);domainChanged=domainChanged||plan.changed;if((resolved.op==='setObjectState'||resolved.op==='setLayer')&&resolved.locked!==undefined){const objectIds=resolved.op==='setObjectState'?resolved.objectIds as string[]:previous.layers.find(layer=>layer.id===resolved.layerId)!.items,locks=prepareDrawingSnapshotObjectLocks(candidateProject,objectIds,resolved.locked as boolean);candidateProject=accept(locks);domainChanged=domainChanged||locks.changed;}snapshotContextChanged=true;next=clone(candidateProject.drawing??emptyDrawing());pendingSource=false;}
    else if(topologyIntent){candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(next),intent:topologyIntent}));pendingSource=false;}else pendingSource=true;
   }catch(error){const e=error as Error;throw new ApiError(e instanceof ApiError||e instanceof ElementCommandError||e instanceof MirrorApiError?e.code:e instanceof MirrorEditingError?`MIRROR_${e.code}`:'CONSTRAINT_VIOLATION',e.message,index,e instanceof RelatedSelection?e.ids:undefined);}
  }
  if(pendingSource)candidateProject=accept(prepareSnapshotEdit(snapshotEditContext(candidateProject,true),{kind:'original-geometry',drawing:markFinalizedGeometry(next)}));
  const changed=domainChanged||JSON.stringify(before)!==JSON.stringify(next),snapshotPlan=composePreparedSnapshotEdits(beforeProject,steps);
  return {before:domainIntents.length||snapshotContextChanged?currentDrawingPresentation(beforeProject):before,next:domainIntents.length||snapshotContextChanged?currentDrawingPresentation(candidateProject):next,changed,dryRun:r.dryRun===true,approximations,created,topologyIntents,domainIntents,snapshotContextChanged,snapshotPlan};
 }
 function inspectQuery(raw:unknown){
  const q=record(raw);keys(q,['layerIds','layerNames','curveIds','curveNames','strokeNames','nameIncludes','includeRecording']);bool(q.includeRecording,'includeRecording');
  for(const k of ['layerIds','layerNames','curveIds','curveNames','strokeNames'])if(q[k]!==undefined)ids(q[k],k,true);
  if(q.nameIncludes!==undefined)string(q.nameIncludes,'nameIncludes');
  const d=source(),allStrokes=d.layers.flatMap(l=>strokes(d,l.id).map(s=>({...s,name:strokeName(d,s),layerId:l.id,derived:true as const}))),byCurve=new Map(allStrokes.flatMap(s=>strokeIds(s).map(id=>[id,s] as const)));
  for(const id of (q.curveIds??[]) as string[])curveExists(d,id);
  for(const id of (q.layerIds??[]) as string[])if(!d.layers.some(l=>l.id===id))fail('NOT_FOUND',`Unknown layer ID: ${id}.`);
  const match=(key:string,value:string)=>q[key]===undefined||(q[key] as string[]).includes(value);
  const selected=d.curves.filter(c=>{const layer=layerFor(d,c.id)!,s=byCurve.get(c.id)!;return match('curveIds',c.id)&&match('curveNames',c.name)&&match('layerIds',layer.id)&&match('layerNames',layer.name)&&match('strokeNames',s.name)&&(q.nameIncludes===undefined||[c.name,c.strokeName??'',layer.name].some(n=>n.toLocaleLowerCase().includes((q.nameIncludes as string).toLocaleLowerCase())));});
  const selectedIds=new Set(selected.map(c=>c.id)),nodeIds=new Set(selected.flatMap(c=>c.nodes));
  const chosenStrokes=allStrokes.filter(s=>s.segments.some(x=>selectedIds.has(x.id)));
  const noCurveFilter=!['curveIds','curveNames','strokeNames'].some(k=>q[k]!==undefined);
  const ownerMatches=(id:string,name:string)=>{const l=layerFor(d,id)!;return noCurveFilter&&match('layerIds',l.id)&&match('layerNames',l.name)&&(q.nameIncludes===undefined||[name,l.name].some(n=>n.toLocaleLowerCase().includes((q.nameIncludes as string).toLocaleLowerCase())));};
  const inspectedFills=d.fills.filter(f=>ownerMatches(f.id,f.name)||f.boundary.some(u=>selectedIds.has(u.id)));
  const inspectedOffsets=d.offsets.filter(o=>ownerMatches(o.id,o.name)||o.source.some(u=>selectedIds.has(u.id)));
  const ownerLayers=new Set([...inspectedFills,...inspectedOffsets].map(o=>layerFor(d,o.id)!.id));
  const reference=d.reference?(({dataUrl,...r})=>({...r,pixelsIncluded:false}))(d.reference):null;
  return clone({
   apiVersion:VECTOR_AI_VERSION,mode:host.getMode(),sourceEditable:host.getMode()==='drawing',
   sourceId:host.getState().project.drawingSnapshots?.activeId??'$working',mirrorAxisX:d.mirrorAxisX??0,mirrorEditing:d.mirrorEditing??null,mirrorEditingState:validateMirrorEditing(d),coordinateSystem:{unit:'source',x:'right',y:'up',handles:'absolute',bounds:'exact cubic centerline; excludes width, mist, offsets and extensions'},
   layers:d.layers.filter(l=>ownerLayers.has(l.id)||l.items.some(id=>selectedIds.has(id))||(!['curveIds','curveNames','strokeNames','nameIncludes'].some(k=>q[k]!==undefined)&&match('layerIds',l.id)&&match('layerNames',l.name))).map(l=>({...l,effectiveState:objectState(d,l.items)})),
   strokes:chosenStrokes,curves:selected.map(c=>({...c,layerId:layerFor(d,c.id)!.id,strokeId:byCurve.get(c.id)!.id,shape:shapeOf(d,c.id),controls:shapeOf(d,c.id).map((position,index)=>({targetKind:index===0||index===3?'node':'handle',role:['P0','H0','H1','P1'][index],curveId:c.id,...(index===0||index===3?{nodeId:c.nodes[index===0?0:1]}:{end:index===1?0:1}),position})),bounds:cubicBounds(shapeOf(d,c.id))})),
   nodes:d.nodes.filter(n=>nodeIds.has(n.id)).map(n=>({...n,endpoints:members(d,n.id),linkedNodeIds:[...linkedNodeIds(d,n.id)]})),
   fills:inspectedFills.map(f=>({...f,layerId:layerFor(d,f.id)!.id,selectionRelation:ownerMatches(f.id,f.name)?'owned':'dependent'})),offsets:inspectedOffsets.map(o=>({...o,layerId:layerFor(d,o.id)!.id,selectionRelation:ownerMatches(o.id,o.name)?'owned':'dependent'})),groups:(d.groups??[]).filter(g=>g.curveIds.some(id=>selectedIds.has(id))),
   joins:d.joins.filter(j=>selectedIds.has(j.a.curveId)||selectedIds.has(j.b.curveId)),
   endpointLinks:(d.endpointLinks??[]).filter(l=>selectedIds.has(l.a.curveId)||selectedIds.has(l.b.curveId)),
   displayIntervals:(d.displayIntervals??[]).filter(t=>chosenStrokes.some(s=>s.segments.some(x=>x.id===t.anchor.id))),
   displayIntervalLocations:(d.displayIntervals??[]).filter(t=>chosenStrokes.some(s=>s.segments.some(x=>x.id===t.anchor.id))).map(t=>intervalLocations(d,t)),
   bounds:combineBounds(selected.map(c=>cubicBounds(shapeOf(d,c.id)))),reference,
   displayIntervalCoordinates:{unit:'normalized arc length, not Bezier t',scope:'CURVE means anchor-curve arc length; otherwise derived stroke arc length',direction:'anchor.reverse defines orientation; closed strokes may wrap start > end'},
   selection:host.getSelection?.()??null,activeCreationLayerId:host.getActiveLayerId?.()??null,viewport:host.getViewport?.()??null,
   recording:q.includeRecording===false?null:(host.getState().project as LandmarkProject&{vectorRecording?:unknown}).vectorRecording??null,recordingIncluded:q.includeRecording!==false,
   diagnostics:diagnostics(d),
  });
 }
 function history(direction:'undo'|'redo',raw:unknown){
  const r=record(raw);keys(r,['expectedRevision']);expected(r.expectedRevision);
  const state=host.getState(),target=direction==='undo'?state.past.at(-1):state.future[0];
  if(!target)return {changed:false,mode:host.getMode()};
  host[direction]();const next=host.getState();return {changed:next.project!==state.project||next.past.length!==state.past.length||next.future.length!==state.future.length,mode:host.getMode()};
 }
 function previewCamera(d:DrawingDocument,o:Record<string,unknown>){
   const width=num(o.width??800,'width',1,4096),height=num(o.height??800,'height',1,4096),b=drawingBounds(d);
   const padding=Math.max(.1,...d.curves.map(c=>c.width*2+(c.mist?.enabled?c.mist.width:0)),...d.offsets.map(c=>Math.abs(c.distance)+c.width));
   const viewport:VectorViewport={width,height,center:o.center===undefined?(b?.center??[0,0]):point(o.center,'center'),pixelsPerUnit:num(o.pixelsPerUnit??Math.min(width/((b?b.max[0]-b.min[0]:2.8)+2*padding),height/((b?b.max[1]-b.min[1]:2.8)+2*padding)),'pixelsPerUnit',1e-6,1e6)};
   return {width,height,b,viewport};
 }
 function renderPreview(d:DrawingDocument,o:Record<string,unknown>,paintBatches?:PaintBatch[]){
   const {width,height,b,viewport}=previewCamera(d,o);
   if(o.showFills!==false&&d.fills.some(f=>f.visible&&f.mist?.enabled)&&(typeof document==='undefined'||typeof Path2D==='undefined'))fail('BROWSER_REQUIRED','Mist-fill SVG export uses the existing Canvas renderer. Run preview in the local app browser, or use showFills:false for an explicit ink-only preview.');
   let annotations:AIGuideOptions|undefined;
   if(o.annotations!==undefined){
    const a=record(o.annotations);keys(a,['curveIds','grid','labels','handles','diagnostics']);for(const flag of ['grid','labels','handles','diagnostics'])bool(a[flag],`annotations.${flag}`);
    const curveIds=a.curveIds===undefined?[]:ids(a.curveIds,'annotations.curveIds',true);
    if(curveIds.length>MAX_AI_GUIDE_CURVES)fail('INVALID_REQUEST',`Annotate at most ${MAX_AI_GUIDE_CURVES} selected curves; narrow the query first.`);
    curveIds.forEach(id=>curveExists(d,id));annotations={...a,curveIds} as AIGuideOptions;
   }
   const noop=()=>{},svg=renderToStaticMarkup(createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width,height,viewBox:`0 0 ${width} ${height}`},createElement(PaintScene,{d,screen:(p:Point2)=>sourceToCanvas(p,viewport),unit:viewport.pixelsPerUnit,pixelsPerUnit:viewport.pixelsPerUnit,preview:true,showFills:o.showFills!==false,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop,...(paintBatches?{paintBatches}:{})}),annotations?createElement(AIGuideOverlay,{...annotations,d,curveIds:annotations.curveIds??[],screen:(p:Point2)=>sourceToCanvas(p,viewport),unit:viewport.pixelsPerUnit,width,height}):null));
   return {mediaType:'image/svg+xml',svg,viewport,bounds:b,showFills:o.showFills!==false,annotated:!!annotations,diagnostics:diagnostics(d),sourceRevision:revision()};
 }
 function renderRecording(project:LandmarkProject,o:Record<string,unknown>){
   const evaluated=evaluateRecording(project,{...(o.angle===undefined?{}:{angle:o.angle as {x:number;y:number}}),...(o.useDraft===undefined?{}:{useDraft:o.useDraft as boolean})});
   return {...renderPreview(evaluated.drawing,o),artworkId:evaluated.artworkId,rigId:evaluated.rigId,angle:evaluated.angle,usedDraft:evaluated.usedDraft,hasUnappliedDraft:evaluated.hasUnappliedDraft,sourceReadOnly:true,fitDiagnostics:evaluated.diagnostics,diagnosticStage:evaluated.diagnosticStage,maxError:evaluated.maxError,maxErrorPixels:evaluated.maxError*250,warningCurveIds:evaluated.warningCurveIds,conflictingNodeIds:evaluated.conflictingNodeIds,intervalTransportErrors:evaluated.intervalTransportErrors,routeDiagnostics:evaluated.routeDiagnostics};
 }
 function renderScene(project:LandmarkProject,o:Record<string,unknown>){
   if(o.angle!==undefined){const a=record(o.angle);keys(a,['x','y']);num(a.x,'angle.x',-90,90);num(a.y,'angle.y',-90,90);}
   const evaluated=evaluateRecordingScene(project,{...(o.sceneId===undefined?{}:{sceneId:string(o.sceneId,'sceneId')}),...(o.angle===undefined?{}:{angle:o.angle as {x:number;y:number}}),...(o.useDraft===undefined?{}:{useDraft:o.useDraft as boolean}),...(o.stopAtWarpId===undefined?{}:{stopAtWarpId:string(o.stopAtWarpId,'stopAtWarpId')})});
   return {...renderPreview(evaluated.drawing,o,evaluated.paintBatches),sceneId:evaluated.sceneId,angle:evaluated.angle,usedDraft:evaluated.usedDraft,hasUnappliedDraft:evaluated.hasUnappliedDraft,sourceReadOnly:true,sceneDiagnostics:evaluated.diagnostics,fitDiagnostics:evaluated.fitDiagnostics,diagnosticStage:evaluated.diagnosticStage,maxError:evaluated.maxError,maxErrorPixels:evaluated.maxError*250,maxErrorIsBound:evaluated.fitDiagnostics.some(d=>'placementErrorBound' in d&&d.placementErrorBound===true),warningCurveIds:evaluated.warningCurveIds,conflictingNodeIds:evaluated.conflictingNodeIds,intervalTransportErrors:evaluated.intervalTransportErrors,provenance:evaluated.provenance,layerMap:evaluated.layerMap,objectMap:evaluated.objectMap};
 }
 function renderSnapshot(project:LandmarkProject,o:Record<string,unknown>){
   const evaluated=evaluateRecordingSnapshot(project,{...(o.recordingId===undefined?{}:{recordingId:string(o.recordingId,'recordingId',16384)}),...(o.snapshotId===undefined?{}:{snapshotId:string(o.snapshotId,'snapshotId',16384)}),...(o.angle===undefined?{}:{angle:o.angle as {x:number;y:number}}),...(o.useDraft===undefined?{}:{useDraft:o.useDraft as boolean}),...(o.stopAtWarpId===undefined?{}:{stopAtWarpId:string(o.stopAtWarpId,'stopAtWarpId',16384)})});
   return {...renderPreview(evaluated.drawing,o,evaluated.paintBatches),recordingId:evaluated.recordingId,snapshotId:evaluated.snapshotId,angle:evaluated.angle,usedDraft:evaluated.usedDraft,hasUnappliedDraft:evaluated.hasUnappliedDraft,sourceReadOnly:true,snapshotDiagnostics:evaluated.diagnostics,fitDiagnostics:evaluated.fitDiagnostics,diagnosticStage:evaluated.diagnosticStage,maxError:evaluated.maxError,maxErrorPixels:evaluated.maxError*250,warningCurveIds:evaluated.warningCurveIds,conflictingNodeIds:evaluated.conflictingNodeIds,intervalTransportErrors:evaluated.intervalTransportErrors,provenance:evaluated.provenance,layerProvenance:evaluated.layerProvenance};
 }
 return Object.freeze({
  version:VECTOR_AI_VERSION,
  inspectSnapshots:(query:SnapshotQuery={})=>run(()=>{const q=record(query);expected(q.expectedRevision);const overview=snapshotOverview(host.getState().project,q);return {mode:host.getMode(),snapshotEditable:host.getMode()==='recording'&&!overview.readOnly,...overview};}),
  snapshot:(request:SnapshotBatch)=>run(()=>{
   const r=record(request);expected(r.expectedRevision);if(host.getMode()!=='recording')fail('MODE_RESTRICTED','Snapshot commands require Recording mode.');const plan=prepareSnapshotBatch(host.getState().project,r);
   if(plan.changed&&!plan.dryRun){if(host.commitRecordingSnapshotEditPlan)host.commitRecordingSnapshotEditPlan(plan.preparedPlan);else{if(!host.commitRecordingSnapshots)fail('UNAVAILABLE','This host does not expose snapshot transactions.');host.commitRecordingSnapshots!(plan.recordingSnapshots);}}
   return {recordingId:plan.recordingId,snapshotId:plan.snapshotId,angle:plan.angle,applied:plan.changed&&!plan.dryRun,changed:plan.changed,dryRun:plan.dryRun,created:plan.created,removedIds:plan.removedIds,idMaps:plan.idMaps,sourceReadOnly:true};
  }),
  previewSnapshot:(options:Omit<PreviewOptions,'commands'>&{recordingId?:string;snapshotId?:string;angle?:{x:number;y:number};useDraft?:boolean;stopAtWarpId?:string;commands?:SnapshotCommand[]}={})=>run(()=>{
   const o={...record(options)};keys(o,['recordingId','snapshotId','commands','expectedRevision','angle','useDraft','stopAtWarpId','width','height','center','pixelsPerUnit','showFills','annotations']);expected(o.expectedRevision);bool(o.showFills,'showFills');bool(o.useDraft,'useDraft');let project=host.getState().project;
   if(o.commands!==undefined){const plan=prepareSnapshotBatch(project,{commands:o.commands,recordingId:o.recordingId,dryRun:true});project=plan.preparedPlan.project;if(o.recordingId===undefined)o.recordingId=plan.recordingId;}
   return renderSnapshot(project,o);
  }),
  previewSnapshotFrames:(options:RecordingFramesOptions&{recordingId?:string}={})=>run(()=>{
   const o=record(options);keys(o,['recordingId','angles','expectedRevision','width','height','center','pixelsPerUnit','showFills']);expected(o.expectedRevision);bool(o.showFills,'showFills');const raw=o.angles??[0,15,30,45,60,75,90].map(x=>({x,y:0}));if(!Array.isArray(raw)||!raw.length||raw.length>31)fail('INVALID_REQUEST','angles must contain 1–31 positions.');const angles=(raw as unknown[]).map(v=>{const a=record(v);keys(a,['x','y']);return {x:num(a.x,'angle.x',-90,90),y:num(a.y,'angle.y',-90,90)};}),project=host.getState().project,base=evaluateRecordingSnapshot(project,{...(o.recordingId===undefined?{}:{recordingId:string(o.recordingId,'recordingId',16384)}),useDraft:false}),camera=previewCamera(base.source,o).viewport;
   const frames=angles.map((angle,index)=>({index,filename:`frame-${String(index).padStart(3,'0')}.svg`,...renderSnapshot(project,{...o,width:camera.width,height:camera.height,center:camera.center,pixelsPerUnit:camera.pixelsPerUnit,angle,useDraft:false})}));return {frames,recordingId:base.recordingId,viewport:camera,sourceRevision:revision(),savedKeyformsOnly:true,allFramesIdentical:frames.every(f=>f.svg===frames[0].svg),hasUnappliedDraft:frames.some(f=>f.hasUnappliedDraft),sourceReadOnly:true,maxErrorPixels:Math.max(...frames.map(f=>f.maxErrorPixels)),warningFrameIndices:frames.filter(f=>f.snapshotDiagnostics.length||f.warningCurveIds.length||f.intervalTransportErrors.length||f.diagnostics.length).map(f=>f.index)};
  }),
  inspectScene:(query:SceneQuery={})=>run(()=>{legacySceneAvailable();const q=record(query);expected(q.expectedRevision);return {mode:host.getMode(),sceneEditable:host.getMode()==='recording',...sceneOverview(host.getState().project,q)};}),
  scene:(request:SceneBatch)=>run(()=>{
   legacySceneAvailable();const r=record(request);expected(r.expectedRevision);if(host.getMode()!=='recording')fail('MODE_RESTRICTED','Scene commands require Recording mode; source artwork stays read-only.');const plan=prepareSceneBatch(host.getState().project,r);
   if(plan.changed&&!plan.dryRun){if(!host.commitRecordingScenes)fail('UNAVAILABLE','This host does not expose scene transactions.');host.commitRecordingScenes!(plan.recordingScenes);}
   return {sceneId:plan.sceneId,applied:plan.changed&&!plan.dryRun,changed:plan.changed,dryRun:plan.dryRun,created:plan.created,removedIds:plan.removedIds,pinResults:plan.pinResults,sourceReadOnly:true};
  }),
  previewScene:(options:Omit<PreviewOptions,'commands'>&{sceneId?:string;angle?:{x:number;y:number};useDraft?:boolean;stopAtWarpId?:string;commands?:SceneCommand[]}={})=>run(()=>{
   legacySceneAvailable();const o={...record(options)};keys(o,['sceneId','commands','expectedRevision','angle','useDraft','stopAtWarpId','width','height','center','pixelsPerUnit','showFills','annotations']);expected(o.expectedRevision);bool(o.showFills,'showFills');bool(o.useDraft,'useDraft');let project=host.getState().project;
   if(o.commands!==undefined){legacySceneAvailable();const plan=prepareSceneBatch(project,{commands:o.commands,sceneId:o.sceneId,dryRun:true});project={...project,recordingScenes:plan.recordingScenes};if(o.sceneId===undefined)o.sceneId=plan.sceneId;}
   return renderScene(project,o);
  }),
  previewSceneFrames:(options:RecordingFramesOptions&{sceneId?:string}={})=>run(()=>{
   legacySceneAvailable();const o=record(options);keys(o,['sceneId','angles','expectedRevision','width','height','center','pixelsPerUnit','showFills']);expected(o.expectedRevision);bool(o.showFills,'showFills');const raw=o.angles??[0,15,30,45,60,75,90].map(x=>({x,y:0}));if(!Array.isArray(raw)||!raw.length||raw.length>31)fail('INVALID_REQUEST','angles must contain 1–31 positions.');const angles=(raw as unknown[]).map(v=>{const a=record(v);keys(a,['x','y']);return {x:num(a.x,'angle.x',-90,90),y:num(a.y,'angle.y',-90,90)};}),project=host.getState().project,base=evaluateRecordingScene(project,{...(o.sceneId===undefined?{}:{sceneId:string(o.sceneId,'sceneId')}),useDraft:false}),camera=previewCamera(base.source,o).viewport;
   const frames=angles.map((angle,index)=>({index,filename:`frame-${String(index).padStart(3,'0')}.svg`,...renderScene(project,{...o,width:camera.width,height:camera.height,center:camera.center,pixelsPerUnit:camera.pixelsPerUnit,angle,useDraft:false})}));return {frames,sceneId:base.sceneId,viewport:camera,sourceRevision:revision(),savedKeyformsOnly:true,allFramesIdentical:frames.every(f=>f.svg===frames[0].svg),hasUnappliedDraft:frames.some(f=>f.hasUnappliedDraft),sourceReadOnly:true,maxErrorPixels:Math.max(...frames.map(f=>f.maxErrorPixels)),warningFrameIndices:frames.filter(f=>f.sceneDiagnostics.length||f.warningCurveIds.length||f.intervalTransportErrors.length||f.diagnostics.length).map(f=>f.index)};
  }),
  help:()=>({version:VECTOR_AI_VERSION,localOnly:true,sourceWrites:'Drawing mode only; never switches mode',methods:['inspectSnapshots','snapshot','previewSnapshot','previewSnapshotFrames','inspect','execute','preview','select','exportSource','inspectArtworks','artwork','undo','redo','convertPoint','inspectView','view','snapView'],viewCommands:['setReference','addGuide','changeGuide','deleteGuides','setGuideOptions','resetView'],commands:[...commandNames],snapshotSchema:{projectField:'recordingSnapshots',version:2},snapshotCommands:[...snapshotCommandNames],sceneSchema:undefined,sceneCommands:[],legacyRecordingMethods:[],recordingCommands:[],artworkOperations:['save','restore','rename','delete'],limits:VECTOR_AI_LIMITS,coordinateSpaces:['source','canvas','client','reference'],notes:['Use inspect() revision as expectedRevision.','Original commands keep source coordinates. createCurve in a referenced layer and explicit Snapshot-local link, route and interval commands use the current Drawing Snapshot presentation; local IDs stay canonical.','exportSource exports owned original geometry; Snapshot-local members and relations remain in project JSON.','Batches are sequential; shared nodes, links, smooth joins and locks use existing drawing commands.','Creation may name a ref; use $ref in later ID fields in the same batch. Copy maps additionally support $ref/originalID. Dry-run IDs are provisional, not reserved.','Only triangulated Recording is active. Use createTriangulatedRecording; retired data is inspectable through inspectSnapshots.',recordingRetiredReason,'Dry runs, previews and failed validation create no history entries.','Stroke IDs are derived anchors; curve/node/layer IDs are canonical.','SVG is clean by default; annotations explicitly enable transient selection-scoped AI guides. Reference images are excluded.']}),
  inspect:(query:VectorQuery={})=>run(()=>inspectQuery(query)),
  inspectView:(request:Record<string,never>={})=>runView(()=>{const r=record(request);keys(r,[]);if(!host.getView)fail('UNAVAILABLE','This host does not expose transient workspace view.');return {view:clone(host.getView!()),transient:true,sourceReadOnly:true};}),
  snapView:(request:{point:Point2;unitsPerPixel:number;thresholdPx?:number;excludeCurveIds?:string[];targetSpace?:'source'})=>runView(()=>{
   const r=record(request);keys(r,['point','unitsPerPixel','thresholdPx','excludeCurveIds','targetSpace']);if(r.targetSpace!==undefined&&r.targetSpace!=='source')fail('INVALID_REQUEST','snapView currently supports targetSpace: source only, not posed or child-local coordinates.');if(!host.getView)fail('UNAVAILABLE','This host does not expose transient workspace view.');const d=source(),p=point(r.point,'point'),scale=num(r.unitsPerPixel,'unitsPerPixel',1e-9,1e6),threshold=r.thresholdPx===undefined?8:num(r.thresholdPx,'thresholdPx',0,1000),excluded=r.excludeCurveIds===undefined?[]:ids(r.excludeCurveIds,'excludeCurveIds',true);excluded.forEach(id=>curveExists(d,id));
   return {targetSpace:'source' as const,candidate:clone(snapWorkspacePoint(d,host.getState().project.drawingSnapshots,host.getView!(),p,scale,threshold,excluded)),transient:true,sourceReadOnly:true};
  }),
  view:(request:{commands:WorkspaceViewCommand[];dryRun?:boolean})=>runView(()=>{
   const r=record(request);keys(r,['commands','dryRun']);bool(r.dryRun,'dryRun');if(!Array.isArray(r.commands)||r.commands.length>200)fail('INVALID_REQUEST','View commands must be an array of at most 200 commands.');if(!host.getView||!host.replaceView)fail('UNAVAILABLE','This host does not expose transient workspace view.');
   const before=host.getView!();let next=clone(before);for(const [index,c] of (r.commands as WorkspaceViewCommand[]).entries())try{next=prepareWorkspaceView(next,[c],host.getState().project.drawingSnapshots);}catch(error){throw new ApiError('VIEW_INVALID',(error as Error).message,index);}
   const changed=JSON.stringify(before)!==JSON.stringify(next),dryRun=r.dryRun===true;if(changed&&!dryRun)host.replaceView!(next);
   return {view:clone(next),changed,dryRun,applied:changed&&!dryRun,transient:true,sourceReadOnly:true,createdGuideIds:next.guides.filter(g=>!before.guides.some(b=>b.id===g.id)).map(g=>g.id),removedGuideIds:before.guides.filter(g=>!next.guides.some(n=>n.id===g.id)).map(g=>g.id)};
  }),
  inspectRecording:(query:RecordingQuery={})=>run(()=>{legacyRecordingAvailable();const q=record(query);expected(q.expectedRevision);return {mode:host.getMode(),recordingEditable:host.getMode()==='recording',...recordingOverview(host.getState().project,q)};}),
  recording:(request:RecordingBatch)=>run(()=>{
   legacyRecordingAvailable();const r=record(request);expected(r.expectedRevision);if(host.getMode()!=='recording')fail('MODE_RESTRICTED','Recording commands require Recording mode and never mutate source artwork.');
   const plan=prepareRecordingBatch(host.getState().project,r);if(plan.changed&&!plan.dryRun){if(!host.commitRecording)fail('UNAVAILABLE','This host does not support Recording transactions.');host.commitRecording!(plan.next);}
   const rig=plan.next.rigs.find(x=>x.artworkId===plan.sourceId);return {applied:plan.changed&&!plan.dryRun,changed:plan.changed,dryRun:plan.dryRun,sourceId:plan.sourceId,created:plan.created,pinResults:plan.pinResults,rigId:rig?.id??null,angle:rig?.angle??null,hasDraft:!!rig?.draft,sourceReadOnly:true};
  }),
  previewRecording:(options:RecordingPreviewOptions={})=>run(()=>{
   legacyRecordingAvailable();const o=record(options);keys(o,['commands','expectedRevision','angle','useDraft','width','height','center','pixelsPerUnit','showFills','annotations']);expected(o.expectedRevision);bool(o.showFills,'showFills');bool(o.useDraft,'useDraft');
   let project=host.getState().project;if(o.commands!==undefined){const plan=prepareRecordingBatch(project,{commands:o.commands,dryRun:true});project={...project,vectorRecording:plan.next};}
   return renderRecording(project,o);
  }),
  previewRecordingFrames:(options:RecordingFramesOptions={})=>run(()=>{
   legacyRecordingAvailable();const o=record(options);keys(o,['angles','expectedRevision','width','height','center','pixelsPerUnit','showFills']);expected(o.expectedRevision);bool(o.showFills,'showFills');const rawAngles=o.angles??[0,15,30,45,60,75,90].map(x=>({x,y:0}));if(!Array.isArray(rawAngles)||!rawAngles.length||rawAngles.length>31)fail('INVALID_REQUEST','angles must contain 1–31 parameter positions.');
   const angles=(rawAngles as unknown[]).map(raw=>{const a=record(raw);keys(a,['x','y']);return {x:num(a.x,'angle.x',-90,90),y:num(a.y,'angle.y',-90,90)};}),project=host.getState().project,camera=previewCamera(source(),o).viewport;
   const frames=angles.map((angle,index)=>({index,filename:`frame-${String(index).padStart(3,'0')}.svg`,...renderRecording(project,{...o,width:camera.width,height:camera.height,center:camera.center,pixelsPerUnit:camera.pixelsPerUnit,angle,useDraft:false})}));
   return {frames,allFramesIdentical:frames.every(f=>f.svg===frames[0].svg),viewport:camera,artworkId:frames[0].artworkId,rigId:frames[0].rigId,savedKeyformsOnly:true,hasUnappliedDraft:frames.some(f=>f.hasUnappliedDraft),sourceReadOnly:true,sourceRevision:revision(),maxErrorPixels:Math.max(...frames.map(f=>f.maxErrorPixels)),warningFrameIndices:frames.filter(f=>f.warningCurveIds.length||f.intervalTransportErrors.length||f.routeDiagnostics.length||f.diagnostics.length).map(f=>f.index)};
  }),
  inspectArtworks:(request:{expectedRevision?:string}={})=>run(()=>{const r=record(request);keys(r,['expectedRevision']);expected(r.expectedRevision);return clone(artworkOverview(host.getState().project));}),
  artwork:(request:ArtworkRequest)=>run(()=>{
   const r=record(request);expected(r.expectedRevision);if(host.getMode()!=='drawing')fail('MODE_RESTRICTED','Artwork writes require Drawing mode.');
   const plan=prepareArtworkAction(host.getState().project,r);if(plan.state.drawing)validateBounds(plan.state.drawing);
   if(plan.changed&&!plan.dryRun){if(!host.commitArtwork)fail('UNAVAILABLE','This host does not support artwork transactions.');host.commitArtwork!(plan.state);}
   return {...plan.result,changed:plan.changed,dryRun:plan.dryRun,applied:plan.changed&&!plan.dryRun};
  }),
  execute:(request:VectorBatch)=>run(()=>{
   const {before,next,changed,dryRun,approximations,created,topologyIntents,domainIntents,snapshotContextChanged,snapshotPlan}=prepare(request),changes=changedIds(before,next);
   const beforeAfter=changes.curveIds.filter(id=>before.curves.some(c=>c.id===id)).map(id=>({curveId:id,layerId:layerFor(next,id)!.id,before:{name:before.curves.find(c=>c.id===id)!.name,shape:clone(shapeOf(before,id)),width:before.curves.find(c=>c.id===id)!.width},after:{name:next.curves.find(c=>c.id===id)!.name,shape:clone(shapeOf(next,id)),width:next.curves.find(c=>c.id===id)!.width}}));
   const addedCurves=next.curves.filter(c=>!before.curves.some(x=>x.id===c.id)).map(c=>({curveId:c.id,layerId:layerFor(next,c.id)!.id,name:c.name,shape:clone(shapeOf(next,c.id))}));
   const result={applied:changed&&!dryRun,dryRun,changed,...changes,created,addedCurves,approximations,...(topologyIntents.length?{topologyIntents}:{}),...(domainIntents.length?{domainIntents}:{}),beforeBounds:drawingBounds(before),afterBounds:drawingBounds(next),beforeAfter,diagnostics:diagnostics(next)};
   if(changed&&!dryRun){
    if(host.commitSnapshotEditPlan)host.commitSnapshotEditPlan(snapshotPlan);
    else if(topologyIntents.length&&snapshotPlan.before.recordingSnapshots)fail('UNAVAILABLE','This host must implement commitSnapshotEditPlan to atomically preserve Snapshot topology, poses and responses.');
    else if(snapshotContextChanged)fail('UNAVAILABLE','This host must implement commitSnapshotEditPlan to preserve Snapshot-local members and relations atomically.');
    else if(domainIntents.length&&snapshotPlan.project.recordingSnapshots)fail('UNAVAILABLE','This host must implement commitSnapshotEditPlan to atomically preserve source and referenced layer domains.');
    else host.commitDrawing(markFinalizedGeometry(next));
   }
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
   return renderPreview(d,o);
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
