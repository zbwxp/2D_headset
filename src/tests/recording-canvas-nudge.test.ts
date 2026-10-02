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
 const source=emptyDrawing(),grid=createWarpGrid({min:[-1,-1],max:[1,1]},2,2),preview=vi.fn(),commit=vi.fn(),focus=vi.fn(),selectSource=vi.fn(),selectWarp=vi.fn(),svg={focus,setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<ElementProps>[]=[];
 const render=()=>{hooks.stateIndex=0;hooks.refIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing:source,grid,targetKey:'test',label:'Test',zh:false,editEnabled,onPreview:preview,onCommit:commit,onSelection:selectSource,onWarpSelection:selectWarp}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.at(-1)!();};render();
 return {grid,source,preview,commit,focus,selectSource,selectWarp,render,button:(name:string)=>all.find(e=>e.type==='button'&&e.props.children===name)!,nodes:()=>all.filter(e=>e.props['data-testid']==='vr-node'),element:(testId:string)=>all.find(e=>e.props['data-testid']===testId)!,find:(predicate:(e:ReactElement<ElementProps>)=>boolean)=>all.find(predicate)!};
}
function key(name:string,target=new Target(),modifiers:Partial<KeyboardEvent>={}){return {key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target,preventDefault:vi.fn(),...modifiers};}
function pointer(clientX=400,clientY=325,shiftKey=false){return {button:0,pointerId:1,clientX,clientY,shiftKey,altKey:true,stopPropagation:vi.fn(),preventDefault:vi.fn()};}

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

test('V selects and translates the entire active Warp without source selection or source mutation',()=>{
 const h=harness(),before=JSON.stringify(h.source);h.nodes()[4].props.onPointerDown(pointer());h.render();expect(h.nodes().every(n=>n.props['data-selected'])).toBe(true);expect(h.selectWarp).toHaveBeenCalledTimes(1);h.element('vr-scene-canvas').props.onPointerMove(pointer(425,315));h.element('vr-scene-canvas').props.onPointerUp(pointer(425,315));expect(h.commit).toHaveBeenCalledTimes(1);
 const next=h.commit.mock.calls[0][0] as WarpGrid,dx=next.nodes[0].position[0]-h.grid.nodes[0].position[0],dy=next.nodes[0].position[1]-h.grid.nodes[0].position[1];expect(dx).toBeGreaterThan(0);expect(dy).toBeGreaterThan(0);for(let i=0;i<next.nodes.length;i++)for(const property of ['position','handleU','handleV'] as const){expect(next.nodes[i][property][0]-h.grid.nodes[i][property][0]).toBeCloseTo(dx,12);expect(next.nodes[i][property][1]-h.grid.nodes[i][property][1]).toBeCloseTo(dy,12);}expect(h.selectSource).not.toHaveBeenCalled();expect(JSON.stringify(h.source)).toBe(before);
});
test('V uses a closed curved outline hit area and ignores artwork or empty clicks outside the active grid',()=>{
 const h=harness(),outline=h.element('vr-warp-hit');expect(outline.props.d.startsWith('M ')).toBe(true);expect(outline.props.d.endsWith(' Z')).toBe(true);expect(outline.props.d.match(/ C /g)).toHaveLength(8);expect(outline.props.pointerEvents).toBe('all');const paint=h.find(e=>!!e.props.curveDown);paint.props.curveDown(pointer(4000,4000),'other-source');paint.props.paintDown(pointer(4000,4000),'other-fill');
 const canvas=h.element('vr-scene-canvas');canvas.props.onPointerDown(pointer(4000,4000));h.render();h.element('vr-scene-canvas').props.onPointerMove(pointer(4020,4020));h.element('vr-scene-canvas').props.onPointerUp(pointer(4020,4020));expect(h.commit).not.toHaveBeenCalled();expect(h.selectWarp).not.toHaveBeenCalled();expect(h.selectSource).not.toHaveBeenCalled();expect(h.preview.mock.calls.every(([grid])=>grid===null)).toBe(true);
});
test('A selects one node, Shift toggles nodes, and an edge drag moves only its endpoint pair',()=>{
 const h=harness();h.element('vr-tool-direct').props.onClick();h.render();expect(h.element('vr-warp-hit').props.pointerEvents).toBe('none');h.nodes()[4].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();expect(h.nodes().filter(n=>n.props['data-selected'])).toHaveLength(1);
 h.nodes()[5].props.onPointerDown(pointer(420,325,true));h.element('vr-scene-canvas').props.onPointerUp(pointer(420,325,true));h.render();expect(h.nodes().filter(n=>n.props['data-selected'])).toHaveLength(2);h.nodes()[4].props.onPointerDown(pointer(400,325,true));h.render();expect(h.nodes().filter(n=>n.props['data-selected']).map(n=>n.props['data-index'])).toEqual([5]);
 h.element('vr-edge-hit').props.onPointerDown(pointer());h.render();expect(h.nodes().filter(n=>n.props['data-selected']).map(n=>n.props['data-index'])).toEqual([0,1]);h.element('vr-scene-canvas').props.onPointerMove(pointer(420,325));h.element('vr-scene-canvas').props.onPointerUp(pointer(420,325));const next=h.commit.mock.calls[0][0] as WarpGrid;expect(next.nodes[0].position).not.toEqual(h.grid.nodes[0].position);expect(next.nodes[1].position).not.toEqual(h.grid.nodes[1].position);expect(next.nodes.slice(2)).toEqual(h.grid.nodes.slice(2));
});
test.each(['Row','Column'])('%s expansion is one action and the next unrelated node click returns to direct selection',mode=>{
 const h=harness();h.element('vr-tool-direct').props.onClick();h.render();h.nodes()[4].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();h.button(mode).props.onClick();h.render();expect(h.nodes().filter(n=>n.props['data-selected'])).toHaveLength(3);expect(h.button('Nodes').props['aria-pressed']).toBe(true);
 h.nodes()[0].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();expect(h.nodes().filter(n=>n.props['data-selected']).map(n=>n.props['data-index'])).toEqual([0]);
});
test('A control-handle drag changes only the selected Warp handle',()=>{
 const h=harness();h.element('vr-tool-direct').props.onClick();h.render();h.nodes()[4].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();h.button('Warp Bézier handles').props.onClick();h.render();h.find(e=>e.props['data-handle']==='handleU').props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerMove(pointer(420,320));h.element('vr-scene-canvas').props.onPointerUp(pointer(420,320));const next=h.commit.mock.calls[0][0] as WarpGrid;expect(next.nodes[4].handleU).not.toEqual(h.grid.nodes[4].handleU);expect(next.nodes[4].position).toEqual(h.grid.nodes[4].position);expect(next.nodes[4].handleV).toEqual(h.grid.nodes[4].handleV);expect(next.nodes.filter((_,i)=>i!==4)).toEqual(h.grid.nodes.filter((_,i)=>i!==4));
});
test('switching A to V promotes arrow nudges to the whole Warp; switching back to A starts a local selection',()=>{
 const h=harness();h.element('vr-tool-direct').props.onClick();h.render();h.nodes()[4].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();expect(h.nodes().filter(n=>n.props['data-selected'])).toHaveLength(1);
 h.element('vr-tool-select').props.onClick();h.render();expect(h.nodes().filter(n=>n.props['data-selected'])).toHaveLength(9);listeners.get('keydown')!(key('ArrowRight'));listeners.get('keyup')!(key('ArrowRight'));const next=h.commit.mock.calls[0][0] as WarpGrid;expect(next.nodes.every((n,i)=>n.position[0]>h.grid.nodes[i].position[0])).toBe(true);
 h.element('vr-tool-direct').props.onClick();h.render();h.nodes()[4].props.onPointerDown(pointer());h.element('vr-scene-canvas').props.onPointerUp(pointer());h.render();expect(h.nodes().filter(n=>n.props['data-selected']).map(n=>n.props['data-index'])).toEqual([4]);
});
test.each(['select','direct'])('unestablished view blocks %s pointer mutation while retaining grid selection',tool=>{
 const h=harness(false);h.element(`vr-tool-${tool}`).props.onClick();h.render();h.preview.mockClear();h.nodes()[4].props.onPointerDown(pointer());h.render();h.element('vr-scene-canvas').props.onPointerMove(pointer(440,310));h.element('vr-scene-canvas').props.onPointerUp(pointer(440,310));expect(h.nodes().some(n=>n.props['data-selected'])).toBe(true);expect(h.preview).not.toHaveBeenCalled();expect(h.commit).not.toHaveBeenCalled();expect(h.selectSource).not.toHaveBeenCalled();
});
