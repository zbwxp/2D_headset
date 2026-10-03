import type {StoreApi} from 'zustand';
import type {useDrawing as DrawingStore,DrawingSelection,DrawingTool} from '../ui/drawing/session';
import type {useWorkspaceMode as WorkspaceStore,WorkspaceMode} from './workspaceMode';

type Drawing=ReturnType<typeof DrawingStore.getState>;
type Mode=ReturnType<typeof WorkspaceStore.getState>;
type Stores={drawing:StoreApi<Drawing>;workspace:StoreApi<Mode>};
type Project={meta:{createdAt:number};views:{id:string}[]};
type Editor={getState:()=>{project:Project;viewId:string};setState:(p:{viewId:string})=>void;subscribe:(listener:()=>void)=>()=>void};
type DrawingView=Omit<Drawing,'set'|'room'>;
type Workspace={version:2;mode:WorkspaceMode;drawing:DrawingView;viewId:string};
const prefix='contour.workspace-session.v1.';
export const workspaceSessionKey=(projectId:number)=>prefix+projectId;
const tools:DrawingTool[]=['deform','select','direct','pen','ellipse','split','mirror','merge','link','bind','smooth','cusp','arc','hand','zoom'];
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown):string[]|undefined=>Array.isArray(v)&&v.every(x=>typeof x==='string')?v:undefined;
const number=(v:unknown,fallback:number,min=-Infinity,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const bool=(v:unknown,fallback:boolean)=>typeof v==='boolean'?v:fallback;
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
function capture(s:Stores,viewId:string):Workspace{
 const {set:_d,room:_room,...drawing}=s.drawing.getState();
 return {version:2,mode:s.workspace.getState().mode,drawing,viewId};
}

// Small, project-scoped navigation state. Geometry/poses remain in the project
// autosave; panning never serializes that large document or creates undo entries.
export function connectWorkspaceSession(editor:Editor,stores:Stores,storage:Pick<Storage,'getItem'|'setItem'>){
 const {set:_set,room:_room,...drawingDefaults}=stores.drawing.getInitialState();
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
   try{const parsed=object(JSON.parse(storage.getItem(key)??'null'));if(parsed.version===1||parsed.version===2)saved=parsed;}catch{/* Invalid UI data must not block opening the project. */}
   // Read the old key for continuity, but never initialize its retired rooms or
   // restore their private viewports. Only the current workspace mode survives.
   const mode=oneOf(saved.version===1?saved.room:saved.mode,['drawing','recording'] as const,saved.version===1?'drawing':stores.workspace.getState().mode);
   stores.drawing.setState({...drawingView(saved.drawing,drawingDefaults),room:mode==='drawing'});
   if(stores.workspace.getState().mode!==mode)stores.workspace.getState().setMode(mode);
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
