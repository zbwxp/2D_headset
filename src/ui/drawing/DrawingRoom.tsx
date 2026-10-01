import AIGuideOverlay from './AIGuideOverlay';
import {useDrawingWorkspace} from './workspace';
import AutoHideBar from '../shared/AutoHideBar';
import {usePanelOpen} from '../shared/panelPreferences';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {PenTool,PanelRightClose,PanelRightOpen,ImagePlus,Eye,Check,X} from 'lucide-react';
import {emptyDrawing,parseDrawing,groupFor,uid,add,sub,mul,length,curveById,shapeOf,nodeAt,members,joinAt,editable,visible,layerFor,objectById,type DrawingDocument as Doc,type Cubic,type Point2,type Endpoint} from '../../domain/drawing/model';
import * as cmd from '../../domain/drawing/commands';
import {dragNode} from '../../domain/drawing/nodeDrag';
import {deformDrawing,rectQuad,quadProjection,type Quad,type DeformRect} from '../../domain/drawing/deform';
import {cutDrawing,pasteDrawingCut,type DrawingCut} from '../../domain/drawing/clipboard';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import {pathOf} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {selectionUnit,selectedGroup,transformable,createGroup,ungroup,groupingIssue} from '../../domain/drawing/groups';
import {snapRecordingEndpoint} from '../../domain/recording/snapping';
import {readPhoto} from '../edit2d/ReferenceControls';
import {RECORDING_REFERENCE_IMAGE,clampReferenceOffset} from '../../domain/recording/reference';
import {uiText as t,useLanguage} from '../i18n';
import {selectedObjects,selectedLayers,type DrawingTool,type DrawingSelection} from './session';
import {hasNudgeTarget,nudgeSelection} from './nudge';
import LayerPanel from './LayerPanel';
import LayerSnapshotDialog from './LayerSnapshotDialog';
import Properties from './Properties';
import ToolBar from './ToolBar';
import SnapshotBar from './SnapshotBar';
import {usePenPreferences} from './penPreferences';
import {useDirectPreferences} from './directPreferences';
import {TOOLS,isEndpointTool} from './tools';
import {linkedNodeIds,linksAtNode} from '../../domain/drawing/endpointLinks';
import PaintScene from './PaintScene';
import InkEndOverlay from './InkEndOverlay';
import DisplayIntervalOverlay from './DisplayIntervalOverlay';
import {displayPath,displayField,nearestDisplayPosition,changeDisplayInterval,removeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {NumberField} from './Field';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
import {curvePath,selectionBounds,snapMirrorAxis} from './geometry';
import './drawing.css';
const EMPTY=emptyDrawing();

interface Pen {position:Point2;out:Point2;last?:string;first?:Endpoint}
interface DeformCage {base:Doc;committed:Doc;ids:string[];rect:DeformRect;quad:Quad;maxError:number}
interface Drag extends TrackedPointer {followStrength?:number;cage?:DeformCage;corner?:number;kind:'deform'|'displayInterval'|'node'|'handle'|'move'|'scale'|'rotate'|'box'|'pan'|'pen'|'ellipse'|'reference'|'mirrorAxis'|'zoom';start:Point2;client:Point2;last:{clientX:number;clientY:number};base:Doc;next?:Doc;displayInterval?:NonNullable<DrawingSelection['displayInterval']>;node?:string;endpoint?:Endpoint;ids?:string[];origin?:Point2;pan?:Point2;cursor?:Point2;pen?:Pen|null;shift?:boolean;zoom?:number;zoomMoved?:boolean}
export interface DrawingUnderlay {width:number;height:number;unit:number;pan:Point2}
/** Replace only the canvas artwork; keep the reference, viewport and editor UI mounted. */
export interface DrawingArtworkPreview {render:(view:DrawingUnderlay)=>ReactNode;hint:string;edit:()=>void}
export default function DrawingRoom({underlay,artworkPreview,aiGuides=false}:{underlay?:(view:DrawingUnderlay)=>ReactNode;artworkPreview?:DrawingArtworkPreview;aiGuides?:boolean}={}){
 const {editor:useEditor,session:useDrawing,commitDrawing,id:workspaceId}=useDrawingWorkspace();
 useLanguage(s=>s.language);
 const rawStored=useEditor(s=>s.project.drawing)??EMPTY,stored=useMemo(()=>rawStored.version===3?rawStored:parseDrawing(rawStored),[rawStored]),projectId=useEditor(s=>s.project.meta.createdAt),session=useDrawing();
 const {tool,selection,layerId,zoom,pan,preview,sidebar,width,penJoin,showFills,fillVisibility}=session;
 const panelHeight=session.panelHeight,setPanelHeight=(value:number)=>session.set({panelHeight:value});
 const [draft,setDraft]=useState<Doc|null>(null),[hint,setHint]=useState(''),[first,setFirst]=useState<Endpoint|null>(null),[pen,setPen]=useState<Pen|null>(null),[penPreview,setPenPreview]=useState<Cubic|null>(null);
 const [pending,setPending]=useState<{ids:string[];scope:string[];mirror?:{source:string;target:string;base:Doc}}|null>(null),[referenceMoving,setReferenceMoving]=useState(false),[box,setBox]=useState<{a:Point2;b:Point2}|null>(null);
 const [zoomOut,setZoomOut]=useState(false),[axisSnap,setAxisSnap]=useState<Point2|null>(null),[nodeSnap,setNodeSnap]=useState<Point2|null>(null);
 const [deformCage,setDeformCage]=useState<DeformCage|null>(null);
 const [propertiesOpen,setPropertiesOpen]=usePanelOpen(workspaceId+'.properties',false);
 const [restoreLayerId,setRestoreLayerId]=useState<string|null>(null);
 const [clipboard,setClipboard]=useState<DrawingCut|null>(null);
 const [busy,setBusy]=useState(false),[size,setSize]=useState({width:900,height:700});
 const penHistory=useRef(new WeakMap<Doc,Pen|null>());
 const drag=useRef<Drag|null>(null),held=useRef<{base:Doc;next:Doc}|null>(null),svg=useRef<SVGSVGElement>(null),host=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),own=useRef<Doc|null>(null),approved=useRef<{ids:string[];scope:string[]}|null>(null),space=useRef(false),request=useRef(0),latest=useRef<any>(null);
 // Migrate a live pre-V3 session without clearing it or creating an authoring Undo.
 useEffect(()=>{if(rawStored!==stored)useEditor.getState().setDrawing(stored);},[rawStored,stored]);
 function endPen(){penHistory.current=new WeakMap();setPen(null);setPenPreview(null);}
 const d=draft??stored,unit=Math.min(size.width,size.height)/2.8*zoom;
 const screen=(p:Point2):Point2=>[size.width/2+pan[0]+p[0]*unit,size.height/2+pan[1]-p[1]*unit];
 const local=(e:{clientX:number;clientY:number}):Point2=>{const r=svg.current!.getBoundingClientRect();return [(e.clientX-r.left-size.width/2-pan[0])/unit,-(e.clientY-r.top-size.height/2-pan[1])/unit];};
 const selected=selection.ids.filter(id=>d.curves.some(c=>c.id===id)),activeLayer=d.layers.find(l=>l.id===layerId)??d.layers[0],bounds=useMemo(()=>selectionBounds(d,selected),[d,selection]);
 // Keep the same source geometry across successive corner drags: never accumulate fit errors.
 const cage=useMemo<DeformCage|null>(()=>{
  if(tool!=='deform'||!selected.length)return null;
  if(deformCage?.committed===stored&&deformCage.ids.length===selected.length&&selected.every(id=>deformCage.ids.includes(id)))return deformCage;
  const b=selectionBounds(stored,selected);if(!b)return null;
  const pad=Math.max(.01,Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1])*.05),rect:DeformRect={min:[...b.min],max:[...b.max]};
  for(const k of [0,1] as const)if(rect.max[k]-rect.min[k]<pad){rect.min[k]-=pad;rect.max[k]+=pad;}
  return {base:stored,committed:stored,ids:selected,rect,quad:rectQuad(rect),maxError:0};
 },[tool,stored,selection,deformCage]);
 const shownCurves=d.layers.flatMap(l=>l.items).filter(id=>visible(d,id));
 const activeTool=TOOLS.find(x=>x[0]===tool)!;
 const endpointTools=isEndpointTool(tool);
 // Display and hit testing share one scope. Draft previews may move endpoints,
 // but picking still uses stored positions so the second click stays stable.
 const endpointCurveIds=(document:Doc)=>(document.layers.find(l=>l.id===activeLayer?.id)?.items??[]).filter(id=>editable(document,id));
 const connections=first?(tool==='smooth'?t('第二步：选择需要对齐的一侧'):t('第二步：选择要移动的端点')):(tool==='smooth'?t('第一步：选择保留方向的一侧'):t('第一步：选择固定端点'));
 const commit=(n:Doc)=>{if(n===stored)return;if(artworkPreview&&Object.keys(n).some(k=>k!=='reference'&&n[k as keyof Doc]!==stored[k as keyof Doc]))artworkPreview.edit();own.current=n;commitDrawing(n);};
 const release=(id:number)=>{if(svg.current?.hasPointerCapture(id))svg.current.releasePointerCapture(id);};
 const cancelDraft=()=>{const g=drag.current;if(g?.kind==='deform')setDeformCage(g.cage!);drag.current=null;held.current=null;setAxisSnap(null);setNodeSnap(null);setDraft(null);setBox(null);setPenPreview(null);if(g?.kind==='zoom')session.set({zoom:g.zoom,pan:g.pan});if(g)release(g.pointerId);};
 function error(e:unknown,scope=selected){if(e instanceof cmd.RelatedSelection)setPending({ids:e.ids,scope:[...scope]});else setHint(t((e as Error).message));}
 function run(fn:()=>Doc){try{const n=fn();commit(n);setHint('');}catch(e){error(e);}}
 function choose(next:DrawingSelection,mode?:DrawingTool){
  if(artworkPreview&&!next.reference&&(next.ids.length||next.paint||next.paintIds?.length))artworkPreview.edit();
  // Switching the endpoint target layer keeps the tool. Only LINK supports a
  // cross-layer relation, so other tools restart their two-click selection.
  if(endpointTools&&next.layer){finishHeld();cancelDraft();approved.current=null;setPending(null);endPen();if(tool!=='link')setFirst(null);session.set({layerId:next.layer,selection:{ids:[],layer:next.layer,layers:next.layers}});setHint('');return;}
  finishHeld();setDeformCage(null);approved.current=null;setPending(null);setFirst(null);setReferenceMoving(false);endPen();setPenPreview(null);session.set({selection:next,...(next.layer?{layerId:next.layer}:{}),tool:tool==='deform'&&next.ids.length&&!next.node&&!next.handle?'deform':mode??(next.ids.length===1&&!next.layer&&!next.group?'direct':'select')});setHint('');
 }
 function prepareSnapshotChange(){artworkPreview?.edit();finishHeld();cancelDraft();setDeformCage(null);endPen();setFirst(null);setPending(null);setReferenceMoving(false);approved.current=null;}
 function groupSelection(remove=false){run(()=>{let i=1;while(d.groups?.some(g=>g.name===`${t('组合')} ${i}`))i++;const n=remove?ungroup(d,selected):createGroup(d,selected,`${t('组合')} ${i}`);const g=remove?undefined:n.groups!.at(-1);choose({ids:g?.curveIds??selected,group:g?.id},'select');return n;});}
 function selectTool(next:DrawingTool){finishHeld();setDeformCage(null);approved.current=null;cancelDraft();setFirst(null);endPen();setPending(null);setPenPreview(null);setReferenceMoving(false);setHint('');
  if(next!=='hand'&&next!=='zoom')artworkPreview?.edit();
  const owner=selected.length?layerFor(stored,selected[0])?.id:undefined;
  session.set({tool:next,preview:false,...(isEndpointTool(next)&&owner&&selected.every(id=>layerFor(stored,id)?.id===owner)?{layerId:owner}:{}),...(next==='pen'?{penJoin:'POSITION' as const}:{})});
 }
 const scope=()=>approved.current&&selected.length===approved.current.ids.length&&selected.every(id=>approved.current!.ids.includes(id))?approved.current.scope:selected;
 const mayInclude=()=>!!approved.current&&scope()===approved.current.scope;
 function applyTransform(kind:'moveX'|'moveY'|'rotate'|'scale'|'mirror',value:number){
  const ids=scope(),b=selectionBounds(d,ids);if(!b)return;
  const center=b.center,angle=value*Math.PI/180;
  const map=(p:Point2):Point2=>kind==='moveX'?add(p,[value,0]):kind==='moveY'?add(p,[0,value]):kind==='mirror'?[2*center[0]-p[0],p[1]]:kind==='scale'?add(center,mul(sub(p,center),value)):(()=>{const [x,y]=sub(p,center);return add(center,[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]);})();
  try{commit(cmd.transform(d,ids,map,mayInclude()));setHint('');}catch(e){error(e,ids);}
 }
 useEffect(()=>{const obs=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));obs.observe(host.current!);return()=>obs.disconnect();},[]);
 useEffect(()=>{
  if(stored!==own.current){
   cancelDraft();setFirst(null);setPending(null);approved.current=null;
   const restored=useDrawing.getState().tool==='pen'?penHistory.current.get(stored):undefined;
   if(restored===undefined)endPen();else {setPen(restored);setPenPreview(null);}
   const s=useDrawing.getState().selection;
   session.set({selection:{layers:s.layers?.filter(id=>stored.layers.some(l=>l.id===id)),group:stored.groups?.some(g=>g.id===s.group)?s.group:undefined,displayInterval:stored.displayIntervals?.some(t=>t.id===s.displayInterval?.track&&t.ranges.some(r=>r.id===s.displayInterval?.range))?s.displayInterval:undefined,
    ids:restored?.last?[restored.last]:s.ids.filter(id=>stored.curves.some(c=>c.id===id)),paintIds:s.paintIds?.filter(id=>objectById(stored,id)),
    node:s.node&&stored.nodes.some(n=>n.id===s.node)?s.node:undefined,handle:s.handle&&stored.curves.some(c=>c.id===s.handle!.curveId)?s.handle:undefined,layer:s.layer&&stored.layers.some(l=>l.id===s.layer)?s.layer:undefined,reference:s.reference,mirrorAxis:s.mirrorAxis,inkEnd:s.inkEnd&&objectById(stored,s.inkEnd.id)?s.inkEnd:undefined,paint:s.paint&&objectById(stored,s.paint)?s.paint:undefined}});
  }
  own.current=null;
 },[stored]);
 useEffect(()=>{if(!stored.layers.some(l=>l.id===layerId))session.set({layerId:stored.layers[0]?.id??null});},[stored.layers,layerId]);
 useEffect(()=>{request.current++;cancelDraft();setFirst(null);endPen();setClipboard(null);},[projectId]);
 useEffect(()=>{const blur=()=>{finishHeld();space.current=false;setZoomOut(false);},pointer=()=>finishHeld();window.addEventListener('blur',blur);window.addEventListener('pointerdown',pointer,true);return()=>{request.current++;finishHeld();window.removeEventListener('blur',blur);window.removeEventListener('pointerdown',pointer,true);};},[]);
 usePointerDragTracking({active:()=>drag.current,move:e=>move(e),finish:(e,interrupted)=>up(e,interrupted)});
 async function upload(e:React.ChangeEvent<HTMLInputElement>){const photo=e.target.files?.[0];e.target.value='';if(!photo)return;const ticket=++request.current,origin=useEditor.getState().project;setBusy(true);try{const reference=await readPhoto(photo,RECORDING_REFERENCE_IMAGE);if(ticket!==request.current||origin.meta.createdAt!==useEditor.getState().project.meta.createdAt)return;const current=useEditor.getState().project.drawing??EMPTY;commit({...current,reference:{...reference,locked:true}});choose({ids:[],reference:true});}catch(e){error(e);}finally{setBusy(false);}}
 function pickEndpoint(p:Point2):Endpoint|null{
  const targets=endpointCurveIds(stored).flatMap(curveId=>([0,1] as const).map(end=>({curveId,end,p:nodeAt(stored,{curveId,end}).position})));
  return targets.map(e=>({...e,distance:length(sub(p,e.p))*unit})).filter(e=>e.distance<=11&&!(first&&first.curveId===e.curveId&&first.end===e.end)).sort((a,b)=>a.distance-b.distance)[0]??null;
 }
 function connectAt(e:Endpoint){
  if(!first){setFirst(e);session.set({selection:{ids:[e.curveId],node:nodeAt(d,e).id}});setHint('');return;}
  try{const n=tool==='link'?cmd.linkEndpoints(stored,first,e,true):tool==='merge'?cmd.merge(stored,first,e):cmd.connect(stored,first,e,tool==='smooth'?'SMOOTH':tool==='cusp'?'CUSP':tool==='arc'?'ARC':'POSITION');commit(n);setFirst(null);setDraft(null);choose({ids:[e.curveId],node:nodeAt(n,e).id},tool);}catch(ex){error(ex);}
 }
 function penCandidate(base:Doc,from:Pen,to:Point2,handle:Point2):{document:Doc;next:Pen;closed:boolean;shape:Cubic}{
  if(!activeLayer)throw Error('请先新建绘制层。');
  let close=false,target=[...to] as Point2;
  if(from.first&&length(sub(target,nodeAt(base,from.first).position))*unit<10){target=[...nodeAt(base,from.first).position];close=true;}
  const chord=sub(target,from.position),delta=length(sub(handle,to))*unit>2?sub(handle,to):mul(chord,1/3),out=(!from.last||penJoin==='SMOOTH')&&length(from.out)>1e-7?from.out:mul(chord,1/3);
  const shape:Cubic=[[...from.position],add(from.position,out),sub(target,delta),target],id=uid();
  let n=cmd.createPenCurve(base,activeLayer.id,shape,width,id,usePenPreferences.getState().taperScale);
  if(from.last)n=cmd.connect(n,{curveId:from.last,end:1},{curveId:id,end:0},penJoin);
  const firstEnd=from.first??{curveId:id,end:0 as const};
  if(close)n=cmd.connect(n,firstEnd,{curveId:id,end:1},penJoin);
  const actual=shapeOf(n,id);
  return {document:n,next:{position:target,out:penJoin==='SMOOTH'?sub(target,actual[2]):[0,0],last:id,first:firstEnd},closed:close,shape:actual};
 }
 function startDrag(e:React.PointerEvent,kind:Drag['kind'],extra:Partial<Drag>={}){
  if(drag.current||e.button!==0&&kind!=='pan'&&kind!=='zoom')return;e.preventDefault();e.stopPropagation();svg.current!.focus({preventScroll:true});
  const base=useEditor.getState().project.drawing??EMPTY;
  drag.current={kind,start:local(e),client:[e.clientX,e.clientY],last:{clientX:e.clientX,clientY:e.clientY},base,pointerId:e.pointerId,button:e.button,pointerType:e.pointerType,followStrength:tool==='direct'?useDirectPreferences.getState().followPercent/100:0,...extra};setHint('');
  try{svg.current!.setPointerCapture(e.pointerId);}catch{/* Window tracking remains active if native capture is unavailable. */}
 }
 function axisDown(e:React.PointerEvent){
  if(space.current||referenceMoving||tool==='hand'||tool==='zoom'||tool==='deform'||e.button!==0)return;
  setPending(null);session.set({selection:{ids:[],mirrorAxis:true}});startDrag(e,'mirrorAxis');
 }
 function curveDown(e:React.PointerEvent,id:string){
  if(referenceMoving||space.current||e.button===1||e.button===2||tool==='hand')return;
  if(['pen','ellipse','zoom'].includes(tool)||endpointTools)return;
  if(tool==='split'){e.stopPropagation();const hit=snapRecordingEndpoint(local(e),[{id,name:'',shape:shapeOf(d,id),auxiliary:false}],[unit,unit]);if(hit)run(()=>{const n=cmd.splitCurve(stored,id,hit.t);choose({ids:n.ids},'direct');return n.document;});return;}
  if(tool==='mirror'){e.stopPropagation();if(!first){setFirst({curveId:id,end:0});setHint(t('请选择目标曲线'));}else try{const n=cmd.mirrorEdit(stored,first.curveId,id);commit(n);setFirst(null);choose({ids:[id]},'direct');}catch(ex){if(ex instanceof cmd.RelatedSelection)setPending({ids:ex.ids,scope:[id],mirror:{source:first.curveId,target:id,base:stored}});else error(ex,[id]);}return;}
  if(!editable(d,id))return;
  let ids=(tool==='select'||tool==='deform')?selectionUnit(d,id):[id];if(e.shiftKey)ids=ids.every(x=>selected.includes(x))?selected.filter(x=>!ids.includes(x)):[...new Set([...selected,...ids])];
  else if((tool==='select'||tool==='deform')&&selected.includes(id)&&ids.every(x=>selected.includes(x)))ids=selected;
  if(!(ids.length===selected.length&&ids.every(id=>selected.includes(id)))){approved.current=null;session.set({selection:{ids,group:tool==='select'?selectedGroup(d,ids)?.id:undefined}});}setReferenceMoving(false);
  if(tool==='deform'){e.stopPropagation();return;}
  if(tool==='direct')session.set({selection:{ids}});startDrag(e,'move',{ids:approved.current?.scope??ids});
 }
 function arcDown(e:React.PointerEvent,id:string){if(space.current||e.button!==0)return;const j=d.joins.find(j=>j.id===id);if(!j)return;e.stopPropagation();if(tool==='split'){setHint(t('圆弧是派生过渡，请分割两侧源曲线。'));return;}if(tool==='mirror'){curveDown(e,j.a.curveId);return;}if(tool==='select'||tool==='deform'){curveDown(e,j.a.curveId);return;}choose({ids:[j.a.curveId],node:nodeAt(d,j.a).id},'direct');}
 function paintDown(e:React.PointerEvent,id:string){if(tool==='deform'){e.stopPropagation();return;}if(space.current||e.button!==0)return;e.stopPropagation();svg.current?.focus({preventScroll:true});const g=tool==='select'?groupFor(d,id):undefined;if(g){const ids=e.shiftKey?(g.curveIds.every(x=>selected.includes(x))?selected.filter(x=>!g.curveIds.includes(x)):[...new Set([...selected,...g.curveIds])]):g.curveIds;choose({ids,group:selectedGroup(d,ids)?.id},'select');startDrag(e,'move',{ids});}else choose({ids:[],paint:id},'select');}
 function down(e:React.PointerEvent){
  // Ctrl-click is reported as button 2 on some macOS configurations.
  if(tool==='zoom'&&!space.current&&(e.button===0||e.button===2&&e.ctrlKey)){e.preventDefault();svg.current?.focus({preventScroll:true});startDrag(e,'zoom',{zoom,pan:[...pan]});return;}
  if(e.button===2||e.button===1||space.current||tool==='hand'){startDrag(e,'pan',{pan:[...pan]});return;}
  if(e.button!==0)return;
  if(referenceMoving&&d.reference&&!d.reference.locked){startDrag(e,'reference');return;}
  if(preview||artworkPreview)return;
  if(endpointTools){const hit=pickEndpoint(local(e));if(hit)connectAt(hit);else setHint(t('请点击曲线端点。'));return;}
  if(tool==='pen'){if(!activeLayer){setHint(t('请先新建绘制层。'));return;}startDrag(e,'pen',{pen,cursor:local(e)});return;}
  if(tool==='ellipse'){startDrag(e,'ellipse');return;}
  if(tool==='select'||tool==='direct'){if(!e.shiftKey)choose({ids:[]},tool);startDrag(e,'box',{shift:e.shiftKey});}
 }
 function fit(){const b=selectionBounds(d,shownCurves);if(!b){session.set({zoom:1,pan:[0,0]});return;}const base=Math.min(size.width,size.height)/2.8,z=Math.max(.1,Math.min(8,Math.min((size.width-100)/Math.max(.1,b.max[0]-b.min[0]),(size.height-100)/Math.max(.1,b.max[1]-b.min[1]))/base));session.set({zoom:z,pan:[-b.center[0]*base*z,b.center[1]*base*z]});}
 function zoomAt(e:{clientX:number;clientY:number},value:number){const z=Math.max(.1,Math.min(12,value)),p=local(e),r=svg.current!.getBoundingClientRect(),u=unit*z/zoom;session.set({zoom:z,pan:[e.clientX-r.left-size.width/2-p[0]*u,e.clientY-r.top-size.height/2+p[1]*u]});}
 function move(e:React.PointerEvent|PointerEvent){
  const p=local(e);const g=drag.current;
  if(g){if(e.pointerId!==g.pointerId)return;g.last={clientX:e.clientX,clientY:e.clientY};}
  if(!g){if(artworkPreview)return;if(tool==='pen'&&pen){const chord=sub(p,pen.position);setPenPreview([pen.position,add(pen.position,(!pen.last||penJoin==='SMOOTH')&&length(pen.out)>1e-7?pen.out:mul(chord,1/3)),sub(p,mul(chord,1/3)),p]);}
   if(first&&endpointTools&&tool!=='merge'){const target=pickEndpoint(p);if(target)try{setDraft(tool==='link'?cmd.linkEndpoints(stored,first,target,true):cmd.connect(stored,first,target,tool==='smooth'?'SMOOTH':tool==='cusp'?'CUSP':tool==='arc'?'ARC':'POSITION'));}catch{setDraft(null);}else setDraft(null);}return;}
  if(g.kind==='zoom'){
   const dy=g.client[1]-e.clientY;if(!g.zoomMoved&&Math.abs(dy)<2)return;g.zoomMoved=true;
   const z=Math.max(.1,Math.min(12,g.zoom!*Math.exp(dy*.008))),r=svg.current!.getBoundingClientRect(),u=Math.min(size.width,size.height)/2.8*z;
   session.set({zoom:z,pan:[g.client[0]-r.left-size.width/2-g.start[0]*u,g.client[1]-r.top-size.height/2+g.start[1]*u]});return;
  }
  const delta=sub(p,g.start);if(length(delta)*unit<.4&&!g.next&&g.kind!=='pen')return;
  try{
   if(g.kind==='pan'){session.set({pan:add(g.pan!,[e.clientX-g.client[0],e.clientY-g.client[1]])});return;}
   if(g.kind==='box'){setBox({a:g.start,b:p});return;}
   if(g.kind==='pen'){g.cursor=p;if(g.pen&&length(sub(g.start,g.pen.position))*unit>2){const n=penCandidate(g.base,g.pen,g.start,p);g.next=n.document;setDraft(n.document);setPenPreview(null);}else setPenPreview(null);return;}
   if(g.kind==='ellipse'){const n=cmd.ellipse(g.base,activeLayer!.id,g.start,e.shiftKey?add(g.start,[Math.sign(delta[0])*Math.max(Math.abs(delta[0]),Math.abs(delta[1])),Math.sign(delta[1])*Math.max(Math.abs(delta[0]),Math.abs(delta[1]))]):p,width);g.next=n.document;}
   if(g.kind==='mirrorAxis'){
    const x=(g.base.mirrorAxisX??0)+delta[0],nodeIds=new Set(g.base.curves.filter(c=>visible(g.base,c.id)).flatMap(c=>c.nodes));
    const targets=g.base.nodes.filter(n=>{if(!nodeIds.has(n.id))return false;const [x,y]=screen(n.position);return x>=0&&x<=size.width&&y>=0&&y<=size.height;});
    const snapped=snapMirrorAxis(targets,x,p[1],unit);setAxisSnap(snapped?.position??null);g.next=cmd.setMirrorAxis(g.base,snapped?.position[0]??x);
   }
   if(g.kind==='node'){
    let position=add(g.base.nodes.find(n=>n.id===g.node)!.position,delta);
    const visibleIds=new Set(g.base.curves.filter(c=>visible(g.base,c.id)).flatMap(c=>c.nodes));
    const coupled=linkedNodeIds(g.base,g.node!);const target=g.base.nodes.filter(n=>!coupled.has(n.id)&&visibleIds.has(n.id)).map(n=>({n,distance:length(sub(n.position,position))*unit})).filter(x=>x.distance<=9).sort((a,b)=>a.distance-b.distance)[0]?.n;
    const axis=g.base.mirrorAxisX??0,snapped=target?.position??(Math.abs(position[0]-axis)*unit<=8?[axis,position[1]] as Point2:null);
    if(snapped)position=[...snapped];g.next=dragNode(g.base,g.node!,position,g.followStrength??0);setNodeSnap(snapped);
   }
   if(g.kind==='displayInterval'){
    const grip=g.displayInterval!,track=g.base.displayIntervals!.find(t=>t.id===grip.track)!,range=track.ranges.find(r=>r.id===grip.range)!,field=displayField(g.base,displayPath(g.base,track.anchor.id)),current=g.next?.displayIntervals?.find(t=>t.id===grip.track)?.ranges.find(r=>r.id===grip.range)??range,previous=grip.end?current.end:current.start;
    const value=nearestDisplayPosition(field,track,p,previous);g.next=changeDisplayInterval(g.base,track.id,range.id,grip.end?{end:value}:{start:value});
   }
   if(g.kind==='handle')g.next=cmd.moveHandle(g.base,g.endpoint!,add(curveById(g.base,g.endpoint!.curveId).handles[g.endpoint!.end],delta));
   if(g.kind==='deform'){
    const original=g.cage!,quad=original.quad.map(q=>[...q]) as Quad;quad[g.corner!]=add(quad[g.corner!],delta);
    const result=deformDrawing(original.base,original.ids,original.rect,quad,!!approved.current);g.next=result.document;
    setDeformCage({...original,quad,maxError:result.maxError});setHint('');
   }
   if(g.kind==='move')g.next=cmd.transform(g.base,g.ids!,x=>add(x,delta),!!approved.current);
   if(g.kind==='rotate'){const o=g.origin!,angle=Math.atan2(p[1]-o[1],p[0]-o[0])-Math.atan2(g.start[1]-o[1],g.start[0]-o[0]),a=e.shiftKey?Math.round(angle/(Math.PI/12))*Math.PI/12:angle;g.next=cmd.transform(g.base,g.ids!,x=>{const v=sub(x,o);return add(o,[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)]);},!!approved.current);}
   if(g.kind==='scale'){const o=g.origin!,start=sub(g.start,o),now=sub(p,o),safe=(v:number)=>Math.abs(v)<.01?(v<0?-.01:.01):v;let sx=safe(Math.abs(start[0])<1e-9?1:now[0]/start[0]),sy=safe(Math.abs(start[1])<1e-9?1:now[1]/start[1]);if(e.shiftKey)sy=sx;g.next=cmd.transform(g.base,g.ids!,x=>{const v=sub(x,o);return add(o,[v[0]*sx,v[1]*sy]);},!!approved.current);}
   if(g.kind==='reference'&&g.base.reference){const ref=g.base.reference;g.next={...g.base,reference:{...ref,offset:add(ref.offset,delta).map(clampReferenceOffset) as Point2}};}
   if(g.next)setDraft(g.next);
  }catch(ex){if(ex instanceof cmd.RelatedSelection){cancelDraft();error(ex,g.ids);}else setHint(t((ex as Error).message));}
 }
 function up(e?:PointerEvent|MouseEvent,interrupted=false){
  const g=drag.current;if(!g)return;
  drag.current=null;setAxisSnap(null);setNodeSnap(null);setDraft(null);setBox(null);
  release(g.pointerId);
  if((useEditor.getState().project.drawing??EMPTY)!==g.base){setPenPreview(null);return;}
  try{
   if(g.kind==='zoom'){if(!g.zoomMoved&&!interrupted&&e)zoomAt(e,g.zoom!*((e.ctrlKey||e.altKey)?1/1.3:1.3));return;}
   if(g.kind==='pen'){
    if(!g.pen){const anchor={position:g.start,out:sub(g.cursor??g.start,g.start)};penHistory.current=new WeakMap([[g.base,anchor]]);setPen(anchor);}
    else if(length(sub(g.start,g.pen.position))*unit>2){const n=penCandidate(g.base,g.pen,g.start,g.cursor??g.start);penHistory.current.set(g.base,g.pen);penHistory.current.set(n.document,n.closed?null:n.next);commit(n.document);setPen(n.closed?null:n.next);session.set({selection:{ids:[n.next.last!]}});setPenPreview(null);}
   }else if(g.kind==='box'){
    const p=local(e??g.last),lo:[number,number]=[Math.min(g.start[0],p[0]),Math.min(g.start[1],p[1])],hi:[number,number]=[Math.max(g.start[0],p[0]),Math.max(g.start[1],p[1])];
    const hits=shownCurves.filter(id=>{if(!editable(d,id))return false;const b=selectionBounds(d,[id])!;return b.min[0]>=lo[0]&&b.min[1]>=lo[1]&&b.max[0]<=hi[0]&&b.max[1]<=hi[1];});
    const ids=tool==='select'?hits.flatMap(id=>selectionUnit(d,id)):hits;choose({ids:[...new Set([...(g.shift?selected:[]),...ids])]},tool);
   }else if(g.next){if(g.kind==='deform')setDeformCage(c=>c?{...c,committed:g.next!}:c);commit(g.next);if(g.kind==='ellipse'){const ids=g.next.curves.filter(c=>!g.base.curves.some(x=>x.id===c.id)).map(c=>c.id);choose({ids},'select');}}
  }catch(ex){error(ex);}
  if(interrupted&&g.next)setHint(t('拖动已中断，已保留最后有效位置。'));
 }
 function deleteSelected(){
  const layers=selectedLayers(selection);if(layers.length){run(()=>{const n=cmd.deleteLayers(d,layers);choose({ids:[]});return n;});return;}
  if(selection.displayInterval){const r=selection.displayInterval;run(()=>{const n=removeDisplayInterval(d,r.track,r.range);choose({ids:selected});return n;});return;}
  const ids=selectedObjects(selection);if(!ids.length)return;
  run(()=>{const n=cmd.deleteObjects(d,ids);choose({ids:[]});return n;});
 }
 function cutSelected(){
  if(drag.current)return;finishHeld();
  try{const result=cutDrawing(useEditor.getState().project.drawing??EMPTY,selectedObjects(selection));if(!result)return;
   choose({ids:[]},'select');commit(result.document);setClipboard(result.clipboard);setHint(t('已剪切；选择目标图层后按 Ctrl/Cmd+V 原位粘贴。'));
  }catch(ex){error(ex);}
 }
 function pasteSelected(){
  if(!clipboard||drag.current)return;finishHeld();
  try{if(!activeLayer)throw Error('请先选择粘贴目标图层。');const next=pasteDrawingCut(useEditor.getState().project.drawing??EMPTY,clipboard,activeLayer.id);
   const ids=clipboard.items.filter(id=>curveById(next,id)),paintIds=clipboard.items.filter(id=>!curveById(next,id));
   choose({ids,paintIds,paint:!ids.length&&paintIds.length===1?paintIds[0]:undefined,group:selectedGroup(next,ids)?.id,layer:activeLayer.id},'select');commit(next);setHint(t('已原位粘贴到当前图层。'));
  }catch(ex){error(ex);}
 }
 function finishHeld(){
  const k=held.current;if(!k)return;held.current=null;setDraft(null);
  if(useEditor.getState().project.drawing===k.base){
   const prior=penHistory.current.get(k.base);
   if(useDrawing.getState().tool==='pen'&&prior?.last&&curveById(k.next,prior.last)){
    const next={...prior,position:nodeAt(k.next,{curveId:prior.last,end:1}).position};penHistory.current.set(k.next,next);setPen(next);setPenPreview(null);
   }
   own.current=k.next;commitDrawing(k.next);
  }
 }
 function history(redo=false){
  if(drag.current||held.current){cancelDraft();return;}
  // A first anchor is still a draft: remove it without undoing an unrelated document edit.
  if(!redo&&tool==='pen'&&pen&&!pen.last){setPen(null);setPenPreview(null);return;}
  const editor=useEditor.getState();redo?editor.redo():editor.undo();
 }
 latest.current={d,selected,selection,tool,run,choose,selectTool,cancelDraft,commit,applyTransform,scope,mayInclude,groupSelection,deleteSelected,cutSelected,pasteSelected,clipboard,history};
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   setZoomOut(e.ctrlKey||e.altKey);
   if((e.target as Element).closest('[data-hair-orbit],input,textarea,select,[contenteditable="true"],[role="dialog"]'))return;
   // Menu navigation belongs to the tool group, never to selected geometry.
   if(document.querySelector('.drawing-tool-menu')||(e.key==='ArrowDown'&&(e.target as Element).closest('[data-tool-group="connections"]')))return;
   const s=latest.current;if(e.code==='Space'){e.preventDefault();space.current=true;return;}
   if(e.key==='Escape'){e.preventDefault();s.cancelDraft();setFirst(null);endPen();setPenPreview(null);setPending(null);setReferenceMoving(false);return;}
   if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();s.history(e.shiftKey||e.key.toLowerCase()==='y');return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='x'&&selectedObjects(s.selection).length){e.preventDefault();e.stopImmediatePropagation();s.cutSelected();return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'&&s.clipboard){e.preventDefault();e.stopImmediatePropagation();s.pasteSelected();return;}
   if(e.key==='Enter'&&s.tool==='pen'){endPen();setPenPreview(null);return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();const list=!!(e.target as Element).closest('.drawing-layers');s.choose({ids:s.d.curves.filter((c:DrawingCurveAlias)=>list||editable(s.d,c.id)).map((c:DrawingCurveAlias)=>c.id),...(list?{paintIds:[...s.d.fills,...s.d.offsets].map((o:{id:string})=>o.id)}:{})},'select');return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){e.preventDefault();s.groupSelection(e.shiftKey);return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();s.run(()=>{const n=cmd.duplicateCurves(s.d,s.selected);s.choose({ids:n.ids,group:selectedGroup(n.document,n.ids)?.id},'select');return n.document;});return;}
   if(['Delete','Backspace'].includes(e.key)){e.preventDefault();s.deleteSelected();return;}
   if(e.key.startsWith('Arrow')&&hasNudgeTarget(s.selection)){
    e.preventDefault();e.stopImmediatePropagation();if(drag.current||e.ctrlKey||e.metaKey)return;
    const amount=.004*(e.shiftKey?5:e.altKey?0.2:1),delta:Point2=[e.key==='ArrowRight'?amount:e.key==='ArrowLeft'?-amount:0,e.key==='ArrowUp'?amount:e.key==='ArrowDown'?-amount:0],base=held.current?.next??s.d;
    try{const n=nudgeSelection(base,s.selection,delta);if(n===base)return;if(!held.current)held.current={base,next:n};else held.current.next=n;setDraft(n);setHint('');}catch(ex){setHint(t((ex as Error).message));}return;
   }
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   const toolMap:Record<string,DrawingTool>={v:'select',a:'direct',p:'pen',l:'ellipse',h:'hand',z:'zoom'};if(toolMap[e.key.toLowerCase()]){e.preventDefault();s.selectTool(toolMap[e.key.toLowerCase()]);}
  };
  const release=(e:KeyboardEvent)=>{setZoomOut(e.ctrlKey||e.altKey);if(e.code==='Space')space.current=false;if(e.key.startsWith('Arrow'))finishHeld();};
  window.addEventListener('keydown',key,true);window.addEventListener('keyup',release,true);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',release,true);};
 },[]);
 const penDrag=drag.current?.kind==='pen'?drag.current:null,visiblePen=penDrag?{position:penDrag.start,out:sub(penDrag.cursor??penDrag.start,penDrag.start)}:pen;
 const controls=endpointTools?endpointCurveIds(d):selected;
 const nodes=[...new Set(controls.flatMap(id=>curveById(d,id).nodes))];
 const activeHandle=selection.handle&&editable(d,selection.handle.curveId)?selection.handle:undefined;
 function handleControl(id:string,end:0|1,active=false){
  const e={curveId:id,end},p=screen(curveById(d,id).handles[end]),node=screen(nodeAt(d,e).position),short=length(sub(p,node))<10;
  // A short handle is not missing: expose a ring around the node. Its center
  // remains the true control point, so dragging has no proxy offset or jump.
  return <circle key={end} data-testid="drawing-handle" data-id={id} data-end={end} data-short={short} data-active={active} cx={p[0]} cy={p[1]} r={short?9:4.5} fill={short?'transparent':active?'#c8eafa':'#fff'} stroke="#2589b0" strokeWidth={active?2:1.5} strokeDasharray={short?'3 2':undefined} pointerEvents="all" onPointerDown={ev=>{session.set({selection:{ids:[id],handle:e}});startDrag(ev,'handle',{endpoint:e});}}><title>{t(short?'短控制柄：拖动圆环，或在属性中选择控制柄。':'控制柄')}</title></circle>;
 }
 const ref=d.reference,refMax=ref?Math.max(ref.width,ref.height):1,refSize=ref?[ref.width/refMax*2.6*unit*ref.scale,ref.height/refMax*2.6*unit*ref.scale]:[0,0];
 return <main className="drawing-room" data-testid="drawing-room" data-workspace={workspaceId}>
 <AutoHideBar label="快照 · 工具选项" className="drawing-context-bar" pinId={workspaceId+".context-pinned"}>
 <SnapshotBar key={projectId} prepare={prepareSnapshotChange} switched={()=>{setClipboard(null);session.set({selection:{ids:[]},tool:'select',layerId:null});setHint('');}}/>
 <input type="file" accept="image/png,image/jpeg,image/webp" ref={file} hidden data-testid="drawing-reference-input" onChange={upload}/>
 <nav className="drawing-options" aria-label={t('当前工具选项')}><strong>{t(activeTool[1])}</strong><span className="drawing-tool-description" data-testid="drawing-tool-description">{t(activeTool[3])}</span>
 {['select','pen','ellipse'].includes(tool)&&<NumberField label="线宽" value={(selected.length?curveById(d,selected[0]).width:width)*250} min={.25} max={40} onChange={v=>{session.set({width:v/250});if(selected.length&&tool==='select')run(()=>cmd.widthChange(d,selected,v/250));}}/>}
 {['select','direct'].includes(tool)&&<><button data-testid="drawing-group" title={t(groupingIssue(d,selected)??'组合（Ctrl/Cmd+G）')} disabled={!!groupingIssue(d,selected)} onClick={()=>groupSelection()}>{t('组合')}</button><button data-testid="drawing-ungroup" title={t('取消组合（Ctrl/Cmd+Shift+G）')} disabled={!d.groups?.some(g=>g.curveIds.every(id=>selected.includes(id)))} onClick={()=>groupSelection(true)}>{t('取消组合')}</button></>}
 {tool==='deform'&&<><span data-testid="drawing-deform-error">{t('采样拟合偏差')} ≈ {((cage?.maxError??0)*250).toFixed(2)} px</span><button onClick={()=>{cancelDraft();setDeformCage(null);}}>{t('重置变形框')}</button><button onClick={()=>selectTool('select')}>{t('完成')}</button></>}
 {tool==='mirror'&&<><NumberField label="镜像轴 X" value={d.mirrorAxisX??0} onChange={x=>run(()=>cmd.setMirrorAxis(d,x))}/><button onClick={()=>run(()=>cmd.setMirrorAxis(d,0))}>{t('镜像轴归中')}</button></>}
 {tool==='pen'&&<label className="drawing-field">{t('继续接笔')}<select aria-label={t('继续接笔')} value={penJoin} onChange={e=>session.set({penJoin:e.target.value as 'POSITION'|'SMOOTH'|'CUSP'})}><option value="POSITION">{t('仅绑定')}</option><option value="SMOOTH">{t('平滑接笔')}</option><option value="CUSP">{t('尖点接笔')}</option></select></label>}
 {tool==='pen'&&<button onClick={()=>{cancelDraft();endPen();setPenPreview(null);}}><Check size={14}/>{t('结束绘制')}</button>}
 {(endpointTools||tool==='mirror')&&<><span className="drawing-step">{tool==='mirror'?t(first?'请选择目标曲线':'请选择源曲线'):connections}</span><button onClick={()=>{setFirst(null);setDraft(null);}}>{t('取消')}</button></>}

 <div className="drawing-options-right"><button disabled={busy} onClick={()=>file.current?.click()}><ImagePlus size={15}/>{t('参考图')}</button><button aria-pressed={preview} onClick={()=>{cancelDraft();setFirst(null);endPen();session.set({preview:!preview});}}><Eye size={15}/>{t('隐藏编辑辅助')}</button><button aria-label={t(sidebar?'收起右栏':'展开右栏')} onClick={()=>session.set({sidebar:!sidebar})}>{sidebar?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}</button></div>
 </nav>
 </AutoHideBar>
 <div className="drawing-body">
 <ToolBar tool={tool} select={selectTool}/>
 <div className={`drawing-canvas-wrap tool-${tool} ${zoomOut?'zoom-out':''} ${referenceMoving?'reference-moving':''}`} ref={host}>
 {artworkPreview&&<div className="drawing-artwork-preview-bar" data-testid="drawing-artwork-preview-bar"><span>{t('烘焙贴壳')}</span><button disabled={!ref} aria-pressed={referenceMoving} onClick={()=>{
  if(referenceMoving){setReferenceMoving(false);return;}if(!ref)return;
  cancelDraft();endPen();setFirst(null);choose({ids:[],reference:true});
  if(ref.locked||!ref.visible)commit({...d,reference:{...ref,locked:false,visible:true}});
  setPropertiesOpen(true);setReferenceMoving(true);
 }}>{t(referenceMoving?'完成图片平移':ref?.locked?'解锁并平移参考图':'平移参考图')}</button></div>}
 <svg ref={svg} width="100%" height="100%" tabIndex={0} data-testid="drawing-canvas" aria-label={t('绘制画布')} onContextMenu={e=>e.preventDefault()} onPointerDown={down} onPointerEnter={e=>setZoomOut(e.ctrlKey||e.altKey)} onPointerMove={e=>{setZoomOut(e.ctrlKey||e.altKey);if(!drag.current)move(e);}} onWheel={e=>{if(!drag.current)zoomAt(e,zoom*Math.exp(-e.deltaY*.001));}}>
 {ref?.visible&&<image data-testid="drawing-reference" href={ref.dataUrl} width={refSize[0]} height={refSize[1]} x={-refSize[0]/2} y={-refSize[1]/2} opacity={ref.opacity} transform={`translate(${screen(ref.offset)}) rotate(${ref.rotation})`} pointerEvents="none"/>}
 {underlay?.({...size,unit,pan})}
 {/* The wide guide hit target sits behind geometry, so curve/point picking wins. */}
 {!preview&&!artworkPreview&&<line data-testid="drawing-mirror-drag" x1={screen([d.mirrorAxisX??0,0])[0]} x2={screen([d.mirrorAxisX??0,0])[0]} y1={0} y2={size.height} stroke="transparent" strokeWidth="8" pointerEvents={!referenceMoving&&['select','direct','mirror'].includes(tool)?'stroke':'none'} style={{cursor:'ew-resize'}} onPointerDown={axisDown}/>}
 {artworkPreview?artworkPreview.render({...size,unit,pan}):<PaintScene d={d} screen={screen} unit={unit} preview={preview} showFills={showFills} fillVisibility={fillVisibility} referenceMoving={referenceMoving} tool={tool} selectedPaint={selection.paint} selectedPaints={selection.paintIds} curveDown={curveDown} paintDown={paintDown} arcDown={arcDown}/>}
 {aiGuides&&<AIGuideOverlay d={d} curveIds={[...selected,...(selection.handle?[selection.handle.curveId]:[])]} screen={screen} unit={unit} width={size.width} height={size.height}/>}
 {!preview&&!artworkPreview&&<g data-testid="drawing-mirror-guide">
  <line data-testid="drawing-mirror-axis" x1={screen([d.mirrorAxisX??0,0])[0]} x2={screen([d.mirrorAxisX??0,0])[0]} y1={0} y2={size.height} stroke={axisSnap?'#209978':selection.mirrorAxis?'#2589b0':'#d18d36'} strokeWidth="1.3" strokeDasharray="7 5" pointerEvents="none"/>
  <rect data-testid="drawing-mirror-grip" x={screen([d.mirrorAxisX??0,0])[0]-10} y={5} width={20} height={16} rx={3} fill={selection.mirrorAxis?'#d8f1fc':'#fff6df'} stroke="#d18d36" pointerEvents={!referenceMoving&&tool!=='hand'&&tool!=='zoom'&&tool!=='deform'?'all':'none'} style={{cursor:'ew-resize'}} onPointerDown={axisDown}><title>{t('拖动镜像轴，靠近端点时吸附')}</title></rect>
  <path d={`M ${screen([d.mirrorAxisX??0,0])[0]-5} 10 v 6 M ${screen([d.mirrorAxisX??0,0])[0]} 10 v 6 M ${screen([d.mirrorAxisX??0,0])[0]+5} 10 v 6`} stroke="#b07e32" pointerEvents="none"/>
  <text x={screen([d.mirrorAxisX??0,0])[0]+15} y={18} fill="#aa742d" fontSize="12" pointerEvents="none">{t('镜像轴 · 拖动吸附端点')}</text>
  {axisSnap&&<g data-testid="drawing-mirror-snap" pointerEvents="none"><circle cx={screen(axisSnap)[0]} cy={screen(axisSnap)[1]} r={7} fill="#d7f5e9" stroke="#209978" strokeWidth="2"/><text x={screen(axisSnap)[0]+12} y={screen(axisSnap)[1]-10} fill="#168065" fontSize="12">{t('已吸附端点')}</text></g>}
 </g>}
 {!preview&&!artworkPreview&&!referenceMoving&&<>
 {tool==='mirror'&&first&&curveById(d,first.curveId)&&<path data-testid="drawing-mirror-preview" d={curvePath(shapeOf(d,first.curveId).map(([x,y])=>[2*(d.mirrorAxisX??0)-x,y]) as Cubic,screen)} fill="none" stroke="#d18d36" strokeWidth="1.7" strokeDasharray="5 4" pointerEvents="none"/>}
 {(tool==='direct'||tool==='select')&&<InkEndOverlay d={d} selection={selection} screen={screen} pick={(e,id,end)=>{if(space.current||e.button!==0)return;e.stopPropagation();svg.current?.focus({preventScroll:true});choose(curveById(d,id)?{ids:[id],inkEnd:{id,end}}:{ids:[],paint:id,inkEnd:{id,end}},'direct');}}/>}
 {d.joins.filter(j=>j.mode==='ARC'&&[j.a,j.b].some(e=>selected.includes(e.curveId)&&visible(d,e.curveId))).map(j=>{const g=roundedJoins(d).get(j.id)!,p=screen(nodeAt(d,j.a).position);return <g key={j.id} pointerEvents="none" data-testid="drawing-arc-guide"><circle cx={p[0]} cy={p[1]} r={g.distance*unit} stroke="#c9a060" strokeWidth="1" strokeDasharray="3 4" fill="none"/><path d={pathOf(g.shapes,screen)} stroke="#228fbe" strokeWidth="1.5" fill="none"/></g>;})}
 {nodeSnap&&<g data-testid="drawing-node-snap" pointerEvents="none"><circle cx={screen(nodeSnap)[0]} cy={screen(nodeSnap)[1]} r={9} fill="none" stroke="#209978" strokeWidth="2"/><text x={screen(nodeSnap)[0]+13} y={screen(nodeSnap)[1]-12} fill="#168065" fontSize="12">{t(nodeSnap[0]===(d.mirrorAxisX??0)?'已吸附镜像轴':'已吸附端点')}</text></g>}
 {selected.filter(id=>visible(d,id)).map(id=><path key={id} data-testid="drawing-selected" data-id={id} d={curvePath(shapeOf(d,id),screen)} fill="none" stroke="#228fbe" strokeWidth="1.4" strokeDasharray={d.joins.some(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id))?'3 4':undefined} opacity={selection.displayInterval||(d.displayIntervals?.length&&strokeFor(d,id).segments.some(x=>d.displayIntervals!.some(t=>x.id===t.anchor.id)))||d.joins.some(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id))?.25:1} pointerEvents="none"/>)}
 {(tool==='direct'||endpointTools)&&<g pointerEvents="none" data-testid="drawing-endpoint-link-guides">{nodes.filter(id=>linksAtNode(d,id).length).map(id=>{const p=screen(d.nodes.find(n=>n.id===id)!.position);return <circle key={id} cx={p[0]} cy={p[1]} r={9} stroke="#a279bb" strokeWidth="1.5" fill="none"><title>{t('端点联动')}</title></circle>;})}</g>}
 {(tool==='direct'||endpointTools)&&<g>{tool==='direct'&&selected.filter(id=>editable(d,id)).map(id=>{const s=shapeOf(d,id).map(screen);return <g key={id}><path d={`M ${s[0]} L ${s[1]} M ${s[3]} L ${s[2]}`} stroke="#298eb3" strokeWidth="1" fill="none" pointerEvents="none"/>{([0,1] as const).filter(end=>activeHandle?.curveId!==id||activeHandle.end!==end).map(end=>handleControl(id,end))}</g>;})}
 {nodes.filter(id=>members(d,id).some(e=>editable(d,e.curveId))).map(id=>{const node=d.nodes.find(n=>n.id===id)!,p=screen(node.position),member=members(d,id).find(e=>controls.includes(e.curveId))!;return <rect key={id} data-testid="drawing-node" data-node={id} x={p[0]-4} y={p[1]-4} width="8" height="8" fill={first&&curveById(d,first.curveId)&&nodeAt(d,first).id===id?'#dc9840':selection.node===id?'#248ec1':'#fff'} stroke="#248ec1" strokeWidth="1.4" pointerEvents={endpointTools?'none':'all'} onPointerDown={e=>{session.set({selection:{ids:[member.curveId],node:id}});startDrag(e,'node',{node:id});}}/>;})}
 {tool==='direct'&&activeHandle&&handleControl(activeHandle.curveId,activeHandle.end,true)}</g>}
 {tool==='select'&&bounds&&selected.length>0&&selected.every(id=>transformable(d,id,selected))&&(()=>{const topLeft=screen([bounds.min[0],bounds.max[1]]),bottomRight=screen([bounds.max[0],bounds.min[1]]),center=screen(bounds.center),rot:[number,number]=[center[0],topLeft[1]-25];return <g data-testid="drawing-transform-box"><rect x={topLeft[0]-5} y={topLeft[1]-5} width={Math.max(10,bottomRight[0]-topLeft[0]+10)} height={Math.max(10,bottomRight[1]-topLeft[1]+10)} stroke="#238eb5" strokeDasharray="4 3" fill="none" pointerEvents="none"/><line x1={center[0]} y1={topLeft[1]} x2={rot[0]} y2={rot[1]} stroke="#238eb5"/><circle data-testid="drawing-rotate" cx={rot[0]} cy={rot[1]} r="5" fill="#fff" stroke="#238eb5" onPointerDown={e=>startDrag(e,'rotate',{ids:scope(),origin:bounds.center})}/>{([bounds.min,[bounds.max[0],bounds.min[1]],[bounds.min[0],bounds.max[1]],bounds.max] as Point2[]).map((p,i)=>{const s=screen(p),origin:Point2=[p[0]===bounds.min[0]?bounds.max[0]:bounds.min[0],p[1]===bounds.min[1]?bounds.max[1]:bounds.min[1]];return <rect key={i} data-testid="drawing-scale" x={s[0]-4} y={s[1]-4} width="8" height="8" fill="#fff" stroke="#238eb5" onPointerDown={e=>startDrag(e,'scale',{ids:scope(),origin})}/>;})}</g>;})()}
 {tool==='deform'&&cage&&(()=>{
  const projection=quadProjection(cage.rect,cage.quad),grid=[.25,.5,.75].flatMap(t=>{
   const x=cage.rect.min[0]+(cage.rect.max[0]-cage.rect.min[0])*t,y=cage.rect.min[1]+(cage.rect.max[1]-cage.rect.min[1])*t;
   return [[[x,cage.rect.min[1]],[x,cage.rect.max[1]]],[[cage.rect.min[0],y],[cage.rect.max[0],y]]] as [Point2,Point2][];
  });
  return <g data-testid="drawing-deform-cage"><polygon points={cage.quad.map(p=>screen(p).join(',')).join(' ')} fill="none" stroke="#a35ac0" strokeWidth="1.5" pointerEvents="none"/>
   {grid.map(([a,b],i)=><path key={i} d={`M ${screen(projection.map(a))} L ${screen(projection.map(b))}`} fill="none" stroke="#a35ac0" strokeDasharray="4 4" opacity=".4" pointerEvents="none"/>)}
   {cage.quad.map((p,i)=>{const q=screen(p);return <rect key={i} data-testid="drawing-deform-corner" data-corner={i} x={q[0]-6} y={q[1]-6} width="12" height="12" fill="white" stroke="#a35ac0" strokeWidth="2" style={{cursor:'move'}} onPointerDown={e=>{if(space.current||e.button!==0)return;startDrag(e,'deform',{cage,corner:i,ids:cage.ids});}}><title>{t('拖动四角变形')}</title></rect>;})}
  </g>;
 })()}
 {(tool==='direct'||tool==='select')&&<DisplayIntervalOverlay d={d} selection={selection} screen={screen} pick={(e,track,range,end)=>{if(space.current||e.button!==0)return;const t=d.displayIntervals!.find(t=>t.id===track)!;session.set({selection:{ids:[t.anchor.id],displayInterval:{track,range,end}}});startDrag(e,'displayInterval',{displayInterval:{track,range,end}});}}/>}
 {penPreview&&<path data-testid="drawing-pen-preview" d={curvePath(penPreview,screen)} fill="none" stroke="#208bb4" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none"/>}
 {tool==='pen'&&visiblePen&&<g pointerEvents="none" data-testid="drawing-pen-anchor"><circle cx={screen(visiblePen.position)[0]} cy={screen(visiblePen.position)[1]} r="4" fill="#208bb4"/><line x1={screen(visiblePen.position)[0]} y1={screen(visiblePen.position)[1]} x2={screen(add(visiblePen.position,visiblePen.out))[0]} y2={screen(add(visiblePen.position,visiblePen.out))[1]} stroke="#208bb4"/><circle cx={screen(add(visiblePen.position,visiblePen.out))[0]} cy={screen(add(visiblePen.position,visiblePen.out))[1]} r="3" fill="white" stroke="#208bb4"/></g>}
 {box&&<rect x={Math.min(screen(box.a)[0],screen(box.b)[0])} y={Math.min(screen(box.a)[1],screen(box.b)[1])} width={Math.abs(screen(box.a)[0]-screen(box.b)[0])} height={Math.abs(screen(box.a)[1]-screen(box.b)[1])} fill="#238eb512" stroke="#238eb5" strokeDasharray="4 3" pointerEvents="none"/>}
 </>}
 </svg>
 {!d.curves.length&&!d.reference&&tool==='select'&&<div className="drawing-welcome"><PenTool size={27}/><strong>{t('从一条线开始')}</strong><p>{t('加载参考图，选择图层，用钢笔落点并拖出控制柄。')}</p><button onClick={()=>file.current?.click()}>{t('插入背景图')}</button><button onClick={()=>{if(!activeLayer)run(()=>cmd.addLayer(stored,t('图层')+'1'));selectTool('pen');}}>{t('开始绘线')}</button></div>}
 {referenceMoving&&!artworkPreview&&<button className="drawing-reference-done" onClick={()=>setReferenceMoving(false)}>{t('完成图片平移')}</button>}
 {pending&&<div className="drawing-selection-notice" role="dialog"><strong>{t('本次操作会影响未选中的关联曲线。')}</strong><p>{pending.ids.map(id=>curveById(stored,id)?.name).join('、')}</p>{pending.mirror?<><p>{t('镜像将保持绑定与接笔关系，上述关联曲线的共享端点或控制柄会一起调整。')}</p><button onClick={()=>{const m=pending.mirror!;setPending(null);if(useEditor.getState().project.drawing!==m.base)return;try{commit(cmd.mirrorEdit(m.base,m.source,m.target,true));choose({ids:[m.target]},'direct');}catch(ex){error(ex,[m.target]);}}}>{t('继续镜像')}</button></>:<button onClick={()=>{approved.current=pending;session.set({selection:{ids:pending.ids}});setPending(null);setHint(t('已补齐选择，请重新执行变换。'));}}>{t('选中所需关联曲线')}</button>}<button onClick={()=>setPending(null)}>{t('取消')}</button></div>}
 </div>
 {sidebar&&<aside className="drawing-sidebar" data-properties-open={propertiesOpen} style={{gridTemplateRows:propertiesOpen?`minmax(100px,${panelHeight}fr) 6px minmax(80px,${100-panelHeight}fr)`:'minmax(0,1fr) 0px 32px'}}>
 {restoreLayerId&&<LayerSnapshotDialog key={projectId+restoreLayerId} layerId={restoreLayerId} close={()=>setRestoreLayerId(null)} restored={()=>{setClipboard(null);session.set({selection:{ids:[],layer:restoreLayerId},layerId:restoreLayerId,tool:'select'});setHint('');}}/>}
 <LayerPanel openProperties={()=>setPropertiesOpen(true)} closeProperties={()=>setPropertiesOpen(false)} restoreLayer={id=>{prepareSnapshotChange();setRestoreLayerId(id);}} deleteSelected={deleteSelected} cutSelected={cutSelected} pasteSelected={pasteSelected} canPaste={!!clipboard&&!!activeLayer} document={d} active={activeLayer?.id??null} selection={selection} run={run} choose={choose} setLayer={id=>{endPen();setPenPreview(null);session.set({layerId:id});}} upload={()=>file.current?.click()}/>
 <div hidden={!propertiesOpen} role="separator" aria-label={t('调整图层与属性高度')} className="drawing-sidebar-split" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.parentElement!.getBoundingClientRect();setPanelHeight(Math.max(20,Math.min(85,(e.clientY-r.top)/r.height*100)));}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/>
 <Properties open={propertiesOpen} setOpen={setPropertiesOpen} preview={setDraft} document={d} selection={selection} active={activeLayer?.id??null} run={run} choose={choose} tool={selectTool} transform={applyTransform} upload={()=>file.current?.click()} moveReference={()=>{cancelDraft();setFirst(null);endPen();setReferenceMoving(true);}}/>
 </aside>}
 </div>
 <footer className="drawing-status"><span>{t('当前绘制层')}：{activeLayer?.name??t('未选择')}　·　{selected.length} {t('条曲线')}</span><span role="status">{hint||(referenceMoving?t('拖动平移参考图'):artworkPreview?.hint)||t(endpointTools?connections:tool==='pen'?'落点并拖柄 · Enter 结束 · Esc 取消未完成段':activeTool[3])}</span><button onClick={()=>session.set({zoom:Math.max(.1,zoom/1.2)})}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>session.set({zoom:Math.min(12,zoom*1.2)})}>＋</button><button onClick={fit}>{t('适配')}</button></footer>
 </main>;
}
type DrawingCurveAlias={id:string};
