import {isValidElement,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import SceneWarpCanvas,{recordingCanvasToolForShortcut,type RecordingCanvasTool} from '../ui/vectorRecording/SceneWarpCanvas';
import {useEditor} from '../app/store';
import {useDrawing,type DrawingSelection} from '../ui/drawing/session';
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
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];return [tree,...elements(tree.props.children)];}

function harness(options:{empty?:boolean;editable?:boolean}={}){
 let drawing=addLayer(emptyDrawing(),'Ink');const layerId=drawing.layers[0].id;
 if(!options.empty)drawing=createCurve(drawing,layerId,[[4,6],[4.4,6.1],[5.7,6.2],[6,6]],.01,'Existing','existing');
 let revision:object={},targetKey='real-vertex',editable=options.editable??true,tool:RecordingCanvasTool='select',selection:DrawingSelection={ids:[]};
 const past:{drawing:DrawingDocument;revision:object}[]=[],future:typeof past=[];
 const commit=vi.fn((before:DrawingDocument,next:DrawingDocument)=>{expect(before).toBe(drawing);past.push({drawing,revision});future.length=0;drawing=next;revision={};return revision;}),error=vi.fn(),remove=vi.fn();
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{let count=0;do{hooks.dirty=false;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source:drawing,drawing,targetKey,label:'Pen',zh:false,selection,editEnabled:editable,showWarpTools:false,onPreview:()=>{},onCommit:()=>{},interaction:{tool,onToolChange:next=>{tool=next;}},topology:{editable,onSplit:()=>{},onDelete:remove,pen:{targetKey,historyKey:revision,layerId,onCommit:commit,onSelection:ids=>{selection={ids};},onError:error}}}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.forEach(fn=>fn());if(++count>10)throw Error('Effects did not settle');}while(hooks.dirty);};
 const element=(id:string)=>all.find(e=>e.props['data-testid']===id)!,paint=()=>all.find(e=>!!e.props.curveDown)!;
 const history=(redo=false)=>{const from=redo?future:past,to=redo?past:future,next=from.pop();if(next){to.push({drawing,revision});drawing=next.drawing;revision=next.revision;}render();};
 render();return {render,element,paint,commit,error,remove,past,drawing:()=>drawing,tool:()=>tool,history,navigate:()=>{targetKey='other-vertex';render();},readonly:()=>{editable=false;render();},key:(name:string,mods={})=>{listeners.get('keydown')!(key(name,mods));render();},point:(point:Point2)=>paint().props.screen(point) as Point2};
}
const pointer=(clientX:number,clientY:number)=>({button:0,pointerId:1,clientX,clientY,shiftKey:false,altKey:true,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const key=(name:string,mods={})=>({key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target:new Target(),preventDefault:vi.fn(),stopImmediatePropagation:vi.fn(),...mods});
const down=(h:ReturnType<typeof harness>,point:Point2)=>{h.element('vr-scene-canvas').props.onPointerDown(pointer(...point));h.render();};
const move=(h:ReturnType<typeof harness>,point:Point2)=>{h.element('vr-scene-canvas').props.onPointerMove(pointer(...point));h.render();};
const up=(h:ReturnType<typeof harness>,point:Point2)=>{h.element('vr-scene-canvas').props.onPointerUp(pointer(...point));h.render();};
const click=(h:ReturnType<typeof harness>,point:Point2)=>{down(h,point);up(h,point);};
const near=(a:Point2,b:Point2)=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],9));

test('P authors the visible translated target through one adapter with native continuation, width, and handle geometry',()=>{
 const h=harness(),before=h.drawing(),start:Point2=[4.2,6.5],end:Point2=[5.8,6.6],handle:Point2=[5.9,7];h.key('p');expect(h.tool()).toBe('pen');
 click(h,h.point(start));expect(h.commit).not.toHaveBeenCalled();expect(h.element('recording-pen-anchor')).toBeDefined();
 const endScreen=h.point(end);down(h,endScreen);move(h,h.point(handle));expect(h.commit).not.toHaveBeenCalled();expect(h.paint().props.d.curves.length).toBe(2);up(h,h.point(handle));
 expect(h.commit).toHaveBeenCalledTimes(1);expect(h.past).toHaveLength(1);expect(h.drawing().curves[0]).toEqual(before.curves[0]);
 const curve=h.drawing().curves.at(-1)!,shape=shapeOf(h.drawing(),curve.id);near(shape[0],start);near(shape[3],end);near(shape[2],[5.7,6.2]);near(h.point(end),endScreen);
 click(h,h.point([5.4,6.9]));expect(h.drawing().curves.at(-1)!.nodes[0]).toBe(curve.nodes[1]);expect(h.commit).toHaveBeenCalledTimes(2);expect(h.error).not.toHaveBeenCalled();
});

test.each(['Escape','cancel','lost','navigate','readonly','tool','blur'])('%s cancels a pen drag without creating a curve or losing its committed predecessor',action=>{
 const h=harness({empty:true});h.key('p');click(h,[300,325]);click(h,[400,325]);const before=h.drawing();down(h,[500,300]);move(h,[520,280]);
 if(action==='Escape')h.key('Escape');else if(action==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();else if(action==='lost')h.element('vr-scene-canvas').props.onLostPointerCapture();else if(action==='navigate')h.navigate();else if(action==='readonly')h.readonly();else if(action==='tool')h.key('v');else listeners.get('blur')!({});h.render();up(h,[520,280]);
 expect(h.drawing()).toBe(before);expect(h.commit).toHaveBeenCalledTimes(1);expect(h.paint().props.d).toBe(before);
});

test('Enter and New curve end continuity; P stays selected for another independent curve',()=>{
 const h=harness({empty:true});h.key('p');click(h,[300,325]);click(h,[400,325]);h.key('Enter');expect(h.element('recording-pen-anchor')).toBeUndefined();expect(h.tool()).toBe('pen');
 click(h,[450,325]);click(h,[550,325]);expect(h.drawing().curves[0].nodes[1]).not.toBe(h.drawing().curves[1].nodes[0]);
 h.element('vr-new-curve').props.onClick();h.render();expect(h.element('recording-pen-anchor')).toBeUndefined();expect(h.tool()).toBe('pen');
});

test('Undo discards an initial anchor, then restores continuation and closure across real document history',()=>{
 const h=harness({empty:true});const undo=vi.spyOn(useEditor.getState(),'undo').mockImplementation(()=>h.history()),redo=vi.spyOn(useEditor.getState(),'redo').mockImplementation(()=>h.history(true));
 try{h.key('p');click(h,[300,325]);h.key('z',{ctrlKey:true});expect(undo).not.toHaveBeenCalled();expect(h.element('recording-pen-anchor')).toBeUndefined();
 click(h,[300,325]);click(h,[400,325]);click(h,[400,225]);click(h,[300,325]);expect(h.drawing().curves).toHaveLength(3);expect(h.element('recording-pen-anchor')).toBeUndefined();
 h.key('z',{ctrlKey:true});expect(h.drawing().curves).toHaveLength(2);expect(h.element('recording-pen-anchor')).toBeDefined();h.key('z',{ctrlKey:true,shiftKey:true});expect(h.drawing().curves).toHaveLength(3);expect(h.element('recording-pen-anchor')).toBeUndefined();
 h.key('z',{ctrlKey:true});click(h,[500,325]);expect(h.drawing().curves).toHaveLength(3);expect(h.drawing().curves.at(-1)!.nodes[0]).toBe(h.drawing().curves[1].nodes[1]);expect(h.error).not.toHaveBeenCalled();
 }finally{undo.mockRestore();redo.mockRestore();}
});

test('correction frames expose disabled native P/split controls, a real-snapshot hint, and retain V/A/Z',()=>{
 const h=harness({editable:false});expect(h.element('vr-tool-pen').props.disabled).toBe(true);expect(h.element('vr-tool-pen').props.title).toContain('Create a real snapshot');h.key('p');expect(h.tool()).toBe('select');
 for(const [keyName,tool] of [['a','direct'],['z','zoom'],['v','select']]){h.key(keyName);expect(h.tool()).toBe(tool);}h.key('Delete');expect(h.remove).not.toHaveBeenCalled();
 expect(recordingCanvasToolForShortcut(key('p'),true)).toBe('pen');expect(recordingCanvasToolForShortcut(key('l'),true)).toBeNull();
});
