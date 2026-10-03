import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {applyScenePlacement,scenePlacementScales} from '../domain/recordingScene/tracks';
import {createWarpGrid,type WarpGrid} from '../domain/vectorWarp/model';
import SceneWarpCanvas from '../ui/vectorRecording/SceneWarpCanvas';
import SceneInstanceTransformBox,{beginInstanceTransform,instanceTransformDelta,instanceAxisScaleValue,type RecordingInstanceTransform} from '../ui/vectorRecording/SceneInstanceTransformBox';

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
function harness(options:{snapshot?:boolean;editable?:boolean;grid?:boolean;placement?:ScenePlacementValue;framePlacement?:ScenePlacementValue;displayPlacement?:ScenePlacementValue;stroke?:boolean}={}){
 const source=emptyDrawing(),grid=options.grid?createWarpGrid(bounds,2,2):undefined,preview=vi.fn(),commit=vi.fn(),warpPreview=vi.fn(),warpCommit=vi.fn(),selectSource=vi.fn(),selectWarp=vi.fn(),valuePreview=vi.fn(),valueCommit=vi.fn();
 let instance:RecordingInstanceTransform|undefined=options.snapshot===false?undefined:{ids:['snapshot'],allowCurveSelection:options.stroke,bounds,onPreview:preview,onCommit:commit,editable:options.editable??true,label:'Snapshot',displayPlacement:options.displayPlacement,...(options.framePlacement?{basePlacement:options.framePlacement,materialBounds:bounds,onValuePreview:valuePreview,onValueCommit:valueCommit}:{})};
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{hooks.stateIndex=0;hooks.refIndex=0;hooks.effects=[];all=elements(SceneWarpCanvas({source,drawing:source,grid,gridPlacement:options.placement,ghostGridPlacements:grid?[{instanceId:'other',name:'Other',value:identityScenePlacement()}]:[],instanceTransform:instance,targetKey:'canvas',label:'Test',zh:false,editEnabled:options.grid??false,onPreview:warpPreview,onCommit:warpCommit,onSelection:selectSource,onWarpSelection:selectWarp}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.at(-1)!();};render();
 return {source,grid,preview,commit,valuePreview,valueCommit,setPlacement:(placement:ScenePlacementValue)=>{instance={...instance!,basePlacement:placement};render();},warpPreview,warpCommit,selectSource,selectWarp,render,setBounds:(next:typeof bounds)=>{instance={...instance!,bounds:next};render();},element:(id:string)=>all.find(e=>e.props['data-testid']===id)!,nodes:()=>all.filter(e=>e.props['data-testid']==='vr-node'),findAll:(id:string)=>all.filter(e=>e.props['data-testid']===id)};
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
test.each([{}, {scaleX:2,scaleY:3}])('rotated scaled Warp pointer and keyboard edits inverse the display placement once %j',axes=>{
 const placement:ScenePlacementValue={translation:[2,3],rotation:90,scale:2,...axes},h=harness({snapshot:false,grid:true,placement});h.element('vr-tool-direct').props.onClick();h.render();const middle=h.nodes()[4].props,next=h.nodes()[5].props,unit=Math.abs(next.cy-middle.cy)/2;
 middle.onPointerDown(pointer(middle.cx,middle.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(middle.cx+20,middle.cy));h.element('vr-scene-canvas').props.onPointerUp(pointer(middle.cx+20,middle.cy));let result=h.warpCommit.mock.calls.at(-1)![0] as WarpGrid;const before=applyScenePlacement(placement,h.grid!.nodes[4].position),after=applyScenePlacement(placement,result.nodes[4].position);near([after[0]-before[0],after[1]-before[1]],[20/unit,0]);expect(result.nodes[4].position[0]).toBeCloseTo(0,10);expect(result.nodes[4].position[1]).toBeLessThan(0);
 h.render();listeners.get('keydown')!(key('ArrowRight'));listeners.get('keyup')!(key('ArrowRight'));result=h.warpCommit.mock.calls.at(-1)![0] as WarpGrid;const nudged=applyScenePlacement(placement,result.nodes[4].position);near([nudged[0]-before[0],nudged[1]-before[1]],[1/unit,0]);expect(h.element('vr-grid-ghost').props.pointerEvents).toBe('none');
});


test.each(['x','y'] as const)('local %s edge scales independently around its opposite edge and reaches exact zero',axis=>{
 const placement:ScenePlacementValue={translation:[4,-2],rotation:37,scale:1,scaleX:2,scaleY:3},anchor:Point2=axis==='x'?[-1,0]:[0,-1],extent=2,start:Point2=axis==='x'?[1,0]:[0,1],a=placement.rotation*Math.PI/180,direction:Point2=axis==='x'?[Math.cos(a),Math.sin(a)]:[-Math.sin(a),Math.cos(a)],original=axis==='x'?2:3,gesture={axis,start,anchor,extent,placement};
 const next=instanceAxisScaleValue(gesture,[start[0]-original*extent*direction[0],start[1]-original*extent*direction[1]]),scales=scenePlacementScales(next);
 expect(scales[axis==='x'?0:1]).toBe(0);expect(scales[axis==='x'?1:0]).toBe(axis==='x'?3:2);near(applyScenePlacement(next,anchor),applyScenePlacement(placement,anchor));
 const crossed=instanceAxisScaleValue(gesture,[start[0]-(original+1)*extent*direction[0],start[1]-(original+1)*extent*direction[1]]);expect(scenePlacementScales(crossed)[axis==='x'?0:1]).toBe(0);
 const restored=instanceAxisScaleValue({...gesture,placement:crossed},[start[0]+extent*direction[0],start[1]+extent*direction[1]]);expect(scenePlacementScales(restored)[axis==='x'?0:1]).toBeCloseTo(1,12);near(applyScenePlacement(restored,anchor),applyScenePlacement(crossed,anchor));
});
test('X edge collapse and recovery commit once per gesture without changing height or source',()=>{
 const h=harness({framePlacement:identityScenePlacement()}),before=JSON.stringify(h.source),edge=(side:number)=>h.findAll('vr-instance-scale-x').find(e=>e.props['data-side']===side)!.props,right=edge(1),left=edge(-1),x=right.x+5,y=right.y+5,width=right.x-left.x;
 right.onPointerDown(pointer(x,y));h.element('vr-scene-canvas').props.onPointerMove(pointer(x-width,y));const zero=h.valuePreview.mock.calls.at(-1)![0] as ScenePlacementValue;expect(scenePlacementScales(zero)).toEqual([0,1]);expect(h.valueCommit).not.toHaveBeenCalled();
 h.setPlacement(zero);const previewCorners=h.findAll('vr-instance-scale');expect(previewCorners[0].props.x).toBe(previewCorners[1].props.x);expect(edge(1).x-edge(-1).x).toBe(28);
 h.element('vr-scene-canvas').props.onPointerUp(pointer(x-width,y));h.element('vr-scene-canvas').props.onPointerUp(pointer(x-width,y));expect(h.valueCommit).toHaveBeenCalledExactlyOnceWith(zero);h.setPlacement(zero);
 const collapsed=edge(1);collapsed.onPointerDown(pointer(collapsed.x+5,collapsed.y+5));h.element('vr-scene-canvas').props.onPointerMove(pointer(collapsed.x+5+width/2,collapsed.y+5));const restored=h.valuePreview.mock.calls.at(-1)![0] as ScenePlacementValue;expect(scenePlacementScales(restored)).toEqual([.5,1]);h.element('vr-scene-canvas').props.onPointerUp(pointer(collapsed.x+5+width/2,collapsed.y+5));expect(h.valueCommit).toHaveBeenCalledTimes(2);expect(h.commit).not.toHaveBeenCalled();expect(h.warpCommit).not.toHaveBeenCalled();expect(JSON.stringify(h.source)).toBe(before);
});
test.each(['cancel','readonly'])('%s axis gesture cannot write placement',mode=>{
 const h=harness({framePlacement:identityScenePlacement(),editable:mode!=='readonly'}),edge=h.findAll('vr-instance-scale-x')[1].props;edge.onPointerDown(pointer(edge.x+5,edge.y+5));h.element('vr-scene-canvas').props.onPointerMove(pointer(edge.x+30,edge.y+5));if(mode==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();h.element('vr-scene-canvas').props.onPointerUp(pointer(edge.x+30,edge.y+5));expect(h.valueCommit).not.toHaveBeenCalled();if(mode==='readonly')expect(h.valuePreview).not.toHaveBeenCalled();else expect(h.valuePreview).toHaveBeenLastCalledWith(null);
});
test('singular Warp placement stays finite and blocks pointer and keyboard grid edits',()=>{
 const h=harness({snapshot:false,grid:true,placement:{translation:[2,3],rotation:25,scale:1,scaleX:0,scaleY:2}});h.element('vr-tool-direct').props.onClick();h.render();expect(h.element('vr-singular-placement-hint')).toBeDefined();expect(h.element('vr-scene-canvas').props['data-edit-enabled']).toBe(false);const node=h.nodes()[4].props;node.onPointerDown(pointer(node.cx,node.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(node.cx+20,node.cy));h.element('vr-scene-canvas').props.onPointerUp(pointer(node.cx+20,node.cy));listeners.get('keydown')!(key('ArrowRight'));listeners.get('keyup')!(key('ArrowRight'));expect(h.warpPreview).not.toHaveBeenCalledWith(expect.objectContaining({nodes:expect.any(Array)}));expect(h.warpCommit).not.toHaveBeenCalled();for(const e of h.nodes()){expect(Number.isFinite(e.props.cx)).toBe(true);expect(Number.isFinite(e.props.cy)).toBe(true);}
});
test('both collapsed axes retain separate accessible edge handles, movement and rotation',()=>{
 const h=harness({framePlacement:{translation:[0,0],rotation:0,scale:1,scaleX:0,scaleY:0}}),edges=[...h.findAll('vr-instance-scale-x'),...h.findAll('vr-instance-scale-y')];expect(new Set(edges.map(e=>`${e.props.x},${e.props.y}`)).size).toBe(4);const center=h.element('vr-instance-center').props;center.onPointerDown(pointer(center.cx,center.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(center.cx+10,center.cy));h.element('vr-scene-canvas').props.onPointerUp(pointer(center.cx+10,center.cy));expect(h.commit).toHaveBeenCalledTimes(1);h.render();const rotate=h.element('vr-instance-rotate').props;rotate.onPointerDown(pointer(rotate.cx,rotate.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(rotate.cx+20,rotate.cy+20));h.element('vr-scene-canvas').props.onPointerUp(pointer(rotate.cx+20,rotate.cy+20));expect(h.commit).toHaveBeenCalledTimes(2);
});


test('stroke side handles and movement stay in the displayed rotated nonuniform parent frame',()=>{
 const parent:ScenePlacementValue={translation:[.2,.3],rotation:37,scale:1,scaleX:2,scaleY:.5},h=harness({framePlacement:identityScenePlacement(),displayPlacement:parent});
 const edges=h.findAll('vr-instance-scale-x'),left=edges.find(e=>e.props['data-side']===-1)!.props,right=edges.find(e=>e.props['data-side']===1)!.props,dx=right.x-left.x,dy=right.y-left.y;
 right.onPointerDown(pointer(right.x+5,right.y+5));h.element('vr-scene-canvas').props.onPointerMove(pointer(right.x+5-dx,right.y+5-dy));h.element('vr-scene-canvas').props.onPointerUp(pointer(right.x+5-dx,right.y+5-dy));
 const zero=h.valueCommit.mock.calls.at(-1)![0] as ScenePlacementValue;expect(scenePlacementScales(zero)).toEqual([0,1]);h.setPlacement(zero);
 const restore=h.findAll('vr-instance-scale-x').find(e=>e.props['data-side']===1)!.props;restore.onPointerDown(pointer(restore.x+5,restore.y+5));h.element('vr-scene-canvas').props.onPointerMove(pointer(restore.x+5+dx/2,restore.y+5+dy/2));h.element('vr-scene-canvas').props.onPointerUp(pointer(restore.x+5+dx/2,restore.y+5+dy/2));
 expect(scenePlacementScales(h.valueCommit.mock.calls.at(-1)![0])).toEqual([.5,1]);h.setPlacement(identityScenePlacement());
 const center=h.element('vr-instance-center').props,unit=Math.hypot(dx,dy)/4;center.onPointerDown(pointer(center.cx,center.cy));h.element('vr-scene-canvas').props.onPointerMove(pointer(center.cx+12,center.cy+7));h.element('vr-scene-canvas').props.onPointerUp(pointer(center.cx+12,center.cy+7));
 const delta=h.commit.mock.calls.at(-1)![0] as ScenePlacementValue,a=applyScenePlacement(parent,[0,0]),b=applyScenePlacement(parent,delta.translation);near([b[0]-a[0],b[1]-a[1]],[12/unit,-7/unit]);
});


test('stroke transform frame leaves its contents available for selecting more curves, while layer-body drag stays available',()=>{const h=harness({stroke:true});expect(h.element('vr-instance-move').props.pointerEvents).toBe('none');expect(h.element('vr-instance-center').props.onPointerDown).toBeDefined();expect(h.findAll('vr-instance-scale')).toHaveLength(4);});
