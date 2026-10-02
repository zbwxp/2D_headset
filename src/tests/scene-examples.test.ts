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
const sideRaw=readFileSync(new URL('../assets/right90-reference.json',import.meta.url),'utf8');
const example=()=>parseLandmarks(raw);
const frontLayers=['5b7519c8-b451-442d-8ebb-deec4091ef2b','909c9a51-f5f1-4e3a-9da9-6b4544ad0d9c'];
const redLayer='5af1eb38-6a86-4521-abe6-113150188944';
const sceneIds=(s:RecordingScene)=>[s.id,...s.instances.map(i=>i.id),...[...s.warps,...s.visibilityTracks,...s.intervalTracks,...(s.depthTracks??[])].flatMap(t=>[t.id,...t.keys.map(k=>k.id)])];
const evaluate=(p:ReturnType<typeof example>,x:number)=>{const sources=recordingSceneSources(p);return evaluateScene(p.recordingScenes!.scenes.at(-1)!,id=>sources[id],{angle:{x,y:0}});};
const render=(drawing:DrawingDocument,paintBatches?:ReturnType<typeof evaluateScene>['paintBatches'])=>renderToStaticMarkup(createElement('svg',null,createElement(PaintScene,{d:drawing,paintBatches,screen:point=>point,unit:100,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}})));
afterEach(()=>vi.restoreAllMocks());

function applyImport(plan:ReturnType<typeof planSceneExampleImport>){
 const editor=useEditor.getState();editor.beginEdit();
 try{
  for(const step of plan.steps)editor.setDrawingSnapshotState(step);
  const current=useEditor.getState().project.recordingScenes??{version:1 as const,scenes:[]};
  editor.setRecordingScenes({...current,activeSceneId:plan.scene.id,scenes:current.scenes.some(scene=>scene.id===plan.scene.id)?current.scenes:[...current.scenes,plan.scene]});
 }finally{editor.endEdit();}
 return useEditor.getState().project;
}

function simpleSource(){const layered=addLayer(emptyDrawing(),'Existing source');return createCurve(layered,layered.layers[0].id,[[0,0],[.2,.1],[.7,.1],[1,0]],.008,'Existing curve');}

function independentRed(){
 const old=JSON.parse(oldRaw).drawing as DrawingDocument,layer=old.layers.find(l=>l.id===redLayer)!,items=new Set(layer.items),curves=old.curves.filter(c=>items.has(c.id)),ids=new Set(curves.map(c=>c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
 return {version:3 as const,layers:[layer],curves,nodes:old.nodes.filter(n=>nodes.has(n.id)),fills:old.fills.filter(f=>items.has(f.id)),offsets:old.offsets.filter(o=>items.has(o.id)),joins:old.joins.filter(j=>ids.has(j.a.curveId)&&ids.has(j.b.curveId)),endpointLinks:old.endpointLinks?.filter(l=>ids.has(l.a.curveId)&&ids.has(l.b.curveId)),groups:old.groups?.filter(g=>g.curveIds.every(id=>ids.has(id))),displayIntervals:old.displayIntervals?.filter(t=>ids.has(t.anchor.id))};
}

test('full project contains two lossless Drawing assets and one genuine two-instance scene',async()=>{
 const p=await loadSceneExample(async()=>raw),library=p.drawingSnapshots!,scene=p.recordingScenes!.scenes[0],red=independentRed(),side=JSON.parse(sideRaw) as DrawingDocument;
 expect(library.items).toHaveLength(2);expect(snapshotMatches(p.drawing!,library,library.activeId!)).toBe(true);
 expect(p.vectorRecording).toBeUndefined();expect(scene.legacy).toBeUndefined();expect(scene.name).toBe(SCENE_EXAMPLE_NAME);
 expect(scene.instances).toHaveLength(2);expect(new Set(scene.instances.map(i=>i.artworkId)).size).toBe(2);
 for(const instance of scene.instances){const source=snapshotDrawing(library,instance.artworkId);expect(instance.sourceSignature).toBe(drawingSignature(source));expect(instance.sourceStructureSignature).toBe(sourceStructureSignature(source));expect(instance.sourceIntervalFrames).toEqual(sourceIntervalFrames(source));}
 const front=snapshotDrawing(library,scene.instances[0].artworkId),fullSide=snapshotDrawing(library,scene.instances[1].artworkId);
 expect(front).toEqual(JSON.parse(frontRaw));expect(front.curves).toHaveLength(121);expect(scene.instances[0].layerIds).toEqual(frontLayers);expect(scene.instances[1].layerIds).toEqual([redLayer]);
 expect(fullSide.layers[0]).toEqual({...red.layers[0],name:'录制用·独立侧前轮廓'});expect(fullSide.layers.slice(1)).toEqual(side.layers);expect(fullSide.layers).toHaveLength(14);
 expect(fullSide.curves).toEqual([...side.curves,...red.curves.map(c=>({...c,visible:false}))]);expect(fullSide.curves).toHaveLength(134);
 expect(fullSide.fills).toEqual([...side.fills,...red.fills.map(f=>({...f,visible:false}))]);expect(fullSide.nodes).toEqual([...side.nodes,...red.nodes]);
 expect(fullSide.joins).toEqual([...side.joins,...red.joins]);expect(fullSide.endpointLinks).toEqual([...side.endpointLinks??[],...red.endpointLinks??[]]);
 expect(fullSide.mirrorAxisX).toBe(side.mirrorAxisX);expect(fullSide.mirrorEditing).toBeUndefined();
 expect(scene.visibilityTracks).toHaveLength(9);for(const member of [...red.curves,...red.fills])expect(scene.visibilityTracks.find(t=>t.target.sourceObjectId===member.id)?.keys.map(k=>[k.angle,k.value])).toEqual([[{x:0,y:0},true]]);
 // Bitmap fill mist needs a browser canvas; compare Drawing's actual vector
 // paint paths with the same fill mist disabled on both source copies.
 const vectorOnly=(d:DrawingDocument)=>({...d,fills:d.fills.map(f=>({...f,mist:undefined}))}),drawingMarkup=render(vectorOnly(fullSide));
 expect(drawingMarkup.match(/<path\b[^>]*>/g)).toEqual(render(vectorOnly(side)).match(/<path\b[^>]*>/g));
 for(const member of [...red.curves,...red.fills])expect(drawingMarkup).not.toContain(`data-id="${member.id}"`);
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

test.each([0,45,90])('all fourteen evaluated curves, fill/interval materials and interleaved scene depth survive import at %s',x=>{
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
   const expected=shapeOf(source,curve.id).map(point=>[point[0]+(instance===scene.instances[0]?.5740083507306889*x/90:0),point[1]]);
   shapeOf(a.drawing,originalId).forEach((point,i)=>point.forEach((value,axis)=>expect(value).toBeCloseTo(expected[i][axis],11)));
  }
 }
 const right=instanceObjectId(scene.instances[0].id,frontLayers[0]),left=instanceObjectId(scene.instances[0].id,frontLayers[1]),red=instanceObjectId(scene.instances[1].id,redLayer);
 const order=a.drawing.layers.map(l=>l.id);expect(order.indexOf(right)).toBeLessThan(order.indexOf(red));expect(order.indexOf(red)).toBeLessThan(order.indexOf(left));
 for(const result of [a,b]){const html=render(result.drawing,result.paintBatches);expect(html).toContain('drawing-fill');expect(html).not.toContain('drawing-route-error');expect(html).not.toContain('NaN');}
 for(const source of p.drawingSnapshots!.items)expect(plan.state.drawingSnapshots!.items.find(a=>a.id===plan.idMaps.artworks[source.id])!.drawing).toEqual(source.drawing);
 for(const instance of plan.scene.instances){const source=snapshotDrawing(plan.state.drawingSnapshots!,instance.artworkId);expect(instance.sourceSignature).toBe(drawingSignature(source));expect(instance.sourceStructureSignature).toBe(sourceStructureSignature(source));expect(instance.sourceIntervalFrames).toEqual(sourceIntervalFrames(source));}
 expect(JSON.stringify(p)).toBe(before);
});

test.each([0,45,90])('merging red into the full-side template preserves exact curves and PaintScene output at %s',x=>{
 const after=example(),before=structuredClone(after),red=independentRed(),scene=before.recordingScenes!.scenes[0],redId=scene.instances[1].artworkId;
 before.drawingSnapshots!.items.find(item=>item.id===redId)!.drawing=red;before.drawing=red;scene.visibilityTracks=[];
 const a=evaluate(before,x),b=evaluate(after,x);
 for(const result of [a,b]){expect(result.diagnostics).toEqual([]);expect(result.intervalTransportErrors).toEqual([]);expect(result.conflictingNodeIds).toEqual([]);}
 expect(b.drawing.curves).toEqual(a.drawing.curves);expect(b.drawing.nodes).toEqual(a.drawing.nodes);expect(b.drawing.fills).toEqual(a.drawing.fills);expect(b.drawing.displayIntervals).toEqual(a.drawing.displayIntervals);
 expect(render(b.drawing,b.paintBatches)).toBe(render(a.drawing,a.paintBatches));
 expect(after.recordingScenes!.scenes[0].warps).toEqual(scene.warps);
});

test('repeat starter actions reactivate the same scene without adding sources or scene identities',()=>{
 const p=example(),first=planSceneExampleImport({},p),existing={version:1 as const,activeSceneId:first.scene.id,scenes:[first.scene]},bytes=JSON.stringify(first),second=planSceneExampleImport(first.state,p,existing);
 const all=[...first.sourceArtworkIds,...sceneIds(first.scene)];expect(new Set(all).size).toBe(all.length);
 expect(second.reused).toBe(true);expect(second.steps).toEqual([]);expect(second.state).toBe(first.state);expect(second.scene).toBe(first.scene);expect(second.sourceArtworkIds).toEqual(first.sourceArtworkIds);
 for(let i=0;i<3;i++){const again=planSceneExampleImport(second.state,p,existing);expect(again.reused).toBe(true);expect(again.state.drawingSnapshots!.items).toHaveLength(2);expect(again.scene).toBe(first.scene);}
 expect(JSON.stringify(first)).toBe(bytes);expect(second.scene.depthTracks![0].target.instanceId).toBe(second.scene.instances[1].id);
});

test('starter activation prefers the current matching scene and preserves edited names, keys, drafts and appearance',()=>{
 const p=example(),first=planSceneExampleImport({},p),other=planSceneExampleImport(first.state,p),scene=structuredClone(first.scene);
 scene.name='My authored scene';scene.angle={x:45,y:12};scene.warps[0].name='Edited Warp';scene.warps[0].keys[1].value.nodes[0].position[0]+=.04;
 scene.warps[0].draft={angle:{x:45,y:12},value:structuredClone(scene.warps[0].keys[1].value)};scene.visibilityTracks[0].keys[0].value=false;scene.depthTracks![0].keys[0].value+=.5;
 const state=structuredClone(first.state);state.drawingSnapshots!.items.forEach((item,index)=>item.name=`Renamed source ${index}`);
 const existing={version:1 as const,activeSceneId:scene.id,scenes:[scene,other.scene]},bytes=JSON.stringify({state,existing});
 vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw Error('A repeat must not allocate IDs');});
 const plan=planSceneExampleImport(state,p,existing);
 expect(plan.reused).toBe(true);expect(plan.scene).toBe(scene);expect(plan.state).toBe(state);expect(plan.steps).toEqual([]);expect(JSON.stringify({state,existing})).toBe(bytes);
});

test('missing scene reuses the complete existing source ID graphs with edited geometry and working copies intact',()=>{
 const p=example(),first=planSceneExampleImport({},p),state=structuredClone(first.state),frontId=first.sourceArtworkIds[0],sideId=first.sourceArtworkIds[1],front=snapshotDrawing(state.drawingSnapshots!,frontId);
 delete front.mirrorEditing;
 const selected=front.curves.find(c=>front.layers.find(l=>l.id===frontLayers[0])!.items.includes(c.id))!;
 state.drawingWorkingCopies={[frontId]:moveHandle(front,{curveId:selected.id,end:0},[selected.handles[0][0]+.0001,selected.handles[0][1]])};
 state.drawing!.curves[0].handles[0][0]+=.0001;state.drawingSnapshots!.items.forEach(item=>item.name='User renamed');
 const bytes=JSON.stringify(state),plan=planSceneExampleImport(state,p),sources=recordingSceneSources(state);
 expect(plan.reused).toBe(false);expect(plan.reusedSources).toBe(true);expect(plan.steps).toEqual([]);expect(plan.state).toBe(state);expect(plan.sourceArtworkIds).toEqual([frontId,sideId]);
 expect(plan.scene.instances.map(i=>i.sourceSignature)).toEqual([drawingSignature(sources[frontId]),drawingSignature(sources[sideId])]);
 const again=planSceneExampleImport(state,p,{version:1,activeSceneId:plan.scene.id,scenes:[plan.scene]});expect(again.reused).toBe(true);expect(again.scene).toBe(plan.scene);expect(JSON.stringify(state)).toBe(bytes);
});

test('source names do not authorize reuse and a missing side source adds only that source',()=>{
 const p=example(),first=planSceneExampleImport({},p),frontId=first.sourceArtworkIds[0],frontOnly={drawingSnapshots:{...first.state.drawingSnapshots!,activeId:frontId,items:first.state.drawingSnapshots!.items.slice(0,1)},drawing:snapshotDrawing(first.state.drawingSnapshots!,frontId)};
 const partial=planSceneExampleImport(frontOnly,p);expect(partial.steps).toHaveLength(1);expect(partial.sourceArtworkIds[0]).toBe(frontId);expect(partial.state.drawingSnapshots!.items).toHaveLength(2);
 const decoy=saveDrawingSnapshot({drawing:simpleSource()},p.drawingSnapshots!.items[0].name),decoyId=decoy.drawingSnapshots!.activeId!;
 const imported=planSceneExampleImport(decoy,p);expect(imported.reusedSources).toBe(false);expect(imported.sourceArtworkIds).not.toContain(decoyId);expect(imported.state.drawingSnapshots!.items).toHaveLength(3);
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
