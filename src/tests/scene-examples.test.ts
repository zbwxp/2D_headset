import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test,vi} from 'vitest';
import {loadSceneExample,planSceneExampleImport,SCENE_EXAMPLE_NAME} from '../app/sceneExamples';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {addLayer,createCurve,moveHandle} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotDrawing,snapshotMatches} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {emptyRecordingScene,instanceObjectId,type RecordingScene} from '../domain/recordingScene/model';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {createArtworkRig,drawingSignature,sourceIntervalFrames,emptyVectorRecording} from '../domain/vectorRecording/model';
import {sourceStructureSignature} from '../domain/vectorRecording/sourceCompatibility';
import PaintScene from '../ui/drawing/PaintScene';

const raw=readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8');
const oldRaw=readFileSync(new URL('../assets/three-piece-starting-example.json',import.meta.url),'utf8');
const frontRaw=readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8');
const example=()=>parseLandmarks(raw);
const frontLayers=['5b7519c8-b451-442d-8ebb-deec4091ef2b','909c9a51-f5f1-4e3a-9da9-6b4544ad0d9c'];
const redLayer='5af1eb38-6a86-4521-abe6-113150188944';
const sceneIds=(s:RecordingScene)=>[s.id,...s.instances.map(i=>i.id),...[...s.warps,...s.visibilityTracks,...s.intervalTracks,...(s.depthTracks??[])].flatMap(t=>[t.id,...t.keys.map(k=>k.id)])];
const evaluate=(p:ReturnType<typeof example>,x:number)=>{const sources=recordingSceneSources(p);return evaluateScene(p.recordingScenes!.scenes.at(-1)!,id=>sources[id],{angle:{x,y:0}});};
afterEach(()=>vi.restoreAllMocks());

function applyImport(plan:ReturnType<typeof planSceneExampleImport>){
 const editor=useEditor.getState();editor.beginEdit();
 try{
  for(const step of plan.steps)editor.setDrawingSnapshotState(step);
  const current=useEditor.getState().project.recordingScenes??{version:1 as const,scenes:[]};
  editor.setRecordingScenes({...current,activeSceneId:plan.scene.id,scenes:[...current.scenes,plan.scene]});
 }finally{editor.endEdit();}
 return useEditor.getState().project;
}

function simpleSource(){const layered=addLayer(emptyDrawing(),'Existing source');return createCurve(layered,layered.layers[0].id,[[0,0],[.2,.1],[.7,.1],[1,0]],.008,'Existing curve');}

test('full project contains two lossless Drawing assets and one genuine two-instance scene',async()=>{
 const p=await loadSceneExample(async()=>raw),library=p.drawingSnapshots!,scene=p.recordingScenes!.scenes[0],old=JSON.parse(oldRaw).drawing as DrawingDocument;
 expect(library.items).toHaveLength(2);expect(snapshotMatches(p.drawing!,library,library.activeId!)).toBe(true);
 expect(p.vectorRecording).toBeUndefined();expect(scene.legacy).toBeUndefined();expect(scene.name).toBe(SCENE_EXAMPLE_NAME);
 expect(scene.instances).toHaveLength(2);expect(new Set(scene.instances.map(i=>i.artworkId)).size).toBe(2);
 for(const instance of scene.instances){const source=snapshotDrawing(library,instance.artworkId);expect(instance.sourceSignature).toBe(drawingSignature(source));expect(instance.sourceStructureSignature).toBe(sourceStructureSignature(source));expect(instance.sourceIntervalFrames).toEqual(sourceIntervalFrames(source));}
 const front=snapshotDrawing(library,scene.instances[0].artworkId),red=snapshotDrawing(library,scene.instances[1].artworkId);
 expect(front).toEqual(JSON.parse(frontRaw));expect(front.curves).toHaveLength(121);expect(scene.instances[0].layerIds).toEqual(frontLayers);expect(scene.instances[1].layerIds).toEqual([redLayer]);
 const layer=old.layers.find(l=>l.id===redLayer)!,ids=new Set(layer.items),curveIds=new Set(old.curves.filter(c=>ids.has(c.id)).map(c=>c.id)),nodeIds=new Set(old.curves.filter(c=>curveIds.has(c.id)).flatMap(c=>c.nodes));
 expect(red.layers).toEqual([layer]);expect(red.curves).toEqual(old.curves.filter(c=>curveIds.has(c.id)));expect(red.curves).toHaveLength(8);
 expect(red.nodes).toEqual(old.nodes.filter(n=>nodeIds.has(n.id)));expect(red.fills).toEqual(old.fills.filter(f=>ids.has(f.id)));expect(red.fills).toHaveLength(1);
 expect(red.joins).toEqual(old.joins.filter(j=>curveIds.has(j.a.curveId)&&curveIds.has(j.b.curveId)));
 expect(red.endpointLinks).toEqual([]);expect(red.mirrorEditing).toBeUndefined();
 expect(readFileSync(new URL('../assets/three-piece-starting-example.json',import.meta.url),'utf8')).toBe(oldRaw);
 expect(readFileSync(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8')).toBe(frontRaw);
 await expect(loadSceneExample(async()=>'{}')).rejects.toThrow();
});

test('two root Warps retain starter grids, with only the +90 shared-face X translation',()=>{
 const p=example(),scene=p.recordingScenes!.scenes[0],rig=JSON.parse(oldRaw).vectorRecording.rigs[0];
 expect(scene.warps).toHaveLength(2);expect(scene.warps.every(w=>!w.parentId)).toBe(true);
 expect(scene.warps.map(w=>[w.restGrid.rows,w.restGrid.columns])).toEqual([[3,6],[1,1]]);
 expect(scene.bindings.map(b=>[b.instanceId,b.sourceLayerId,b.warpId])).toEqual([...frontLayers.map(id=>[scene.instances[0].id,id,scene.warps[0].id]),[scene.instances[1].id,redLayer,scene.warps[1].id]]);
 scene.warps.forEach((warp,index)=>{
  expect(warp.restGrid).toEqual(rig.deformers[index].grid);expect(warp.keys.map(k=>k.angle)).toEqual([{x:0,y:0},{x:90,y:0}]);
  for(const key of warp.keys){
   const oldKey=rig.keys.find((k:{angle:{x:number;y:number}})=>k.angle.x===key.angle.x&&k.angle.y===key.angle.y);
   expect(key.value).toEqual(oldKey.grids[rig.deformers[index].id]);
   const delta=index===0&&key.angle.x===90&&key.angle.y===0?.5740083507306889:0;
   for(let i=0;i<warp.restGrid.nodes.length;i++){
    for(const field of ['position','handleU','handleV'] as const){expect(key.value.nodes[i][field][0]-warp.restGrid.nodes[i][field][0]).toBeCloseTo(delta,12);expect(key.value.nodes[i][field][1]).toBe(warp.restGrid.nodes[i][field][1]);}
    expect(key.value.nodes[i].twist).toEqual(warp.restGrid.nodes[i].twist);
   }
  }
 });
 expect(scene.warps[1].keys.find(k=>k.angle.x===0&&k.angle.y===0)!.name).toContain('收拢未完成');
 expect(scene.warps[0].keys.find(k=>k.angle.x===90)!.name).toContain('压缩未完成');
});

test.each([0,90])('all fourteen evaluated curves, fill/interval materials and interleaved scene depth survive import at %s',x=>{
 const p=example(),before=JSON.stringify(p),plan=planSceneExampleImport({},p),imported={...createEmptyProject(),...plan.state,recordingScenes:{version:1 as const,activeSceneId:plan.scene.id,scenes:[plan.scene]}};
 const a=evaluate(p,x),b=evaluate(imported,x),scene=p.recordingScenes!.scenes[0];
 expect(a.drawing.curves).toHaveLength(14);expect(b.drawing.curves).toHaveLength(14);
 expect(a.diagnostics).toEqual([]);expect(b.diagnostics).toEqual([]);expect(a.intervalTransportErrors).toEqual([]);expect(b.intervalTransportErrors).toEqual([]);
 expect(a.conflictingNodeIds).toEqual([]);expect(b.conflictingNodeIds).toEqual([]);
 for(const instance of scene.instances){
  const source=snapshotDrawing(p.drawingSnapshots!,instance.artworkId),selected=source.curves.filter(c=>instance.layerIds!.some(id=>source.layers.find(l=>l.id===id)!.items.includes(c.id)));
  for(const curve of selected){
   const originalId=instanceObjectId(instance.id,curve.id),importedId=instanceObjectId(plan.idMaps.instances[instance.id],curve.id);
   expect(shapeOf(b.drawing,importedId)).toEqual(shapeOf(a.drawing,originalId));
   const expected=shapeOf(source,curve.id).map(point=>[point[0]+(instance===scene.instances[0]&&x===90?.5740083507306889:0),point[1]]);
   shapeOf(a.drawing,originalId).forEach((point,i)=>point.forEach((value,axis)=>expect(value).toBeCloseTo(expected[i][axis],11)));
  }
 }
 const right=instanceObjectId(scene.instances[0].id,frontLayers[0]),left=instanceObjectId(scene.instances[0].id,frontLayers[1]),red=instanceObjectId(scene.instances[1].id,redLayer);
 const order=a.drawing.layers.map(l=>l.id);expect(order.indexOf(right)).toBeLessThan(order.indexOf(red));expect(order.indexOf(red)).toBeLessThan(order.indexOf(left));
 const render=(result:typeof a)=>renderToStaticMarkup(createElement(PaintScene,{d:result.drawing,paintBatches:result.paintBatches,screen:point=>point,unit:100,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}}));
 for(const result of [a,b]){const html=render(result);expect(html).toContain('drawing-fill');expect(html).not.toContain('drawing-route-error');expect(html).not.toContain('NaN');}
 for(const source of p.drawingSnapshots!.items)expect(plan.state.drawingSnapshots!.items.find(a=>a.id===plan.idMaps.artworks[source.id])!.drawing).toEqual(source.drawing);
 for(const instance of plan.scene.instances){const source=snapshotDrawing(plan.state.drawingSnapshots!,instance.artworkId);expect(instance.sourceSignature).toBe(drawingSignature(source));expect(instance.sourceStructureSignature).toBe(sourceStructureSignature(source));expect(instance.sourceIntervalFrames).toEqual(sourceIntervalFrames(source));}
 expect(JSON.stringify(p)).toBe(before);
});

test('repeat imports allocate independent scene, instance, artwork, Warp, track and key identities',()=>{
 const p=example(),first=planSceneExampleImport({},p),existing={version:1 as const,activeSceneId:first.scene.id,scenes:[first.scene]},bytes=JSON.stringify(first),second=planSceneExampleImport(first.state,p,existing);
 const all=[...first.sourceArtworkIds,...second.sourceArtworkIds,...sceneIds(first.scene),...sceneIds(second.scene)];expect(new Set(all).size).toBe(all.length);
 expect(second.state.drawingSnapshots!.items.slice(0,2)).toEqual(first.state.drawingSnapshots!.items);expect(second.state.drawingSnapshots!.items.at(-1)!.name).toBe(first.state.drawingSnapshots!.items.at(-1)!.name+' · 2');
 expect(JSON.stringify(first)).toBe(bytes);expect(second.scene.depthTracks![0].target.instanceId).toBe(second.scene.instances[1].id);
});

test('actual store preserves dirty source, saved snapshots, old scenes, legacy rigs and settings in one Undo and reload',()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();
 try{
  useWorkspaceMode.getState().setMode('drawing');
  const existingSource=simpleSource(),first=saveDrawingSnapshot({drawing:existingSource},'Existing other source'),otherArtworkId=first.drawingSnapshots!.activeId!,source=simpleSource(),saved=saveDrawingSnapshot({...first,drawing:source},'Original'),artworkId=saved.drawingSnapshots!.activeId!,dirty=moveHandle(source,{curveId:source.curves[0].id,end:0},[.2,.37]),otherDraft=moveHandle(existingSource,{curveId:existingSource.curves[0].id,end:0},[.2,.28]);
  const oldScene={...emptyRecordingScene('existing','Existing authored scene'),instances:[{id:'existing-instance',artworkId,name:'Existing drawing',sourceSignature:drawingSignature(dirty),sourceStructureSignature:sourceStructureSignature(dirty),sourceIntervalFrames:sourceIntervalFrames(dirty)}]},rig=createArtworkRig(artworkId,dirty);
  const project={...createEmptyProject(),...saved,drawing:dirty,drawingWorkingCopies:{[otherArtworkId]:otherDraft},recordingScenes:{version:1 as const,activeSceneId:oldScene.id,scenes:[oldScene]},vectorRecording:{...emptyVectorRecording(),tolerance:.012,rigs:[rig]}};project.meta.name='Keep project settings';
  useEditor.setState({project,past:[],future:[]});
  const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planSceneExampleImport(before,example(),before.recordingScenes,before.vectorRecording),after=applyImport(plan);
  expect(plan.steps).toHaveLength(2);expect(plan.preservedDraftId).toBeUndefined();expect(after.drawingSnapshots!.items).toHaveLength(4);
  expect(after.drawingSnapshots!.items.slice(0,2)).toEqual(saved.drawingSnapshots!.items);expect(after.drawingWorkingCopies).toEqual({[otherArtworkId]:otherDraft,[artworkId]:dirty});
  expect(recordingSceneSources(after)[artworkId]).toEqual(dirty);expect(recordingSceneSources(after)[otherArtworkId]).toEqual(otherDraft);
  expect(after.recordingScenes!.scenes[0]).toEqual(oldScene);expect(after.vectorRecording).toEqual(project.vectorRecording);expect(after.meta).toEqual(project.meta);
  expect(useEditor.getState().past).toHaveLength(1);const reloaded=parseLandmarks(JSON.stringify(after));expect(reloaded.recordingScenes).toEqual(after.recordingScenes);expect(reloaded.drawingSnapshots).toEqual(after.drawingSnapshots);expect(reloaded.drawingWorkingCopies).toEqual(after.drawingWorkingCopies);expect(recordingSceneSources(reloaded)[artworkId]).toEqual(dirty);
  for(const x of [0,90])expect(evaluate(reloaded,x).drawing).toEqual(evaluate(after,x).drawing);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);expect(JSON.stringify(before)).toBe(bytes);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});

test.each([false,true])('actual store preserves existing $working scene/rig when drawing is absent=%s',absent=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();
 try{
  useWorkspaceMode.getState().setMode('drawing');const source=emptyDrawing(),working={...emptyRecordingScene('working-scene'),instances:[{id:'working-instance',artworkId:'$working',name:'Unsaved drawing'}]},rig=createArtworkRig('$working',source);
  useEditor.setState({project:{...createEmptyProject(),drawing:absent?undefined:source,recordingScenes:{version:1,activeSceneId:working.id,scenes:[working]},vectorRecording:{...emptyVectorRecording(),rigs:[rig]}},past:[],future:[]});
  const before=useEditor.getState().project,plan=planSceneExampleImport(before,example(),before.recordingScenes,before.vectorRecording),after=applyImport(plan);
  expect(plan.preservedDraftId).toBeTruthy();expect(after.recordingScenes!.scenes[0].instances[0].artworkId).toBe(plan.preservedDraftId);expect(after.vectorRecording!.rigs[0].artworkId).toBe(plan.preservedDraftId);
  expect(after.drawingSnapshots!.items.find(a=>a.id===plan.preservedDraftId)!.drawing).toEqual(source);expect(useEditor.getState().past).toHaveLength(1);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});

test.each(['source','layer','signature','route','dirty'] as const)('invalid %s example fails preflight without mutating current work',kind=>{
 const p=example(),scene=p.recordingScenes!.scenes[0],state=saveDrawingSnapshot({drawing:emptyDrawing()},'Untouched'),bytes=JSON.stringify(state);
 if(kind==='source')scene.instances[0].artworkId='missing';
 if(kind==='layer')scene.instances[0].layerIds!.push('missing');
 if(kind==='signature')scene.instances[0].sourceSignature='stale';
 if(kind==='route')p.drawingSnapshots!.items[0].drawing.endpointLinks!.find(l=>l.throughDisplay)!.joinBrush={kind:'SMOOTH'};
 if(kind==='dirty')p.drawing!.mirrorAxisX=99;
 expect(()=>planSceneExampleImport(state,p)).toThrow();expect(JSON.stringify(state)).toBe(bytes);
});

test('fresh-ID collision handling retries safely and rejects an exhausted allocator',()=>{
 const state=saveDrawingSnapshot({drawing:emptyDrawing()},'Keep'),oldId=state.drawingSnapshots!.activeId!,original=crypto.randomUUID.bind(crypto);let calls=0;
 const random=vi.spyOn(crypto,'randomUUID').mockImplementation(()=>++calls===1?oldId as ReturnType<typeof crypto.randomUUID>:original());
 const plan=planSceneExampleImport(state,example());expect(new Set(plan.state.drawingSnapshots!.items.map(a=>a.id)).size).toBe(3);
 random.mockImplementation(()=>oldId as ReturnType<typeof crypto.randomUUID>);expect(()=>planSceneExampleImport(state,example())).toThrow(/无冲突/);
});

test.each(['reference','route'] as const)('preflights existing working-copy %s before returning any import steps',kind=>{
 const saved=saveDrawingSnapshot({drawing:emptyDrawing()},'Existing'),source=JSON.parse(frontRaw) as DrawingDocument;
 if(kind==='route')source.endpointLinks!.find(l=>l.throughDisplay)!.joinBrush={kind:'SMOOTH'};
 const state={...saved,drawingWorkingCopies:{[kind==='reference'?'missing-artwork':saved.drawingSnapshots!.activeId!]:source}},bytes=JSON.stringify(state);
 expect(()=>planSceneExampleImport(state,example())).toThrow();expect(JSON.stringify(state)).toBe(bytes);
});
