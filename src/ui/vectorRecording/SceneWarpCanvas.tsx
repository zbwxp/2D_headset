import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {editable,groupFor,objectById,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {selectionUnit,selectedGroup} from '../../domain/drawing/groups';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';
import {applyScenePlacement,inverseScenePlacement} from '../../domain/recordingScene/tracks';
import SceneInstanceTransformBox,{beginInstanceTransform,instanceTransformDelta,type RecordingInstanceTransform,type InstanceTransformGesture,type InstanceTransformBounds,type InstanceTransformKind} from './SceneInstanceTransformBox';
import SceneCurveEditOverlay,{beginRecordingCurveGesture,recordingCurveGestureEdit,recordingCurveControl,type RecordingCurveEdit,type RecordingCurveEditor,type RecordingCurveGesture} from './SceneCurveEditOverlay';
export type {RecordingCurveEdit} from './SceneCurveEditOverlay';
import {drawingBounds} from '../../domain/vectorRecording/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {moveWarpNode,type WarpGrid} from '../../domain/vectorWarp/model';
import {useEditor} from '../../app/store';
import {getWorkspaceView} from '../../app/workspaceView';
import {snapWorkspacePoint} from '../../app/workspaceViewSnap';
import {useDrawing,type DrawingSelection} from '../drawing/session';
import {TOOLS} from '../drawing/tools';
import PaintScene from '../drawing/PaintScene';
import AIGuideOverlay from '../drawing/AIGuideOverlay';
import {curvePath} from '../drawing/geometry';
import ArtworkReference from '../workspaceView/ArtworkReference';
import ViewGuidesOverlay from '../workspaceView/ViewGuidesOverlay';
import {clampReferenceOffset} from '../../domain/recording/reference';

type Tool='select'|'direct'|'hand'|'zoom';
type ViewReference=NonNullable<DrawingDocument['reference']>;
export type RecordingCanvasReference={reference:ViewReference|undefined;moving:boolean;setMoving:(moving:boolean)=>void;change:(reference:ViewReference|undefined)=>void;preview:(reference:ViewReference|null)=>void;current:()=>ViewReference|undefined};
type Gesture={kind:'curve'|'instance'|'nodes'|'handle'|'box'|'pan'|'zoom'|'reference';curve?:RecordingCurveGesture;instance?:InstanceTransformGesture;instanceBounds?:InstanceTransformBounds;placement?:ScenePlacementValue;reference?:ViewReference;pointerId:number;start:Point2;client:Point2;grid?:WarpGrid;indices:number[];index?:number;handle?:'handleU'|'handleV';pan?:Point2;zoom?:number;zoomMoved?:boolean};
type Warning={sourceCurveId?:string;cubic:[Point2,Point2,Point2,Point2];warning?:boolean};
/** Keep compiled IDs intact: the scene, not the canvas, resolves provenance. */
export function recordingCurveSelection(drawing:DrawingDocument,current:DrawingSelection,id:string,tool:'select'|'direct',shift=false):DrawingSelection|null{
 if(!editable(drawing,id))return null;const selected=current.ids.filter(id=>editable(drawing,id));let ids=(tool==='select'?selectionUnit(drawing,id):[id]).filter(id=>editable(drawing,id));
 if(shift)ids=ids.every(id=>selected.includes(id))?selected.filter(id=>!ids.includes(id)):[...new Set([...selected,...ids])];
 return {ids,group:tool==='select'?selectedGroup(drawing,ids)?.id:undefined};
}
/** The world point beneath the pointer is stable for wheel, click and drag zoom. */
export function recordingZoomAt(point:Point2,anchor:Point2,view:{center:Point2;size:{width:number;height:number};unit:number;zoom:number},value:number):{zoom:number;pan:Point2}{
 const zoom=Math.max(.1,Math.min(12,value)),unit=view.unit*zoom/view.zoom;return {zoom,pan:[point[0]-view.size.width/2-(anchor[0]-view.center[0])*unit,point[1]-view.size.height/2+(anchor[1]-view.center[1])*unit]};
}
export function recordingWarpNudgeDelta(event:Pick<KeyboardEvent,'key'|'shiftKey'|'altKey'|'ctrlKey'|'metaKey'>,unit:number):Point2|null{
 if(event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return null;
 const step=(event.shiftKey?10:event.altKey?0.1:1)/unit;return [event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0];
}
/** The scene owns data and transactions; this component owns only a cancellable
 * pointer preview. Geometry is committed once on release through the scene API. */
export default function SceneWarpCanvas({source,drawing,grid,targetKey,label,paintBatches,warnings=[],onPreview,onCommit,zh,localToggle,aiGuide,selection,onSelection,onWarpSelection,editEnabled=true,revealGridKey,reference,underlay,warpPicker,instanceTransform,gridPlacement,ghostGridPlacements=[],curveEdit}:{
 source:DrawingDocument;drawing:DrawingDocument;paintBatches?:PaintBatch[];grid?:WarpGrid;targetKey:string;label:string;warnings?:Warning[];
 onPreview:(grid:WarpGrid|null)=>void;onCommit:(grid:WarpGrid)=>void;zh:boolean;aiGuide?:{curveIds:string[];labels:Record<string,string>};localToggle?:{local:boolean;change:()=>void};
 reference?:RecordingCanvasReference;underlay?:(screen:(point:Point2)=>Point2,unit:number)=>ReactNode;warpPicker?:{value:string;items:{id:string;name:string}[];onChange:(id:string)=>void};
 instanceTransform?:RecordingInstanceTransform;gridPlacement?:ScenePlacementValue;ghostGridPlacements?:{instanceId:string;name:string;value:ScenePlacementValue}[];
 curveEdit?:RecordingCurveEditor;
 selection?:DrawingSelection;onSelection?:(selection:DrawingSelection)=>void;onWarpSelection?:()=>void;editEnabled?:boolean;revealGridKey?:number;
}){
 const txt=(cn:string,en:string)=>zh?cn:en,showFills=useDrawing(s=>s.showFills),fillVisibility=useDrawing(s=>s.fillVisibility);
 const [ownSelection,setOwnSelection]=useState<DrawingSelection>({ids:[]}),[tool,setTool]=useState<Tool>('select'),[nodeSelection,setNodeSelection]=useState<number[]>([]),[selectionMode,setSelectionMode]=useState<'node'|'row'|'column'>('node'),[showGrid,setShowGrid]=useState(true),[showHandles,setShowHandles]=useState(false),[size,setSize]=useState({width:800,height:650}),[pan,setPan]=useState<Point2>([0,0]),[zoom,setZoom]=useState(1),[box,setBox]=useState<{a:Point2;b:Point2}|null>(null),[snap,setSnap]=useState<Point2|null>(null);
 const [instancePreview,setInstancePreview]=useState<ScenePlacementValue|null>(null),instanceSelect=tool==='select'&&!!instanceTransform;
 const [curveControl,setCurveControl]=useState<RecordingCurveEdit|null>(null),curveDirect=tool==='direct'&&!grid&&!!curveEdit;
 const placement=gridPlacement??identityScenePlacement(),inversePlacement=inverseScenePlacement(placement);
 const drawingSelection=selection??ownSelection,selectedCurves=useMemo(()=>drawingSelection.ids.filter(id=>editable(drawing,id)),[drawing,drawingSelection]);
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<Gesture|null>(null),space=useRef(false),pending=useRef<WarpGrid|null>(null),nudge=useRef<WarpGrid|null>(null),keys=useRef(new Set<string>()),pendingInstance=useRef<ScenePlacementValue|null>(null),nudgeInstance=useRef<ScenePlacementValue|null>(null),nudgeInstanceBounds=useRef<InstanceTransformBounds|null>(null);
 const pendingCurve=useRef<RecordingCurveEdit|null>(null),nudgeCurve=useRef<{edit:RecordingCurveEdit;editor:RecordingCurveEditor}|null>(null);
 const instanceKey=instanceTransform?.ids.join('\0')??'';
 const curveKey=curveEdit&&!grid?selectedCurves.join('\0'):'';
 const fitBounds=()=>{const a=drawingBounds(source),b=drawingBounds(drawing),points=[a.min,a.max,b.min,b.max,...(grid?.nodes.flatMap(n=>[n.position,n.handleU,n.handleV].map(p=>applyScenePlacement(placement,p)))??[])];return {min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))] as Point2,max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as Point2};};
 const [bounds,setBounds]=useState(fitBounds);
 useEffect(()=>{setBounds(fitBounds());},[source.curves.length]);
 const center:Point2=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2],unit=Math.max(1,Math.min((size.width-100)/(bounds.max[0]-bounds.min[0]),(size.height-100)/(bounds.max[1]-bounds.min[1])))*zoom;
 const screen=useCallback((p:Point2):Point2=>[size.width/2+(p[0]-center[0])*unit+pan[0],size.height/2-(p[1]-center[1])*unit+pan[1]],[size.width,size.height,center[0],center[1],unit,pan[0],pan[1]]),world=(p:Point2):Point2=>[(p[0]-size.width/2-pan[0])/unit+center[0],-(p[1]-size.height/2-pan[1])/unit+center[1]];
 const gridScreen=(p:Point2)=>screen(applyScenePlacement(placement,p));
 const gridWorld=(p:Point2,value=placement)=>applyScenePlacement(inverseScenePlacement(value),world(p));
 const edgePath=(from:number,to:number,handle:'handleU'|'handleV',reverse=false,project=gridScreen)=>{const a=grid!.nodes[from],b=grid!.nodes[to],mirror=(p:Point2,h:Point2):Point2=>[2*p[0]-h[0],2*p[1]-h[1]];return `M ${project(a.position)} C ${project(reverse?mirror(a.position,a[handle]):a[handle])} ${project(reverse?b[handle]:mirror(b.position,b[handle]))} ${project(b.position)}`;};
 const edges=grid?grid.nodes.flatMap((_,i)=>[...(i%(grid.columns+1)<grid.columns?[{from:i,to:i+1,handle:'handleU' as const}]:[]),...(i+grid.columns+1<grid.nodes.length?[{from:i,to:i+grid.columns+1,handle:'handleV' as const}]:[])]):[];
 const outline=grid?[...Array.from({length:grid.columns},(_,i)=>edgePath(i,i+1,'handleU')),...Array.from({length:grid.rows},(_,i)=>edgePath(i*(grid.columns+1)+grid.columns,(i+1)*(grid.columns+1)+grid.columns,'handleV')),...Array.from({length:grid.columns},(_,i)=>{const a=grid.rows*(grid.columns+1)+grid.columns-i;return edgePath(a,a-1,'handleU',true);}),...Array.from({length:grid.rows},(_,i)=>{const a=(grid.rows-i)*(grid.columns+1);return edgePath(a,a-grid.columns-1,'handleV',true);})].map((p,i)=>i?p.slice(p.indexOf(' C ')):p).join(' ')+' Z':'';
 const at=(e:{clientX:number;clientY:number}):Point2=>{const r=svg.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
 function release(pointerId:number){if(svg.current?.hasPointerCapture(pointerId))svg.current.releasePointerCapture(pointerId);}
 function cancel(){const d=drag.current;drag.current=null;if(d){release(d.pointerId);if(d.kind==='zoom'){setZoom(d.zoom!);setPan(d.pan!);}else if(d.kind==='pan')setPan(d.pan!);else if(d.kind==='reference')reference?.preview(null);else if(d.kind==='curve')d.curve?.editor.onPreview(null);}nudgeCurve.current?.editor.onPreview(null);pendingCurve.current=null;nudgeCurve.current=null;pending.current=null;nudge.current=null;if(pendingInstance.current||nudgeInstance.current||d?.kind==='instance')instanceTransform?.onPreview(null);pendingInstance.current=null;nudgeInstance.current=null;nudgeInstanceBounds.current=null;setInstancePreview(null);keys.current.clear();setBox(null);setSnap(null);onPreview(null);}
 function choose(next:DrawingSelection){setOwnSelection(next);onSelection?.(next);}
 function chooseTool(next:Tool){cancel();reference?.setMoving(false);setTool(next);if(next==='select'&&grid&&!instanceTransform)selectAllNodes();else if(next==='direct'&&tool!=='direct')setNodeSelection([]);}
 function selectAllNodes(){if(!grid)return;if(instanceTransform)setTool('direct');reference?.setMoving(false);setShowGrid(true);setSelectionMode('node');setNodeSelection(grid.nodes.map((_,i)=>i));onWarpSelection?.();svg.current?.focus({preventScroll:true});}
 function selectGridMode(mode:'node'|'row'|'column'){
  cancel();reference?.setMoving(false);setTool('direct');setShowGrid(true);setSelectionMode(mode);if(grid&&nodeSelection.length&&mode!=='node'){const position=(i:number)=>mode==='row'?Math.floor(i/(grid.columns+1)):i%(grid.columns+1),groups=new Set(nodeSelection.map(position));setNodeSelection(grid.nodes.map((_,i)=>i).filter(i=>groups.has(position(i))));setSelectionMode('node');onWarpSelection?.();}svg.current?.focus({preventScroll:true});
 }
 function zoomAt(p:Point2,value:number,anchor=world(p)){const next=recordingZoomAt(p,anchor,{center,size,unit,zoom},value);setZoom(next.zoom);setPan(next.pan);}
 useEffect(()=>{setNodeSelection([]);setCurveControl(null);cancel();},[targetKey]);
 useEffect(()=>{if(!editEnabled&&!instanceTransform?.editable)cancel();},[editEnabled,instanceTransform?.editable]);
 useEffect(()=>{if(instanceKey){cancel();setTool('select');svg.current?.focus({preventScroll:true});}else if(drag.current?.kind==='instance'||nudgeInstance.current)cancel();},[instanceKey]);
 useEffect(()=>{if(reference?.moving)cancel();},[reference?.moving]);
 useEffect(()=>{setShowGrid(true);if(instanceTransform){cancel();setTool('select');svg.current?.focus({preventScroll:true});}},[revealGridKey]);
 useEffect(()=>{cancel();setCurveControl(null);if(curveKey){setTool('direct');reference?.setMoving(false);svg.current?.focus({preventScroll:true});}},[curveKey,revealGridKey]);
 useEffect(()=>{if(!curveEdit?.editable&&(drag.current?.kind==='curve'||nudgeCurve.current))cancel();},[curveEdit?.editable]);
 useEffect(()=>()=>{if(drag.current?.kind==='curve')drag.current.curve?.editor.onPreview(null);nudgeCurve.current?.editor.onPreview(null);drag.current=null;pendingCurve.current=null;nudgeCurve.current=null;},[]);
 useEffect(()=>{const h=host.current;if(!h)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({width:r.width,height:r.height});});observer.observe(h);return()=>observer.disconnect();},[]);
 useEffect(()=>{const fn=()=>{space.current=false;cancel();};window.addEventListener('contour:cancel-recording-gesture',fn);window.addEventListener('blur',fn);return()=>{window.removeEventListener('contour:cancel-recording-gesture',fn);window.removeEventListener('blur',fn);};},[onPreview,instanceTransform?.onPreview,curveEdit?.onPreview]);
 function curveDown(e:React.PointerEvent,id:string){
  if(reference?.moving||space.current||e.button!==0||tool==='hand'||tool==='zoom'||grid||instanceSelect)return;e.stopPropagation();e.preventDefault();svg.current?.focus({preventScroll:true});const next=recordingCurveSelection(drawing,drawingSelection,id,tool,e.shiftKey);if(!next)return;
  choose(next);setNodeSelection([]);
 }
 function paintDown(e:React.PointerEvent,id:string){
  if(reference?.moving||space.current||e.button!==0||tool==='hand'||tool==='zoom'||grid||instanceSelect)return;e.stopPropagation();e.preventDefault();svg.current?.focus({preventScroll:true});const item=objectById(drawing,id);if(!item?.visible||item.locked)return;
  const group=tool==='select'?groupFor(drawing,id):undefined;if(group){const first=group.curveIds.find(id=>editable(drawing,id));if(first){curveDown(e,first);return;}}
  const current=[...new Set([...(drawingSelection.paintIds??[]),...(drawingSelection.paint?[drawingSelection.paint]:[])])].filter(id=>{const o=objectById(drawing,id);return o?.visible&&!o.locked;}),paintIds=e.shiftKey?(current.includes(id)?current.filter(x=>x!==id):[...current,id]):[id];
  choose({ids:e.shiftKey?selectedCurves:[],paintIds,paint:paintIds.length===1?paintIds[0]:undefined});setNodeSelection([]);
 }
 function arcDown(e:React.PointerEvent,id:string){const join=drawing.joins.find(j=>j.id===id);if(join)curveDown(e,join.a.curveId);}
 function begin(e:React.PointerEvent,index:number,handle?:'handleU'|'handleV',edge?:number[]){
  if(reference?.moving||instanceSelect||!grid||drag.current||space.current||tool==='hand'||tool==='zoom'||e.button!==0)return;e.stopPropagation();e.preventDefault();svg.current!.focus({preventScroll:true});
  if(tool==='select')handle=undefined;let indices=tool==='select'?grid.nodes.map((_,i)=>i):edge??[index];if(tool==='direct'&&!handle&&!edge&&selectionMode==='row'){const row=Math.floor(index/(grid.columns+1));indices=grid.nodes.map((_,i)=>i).filter(i=>Math.floor(i/(grid.columns+1))===row);}else if(tool==='direct'&&!handle&&!edge&&selectionMode==='column'){const column=index%(grid.columns+1);indices=grid.nodes.map((_,i)=>i).filter(i=>i%(grid.columns+1)===column);}
  const deselect=!handle&&e.shiftKey&&indices.every(i=>nodeSelection.includes(i));if(!handle&&e.shiftKey)indices=deselect?nodeSelection.filter(i=>!indices.includes(i)):[...new Set([...nodeSelection,...indices])];else if(tool==='direct'&&!handle&&indices.every(i=>nodeSelection.includes(i))&&selectionMode==='node')indices=nodeSelection;
  setShowGrid(true);setSelectionMode('node');setNodeSelection(indices);onWarpSelection?.();if(!editEnabled||deselect)return;svg.current!.setPointerCapture(e.pointerId);drag.current={kind:handle?'handle':'nodes',pointerId:e.pointerId,start:gridWorld(at(e)),client:at(e),placement,grid,indices,handle,index};
 }
 function beginInstance(e:React.PointerEvent,kind:InstanceTransformKind,origin:Point2){
  if(!instanceTransform||!instanceSelect||reference?.moving||space.current||drag.current||e.button!==0)return;e.stopPropagation();e.preventDefault();svg.current!.focus({preventScroll:true});if(!instanceTransform.editable)return;
  const point=world(at(e));svg.current!.setPointerCapture(e.pointerId);drag.current={kind:'instance',instance:beginInstanceTransform(kind,point,origin),instanceBounds:instanceTransform.bounds,pointerId:e.pointerId,start:point,client:at(e),indices:[]};
 }
 function beginCurve(e:React.PointerEvent,edit:RecordingCurveEdit){
  if(!curveDirect||!curveEdit||reference?.moving||space.current||drag.current||e.button!==0)return;e.stopPropagation();e.preventDefault();svg.current!.focus({preventScroll:true});setCurveControl(edit);if(!curveEdit.editable)return;
  const point=world(at(e));svg.current!.setPointerCapture(e.pointerId);drag.current={kind:'curve',curve:beginRecordingCurveGesture(edit,point,curveEdit),pointerId:e.pointerId,start:point,client:at(e),indices:[]};
 }
 function move(e:React.PointerEvent){
  const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;const p=at(e);if(d.kind==='curve'){if(!curveDirect||!curveEdit?.editable||!d.curve){cancel();return;}let next=recordingCurveGestureEdit(d.curve,world(p));const hit=!e.altKey?snapWorkspacePoint(drawing,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),next.position,1/unit):null;if(hit)next={...next,position:hit.point};setSnap(hit?.point??null);pendingCurve.current=next;d.curve.editor.onPreview(next);return;}if(d.kind==='instance'){if(!instanceTransform?.editable||!d.instance)return;let q=world(p);const hit=d.instance.kind==='move'&&!e.altKey?snapWorkspacePoint(drawing,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),[d.instance.origin[0]+q[0]-d.start[0],d.instance.origin[1]+q[1]-d.start[1]],1/unit):null;if(hit){q=[d.start[0]+hit.point[0]-d.instance.origin[0],d.start[1]+hit.point[1]-d.instance.origin[1]];}setSnap(hit?.point??null);const delta=instanceTransformDelta(d.instance,q,e.shiftKey);pendingInstance.current=delta;setInstancePreview(delta);instanceTransform.onPreview(delta);return;}if(d.kind==='pan'){setPan([d.pan![0]+p[0]-d.client[0],d.pan![1]+p[1]-d.client[1]]);return;}if(d.kind==='zoom'){const dy=d.client[1]-p[1];if(!d.zoomMoved&&Math.abs(dy)<2)return;d.zoomMoved=true;zoomAt(d.client,d.zoom!*Math.exp(dy*.008),d.start);return;}if(d.kind==='box'){setBox({a:d.client,b:p});return;}if(d.kind==='reference'){if(!d.reference||reference?.current()!==d.reference){cancel();return;}const q=world(p);reference.preview({...d.reference,offset:[clampReferenceOffset(d.reference.offset[0]+q[0]-d.start[0]),clampReferenceOffset(d.reference.offset[1]+q[1]-d.start[1])]});return;}if(!d.grid||!editEnabled)return;
  const base=d.grid,q=gridWorld(p,d.placement);let delta:Point2=[q[0]-d.start[0],q[1]-d.start[1]];
  const anchor=d.index===undefined?null:d.kind==='handle'?base.nodes[d.index][d.handle!]:base.nodes[d.index].position,hit=anchor&&!e.altKey?snapWorkspacePoint(drawing,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),applyScenePlacement(d.placement??placement,[anchor[0]+delta[0],anchor[1]+delta[1]]),1/unit):null;
  if(hit&&anchor){const localHit=applyScenePlacement(inverseScenePlacement(d.placement??placement),hit.point);delta=[localHit[0]-anchor[0],localHit[1]-anchor[1]];}setSnap(hit?.point??null);let next=base;
  if(d.kind==='handle')next={...base,nodes:base.nodes.map((n,i)=>i===d.index?{...n,[d.handle!]:[n[d.handle!][0]+delta[0],n[d.handle!][1]+delta[1]]}:n)};
  else for(const i of d.indices)next=moveWarpNode(next,i,[base.nodes[i].position[0]+delta[0],base.nodes[i].position[1]+delta[1]]);
  pending.current=next;onPreview(next);
 }
 function finish(e:React.PointerEvent){
  const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;release(e.pointerId);
  if(d.kind==='curve'){const next=pendingCurve.current;pendingCurve.current=null;setSnap(null);d.curve?.editor.onPreview(null);if(next&&curveDirect&&curveEdit?.editable)d.curve?.editor.onCommit(next);return;}
  if(d.kind==='instance'){const next=pendingInstance.current;pendingInstance.current=null;setInstancePreview(null);setSnap(null);instanceTransform?.onPreview(null);if(next&&instanceTransform?.editable)instanceTransform.onCommit(next);return;}
  if(d.kind==='reference'){const q=world(at(e));reference?.preview(null);if(d.reference&&reference?.current()===d.reference)reference.change({...d.reference,offset:[clampReferenceOffset(d.reference.offset[0]+q[0]-d.start[0]),clampReferenceOffset(d.reference.offset[1]+q[1]-d.start[1])]});return;}
  if(d.kind==='zoom'&&!d.zoomMoved)zoomAt(d.client,d.zoom!*((e.ctrlKey||e.altKey)?1/1.3:1.3),d.start);
  if(d.kind==='box'){const p=at(e),lo=[Math.min(d.client[0],p[0]),Math.min(d.client[1],p[1])],hi=[Math.max(d.client[0],p[0]),Math.max(d.client[1],p[1])],inside=(p:Point2)=>p[0]>=lo[0]&&p[0]<=hi[0]&&p[1]>=lo[1]&&p[1]<=hi[1];
   if(instanceSelect){/* Snapshot selection belongs to the layer title. */}
   else if(grid){let ids=grid.nodes.map((n,i)=>({i,p:gridScreen(n.position)})).filter(({p})=>inside(p)).map(x=>x.i);if(tool==='select'&&ids.length)ids=grid.nodes.map((_,i)=>i);setNodeSelection(e.shiftKey?[...new Set([...nodeSelection,...ids])]:ids);setSelectionMode('node');if(ids.length){setShowGrid(true);onWarpSelection?.();}}
   else{const hits=drawing.curves.filter(c=>editable(drawing,c.id)&&shapeOf(drawing,c.id).every(p=>inside(screen(p)))).flatMap(c=>tool==='select'?selectionUnit(drawing,c.id):[c.id]),ids=[...new Set([...(e.shiftKey?selectedCurves:[]),...hits])].filter(id=>editable(drawing,id));choose({ids,group:tool==='select'?selectedGroup(drawing,ids)?.id:undefined});}
  }
  const next=pending.current;pending.current=null;setBox(null);setSnap(null);onPreview(null);if(next&&editEnabled)onCommit(next);
 }
 function down(e:React.PointerEvent){
  if(drag.current||![0,1,2].includes(e.button))return;svg.current!.focus({preventScroll:true});e.preventDefault();svg.current!.setPointerCapture(e.pointerId);const p=at(e),base={pointerId:e.pointerId,start:world(p),client:p,indices:[]};
  if(reference?.moving&&reference.reference?.visible&&!reference.reference.locked&&!space.current&&e.button===0){drag.current={...base,kind:'reference',reference:reference.current()};return;}
  if(tool==='zoom'&&!space.current&&(e.button===0||e.button===2&&e.ctrlKey))drag.current={...base,kind:'zoom',zoom,pan};
  else if(space.current||e.button===1||e.button===2||tool==='hand')drag.current={...base,kind:'pan',pan};
  else{drag.current={...base,kind:'box'};setCurveControl(null);setBox({a:p,b:p});if(!e.shiftKey&&!instanceSelect){if(grid)setNodeSelection([]);else choose({ids:[]});}}
 }
 useEffect(()=>{
  function down(e:KeyboardEvent){const target=e.target instanceof Element?e.target:null;if(e.defaultPrevented||e.isComposing||target?.closest('input,select,textarea,dialog,[role=dialog],[role=menu],[role=menuitem],[contenteditable],[data-ui-keyboard]'))return;
   if(target?.closest('button,a,summary,[role=button],[role=slider]')&&(e.code==='Space'||e.key==='Enter'||e.key.startsWith('Arrow')))return;
   if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){cancel();return;}
   if(e.key==='Escape'){e.preventDefault();cancel();reference?.setMoving(false);return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();if(target?.closest('.drawing-layers'))choose({ids:drawing.curves.map(c=>c.id),paintIds:[...drawing.fills,...drawing.offsets].map(o=>o.id)});else if(grid&&!instanceSelect)selectAllNodes();else choose({ids:drawing.curves.filter(c=>editable(drawing,c.id)).map(c=>c.id)});return;}
   const delta=recordingWarpNudgeDelta(e,unit);if(delta&&curveDirect&&curveEdit?.editable&&curveControl&&!reference?.moving&&!drag.current){const base=nudgeCurve.current?.edit??recordingCurveControl(drawing,curveControl);if(!base)return;e.preventDefault();keys.current.add(e.key);const next={...base,position:[base.position[0]+delta[0],base.position[1]+delta[1]] as Point2};nudgeCurve.current={edit:next,editor:nudgeCurve.current?.editor??curveEdit};nudgeCurve.current.editor.onPreview(next);return;}if(delta&&instanceSelect&&!reference?.moving&&instanceTransform?.editable&&!drag.current){e.preventDefault();keys.current.add(e.key);if(!nudgeInstance.current)nudgeInstanceBounds.current=instanceTransform.bounds;const base=nudgeInstance.current??identityScenePlacement(),next={...base,translation:[base.translation[0]+delta[0],base.translation[1]+delta[1]] as Point2};nudgeInstance.current=next;setInstancePreview(next);instanceTransform.onPreview(next);return;}if(delta&&!instanceSelect&&!reference?.moving&&editEnabled&&grid&&nodeSelection.length&&!drag.current){e.preventDefault();keys.current.add(e.key);const base=nudge.current??grid,zero=applyScenePlacement(inversePlacement,[0,0]),point=applyScenePlacement(inversePlacement,delta),localDelta:Point2=[point[0]-zero[0],point[1]-zero[1]];let next=base;for(const i of nodeSelection)next=moveWarpNode(next,i,[base.nodes[i].position[0]+localDelta[0],base.nodes[i].position[1]+localDelta[1]]);nudge.current=next;onPreview(next);return;}
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.code==='Space'){e.preventDefault();space.current=true;return;}
   const toolMap:Record<string,Tool>={v:'select',a:'direct',h:'hand',z:'zoom'};if(toolMap[e.key.toLowerCase()]){e.preventDefault();chooseTool(toolMap[e.key.toLowerCase()]);return;}
  }
  function up(e:KeyboardEvent){if(e.code==='Space')space.current=false;const released=keys.current.delete(e.key);if(released&&!keys.current.size&&nudgeCurve.current){const next=nudgeCurve.current;nudgeCurve.current=null;next.editor.onPreview(null);if(curveDirect&&curveEdit?.editable)next.editor.onCommit(next.edit);}if(released&&!keys.current.size&&nudgeInstance.current){const next=nudgeInstance.current;nudgeInstance.current=null;nudgeInstanceBounds.current=null;setInstancePreview(null);instanceTransform?.onPreview(null);if(instanceTransform?.editable)instanceTransform.onCommit(next);}if(released&&!keys.current.size&&nudge.current){const next=nudge.current;nudge.current=null;onPreview(null);if(editEnabled)onCommit(next);}}
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};
 },[grid,nodeSelection,unit,onPreview,onCommit,editEnabled,tool,showGrid,drawing,drawingSelection,zoom,pan,reference?.moving,instanceTransform,gridPlacement,curveDirect,curveEdit,curveControl]);
 const image=reference?.reference,imageMax=image?Math.max(image.width,image.height):1,imageSize=image?[image.width/imageMax*2.6*unit*image.scale,image.height/imageMax*2.6*unit*image.scale]:[0,0];
 return <section className="vr-center">
  <header className="vr-canvas-toolbar">{warpPicker&&<label className="vr-active-warp">Warp<select aria-label="Active Warp" value={warpPicker.value} onChange={e=>{cancel();warpPicker.onChange(e.target.value);}}><option value="">{txt('点快照标题变换；或选层建立 Warp','Select a snapshot title to transform, or layers for Warp')}</option>{warpPicker.items.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}<nav className="vr-segmented" aria-label={txt('录制画布工具','Recording canvas tools')}>{TOOLS.map(([value,cn,key,,Icon])=>{if(value!=='select'&&value!=='direct'&&value!=='hand'&&value!=='zoom')return null;const name=txt(value==='select'?(instanceTransform?'快照实例变换':'选择整个 Warp'):value==='direct'?(curveEdit&&!grid?'曲线端点与控制柄':'Warp 网格局部'):cn,value==='select'?(instanceTransform?'Transform snapshot':'Select Warp'):value==='direct'?(curveEdit&&!grid?'Curve endpoints and handles':'Warp grid selection'):value==='hand'?'Hand':'Zoom');return <button key={value} data-testid={`vr-tool-${value}`} aria-label={name} title={`${name} (${key})`} aria-pressed={tool===value} className={tool===value?'active':''} onClick={()=>chooseTool(value)}><Icon size={16}/><kbd>{key}</kbd></button>;})}</nav>{localToggle&&<button aria-pressed={localToggle.local} onClick={()=>{cancel();localToggle.change();}}>{localToggle.local?txt('子 Warp 局部编辑 · 父变形暂不显示','Child local edit · parent excluded'):txt('全局预览','Global preview')}</button>}<div className="vr-segmented">{(['node','row','column'] as const).map(mode=><button key={mode} aria-pressed={selectionMode===mode} onClick={()=>selectGridMode(mode)}>{mode==='node'?txt('节点','Nodes'):mode==='row'?txt('整行','Row'):txt('整列','Column')}</button>)}</div><button disabled={!grid} onClick={selectAllNodes}>{txt('全选网格','All nodes')}</button><button aria-pressed={showGrid} onClick={()=>{cancel();setShowGrid(!showGrid);}}>{txt('网格','Grid')}</button><button data-testid="vr-show-fills" aria-pressed={showFills} onClick={()=>useDrawing.getState().set({showFills:!showFills,fillVisibility:{}})}>{txt('填充','Fills')}</button><button aria-pressed={showHandles} onClick={()=>setShowHandles(!showHandles)}>{txt('Warp Bézier 柄','Warp Bézier handles')}</button><span>{nodeSelection.length} {txt('节点','nodes')}</span><button onClick={()=>{cancel();setBounds(fitBounds());setZoom(1);setPan([0,0]);}}>{txt('适应','Fit')}</button></header>
  <div ref={host} className={`vr-canvas-host drawing-canvas-wrap tool-${tool}${reference?.moving?' reference-moving':''}`}><svg ref={svg} width={size.width} height={size.height} data-testid="vr-scene-canvas" data-tool={tool} data-edit-enabled={editEnabled} aria-label={txt('录制场景 Warp 画布','Recording scene Warp canvas')} tabIndex={0} onContextMenu={e=>e.preventDefault()} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current)cancel();}} onPointerDown={down} onWheel={e=>{if(!drag.current)zoomAt(at(e),zoom*Math.exp(-e.deltaY*.001));}}>
   <rect width="100%" height="100%" fill="#f6f7f5"/>{image?.visible&&<image data-testid="recording-image-reference" href={image.dataUrl} width={imageSize[0]} height={imageSize[1]} x={-imageSize[0]/2} y={-imageSize[1]/2} opacity={image.opacity} transform={`translate(${screen(image.offset)}) rotate(${image.rotation})`} pointerEvents="none"/>}<ArtworkReference screen={screen} unit={unit}/>
   {underlay?.(screen,unit)}
   <PaintScene paintBatches={paintBatches} d={drawing} screen={screen} unit={unit} pixelsPerUnit={unit} preview={false} showFills={showFills} fillVisibility={fillVisibility} referenceMoving={reference?.moving??false} tool={tool} selectedPaint={drawingSelection.paint} selectedPaints={drawingSelection.paintIds} curveDown={curveDown} paintDown={paintDown} arcDown={arcDown}/>
   <g pointerEvents="none">{selectedCurves.map(id=><path key={id} data-testid="vr-selected-curve" data-id={id} d={curvePath(shapeOf(drawing,id),screen)} fill="none" stroke="#2589b0" strokeWidth="1.5"/>)}</g>
   <g pointerEvents="none">{warnings.filter(d=>d.warning).map((d,i)=><path key={d.sourceCurveId??i} data-testid="vr-fit-warning" d={curvePath(d.cubic,screen)} fill="none" stroke="#db3948" strokeWidth="2.5"/>)}</g>
   {grid&&<path data-testid="vr-warp-hit" d={outline} fill="transparent" stroke={showGrid&&nodeSelection.length===grid.nodes.length?'#2589b0':'none'} strokeWidth="2" pointerEvents={tool==='select'&&!instanceSelect?'all':'none'} onPointerDown={e=>begin(e,0)}/>}
   {showGrid&&grid&&ghostGridPlacements.map(ghost=><g key={ghost.instanceId} data-testid="vr-grid-ghost" data-instance={ghost.instanceId} pointerEvents="none" fill="none" stroke="#79989b" strokeWidth="1" opacity=".4"><title>{ghost.name}</title>{edges.map(({from,to,handle})=><path key={`${from}:${to}`} d={edgePath(from,to,handle,false,p=>screen(applyScenePlacement(ghost.value,p)))}/>)}</g>)}
   {showGrid&&grid&&<g className="vr-grid" data-testid="vr-grid">
    {Array.from({length:grid.rows+1},(_,row)=>{const points=Array.from({length:grid.columns+1},(_,col)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=gridScreen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${gridScreen(before.handleU)} ${gridScreen([2*n.position[0]-n.handleU[0],2*n.position[1]-n.handleU[1]])} ${p}`;}});return <path key={`r${row}`} d={path}/>;})}
    {Array.from({length:grid.columns+1},(_,col)=>{const points=Array.from({length:grid.rows+1},(_,row)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=gridScreen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${gridScreen(before.handleV)} ${gridScreen([2*n.position[0]-n.handleV[0],2*n.position[1]-n.handleV[1]])} ${p}`;}});return <path key={`c${col}`} d={path}/>;})}
    {tool==='direct'&&edges.map(({from,to,handle})=><path key={`${from}:${to}`} data-testid="vr-edge-hit" data-from={from} data-to={to} d={edgePath(from,to,handle)} style={{fill:'none',stroke:'transparent',strokeWidth:13,pointerEvents:'stroke'}} onPointerDown={e=>begin(e,from,undefined,[from,to])}/>)}
    {grid.nodes.map((n,i)=>{const p=gridScreen(n.position),selected=nodeSelection.includes(i);return <g key={i}>{showHandles&&tool==='direct'&&selected&&(['handleU','handleV'] as const).map(h=>{const a=gridScreen(n[h]);return <g key={h}><line x1={p[0]} y1={p[1]} x2={a[0]} y2={a[1]}/><circle className="vr-handle" data-node={i} data-handle={h} cx={a[0]} cy={a[1]} r="4" onPointerDown={e=>begin(e,i,h)}/></g>})}<circle data-testid="vr-node" data-index={i} data-selected={selected} className={selected?'selected':''} cx={p[0]} cy={p[1]} r={selected?5:4} onPointerDown={e=>begin(e,i)}/></g>;})}
   </g>}
   {curveDirect&&!reference?.moving&&<SceneCurveEditOverlay drawing={drawing} curveIds={selectedCurves} screen={screen} selected={curveControl} editable={curveEdit!.editable} onBegin={beginCurve} zh={zh}/>}
   {instanceSelect&&instanceTransform&&!reference?.moving&&<SceneInstanceTransformBox bounds={drag.current?.instanceBounds??nudgeInstanceBounds.current??instanceTransform.bounds} delta={instancePreview??undefined} screen={screen} editable={instanceTransform.editable} label={instanceTransform.label} onBegin={beginInstance}/>}
   {aiGuide&&<AIGuideOverlay d={drawing} curveIds={aiGuide.curveIds} curveLabels={aiGuide.labels} screen={screen} unit={unit} width={size.width} height={size.height}/>}
   {box&&<rect x={Math.min(box.a[0],box.b[0])} y={Math.min(box.a[1],box.b[1])} width={Math.abs(box.b[0]-box.a[0])} height={Math.abs(box.b[1]-box.a[1])} fill="#31a1e021" stroke="#338bc4" strokeDasharray="4 2" pointerEvents="none"/>}
   {snap&&<circle cx={screen(snap)[0]} cy={screen(snap)[1]} r="8" fill="none" stroke="#148b96" strokeWidth="2" pointerEvents="none"/>}{reference?.moving&&<rect data-testid="recording-reference-move-surface" width={size.width} height={size.height} fill="transparent" style={{cursor:'move'}}/>}<ViewGuidesOverlay screen={screen} unit={unit} width={size.width} height={size.height}/>
  </svg><div className="vr-canvas-badge">{label}</div>{reference?.moving&&<button className="drawing-reference-done" onClick={()=>{cancel();reference.setMoving(false);}}>{txt('完成图片平移','Finish moving reference')}</button>}</div>
  <footer className="vr-status"><span>{txt('源画稿只读','Source read-only')} · {source.curves.length} {txt('源段','source segments')}</span><span>{curveDirect?txt('A 曲线端点/柄 · 方向键微调 · Z 缩放 · 空格平移','A curve endpoints/handles · Arrows nudge · Z zoom · Space pan'):instanceSelect?txt('V 快照平移 · 角点等比缩放 · 顶柄旋转 · Shift 15° · A Warp 网格','V snapshot move · Corners scale · Top handle rotates · Shift 15° · A Warp grid'):grid?txt('V 整体 Warp · A 节点/边/柄 · Shift 复选 · Z 缩放 · 空格平移','V whole Warp · A nodes/edges/handles · Shift select · Z zoom · Space pan'):txt('点快照标题可平移/旋转/缩放；或选层建立 Warp','Select a snapshot title to move, rotate or scale; or select layers to create a Warp')}</span><span>{Math.round(zoom*100)}%</span></footer>
 </section>;
}
