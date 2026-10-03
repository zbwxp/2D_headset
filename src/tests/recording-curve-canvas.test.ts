import DeformCageOverlay from '../ui/drawing/DeformCageOverlay';
import type {LayerCageDomainIntent} from '../domain/drawing/layerDomainIntent';
import {deformDrawing} from '../domain/drawing/deform';
import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createWarpGrid} from '../domain/vectorWarp/model';
import SceneWarpCanvas,{type RecordingCurveEdit} from '../ui/vectorRecording/SceneWarpCanvas';
import SceneCurveEditOverlay from '../ui/vectorRecording/SceneCurveEditOverlay';
import SceneInstanceTransformBox from '../ui/vectorRecording/SceneInstanceTransformBox';
import {chooseDrawingSelection,selectDrawingTool} from '../ui/drawing/interactionController';
import {selectionBounds} from '../ui/drawing/geometry';
import type {DrawingSelection} from '../ui/drawing/session';
import {useDrawing} from '../ui/drawing/session';

const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],deps:[] as (unknown[]|undefined)[],cleanups:[] as ((()=>void)|void)[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0,dirty:false}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{const value=typeof next==='function'?next(hooks.states[i]):next;if(!Object.is(value,hooks.states[i])){hooks.states[i]=value;hooks.dirty=true;}}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown)=>fn(),
 useEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.effectIndex++,previous=hooks.deps[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous[j]))){hooks.deps[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn();});}},
}));
vi.mock('../ui/drawing/session',async original=>{const actual=await original<typeof import('../ui/drawing/session')>();return {...actual,useDrawing:Object.assign((selector:(state:ReturnType<typeof actual.useDrawing.getState>)=>unknown)=>selector(actual.useDrawing.getState()),actual.useDrawing)};});
class Target {constructor(readonly tag='svg'){}closest(selector:string){return selector.split(',').includes(this.tag)?this:null;}}
const listeners=new Map<string,(event:unknown)=>void>();
beforeEach(()=>{hooks.states=[];hooks.refs=[];hooks.deps=[];hooks.cleanups=[];listeners.clear();vi.stubGlobal('Element',Target);vi.stubGlobal('window',{addEventListener:(name:string,fn:(event:unknown)=>void)=>listeners.set(name,fn),removeEventListener:(name:string,fn:unknown)=>{if(listeners.get(name)===fn)listeners.delete(name);}});});
afterEach(()=>vi.unstubAllGlobals());
type Props={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];if(tree.type===DeformCageOverlay)return elements(DeformCageOverlay(tree.props as ComponentProps<typeof DeformCageOverlay>));if(tree.type===SceneInstanceTransformBox)return elements(SceneInstanceTransformBox(tree.props as ComponentProps<typeof SceneInstanceTransformBox>));if(tree.type===SceneCurveEditOverlay)return elements(SceneCurveEditOverlay(tree.props as ComponentProps<typeof SceneCurveEditOverlay>));return [tree,...elements(tree.props.children)];}
function fixture():DrawingDocument{
 const d=emptyDrawing();d.nodes=[{id:'instance/node-a',position:[-1,0]},{id:'instance/shared',position:[0,0]},{id:'instance/node-b',position:[1,0]}];
 d.curves=[{id:'instance/curve-a',name:'A',nodes:['instance/node-a','instance/shared'],handles:[[-1,0],[-.4,0]],visible:true,locked:false,width:.01},{id:'instance/curve-b',name:'B',nodes:['instance/shared','instance/node-b'],handles:[[.4,0],[.75,0]],visible:true,locked:false,width:.01}];
 d.layers=[{id:'instance/layer',name:'Layer',visible:true,locked:false,items:d.curves.map(c=>c.id)}];d.joins=[{id:'instance/arc',a:{curveId:'instance/curve-a',end:1},b:{curveId:'instance/curve-b',end:0},mode:'ARC',radius:.1}];return d;
}
function harness(options:{editable?:boolean;grid?:boolean;inspectionHideFills?:boolean;controlledLayer?:boolean;topology?:boolean;cage?:boolean}={}){
 const source=fixture(),preview=vi.fn(),commit=vi.fn(),warpPreview=vi.fn(),warpCommit=vi.fn(),select=vi.fn();let drawing=source,targetKey='view-0',revealGridKey=0;
 let chosen:DrawingSelection={ids:source.curves.map(c=>c.id),...(options.controlledLayer||options.cage?{layer:'instance/layer',layers:['instance/layer']}: {})},chosenTool:'select'|'direct'|'hand'|'zoom'|'split'|'pen'|'link'|'deform'=options.cage?'deform':options.controlledLayer?'select':'direct';const controlSelection=vi.fn();
 const cagePreview=vi.fn((intent:LayerCageDomainIntent|null)=>{drawing=intent?deformDrawing(source,chosen.ids,intent.domain.restRect,intent.domain.quad,false,intent.domain.bend).document:source;return true;}),cageCommit=vi.fn(),cageError=vi.fn(),cageAdapter={drawing:source,domains:[],targetKey:'basis/layer',historyKey:source,editable:true,maxError:0,onPreview:cagePreview,onCommit:cageCommit,onError:cageError};
 const splitCommit=vi.fn();const curveEdit={editable:options.editable??true,onPreview:preview,onCommit:commit,onSelect:controlSelection},grid=options.grid?createWarpGrid({min:[-1,-1],max:[1,1]},2,2):undefined;
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{let count=0;do{hooks.dirty=false;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing,grid,curveEdit,...(options.cage?{cageEdit:cageAdapter,interaction:{tool:chosenTool,onToolChange:next=>{chosenTool=next;}}}:{}),...(options.topology?{topology:{editable:options.editable??true,onSplit:splitCommit}}:{}),...(options.controlledLayer?{interaction:{tool:chosenTool,onToolChange:(tool:typeof chosenTool)=>{const transition=selectDrawingTool(tool,chosen);chosenTool=tool;chosen=transition.selection;}},instanceTransform:{ids:['instance/layer'],label:'Selected layers',bounds:selectionBounds(drawing,chosen.ids)!,editable:options.editable??true,onPreview:warpPreview,onCommit:warpCommit}}:{}),inspectionHideFills:options.inspectionHideFills,targetKey,revealGridKey,label:'Test',zh:false,selection:chosen,editEnabled:!!grid,onPreview:warpPreview,onCommit:warpCommit,onSelection:select}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.forEach(fn=>fn());if(++count>8)throw Error('Effects did not settle');}while(hooks.dirty);};render();preview.mockClear();warpPreview.mockClear();
 return {cagePreview,cageCommit,cageError,splitCommit,source,preview,commit,warpPreview,warpCommit,select,svg,render,controlSelection,getSelection:()=>chosen,chooseLayer:()=>{const transition=chooseDrawingSelection(chosenTool,{ids:source.curves.map(c=>c.id),layer:'instance/layer',layers:['instance/layer']});chosen=transition.selection;chosenTool=transition.tool as typeof chosenTool;revealGridKey++;render();},setDrawing:(d:DrawingDocument)=>{drawing=d;render();},navigate:()=>{targetKey='view-1';render();},reveal:()=>{revealGridKey++;render();},readonly:()=>{curveEdit.editable=false;render();},element:(id:string)=>all.find(e=>e.props['data-testid']===id)!,findAll:(id:string)=>all.filter(e=>e.props['data-testid']===id),paint:()=>all.find(e=>!!e.props.curveDown)!};
}
const pointer=(clientX:number,clientY:number)=>({button:0,pointerId:1,clientX,clientY,shiftKey:false,altKey:true,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const key=(name:string,tag='svg',modifiers:Partial<KeyboardEvent>={})=>({key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target:new Target(tag),preventDefault:vi.fn(),...modifiers});
const xy=(element:ReactElement<Props>):Point2=>element.type==='rect'?[element.props.x+4,element.props.y+4]:[element.props.cx,element.props.cy];
const move=(h:ReturnType<typeof harness>,p:Point2)=>h.element('vr-scene-canvas').props.onPointerMove(pointer(...p));
const release=(h:ReturnType<typeof harness>,p:Point2)=>h.element('vr-scene-canvas').props.onPointerUp(pointer(...p));

test('selected curves reveal A, shared true endpoints, and both handles even across ARC trim',()=>{
 const h=harness();expect(h.element('vr-scene-canvas').props['data-tool']).toBe('direct');expect(h.svg.focus).toHaveBeenCalledWith({preventScroll:true});expect(h.findAll('vr-curve-node')).toHaveLength(3);expect(h.findAll('vr-curve-handle')).toHaveLength(4);expect(h.findAll('vr-curve-handle')[0].props['data-short']).toBe(true);
 const shared=h.findAll('vr-curve-node').find(e=>e.props['data-node']==='instance/shared')!;expect(xy(shared)).toEqual([400,325]);expect(h.findAll('vr-curve-edit-overlay')).toHaveLength(1);
 h.element('vr-tool-select').props.onClick();h.render();expect(h.findAll('vr-curve-node')).toHaveLength(0);h.reveal();expect(h.findAll('vr-curve-node')).toHaveLength(3);
});
test.each(['node','handle'])('%s drag preserves the pointer offset and frozen start through evaluated pose renders, with one release commit',kind=>{
 const h=harness(),before=JSON.stringify(h.source),control=h.element(`vr-curve-${kind}`),p=xy(control),grab:Point2=[p[0]+3,p[1]+2],unit=(xy(h.findAll('vr-curve-node')[2])[0]-p[0])/2;
 control.props.onPointerDown(pointer(...grab));move(h,[grab[0]+20,grab[1]-10]);expect(h.commit).not.toHaveBeenCalled();const first=h.preview.mock.calls.at(-1)![0] as RecordingCurveEdit;expect(first.position[0]).toBeCloseTo(-1+20/unit,10);expect(first.position[1]).toBeCloseTo(10/unit,10);
 const evaluated=structuredClone(h.source);if(first.kind==='node')evaluated.nodes.find(n=>n.id===first.nodeId)!.position=first.position;else evaluated.curves.find(c=>c.id===first.curveId)!.handles[first.end]=first.position;h.setDrawing(evaluated);move(h,[grab[0]+30,grab[1]-20]);const next=h.preview.mock.calls.at(-1)![0] as RecordingCurveEdit;expect(next.position[0]).toBeCloseTo(-1+30/unit,10);expect(next.position[1]).toBeCloseTo(20/unit,10);
 release(h,[grab[0]+30,grab[1]-20]);release(h,[grab[0]+30,grab[1]-20]);expect(h.commit).toHaveBeenCalledExactlyOnceWith(next);expect(h.preview).toHaveBeenLastCalledWith(null);expect(h.warpCommit).not.toHaveBeenCalled();expect(JSON.stringify(h.source)).toBe(before);
});
test.each(['escape','cancel','lost','navigate','blur','tool','readonly','unmount'])('%s discards the pose preview and prevents a stale release commit',action=>{
 const h=harness(),control=h.element('vr-curve-node'),p=xy(control);control.props.onPointerDown(pointer(...p));move(h,[p[0]+30,p[1]]);expect(h.preview.mock.calls.at(-1)![0]).not.toBeNull();
 if(action==='escape')listeners.get('keydown')!(key('Escape'));else if(action==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();else if(action==='lost')h.element('vr-scene-canvas').props.onLostPointerCapture();else if(action==='navigate')h.navigate();else if(action==='blur')listeners.get('blur')!({});else if(action==='readonly')h.readonly();else if(action==='unmount')hooks.cleanups.forEach(fn=>fn?.());else{h.element('vr-tool-select').props.onClick();h.render();}
 release(h,[p[0]+30,p[1]]);expect(h.commit).not.toHaveBeenCalled();expect(h.preview).toHaveBeenLastCalledWith(null);
});
test('a view-only pose displays and selects controls without preview or commit',()=>{
 const h=harness({editable:false}),control=h.element('vr-curve-node'),p=xy(control);control.props.onPointerDown(pointer(...p));h.render();move(h,[p[0]+20,p[1]]);release(h,[p[0]+20,p[1]]);listeners.get('keydown')!(key('ArrowRight'));listeners.get('keyup')!(key('ArrowRight'));expect(h.preview).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();expect(h.element('vr-curve-node').props['data-active']).toBe(true);
});
test('active Warp retains A controls and empty canvas never translates selected curves',()=>{
 const h=harness({grid:true});h.element('vr-tool-direct').props.onClick();h.render();expect(h.findAll('vr-curve-node')).toHaveLength(0);expect(h.findAll('vr-node')).toHaveLength(9);h.element('vr-scene-canvas').props.onPointerDown(pointer(2000,2000));move(h,[2010,2010]);release(h,[2010,2010]);expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();
});
test('actual curve ink selects the compiled curve while blank area only changes selection',()=>{
 const h=harness();h.paint().props.curveDown(pointer(400,325),'instance/curve-a');expect(h.select).toHaveBeenLastCalledWith({ids:['instance/curve-a'],group:undefined});h.element('vr-scene-canvas').props.onPointerDown(pointer(2000,2000));move(h,[2010,2010]);release(h,[2010,2010]);expect(h.preview).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();
});
test('held arrows use 1/10/.1 screen pixels and commit once, without taking control shortcuts',()=>{
 const h=harness(),control=h.element('vr-curve-node'),p=xy(control),unit=(xy(h.findAll('vr-curve-node')[2])[0]-p[0])/2;control.props.onPointerDown(pointer(...p));release(h,p);h.render();h.preview.mockClear();
 for(const tag of ['input','select','textarea','button'])listeners.get('keydown')!(key('ArrowRight',tag));for(const modifiers of [{ctrlKey:true},{metaKey:true}])listeners.get('keydown')!(key('ArrowRight','svg',modifiers));expect(h.preview).not.toHaveBeenCalled();
 listeners.get('keydown')!(key('ArrowRight'));listeners.get('keydown')!(key('ArrowRight','svg',{shiftKey:true}));listeners.get('keydown')!(key('ArrowRight','svg',{altKey:true}));const next=h.preview.mock.calls.at(-1)![0] as RecordingCurveEdit;expect(next.position[0]).toBeCloseTo(-1+11.1/unit,10);expect(h.commit).not.toHaveBeenCalled();listeners.get('keyup')!(key('ArrowRight'));expect(h.commit).toHaveBeenCalledExactlyOnceWith(next);
});

test('onion inspection suppresses current fills and layer overrides without changing the saved preview toggles',()=>{const prior=useDrawing.getState();try{useDrawing.getState().set({showFills:true,fillVisibility:{'instance/layer':true}});const h=harness({inspectionHideFills:true});expect(h.paint().props.showFills).toBe(false);expect(h.paint().props.fillVisibility).toBeUndefined();expect(h.element('vr-show-fills').props.disabled).toBe(true);expect(useDrawing.getState().showFills).toBe(true);expect(useDrawing.getState().fillVisibility).toEqual({'instance/layer':true});}finally{useDrawing.setState(prior,true);}});


test('shared controlled layer selection keeps V union box, allows A controls and clears focus in Z without losing members',()=>{
 const h=harness({controlledLayer:true}),before=JSON.stringify(h.source);
 expect(h.element('vr-scene-canvas').props['data-tool']).toBe('select');expect(h.element('vr-instance-transform-box')).toBeDefined();expect(h.findAll('vr-curve-node')).toHaveLength(0);
 h.element('vr-tool-direct').props.onClick();h.render();expect(h.element('vr-instance-transform-box')).toBeUndefined();expect(h.findAll('vr-curve-node')).toHaveLength(3);
 const control=h.element('vr-curve-handle'),p=xy(control);control.props.onPointerDown(pointer(...p));release(h,p);h.render();expect(h.findAll('vr-curve-handle').some(e=>e.props['data-active'])).toBe(true);
 listeners.get('keydown')!(key('z'));h.render();expect(h.element('vr-scene-canvas').props['data-tool']).toBe('zoom');expect(h.controlSelection).toHaveBeenLastCalledWith(null);expect(h.getSelection().ids).toEqual(h.source.curves.map(c=>c.id));expect(h.getSelection().layers).toEqual(['instance/layer']);
 h.setDrawing({...h.source,nodes:[...h.source.nodes]});expect(h.element('vr-scene-canvas').props['data-tool']).toBe('zoom');
 listeners.get('keydown')!(key('a'));h.render();expect(h.findAll('vr-curve-handle').some(e=>e.props['data-active'])).toBe(false);expect(h.findAll('vr-curve-node')).toHaveLength(3);
 listeners.get('keydown')!(key('v'));h.render();expect(h.element('vr-instance-transform-box')).toBeDefined();expect(h.getSelection().ids).toEqual(h.source.curves.map(c=>c.id));
 h.element('vr-tool-zoom').props.onClick();h.render();h.chooseLayer();expect(h.element('vr-scene-canvas').props['data-tool']).toBe('select');expect(h.element('vr-instance-transform-box')).toBeDefined();
 expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();expect(JSON.stringify(h.source)).toBe(before);
});

test('controlled Recording shares keyboard/button tool transitions and ignores typing or graph focus',()=>{
 const h=harness({controlledLayer:true});
 for(const tag of ['input','select','textarea','[data-ui-keyboard]']){listeners.get('keydown')!(key('z',tag));h.render();expect(h.element('vr-scene-canvas').props['data-tool']).toBe('select');}
 h.element('vr-tool-direct').props.onClick();h.render();const control=h.element('vr-curve-node'),p=xy(control);control.props.onPointerDown(pointer(...p));release(h,p);h.render();
 h.element('vr-tool-hand').props.onClick();h.render();expect(h.controlSelection).toHaveBeenLastCalledWith(null);expect(h.findAll('vr-curve-node')).toHaveLength(0);
 h.element('vr-tool-direct').props.onClick();h.render();expect(h.findAll('vr-curve-node').some(e=>e.props['data-active'])).toBe(false);
});

test('real-snapshot split tool sends one native curve parameter to the shared topology transaction',()=>{
 const h=harness({controlledLayer:true,topology:true});h.element('vr-tool-split').props.onClick();h.render();
 expect(h.element('vr-scene-canvas').props['data-tool']).toBe('split');const point:Point2=h.paint().props.screen([-.65,0]);h.paint().props.curveDown(pointer(...point),'instance/curve-a');
 expect(h.splitCommit).toHaveBeenCalledTimes(1);expect(h.splitCommit.mock.calls[0][0]).toBe('instance/curve-a');expect(h.splitCommit.mock.calls[0][1]).toBeGreaterThan(0);expect(h.splitCommit.mock.calls[0][1]).toBeLessThan(1);expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();
});
test('correction preview exposes the same split tool disabled until a real snapshot exists',()=>{
 const h=harness({controlledLayer:true,topology:true,editable:false});expect(h.element('vr-tool-split').props.disabled).toBe(true);expect(h.splitCommit).not.toHaveBeenCalled();
});


test('shared Recording cage gesture keeps one frozen world frame through previews and commits one explicit layer domain',()=>{
 const h=harness({cage:true}),control=h.findAll('drawing-deform-corner')[2],p:Point2=[control.props.x+6,control.props.y+6];
 control.props.onPointerDown(pointer(p[0]+2,p[1]+3));move(h,[p[0]+22,p[1]-7]);h.render();const first=h.cagePreview.mock.calls.at(-1)![0]!;expect(first.scope.layerIds).toEqual(['instance/layer']);expect(h.cageCommit).not.toHaveBeenCalled();
 move(h,[p[0]+32,p[1]-17]);h.render();const second=h.cagePreview.mock.calls.at(-1)![0]!;expect(second.operationId).toBe(first.operationId);expect(second.domain.restRect).toEqual(first.domain.restRect);expect(second.domain.quad[2][0]-first.domain.quad[2][0]).toBeCloseTo(10/h.paint().props.unit,10);expect(second.domain.quad[2][1]-first.domain.quad[2][1]).toBeCloseTo(10/h.paint().props.unit,10);
 release(h,[p[0]+32,p[1]-17]);release(h,[p[0]+32,p[1]-17]);expect(h.cageCommit).toHaveBeenCalledExactlyOnceWith(second);expect(h.cagePreview).toHaveBeenLastCalledWith(null);expect(h.cageError).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();
});
test.each(['cancel','lost','navigate','escape','tool'])('%s discards an active Recording cage preview',action=>{
 const h=harness({cage:true}),control=h.findAll('drawing-deform-bend-handle')[0],p:Point2=[control.props.cx,control.props.cy];control.props.onPointerDown(pointer(...p));move(h,[p[0]+15,p[1]-10]);h.render();
 if(action==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();else if(action==='lost')h.element('vr-scene-canvas').props.onLostPointerCapture();else if(action==='navigate')h.navigate();else if(action==='escape')listeners.get('keydown')!(key('Escape'));else{h.element('vr-tool-direct').props.onClick();h.render();}
 release(h,[p[0]+15,p[1]-10]);expect(h.cageCommit).not.toHaveBeenCalled();expect(h.cagePreview).toHaveBeenLastCalledWith(null);
});
