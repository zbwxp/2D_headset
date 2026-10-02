import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test} from 'vitest';
import {useEditor} from '../app/store';
import {serializeProject} from '../app/autosave';
import {recordingSceneSources} from '../app/recordingSceneSources';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {instanceObjectId} from '../domain/recordingScene/model';
import type {ReferenceImage} from '../domain/project/types';
import type {Point2} from '../domain/drawing/model';
import PaintScene from '../ui/drawing/PaintScene';
import SceneOnionSkin from '../ui/vectorRecording/SceneOnionSkin';
import {DEFAULT_SCENE_ONION_SETTINGS,evaluateSceneOnionFrame,sampleSceneOnionAngles,sceneOnionSavedSignature} from '../ui/vectorRecording/angleInspection';
import {createRecordingReferenceState} from '../ui/vectorRecording/recordingReferenceState';

const original=useEditor.getState();
afterEach(()=>useEditor.setState(original,true));
function fixture(){
 const project=parseLandmarks(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'));
 const scene=project.recordingScenes!.scenes[0],sources=recordingSceneSources(project),resolve=(id:string)=>sources[id];
 return {project,scene,sources,resolve};
}
const noop=()=>{},screen=(p:Point2):Point2=>[400+p[0]*250,400-p[1]*250];
function cleanSvg(result:ReturnType<typeof evaluateSceneOnionFrame>){
 return renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d:result.drawing,paintBatches:result.paintBatches,screen,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:noop,paintDown:noop,arcDown:noop})));
}
const reference:ReferenceImage={name:'Inspection reference',dataUrl:'data:image/png;base64,AAAA',width:1200,height:800,offset:[.25,-.3],scale:1,rotation:0,opacity:.5,visible:true,locked:false};

test('onion sweeps preserve the other axis, omit the active angle and do not change either input',()=>{
 const angle={x:45,y:17.5},settings={...DEFAULT_SCENE_ONION_SETTINGS,enabled:true,min:0,max:90,step:5 as const},before=JSON.stringify({angle,settings});
 const x=sampleSceneOnionAngles(angle,settings);
 expect(x).toHaveLength(18);expect(x.map(a=>a.x)).toEqual(Array.from({length:19},(_,i)=>i*5).filter(v=>v!==45));expect(x.every(a=>a.y===17.5)).toBe(true);
 const y=sampleSceneOnionAngles(angle,{...settings,axis:'y',min:-20,max:30,step:10});
 expect(y.map(a=>a.y)).toEqual([-20,-10,0,10,20,30]);expect(y.every(a=>a.x===45)).toBe(true);
 expect(sampleSceneOnionAngles({x:0,y:0},{...settings,min:-90,max:90},true)).toHaveLength(37);
 expect(JSON.stringify({angle,settings})).toBe(before);
});

test('actual two-face onion evaluation preserves the project, history, angle, keys and ordinary rendered output',()=>{
 const {project,scene,resolve}=fixture(),past=[project],future=[project];useEditor.setState({project,past,future});
 const before=JSON.stringify(project),saved=serializeProject(project),current=evaluateSceneOnionFrame(scene,resolve,scene.angle),svg=cleanSvg(current);
 for(const angle of [{x:0,y:17.5},{x:45,y:17.5},{x:90,y:17.5}]){
  const onion=evaluateSceneOnionFrame(scene,resolve,angle),expected=evaluateScene(scene,resolve,{angle,useDraft:false,diagnostics:'preview'});
  expect(onion.angle).toEqual(angle);expect(onion.drawing).toEqual(expected.drawing);expect(onion.paintBatches).toEqual(expected.paintBatches);
 }
 expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toBe(past);expect(useEditor.getState().future).toBe(future);
 expect(JSON.stringify(project)).toBe(before);expect(serializeProject(project)).toBe(saved);expect(cleanSvg(evaluateSceneOnionFrame(scene,resolve,scene.angle))).toBe(svg);
});

test('actual scene draft geometry is excluded from onion frames and from the saved sweep signature',()=>{
 const {scene,resolve}=fixture(),saved=sceneOnionSavedSignature(scene),warp=scene.warps[0],angle={x:45,y:0};
 const translated={...warp.restGrid,nodes:warp.restGrid.nodes.map(n=>({...n,position:[n.position[0]+.2,n.position[1]] as Point2,handleU:[n.handleU[0]+.2,n.handleU[1]] as Point2,handleV:[n.handleV[0]+.2,n.handleV[1]] as Point2}))};
 const draft={...scene,angle,warps:scene.warps.map(w=>w.id===warp.id?{...w,draft:{angle,value:translated}}:w)},before=JSON.stringify(draft);
 expect(sceneOnionSavedSignature(draft)).toBe(saved);
 const onion=evaluateSceneOnionFrame(draft,resolve,angle),baseline=evaluateSceneOnionFrame(scene,resolve,angle),live=evaluateScene(draft,resolve,{angle,useDraft:true,diagnostics:'preview'});
 expect(onion.drawing).toEqual(baseline.drawing);expect(live.drawing.nodes).not.toEqual(onion.drawing.nodes);expect(JSON.stringify(draft)).toBe(before);
 const committed={...draft,warps:draft.warps.map(w=>w.id===warp.id?{...w,keys:[...w.keys,{id:'new-key',angle,value:translated}]}:w)};
 expect(sceneOnionSavedSignature(committed)).not.toBe(saved);
});

test('actual interval-hidden half-face closures stay absent from onion ink, with no fills, picking paths or duplicate current frame',()=>{
 const {scene,resolve}=fixture(),instance=scene.instances[0],source=resolve(instance.artworkId),closures=source.curves.filter(c=>c.name?.includes('内部闭合线'));
 expect(closures).toHaveLength(2);expect(closures.every(c=>c.visible)).toBe(true);
 const frames=[0,45,90].map(x=>evaluateSceneOnionFrame(scene,resolve,{x,y:0})),angle={x:45,y:0};
 const svg=renderToStaticMarkup(createElement('svg',null,createElement(SceneOnionSkin,{frames,angle,opacity:.15,screen,unit:250})));
 expect(svg.match(/data-testid="scene-onion-frame"/g)).toHaveLength(2);expect(svg).toContain('data-frame-count="2"');expect(svg).not.toContain('data-angle-x="45"');
 expect(svg).toContain('data-testid="drawing-ink"');expect(svg).not.toMatch(/data-testid="drawing-(fill|hit|arc-hit|offset-hit)"/);expect(svg).not.toContain('<image');
 const inkIds=[...svg.matchAll(/data-testid="drawing-ink"[^>]*data-id="([^"]+)"/g)].map(m=>m[1]);
 expect(inkIds.length).toBeGreaterThan(0);for(const curve of closures)expect(inkIds).not.toContain(instanceObjectId(instance.id,curve.id));
 expect(svg).toContain('pointer-events="none"');
});

test('the transient reference adapter changes no source, scene, undo history, JSON export or normal scene SVG',async()=>{
 const {project,scene,resolve}=fixture();project.drawing={...project.drawing!,reference:structuredClone(reference)};
 const before=JSON.stringify(project),serialized=serializeProject(project),svg=cleanSvg(evaluateSceneOnionFrame(scene,resolve,scene.angle)),past=[project],future=[project];useEditor.setState({project,past,future});
 const state=createRecordingReferenceState(project.drawing.reference),base=state.current()!;
 expect(base).not.toBe(project.drawing.reference);expect(base.offset).not.toBe(project.drawing.reference!.offset);
 state.setMoving(true);state.preview({...base,offset:[1,2]});expect(state.getSnapshot().preview!.reference!.offset).toEqual([1,2]);expect(state.current()!.offset).toEqual(reference.offset);
 state.preview(null);state.run(()=>({...state.currentDocument(),reference:{...state.current()!,offset:[1,2],scale:2,rotation:30,opacity:.3}}));
 state.change({...state.current()!,locked:true});state.change({...state.current()!,offset:[3,4]});expect(state.current()!.offset).toEqual([1,2]);
 state.change({...state.current()!,visible:false});expect(state.current()!.visible).toBe(false);state.change({...state.current()!,locked:false});
 await state.upload({name:'replacement.png'} as File,async()=>({...reference,name:'Replacement'}));expect(state.current()!.locked).toBe(true);
 state.change({...state.current()!,locked:false});state.change(undefined);expect(state.current()).toBeUndefined();
 expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toBe(past);expect(useEditor.getState().future).toBe(future);
 expect(JSON.stringify(project)).toBe(before);expect(serializeProject(project)).toBe(serialized);expect(cleanSvg(evaluateSceneOnionFrame(scene,resolve,scene.angle))).toBe(svg);
});

test('leaving a reference session cancels its pending import and transient drag, without affecting the next scene',async()=>{
 const a=createRecordingReferenceState(reference),b=createRecordingReferenceState({...reference,name:'Scene B'});let finish!:(image:ReferenceImage)=>void;
 a.preview({...reference,offset:[1,2]});a.setMoving(true);const pending=a.upload({name:'pending.png'} as File,()=>new Promise(resolve=>{finish=resolve;}));
 a.deactivate();finish({...reference,name:'Late A result'});await pending;
 expect(a.current()!.name).toBe(reference.name);expect(a.getSnapshot()).toMatchObject({preview:null,moving:false,busy:false});expect(b.current()!.name).toBe('Scene B');
 a.activate();expect(a.current()!.offset).toEqual(reference.offset);
});
