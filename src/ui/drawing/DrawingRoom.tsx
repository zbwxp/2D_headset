import {previewGestureTarget,takeGestureTarget,clearGestureTarget,runEditorHistory,consumeEditorHistoryShortcut,type GesturePreviewTarget} from './gestureTransaction';
import type {EditorHistoryContext} from '../../app/editorHistory';
import {prepareDrawingSnapshotObjectLocks} from '../../app/drawingSnapshotEdit';
import {prepareDrawingCageControlPreview} from '../../app/drawingSnapshotEdit';
import {isLayerCageDomain} from '../../domain/recordingSnapshot/layerDomains';
import {createLayerCageIntent} from '../../domain/drawing/layerDomainIntent';
import {getWorkspaceView,useWorkspaceView} from '../../app/workspaceView';
import {snapWorkspacePoint} from '../../app/workspaceViewSnap';
import ArtworkReference from '../workspaceView/ArtworkReference';
import ViewGuidesOverlay from '../workspaceView/ViewGuidesOverlay';
import {beginIntervalDrag,updateIntervalDrag,type IntervalDragState} from '../../domain/drawing/intervalDrag';
import {applyDrawingMirrorTool,DrawingMirrorAxisControls,DrawingMirrorToggle,drawingMirrorPreview,updateDrawingMirrorAxis} from './mirrorController';
import {mirrorWritesForCurves,type MirrorAuthoredWrites} from '../../domain/drawing/mirrorEditing';
import {finalizeGeometryEdit} from '../../domain/drawing/geometryEdit';
import AIGuideOverlay from './AIGuideOverlay';
import {useDrawingWorkspace} from './workspace';
import AutoHideBar from '../shared/AutoHideBar';
import {usePanelOpen} from '../shared/panelPreferences';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {PenTool,PanelRightClose,PanelRightOpen,ImagePlus,Eye,Check,X,Scissors} from 'lucide-react';
import {emptyDrawing,parseDrawing,groupFor,uid,add,sub,mul,length,curveById,shapeOf,nodeAt,members,joinAt,editable,visible,layerFor,objectById,type DrawingDocument as Doc,type Cubic,type Point2,type Endpoint} from '../../domain/drawing/model';
import * as cmd from '../../domain/drawing/commands';
import {dragNode} from '../../domain/drawing/nodeDrag';
import {deformDrawing} from '../../domain/drawing/deform';
import DeformCageOverlay from './DeformCageOverlay';
import {resolveDrawingCage,beginDrawingCageGesture,updateDrawingCageGesture,type DrawingCage as DeformCage,type CageGesture} from './cageEditorController';
import CageEditorControls from './CageEditorControls';
import {cutDrawing,pasteDrawingCut,type DrawingCut} from '../../domain/drawing/clipboard';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import {pathOf} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {selectedGroup,transformable,createGroup,ungroup,groupingIssue} from '../../domain/drawing/groups';
import {snapRecordingEndpoint} from '../../domain/recording/snapping';
import {readPhoto} from '../shared/readPhoto';
import {RECORDING_REFERENCE_IMAGE,clampReferenceOffset} from '../../domain/recording/reference';
import {uiText as t,useLanguage} from '../i18n';
import {selectedObjects,selectedLayers,type DrawingTool,type DrawingSelection} from './session';
import {captureDrawingLayerReferences,prepareDrawingLayerReferencePaste,layerClipboardProjectId,useLayerReferenceClipboard} from './layerReferenceClipboard';
import {currentDrawingPresentation,drawingSnapshotPresentation} from './snapshotPresentation';
import {commitDrawingSnapshotEdit,commitDrawingCurveSplit,prepareDrawingLayerDomainEdit,DRAWING_REFERENCE_EDIT_CAPABILITY} from './snapshotEditContext';
import {chooseDrawingSelection,selectDrawingTool,drawingToolForShortcut,isDrawingShortcutInput} from './interactionController';
import {selectCurveAtPointer,selectCurvesInBox,drawingControlDragTarget,prepareDrawingControlEditPlan,applyDrawingControlEditPlan,type DrawingControlEditPlan} from './editGestures';
import {hasNudgeTarget,nudgeSelection} from './nudge';
import LayerDomainControls from './LayerDomainControls';
import {layerSimilarityIntentForSelection,layerAffineIntentForSelection} from './layerDomainGesture';
import {layerSimilarityValue,layerDomainMatrix,createLayerAffineIntent,type LayerDomainIntent} from '../../domain/drawing/layerDomainIntent';
import type {Affine2D} from '../../domain/geometry/affine2d';
import LayerPanel from './LayerPanel';
import LayerSnapshotDialog from './LayerSnapshotDialog';
import Properties from './Properties';
import ToolBar from './ToolBar';
import {beginDrawingEllipseGesture,updateDrawingEllipseGesture,type DrawingEllipseGesture} from './ellipseController';
import SnapshotBar from './SnapshotBar';
import {usePenPreferences} from './penPreferences';
import {beginPenGesture,movePenGesture,previewPenGesture,finishPenGesture,penHoverShape,type PenState as Pen,type PenGesture} from './penController';
import {useDirectPreferences} from './directPreferences';
import {TOOLS,isEndpointTool} from './tools';
import {drawingEndpointInstruction,drawingEndpointCurveIds,pickDrawingEndpoint,drawingEndpointSelection,applyDrawingEndpointTool,commitDrawingEndpointTool,type DrawingEndpointTool,type DrawingCommandIntent} from './endpointInteraction';
import {createSnapshotRelationAuthoringIntent} from '../../domain/recordingSnapshot/relationAuthoringIntent';
import {createSnapshotNodeUnbindIntent} from '../../domain/recordingSnapshot/nodeForks';
import {linkedNodeIds,linksAtNode} from '../../domain/drawing/endpointLinks';
import PaintScene from './PaintScene';
import InkEndOverlay from './InkEndOverlay';
import DisplayIntervalOverlay from './DisplayIntervalOverlay';
import {displayPath,displayField,changeDisplayInterval,removeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {NumberField} from './Field';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
import {curvePath,selectionBounds} from './geometry';
import './drawing.css';
const EMPTY=emptyDrawing();

interface Drag extends TrackedPointer {previewTarget:GesturePreviewTarget<Doc>;controlPlan?:DrawingControlEditPlan;ellipse?:DrawingEllipseGesture;layerDomainOperationId?:string;layerDomainIntent?:LayerDomainIntent;intervalWalk?:IntervalDragState;followStrength?:number;cage?:DeformCage;cageGesture?:CageGesture;corner?:number;bendEdge?:number;bendHandle?:0|1|2;kind:'deform'|'displayInterval'|'node'|'handle'|'move'|'scale'|'rotate'|'box'|'pan'|'pen'|'ellipse'|'reference'|'mirrorAxis'|'zoom';start:Point2;client:Point2;last:{clientX:number;clientY:number};base:Doc;next?:Doc;displayInterval?:NonNullable<DrawingSelection['displayInterval']>;node?:string;endpoint?:Endpoint;ids?:string[];origin?:Point2;pan?:Point2;cursor?:Point2;pen?:Pen|null;penGesture?:PenGesture;shift?:boolean;zoom?:number;zoomMoved?:boolean}
export interface DrawingUnderlay {width:number;height:number;unit:number;pan:Point2}
/** Replace only the canvas artwork; keep the reference, viewport and editor UI mounted. */
export interface DrawingArtworkPreview {render:(view:DrawingUnderlay)=>ReactNode;hint:string;edit:()=>void}
export default function DrawingRoom({underlay,artworkPreview,aiGuides=false}:{underlay?:(view:DrawingUnderlay)=>ReactNode;artworkPreview?:DrawingArtworkPreview;aiGuides?:boolean}={}){
 const {editor:useEditor,session:useDrawing,commitDrawing,id:workspaceId}=useDrawingWorkspace();
 const zh=useLanguage(s=>s.language)==='zh';
 const rulerSpace=useWorkspaceView(s=>s.rulersVisible)?20:0;
 const project=useEditor(s=>s.project),rawStored=project.drawing??EMPTY,sourceStored=useMemo(()=>rawStored.version===3?rawStored:parseDrawing(rawStored),[rawStored]);
 const stored=useMemo(()=>currentDrawingPresentation(project,workspaceId),[project,workspaceId]),projectId=project.meta.createdAt,session=useDrawing();
 const layerReferenceClipboard=useLayerReferenceClipboard(s=>s.clipboard);
 const presentation=workspaceId==='drawing'&&project.recordingSnapshots?drawingSnapshotPresentation(project.recordingSnapshots,project.drawingSnapshots?.activeId??'$working'):undefined;
 const currentDrawing=()=>currentDrawingPresentation(useEditor.getState().project,workspaceId);
 const snapshots=useEditor(s=>s.project.drawingSnapshots),activeSnapshot=snapshots?.items.find(item=>item.id===snapshots.activeId);
 const {tool,selection,layerId,zoom,pan,preview,sidebar,width,penJoin,showFills,fillVisibility}=session;
 const panelHeight=session.panelHeight,setPanelHeight=(value:number)=>session.set({panelHeight:value});
 const viewportGesture=useRef<{zoom:number;pan:Point2;context:EditorHistoryContext}|null>(null);
 function beginViewport(){const current=useDrawing.getState();viewportGesture.current={zoom:current.zoom,pan:[...current.pan],context:useEditor.getState().captureHistoryContext()};}
 function finishViewport(){const before=viewportGesture.current;viewportGesture.current=null;if(!before)return;const current=useDrawing.getState(),after={zoom:current.zoom,pan:[...current.pan] as Point2};if(before.zoom===after.zoom&&before.pan.every((v,i)=>v===after.pan[i]))return;useEditor.getState().commitWorkspaceEdit({kind:'viewport',undo:()=>session.set({zoom:before.zoom,pan:before.pan}),redo:()=>session.set(after)},before.context);}
 function cancelViewport(){const before=viewportGesture.current;viewportGesture.current=null;if(before)session.set({zoom:before.zoom,pan:before.pan});}
 function viewportChange(change:()=>void){beginViewport();change();finishViewport();}
 const [draft,setDraft]=useState<Doc|null>(null),[hint,setHint]=useState(''),[first,setFirst]=useState<Endpoint|null>(null),[pen,setPen]=useState<Pen|null>(null),[penPreview,setPenPreview]=useState<Cubic|null>(null);
 const [pending,setPending]=useState<{ids:string[];scope:string[];mirror?:{source:string;target:string;base:Doc}}|null>(null),[referenceMoving,setReferenceMoving]=useState(false),[box,setBox]=useState<{a:Point2;b:Point2}|null>(null);
 const [zoomOut,setZoomOut]=useState(false),[axisSnap,setAxisSnap]=useState<Point2|null>(null),[nodeSnap,setNodeSnap]=useState<Point2|null>(null),[guideSnap,setGuideSnap]=useState<{point:Point2;kind:string}|null>(null);
 const [deformCage,setDeformCage]=useState<DeformCage|null>(null);
 const [propertiesOpen,setPropertiesOpen]=usePanelOpen(workspaceId+'.properties',false);
 const [restoreLayerId,setRestoreLayerId]=useState<string|null>(null);
 const [clipboard,setClipboard]=useState<DrawingCut|null>(null);
 const [busy,setBusy]=useState(false),[size,setSize]=useState({width:900,height:700});
 const penHistory=useRef(new WeakMap<Doc,Pen|null>());
 const drag=useRef<Drag|null>(null),held=useRef<{previewTarget:GesturePreviewTarget<Doc>;base:Doc;next:Doc;layerDomainIntent?:LayerDomainIntent}|null>(null),svg=useRef<SVGSVGElement>(null),host=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),own=useRef<Doc|null>(null),approved=useRef<{ids:string[];scope:string[]}|null>(null),space=useRef(false),request=useRef(0),latest=useRef<any>(null);
 // Migrate a live pre-V3 session without clearing it or creating an authoring Undo.
 useEffect(()=>{if(rawStored!==sourceStored)useEditor.getState().setDrawing(sourceStored);},[rawStored,sourceStored]);
 function endPen(){penHistory.current=new WeakMap();setPen(null);setPenPreview(null);}
 const d=draft??stored,unit=Math.min(size.width,size.height)/2.8*zoom;
 const screen=(p:Point2):Point2=>[size.width/2+pan[0]+p[0]*unit,size.height/2+pan[1]-p[1]*unit];
 const local=(e:{clientX:number;clientY:number}):Point2=>{const r=svg.current!.getBoundingClientRect();return [(e.clientX-r.left-size.width/2-pan[0])/unit,-(e.clientY-r.top-size.height/2-pan[1])/unit];};
 function guideCandidate(base:Doc,p:Point2,bypass:boolean,excluded:string[]=[]){return bypass?null:snapWorkspacePoint(base,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),p,1/unit,8,excluded);}
 const selected=selection.ids.filter(id=>d.curves.some(c=>c.id===id)),activeLayer=d.layers.find(l=>l.id===layerId)??d.layers[0],bounds=useMemo(()=>selectionBounds(d,selected),[d,selection]);
 const cage=useMemo(()=>tool==='deform'?resolveDrawingCage(stored,selection,{cached:deformCage,domains:presentation?.evaluation.state.layerDomains,canonicalId:presentation?.canonicalId,maxError:presentation?.evaluation.maxError}):null,[tool,stored,selection,deformCage]);
 const shownCurves=d.layers.flatMap(l=>l.items).filter(id=>visible(d,id));
 const activeTool=TOOLS.find(x=>x[0]===tool)!;
 const endpointTools=isEndpointTool(tool);
 const localEndpointLayer=presentation?.layerOwners.get(activeLayer?.id??'')?.kind==='snapshot-local';
 // Display and hit testing share one scope. Draft previews may move endpoints,
 // but picking still uses stored positions so the second click stays stable.
 const endpointCurveIds=(document:Doc)=>drawingEndpointCurveIds(document,activeLayer?.id??null);
 const connections=t(drawingEndpointInstruction(tool,!!first));
 function mirrorIntent(n:Doc,s:DrawingSelection):MirrorAuthoredWrites{if(s.node){const p=n.nodes.find(x=>x.id===s.node)?.position;return p?{nodes:[{nodeId:s.node,position:p}]}:{};}if(s.handle){const p=curveById(n,s.handle.curveId)?.handles[s.handle.end];return p?{handles:[{...s.handle,position:p}]}:{};}const ids=s.ids.filter(id=>curveById(n,id));return ids.length?mirrorWritesForCurves(n,ids):{};}
 const commit=(n:Doc,writes:MirrorAuthoredWrites=mirrorIntent(n,selection),editIntent?:LayerDomainIntent|DrawingCommandIntent)=>{const before=currentDrawing();if(n===before)return;n=workspaceId==='drawing'&&!editIntent?prepareDrawingCageControlPreview(useEditor.getState().project,before,n)??finalizeGeometryEdit(before,n,writes):finalizeGeometryEdit(before,n,writes);if(artworkPreview&&Object.keys(n).some(k=>k!=='reference'&&n[k as keyof Doc]!==before[k as keyof Doc]))artworkPreview.edit();if(workspaceId==='drawing'){const project=useEditor.getState().project,view=project.recordingSnapshots&&drawingSnapshotPresentation(project.recordingSnapshots,project.drawingSnapshots?.activeId??'$working'),intent=editIntent?.kind==='relation-authoring'?(view?createSnapshotRelationAuthoringIntent(view.snapshotId,before,n):undefined):editIntent?.kind==='node-unbind'?(view?createSnapshotNodeUnbindIntent(view.snapshotId,before,n,editIntent.endpoint):undefined):editIntent?.kind==='geometry-authoring'||editIntent?.kind==='mirror-authoring'?undefined:editIntent;commitDrawingSnapshotEdit(useEditor.getState(),n,intent);}else commitDrawing(n);own.current=currentDrawing();const penState=penHistory.current.get(n);if(penState!==undefined)penHistory.current.set(own.current,penState);};
 const release=(id:number)=>{if(svg.current?.hasPointerCapture(id))svg.current.releasePointerCapture(id);};
 const cancelDraft=()=>{const g=drag.current;clearGestureTarget(g?.previewTarget);clearGestureTarget(held.current?.previewTarget);if(g?.kind==='deform')setDeformCage(g.cage!);drag.current=null;held.current=null;setAxisSnap(null);setNodeSnap(null);setGuideSnap(null);setDraft(null);setBox(null);setPenPreview(null);if(g?.kind==='zoom'||g?.kind==='pan')cancelViewport();if(g)release(g.pointerId);};
 function error(e:unknown,scope=selected){if(e instanceof cmd.RelatedSelection)setPending({ids:e.ids,scope:[...scope]});else setHint(t((e as Error).message));}
 function run(fn:()=>Doc,intent?:DrawingCommandIntent){try{const n=fn();commit(n,undefined,intent);setHint('');}catch(e){error(e);}}
 function choose(next:DrawingSelection,mode?:DrawingTool){
  if(artworkPreview&&!next.reference&&(next.ids.length||next.paint||next.paintIds?.length))artworkPreview.edit();
  const transition=chooseDrawingSelection(tool,next,mode),patch={selection:transition.selection,tool:transition.tool,...(transition.layerId?{layerId:transition.layerId}:{})};
  // Switching the endpoint target layer keeps the tool. Only LINK supports a
  // cross-layer relation, so other tools restart their two-click selection.
  if(endpointTools&&next.layer){finishHeld();cancelDraft();approved.current=null;setPending(null);endPen();if(tool!=='link')setFirst(null);session.set(patch);setHint('');return;}
  finishHeld();setDeformCage(null);approved.current=null;setPending(null);setFirst(null);setReferenceMoving(false);endPen();setPenPreview(null);session.set(patch);setHint('');
 }
 function prepareSnapshotChange(){artworkPreview?.edit();finishHeld();cancelDraft();setDeformCage(null);endPen();setFirst(null);setPending(null);setReferenceMoving(false);approved.current=null;}
 function setLayerDomainEnabled(id:string,enabled:boolean){
  try{const view=useEditor.getState().project.recordingSnapshots&&drawingSnapshotPresentation(useEditor.getState().project.recordingSnapshots!,useEditor.getState().project.drawingSnapshots?.activeId??'$working'),domain=view?.evaluation.state.layerDomains?.find(domain=>domain.id===id);if(!view||!domain)return;const intent=isLayerCageDomain(domain)?createLayerCageIntent(domain.layerIds.map(view.presentationId),{kind:'h-coons',restRect:domain.restRect,quad:domain.quad,bend:domain.bend,...(domain.strokeScope?{strokeScope:{...domain.strokeScope,curveIds:domain.strokeScope.curveIds.map(view.presentationId)}}:{}),enabled},{operationId:id,replace:true}):createLayerAffineIntent(domain.layerIds.map(view.presentationId),domain.matrix,{operationId:id,replace:true,enabled}),plan=prepareDrawingLayerDomainEdit(useEditor.getState().project,intent);commit(plan.drawing,undefined,intent);setHint('');}catch(ex){error(ex);}
 }
 function groupSelection(remove=false){run(()=>{let i=1;while(d.groups?.some(g=>g.name===`${t('组合')} ${i}`))i++;const n=remove?ungroup(d,selected):createGroup(d,selected,`${t('组合')} ${i}`);const g=remove?undefined:n.groups!.at(-1);choose({ids:g?.curveIds??selected,group:g?.id},'select');return n;});}
 function selectTool(next:DrawingTool){finishHeld();setDeformCage(null);approved.current=null;cancelDraft();setFirst(null);endPen();setPending(null);setPenPreview(null);setReferenceMoving(false);setHint('');
  if(next!=='hand'&&next!=='zoom')artworkPreview?.edit();
  const owner=selected.length?layerFor(stored,selected[0])?.id:undefined;
  const transition=selectDrawingTool(next,selection);
  session.set({tool:transition.tool,selection:transition.selection,preview:transition.preview,...(isEndpointTool(next)&&owner&&selected.every(id=>layerFor(stored,id)?.id===owner)?{layerId:owner}:{}),...(next==='pen'?{penJoin:'POSITION' as const}:{})});
 }
 const scope=()=>approved.current&&selected.length===approved.current.ids.length&&selected.every(id=>approved.current!.ids.includes(id))?approved.current.scope:selected;
 const mayInclude=()=>!!approved.current&&scope()===approved.current.scope;
 function applyTransform(kind:'moveX'|'moveY'|'rotate'|'scale'|'scaleX'|'scaleY'|'mirror'|'mirrorAxis',value:number){
  const ids=scope(),b=selectionBounds(d,ids);if(!b)return;
  const center=b.center,angle=value*Math.PI/180;
  const map=(p:Point2):Point2=>kind==='scaleX'?[center[0]+(p[0]-center[0])*value,p[1]]:kind==='scaleY'?[p[0],center[1]+(p[1]-center[1])*value]:kind==='moveX'?add(p,[value,0]):kind==='moveY'?add(p,[0,value]):kind==='mirror'?[2*center[0]-p[0],p[1]]:kind==='mirrorAxis'?[2*(d.mirrorAxisX??0)-p[0],p[1]]:kind==='scale'?add(center,mul(sub(p,center),value)):(()=>{const [x,y]=sub(p,center);return add(center,[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]);})();
  try{const placement=kind==='moveX'?layerSimilarityValue([value,0]):kind==='moveY'?layerSimilarityValue([0,value]):kind==='rotate'?layerSimilarityValue([0,0],value,1,center):kind==='scale'&&value>0?layerSimilarityValue([0,0],0,value,center):undefined;const affine:Affine2D|undefined=kind==='scaleX'?[value,0,0,1,center[0]*(1-value),0]:kind==='scaleY'?[1,0,0,value,0,center[1]*(1-value)]:kind==='mirror'||kind==='mirrorAxis'?[-1,0,0,1,2*(kind==='mirror'?center[0]:(d.mirrorAxisX??0)),0]:undefined;const intent=workspaceId==='drawing'?(affine?layerAffineIntentForSelection(d,selection,affine,ids):placement?layerSimilarityIntentForSelection(d,selection,placement,ids):undefined):undefined;const n=intent?prepareDrawingLayerDomainEdit(useEditor.getState().project,intent).drawing:cmd.transform(d,ids,map,mayInclude());commit(n,mirrorWritesForCurves(n,ids),intent);setHint('');}catch(e){error(e,ids);}
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
 async function upload(e:React.ChangeEvent<HTMLInputElement>){const photo=e.target.files?.[0];e.target.value='';if(!photo)return;const ticket=++request.current,origin=useEditor.getState().project;setBusy(true);try{const reference=await readPhoto(photo,RECORDING_REFERENCE_IMAGE);if(ticket!==request.current||origin.meta.createdAt!==useEditor.getState().project.meta.createdAt)return;commit({...currentDrawing(),reference:{...reference,locked:true}});choose({ids:[],reference:true});}catch(e){error(e);}finally{setBusy(false);}}
 function pickEndpoint(p:Point2):Endpoint|null{return pickDrawingEndpoint(stored,endpointCurveIds(stored),p,unit,first);}
 function connectAt(e:Endpoint){
  if(!first){setFirst(e);session.set({selection:drawingEndpointSelection(d,e)});setHint('');return;}
  try{const n=commitDrawingEndpointTool(stored,tool as DrawingEndpointTool,first,e,(next,intent)=>commit(next,undefined,intent),()=>{setFirst(null);setDraft(null);});choose(drawingEndpointSelection(n,e),tool);}catch(ex){error(ex);}
 }
 const penOptions=()=>({layerId:activeLayer?.id??null,unit,width,join:penJoin,taperScale:usePenPreferences.getState().taperScale});
 function startDrag(e:React.PointerEvent,kind:Drag['kind'],extra:Partial<Drag>={}){
  if(drag.current||e.button!==0&&kind!=='pan'&&kind!=='zoom')return;e.preventDefault();e.stopPropagation();svg.current!.focus({preventScroll:true});
  const base=currentDrawing();if(kind==='pan'||kind==='zoom')beginViewport();
  drag.current={kind,previewTarget:{},...(['move','rotate','scale','deform'].includes(kind)?{layerDomainOperationId:uid()}:{}),start:local(e),client:[e.clientX,e.clientY],last:{clientX:e.clientX,clientY:e.clientY},base,pointerId:e.pointerId,button:e.button,pointerType:e.pointerType,followStrength:tool==='direct'?useDirectPreferences.getState().followPercent/100:0,...extra};if(kind==='node'&&drag.current.node)drag.current.controlPlan=prepareDrawingControlEditPlan(base,{kind:'node',nodeId:drag.current.node,followStrength:drag.current.followStrength});else if(kind==='handle'&&drag.current.endpoint)drag.current.controlPlan=prepareDrawingControlEditPlan(base,{kind:'handle',endpoint:drag.current.endpoint});else if(['move','rotate','scale'].includes(kind)&&drag.current.ids)drag.current.controlPlan=prepareDrawingControlEditPlan(base,{kind:'curves',curveIds:drag.current.ids});if(kind==='pen'&&drag.current.penGesture)drag.current.penGesture={...drag.current.penGesture,base};if(kind==='displayInterval'){const grip=drag.current.displayInterval!,track=base.displayIntervals!.find(t=>t.id===grip.track)!,range=track.ranges.find(r=>r.id===grip.range)!;drag.current.intervalWalk=beginIntervalDrag(displayField(base,displayPath(base,track.anchor.id)),track,range,grip.end,local(e),1/unit);}setHint('');
  try{svg.current!.setPointerCapture(e.pointerId);}catch{/* Window tracking remains active if native capture is unavailable. */}
 }
 function axisDown(e:React.PointerEvent){
  if(space.current||referenceMoving||tool==='hand'||tool==='zoom'||tool==='deform'||e.button!==0)return;
  setPending(null);session.set({selection:{ids:[],mirrorAxis:true}});startDrag(e,'mirrorAxis');
 }
 function curveDown(e:React.PointerEvent,id:string){
  if(referenceMoving||space.current||e.button===1||e.button===2||tool==='hand')return;
  if(['pen','ellipse','zoom'].includes(tool)||endpointTools)return;
  if(tool==='split'){e.stopPropagation();const hit=snapRecordingEndpoint(local(e),[{id,name:'',shape:shapeOf(d,id),auxiliary:false}],[unit,unit]);if(hit)try{if(workspaceId==='drawing'){const plan=commitDrawingCurveSplit(useEditor.getState(),id,hit.t);own.current=currentDrawing();choose({ids:plan.ids},'direct');setHint([...(plan.diagnostics?.map(value=>value.message)??[]),...(plan.intent.kind==='split-curve'&&plan.intent.correspondenceNotice?[plan.intent.correspondenceNotice]:[])].join(' '));}else run(()=>{const n=cmd.splitCurve(stored,id,hit.t);choose({ids:n.ids},'direct');return n.document;});}catch(errorValue){error(errorValue);}return;}
  if(tool==='mirror'){e.stopPropagation();if(!first){setFirst({curveId:id,end:0});setHint(t('请选择目标曲线'));}else try{const n=applyDrawingMirrorTool(stored,first.curveId,id);commit(n);setFirst(null);choose({ids:[id]},'direct');}catch(ex){if(ex instanceof cmd.RelatedSelection)setPending({ids:ex.ids,scope:[id],mirror:{source:first.curveId,target:id,base:stored}});else error(ex,[id]);}return;}
  if(!editable(d,id))return;
  const ids=selectCurveAtPointer(d,selected,id,{grouped:tool==='select'||tool==='deform',shift:e.shiftKey});
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
  if(tool==='pen'){if(!activeLayer){setHint(t('请先新建绘制层。'));return;}const hit=guideCandidate(stored,local(e),e.altKey),p=hit?.point??local(e);setGuideSnap(hit);startDrag(e,'pen',{pen,start:p,cursor:p,origin:local(e),penGesture:beginPenGesture(stored,pen,p,local(e))});return;}
  if(tool==='ellipse'){try{startDrag(e,'ellipse',{ellipse:beginDrawingEllipseGesture(stored,activeLayer?.id??null,local(e),width)});}catch(ex){error(ex);}return;}
  if(tool==='select'||tool==='direct'){if(!e.shiftKey)choose({ids:[]},tool);startDrag(e,'box',{shift:e.shiftKey});}
 }
 function fit(){viewportChange(fitViewport);}
 function fitViewport(){const b=selectionBounds(d,shownCurves);if(!b){session.set({zoom:1,pan:[0,0]});return;}const base=Math.min(size.width,size.height)/2.8,z=Math.max(.1,Math.min(8,Math.min((size.width-100)/Math.max(.1,b.max[0]-b.min[0]),(size.height-100)/Math.max(.1,b.max[1]-b.min[1]))/base));session.set({zoom:z,pan:[-b.center[0]*base*z,b.center[1]*base*z]});}
 function zoomAt(e:{clientX:number;clientY:number},value:number){const z=Math.max(.1,Math.min(12,value)),p=local(e),r=svg.current!.getBoundingClientRect(),u=unit*z/zoom;session.set({zoom:z,pan:[e.clientX-r.left-size.width/2-p[0]*u,e.clientY-r.top-size.height/2+p[1]*u]});}
 function move(e:React.PointerEvent|PointerEvent){
  let p=local(e);const g=drag.current;if(!g&&tool==='pen'){const hit=guideCandidate(stored,p,e.altKey);setGuideSnap(hit);if(hit)p=hit.point;}
  if(g){if(e.pointerId!==g.pointerId)return;g.last={clientX:e.clientX,clientY:e.clientY};}
  if(!g){if(artworkPreview)return;if(tool==='pen'&&pen)setPenPreview(penHoverShape(pen,p,penJoin));
   if(first&&endpointTools&&tool!=='merge'){const target=pickEndpoint(p);if(target)try{setDraft(finalizeGeometryEdit(stored,applyDrawingEndpointTool(stored,tool as DrawingEndpointTool,first,target)));}catch{setDraft(null);}else setDraft(null);}return;}
  if(g.kind==='zoom'){
   const dy=g.client[1]-e.clientY;if(!g.zoomMoved&&Math.abs(dy)<2)return;g.zoomMoved=true;
   const z=Math.max(.1,Math.min(12,g.zoom!*Math.exp(dy*.008))),r=svg.current!.getBoundingClientRect(),u=Math.min(size.width,size.height)/2.8*z;
   session.set({zoom:z,pan:[g.client[0]-r.left-size.width/2-g.start[0]*u,g.client[1]-r.top-size.height/2+g.start[1]*u]});return;
  }
  const delta=sub(p,g.start);if(length(delta)*unit<.4&&!g.next&&g.kind!=='pen')return;
  try{
   if(g.kind==='pan'){session.set({pan:add(g.pan!,[e.clientX-g.client[0],e.clientY-g.client[1]])});return;}
   if(g.kind==='box'){setBox({a:g.start,b:p});return;}
   if(g.kind==='pen'){g.penGesture=movePenGesture(g.penGesture!,p);g.cursor=g.penGesture.cursor;const n=previewPenGesture(g.penGesture,penOptions());if(n){g.next=n.document;setDraft(n.document);}setPenPreview(null);return;}
   previewGestureTarget(g.previewTarget,()=>{
   if(g.kind==='ellipse'){const n=updateDrawingEllipseGesture(g.ellipse!,p,e.shiftKey);g.next=n.document;}
   if(g.kind==='mirrorAxis'){
    const nodeIds=new Set(g.base.curves.filter(c=>visible(g.base,c.id)).flatMap(c=>c.nodes));
    const targets=g.base.nodes.filter(n=>{if(!nodeIds.has(n.id))return false;const [x,y]=screen(n.position);return x>=0&&x<=size.width&&y>=0&&y<=size.height;});
    const next=updateDrawingMirrorAxis(g.base,g.start,p,unit,targets);setAxisSnap(next.snap);g.next=next.drawing;
   }
   if(g.kind==='node'){
    let position=drawingControlDragTarget(g.base,{nodeId:g.node!},g.start,p);
    const visibleIds=new Set(g.base.curves.filter(c=>visible(g.base,c.id)).flatMap(c=>c.nodes));
    const coupled=linkedNodeIds(g.base,g.node!);const target=g.base.nodes.filter(n=>!coupled.has(n.id)&&visibleIds.has(n.id)).map(n=>({n,distance:length(sub(n.position,position))*unit})).filter(x=>x.distance<=9).sort((a,b)=>a.distance-b.distance)[0]?.n;
    const axis=g.base.mirrorAxisX??0,guide=guideCandidate(g.base,position,e.altKey,g.base.curves.filter(c=>c.nodes.some(n=>coupled.has(n))).map(c=>c.id)),snapped=e.altKey?null:guide?.point??target?.position??(Math.abs(position[0]-axis)*unit<=8?[axis,position[1]] as Point2:null);
    if(snapped)position=[snapped[0],snapped[1]];g.next=applyDrawingControlEditPlan(g.controlPlan!,{kind:'point',position});const actual=g.next.nodes.find(n=>n.id===g.node)!.position,kept=snapped&&Math.hypot(actual[0]-snapped[0],actual[1]-snapped[1])<1e-10;setNodeSnap(kept&&!guide?snapped:null);setGuideSnap(kept&&guide?guide:null);
   }
   if(g.kind==='displayInterval'){
    const grip=g.displayInterval!,result=updateIntervalDrag(g.intervalWalk!,p);g.intervalWalk=result.state;if(Object.keys(result.change).length)g.next=changeDisplayInterval(g.base,grip.track,grip.range,result.change);
   }
   if(g.kind==='handle'){const target=drawingControlDragTarget(g.base,{handle:g.endpoint!},g.start,p),hit=guideCandidate(g.base,target,e.altKey,[g.endpoint!.curveId]);g.next=applyDrawingControlEditPlan(g.controlPlan!,{kind:'point',position:hit?.point??target});setGuideSnap(hit);}
   if(g.kind==='deform'){
    const original=g.cage!,gesture=g.cageGesture??=beginDrawingCageGesture(original,selection,g.corner!==undefined?{corner:g.corner}:{edge:g.bendEdge!,handle:g.bendHandle!},g.start,g.layerDomainOperationId),update=updateDrawingCageGesture(gesture,p),{quad,bend}=update.cage;
    const explicit=workspaceId==='drawing'?update.intent:undefined;
    const referenced=explicit?.scope.layerIds.filter(id=>presentation?.layerOwners.get(id)?.kind==='snapshot-local'||original.ids.some(curveId=>presentation?.drawing.layers.find(layer=>layer.id===id)?.items.includes(curveId)&&presentation?.objectOwners.get(curveId)?.kind==='snapshot-local'))??[];
    if(explicit&&referenced.length){if(referenced.length!==explicit.scope.layerIds.length)throw Error('Select referenced layers together for a retained cage; source-owned cages edit their original geometry.');g.layerDomainIntent=explicit;const plan=prepareDrawingLayerDomainEdit(useEditor.getState().project,explicit);g.next=plan.drawing;setDeformCage({...original,quad,bend,domainOperationId:explicit.operationId,maxError:drawingSnapshotPresentation(plan.project.recordingSnapshots!,plan.project.drawingSnapshots?.activeId??'$working')!.evaluation.maxError});}
    else{const result=deformDrawing(original.base,original.ids,original.rect,quad,!!approved.current,bend);g.next=result.document;setDeformCage({...original,quad,bend,maxError:result.maxError});}setHint('');
   }
   if(g.kind==='move'){g.layerDomainIntent=workspaceId==='drawing'?layerSimilarityIntentForSelection(g.base,selection,layerSimilarityValue(delta),g.ids,g.layerDomainOperationId):undefined;g.next=g.layerDomainIntent?prepareDrawingLayerDomainEdit(useEditor.getState().project,g.layerDomainIntent).drawing:applyDrawingControlEditPlan(g.controlPlan!,{kind:'map',map:x=>add(x,delta),allowRelated:!!approved.current});}
   if(g.kind==='rotate'){const o=g.origin!,angle=Math.atan2(p[1]-o[1],p[0]-o[0])-Math.atan2(g.start[1]-o[1],g.start[0]-o[0]),a=e.shiftKey?Math.round(angle/(Math.PI/12))*Math.PI/12:angle;g.layerDomainIntent=workspaceId==='drawing'?layerSimilarityIntentForSelection(g.base,selection,layerSimilarityValue([0,0],a*180/Math.PI,1,o),g.ids,g.layerDomainOperationId):undefined;g.next=g.layerDomainIntent?prepareDrawingLayerDomainEdit(useEditor.getState().project,g.layerDomainIntent).drawing:applyDrawingControlEditPlan(g.controlPlan!,{kind:'map',map:x=>{const v=sub(x,o);return add(o,[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)]);},allowRelated:!!approved.current});}
   if(g.kind==='scale'){
    const o=g.origin!,start=sub(g.start,o),now=sub(p,o),referenced=workspaceId==='drawing'&&selectedLayers(selection).some(id=>presentation?.layerOwners.get(id)?.kind==='snapshot-local'),safe=(v:number)=>referenced?v:Math.abs(v)<.01?(v<0?-.01:.01):v;
    let sx=safe(Math.abs(start[0])<1e-9?1:now[0]/start[0]),sy=safe(Math.abs(start[1])<1e-9?1:now[1]/start[1]);if(e.shiftKey)sy=sx;
    const matrix:Affine2D=[sx,0,0,sy,o[0]*(1-sx),o[1]*(1-sy)];
    g.layerDomainIntent=workspaceId==='drawing'?layerAffineIntentForSelection(g.base,selection,matrix,g.ids,g.layerDomainOperationId):undefined;
    g.next=g.layerDomainIntent?prepareDrawingLayerDomainEdit(useEditor.getState().project,g.layerDomainIntent).drawing:applyDrawingControlEditPlan(g.controlPlan!,{kind:'map',map:x=>{const v=sub(x,o);return add(o,[v[0]*sx,v[1]*sy]);},allowRelated:!!approved.current});
   }
   if(g.kind==='reference'&&g.base.reference){const ref=g.base.reference;g.next={...g.base,reference:{...ref,offset:add(ref.offset,delta).map(clampReferenceOffset) as Point2}};}
   if(g.next){const writes=g.kind==='node'?mirrorIntent(g.next,{ids:[],node:g.node}):g.kind==='handle'?mirrorIntent(g.next,{ids:[],handle:g.endpoint}):g.ids?mirrorWritesForCurves(g.next,g.ids):{};g.next=workspaceId==='drawing'&&!g.layerDomainIntent?prepareDrawingCageControlPreview(useEditor.getState().project,g.base,g.next)??finalizeGeometryEdit(g.base,g.next,writes):finalizeGeometryEdit(g.base,g.next,writes);if(g.kind==='handle'){const actual=curveById(g.next,g.endpoint!.curveId).handles[g.endpoint!.end];setGuideSnap(hit=>hit&&Math.hypot(hit.point[0]-actual[0],hit.point[1]-actual[1])<1e-10?hit:null);}}
   return g.next;},next=>{if(!next){g.next=undefined;g.layerDomainIntent=undefined;if(g.kind==='deform')setDeformCage(g.cage??null);setNodeSnap(null);setGuideSnap(null);}setDraft(next);});
  }catch(ex){if(ex instanceof cmd.RelatedSelection){cancelDraft();error(ex,g.ids);}else setHint(t((ex as Error).message));}
 }
 function up(e?:PointerEvent|MouseEvent,interrupted=false){
  const g=drag.current;if(!g)return;if(interrupted){cancelDraft();return;}
  drag.current=null;setAxisSnap(null);setNodeSnap(null);setGuideSnap(null);setDraft(null);setBox(null);
  release(g.pointerId);
  if(currentDrawing()!==g.base){cancelViewport();setPenPreview(null);return;}
  try{
   if(g.kind==='zoom'||g.kind==='pan'){if(g.kind==='zoom'&&!g.zoomMoved&&!interrupted&&e)zoomAt(e,g.zoom!*((e.ctrlKey||e.altKey)?1/1.3:1.3));interrupted?cancelViewport():finishViewport();return;}
   if(g.kind==='pen'){
    const result=finishPenGesture(g.penGesture!,penOptions()),n=result.candidate;
    if(!g.pen){penHistory.current=new WeakMap([[g.base,result.state]]);setPen(result.state);}
    else if(n){penHistory.current.set(g.base,g.pen);penHistory.current.set(n.document,result.state);commit(n.document);setPen(result.state);session.set({selection:{ids:[n.next.last!]}});setPenPreview(null);}
   }else if(g.kind==='box'){
    const ids=selectCurvesInBox(d,shownCurves,g.start,local(e??g.last),{grouped:tool==='select',previousIds:g.shift?selected:[]});choose({ids},tool);
   }else {const next=takeGestureTarget(g.previewTarget);if(!next)return;commit(next,undefined,g.kind==='displayInterval'?{kind:'relation-authoring'}:g.layerDomainIntent);if(g.kind==='deform')setDeformCage(c=>c?{...c,committed:currentDrawing()}:c);if(g.kind==='ellipse'){const ids=next.curves.filter(c=>!g.base.curves.some(x=>x.id===c.id)).map(c=>c.id);choose({ids},'select');}}
  }catch(ex){error(ex);}
  if(interrupted&&g.next)setHint(t('拖动已中断，已保留最后有效位置。'));
 }
 function deleteSelected(){
  const layers=selectedLayers(selection);if(layers.length){run(()=>{const n=cmd.deleteLayers(d,layers);choose({ids:[]});return n;});return;}
  if(selection.displayInterval){const r=selection.displayInterval;run(()=>{const n=removeDisplayInterval(d,r.track,r.range);choose({ids:selected});return n;},{kind:'relation-authoring'});return;}
  const ids=selectedObjects(selection);if(!ids.length)return;
  run(()=>{const n=cmd.deleteObjects(d,ids);choose({ids:[]});return n;});
 }
 function cutSelected(){
  if(drag.current)return;finishHeld();
  if(workspaceId==='drawing'&&selectedLayers(selection).length){takeLayerReference(selectedLayers(selection));return;}
  try{const result=cutDrawing(currentDrawing(),selectedObjects(selection));if(!result)return;
   choose({ids:[]},'select');commit(result.document);setClipboard(result.clipboard);if(workspaceId==='drawing')useLayerReferenceClipboard.getState().clear();setHint(t('已剪切；选择目标图层后按 Ctrl/Cmd+V 原位粘贴。'));
  }catch(ex){error(ex);}
 }
 function takeLayerReference(layerIds:readonly string[]){
  if(workspaceId!=='drawing'||drag.current||!layerIds.length)return;finishHeld();
  try{
   const project=useEditor.getState().project,artworkId=project.drawingSnapshots?.activeId??'$working';
   useLayerReferenceClipboard.getState().capture(captureDrawingLayerReferences(project,artworkId,layerIds,'reference',layerClipboardProjectId()));
   setClipboard(null);
   setHint(zh?'已提取图层引用；原图层保留，粘贴时保持实时关联。':'Layer reference captured; the original stays in place and pasted layers stay live.');
  }catch(ex){error(ex);}
 }
 function pasteSelected(){
  if(drag.current)return;finishHeld();
  const reference=workspaceId==='drawing'?useLayerReferenceClipboard.getState().clipboard:null;
  if(reference){try{const editor=useEditor.getState(),plan=prepareDrawingLayerReferencePaste(editor.project,reference,layerClipboardProjectId());if(plan.changed)editor.commitRecordingSnapshots(plan.workspace);const drawing=currentDrawing(),ids=drawing.layers.filter(layer=>plan.layerIds.includes(layer.id)).flatMap(layer=>layer.items);choose({ids:ids.filter(id=>!!curveById(drawing,id)),paintIds:ids.filter(id=>!curveById(drawing,id)),layers:plan.layerIds,layer:plan.layerIds.length===1?plan.layerIds[0]:undefined},'select');if(plan.layerIds[0])session.set({layerId:plan.layerIds[0]});setHint(zh?'已粘贴实时图层引用；源画稿保持独立。':'Live layer references pasted; source artwork stays independent.');}catch(ex){error(ex);}return;}
  if(!clipboard)return;
  try{if(!activeLayer)throw Error('请先选择粘贴目标图层。');const next=pasteDrawingCut(currentDrawing(),clipboard,activeLayer.id);
   const ids=clipboard.items.filter(id=>curveById(next,id)),paintIds=clipboard.items.filter(id=>!curveById(next,id));
   choose({ids,paintIds,paint:!ids.length&&paintIds.length===1?paintIds[0]:undefined,group:selectedGroup(next,ids)?.id,layer:activeLayer.id},'select');commit(next);setHint(t('已原位粘贴到当前图层。'));
  }catch(ex){error(ex);}
 }
 function finishHeld(){
  const k=held.current;if(!k)return;const target=takeGestureTarget(k.previewTarget);held.current=null;setDraft(null);if(!target)return;
  if(currentDrawing()===k.base){
   const prior=penHistory.current.get(k.base);
   if(useDrawing.getState().tool==='pen'&&prior?.last&&curveById(k.next,prior.last)){
    const next={...prior,position:nodeAt(k.next,{curveId:prior.last,end:1}).position};penHistory.current.set(k.next,next);setPen(next);setPenPreview(null);
   }
   try{commit(target,undefined,k.layerDomainIntent);}catch(ex){error(ex);}
  }
 }
 function history(redo=false){
  const editor=useEditor.getState();runEditorHistory(redo,{activeGesture:!!(drag.current||held.current),pendingAnchor:tool==='pen'&&!!pen&&!pen.last,cancelGesture:cancelDraft,cancelAnchor:()=>{setPen(null);setPenPreview(null);},undo:editor.undo,redo:editor.redo});
 }
 latest.current={d,selected,selection,tool,run,choose,selectTool,cancelDraft,commit,applyTransform,scope,mayInclude,groupSelection,deleteSelected,cutSelected,pasteSelected,clipboard:clipboard||(workspaceId==='drawing'&&layerReferenceClipboard),history};
 useEffect(()=>{const cancel=()=>latest.current.cancelDraft();window.addEventListener('contour:cancel-recording-gesture',cancel);return()=>window.removeEventListener('contour:cancel-recording-gesture',cancel);},[]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   setZoomOut(e.ctrlKey||e.altKey);
   if(isDrawingShortcutInput(e.target))return;
   // Menu navigation belongs to the tool group, never to selected geometry.
   if(document.querySelector('.drawing-tool-menu')||(e.key==='ArrowDown'&&(e.target as Element).closest('[data-tool-group="connections"]')))return;
   const s=latest.current;if(e.code==='Space'){e.preventDefault();space.current=true;return;}
   if(e.key==='Escape'){e.preventDefault();s.cancelDraft();setFirst(null);endPen();setPenPreview(null);setPending(null);setReferenceMoving(false);return;}
   if(consumeEditorHistoryShortcut(e,redo=>s.history(redo)))return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='x'&&(selectedObjects(s.selection).length||selectedLayers(s.selection).length)){e.preventDefault();e.stopImmediatePropagation();s.cutSelected();return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'&&s.clipboard){e.preventDefault();e.stopImmediatePropagation();s.pasteSelected();return;}
   if(e.key==='Enter'&&s.tool==='pen'){endPen();setPenPreview(null);return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();const list=!!(e.target as Element).closest('.drawing-layers');s.choose({ids:s.d.curves.filter((c:DrawingCurveAlias)=>list||editable(s.d,c.id)).map((c:DrawingCurveAlias)=>c.id),...(list?{paintIds:[...s.d.fills,...s.d.offsets].map((o:{id:string})=>o.id)}:{})},'select');return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){e.preventDefault();s.groupSelection(e.shiftKey);return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();s.run(()=>{const n=cmd.duplicateCurves(s.d,s.selected,undefined,[0,0]);s.choose({ids:n.ids,group:selectedGroup(n.document,n.ids)?.id},'select');return n.document;});return;}
   if(['Delete','Backspace'].includes(e.key)){e.preventDefault();s.deleteSelected();return;}
   if(e.key.startsWith('Arrow')&&hasNudgeTarget(s.selection)){
    e.preventDefault();e.stopImmediatePropagation();if(drag.current||e.ctrlKey||e.metaKey)return;
    const amount=.004*(e.shiftKey?5:e.altKey?0.2:1),delta:Point2=[e.key==='ArrowRight'?amount:e.key==='ArrowLeft'?-amount:0,e.key==='ArrowUp'?amount:e.key==='ArrowDown'?-amount:0],base=held.current?.next??s.d;
    try{const previewTarget=held.current?.previewTarget??{};previewGestureTarget(previewTarget,()=>{const prior=held.current?.layerDomainIntent?layerDomainMatrix(held.current.layerDomainIntent).slice(4) as Point2:[0,0] as Point2,intent=workspaceId==='drawing'?layerSimilarityIntentForSelection(held.current?.base??base,s.selection,layerSimilarityValue(add(prior,delta)),undefined,held.current?.layerDomainIntent?.operationId):undefined,raw=intent?prepareDrawingLayerDomainEdit(useEditor.getState().project,intent).drawing:nudgeSelection(base,s.selection,delta),n=finalizeGeometryEdit(base,raw,mirrorIntent(raw,s.selection));if(!held.current)held.current={base,next:n,layerDomainIntent:intent,previewTarget};else {held.current.next=n;held.current.layerDomainIntent=intent;}return n;},next=>{if(!next)held.current=null;setDraft(next);});setHint('');}catch(ex){held.current=null;setDraft(null);setHint(t((ex as Error).message));}return;
   }
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   const nextTool=drawingToolForShortcut(e);if(nextTool){e.preventDefault();s.selectTool(nextTool);}
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
 {tool==='deform'&&<CageEditorControls maxError={cage?.maxError??0} onResetFrame={()=>{cancelDraft();setDeformCage(null);}} onDone={()=>selectTool('select')}/>}
 {tool==='mirror'&&<><DrawingMirrorAxisControls drawing={d} run={run}/></>}
 {tool==='pen'&&<label className="drawing-field">{t('继续接笔')}<select aria-label={t('继续接笔')} value={penJoin} onChange={e=>session.set({penJoin:e.target.value as 'POSITION'|'SMOOTH'|'CUSP'})}><option value="POSITION">{t('仅绑定')}</option><option value="SMOOTH">{t('平滑接笔')}</option><option value="CUSP">{t('尖点接笔')}</option></select></label>}
 {tool==='pen'&&<button onClick={()=>{cancelDraft();endPen();setPenPreview(null);}}><Check size={14}/>{t('结束绘制')}</button>}
 {(endpointTools||tool==='mirror')&&<><span className="drawing-step">{tool==='mirror'?t(first?'选择目标：仅摆到镜像位置，不自动配对':'选择镜像摆放的源曲线'):connections}</span><button onClick={()=>{setFirst(null);setDraft(null);}}>{t('取消')}</button></>}
 {endpointTools&&localEndpointLayer&&tool!=='link'&&<><span className="drawing-step">{t('引用层可用端点联动，保留各自节点和外观。')}</span><button data-testid="drawing-reference-endpoint-link" onClick={()=>selectTool('link')}>{t('端点联动')}</button></>}

 <div className="drawing-options-right"><DrawingMirrorToggle drawing={d} run={run}/><button disabled={busy} onClick={()=>file.current?.click()}><ImagePlus size={15}/>{t('参考图')}</button><button aria-pressed={preview} onClick={()=>{cancelDraft();setFirst(null);endPen();session.set({preview:!preview});}}><Eye size={15}/>{t('隐藏编辑辅助')}</button><button aria-label={t(sidebar?'收起右栏':'展开右栏')} onClick={()=>session.set({sidebar:!sidebar})}>{sidebar?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}</button></div>
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
 <svg ref={svg} width="100%" height="100%" tabIndex={0} data-testid="drawing-canvas" aria-label={t('绘制画布')} onContextMenu={e=>e.preventDefault()} onPointerDown={down} onPointerEnter={e=>setZoomOut(e.ctrlKey||e.altKey)} onPointerMove={e=>{setZoomOut(e.ctrlKey||e.altKey);if(!drag.current)move(e);}} onWheel={e=>{if(!drag.current)viewportChange(()=>zoomAt(e,zoom*Math.exp(-e.deltaY*.001)));}}>
 {ref?.visible&&<image data-testid="drawing-reference" href={ref.dataUrl} width={refSize[0]} height={refSize[1]} x={-refSize[0]/2} y={-refSize[1]/2} opacity={ref.opacity} transform={`translate(${screen(ref.offset)}) rotate(${ref.rotation})`} pointerEvents="none"/>}
 <ArtworkReference screen={screen} unit={unit}/>
 {underlay?.({...size,unit,pan})}
 {/* The wide guide hit target sits behind geometry, so curve/point picking wins. */}
 {!preview&&!artworkPreview&&<line data-testid="drawing-mirror-drag" x1={screen([d.mirrorAxisX??0,0])[0]} x2={screen([d.mirrorAxisX??0,0])[0]} y1={0} y2={size.height} stroke="transparent" strokeWidth="8" pointerEvents={!referenceMoving&&['select','direct','mirror'].includes(tool)?'stroke':'none'} style={{cursor:'ew-resize'}} onPointerDown={axisDown}/>}
 {artworkPreview?artworkPreview.render({...size,unit,pan}):<PaintScene d={d} screen={screen} unit={unit} preview={preview} showFills={showFills} fillVisibility={fillVisibility} referenceMoving={referenceMoving} tool={tool} selectedPaint={selection.paint} selectedPaints={selection.paintIds} curveDown={curveDown} paintDown={paintDown} arcDown={arcDown}/>}
 {aiGuides&&<AIGuideOverlay d={d} curveIds={[...selected,...(selection.handle?[selection.handle.curveId]:[])]} screen={screen} unit={unit} width={size.width} height={size.height}/>}
 {!preview&&!artworkPreview&&<g data-testid="drawing-mirror-guide">
  <line data-testid="drawing-mirror-axis" x1={screen([d.mirrorAxisX??0,0])[0]} x2={screen([d.mirrorAxisX??0,0])[0]} y1={0} y2={size.height} stroke={axisSnap?'#209978':selection.mirrorAxis?'#2589b0':'#d18d36'} strokeWidth="1.3" strokeDasharray="7 5" pointerEvents="none"/>
  <rect data-testid="drawing-mirror-grip" x={screen([d.mirrorAxisX??0,0])[0]-10} y={5+rulerSpace} width={20} height={16} rx={3} fill={selection.mirrorAxis?'#d8f1fc':'#fff6df'} stroke="#d18d36" pointerEvents={!referenceMoving&&tool!=='hand'&&tool!=='zoom'&&tool!=='deform'?'all':'none'} style={{cursor:'ew-resize'}} onPointerDown={axisDown}><title>{t('拖动镜像轴，靠近端点时吸附')}</title></rect>
  <path d={`M ${screen([d.mirrorAxisX??0,0])[0]-5} ${10+rulerSpace} v 6 M ${screen([d.mirrorAxisX??0,0])[0]} ${10+rulerSpace} v 6 M ${screen([d.mirrorAxisX??0,0])[0]+5} ${10+rulerSpace} v 6`} stroke="#b07e32" pointerEvents="none"/>
  <text x={screen([d.mirrorAxisX??0,0])[0]+15} y={18+rulerSpace} fill="#aa742d" fontSize="12" pointerEvents="none">{t('镜像轴 · 拖动吸附端点')}</text>
  {axisSnap&&<g data-testid="drawing-mirror-snap" pointerEvents="none"><circle cx={screen(axisSnap)[0]} cy={screen(axisSnap)[1]} r={7} fill="#d7f5e9" stroke="#209978" strokeWidth="2"/><text x={screen(axisSnap)[0]+12} y={screen(axisSnap)[1]-10} fill="#168065" fontSize="12">{t('已吸附端点')}</text></g>}
 </g>}
 {!preview&&!artworkPreview&&!referenceMoving&&<>
 {tool==='mirror'&&first&&curveById(d,first.curveId)&&<path data-testid="drawing-mirror-preview" d={curvePath(drawingMirrorPreview(d,first.curveId),screen)} fill="none" stroke="#d18d36" strokeWidth="1.7" strokeDasharray="5 4" pointerEvents="none"/>}
 {(tool==='direct'||tool==='select')&&<InkEndOverlay d={d} selection={selection} screen={screen} pick={(e,id,end)=>{if(space.current||e.button!==0)return;e.stopPropagation();svg.current?.focus({preventScroll:true});choose(curveById(d,id)?{ids:[id],inkEnd:{id,end}}:{ids:[],paint:id,inkEnd:{id,end}},'direct');}}/>}
 {d.joins.filter(j=>j.mode==='ARC'&&[j.a,j.b].some(e=>selected.includes(e.curveId)&&visible(d,e.curveId))).map(j=>{const g=roundedJoins(d).get(j.id)!,p=screen(nodeAt(d,j.a).position);return <g key={j.id} pointerEvents="none" data-testid="drawing-arc-guide"><circle cx={p[0]} cy={p[1]} r={g.distance*unit} stroke="#c9a060" strokeWidth="1" strokeDasharray="3 4" fill="none"/><path d={pathOf(g.shapes,screen)} stroke="#228fbe" strokeWidth="1.5" fill="none"/></g>;})}
 {nodeSnap&&<g data-testid="drawing-node-snap" pointerEvents="none"><circle cx={screen(nodeSnap)[0]} cy={screen(nodeSnap)[1]} r={9} fill="none" stroke="#209978" strokeWidth="2"/><text x={screen(nodeSnap)[0]+13} y={screen(nodeSnap)[1]-12} fill="#168065" fontSize="12">{t(nodeSnap[0]===(d.mirrorAxisX??0)?'已吸附镜像轴':'已吸附端点')}</text></g>}
 {selected.filter(id=>visible(d,id)).map(id=><path key={id} data-testid="drawing-selected" data-id={id} d={curvePath(shapeOf(d,id),screen)} fill="none" stroke="#228fbe" strokeWidth="1.4" strokeDasharray={d.joins.some(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id))?'3 4':undefined} opacity={selection.displayInterval||(d.displayIntervals?.length&&strokeFor(d,id).segments.some(x=>d.displayIntervals!.some(t=>x.id===t.anchor.id)))||d.joins.some(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id))?.25:1} pointerEvents="none"/>)}
 {(tool==='direct'||endpointTools)&&<g pointerEvents="none" data-testid="drawing-endpoint-link-guides">{nodes.filter(id=>linksAtNode(d,id).length).map(id=>{const p=screen(d.nodes.find(n=>n.id===id)!.position);return <circle key={id} cx={p[0]} cy={p[1]} r={9} stroke="#a279bb" strokeWidth="1.5" fill="none"><title>{t('端点联动')}</title></circle>;})}</g>}
 {(tool==='direct'||endpointTools)&&<g>{tool==='direct'&&selected.filter(id=>editable(d,id)).map(id=>{const s=shapeOf(d,id).map(screen);return <g key={id}><path d={`M ${s[0]} L ${s[1]} M ${s[3]} L ${s[2]}`} stroke="#298eb3" strokeWidth="1" fill="none" pointerEvents="none"/>{([0,1] as const).filter(end=>activeHandle?.curveId!==id||activeHandle.end!==end).map(end=>handleControl(id,end))}</g>;})}
 {nodes.filter(id=>members(d,id).some(e=>editable(d,e.curveId))).map(id=>{const node=d.nodes.find(n=>n.id===id)!,p=screen(node.position),member=members(d,id).find(e=>controls.includes(e.curveId))!;return <rect key={id} data-testid="drawing-node" data-node={id} x={p[0]-4} y={p[1]-4} width="8" height="8" fill={first&&curveById(d,first.curveId)&&nodeAt(d,first).id===id?'#dc9840':selection.node===id?'#248ec1':'#fff'} stroke="#248ec1" strokeWidth="1.4" pointerEvents={endpointTools?'none':'all'} onPointerDown={e=>{session.set({selection:{ids:[member.curveId],node:id}});startDrag(e,'node',{node:id});}}/>;})}
 {tool==='direct'&&activeHandle&&handleControl(activeHandle.curveId,activeHandle.end,true)}</g>}
 {tool==='select'&&bounds&&selected.length>0&&selected.every(id=>transformable(d,id,selected))&&(()=>{const topLeft=screen([bounds.min[0],bounds.max[1]]),bottomRight=screen([bounds.max[0],bounds.min[1]]),center=screen(bounds.center),rot:[number,number]=[center[0],topLeft[1]-25];return <g data-testid="drawing-transform-box"><rect x={topLeft[0]-5} y={topLeft[1]-5} width={Math.max(10,bottomRight[0]-topLeft[0]+10)} height={Math.max(10,bottomRight[1]-topLeft[1]+10)} stroke="#238eb5" strokeDasharray="4 3" fill="none" pointerEvents="none"/><line x1={center[0]} y1={topLeft[1]} x2={rot[0]} y2={rot[1]} stroke="#238eb5"/><circle data-testid="drawing-rotate" cx={rot[0]} cy={rot[1]} r="5" fill="#fff" stroke="#238eb5" onPointerDown={e=>startDrag(e,'rotate',{ids:scope(),origin:bounds.center})}/>{([bounds.min,[bounds.max[0],bounds.min[1]],[bounds.min[0],bounds.max[1]],bounds.max] as Point2[]).map((p,i)=>{const s=screen(p),origin:Point2=[p[0]===bounds.min[0]?bounds.max[0]:bounds.min[0],p[1]===bounds.min[1]?bounds.max[1]:bounds.min[1]];return <rect key={i} data-testid="drawing-scale" x={s[0]-4} y={s[1]-4} width="8" height="8" fill="#fff" stroke="#238eb5" onPointerDown={e=>startDrag(e,'scale',{ids:scope(),origin})}/>;})}</g>;})()}
 {tool==='deform'&&cage&&<DeformCageOverlay rect={cage.rect} quad={cage.quad} bend={cage.bend} screen={screen} onCorner={(e,corner)=>{if(space.current||e.button!==0)return;startDrag(e,'deform',{cage,corner,ids:cage.ids});}} onBoundary={(e,bendEdge,bendHandle)=>{if(space.current||e.button!==0)return;startDrag(e,'deform',{cage,bendEdge,bendHandle,ids:cage.ids});}}/>}
 {(tool==='direct'||tool==='select')&&<DisplayIntervalOverlay d={d} selection={selection} screen={screen} pick={(e,track,range,end)=>{if(space.current||e.button!==0)return;const t=d.displayIntervals!.find(t=>t.id===track)!;session.set({selection:{ids:[t.anchor.id],displayInterval:{track,range,end}}});startDrag(e,'displayInterval',{displayInterval:{track,range,end}});}}/>}
 {penPreview&&<path data-testid="drawing-pen-preview" d={curvePath(penPreview,screen)} fill="none" stroke="#208bb4" strokeWidth="1.5" strokeDasharray="4 3" pointerEvents="none"/>}
 {tool==='pen'&&visiblePen&&<g pointerEvents="none" data-testid="drawing-pen-anchor"><circle cx={screen(visiblePen.position)[0]} cy={screen(visiblePen.position)[1]} r="4" fill="#208bb4"/><line x1={screen(visiblePen.position)[0]} y1={screen(visiblePen.position)[1]} x2={screen(add(visiblePen.position,visiblePen.out))[0]} y2={screen(add(visiblePen.position,visiblePen.out))[1]} stroke="#208bb4"/><circle cx={screen(add(visiblePen.position,visiblePen.out))[0]} cy={screen(add(visiblePen.position,visiblePen.out))[1]} r="3" fill="white" stroke="#208bb4"/></g>}
 {box&&<rect x={Math.min(screen(box.a)[0],screen(box.b)[0])} y={Math.min(screen(box.a)[1],screen(box.b)[1])} width={Math.abs(screen(box.a)[0]-screen(box.b)[0])} height={Math.abs(screen(box.a)[1]-screen(box.b)[1])} fill="#238eb512" stroke="#238eb5" strokeDasharray="4 3" pointerEvents="none"/>}
 </>}
 {guideSnap&&<g pointerEvents="none" data-testid="drawing-guide-snap"><circle cx={screen(guideSnap.point)[0]} cy={screen(guideSnap.point)[1]} r={8} fill="none" stroke="#148b96" strokeWidth={2}/><text x={screen(guideSnap.point)[0]+12} y={screen(guideSnap.point)[1]-10} fill="#148b96" fontSize={12}>{t(guideSnap.kind==='guide'?'辅助线吸附':'交点吸附')}</text></g>}
 <ViewGuidesOverlay screen={screen} unit={unit} width={size.width} height={size.height}/>
 </svg>
 {!d.curves.length&&!d.reference&&tool==='select'&&<div className="drawing-welcome"><PenTool size={27}/><strong>{t('从一条线开始')}</strong><p>{t('加载参考图，选择图层，用钢笔落点并拖出控制柄。')}</p><button onClick={()=>file.current?.click()}>{t('插入背景图')}</button><button onClick={()=>{if(!activeLayer)run(()=>cmd.addLayer(stored,t('图层')+'1'));selectTool('pen');}}>{t('开始绘线')}</button></div>}
 {referenceMoving&&!artworkPreview&&<button className="drawing-reference-done" onClick={()=>setReferenceMoving(false)}>{t('完成图片平移')}</button>}
 {pending&&<div className="drawing-selection-notice" role="dialog"><strong>{t('本次操作会影响未选中的关联曲线。')}</strong><p>{pending.ids.map(id=>curveById(stored,id)?.name).join('、')}</p>{pending.mirror?<><p>{t('镜像将保持绑定与接笔关系，上述关联曲线的共享端点或控制柄会一起调整。')}</p><button onClick={()=>{const m=pending.mirror!;setPending(null);if(currentDrawing()!==m.base)return;try{commit(applyDrawingMirrorTool(m.base,m.source,m.target,true));choose({ids:[m.target]},'direct');}catch(ex){error(ex,[m.target]);}}}>{t('继续镜像')}</button></>:<button onClick={()=>{approved.current=pending;session.set({selection:{ids:pending.ids}});setPending(null);setHint(t('已补齐选择，请重新执行变换。'));}}>{t('选中所需关联曲线')}</button>}<button onClick={()=>setPending(null)}>{t('取消')}</button></div>}
 </div>
 {sidebar&&<aside className="drawing-sidebar" data-properties-open={propertiesOpen} style={{gridTemplateRows:propertiesOpen?`minmax(100px,${panelHeight}fr) 6px minmax(80px,${100-panelHeight}fr)`:'minmax(0,1fr) 0px 32px'}}>
 {restoreLayerId&&<LayerSnapshotDialog key={projectId+restoreLayerId} layerId={restoreLayerId} close={()=>setRestoreLayerId(null)} restored={()=>{setClipboard(null);session.set({selection:{ids:[],layer:restoreLayerId},layerId:restoreLayerId,tool:'select'});setHint('');}}/>}
 <LayerPanel onLockChange={workspaceId==='drawing'?(objectIds,locked)=>{try{const store=useEditor.getState(),plan=prepareDrawingSnapshotObjectLocks(store.project,objectIds,locked);if(plan.changed){artworkPreview?.edit();store.commitPreparedSnapshotEdit(plan);}own.current=currentDrawing();setHint('');}catch(e){error(e);}}:undefined} headerActions={workspaceId==='drawing'?<button data-testid="drawing-paste-layer-reference" disabled={!layerReferenceClipboard} onClick={pasteSelected}>{zh?'粘贴图层引用':'Paste layer reference'}</button>:undefined} layerSections={[{id:activeSnapshot?.id??'$working',name:activeSnapshot?.name??t('图层'),layerIds:d.layers.map(layer=>layer.id)}]} sectionActions={workspaceId==='drawing'?section=>{const selected=selectedLayers(selection).filter(id=>section.layerIds.includes(id)),ids=selected.length?selected:activeLayer&&section.layerIds.includes(activeLayer.id)?[activeLayer.id]:[],label=zh?'提取图层引用':'Take layer reference';return <button data-testid="drawing-take-layer-reference" aria-label={label} title={zh?'提取当前或所选图层的实时引用，保留原图层 · Ctrl/Cmd+X':'Take a live reference to the current or selected layers, keeping the originals · Ctrl/Cmd+X'} disabled={!ids.length} onClick={()=>takeLayerReference(ids)}><Scissors size={14}/>{label}</button>;}:undefined} openProperties={()=>setPropertiesOpen(true)} closeProperties={()=>setPropertiesOpen(false)} restoreLayer={id=>{prepareSnapshotChange();setRestoreLayerId(id);}} deleteSelected={deleteSelected} cutSelected={cutSelected} pasteSelected={pasteSelected} canPaste={!!clipboard&&!!activeLayer||workspaceId==='drawing'&&!!layerReferenceClipboard} document={d} active={activeLayer?.id??null} selection={selection} run={run} choose={choose} setLayer={id=>{endPen();setPenPreview(null);session.set({layerId:id});}} upload={()=>file.current?.click()}/>
 <div hidden={!propertiesOpen} role="separator" aria-label={t('调整图层与属性高度')} className="drawing-sidebar-split" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.parentElement!.getBoundingClientRect();setPanelHeight(Math.max(20,Math.min(85,(e.clientY-r.top)/r.height*100)));}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/>
 {presentation&&[...selected,...selectedObjects(selection)].some(id=>presentation.layerOwners.get(layerFor(d,id)?.id??'')?.kind==='snapshot-local')&&<p className="drawing-muted" data-testid="drawing-reference-capability">{zh?'引用图层支持局部新增、分段、端点绑定与联动、显示贯通、区间、几何、显隐及线宽、轮廓样式、端点笔触及对象锁定；尚未支持的拓扑更改仍需编辑源。':DRAWING_REFERENCE_EDIT_CAPABILITY}</p>}
 <Properties domainControls={workspaceId==='drawing'&&selectedLayers(selection).some(id=>presentation?.layerOwners.get(id)?.kind==='snapshot-local')?<LayerDomainControls domains={(presentation?.evaluation.state.layerDomains??[]).filter(domain=>domain.layerIds.some(id=>selectedLayers(selection).includes(presentation!.presentationId(id))))} layerName={id=>presentation?.drawing.layers.find(layer=>layer.id===presentation.presentationId(id))?.name??id} onScale={(axis,value)=>applyTransform(axis==='x'?'scaleX':'scaleY',value)} onEnabled={setLayerDomainEnabled}/>:undefined} open={propertiesOpen} setOpen={setPropertiesOpen} preview={setDraft} document={d} selection={selection} active={activeLayer?.id??null} run={run} choose={choose} tool={selectTool} transform={applyTransform} upload={()=>file.current?.click()} moveReference={()=>{cancelDraft();setFirst(null);endPen();setReferenceMoving(true);}}/>
 </aside>}
 </div>
 <footer className="drawing-status"><span>{t('当前绘制层')}：{activeLayer?.name??t('未选择')}　·　{selected.length} {t('条曲线')}</span><span role="status">{hint||(referenceMoving?t('拖动平移参考图'):artworkPreview?.hint)||t(endpointTools?connections:tool==='pen'?'落点并拖柄 · Enter 结束 · Esc 取消未完成段':activeTool[3])}</span><button onClick={()=>session.set({zoom:Math.max(.1,zoom/1.2)})}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>session.set({zoom:Math.min(12,zoom*1.2)})}>＋</button><button onClick={fit}>{t('适配')}</button></footer>
 </main>;
}
type DrawingCurveAlias={id:string};
