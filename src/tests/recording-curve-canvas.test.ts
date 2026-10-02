import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createWarpGrid} from '../domain/vectorWarp/model';
import SceneWarpCanvas,{type RecordingCurveEdit} from '../ui/vectorRecording/SceneWarpCanvas';
import SceneCurveEditOverlay from '../ui/vectorRecording/SceneCurveEditOverlay';

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
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];if(tree.type===SceneCurveEditOverlay)return elements(SceneCurveEditOverlay(tree.props as ComponentProps<typeof SceneCurveEditOverlay>));return [tree,...elements(tree.props.children)];}
function fixture():DrawingDocument{
 const d=emptyDrawing();d.nodes=[{id:'instance/node-a',position:[-1,0]},{id:'instance/shared',position:[0,0]},{id:'instance/node-b',position:[1,0]}];
 d.curves=[{id:'instance/curve-a',name:'A',nodes:['instance/node-a','instance/shared'],handles:[[-1,0],[-.4,0]],visible:true,locked:false,width:.01},{id:'instance/curve-b',name:'B',nodes:['instance/shared','instance/node-b'],handles:[[.4,0],[.75,0]],visible:true,locked:false,width:.01}];
 d.layers=[{id:'instance/layer',name:'Layer',visible:true,locked:false,items:d.curves.map(c=>c.id)}];d.joins=[{id:'instance/arc',a:{curveId:'instance/curve-a',end:1},b:{curveId:'instance/curve-b',end:0},mode:'ARC',radius:.1}];return d;
}
function harness(options:{editable?:boolean;grid?:boolean}={}){
 const source=fixture(),preview=vi.fn(),commit=vi.fn(),warpPreview=vi.fn(),warpCommit=vi.fn(),select=vi.fn();let drawing=source,targetKey='view-0',revealGridKey=0;
 const curveEdit={editable:options.editable??true,onPreview:preview,onCommit:commit},grid=options.grid?createWarpGrid({min:[-1,-1],max:[1,1]},2,2):undefined;
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{let count=0;do{hooks.dirty=false;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing,grid,curveEdit,targetKey,revealGridKey,label:'Test',zh:false,selection:{ids:['instance/curve-a','instance/curve-b']},editEnabled:!!grid,onPreview:warpPreview,onCommit:warpCommit,onSelection:select}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.forEach(fn=>fn());if(++count>8)throw Error('Effects did not settle');}while(hooks.dirty);};render();preview.mockClear();warpPreview.mockClear();
 return {source,preview,commit,warpPreview,warpCommit,select,svg,render,setDrawing:(d:DrawingDocument)=>{drawing=d;render();},navigate:()=>{targetKey='view-1';render();},reveal:()=>{revealGridKey++;render();},readonly:()=>{curveEdit.editable=false;render();},element:(id:string)=>all.find(e=>e.props['data-testid']===id)!,findAll:(id:string)=>all.filter(e=>e.props['data-testid']===id),paint:()=>all.find(e=>!!e.props.curveDown)!};
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
