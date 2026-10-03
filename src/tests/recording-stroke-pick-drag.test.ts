import {isValidElement,type ComponentProps,type ReactElement} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotPreview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type Point2} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {scenePlacementScales} from '../domain/recordingScene/tracks';
import {chooseDrawingSelection,selectDrawingTool} from '../ui/drawing/interactionController';
import type {DrawingSelection} from '../ui/drawing/session';
import SceneWarpCanvas from '../ui/vectorRecording/SceneWarpCanvas';
import SceneInstanceTransformBox from '../ui/vectorRecording/SceneInstanceTransformBox';
import {snapshotStrokeSelectionTransform} from '../ui/vectorRecording/SnapshotRecordingWorkspace';

const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],deps:[] as (unknown[]|undefined)[],cleanups:[] as ((()=>void)|void)[],effects:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0,dirty:false}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;return [hooks.states[i],(next:unknown)=>{const value=typeof next==='function'?next(hooks.states[i]):next;if(!Object.is(value,hooks.states[i])){hooks.states[i]=value;hooks.dirty=true;}}];},
 useRef:(initial:unknown)=>hooks.refs[hooks.refIndex++]??(hooks.refs[hooks.refIndex-1]={current:initial}),useCallback:(fn:unknown)=>fn,useMemo:(fn:()=>unknown)=>fn(),
 useEffect:(fn:()=>void|(()=>void),deps?:unknown[])=>{const i=hooks.effectIndex++,previous=hooks.deps[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous[j]))){hooks.deps[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn();});}},
}));
vi.mock('../ui/drawing/session',async original=>{const actual=await original<typeof import('../ui/drawing/session')>();return {...actual,useDrawing:Object.assign((selector:(state:ReturnType<typeof actual.useDrawing.getState>)=>unknown)=>selector(actual.useDrawing.getState()),actual.useDrawing)};});
class Target {closest(){return null;}}
const listeners=new Map<string,(event:unknown)=>void>();
beforeEach(()=>{hooks.states=[];hooks.refs=[];hooks.deps=[];hooks.cleanups=[];listeners.clear();vi.stubGlobal('Element',Target);vi.stubGlobal('window',{addEventListener:(name:string,fn:(event:unknown)=>void)=>listeners.set(name,fn),removeEventListener:(name:string,fn:unknown)=>{if(listeners.get(name)===fn)listeners.delete(name);}});});
afterEach(()=>vi.unstubAllGlobals());
type Props={children?:unknown;[key:string]:any};
function elements(tree:unknown):ReactElement<Props>[] {if(Array.isArray(tree))return tree.flatMap(elements);if(!isValidElement<Props>(tree))return [];if(tree.type===SceneInstanceTransformBox)return elements(SceneInstanceTransformBox(tree.props as ComponentProps<typeof SceneInstanceTransformBox>));return [tree,...elements(tree.props.children)];}
const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const id=(raw:string)=>canonicalElementId('$working',raw);
const pointer=(clientX:number,clientY:number,shiftKey=false)=>({button:0,pointerId:1,clientX,clientY,shiftKey,altKey:true,stopPropagation:vi.fn(),preventDefault:vi.fn()});
const key=(name:string,modifiers={})=>({key:name,code:name,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,isComposing:false,target:new Target(),preventDefault:vi.fn(),...modifiers});
function harness(options:{selected?:string[];editable?:boolean;tool?:'select'|'direct';placement?:ScenePlacementValue;parent?:ScenePlacementValue;endpointPair?:boolean}={}){
 let drawing=addLayer(emptyDrawing(),'Outline');for(const [i,raw] of ['a','b','c'].entries())drawing=createCurve(drawing,drawing.layers[0].id,[[i,0],[i+.2,.2],[i+.8,.8],[i+1,1]],.01,raw,raw);
 drawing.groups=[{id:'group',name:'Complete stroke',curveIds:['a','b'],visible:true,locked:false}];
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing});const past:LandmarkProject[]=[],future:LandmarkProject[]=[],sourceWrite=vi.fn(()=>{throw Error('source write');});
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing:sourceWrite,commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const old=past.pop();if(old){future.push(project);project=old;}},redo(){const old=future.pop();if(old){past.push(project);project=old;}}});
 const apply=(...commands:SnapshotCommand[])=>value(api.snapshot({commands}));apply({op:'createRecording'});apply({op:'pasteLayers',sourceSnapshotId:drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!.id});
 if(options.placement)apply({op:'setShapeElementPlacement',curveIds:[id('a'),id('b')],value:options.placement});
 if(options.parent)apply({op:'setLayerPlacement',layerId:evaluateRecordingSnapshot(project).drawing.layers[0].id,value:options.parent});
 if(options.endpointPair){
  apply({op:'updateSnapshot'});const start=project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!.activeSnapshotId!;
  apply({op:'createSnapshot',angle:{x:90,y:0}});const end=project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!.activeSnapshotId!;
  apply({op:'setLayerPlacement',layerId:evaluateRecordingSnapshot(project).drawing.layers[0].id,value:{translation:[2,1],rotation:15,scale:1.5}},{op:'updateSnapshot'});
  apply({op:'createEndpointPairRecording',startSnapshotId:start,endSnapshotId:end},{op:'setAngle',angle:{x:60,y:0}});
 }
 past.length=0;
 let shown=project,targetKey='view-0',revealGridKey=0,editable=options.editable??true,chosen:DrawingSelection={ids:(options.selected??[]).map(id)},tool:'select'|'direct'|'hand'|'zoom'|'split'=options.tool??'select';
 const preview=vi.fn((commands:SnapshotCommand[]|null)=>{shown=commands?{...project,recordingSnapshots:prepareSnapshotPreview(project,{commands}).recordingSnapshots}:project;}),commit=vi.fn((commands:SnapshotCommand[])=>{apply(...commands);shown=project;}),warpCommit=vi.fn(),curveCommit=vi.fn(),select=vi.fn();
 const svg={focus:vi.fn(),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,top:0})};let all:ReactElement<Props>[]=[];
 const render=()=>{let count=0;do{hooks.dirty=false;hooks.stateIndex=0;hooks.refIndex=0;hooks.effectIndex=0;hooks.effects=[];const baseline=evaluateRecordingSnapshot(project),evaluation=evaluateRecordingSnapshot(shown),adapter=(ids:string[])=>snapshotStrokeSelectionTransform(evaluation,baseline,ids,editable,preview,commit);
 all=elements(SceneWarpCanvas({source:evaluation.source,drawing:evaluation.drawing,targetKey,revealGridKey,label:'Test',zh:false,selection:chosen,editEnabled:editable,onPreview:()=>{},onCommit:warpCommit,interaction:{tool,onToolChange:next=>{tool=next;chosen=selectDrawingTool(next,chosen).selection;}},onSelectionTool:(next,mode)=>{select(next,mode);const transition=chooseDrawingSelection(tool,next,mode);chosen=transition.selection;tool=transition.tool as typeof tool;},transformsForSelection:adapter,instanceTransform:adapter(chosen.ids),curveEdit:chosen.ids.length?{editable,onPreview:()=>{},onCommit:curveCommit}:undefined}));all.find(e=>e.props['data-testid']==='vr-scene-canvas')!.props.ref.current=svg;hooks.effects.forEach(fn=>fn());if(++count>8)throw Error('Effects did not settle');}while(hooks.dirty);};render();preview.mockClear();
 const element=(testId:string)=>all.find(e=>e.props['data-testid']===testId)!;
 return {project:()=>project,shown:()=>shown,api,past,sourceWrite,preview,commit,warpCommit,curveCommit,select,render,element,selection:()=>chosen,paint:()=>all.find(e=>!!e.props.curveDown)!,navigate:()=>{targetKey='view-1';render();},reveal:()=>{revealGridKey++;render();},readonly:()=>{editable=false;render();},externalTool:()=>{tool='zoom';render();}};
}
const move=(h:ReturnType<typeof harness>,point:Point2)=>h.element('vr-scene-canvas').props.onPointerMove(pointer(...point));
const release=(h:ReturnType<typeof harness>,point:Point2)=>h.element('vr-scene-canvas').props.onPointerUp(pointer(...point));
const near=(a:Point2,b:Point2)=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],9));

test('first V ink pickup selects its complete Drawing group and moves it in the same gesture with one pose commit and Undo',()=>{
 const h=harness(),original=h.project(),source=JSON.stringify(original.drawing),library=JSON.stringify(original.recordingSnapshots!.library),base=evaluateRecordingSnapshot(original),unit=h.paint().props.unit,start:Point2=[233,343];
 h.paint().props.curveDown(pointer(...start),id('a'));h.render();expect(h.selection().ids).toEqual([id('a'),id('b')]);expect(h.element('vr-scene-canvas').props['data-tool']).toBe('select');
 move(h,[253,333]);h.render();move(h,[263,323]);h.render();expect(h.commit).not.toHaveBeenCalled();
 for(const raw of ['a','b']){const before=shapeOf(base.drawing,id(raw)),after=shapeOf(evaluateRecordingSnapshot(h.shown()).drawing,id(raw));after.forEach((p,i)=>near(p,[before[i][0]+30/unit,before[i][1]+20/unit]));}
 expect(shapeOf(evaluateRecordingSnapshot(h.shown()).drawing,id('c'))).toEqual(shapeOf(base.drawing,id('c')));
 release(h,[263,323]);release(h,[263,323]);expect(h.commit).toHaveBeenCalledTimes(1);expect(h.past).toHaveLength(1);expect(h.warpCommit).not.toHaveBeenCalled();expect(h.sourceWrite).not.toHaveBeenCalled();expect(JSON.stringify(h.project().drawing)).toBe(source);expect(JSON.stringify(h.project().recordingSnapshots!.library)).toBe(library);
 value(h.api.undo());expect(h.project()).toBe(original);
});

test('V click without displacement selects without a history entry',()=>{const h=harness(),before=h.project();h.paint().props.curveDown(pointer(200,300),id('a'));h.render();release(h,[200,300]);expect(h.selection().ids).toEqual([id('a'),id('b')]);expect(h.commit).not.toHaveBeenCalled();expect(h.project()).toBe(before);expect(h.past).toHaveLength(0);});

test.each([{selected:['a','b','c'],hit:'a',shift:false,expected:['a','b','c']},{selected:['c'],hit:'a',shift:true,expected:['c','a','b']},{selected:['a','b','c'],hit:'a',shift:true,expected:['c']}])('V uses Drawing selection for $selected, Shift=$shift and freezes the resulting IDs',({selected,hit,shift,expected})=>{
 const h=harness({selected});h.paint().props.curveDown(pointer(200,300,shift),id(hit));h.render();expect(h.selection().ids).toEqual(expected.map(id));move(h,[230,280]);h.render();release(h,[230,280]);expect(h.commit).toHaveBeenCalledTimes(1);expect(h.commit.mock.calls[0][0][0]).toMatchObject({curveIds:expected.map(id)});
});

test.each(['escape','cancel','lost','navigate','source','blur','tool','externalTool','readonly','reveal','undo','unmount'])('%s cancels the frozen stroke adapter and prevents a stale release',action=>{
 const h=harness();h.paint().props.curveDown(pointer(200,300),id('a'));h.render();move(h,[230,280]);h.render();expect(h.preview.mock.calls.at(-1)![0]).not.toBeNull();
 if(action==='escape')listeners.get('keydown')!(key('Escape'));else if(action==='cancel')h.element('vr-scene-canvas').props.onPointerCancel();else if(action==='lost')h.element('vr-scene-canvas').props.onLostPointerCapture();else if(action==='navigate')h.navigate();else if(action==='source')listeners.get('contour:cancel-recording-gesture')!({});else if(action==='blur')listeners.get('blur')!({});else if(action==='readonly')h.readonly();else if(action==='reveal')h.reveal();else if(action==='externalTool')h.externalTool();else if(action==='undo')listeners.get('keydown')!(key('z',{ctrlKey:true}));else if(action==='unmount')hooks.cleanups.forEach(fn=>fn?.());else{h.element('vr-tool-direct').props.onClick();h.render();}
 release(h,[230,280]);expect(h.commit).not.toHaveBeenCalled();expect(h.past).toHaveLength(0);expect(h.preview).toHaveBeenLastCalledWith(null);expect(h.sourceWrite).not.toHaveBeenCalled();
});

test('A ink selection stays A and never enters the V transform adapter',()=>{const h=harness({tool:'direct'});h.paint().props.curveDown(pointer(200,300),id('a'));h.render();expect(h.selection().ids).toEqual([id('a')]);expect(h.element('vr-scene-canvas').props['data-tool']).toBe('direct');move(h,[230,280]);release(h,[230,280]);expect(h.commit).not.toHaveBeenCalled();expect(h.curveCommit).not.toHaveBeenCalled();});

test('an explicitly disabled transform remains read-only',()=>{const h=harness({editable:false});h.paint().props.curveDown(pointer(200,300),id('a'));h.render();expect(h.selection().ids).toEqual([id('a'),id('b')]);expect(h.element('vr-instance-transform-box').props['data-editable']).toBe(false);move(h,[230,280]);release(h,[230,280]);expect(h.commit).not.toHaveBeenCalled();expect(h.preview.mock.calls.some(([commands])=>commands!==null)).toBe(false);});

test.each([0,.4])('V pickup preserves nonuniform stroke axes, including exact zero %s, through a rotated nonuniform parent',scaleX=>{
 const h=harness({placement:{...identityScenePlacement(),scaleX,scaleY:2},parent:{translation:[2,1],rotation:31,scale:1,scaleX:2,scaleY:.6}}),before=evaluateRecordingSnapshot(h.project()),unit=h.paint().props.unit;
 h.paint().props.curveDown(pointer(203,302),id('a'));h.render();move(h,[223,292]);h.render();release(h,[223,292]);expect(h.commit).toHaveBeenCalledTimes(1);const after=evaluateRecordingSnapshot(h.project());expect(scenePlacementScales(after.elementPlacements[id('a')])).toEqual([scaleX,2]);shapeOf(after.drawing,id('a')).forEach((p,i)=>{const q=shapeOf(before.drawing,id('a'))[i];near(p,[q[0]+20/unit,q[1]+10/unit]);});expect(after.placements).toEqual(before.placements);
});


test('intermediate V pickup batch-inverts the frozen stroke once, keeps final-space frame and restores all state with Undo',()=>{
 const h=harness({endpointPair:true}),original=h.project(),base=evaluateRecordingSnapshot(original),unit=h.paint().props.unit;
 h.paint().props.curveDown(pointer(233,343),id('a'));h.render();expect(h.selection().ids).toEqual([id('a'),id('b')]);expect(h.element('vr-instance-transform-box').props['data-editable']).toBe(true);
 expect(h.element('vr-instance-scale-x')).toBeDefined();expect(h.element('vr-instance-scale-y')).toBeDefined();
 move(h,[253,343]);h.render();const preview=evaluateRecordingSnapshot(h.shown());
 for(const raw of ['a','b'])shapeOf(preview.drawing,id(raw)).forEach((p,i)=>{const q=shapeOf(base.drawing,id(raw))[i];near(p,[q[0]+20/unit,q[1]]);});
 expect(shapeOf(preview.drawing,id('c'))).toEqual(shapeOf(base.drawing,id('c')));
 release(h,[253,343]);expect(h.commit).toHaveBeenCalledTimes(1);expect(h.commit.mock.calls[0][0]).toHaveLength(1);expect(h.commit.mock.calls[0][0][0].op).toBe('transformShapeElements');expect(h.past).toHaveLength(1);
 const current=h.project().recordingSnapshots!,recording=current.recordings.find(r=>r.id===current.activeRecordingId)!;
 expect(recording.angle).toEqual({x:60,y:0});expect(recording.snapshotIds).toHaveLength(2);expect(recording.tracks).toEqual(original.recordingSnapshots!.recordings.find(r=>r.id===current.activeRecordingId)!.tracks);expect(recording.endpointPair?.draft?.responses.handles).toEqual({});expect(current.library).toEqual(original.recordingSnapshots!.library);expect(h.sourceWrite).not.toHaveBeenCalled();
 value(h.api.undo());expect(h.project()).toBe(original);
});
