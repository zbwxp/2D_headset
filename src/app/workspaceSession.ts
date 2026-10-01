import type {StoreApi} from 'zustand';
import type {useDrawing as DrawingStore,DrawingSelection,DrawingTool} from '../ui/drawing/session';
import type {useDrawing as AssemblyStore} from '../ui/assemblyDrawing/session';
import type {useRecording as RecordingStore} from '../ui/recording/session';

type Drawing=ReturnType<typeof DrawingStore.getState>;
type Assembly=ReturnType<typeof AssemblyStore.getState>;
type Recording=ReturnType<typeof RecordingStore.getState>;
type Stores={drawing:StoreApi<Drawing>;assembly:StoreApi<Assembly>;recording:StoreApi<Recording>};
type Room='modeling'|'drawing'|'assembly'|'recording';
type Project={meta:{createdAt:number};drawing?:{curves:unknown[]};assembly?:unknown;views:{id:string}[]};
type Editor={getState:()=>{project:Project;viewId:string};setState:(p:{viewId:string})=>void;subscribe:(listener:()=>void)=>()=>void};
type DrawingView=Omit<Drawing,'set'|'room'>;
type AssemblyView=Omit<Assembly,'set'|'room'>;
type RecordingView=Pick<Recording,'view'|'zoom'|'pan'>;
type Workspace={version:1;room:Room;drawing:DrawingView;assembly:AssemblyView;recording:RecordingView;viewId:string};
const prefix='contour.workspace-session.v1.';
export const workspaceSessionKey=(projectId:number)=>prefix+projectId;
const tools:DrawingTool[]=['deform','select','direct','pen','ellipse','split','mirror','merge','link','bind','smooth','cusp','arc','hand','zoom'];
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown):string[]|undefined=>Array.isArray(v)&&v.every(x=>typeof x==='string')?v:undefined;
const number=(v:unknown,fallback:number,min=-Infinity,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const bool=(v:unknown,fallback:boolean)=>typeof v==='boolean'?v:fallback;
const text=(v:unknown,fallback:string)=>typeof v==='string'?v:fallback;
const point=(v:unknown,fallback:[number,number]):[number,number]=>Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='number'&&Number.isFinite(x))?[v[0],v[1]]:fallback;
const oneOf=<T extends string>(v:unknown,choices:readonly T[],fallback:T):T=>choices.includes(v as T)?v as T:fallback;
function selection(value:unknown):DrawingSelection{
 const v=object(value),s:DrawingSelection={ids:strings(v.ids)??[]};
 for(const key of ['group','paint','node','layer'] as const)if(typeof v[key]==='string')s[key]=v[key];
 for(const key of ['paintIds','layers'] as const){const a=strings(v[key]);if(a)s[key]=a;}
 for(const key of ['reference','mirrorAxis'] as const)if(typeof v[key]==='boolean')s[key]=v[key];
 const handle=object(v.handle),ink=object(v.inkEnd),range=object(v.displayInterval);
 if(typeof handle.curveId==='string'&&(handle.end===0||handle.end===1))s.handle={curveId:handle.curveId,end:handle.end};
 if(typeof ink.id==='string'&&(ink.end===0||ink.end===1))s.inkEnd={id:ink.id,end:ink.end};
 if(typeof range.track==='string'&&typeof range.range==='string'&&(range.end===0||range.end===1))s.displayInterval={track:range.track,range:range.range,end:range.end};
 return s;
}
function drawingView(value:unknown,d:DrawingView):DrawingView{
 const v=object(value);
 return {tool:oneOf(v.tool,tools,d.tool),selection:selection(v.selection),layerId:typeof v.layerId==='string'?v.layerId:d.layerId,
  zoom:number(v.zoom,d.zoom,.01,1000),pan:point(v.pan,d.pan),preview:bool(v.preview,d.preview),sidebar:bool(v.sidebar,d.sidebar),
  width:number(v.width,d.width,0),penJoin:oneOf(v.penJoin,['POSITION','SMOOTH','CUSP'],d.penJoin),showFills:bool(v.showFills,d.showFills),
  fillVisibility:Object.fromEntries(Object.entries(object(v.fillVisibility)).filter((x):x is [string,boolean]=>typeof x[1]==='boolean')),
  closedLayers:strings(v.closedLayers)??d.closedLayers,panelHeight:number(v.panelHeight,d.panelHeight,20,85)};
}
function assemblyView(value:unknown,d:AssemblyView):AssemblyView{
 const v=object(value),ui=object(v.viewOptions),u=d.viewOptions;
 return {...drawingView(value,d),rigPan:point(v.rigPan,d.rigPan),rigViewLocked:bool(v.rigViewLocked,d.rigViewLocked),viewOptions:{
  locatorId:text(ui.locatorId,u.locatorId),planeId:text(ui.planeId,u.planeId),overlay:bool(ui.overlay,u.overlay),folded:bool(ui.folded,u.folded),
  perspectiveEditing:bool(ui.perspectiveEditing,u.perspectiveEditing),trajectoryMode:oneOf(ui.trajectoryMode,['selected','all','off'],u.trajectoryMode),
  trajectoryRequested:bool(ui.trajectoryRequested,u.trajectoryRequested),trajectoryPitch:typeof ui.trajectoryPitch==='number'?number(ui.trajectoryPitch,0,-90,90):null,
  trajectoryScope:oneOf(ui.trajectoryScope,['recorded','full'],u.trajectoryScope)}};
}
function recordingView(value:unknown,d:RecordingView):RecordingView{
 const v=object(value),view=object(v.view);
 return {pan:point(v.pan,d.pan),zoom:number(v.zoom,d.zoom,.01,1000),view:{yaw:number(view.yaw,d.view.yaw,-180,180),pitch:number(view.pitch,d.view.pitch,-89,89)}};
}
function capture(s:Stores,viewId:string):Workspace{
 const {set:_d,room:dRoom,...drawing}=s.drawing.getState();
 const {set:_a,room:aRoom,...assembly}=s.assembly.getState();
 const {view,pan,zoom,room:rRoom}=s.recording.getState();
 return {version:1,room:aRoom?'assembly':dRoom?'drawing':rRoom?'recording':'modeling',drawing,assembly,recording:{view,pan,zoom},viewId};
}

// Small, project-scoped navigation state. Geometry/poses remain in the project
// autosave; panning never serializes that large document or creates undo entries.
export function connectWorkspaceSession(editor:Editor,stores:Stores,storage:Pick<Storage,'getItem'|'setItem'>){
 const initial:Stores={drawing:{...stores.drawing,getState:stores.drawing.getInitialState},assembly:{...stores.assembly,getState:stores.assembly.getInitialState},recording:{...stores.recording,getState:stores.recording.getInitialState}};
 const defaults=capture(initial,'');
 let project=editor.getState().project,key=workspaceSessionKey(project.meta.createdAt),restoring=false,dirty=false,timer:ReturnType<typeof setTimeout>|undefined;
 const flush=()=>{
  clearTimeout(timer);timer=undefined;
  if(!dirty||restoring)return;
  try{storage.setItem(key,JSON.stringify(capture(stores,editor.getState().viewId)));dirty=false;}
  catch{/* Keep the live session usable if browser storage is full/disabled. */}
 };
 const restore=()=>{
  restoring=true;
  try{
   let saved:Record<string,unknown>={};
   try{const parsed=object(JSON.parse(storage.getItem(key)??'null'));if(parsed.version===1)saved=parsed;}catch{/* Invalid UI data must not block opening the project. */}
   const fallback:Room=project.drawing?.curves.length?'drawing':'modeling';
   let room=oneOf(saved.room,['modeling','drawing','assembly','recording'],fallback);
   if(room==='assembly'&&!project.assembly)room=fallback;
   // Apply absolute origins together, bypassing the pan gesture's lock delta.
   stores.drawing.setState({...drawingView(saved.drawing,defaults.drawing),room:room==='drawing'});
   stores.assembly.setState({...assemblyView(saved.assembly,defaults.assembly),room:room==='assembly'});
   stores.recording.setState({...recordingView(saved.recording,defaults.recording),room:room==='recording'});
   if(typeof saved.viewId==='string'&&project.views.some(v=>v.id===saved.viewId))editor.setState({viewId:saved.viewId});
  }finally{restoring=false;}
 };
 restore();
 const schedule=()=>{if(restoring)return;dirty=true;clearTimeout(timer);timer=setTimeout(flush,180);};
 const unsubscribers=Object.values(stores).map(s=>s.subscribe(schedule));
 let viewId=editor.getState().viewId;
 unsubscribers.push(editor.subscribe(()=>{
  if(restoring)return;
  const next=editor.getState();
  if(next.project.meta.createdAt!==project.meta.createdAt){
   // Save the outgoing workspace before installing the new project's state.
   // viewId already belongs to the incoming project; retain the previous id.
   clearTimeout(timer);try{storage.setItem(key,JSON.stringify(capture(stores,viewId)));}catch{/* Storage unavailable. */}
   project=next.project;key=workspaceSessionKey(project.meta.createdAt);restore();schedule();
  }else if(next.viewId!==viewId)schedule();
  viewId=editor.getState().viewId;
 }));
 const hidden=()=>{if(document.visibilityState==='hidden')flush();};
 if(typeof window!=='undefined'){
  window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
 }
 schedule();
 return {flush,dispose(){flush();unsubscribers.forEach(fn=>fn());clearTimeout(timer);if(typeof window!=='undefined'){window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);}}};
}
