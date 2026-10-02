import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import {recordingSceneSources} from '../app/recordingSceneSources';
import {parseDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import type {SceneCommand} from '../domain/recordingScene/commands';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {emptyRecordingScene,type RecordingScene,type RecordingScenes} from '../domain/recordingScene/model';
import {layerSectionBatchScope,layerSectionSelectedBatchScope,type LayerPanelSection} from '../ui/drawing/LayerPanel';
import {layerBatchScope} from '../ui/drawing/listSelection';
import {useDrawing} from '../ui/drawing/session';
import SceneLayerPanel,{sceneLayerPanelDocument,sceneLayerVisibilityCommands} from '../ui/vectorRecording/SceneLayerPanel';

// SSR should read the current transient view state, as it does in the mounted panel.
vi.mock('../ui/drawing/session',async importOriginal=>{
 const m=await importOriginal<typeof import('../ui/drawing/session')>();
 return {...m,useDrawing:Object.assign((selector?:(s:ReturnType<typeof m.useDrawing.getState>)=>unknown)=>selector?selector(m.useDrawing.getState()):m.useDrawing.getState(),m.useDrawing)};
});

const sourceFile=new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url);
const sourceBytes=readFileSync(sourceFile,'utf8');
const initialSession=useDrawing.getState();
afterEach(()=>useDrawing.setState(initialSession,true));

function fixture(partial=false){
 const drawing=parseDrawing(JSON.parse(sourceBytes)),saved=saveDrawingSnapshot({drawing},'Symmetric 13-layer source'),artworkId=saved.drawingSnapshots!.activeId!;
 const scene:RecordingScene={...emptyRecordingScene('toolbar-scene','Recording'),instances:[
  {id:'snapshot-a',name:'Snapshot A',artworkId,...(partial?{layerIds:drawing.layers.slice(0,3).map(layer=>layer.id)}:{})},
  {id:'snapshot-b',name:'Snapshot B',artworkId},
 ]};
 let project={...createEmptyProject(),...saved,recordingScenes:{version:1,activeSceneId:scene.id,scenes:[scene]} as RecordingScenes};
 const evaluated=()=>evaluateScene(project.recordingScenes.scenes[0],id=>recordingSceneSources(project)[id]);
 return {
  drawing,artworkId,get project(){return project;},get scene(){return project.recordingScenes.scenes[0];},evaluated,
  run(commands:SceneCommand[]){project={...project,recordingScenes:prepareSceneBatch(project,{commands}).recordingScenes};},
 };
}
const sourceState=(f:ReturnType<typeof fixture>)=>JSON.stringify({drawing:f.project.drawing,snapshots:f.project.drawingSnapshots,workingCopies:f.project.drawingWorkingCopies});
function context(f:ReturnType<typeof fixture>){
 const evaluated=f.evaluated(),document=sceneLayerPanelDocument(evaluated);
 const sections:LayerPanelSection[]=f.scene.instances.map(instance=>({id:instance.id,name:instance.name,layerIds:evaluated.layers.filter(layer=>layer.included&&layer.instanceId===instance.id).map(layer=>layer.compiledLayerId)}));
 return {evaluated,document,sections};
}
const objects=(evaluation:ReturnType<ReturnType<typeof fixture>['evaluated']>)=>[...evaluation.drawing.curves,...evaluation.drawing.fills,...evaluation.drawing.offsets];
const buttonTags=(html:string,testId:string)=>[...html.matchAll(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`,'g'))].map(match=>match[0]);
function markup(f:ReturnType<typeof fixture>,editEnabled=true){
 const {evaluated,sections}=context(f);
 return renderToStaticMarkup(createElement(SceneLayerPanel,{scene:f.scene,evaluated,selection:{ids:[],layers:[sections[0].layerIds[2],sections[1].layerIds[2]]},onSelection:()=>{},run:()=>{},editEnabled,headerActions:createElement('button',{'data-testid':'shared-warp-create'},'Create Warp')}));
}

test('a snapshot with no local selection covers all 13 included layers and changes only its own instance',()=>{
 const f=fixture(),beforeSource=sourceState(f),{evaluated,document,sections}=context(f),beforeEvaluation=JSON.stringify(evaluated);
 expect(f.drawing.layers).toHaveLength(13);expect(new Set(f.scene.instances.map(instance=>instance.artworkId))).toEqual(new Set([f.artworkId]));
 const selected=[sections[1].layerIds[0]],globalBatch=layerBatchScope(document,selected),scope=layerSectionSelectedBatchScope(document,sections[0],selected);
 expect(globalBatch.layers).toHaveLength(1);expect(scope.layers).toHaveLength(13);
 expect(scope.items).toHaveLength(f.drawing.curves.length+f.drawing.fills.length+f.drawing.offsets.length);
 expect(scope.items.every(id=>evaluated.provenance[id].instanceId==='snapshot-a')).toBe(true);
 const commands=sceneLayerVisibilityCommands(f.scene,evaluated,scope.items,false);
 expect(commands).toHaveLength(scope.items.length);
 expect(commands.every(command=>command.op==='setVisibility'&&command.target.instanceId==='snapshot-a'&&!!command.target.sourceObjectId)).toBe(true);
 const peerBefore=objects(evaluated).filter(object=>evaluated.provenance[object.id].instanceId==='snapshot-b');
 f.run(commands);const after=f.evaluated();
 expect(objects(after).filter(object=>scope.items.includes(object.id)).every(object=>!object.visible)).toBe(true);
 expect(objects(after).filter(object=>after.provenance[object.id].instanceId==='snapshot-b')).toEqual(peerBefore);
 expect(f.scene.visibilityTracks).toHaveLength(scope.items.length);expect(f.scene.visibilityTracks.every(track=>track.target.instanceId==='snapshot-a'&&track.keys.length===0)).toBe(true);
 expect(f.scene.warps).toEqual([]);expect(JSON.stringify(evaluated)).toBe(beforeEvaluation);expect(sourceState(f)).toBe(beforeSource);
 expect(readFileSync(sourceFile,'utf8')).toBe(sourceBytes);
},15000);

test('mixed-selected layer row Eyes stay inside the clicked snapshot while Drawing retains the full selection',()=>{
 const f=fixture(),{evaluated,document,sections}=context(f),selected=[sections[0].layerIds[0],sections[0].layerIds[2],sections[1].layerIds[1]];
 const own=layerSectionSelectedBatchScope(document,sections[0],selected),peer=layerSectionSelectedBatchScope(document,sections[1],selected);
 expect(own.layers.map(layer=>layer.id)).toEqual([sections[0].layerIds[0],sections[0].layerIds[2]]);
 expect(peer.layers.map(layer=>layer.id)).toEqual([sections[1].layerIds[1]]);
 expect(own.items.every(id=>evaluated.provenance[id].instanceId==='snapshot-a')).toBe(true);
 const before=sourceState(f),commands=sceneLayerVisibilityCommands(f.scene,evaluated,own.items,false),untouched=objects(evaluated).filter(object=>!own.items.includes(object.id));
 expect(commands.every(command=>command.op==='setVisibility'&&command.target.instanceId==='snapshot-a')).toBe(true);
 f.run(commands);const after=f.evaluated();
 expect(objects(after).filter(object=>!own.items.includes(object.id))).toEqual(untouched);
 expect(objects(after).filter(object=>own.items.includes(object.id)).every(object=>!object.visible)).toBe(true);
 expect(sourceState(f)).toBe(before);
 expect(layerBatchScope(document,selected).layers.map(layer=>layer.id)).toEqual(selected);
 expect(layerSectionBatchScope(document,sections[0]).layers).toHaveLength(13);
});

test('snapshot scope excludes source-only slots, including empty and stale sections',()=>{
 const f=fixture(true),{evaluated,document,sections}=context(f),scope=layerSectionBatchScope(document,sections[0]);
 expect(evaluated.layers.filter(layer=>layer.instanceId==='snapshot-a')).toHaveLength(13);
 expect(scope.layers).toHaveLength(3);
 const excluded=evaluated.layers.filter(layer=>layer.instanceId==='snapshot-a'&&!layer.included).map(layer=>layer.compiledLayerId);
 expect(scope.layers.every(layer=>!excluded.includes(layer.id))).toBe(true);
 for(const layerIds of [[],excluded,['stale-layer']]){
  const empty=layerSectionBatchScope(document,{id:'empty',name:'Empty',layerIds});
  expect(empty.layers).toEqual([]);expect(empty.items).toEqual([]);expect(empty.foldIds).toEqual([]);
 }
 expect(sceneLayerVisibilityCommands(f.scene,evaluated,scope.items,false).every(command=>command.op==='setVisibility'&&command.target.instanceId==='snapshot-a'&&f.scene.instances[0].layerIds!.includes(command.target.sourceLayerId))).toBe(true);
});

test('two instances render independent snapshot toolbars and keep the shared Warp action separate',()=>{
 const f=fixture(),before=sourceState(f),html=markup(f);
 expect((html.match(/data-testid="drawing-layer-section-tools"/g)??[])).toHaveLength(2);
 for(const id of ['drawing-toggle-all','drawing-toggle-fills','drawing-collapse-all']){
  expect(buttonTags(html,id)).toHaveLength(2);
  expect(html.indexOf(`data-testid="${id}"`)).toBeGreaterThan(html.indexOf('data-testid="drawing-layer-section-tools"'));
 }
 expect(html).toContain('<strong>Snapshot A</strong><small>13</small>');expect(html).toContain('<strong>Snapshot B</strong><small>13</small>');
 expect((html.match(/data-testid="shared-warp-create"/g)??[])).toHaveLength(1);
 expect(html.indexOf('data-testid="shared-warp-create"')).toBeLessThan(html.indexOf('data-testid="drawing-layer-section"'));
 expect(html).toContain('data-testid="drawing-layer-scope"');expect(sourceState(f)).toBe(before);
});

test('preview mode disables both pose Eyes while leaving snapshot fill preview and folding usable',()=>{
 const html=markup(fixture(),false),eyes=buttonTags(html,'drawing-toggle-all');
 expect(eyes).toHaveLength(2);expect(eyes.every(tag=>tag.includes('disabled'))).toBe(true);
 for(const id of ['drawing-toggle-fills','drawing-collapse-all']){
  const tags=buttonTags(html,id);expect(tags).toHaveLength(2);expect(tags.every(tag=>!tag.includes('disabled'))).toBe(true);
 }
 expect(html).not.toContain('draggable="true"');
});

test('namespaced fill and folding view state renders independently for duplicate sources without recording tracks',()=>{
 const f=fixture(),beforeSource=sourceState(f),beforeScene=JSON.stringify(f.scene),{evaluated,document,sections}=context(f),own=layerSectionBatchScope(document,sections[0]),peer=layerSectionBatchScope(document,sections[1]);
 expect(own.foldIds.every(id=>!peer.foldIds.includes(id))).toBe(true);
 useDrawing.getState().set({showFills:true,fillVisibility:Object.fromEntries(own.layers.map(layer=>[layer.id,false])),closedLayers:own.foldIds});
 const html=markup(f),fills=buttonTags(html,'drawing-toggle-fills');
 expect(fills[0]).toContain('aria-pressed="false"');expect(fills[1]).toContain('aria-pressed="true"');
 const shownCurveRows=[...html.matchAll(/data-testid="drawing-curve-row" data-id="([^"]+)"/g)].map(match=>match[1]);
 expect(shownCurveRows.length).toBeGreaterThan(0);expect(shownCurveRows.every(id=>evaluated.provenance[id].instanceId==='snapshot-b')).toBe(true);
 expect(useDrawing.getState().showFills).toBe(true);expect(JSON.stringify(f.scene)).toBe(beforeScene);expect(sourceState(f)).toBe(beforeSource);
});
