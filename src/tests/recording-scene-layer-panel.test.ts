import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import {recordingSceneSources} from '../app/recordingSceneSources';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {createFill,createOffset} from '../domain/drawing/paintCommands';
import {createGroup} from '../domain/drawing/groups';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {emptyRecordingScene,sceneLayerKey,type RecordingScene,type RecordingScenes} from '../domain/recordingScene/model';
import type {SceneCommand} from '../domain/recordingScene/commands';
import LayerPanel,{groupedLayerSections} from '../ui/drawing/LayerPanel';
import {drawingListRows,selectLayerRows,selectListRows} from '../ui/drawing/listSelection';
import {useDrawing} from '../ui/drawing/session';
import SceneLayerPanel,{sceneLayerPanelDocument,sceneLayerVisibilityCommands,sceneLayerReorderCommands} from '../ui/vectorRecording/SceneLayerPanel';

function fixture(){
 let drawing=addLayer(emptyDrawing(),'Eye');const eye=drawing.layers[0].id,e=ellipse(drawing,eye,[-.4,-.3],[.4,.3],.02);
 drawing=createFill(e.document,e.ids,'black');drawing=createCurve(drawing,eye,[[-.5,.5],[-.2,.7],[.2,.7],[.5,.5]],.01,'Brow','brow');drawing=createOffset(drawing,'brow');drawing=createGroup(drawing,[e.ids[0],'brow'],'Face');
 drawing=addLayer(drawing,'Detail');drawing=createCurve(drawing,drawing.layers[0].id,[[0,-.5],[.1,-.6],[.2,-.6],[.3,-.5]],.01,'Mouth','mouth');
 const saved=saveDrawingSnapshot({drawing},'Face source'),artworkId=saved.drawingSnapshots!.activeId!;
 const scene:RecordingScene={...emptyRecordingScene('scene','Recording'),instances:[{id:'near',name:'Near face',artworkId},{id:'far',name:'Far face',artworkId}]};
 let project={...createEmptyProject(),...saved,recordingScenes:{version:1 as const,activeSceneId:scene.id,scenes:[scene]} as RecordingScenes};
 const resolve=(id:string)=>recordingSceneSources(project)[id];
 return {drawing,eye,artworkId,get project(){return project;},get scene(){return project.recordingScenes.scenes[0];},get evaluated(){return evaluateScene(project.recordingScenes.scenes[0],resolve);},run(commands:SceneCommand[]){const next=prepareSceneBatch(project,{commands});project={...project,recordingScenes:next.recordingScenes};return next;}};
}
const sourceState=(f:ReturnType<typeof fixture>)=>JSON.stringify({drawing:f.project.drawing,snapshots:f.project.drawingSnapshots,working:f.project.drawingWorkingCopies});
const compiled=(f:ReturnType<typeof fixture>,instanceId:string,sourceId:string)=>Object.entries(f.evaluated.provenance).find(([,p])=>p.instanceId===instanceId&&p.sourceId===sourceId)![0];

test('member Eye uses evaluated provenance and records only its own instance without writing any source',()=>{
 const f=fixture(),before=sourceState(f),evaluated=f.evaluated,evaluationBefore=JSON.stringify(evaluated),id=compiled(f,'near','brow');
 const commands=sceneLayerVisibilityCommands(f.scene,evaluated,[id],false);
 expect(commands).toEqual([{op:'setVisibility',target:{instanceId:'near',sourceLayerId:f.eye,sourceObjectId:'brow'},visible:false}]);
 f.run(commands);expect(f.evaluated.drawing.curves.find(c=>c.id===id)!.visible).toBe(false);expect(f.evaluated.drawing.curves.find(c=>c.id===compiled(f,'far','brow'))!.visible).toBe(true);
 expect(f.scene.visibilityTracks).toHaveLength(1);expect(f.scene.visibilityTracks[0].keys).toEqual([]);expect(JSON.stringify(evaluated)).toBe(evaluationBefore);expect(sourceState(f)).toBe(before);
});

test('layer and cross-instance batch Eyes include curves, owned fills and offsets, preserving source state',()=>{
 const f=fixture(),before=sourceState(f),d=sceneLayerPanelDocument(f.evaluated),layers=d.layers.filter(l=>f.evaluated.provenance[l.id].sourceId===f.eye),ids=layers.flatMap(l=>l.items),commands=sceneLayerVisibilityCommands(f.scene,f.evaluated,ids,false);
 expect(commands).toHaveLength(ids.length);expect(commands.every(c=>c.op==='setVisibility'&&!!c.target.sourceObjectId)).toBe(true);
 f.run(commands);const objects=[...f.evaluated.drawing.curves,...f.evaluated.drawing.fills,...f.evaluated.drawing.offsets];
 expect(objects.filter(o=>ids.includes(o.id)).every(o=>!o.visible)).toBe(true);expect(objects.filter(o=>!ids.includes(o.id)).every(o=>o.visible)).toBe(true);
 f.run(sceneLayerVisibilityCommands(f.scene,f.evaluated,[compiled(f,'near','brow')],true));expect(f.evaluated.drawing.curves.find(c=>c.id===compiled(f,'near','brow'))!.visible).toBe(true);expect(sourceState(f)).toBe(before);
});

test('a fill Eye becomes a fill pose track while the preview toolbar state stays transient',()=>{
 const f=fixture(),before=sourceState(f),id=compiled(f,'near',f.drawing.fills[0].id),state=useDrawing.getState();
 try{
  const sceneBefore=JSON.stringify(f.scene),evaluatedBefore=JSON.stringify(f.evaluated);
  useDrawing.getState().set({showFills:false,fillVisibility:{[f.evaluated.layerMap[sceneLayerKey({instanceId:'near',sourceLayerId:f.eye})]]:true}});
  expect(JSON.stringify(f.scene)).toBe(sceneBefore);expect(JSON.stringify(f.evaluated)).toBe(evaluatedBefore);
  f.run(sceneLayerVisibilityCommands(f.scene,f.evaluated,[id],false));expect(f.scene.visibilityTracks[0].target.sourceObjectId).toBe(f.drawing.fills[0].id);
  expect(f.evaluated.drawing.fills.find(fill=>fill.id===id)!.visible).toBe(false);expect(f.evaluated.drawing.curves.every(curve=>curve.visible)).toBe(true);expect(sourceState(f)).toBe(before);
 }finally{useDrawing.setState(state,true);}
});

test('revealing one member behind a closed layer gate does not reveal hidden peers',()=>{
 const f=fixture(),ref={instanceId:'near',sourceLayerId:f.eye},before=sourceState(f);
 f.run([{op:'setVisibility',target:ref,visible:false}]);const id=compiled(f,'near',f.drawing.fills[0].id),ids=f.evaluated.drawing.layers.find(l=>l.id===f.evaluated.layerMap[sceneLayerKey(ref)])!.items;
 f.run(sceneLayerVisibilityCommands(f.scene,f.evaluated,[id],true));const objects=[...f.evaluated.drawing.curves,...f.evaluated.drawing.fills,...f.evaluated.drawing.offsets].filter(o=>ids.includes(o.id));
 expect(objects.filter(o=>o.visible).map(o=>o.id)).toEqual([id]);expect(sourceState(f)).toBe(before);
});

test('cross-instance layer drag records scene order and leaves source layer/member order untouched',()=>{
 const f=fixture(),before=sourceState(f),d=sceneLayerPanelDocument(f.evaluated),ids=d.layers.map(l=>l.id),commands=sceneLayerReorderCommands(f.scene,f.evaluated,ids[3],ids[0]);
 expect(commands).toHaveLength(1);expect(commands[0].op).toBe('setLayerOrder');f.run(commands);
 expect(sceneLayerPanelDocument(f.evaluated).layers.map(l=>l.id)).toEqual([ids[3],...ids.slice(0,3)]);expect(f.scene.visibilityTracks).toEqual([]);expect(sourceState(f)).toBe(before);
});

test('dragging into tied layer ranks preserves exact visual order and only changes the tied band',()=>{
 const f=fixture(),before=sourceState(f),refs=f.evaluated.layers,ids=f.evaluated.drawing.layers.map(l=>l.id);
 f.run([{op:'setLayerOrder',target:{instanceId:refs[1].instanceId,sourceLayerId:refs[1].sourceLayerId},value:1}]);
 const commands=sceneLayerReorderCommands(f.scene,f.evaluated,ids[3],ids[0],true);expect(commands.every(command=>command.op==='setLayerOrder')).toBe(true);expect(commands).toHaveLength(3);f.run(commands);
 expect(sceneLayerPanelDocument(f.evaluated).layers.map(l=>l.id)).toEqual([ids[0],ids[3],ids[1],ids[2]]);expect(sourceState(f)).toBe(before);
});

test('one combined document retains Ctrl and Shift selections across instance boundaries',()=>{
 const f=fixture(),d=sceneLayerPanelDocument(f.evaluated),ids=d.layers.map(l=>l.id);
 const first=selectLayerRows(d.layers,null,ids[0],[],{shift:false,toggle:false}),toggle=selectLayerRows(d.layers,first.anchor,ids[3],first.ids,{shift:false,toggle:true});
 expect(toggle.ids).toEqual([ids[0],ids[3]]);expect(selectLayerRows(d.layers,first.anchor,ids[3],first.ids,{shift:true,toggle:false}).ids).toEqual(ids);
 const rows=drawingListRows(d,[]),a=compiled(f,'near','brow'),b=compiled(f,'far','brow');
 expect(selectListRows(rows,`curve:${a}`,`curve:${b}`,[a],{shift:false,toggle:true}).ids).toEqual([a,b]);
});

test('Recording renders the real Drawing rows under collapsible headings with source actions disabled',()=>{
 const f=fixture(),before=sourceState(f),html=renderToStaticMarkup(createElement(SceneLayerPanel,{scene:f.scene,evaluated:f.evaluated,selection:{ids:[]},onSelection:()=>{},run:()=>{},editEnabled:true,headerActions:createElement('button',{'data-testid':'custom-warp-action'},'Warp')}));
 expect((html.match(/data-testid="drawing-layers"/g)??[])).toHaveLength(0);expect((html.match(/class="drawing-layers"/g)??[])).toHaveLength(1);
 expect((html.match(/data-testid="drawing-layer-section-toggle"/g)??[])).toHaveLength(2);expect(html).toContain('Near face');expect(html).toContain('Far face');expect(html).toContain('aria-expanded="true"');
 for(const testId of ['drawing-curve-row','drawing-paint-row','drawing-group-row','drawing-chain-select','drawing-toggle-fills','custom-warp-action','drawing-pose-explanation'])expect(html).toContain(`data-testid="${testId}"`);
 for(const testId of ['drawing-new-layer','drawing-cut-selection','drawing-paste-selection','drawing-delete-selection'])expect(html).not.toContain(`data-testid="${testId}"`);
 expect(html.match(/<button[^>]*data-testid="drawing-layer-lock"[^>]*>/)?.[0]).toContain('disabled');
 expect(html.match(/<div[^>]*data-testid="drawing-stroke-row"[^>]*>/)?.[0]).toContain('draggable="false"');expect(sourceState(f)).toBe(before);
});

test('view mode disables pose edits while Drawing defaults retain authoring controls',()=>{
 const f=fixture(),props={scene:f.scene,evaluated:f.evaluated,selection:{ids:[]},onSelection:()=>{},run:()=>{},editEnabled:false},html=renderToStaticMarkup(createElement(SceneLayerPanel,props));
 expect(html.match(/<button[^>]*data-testid="drawing-toggle-all"[^>]*>/)?.[0]).toContain('disabled');expect(html.match(/<button[^>]*data-testid="drawing-toggle-fills"[^>]*>/)?.[0]).not.toContain('disabled');
 expect(html).not.toContain('draggable="true"');
 const ignore=()=>{},drawing=renderToStaticMarkup(createElement(LayerPanel,{document:f.drawing,active:f.eye,selection:{ids:['brow']},run:ignore,choose:ignore,setLayer:ignore,openProperties:ignore,closeProperties:ignore,upload:ignore,deleteSelected:ignore,cutSelected:ignore,pasteSelected:ignore,canPaste:true}));
 expect(drawing).toContain('data-testid="drawing-new-layer"');expect(drawing).toContain('data-testid="drawing-cut-selection"');expect(drawing).toContain('draggable="true"');expect(drawing).not.toContain('drawing-pose-explanation');
});


test('interleaved paint layers remain one collapsible snapshot group without changing evaluated depth',()=>{
 const f=fixture(),initial=f.evaluated.drawing.layers.map(layer=>layer.id);
 f.run(sceneLayerReorderCommands(f.scene,f.evaluated,initial[2],initial[0],true));
 const evaluated=f.evaluated,before=JSON.stringify(evaluated),sceneBefore=JSON.stringify(f.scene),sourceBefore=sourceState(f);
 expect(evaluated.drawing.layers.map(layer=>layer.id)).toEqual([initial[0],initial[2],initial[1],initial[3]]);
 const document=sceneLayerPanelDocument(evaluated),sections=f.scene.instances.map(instance=>({id:instance.id,name:instance.name,layerIds:evaluated.layers.filter(layer=>layer.instanceId===instance.id&&layer.included).map(layer=>layer.compiledLayerId)}));
 const groups=groupedLayerSections(document.layers,sections);
 expect(groups.map(group=>[group.section?.id,group.layers.map(layer=>layer.id)])).toEqual([['near',initial.slice(0,2)],['far',initial.slice(2)]]);
 const listOrder=groups.flatMap(group=>group.layers),selection=selectLayerRows(listOrder,null,initial[1],[],{shift:false,toggle:false});
 expect(selectLayerRows(listOrder,selection.anchor,initial[2],selection.ids,{shift:true,toggle:false}).ids).toEqual([initial[1],initial[2]]);
 const html=renderToStaticMarkup(createElement(SceneLayerPanel,{scene:f.scene,evaluated,selection:{ids:[]},onSelection:()=>{},run:()=>{},editEnabled:true}));
 expect((html.match(/data-testid="drawing-layer-section-toggle"/g)??[])).toHaveLength(2);
 expect((html.match(/<strong>Near face<\/strong><small>2<\/small>/g)??[])).toHaveLength(1);
 expect((html.match(/<strong>Far face<\/strong><small>2<\/small>/g)??[])).toHaveLength(1);
 expect([...html.matchAll(/data-testid="drawing-layer" data-id="([^"]+)"/g)].map(match=>match[1])).toEqual(initial);
 expect([...html.matchAll(/data-testid="drawing-layer-global-order"[^>]*>(?:层序|Order) (\d+)</g)].map(match=>Number(match[1]))).toEqual([1,3,2,4]);
 expect(JSON.stringify(evaluated)).toBe(before);expect(JSON.stringify(f.scene)).toBe(sceneBefore);expect(sourceState(f)).toBe(sourceBefore);
});
