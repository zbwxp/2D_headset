import {isValidElement,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {emptyDrawing} from '../domain/drawing/model';
import {createWarpGrid,type WarpGrid} from '../domain/vectorWarp/model';
import SceneWarpCanvas,{recordingWarpNudgeDelta} from '../ui/vectorRecording/SceneWarpCanvas';

// Exercise the real component's actions and keyboard handlers without a browser.
const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{hooks.states[i]=typeof next==='function'?next(hooks.states[i]):next;}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),
 useMemo:(fn:()=>unknown)=>fn(),useEffect:(fn:()=>void)=>{hooks.effects.push(fn);},
}));
vi.mock('../ui/drawing/session',async importOriginal=>{const actual=await importOriginal<typeof import('../ui/drawing/session')>();return {...actual,useDrawing:Object.assign((selector:(state:ReturnType<typeof actual.useDrawing.getState>)=>unknown)=>selector(actual.useDrawing.getState()),actual.useDrawing)};});
class Target {constructor(readonly tag='svg'){}closest(selector:string){return selector.split(',').includes(this.tag)?this:null;}}
const listeners=new Map<string,(e:unknown)=>void>();
beforeEach(()=>{hooks.states=[];hooks.refs=[];listeners.clear();vi.stubGlobal('Element',Target);vi.stubGlobal('window',{addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners.set(name,fn),removeEventListener:()=>{}});});
afterEach(()=>vi.unstubAllGlobals());
type ElementProps={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<ElementProps>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<ElementProps>(tree))return [];return [tree,...elements(tree.props.children)];}
function harness(editEnabled=true){
 const source=emptyDrawing(),grid=createWarpGrid({min:[-1,-1],max:[1,1]},2,2),preview=vi.fn(),commit=vi.fn(),focus=vi.fn(),svg={focus,setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<ElementProps>[]=[];
 const render=()=>{hooks.stateIndex=0;hooks.refIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing:source,grid,targetKey:'test',label:'Test',zh:false,editEnabled,onPreview:preview,onCommit:commit}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.at(-1)!();};render();
 return {grid,source,preview,commit,focus,render,button:(name:string)=>all.find(e=>e.type==='button'&&e.props.children===name)!,nodes:()=>all.filter(e=>e.props['data-testid']==='vr-node')};
}
function key(name:string,target=new Target(),modifiers:Partial<KeyboardEvent>={}){return {key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target,preventDefault:vi.fn(),...modifiers};}

test.each(['Row','Column','Nodes'].flatMap(mode=>[{mode,shortcut:false},{mode,shortcut:true}]))('All nodes from $mode (shortcut=$shortcut) focuses the canvas and survives the next node drag',({mode,shortcut})=>{
 const h=harness();if(!shortcut){h.button('Grid').props.onClick();h.render();expect(h.nodes()).toHaveLength(0);}h.button(mode).props.onClick();h.render();if(shortcut)listeners.get('keydown')!(key('a',new Target(),{ctrlKey:true}));else h.button('All nodes').props.onClick();h.render();expect(h.button('Nodes').props['aria-pressed']).toBe(true);expect(h.focus).toHaveBeenCalledWith({preventScroll:true});expect(h.nodes()).toHaveLength(9);expect(h.nodes().every(n=>n.props['data-selected'])).toBe(true);
 h.nodes()[4].props.onPointerDown({button:0,pointerId:1,clientX:400,clientY:325,shiftKey:false,stopPropagation:vi.fn(),preventDefault:vi.fn()});h.render();expect(h.nodes().every(n=>n.props['data-selected'])).toBe(true);
});
test('repeated arrows preview one Warp transaction; keyup commits once and both handles follow every node',()=>{
 const h=harness(),before=JSON.stringify(h.source);h.button('All nodes').props.onClick();h.render();const down=key('ArrowRight');listeners.get('keydown')!(down);listeners.get('keydown')!(down);expect(h.commit).not.toHaveBeenCalled();expect(h.preview).toHaveBeenCalledTimes(2);listeners.get('keyup')!(key('ArrowRight'));expect(h.commit).toHaveBeenCalledTimes(1);
 const next=h.commit.mock.calls[0][0] as WarpGrid,dx=next.nodes[0].position[0]-h.grid.nodes[0].position[0];expect(dx).toBeGreaterThan(0);for(let i=0;i<next.nodes.length;i++)for(const property of ['position','handleU','handleV'] as const){expect(next.nodes[i][property][0]-h.grid.nodes[i][property][0]).toBeCloseTo(dx,12);expect(next.nodes[i][property][1]).toBe(h.grid.nodes[i][property][1]);}expect(JSON.stringify(h.source)).toBe(before);
 listeners.get('keyup')!(key('ArrowRight'));expect(h.commit).toHaveBeenCalledTimes(1);
});
test('Alt arrow reaches the fine nudge handler while Ctrl/Meta and focused UI controls remain excluded',()=>{
 const h=harness();h.button('All nodes').props.onClick();h.render();for(const tag of ['input','select','textarea','button']){listeners.get('keydown')!(key('ArrowRight',new Target(tag),{altKey:true}));listeners.get('keyup')!(key('ArrowRight'));}for(const modifier of [{ctrlKey:true},{metaKey:true}])listeners.get('keydown')!(key('ArrowRight',new Target(),modifier));expect(h.preview).not.toHaveBeenCalled();
 listeners.get('keydown')!(key('ArrowRight',new Target(),{altKey:true}));listeners.get('keyup')!(key('ArrowRight'));expect(h.commit).toHaveBeenCalledTimes(1);
});
test('unestablished preview angle permits All nodes selection without preview or commit',()=>{
 const h=harness(false);h.button('All nodes').props.onClick();h.render();expect(h.nodes().every(n=>n.props['data-selected'])).toBe(true);for(const modifiers of [{},{shiftKey:true},{altKey:true}]){listeners.get('keydown')!(key('ArrowUp',new Target(),modifiers));listeners.get('keyup')!(key('ArrowUp'));}expect(h.preview).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();
});
test.each([{shiftKey:false,altKey:false,pixels:1},{shiftKey:true,altKey:false,pixels:10},{shiftKey:false,altKey:true,pixels:.1},{shiftKey:true,altKey:true,pixels:10}])('arrow modifiers give $pixels screen pixels with Shift precedence',({pixels,...modifiers})=>{
 const event={key:'ArrowRight',ctrlKey:false,metaKey:false,...modifiers};for(const unit of [50,250,1000]){expect(recordingWarpNudgeDelta(event,unit)).toEqual([pixels/unit,0]);expect(recordingWarpNudgeDelta({...event,key:'ArrowUp'},unit)).toEqual([0,pixels/unit]);expect(recordingWarpNudgeDelta({...event,key:'ArrowDown'},unit)).toEqual([0,-pixels/unit]);}
});
