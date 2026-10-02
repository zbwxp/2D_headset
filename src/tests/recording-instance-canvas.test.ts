import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {applyScenePlacement} from '../domain/recordingScene/tracks';
import {createWarpGrid,type WarpGrid} from '../domain/vectorWarp/model';
import SceneWarpCanvas from '../ui/vectorRecording/SceneWarpCanvas';
import SceneInstanceTransformBox,{beginInstanceTransform,instanceTransformDelta,type RecordingInstanceTransform} from '../ui/vectorRecording/SceneInstanceTransformBox';

const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{hooks.states[i]=typeof next==='function'?next(hooks.states[i]):next;}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),
 useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown)=>fn(),useEffect:(fn:()=>void)=>{hooks.effects.push(fn);},
}));
vi.mock('../ui/drawing/session',async original=>{const actual=await original<typeof import('../ui/drawing/session')>();return {...actual,useDrawing:Object.assign((selector:(state:ReturnType<typeof actual.useDrawing.getState>)=>unknown)=>selector(actual.useDrawing.getState()),actual.useDrawing)};});
class Target {constructor(readonly tag='svg'){}closest(selector:string){return selector.split(',').includes(this.tag)?this:null;}}
const listeners=new Map<string,(event:unknown)=>void>();
beforeEach(()=>{hooks.states=[];hooks.refs=[];listeners.clear();vi.stubGlobal('Element',Target);vi.stubGlobal('window',{addEventListener:(name:string,fn:(e:unknown)=>void)=>listeners.set(name,fn),removeEventListener:()=>{}});});
afterEach(()=>vi.unstubAllGlobals());
type Props={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];if(tree.type===SceneInstanceTransformBox)return elements(SceneInstanceTransformBox(tree.props as ComponentProps<typeof SceneInstanceTransformBox>));return [tree,...elements(tree.props.children)];}
const bounds={min:[-1,-1] as Point2,max:[1,1] as Point2,center:[0,0] as Point2};
function harness(options:{snapshot?:boolean;editable?:boolean;grid?:boolean;placement?:ScenePlacementValue}={}){
 const source=emptyDrawing(),grid=options.grid?createWarpGrid(bounds,2,2):undefined,preview=vi.fn(),commit=vi.fn(),warpPreview=vi.fn(),warpCommit=vi.fn(),selectSource=vi.fn(),selectWarp=vi.fn();
 let instance:RecordingInstanceTransform|undefined=options.snapshot===false?undefined:{ids:['snapshot'],bounds,onPreview:preview,onCommit:commit,editable:options.editable??true,label:'Snapshot'};
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{hooks.stateIndex=0;hooks.refIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing:source,grid,gridPlacement:options.placement,ghostGridPlacements:grid?[{instanceId:'other',name:'Other',value:identityScenePlacement()}]:[],instanceTransform:instance,targetKey:'canvas',label:'Test',zh:false,editEnabled:options.grid??false,onPreview:warpPreview,onCommit:warpCommit,onSelection:selectSource,onWarpSelection:selectWarp}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.at(-1)!();};render();
 return {source,grid,preview,commit,warpPreview,warpCommit,selectSource,selectWarp,render,setBounds:(next:typeof bounds)=>{instance={...instance!,bounds:next};render();},element:(id:string)=>all.find(e=>e.props['data-testid']===id)!,nodes:()=>all.filter(e=>e.props['data-testid']==='vr-node'),findAll:(id:string)=>all.filter(e=>e.props['data-testid']===id)};
}
const pointer=(clientX:number,clientY:number,shiftKey=false)=>({button:0,pointerId:1,clientX,clientY,shiftKey,altKey:true,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const key=(name:string,tag='svg')=>({key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target:new Target(tag),preventDefault:vi.fn()});
const near=(actual:Point2,expected:Point2)=>{expect(actual[0]).toBeCloseTo(expected[0],10);expect(actual[1]).toBeCloseTo(expected[1],10);};

test('snapshot V moves without a Warp and commits once while source remains untouched',()=>{
 const h=harness(),before=JSON.stringify(h.source),center=h.element('vr-instance-center').props;
 center.onPointerDown(pointer(center.cx,center.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(center.cx+30,center.cy-20));expect(h.commit).not.toHaveBeenCalled();const value=h.preview.mock.calls.at(-1)![0] as ScenePlacementValue;expect(value.translation[0]).toBeGreaterThan(0);expect(value.translation[1]).toBeGreaterThan(0);expect(value.scale).toBe(1);expect(value.rotation).toBe(0);
 h.element('vr-scene-canvas').props.onPointerUp(pointer(center.cx+30,center.cy-20));h.element('vr-scene-canvas').props.onPointerUp(pointer(center.cx+30,center.cy-20));expect(h.commit).toHaveBeenCalledExactlyOnceWith(value);expect(h.warpCommit).not.toHaveBeenCalled();expect(h.selectSource).not.toHaveBeenCalled();expect(JSON.stringify(h.source)).toBe(before);
});
test('snapshot V has priority over Warp and A exposes only the placed Warp editing controls',()=>{
 const h=harness({grid:true});expect(h.element('vr-warp-hit').props.pointerEvents).toBe('none');h.nodes()[4].props.onPointerDown(pointer(400,325));expect(h.selectWarp).not.toHaveBeenCalled();
 h.element('vr-tool-direct').props.onClick();h.render();expect(h.element('vr-instance-transform-box')).toBeUndefined();h.nodes()[4].props.onPointerDown(pointer(400,325));h.element('vr-scene-canvas').props.onPointerMove(pointer(410,325));h.element('vr-scene-canvas').props.onPointerUp(pointer(410,325));expect(h.warpCommit).toHaveBeenCalledTimes(1);expect(h.commit).not.toHaveBeenCalled();
});
test.each(['cancel','readonly'])('%s cannot write snapshot placement',mode=>{
 const h=harness({editable:mode!=='readonly'}),center=h.element('vr-instance-center').props;center.onPointerDown(pointer(center.cx,center.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(center.cx+30,center.cy));if(mode==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();h.element('vr-scene-canvas').props.onPointerUp(pointer(center.cx+30,center.cy));expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();if(mode==='readonly')expect(h.preview).not.toHaveBeenCalled();else expect(h.preview).toHaveBeenLastCalledWith(null);
});
test('arrow repeats are one snapshot commit and freeze frame bounds across evaluated preview renders',()=>{
 const h=harness(),before=h.element('vr-instance-center').props.cx;listeners.get('keydown')!(key('ArrowRight','input'));expect(h.preview).not.toHaveBeenCalled();listeners.get('keydown')!(key('ArrowRight'));listeners.get('keydown')!(key('ArrowRight'));const value=h.preview.mock.calls.at(-1)![0] as ScenePlacementValue;
 h.setBounds({min:[bounds.min[0]+value.translation[0],-1],max:[bounds.max[0]+value.translation[0],1],center:[value.translation[0],0]});expect(h.element('vr-instance-center').props.cx-before).toBeCloseTo(2,10);expect(h.commit).not.toHaveBeenCalled();listeners.get('keyup')!(key('ArrowRight'));expect(h.commit).toHaveBeenCalledExactlyOnceWith(value);expect(h.warpCommit).not.toHaveBeenCalled();
});
test('corner scale fixes the opposite corner, remains uniform and never mirrors',()=>{
 const pivot:Point2=[-3,-2],start:Point2=[1,2],gesture=beginInstanceTransform('scale',start,pivot),value=instanceTransformDelta(gesture,[5,6]);expect(value.scale).toBe(2);near(applyScenePlacement(value,pivot),pivot);near(applyScenePlacement(value,start),[5,6]);expect(value.rotation).toBe(0);expect(instanceTransformDelta(gesture,[-5,-4]).scale).toBeGreaterThan(0);
});
test('rotation stays unwrapped across atan2 seams and Shift quantizes to 15 degrees around center',()=>{
 const origin:Point2=[3,-2],at=(degrees:number):Point2=>[origin[0]+Math.cos(degrees*Math.PI/180),origin[1]+Math.sin(degrees*Math.PI/180)],gesture=beginInstanceTransform('rotate',at(170),origin);instanceTransformDelta(gesture,at(179));expect(instanceTransformDelta(gesture,at(190)).rotation).toBeCloseTo(20,10);instanceTransformDelta(gesture,at(280));instanceTransformDelta(gesture,at(370));instanceTransformDelta(gesture,at(460));expect(instanceTransformDelta(gesture,at(560)).rotation).toBeCloseTo(390,10);const snapped=instanceTransformDelta(gesture,at(563),true);expect(snapped.rotation).toBe(390);near(applyScenePlacement(snapped,origin),origin);
});
test('rotated scaled Warp pointer and keyboard edits inverse the display placement once',()=>{
 const placement:ScenePlacementValue={translation:[2,3],rotation:90,scale:2},h=harness({snapshot:false,grid:true,placement});h.element('vr-tool-direct').props.onClick();h.render();const middle=h.nodes()[4].props,next=h.nodes()[5].props,unit=Math.abs(next.cy-middle.cy)/2;
 middle.onPointerDown(pointer(middle.cx,middle.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(middle.cx+20,middle.cy));h.element('vr-scene-canvas').props.onPointerUp(pointer(middle.cx+20,middle.cy));let result=h.warpCommit.mock.calls.at(-1)![0] as WarpGrid;const before=applyScenePlacement(placement,h.grid!.nodes[4].position),after=applyScenePlacement(placement,result.nodes[4].position);near([after[0]-before[0],after[1]-before[1]],[20/unit,0]);expect(result.nodes[4].position[0]).toBeCloseTo(0,10);expect(result.nodes[4].position[1]).toBeLessThan(0);
 h.render();listeners.get('keydown')!(key('ArrowRight'));listeners.get('keyup')!(key('ArrowRight'));result=h.warpCommit.mock.calls.at(-1)![0] as WarpGrid;const nudged=applyScenePlacement(placement,result.nodes[4].position);near([nudged[0]-before[0],nudged[1]-before[1]],[1/unit,0]);expect(h.element('vr-grid-ghost').props.pointerEvents).toBe('none');
});
