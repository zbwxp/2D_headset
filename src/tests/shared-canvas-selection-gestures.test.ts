import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import SnapshotRecordingWorkspace from '../ui/vectorRecording/SnapshotRecordingWorkspace';
import * as snapshotProperties from '../ui/vectorRecording/snapshotDrawingPropertyEdit';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {canonicalElementId,upsertDrawingSource} from '../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../domain/recordingSnapshot/model';
import {getSnapshotSurfaceTargetWorkStats} from '../domain/recordingSnapshot/surfaceTargets';
import {createSnapshotAngleGraph} from '../domain/recordingSnapshot/angleGraph';
import {createEmptyProject} from '../app/emptyProject';
import {currentPreparedEditRevision} from '../app/preparedEditRevision';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {connect,createCurve} from '../domain/drawing/commands';
import {transformable} from '../domain/drawing/groups';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {drawingControlEditStats} from '../domain/drawing/controlEditPlan';
import {applyScenePlacement,scenePlacementScales} from '../domain/recordingScene/tracks';
import type {ScenePlacementValue} from '../domain/recordingScene/model';
import DrawingRoom from '../ui/drawing/DrawingRoom';
import {useDrawing,type DrawingSelection,type DrawingTool} from '../ui/drawing/session';
import {chooseDrawingSelection} from '../ui/drawing/interactionController';
import {selectionBounds} from '../ui/drawing/geometry';
import {applyDrawingControlEditPlan,beginDrawingMarquee,drawingCurveBodySelection,finishDrawingMarquee,prepareDrawingControlEditPlan} from '../ui/drawing/editGestures';
import SceneCurveEditOverlay from '../ui/vectorRecording/SceneCurveEditOverlay';
import DisplayIntervalOverlay from '../ui/drawing/DisplayIntervalOverlay';
import InkEndOverlay from '../ui/drawing/InkEndOverlay';
import {addDisplayInterval,changeDisplayInterval,displayPath,displayField} from '../domain/drawing/displayIntervals';
import SceneWarpCanvas from '../ui/vectorRecording/SceneWarpCanvas';
import SceneInstanceTransformBox,{type RecordingInstanceTransform} from '../ui/vectorRecording/SceneInstanceTransformBox';
import type {DrawingCommandIntent} from '../ui/drawing/endpointInteraction';

// Execute the actual canvas handlers and effects without a browser renderer.
// Both consumers retain their real selection policy and geometry commands.
const hooks=vi.hoisted(()=>({memos:[] as {deps:unknown[]|undefined;value:unknown}[],memoIndex:0,states:[] as unknown[],refs:[] as {current:unknown}[],deps:[] as (unknown[]|undefined)[],cleanups:[] as ((()=>void)|void)[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0,dirty:false}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{const value=typeof next==='function'?next(hooks.states[i]):next;if(!Object.is(value,hooks.states[i])){hooks.states[i]=value;hooks.dirty=true;}}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),
 useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown,deps?:unknown[])=>{const i=hooks.memoIndex++,previous=hooks.memos[i];if(previous&&deps&&previous.deps&&deps.length===previous.deps.length&&deps.every((value,index)=>Object.is(value,previous.deps![index])))return previous.value;const value=fn();hooks.memos[i]={deps,value};return value;},useContext:(context:{_currentValue:unknown})=>context._currentValue,
 useSyncExternalStore:(_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot(),useDebugValue:()=>{},
 useEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.effectIndex++,previous=hooks.deps[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous[j]))){hooks.deps[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn();});}},
 useLayoutEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.effectIndex++,previous=hooks.deps[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous[j]))){hooks.deps[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn();});}},
}));
vi.mock('react-dom',async original=>({...await original<typeof import('react-dom')>(),createPortal:(children:unknown)=>children}));
vi.mock('zustand',async original=>{
 const actual=await original<typeof import('zustand')>();
 const create=(initializer:any):any=>{if(!initializer)return create;const store=actual.create(initializer);return Object.assign((selector=(state:any)=>state)=>selector(store.getState()),store);};
 return {...actual,create,useStore:(store:{getState:()=>unknown},selector=(state:unknown)=>state)=>selector(store.getState())};
});

type Props={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<Props>[] {
 if(Array.isArray(tree))return tree.flatMap(elements);
 if(!isValidElement<Props>(tree))return [];
 if(tree.type===DisplayIntervalOverlay)return elements(DisplayIntervalOverlay(tree.props as ComponentProps<typeof DisplayIntervalOverlay>));
 if(tree.type===InkEndOverlay)return elements(InkEndOverlay(tree.props as ComponentProps<typeof InkEndOverlay>));
 if(tree.type===SceneInstanceTransformBox)return elements(SceneInstanceTransformBox(tree.props as ComponentProps<typeof SceneInstanceTransformBox>));
 return [tree,...elements(tree.props.children)];
}
class Target {closest(){return null;}}
const listeners=new Map<string,Set<(event:any)=>void>>();
const savedEditor=useEditor.getState(),savedSession=useDrawing.getState(),savedMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{
 hooks.memos=[];hooks.memoIndex=0;hooks.states=[];hooks.refs=[];hooks.deps=[];hooks.cleanups=[];listeners.clear();
 const events={addEventListener:(name:string,fn:(event:any)=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:(event:any)=>void)=>listeners.get(name)?.delete(fn)};
 vi.stubGlobal('Element',Target);vi.stubGlobal('window',{...events,innerWidth:1000,innerHeight:800,dispatchEvent:(event:Event)=>{emit(event.type,event);return true;}});
 vi.stubGlobal('document',{...events,body:{},hidden:false,querySelector:()=>null});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 useWorkspaceMode.setState({mode:'drawing'});
 useDrawing.setState({...savedSession,tool:'select',selection:{ids:[]},layerId:'layer',zoom:1,pan:[0,0],preview:false});
});
afterEach(()=>{hooks.cleanups.forEach(fn=>fn?.());vi.unstubAllGlobals();useEditor.setState(savedEditor,true);useDrawing.setState(savedSession,true);useWorkspaceMode.setState({mode:savedMode});});
const pointer=(point:Point2,shiftKey=false)=>({button:0,buttons:1,pointerId:1,pointerType:'mouse',clientX:point[0],clientY:point[1],shiftKey,altKey:true,ctrlKey:false,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const emit=(name:string,event:unknown)=>[...(listeners.get(name)??[])].forEach(fn=>fn(event));
const near=(actual:Point2,expected:Point2)=>actual.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],9));
type Options={interval?:boolean;intervalAtNode?:boolean;correction?:boolean;tool?:'select'|'direct';selected?:string[];mirrored?:boolean;hiddenContinuation?:boolean;lockedGroup?:boolean;twoLayers?:boolean;instanceStrategy?:'placement'|'control-target'};
function fixture(options:Options):DrawingDocument {
 let drawing=emptyDrawing();drawing.layers=[{id:'layer',name:'Outline',visible:true,locked:false,items:[]}];
 const curves:Record<string,Cubic>={a:[[-1,-.4],[-.9,-.2],[-.7,-.2],[-.6,-.4]],b:[[-.3,-.4],[-.2,-.2],[0,-.2],[.1,-.4]],c:[[-.3,.4],[-.2,.6],[0,.6],[.1,.4]],mirror:[[1,-.4],[.9,-.2],[.7,-.2],[.6,-.4]]};
 for(const [id,shape] of Object.entries(curves))drawing=createCurve(drawing,'layer',shape,.02,id,id);
 if(options.twoLayers){drawing.layers[0].items=drawing.layers[0].items.filter(id=>id!=='c');drawing.layers.push({id:'other',name:'Other',visible:true,locked:false,items:['c']});}
 if(options.mirrored)drawing.mirrorEditing={enabled:true,curvePairs:[{id:'pair',a:'a',b:'mirror',reverse:false}]};
 if(options.hiddenContinuation){drawing=connect(drawing,{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');drawing.curves.find(c=>c.id==='b')!.visible=false;}
 if(options.lockedGroup){drawing.groups=[{id:'group',name:'Complete group',curveIds:['a','b'],visible:true,locked:false}];drawing.curves.find(c=>c.id==='b')!.locked=true;}
 if(options.interval){drawing=addDisplayInterval(drawing,'a','HIDE');const track=drawing.displayIntervals!.at(-1)!;drawing=changeDisplayInterval(drawing,track.id,track.ranges[0].id,{start:options.intervalAtNode?0:.2,end:.6});}
 return drawing;
}

function harness(consumer:'Drawing'|'Recording',options:Options={}){
 const source=fixture(options),project={...createEmptyProject(),drawing:source,recordingSnapshots:undefined};
 useEditor.setState({project,past:[],future:[]});
 useDrawing.setState({tool:options.tool??'select',selection:{ids:options.selected??[]}});
 let drawing=source,shown=drawing,historyKey={},tool:DrawingTool=options.tool??'select',selection:DrawingSelection={ids:options.selected??[]},targetKey='view',activeLayer=options.twoLayers?'other':'layer',all:ReactElement<Props>[]=[];
 const error=vi.fn(),commit=vi.fn((before:DrawingDocument,next:DrawingDocument,_intent?:DrawingCommandIntent)=>{expect(before).toBe(drawing);drawing=next;shown=next;historyKey={};return historyKey;}),preview=vi.fn((before:DrawingDocument,next:DrawingDocument|null)=>{expect(before).toBe(drawing);shown=next??drawing;return true;});
 const transformPreview=vi.fn(),transformCommit=vi.fn(),legacyCurveCommit=vi.fn(),adapters:RecordingInstanceTransform[]=[];let rejectPreview=false,displayPlacement:ScenePlacementValue|undefined;
 const transform=(ids:string[]):RecordingInstanceTransform|undefined=>{
  const bounds=selectionBounds(drawing,ids);if(!bounds)return;const base=drawing,controlPlan=options.instanceStrategy==='control-target'?prepareDrawingControlEditPlan(base,{kind:'curves',curveIds:ids,preserveRelations:true}):undefined;
  const adapter:RecordingInstanceTransform={ids:[...ids],bounds,displayPlacement,allowCurveSelection:true,editable:ids.every(id=>transformable(drawing,id,ids)),label:'Selection',onPreview:vi.fn(value=>{transformPreview(value);if(controlPlan)shown=value&&!rejectPreview?applyDrawingControlEditPlan(controlPlan,{kind:'transform',value}):drawing;return !value||!rejectPreview;}),onCommit:vi.fn(value=>{transformCommit(value);if(controlPlan)commit(base,applyDrawingControlEditPlan(controlPlan,{kind:'transform',value}),{kind:'geometry-authoring',controlPlan});})};adapters.push(adapter);return adapter;
 };
 const choose=(next:DrawingSelection,mode?:DrawingTool)=>{const transition=chooseDrawingSelection(tool,next,mode);selection=transition.selection;tool=transition.tool;activeLayer=drawing.layers.find(layer=>layer.items.includes(next.ids[0]))?.id??activeLayer;};
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};
 function render(){
  let count=0;do{
   hooks.dirty=false;hooks.memoIndex=0;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];
   all=elements(consumer==='Drawing'?DrawingRoom():SceneWarpCanvas({intervalEditor:{drawing,targetKey,historyKey,layerId:activeLayer,editable:true,topologyEditable:false,onPreview:preview,onCommit:commit,onSelection:next=>choose(next,tool),onError:error},editEnabled:!options.correction,source,drawing:shown,targetKey,label:'Test',zh:false,onPreview:vi.fn(),onCommit:vi.fn(),showWarpTools:false,selection,onSelectionTool:choose,interaction:{tool,onToolChange:next=>{tool=next;}},instanceTransform:transform(selection.ids),transformsForSelection:transform,curveEdit:{editable:true,onCommit:legacyCurveCommit,onPreview:vi.fn()},topology:{editable:true,onSplit:vi.fn(),pen:{targetKey:`${targetKey}/${activeLayer}`,historyKey,layerId:activeLayer,editable:true,onCommit:commit,onSelection:ids=>choose({ids},'pen'),onError:error},editor:{drawing,targetKey,historyKey,layerId:activeLayer,editable:true,topologyEditable:true,onCommit:commit,onPreview:preview,onSelection:choose,onError:error}}}));
   element(consumer==='Drawing'?'drawing-canvas':'vr-scene-canvas').props.ref.current=svg;
   hooks.effects.forEach(fn=>fn());if(++count>12)throw Error('Canvas effects did not settle');
  }while(hooks.dirty);
 }
 const element=(testId:string)=>all.find(e=>e.props['data-testid']===testId)!;
 const canvas=()=>element(consumer==='Drawing'?'drawing-canvas':'vr-scene-canvas');
 const paint=()=>all.find(e=>e.props.curveDown)!;
 render();preview.mockClear();
 return {
  source,render,element,paint,commit,preview,error,
  inkDown:()=>{const grip=element('drawing-ink-endpoint');grip.props.onPointerDown(pointer([grip.props.cx,grip.props.cy]));render();},
  intervalDown:(end:0|1)=>{const grip=all.find(element=>element.props['data-testid']==='drawing-display-grip'&&element.props['data-end']===end)!,track=drawing.displayIntervals![0],field=displayField(drawing,displayPath(drawing,track.anchor.id)),position=paint().props.screen(field.at(field.native(track,end?track.ranges[0].end:track.ranges[0].start)).p);grip.props.onPointerDown(pointer(position));render();return position;},transformPreview,transformCommit,legacyCurveCommit,adapters,
  transform:(kind:string,value:number)=>{all.find(e=>typeof e.props.transform==='function')!.props.transform(kind,value);render();},
  changeHistory:()=>{historyKey={};render();},changeFrame:(frame:ScenePlacementValue)=>{displayPlacement=frame;render();},rejectPreview:(value:boolean)=>{rejectPreview=value;},
  key:(name:string,phase='keydown',modifiers:Partial<KeyboardEvent>={})=>{emit(phase,{key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,defaultPrevented:false,target:new Target(),preventDefault:vi.fn(),stopImmediatePropagation:vi.fn(),...modifiers});render();},
  selectControl:(kind:'node'|'handle',end:0|1=0)=>{const curve=drawing.curves[0],control=kind==='node'?{kind,nodeId:curve.nodes[end],position:drawing.nodes.find(n=>n.id===curve.nodes[end])!.position}:{kind,curveId:curve.id,end,position:curve.handles[end]};if(consumer==='Drawing'){useDrawing.setState({selection:kind==='node'?{ids:[curve.id],node:curve.nodes[0]}:{ids:[curve.id],handle:{curveId:curve.id,end:0}}});render();}else{all.find(e=>e.type===SceneCurveEditOverlay)!.props.onBegin(pointer(paint().props.screen(control.position)),control);render();canvas().props.onPointerUp(pointer(paint().props.screen(control.position)));render();}},
  drawing:()=>consumer==='Drawing'?useEditor.getState().project.drawing!:drawing,
  shown:()=>paint().props.d as DrawingDocument,
  selection:()=>consumer==='Drawing'?useDrawing.getState().selection:selection,
  tool:()=>consumer==='Drawing'?useDrawing.getState().tool:tool,
  historyCount:()=>consumer==='Drawing'?useEditor.getState().past.length:commit.mock.calls.length,
  navigate:()=>{targetKey='other-view';render();},
  setSelection:(next:DrawingSelection)=>{if(consumer==='Drawing')useDrawing.setState({selection:next});else selection=next;render();},
  screen:(p:Point2)=>paint().props.screen(p) as Point2,
  down:(p:Point2,shift=false)=>{canvas().props.onPointerDown(pointer(p,shift));render();},
  body:(id:string,p:Point2,shift=false)=>{paint().props.curveDown(pointer(p,shift),id);render();},
  cornerDown:(shift=false)=>{
   const grip=element(consumer==='Drawing'?'drawing-scale':'vr-instance-scale');
   const position:Point2=[grip.props.x+4,grip.props.y+4];
   grip.props.onPointerDown(pointer(position,shift));render();return position;
  },
  move:(p:Point2,shift=false)=>{if(consumer==='Drawing')emit('pointermove',pointer(p,shift));else canvas().props.onPointerMove(pointer(p,shift));render();},
  up:(p:Point2,shift=false)=>{if(consumer==='Drawing')emit('pointerup',pointer(p,shift));else canvas().props.onPointerUp(pointer(p,shift));render();},
 };
}
type Harness=ReturnType<typeof harness>;
function boxFor(h:Harness,id:string):[Point2,Point2]{const bounds=selectionBounds(h.source,[id])!;return [h.screen([bounds.min[0]-.04,bounds.max[1]+.04]),h.screen([bounds.max[0]+.04,bounds.min[1]-.04])];}
function marquee(h:Harness,id:string,shift=false){const [start,end]=boxFor(h,id);h.down(start,shift);h.move(end,shift);h.up(end,shift);}

test.each([
 ['Drawing','p'],['Recording','p'],['Drawing','l'],['Recording','l'],
] as const)('%s: %s release retains the previewed topology IDs and commits only once',(consumer,key)=>{
 const h=harness(consumer),start=h.screen([-.5,.1]),end=h.screen([.4,.2]),handle=h.screen([.5,.3]);h.key(key);
 if(key==='p'){h.down(start);h.up(start);}
 h.down(key==='p'?end:start);h.move(handle);const preview=h.shown();
 expect(preview.curves.length).toBeGreaterThan(h.source.curves.length);expect(h.historyCount()).toBe(0);
 h.up(handle);h.up(handle);
 expect(h.historyCount()).toBe(1);expect(h.drawing().curves).toEqual(preview.curves);expect(h.drawing().nodes).toEqual(preview.nodes);
 if(consumer==='Recording')expect(h.commit.mock.calls[0][1]).toBe(preview);
 expect(h.error).not.toHaveBeenCalled();
});

test.each([
 ['Drawing','p'],['Recording','p'],['Drawing','l'],['Recording','l'],
] as const)('%s: canceling %s discards its preview and never commits on release',(consumer,key)=>{
 const h=harness(consumer),start=h.screen([-.5,.1]),end=h.screen([.4,.2]),handle=h.screen([.5,.3]);h.key(key);
 if(key==='p'){h.down(start);h.up(start);}
 h.down(key==='p'?end:start);h.move(handle);expect(h.shown().curves.length).toBeGreaterThan(h.source.curves.length);
 h.key('Escape');h.up(handle);
 expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);expect(h.shown()).toBe(h.source);expect(h.error).not.toHaveBeenCalled();
});

test.each([
 ['p','reject'],['p','throw'],['l','reject'],['l','throw'],
] as const)('Recording: %s valid preview then %s retires the accepted target before release',(key,failure)=>{
 const h=harness('Recording'),start=h.screen([-.5,.1]),end=h.screen([.4,.2]),handle=h.screen([.5,.3]),invalid=h.screen([.6,.4]);h.key(key);
 if(key==='p'){h.down(start);h.up(start);}
 h.down(key==='p'?end:start);h.move(handle);const preview=h.shown();
 expect(h.preview.mock.calls.at(-1)![1]).toBe(preview);expect(preview).not.toBe(h.source);
 h.preview.mockImplementationOnce(()=>{if(failure==='throw')throw Error('Rejected topology preview');return false;});
 h.move(invalid);expect(h.shown()).toBe(h.source);expect(h.preview.mock.calls.at(-1)![1]).toBeNull();
 h.up(invalid);h.up(invalid);
 expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);expect(h.shown()).toBe(h.source);expect(h.commit).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalledTimes(failure==='throw'?1:0);
});

test.each([
 ['p','Escape'],['l','Escape'],['p','undo'],['l','undo'],['p','redo'],['l','redo'],['p','history'],['l','history'],
] as const)('Recording: %s %s cancels its accepted topology target and invalidates prepared edits',(key,action)=>{
 const h=harness('Recording'),start=h.screen([-.5,.1]),end=h.screen([.4,.2]),handle=h.screen([.5,.3]);h.key(key);
 if(key==='p'){h.down(start);h.up(start);}
 h.down(key==='p'?end:start);h.move(handle);expect(h.preview.mock.calls.at(-1)![1]).toBe(h.shown());
 const revision=currentPreparedEditRevision();
 if(action==='history')h.changeHistory();else if(action==='Escape')h.key('Escape');else h.key('z','keydown',{ctrlKey:true,shiftKey:action==='redo'});
 expect(currentPreparedEditRevision()).toBeGreaterThan(revision);expect(h.preview.mock.calls.at(-1)![1]).toBeNull();h.up(handle);
 expect(h.commit).not.toHaveBeenCalled();expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);expect(h.shown()).toBe(h.source);
});

function checkCornerScale(consumer:'Drawing'|'Recording',shift:boolean){
 const h=harness(consumer,{selected:['a']}),bounds=selectionBounds(h.source,['a'])!,origin=bounds.max;
 const pointerAt=(sx:number,sy:number):Point2=>h.screen([origin[0]+(bounds.min[0]-origin[0])*sx,origin[1]+(bounds.min[1]-origin[1])*sy]);
 const expected=(point:Point2):Point2=>[origin[0]+(point[0]-origin[0])*2,origin[1]+(point[1]-origin[1])*(shift?2:.5)];
 near(h.cornerDown(shift),h.screen(bounds.min));
 h.move(pointerAt(1.2,.9),shift);
 const end=pointerAt(2,.5);
 h.move(end,shift);
 expect(h.historyCount()).toBe(0);expect(h.transformCommit).not.toHaveBeenCalled();
 const preview=consumer==='Recording'?h.transformPreview.mock.calls.at(-1)![0] as ScenePlacementValue:undefined;
 if(preview){near(scenePlacementScales(preview),[2,shift?2:.5]);near(applyScenePlacement(preview,origin),origin);}
 const previewShape=preview?shapeOf(h.source,'a').map(point=>applyScenePlacement(preview,point)):shapeOf(h.shown(),'a');
 previewShape.forEach((point,i)=>near(point,expected(shapeOf(h.source,'a')[i])));
 h.up(end,shift);h.up(end,shift);
 expect(h.selection().ids).toEqual(['a']);expect(h.tool()).toBe('select');
 if(consumer==='Drawing'){
  expect(h.historyCount()).toBe(1);
  shapeOf(h.drawing(),'a').forEach((point,i)=>near(point,expected(shapeOf(h.source,'a')[i])));
  expect(shapeOf(h.drawing(),'c')).toEqual(shapeOf(h.source,'c'));
 }else{
  expect(h.transformCommit).toHaveBeenCalledTimes(1);
  const committed=h.transformCommit.mock.calls[0][0] as ScenePlacementValue;
  expect(committed).toEqual(preview);
  shapeOf(h.source,'a').forEach(point=>near(applyScenePlacement(committed,point),expected(point)));
  expect(h.commit).not.toHaveBeenCalled();expect(h.drawing()).toBe(h.source);
 }
}

test.each(['Drawing','Recording'] as const)('%s: corner pointer drag scales axes independently about the opposite corner',consumer=>{
 checkCornerScale(consumer,false);
});

test.each(['Drawing','Recording'] as const)('%s: Shift corner pointer drag scales both axes uniformly about the opposite corner',consumer=>{
 checkCornerScale(consumer,true);
});

test.each(['Drawing','Recording'] as const)('%s: consecutive V marquees replace an existing transform selection',consumer=>{
 const h=harness(consumer,{selected:['c']});
 const frame=consumer==='Drawing'?'drawing-transform-box':'vr-instance-transform-box';
 expect(h.element(frame)).toBeDefined();
 marquee(h,'a');expect(h.selection().ids).toEqual(['a']);expect(h.element(frame)).toBeDefined();
 marquee(h,'b');expect(h.selection().ids).toEqual(['b']);expect(h.element(frame)).toBeDefined();
 expect(h.tool()).toBe('select');expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);expect(h.transformCommit).not.toHaveBeenCalled();
});

test.each(['Drawing','Recording'] as const)('%s: Shift marquee freezes the full prior selection through Shift release',consumer=>{
 const h=harness(consumer,{selected:['a','b'],lockedGroup:true}),[start,end]=boxFor(h,'c');
 h.down(start,true);
 // A locked semantic member is retained, even though it cannot be hit.
 // Additivity belongs to pointer-down, not the modifier at pointer-up.
 h.move(end);h.up(end);
 expect(h.selection().ids).toEqual(['a','b','c']);expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);
});

test.each(['Drawing','Recording'] as const)('%s: A curve-body drag uses the frozen Drawing control plan and mirror follower',consumer=>{
 const h=harness(consumer,{tool:'direct',mirrored:true,selected:['c']}),before=JSON.stringify(h.source),start=h.screen([-.8,-.3]),unit=h.paint().props.unit,stats=drawingControlEditStats();
 h.body('a',start);expect(h.selection().ids).toEqual(['a']);expect(h.tool()).toBe('direct');
 const middle:Point2=[start[0]+12,start[1]-8],end:Point2=[start[0]+30,start[1]-20];
 h.move(middle);h.move(end);
 const delta:Point2=[30/unit,20/unit];
 for(const [i,p] of shapeOf(h.shown(),'a').entries())near(p,[shapeOf(h.source,'a')[i][0]+delta[0],shapeOf(h.source,'a')[i][1]+delta[1]]);
 for(const [i,p] of shapeOf(h.shown(),'mirror').entries()){const moved=shapeOf(h.shown(),'a')[i];near(p,[-moved[0],moved[1]]);}
 expect(shapeOf(h.shown(),'c')).toEqual(shapeOf(h.source,'c'));expect(h.historyCount()).toBe(0);
 expect(drawingControlEditStats().plans-stats.plans).toBe(1);
 h.up(end);h.up(end);
 expect(h.historyCount()).toBe(1);expect(h.tool()).toBe('direct');expect(JSON.stringify(h.source)).toBe(before);expect(h.transformCommit).not.toHaveBeenCalled();expect(h.legacyCurveCommit).not.toHaveBeenCalled();
 for(const [i,p] of shapeOf(h.drawing(),'a').entries())near(p,[shapeOf(h.source,'a')[i][0]+delta[0],shapeOf(h.source,'a')[i][1]+delta[1]]);
 if(consumer==='Recording')expect(h.commit.mock.calls[0][2]).toMatchObject({kind:'geometry-authoring',controlPlan:{before:h.source,intent:{kind:'curves',curveIds:['a']},curveIds:['a','mirror']}});
 else {useEditor.getState().undo();expect(useEditor.getState().project).toBeDefined();expect(shapeOf(useEditor.getState().project.drawing!,'a')).toEqual(shapeOf(h.source,'a'));}
});

test.each(['Drawing','Recording'] as const)('%s: V body and marquee preserve a hidden continuation in semantic selection',consumer=>{
 const h=harness(consumer,{hiddenContinuation:true}),start=h.screen([-.8,-.3]);
 h.body('a',start);h.up(start);expect(new Set(h.selection().ids)).toEqual(new Set(['a','b']));
 marquee(h,'c');expect(h.selection().ids).toEqual(['c']);
 marquee(h,'a');expect(new Set(h.selection().ids)).toEqual(new Set(['a','b']));expect(h.historyCount()).toBe(0);
});

test.each(['Drawing','Recording'] as const)('%s: a locked group member stays selected and rejects the complete operation',consumer=>{
 const h=harness(consumer,{lockedGroup:true}),start=h.screen([-.8,-.3]),end:Point2=[start[0]+25,start[1]-15];
 h.body('a',start);expect(h.selection()).toMatchObject({ids:['a','b'],group:'group'});
 h.move(end);h.up(end);expect(h.drawing()).toBe(h.source);expect(h.historyCount()).toBe(0);expect(h.transformCommit).not.toHaveBeenCalled();
 const plan=prepareDrawingControlEditPlan(h.source,{kind:'curves',curveIds:h.selection().ids});
 expect(()=>applyDrawingControlEditPlan(plan,{kind:'map',map:([x,y])=>[x+.1,y+.1]})).toThrow(/锁定/);
 marquee(h,'c');marquee(h,'a');expect(h.selection()).toMatchObject({ids:['a','b'],group:'group'});
});

test('shared marquee policy freezes semantic IDs while explicit layer containers opt out',()=>{
 const drawing=fixture({lockedGroup:true}),selection:DrawingSelection={ids:['a','b']},gesture=beginDrawingMarquee(selection,'select',true)!;
 selection.ids.splice(0,2,'mirror');
 expect(finishDrawingMarquee(drawing,['c'],[-.4,.3],[.2,.7],gesture).ids).toEqual(['a','b','c']);
 expect(beginDrawingMarquee({ids:['a'],layer:'layer'},'select',false,true)).toBeNull();
 expect(drawingCurveBodySelection(drawing,{ids:[]},'b','select')).toBeNull();
 expect(drawingCurveBodySelection(drawing,{ids:[]},'a','select')?.selection).toEqual({ids:['a','b'],group:'group'});
});

test.each(['direct','select'] as const)('Recording first %s body drag survives the parent updating its Pen target layer',tool=>{
 const h=harness('Recording',{tool,selected:['c'],twoLayers:true}),start=h.screen([-.8,-.3]),end:Point2=[start[0]+25,start[1]-15],before=shapeOf(h.source,'a');
 h.body('a',start);h.move(end);
 if(tool==='direct')expect(shapeOf(h.shown(),'a')).not.toEqual(before);else expect(h.transformPreview).toHaveBeenCalled();
 h.up(end);
 if(tool==='direct'){expect(h.historyCount()).toBe(1);expect(shapeOf(h.drawing(),'a')).not.toEqual(before);}else expect(h.transformCommit).toHaveBeenCalledTimes(1);
 expect(h.selection().ids).toEqual(['a']);expect(h.tool()).toBe(tool);expect(h.error).not.toHaveBeenCalled();
});
test.each(['direct','select'] as const)('Recording %s body drag still cancels on an actual view target change',tool=>{
 const h=harness('Recording',{tool,selected:['c'],twoLayers:true}),start=h.screen([-.8,-.3]),end:Point2=[start[0]+25,start[1]-15];
 h.body('a',start);h.move(end);h.navigate();h.up(end);
 expect(h.commit).not.toHaveBeenCalled();expect(h.transformCommit).not.toHaveBeenCalled();expect(h.drawing()).toBe(h.source);
});

test.each(['Drawing','Recording'] as const)('%s: two held arrows form one gesture and releasing the first cannot commit',consumer=>{
 const h=harness(consumer,{selected:['a']}),before=shapeOf(h.source,'a'),plans=drawingControlEditStats().plans;
 h.key('ArrowRight');h.key('ArrowUp');h.key('ArrowRight');
 const wanted=consumer==='Drawing'?h.shown():h.transformPreview.mock.calls.at(-1)![0];
 expect(h.historyCount()).toBe(0);expect(h.transformCommit).not.toHaveBeenCalled();h.key('ArrowRight','keyup');expect(h.historyCount()).toBe(0);expect(h.transformCommit).not.toHaveBeenCalled();
 h.key('ArrowUp','keyup');h.key('ArrowUp','keyup');
 if(consumer==='Drawing'){expect(h.historyCount()).toBe(1);expect(h.drawing()).toEqual(wanted);expect(drawingControlEditStats().plans-plans).toBe(1);shapeOf(h.drawing(),'a').forEach((point,i)=>near(point,[before[i][0]+.008,before[i][1]+.004]));}
 else{expect(h.transformCommit).toHaveBeenCalledExactlyOnceWith(wanted);expect(h.drawing()).toBe(h.source);}
});

test.each(['Drawing','Recording'].flatMap(consumer=>['node','handle'].map(kind=>({consumer:consumer as 'Drawing'|'Recording',kind:kind as 'node'|'handle'}))))('$consumer $kind arrows use one frozen control plan and commit the exact preview',({consumer,kind})=>{
 const h=harness(consumer,{tool:'direct',selected:['a'],mirrored:true});h.selectControl(kind);const plans=drawingControlEditStats().plans;
 h.key('ArrowRight');h.key('ArrowUp');h.key('ArrowRight', 'keydown',{shiftKey:true});
 const wanted=h.shown();expect(wanted).not.toBe(h.source);expect(h.historyCount()).toBe(0);
 h.key('ArrowRight','keyup');expect(h.historyCount()).toBe(0);h.key('ArrowUp','keyup');h.key('ArrowUp','keyup');
 expect(h.historyCount()).toBe(1);expect(h.drawing()).toEqual(wanted);expect(drawingControlEditStats().plans-plans).toBeLessThanOrEqual(1);expect(h.legacyCurveCommit).not.toHaveBeenCalled();
 if(consumer==='Recording')expect(h.commit.mock.calls[0][2]?.kind).toBe('geometry-authoring');
});

test.each(['Drawing','Recording'].flatMap(consumer=>['Escape','history','blur','cancel','selection'].map(reason=>({consumer:consumer as 'Drawing'|'Recording',reason}))))('$consumer held arrows cancel on $reason without late commit',({consumer,reason})=>{
 const h=harness(consumer,{selected:['a']});h.key('ArrowRight');h.key('ArrowUp');const revision=currentPreparedEditRevision();
 if(reason==='Escape')h.key('Escape');else if(reason==='history')h.key('z','keydown',{ctrlKey:true});else if(reason==='selection')h.setSelection({ids:['b']});else{emit(reason==='blur'?'blur':'contour:cancel-recording-gesture',{});h.render();}
 h.key('ArrowRight','keyup');h.key('ArrowUp','keyup');expect(h.historyCount()).toBe(0);expect(h.transformCommit).not.toHaveBeenCalled();expect(h.shown()).toEqual(h.source);expect(currentPreparedEditRevision()).toBeGreaterThan(revision);
});

test.each(['placement','control-target'] as const)('Recording V %s adapters stay frozen across parent preview rebuilds',instanceStrategy=>{
 const h=harness('Recording',{selected:['a'],instanceStrategy}),first=h.adapters.at(-1)!;
 h.key('ArrowRight');const second=h.adapters.at(-1)!;expect(second).not.toBe(first);h.key('ArrowRight');h.key('ArrowUp');
 const accepted=h.transformPreview.mock.calls.at(-1)![0];h.key('ArrowRight','keyup');expect(h.transformCommit).not.toHaveBeenCalled();h.key('ArrowUp','keyup');
 expect(first.onCommit).toHaveBeenCalledExactlyOnceWith(accepted);expect(second.onCommit).not.toHaveBeenCalled();expect(first.onPreview).toHaveBeenLastCalledWith(null);expect(second.onPreview).not.toHaveBeenCalled();expect(h.transformCommit).toHaveBeenCalledTimes(1);
});

test.each(['history','target'] as const)('Recording V retires a frozen adapter when its %s changes',change=>{
 const h=harness('Recording',{selected:['a']}),frozen=h.adapters.at(-1)!;h.key('ArrowRight');if(change==='history')h.changeHistory();else h.navigate();h.key('ArrowRight','keyup');
 expect(frozen.onPreview).toHaveBeenLastCalledWith(null);expect(frozen.onCommit).not.toHaveBeenCalled();expect(h.transformCommit).not.toHaveBeenCalled();
});

test('Recording V rejected preview cannot commit an earlier target and retains total requested displacement on recovery',()=>{
 const h=harness('Recording',{selected:['a']}),frozen=h.adapters.at(-1)!;h.key('ArrowRight');const first=h.transformPreview.mock.calls.at(-1)![0] as ScenePlacementValue;
 h.rejectPreview(true);h.key('ArrowRight');expect(frozen.onPreview).toHaveBeenLastCalledWith(null);h.rejectPreview(false);h.key('ArrowRight');
 const accepted=h.transformPreview.mock.calls.at(-1)![0] as ScenePlacementValue;near(accepted.translation,[first.translation[0]*3,0]);h.key('ArrowRight','keyup');expect(frozen.onCommit).toHaveBeenCalledExactlyOnceWith(accepted);
});

test('Drawing hidden selected members remain in a held-key plan',()=>{
 const h=harness('Drawing',{selected:['a','b'],hiddenContinuation:true}),before=shapeOf(h.source,'b');h.key('ArrowRight');h.key('ArrowRight','keyup');expect(h.historyCount()).toBe(1);shapeOf(h.drawing(),'b').forEach((point,i)=>near(point,[before[i][0]+.004,before[i][1]]));expect(h.drawing().curves.find(c=>c.id==='b')!.visible).toBe(false);
});

test('Drawing held arrows keep locked group members in the selected scope and reject atomically',()=>{
 const h=harness('Drawing',{selected:['a','b'],lockedGroup:true});h.key('ArrowRight');h.key('ArrowRight','keyup');expect(h.selection().ids).toEqual(['a','b']);expect(h.historyCount()).toBe(0);expect(h.drawing()).toBe(h.source);expect(h.shown()).toBe(h.source);
});


function recordingWorkspaceHarness(correction:boolean,interval=false){
 const source=fixture({interval}),workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',source),sourceSnapshot=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:60,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:sourceSnapshot.id,baseLayerId:canonicalElementId('source','layer')}];side.layers=structuredClone(view.layers);side.deformation.layers.slot={placement:{translation:[0,.4],rotation:0,scale:1}};
 if(interval){const track=sourceSnapshot.relations.displayIntervals!.add![0];side.relations.displayIntervals={update:[{...track,ranges:track.ranges.map(range=>({...range,end:.9}))}]};}
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angle={x:correction?30:0,y:0};recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 const project={...createEmptyProject(),drawing:source,recordingSnapshots:workspace};useEditor.setState({project,past:[],future:[]});useWorkspaceMode.setState({mode:'recording'});
 let all:ReactElement<Props>[]=[],props:ComponentProps<typeof SceneWarpCanvas>;const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};
 function render(){let passes=0;do{
  hooks.dirty=false;hooks.memoIndex=0;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];
  const root=SnapshotRecordingWorkspace(),editorTree=(root.type as (props:Props)=>ReactElement<Props>)(root.props),canvas=elements(editorTree).find(element=>element.type===SceneWarpCanvas)!;props=canvas.props as ComponentProps<typeof SceneWarpCanvas>;
  all=elements(SceneWarpCanvas(props));all.find(element=>element.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.forEach(fn=>fn());if(++passes>20)throw Error('Recording workspace effects did not settle');
 }while(hooks.dirty);}
 const key=(name:string,phase='keydown')=>{emit(phase,{key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,defaultPrevented:false,target:new Target(),preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()});render();};
 render();props!.onSelectionTool!({ids:[canonicalElementId('source','a')]},'select');render();
 return {project,source,render,key,props:()=>props!,drawing:()=>evaluateRecordingSnapshot(useEditor.getState().project.recordingSnapshots!,'recording',{useDraft:true,immutableInputs:true}).drawing,
  selectLayer:()=>{props!.onSelectionTool!({ids:props!.drawing.curves.map(curve=>curve.id),layer:'slot',layers:['slot']},'select');render();},
  materialPoint:(value:number)=>{const d=props!.intervalEditor!.drawing,track=d.displayIntervals![0],field=displayField(d,displayPath(d,track.anchor.id));return all.find(element=>element.props.curveDown)!.props.screen(field.at(field.native(track,value)).p) as Point2;},
  intervalDown:(point:Point2)=>{all.find(element=>element.props['data-testid']==='drawing-display-grip'&&element.props['data-end']===1)!.props.onPointerDown(pointer(point));render();},
  move:(point:Point2)=>{all.find(element=>element.props['data-testid']==='vr-scene-canvas')!.props.onPointerMove(pointer(point));render();},
  up:(point:Point2)=>{all.find(element=>element.props['data-testid']==='vr-scene-canvas')!.props.onPointerUp(pointer(point));render();},
 };
}

test.each([{label:'real-basis',correction:false},{label:'correction',correction:true}])('native Recording V keyboard freezes the actual $label adapter through preview, commit and Undo',({correction})=>{
 const h=recordingWorkspaceHarness(correction),initial=h.props(),adapter=initial.instanceTransform!,before=initial.drawing,id=canonicalElementId('source','a'),library=JSON.stringify(h.project.recordingSnapshots.library);
 adapter.onPreview=vi.fn(adapter.onPreview);adapter.onCommit=vi.fn(adapter.onCommit);
 h.key('ArrowUp');const replacement=h.props().instanceTransform!;expect(replacement).not.toBe(adapter);replacement.onCommit=vi.fn(replacement.onCommit);
 h.key('ArrowUp');const wanted=h.props().drawing;expect(shapeOf(wanted,id)).not.toEqual(shapeOf(before,id));expect(useEditor.getState().past).toHaveLength(0);
 h.key('ArrowUp','keyup');h.key('ArrowUp','keyup');expect(adapter.onCommit).toHaveBeenCalledTimes(1);expect(replacement.onCommit).not.toHaveBeenCalled();expect(useEditor.getState().past).toHaveLength(1);
 shapeOf(h.drawing(),id).forEach((point,i)=>near(point,shapeOf(wanted,id)[i]));expect(JSON.stringify(useEditor.getState().project.recordingSnapshots!.library)).toBe(library);expect(useEditor.getState().project.drawing).toBe(h.source);
 useEditor.getState().undo();h.render();shapeOf(h.drawing(),id).forEach((point,i)=>near(point,shapeOf(before,id)[i]));
});


test('Recording V key deltas keep the first display frame when preview rebuilds change the live frame',()=>{
 const h=harness('Recording',{selected:['a']}),frozen=h.adapters.at(-1)!;h.key('ArrowRight');const first=h.transformPreview.mock.calls.at(-1)![0] as ScenePlacementValue;
 h.changeFrame({translation:[.5,.3],rotation:90,scale:2});h.key('ArrowRight');const accepted=h.transformPreview.mock.calls.at(-1)![0] as ScenePlacementValue;
 near(accepted.translation,[first.translation[0]*2,0]);h.key('ArrowRight','keyup');expect(frozen.onCommit).toHaveBeenCalledExactlyOnceWith(accepted);
});


test.each([{kind:'moveX',value:.2},{kind:'scaleY',value:.6},{kind:'mirror',value:0}])('Drawing numeric $kind uses an authentic control plan and one transaction',({kind,value})=>{
 const h=harness('Drawing',{selected:['a'],mirrored:true}),before=drawingControlEditStats().plans;h.transform(kind,value);
 expect(drawingControlEditStats().plans-before).toBe(1);expect(h.historyCount()).toBe(1);expect(shapeOf(h.drawing(),'a')).not.toEqual(shapeOf(h.source,'a'));
 for(const [i,point] of shapeOf(h.drawing(),'a').entries())near(shapeOf(h.drawing(),'mirror')[i],[-point[0],point[1]]);
 useEditor.getState().undo();h.render();expect(shapeOf(h.drawing(),'a')).toEqual(shapeOf(h.source,'a'));
});


test.each([false,true])('real workspace V releases its accepted candidate without reauthoring or inverse replay, correction=%s',correction=>{
 const h=recordingWorkspaceHarness(correction);h.key('ArrowUp');const authored=drawingControlEditStats(),solved=getSnapshotSurfaceTargetWorkStats();
 h.key('ArrowUp','keyup');const after=drawingControlEditStats();for(const key of ['authoredCurves','scopedAuthoring','fullAuthoring','capturedControls','nodeArrayCopiedSlots','curveArrayCopiedSlots'] as const)expect(after[key]).toBe(authored[key]);expect(after.plans-authored.plans).toBeLessThanOrEqual(1);expect(getSnapshotSurfaceTargetWorkStats()).toEqual(solved);expect(useEditor.getState().past).toHaveLength(1);
});
test('Drawing retains a source pointer preview through parent renders and consumes it without reauthoring',()=>{
 const h=harness('Drawing',{selected:['a']}),p=h.screen(shapeOf(h.source,'a')[0]);h.body('a',p);h.move([p[0]+20,p[1]-10]);const wanted=h.shown(),counts=drawingControlEditStats();h.up([p[0]+20,p[1]-10]);expect(h.drawing()).toEqual(wanted);expect(drawingControlEditStats()).toEqual(counts);expect(h.historyCount()).toBe(1);
});
test('Drawing Pen keeps accepted segment IDs for the next connected segment',()=>{
 const h=harness('Drawing');h.key('p');const a=h.screen([-.8,-.8]),b=h.screen([-.2,-.8]),c=h.screen([.4,-.8]);h.down(a);h.up(a);h.down(b);h.move([b[0]+3,b[1]-5]);h.up([b[0]+3,b[1]-5]);h.down(c);h.move([c[0]+4,c[1]-4]);h.up([c[0]+4,c[1]-4]);
 const added=h.drawing().curves.filter(curve=>!h.source.curves.some(old=>old.id===curve.id));expect(added).toHaveLength(2);expect(added[0].nodes[1]).toBe(added[1].nodes[0]);expect(h.historyCount()).toBe(2);expect(h.selection().ids).toEqual([added[1].id]);
});


test.each(['Drawing','Recording'] as const)('%s V/A material grips share selection and commit only the accepted target',consumer=>{
 for(const tool of ['select','direct'] as const){
  // Each host render uses an isolated hook session, as a new mounted canvas.
  hooks.memos=[];hooks.states=[];hooks.refs=[];hooks.deps=[];hooks.cleanups=[];listeners.clear();
  const h=harness(consumer,{tool,selected:['a','b'],interval:true,correction:consumer==='Recording'}),track=h.source.displayIntervals![0],field=displayField(h.source,displayPath(h.source,track.anchor.id)),target=h.screen(field.at(field.native(track,.7)).p);
  expect(h.element('drawing-display-interval-overlay')).toBeDefined();expect(h.element(consumer==='Drawing'?'drawing-selected':'vr-selected-curve').props.opacity).toBe(.25);expect(h.historyCount()).toBe(0);
  h.intervalDown(1);expect(h.historyCount()).toBe(0);expect(h.selection().displayInterval).toEqual({track:track.id,range:track.ranges[0].id,end:1});
  h.move(target);const accepted=h.shown();expect(accepted.displayIntervals![0].ranges[0].end).toBeCloseTo(.7,3);expect(accepted.nodes).toEqual(h.source.nodes);expect(accepted.curves).toEqual(h.source.curves);expect(h.historyCount()).toBe(0);
  h.up(target);h.up(target);expect(h.historyCount()).toBe(1);expect(h.drawing().displayIntervals).toEqual(accepted.displayIntervals);expect(h.error).not.toHaveBeenCalled();
 }
});

test.each(['reject','throw','Escape','history','navigate','undo','redo'] as const)('Recording interval %s retires the accepted target without a late commit',action=>{
 const h=harness('Recording',{selected:['a','b'],interval:true,correction:true}),track=h.source.displayIntervals![0],field=displayField(h.source,displayPath(h.source,track.anchor.id)),point=(value:number)=>h.screen(field.at(field.native(track,value)).p);
 h.intervalDown(1);h.move(point(.7));expect(h.shown()).not.toBe(h.source);
 if(action==='reject'||action==='throw'){h.preview.mockImplementationOnce(()=>{if(action==='throw')throw Error('Rejected interval');return false;});h.move(point(.8));}
 else if(action==='Escape')h.key('Escape');else if(action==='history')h.changeHistory();else if(action==='navigate')h.navigate();else h.key('z','keydown',{ctrlKey:true,shiftKey:action==='redo'});
 h.up(point(.8));expect(h.commit).not.toHaveBeenCalled();expect(h.drawing()).toBe(h.source);expect(h.shown()).toBe(h.source);
});


test('Recording direct geometry focus keeps priority over a coincident interval grip until the interval is explicitly selected',()=>{
 const h=harness('Recording',{tool:'direct',selected:['a'],interval:true,intervalAtNode:true});h.selectControl('node',h.source.displayIntervals![0].anchor.reverse?1:0);
 expect(h.element('drawing-display-grip').props['data-geometry-priority']).toBe(true);expect(h.element('drawing-display-grip').props.pointerEvents).toBe('none');
 h.intervalDown(1);expect(h.element('drawing-display-grip').props['data-geometry-priority']).toBe(false);expect(h.historyCount()).toBe(0);h.key('Escape');
});


test.each([false,true])('actual Recording workspace reuses accepted interval targets after a layer-to-grip selection transition (correction=%s)',correction=>{
 const h=recordingWorkspaceHarness(correction,true),before=h.drawing(),library=JSON.stringify(h.project.recordingSnapshots.library),authors=vi.spyOn(snapshotProperties,'prepareSnapshotDrawingPropertyEdit');
 h.selectLayer();const start=h.materialPoint(before.displayIntervals![0].ranges[0].end),target=h.materialPoint(.8);h.intervalDown(start);expect(useEditor.getState().past).toHaveLength(0);
 h.move(target);const accepted=h.props().drawing;expect(accepted.displayIntervals![0].ranges[0].end).toBeCloseTo(.8,3);const calls=authors.mock.calls.length;expect(calls).toBe(1);
 h.up(target);h.up(target);expect(authors.mock.calls.length).toBe(calls);expect(useEditor.getState().past).toHaveLength(1);expect(h.drawing().displayIntervals![0].ranges[0].end).toBeCloseTo(.8,3);expect(h.drawing().curves).toEqual(before.curves);expect(h.drawing().nodes).toEqual(before.nodes);expect(JSON.stringify(useEditor.getState().project.recordingSnapshots!.library)).toBe(library);expect(useEditor.getState().project.recordingSnapshots!.recordings[0].snapshotIds).toHaveLength(2);
 useEditor.getState().undo();h.render();expect(h.drawing().displayIntervals).toEqual(before.displayIntervals);authors.mockRestore();
});


test('Recording ink endpoint selection retires same-curve geometry focus before keyboard editing',()=>{
 const h=harness('Recording',{tool:'direct',selected:['a'],interval:true});h.selectControl('node');h.inkDown();expect(h.selection().inkEnd?.id).toBe('a');h.key('ArrowUp');h.key('ArrowUp','keyup');expect(h.historyCount()).toBe(0);expect(h.shown()).toBe(h.source);expect(h.legacyCurveCommit).not.toHaveBeenCalled();
});
