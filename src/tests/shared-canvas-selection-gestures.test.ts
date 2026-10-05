import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
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
import SceneWarpCanvas from '../ui/vectorRecording/SceneWarpCanvas';
import SceneInstanceTransformBox,{type RecordingInstanceTransform} from '../ui/vectorRecording/SceneInstanceTransformBox';
import type {DrawingCommandIntent} from '../ui/drawing/endpointInteraction';

// Execute the actual canvas handlers and effects without a browser renderer.
// Both consumers retain their real selection policy and geometry commands.
const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],deps:[] as (unknown[]|undefined)[],cleanups:[] as ((()=>void)|void)[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0,dirty:false}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{const value=typeof next==='function'?next(hooks.states[i]):next;if(!Object.is(value,hooks.states[i])){hooks.states[i]=value;hooks.dirty=true;}}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),
 useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown)=>fn(),useContext:(context:{_currentValue:unknown})=>context._currentValue,
 useSyncExternalStore:(_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot(),useDebugValue:()=>{},
 useEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.effectIndex++,previous=hooks.deps[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous[j]))){hooks.deps[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn();});}},
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
 if(tree.type===SceneInstanceTransformBox)return elements(SceneInstanceTransformBox(tree.props as ComponentProps<typeof SceneInstanceTransformBox>));
 return [tree,...elements(tree.props.children)];
}
class Target {closest(){return null;}}
const listeners=new Map<string,Set<(event:any)=>void>>();
const savedEditor=useEditor.getState(),savedSession=useDrawing.getState(),savedMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{
 hooks.states=[];hooks.refs=[];hooks.deps=[];hooks.cleanups=[];listeners.clear();
 const events={addEventListener:(name:string,fn:(event:any)=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:(event:any)=>void)=>listeners.get(name)?.delete(fn)};
 vi.stubGlobal('Element',Target);vi.stubGlobal('window',{...events,innerWidth:1000,innerHeight:800,dispatchEvent:(event:Event)=>{emit(event.type,event);return true;}});
 vi.stubGlobal('document',{...events,body:{},hidden:false});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 useWorkspaceMode.setState({mode:'drawing'});
 useDrawing.setState({...savedSession,tool:'select',selection:{ids:[]},layerId:'layer',zoom:1,pan:[0,0],preview:false});
});
afterEach(()=>{hooks.cleanups.forEach(fn=>fn?.());vi.unstubAllGlobals();useEditor.setState(savedEditor,true);useDrawing.setState(savedSession,true);useWorkspaceMode.setState({mode:savedMode});});
const pointer=(point:Point2,shiftKey=false)=>({button:0,buttons:1,pointerId:1,pointerType:'mouse',clientX:point[0],clientY:point[1],shiftKey,altKey:true,ctrlKey:false,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const emit=(name:string,event:unknown)=>[...(listeners.get(name)??[])].forEach(fn=>fn(event));
const near=(actual:Point2,expected:Point2)=>actual.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],9));
type Options={tool?:'select'|'direct';selected?:string[];mirrored?:boolean;hiddenContinuation?:boolean;lockedGroup?:boolean};
function fixture(options:Options):DrawingDocument {
 let drawing=emptyDrawing();drawing.layers=[{id:'layer',name:'Outline',visible:true,locked:false,items:[]}];
 const curves:Record<string,Cubic>={a:[[-1,-.4],[-.9,-.2],[-.7,-.2],[-.6,-.4]],b:[[-.3,-.4],[-.2,-.2],[0,-.2],[.1,-.4]],c:[[-.3,.4],[-.2,.6],[0,.6],[.1,.4]],mirror:[[1,-.4],[.9,-.2],[.7,-.2],[.6,-.4]]};
 for(const [id,shape] of Object.entries(curves))drawing=createCurve(drawing,'layer',shape,.02,id,id);
 if(options.mirrored)drawing.mirrorEditing={enabled:true,curvePairs:[{id:'pair',a:'a',b:'mirror',reverse:false}]};
 if(options.hiddenContinuation){drawing=connect(drawing,{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');drawing.curves.find(c=>c.id==='b')!.visible=false;}
 if(options.lockedGroup){drawing.groups=[{id:'group',name:'Complete group',curveIds:['a','b'],visible:true,locked:false}];drawing.curves.find(c=>c.id==='b')!.locked=true;}
 return drawing;
}

function harness(consumer:'Drawing'|'Recording',options:Options={}){
 const source=fixture(options),project={...createEmptyProject(),drawing:source,recordingSnapshots:undefined};
 useEditor.setState({project,past:[],future:[]});
 useDrawing.setState({tool:options.tool??'select',selection:{ids:options.selected??[]}});
 let drawing=source,shown=drawing,historyKey={},tool:DrawingTool=options.tool??'select',selection:DrawingSelection={ids:options.selected??[]},all:ReactElement<Props>[]=[];
 const error=vi.fn(),commit=vi.fn((before:DrawingDocument,next:DrawingDocument,_intent?:DrawingCommandIntent)=>{expect(before).toBe(drawing);drawing=next;shown=next;historyKey={};return historyKey;}),preview=vi.fn((before:DrawingDocument,next:DrawingDocument|null)=>{expect(before).toBe(drawing);shown=next??drawing;return true;});
 const transformPreview=vi.fn(),transformCommit=vi.fn(),legacyCurveCommit=vi.fn();
 const transform=(ids:string[]):RecordingInstanceTransform|undefined=>{const bounds=selectionBounds(drawing,ids);return bounds?{ids,bounds,allowCurveSelection:true,editable:ids.every(id=>transformable(drawing,id,ids)),label:'Selection',onPreview:transformPreview,onCommit:transformCommit}:undefined;};
 const choose=(next:DrawingSelection,mode?:DrawingTool)=>{const transition=chooseDrawingSelection(tool,next,mode);selection=transition.selection;tool=transition.tool;};
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};
 function render(){
  let count=0;do{
   hooks.dirty=false;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];
   all=elements(consumer==='Drawing'?DrawingRoom():SceneWarpCanvas({source,drawing:shown,targetKey:'view',label:'Test',zh:false,onPreview:vi.fn(),onCommit:vi.fn(),showWarpTools:false,selection,onSelectionTool:choose,interaction:{tool,onToolChange:next=>{tool=next;}},instanceTransform:transform(selection.ids),transformsForSelection:transform,curveEdit:{editable:true,onCommit:legacyCurveCommit,onPreview:vi.fn()},topology:{editable:true,onSplit:vi.fn(),editor:{drawing,targetKey:'view',historyKey,layerId:'layer',editable:true,topologyEditable:true,onCommit:commit,onPreview:preview,onSelection:choose,onError:error}}}));
   element(consumer==='Drawing'?'drawing-canvas':'vr-scene-canvas').props.ref.current=svg;
   hooks.effects.forEach(fn=>fn());if(++count>12)throw Error('Canvas effects did not settle');
  }while(hooks.dirty);
 }
 const element=(testId:string)=>all.find(e=>e.props['data-testid']===testId)!;
 const canvas=()=>element(consumer==='Drawing'?'drawing-canvas':'vr-scene-canvas');
 const paint=()=>all.find(e=>e.props.curveDown)!;
 render();preview.mockClear();
 return {
  source,render,element,paint,commit,preview,error,transformPreview,transformCommit,legacyCurveCommit,
  drawing:()=>consumer==='Drawing'?useEditor.getState().project.drawing!:drawing,
  shown:()=>paint().props.d as DrawingDocument,
  selection:()=>consumer==='Drawing'?useDrawing.getState().selection:selection,
  tool:()=>consumer==='Drawing'?useDrawing.getState().tool:tool,
  historyCount:()=>consumer==='Drawing'?useEditor.getState().past.length:commit.mock.calls.length,
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
