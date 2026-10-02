import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {useFloatingPanel} from '../ui/shared/useFloatingPanel';

const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as {deps:unknown[];cleanup?:()=>void}[],pending:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{hooks.states[i]=typeof next==='function'?next(hooks.states[i]):next;}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),
 useLayoutEffect:(fn:()=>void|(()=>void),deps:unknown[])=>{const i=hooks.effectIndex++,before=hooks.effects[i];if(!before||deps.some((value,j)=>value!==before.deps[j]))hooks.pending.push(()=>{before?.cleanup?.();hooks.effects[i]={deps,cleanup:fn()||undefined};});},
}));
const listeners=new Map<string,Set<()=>void>>(),storage=new Map<string,string>();
let keyIndex=0;
function resetHooks(){hooks.states=[];hooks.refs=[];hooks.effects=[];hooks.pending=[];}
beforeEach(()=>{
 resetHooks();listeners.clear();storage.clear();
 vi.stubGlobal('window',{innerWidth:1000,innerHeight:800,localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},addEventListener:(name:string,fn:()=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:()=>void)=>listeners.get(name)?.delete(fn)});
});
afterEach(()=>{for(const effect of hooks.effects)effect.cleanup?.();vi.unstubAllGlobals();});
function harness(key=`floating-test-${keyIndex++}`,initialOpen=true){
 let result:ReturnType<typeof useFloatingPanel>;
 const measure=vi.fn(()=>({left:256,top:120,width:280,height:600}));
 const panel={getBoundingClientRect:measure,querySelector:()=>({getBoundingClientRect:()=>({height:40})})};
 const header={setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
 const render=(open=true)=>{hooks.stateIndex=hooks.refIndex=hooks.effectIndex=0;result=useFloatingPanel({open,storageKey:key});result.panelRef.current=panel as unknown as HTMLElement;const pending=hooks.pending.splice(0);for(const effect of pending)effect();return result;};
 const event=(x:number,y:number,extra:Record<string,unknown>={})=>({pointerId:1,button:0,buttons:1,isPrimary:true,clientX:x,clientY:y,currentTarget:header,target:{closest:()=>null},preventDefault:vi.fn(),stopPropagation:vi.fn(),...extra}) as unknown as ReactPointerEvent<HTMLElement>;
 render(initialOpen);render(initialOpen);
 return {get result(){return result;},key,panel,header,measure,render,event,unmount:()=>{for(const effect of hooks.effects)effect.cleanup?.();resetHooks();}};
}

test('measures the actual initial panel position only when open',()=>{
 const h=harness(undefined,false);expect(h.measure).not.toHaveBeenCalled();expect(h.result.style).toEqual({});
 h.render(true);h.render(true);expect(h.result.style).toMatchObject({position:'fixed',left:256,top:120,maxHeight:672});
});

test('restores valid stored positions and ignores malformed preferences',()=>{
 storage.set('stored-valid',JSON.stringify({left:410,top:190}));const h=harness('stored-valid');expect(h.result.style).toMatchObject({left:410,top:190});h.unmount();
 storage.set('stored-invalid',JSON.stringify({left:'410',top:190}));expect(harness('stored-invalid').result.style).toMatchObject({left:256,top:120});
});

test('captures the title drag, uses the original cursor offset, and persists across unmount',()=>{
 const h=harness();h.result.headerProps.onPointerDown(h.event(280,135));expect(h.header.setPointerCapture).toHaveBeenCalledWith(1);
 h.result.headerProps.onPointerMove(h.event(400,235));h.render();expect(h.result.style).toMatchObject({left:376,top:220});
 h.result.headerProps.onPointerMove(h.event(410,245));h.render();expect(h.result.style).toMatchObject({left:386,top:230});
 h.result.headerProps.onPointerUp(h.event(420,255,{buttons:0}));h.render();expect(h.result.style).toMatchObject({left:396,top:240});expect(h.header.releasePointerCapture).toHaveBeenCalledWith(1);
 expect(JSON.parse(storage.get(h.key)!)).toEqual({left:396,top:240});const key=h.key;h.unmount();expect(harness(key).result.style).toMatchObject({left:396,top:240});
});

test('controls and unrelated pointers do not initiate or hijack a title drag',()=>{
 const h=harness();for(const name of ['button','input','textarea','select','a','rolebutton','contenteditable']){const closest=vi.fn(()=>({name}));h.result.headerProps.onPointerDown(h.event(280,135,{target:{closest}}));expect(closest).toHaveBeenCalledWith(expect.stringContaining('button'));}
 h.result.headerProps.onPointerDown(h.event(280,135,{button:2}));expect(h.header.setPointerCapture).not.toHaveBeenCalled();
 h.result.headerProps.onPointerDown(h.event(280,135));h.result.headerProps.onPointerMove(h.event(400,235,{pointerId:2}));h.result.headerProps.onPointerUp(h.event(400,235,{pointerId:2}));h.render();expect(h.result.style).toMatchObject({left:256,top:120});
 h.result.headerProps.onPointerMove(h.event(400,235));h.render();expect(h.result.style).toMatchObject({left:376,top:220});
});

test.each(['onPointerCancel','onLostPointerCapture'] as const)('%s safely ends dragging without moving the panel afterward',handler=>{
 const h=harness();h.result.headerProps.onPointerDown(h.event(280,135));h.result.headerProps.onPointerMove(h.event(400,235));h.result.headerProps[handler](h.event(400,235));h.result.headerProps.onPointerMove(h.event(600,435));h.render();expect(h.result.style).toMatchObject({left:376,top:220});
 h.render(false);h.render(true);h.render(true);expect(h.result.style).toMatchObject({left:376,top:220});
});

test('resizing clamps the header and adapts scroll height to the available viewport',()=>{
 const h=harness();h.result.headerProps.onPointerDown(h.event(280,135));h.result.headerProps.onPointerMove(h.event(1000,1000));h.result.headerProps.onPointerUp(h.event(1000,1000));
 window.innerWidth=500;window.innerHeight=300;for(const resize of listeners.get('resize')!)resize();h.render();expect(h.result.style).toMatchObject({left:212,top:252,maxHeight:40});
});

test('storage denial keeps the shared preference in memory',()=>{
 Object.defineProperty(window,'localStorage',{get(){throw new Error('denied');},configurable:true});
 const h=harness();h.result.headerProps.onPointerDown(h.event(280,135));h.result.headerProps.onPointerUp(h.event(400,235));const key=h.key;h.unmount();expect(harness(key).result.style).toMatchObject({left:376,top:220});
});
