import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {loadPerspectiveCandidates,planPerspectiveCandidateImport,PERSPECTIVE_CANDIDATE_SCENE_IDS} from '../app/perspectiveCandidates';
import {planSceneExampleImport} from '../app/sceneExamples';
import {useEditor} from '../app/store';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {snapshotDrawing} from '../domain/drawing/snapshots';
import {addLayer} from '../domain/drawing/commands';
import type {RecordingScene} from '../domain/recordingScene/model';

const raw=readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8');
const gridRaw=readFileSync(new URL('../assets/three-piece-perspective-candidate-grids.json',import.meta.url),'utf8');
const baseRaw=readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8');
// Canonical JSON hashes of the approved offline moderate / narrow grid files.
const approvedGridHashes=['c7e549a0502bc96d363a1015ecc9bb6f973ea94888630639e4da36447d91995b','e5dee3073fc13664245d65ab550e6a9e64a90aab92eeaf1050c2fad79108978f'];
const load=()=>loadPerspectiveCandidates(async()=>({project:raw,grids:gridRaw}));
const endpoint=(scene:RecordingScene,warp=0,x=90)=>scene.warps[warp].keys.find(key=>key.angle.x===x&&key.angle.y===0)!;
const sceneSet=(scenes:RecordingScene[])=>({version:1 as const,activeSceneId:scenes[0].id,scenes});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

test('B/C use the exact offline grids and retain original sources, 0°, red, tracks, tolerance and warnings',async()=>{
 const loaded=await load(),before=JSON.stringify(loaded),plan=planPerspectiveCandidateImport({},loaded),mother=loaded.project.recordingScenes!.scenes[0];
 expect(plan.scenes.map(scene=>scene.id)).toEqual(Object.values(PERSPECTIVE_CANDIDATE_SCENE_IDS));
 expect(plan.activeSceneId).toBe(PERSPECTIVE_CANDIDATE_SCENE_IDS.B);expect(plan.state.drawingSnapshots!.items).toHaveLength(2);expect(plan.steps).toHaveLength(2);
 const sources=recordingSceneSources(plan.state);
 for(const [index,label] of (['B','C'] as const).entries()){
  const scene=plan.scenes[index];
  expect(createHash('sha256').update(JSON.stringify(endpoint(scene).value)).digest('hex')).toBe(approvedGridHashes[index]);
  expect(endpoint(scene).name).toBe(`90°候选 ${label} · 仅端点`);expect(endpoint(scene).value).toEqual(loaded.grids[label]);expect(endpoint(scene,0,0).value).toEqual(endpoint(mother,0,0).value);
  expect(scene.warps[0].restGrid).toEqual(mother.warps[0].restGrid);
  for(const x of [0,90])expect(endpoint(scene,1,x).value).toEqual(endpoint(mother,1,x).value);
  expect(scene.warps[1].name).toBe(mother.warps[1].name);expect(endpoint(scene,1,0).name).toContain('收拢未完成');
  expect(scene.visibilityTracks.map(track=>track.keys.map(({id:_,...key})=>key))).toEqual(mother.visibilityTracks.map(track=>track.keys.map(({id:_,...key})=>key)));
  expect(scene.intervalTracks.map(track=>track.keys.map(({id:_,...key})=>key))).toEqual(mother.intervalTracks.map(track=>track.keys.map(({id:_,...key})=>key)));
  expect(scene.depthTracks!.map(track=>track.keys.map(({id:_,...key})=>key))).toEqual(mother.depthTracks!.map(track=>track.keys.map(({id:_,...key})=>key)));
  expect(scene.name).toContain(`90°候选 ${label}`);expect(scene.name).toContain('仅端点');expect(scene.tolerance).toBe(.004);
  const result=evaluateScene(scene,id=>sources[id],{angle:{x:90,y:0},validationSamples:4096});
  expect(result.diagnostics).toEqual([]);expect(result.intervalTransportErrors).toEqual([]);expect(result.conflictingNodeIds).toEqual([]);
  expect(result.drawing.curves).toHaveLength(14);expect(result.warningCurveIds).toHaveLength(index?4:6);expect(result.maxError*250).toBeCloseTo(index?7.855825069:2.924180957,6);
  expect(evaluateScene(scene,id=>sources[id],{angle:{x:0,y:0}}).warningCurveIds).toEqual([]);
 }
 expect(plan.scenes[0].instances.map(i=>i.artworkId)).toEqual(plan.scenes[1].instances.map(i=>i.artworkId));
 for(const [index,item] of plan.state.drawingSnapshots!.items.entries())expect(snapshotDrawing(plan.state.drawingSnapshots!,item.id)).toEqual(snapshotDrawing(loaded.project.drawingSnapshots!,loaded.project.drawingSnapshots!.items[index].id));
 expect(JSON.stringify(loaded)).toBe(before);expect(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8')).toBe(raw);
});

test('actual five-source exemplar reuses sources and never alters its authored starter scene',async()=>{
 const loaded=await load(),base=parseLandmarks(baseRaw),starter=planSceneExampleImport(base,loaded.project,base.recordingScenes,base.vectorRecording),state=starter.state,existing=sceneSet([starter.scene]);
 expect(state.drawingSnapshots!.items).toHaveLength(5);
 const bytes=JSON.stringify({state,existing}),plan=planPerspectiveCandidateImport(state,loaded,existing,base.vectorRecording);
 expect(plan.steps).toEqual([]);expect(plan.state).toBe(state);expect(plan.reusedSources).toBe(true);
 expect(plan.scenes.every(scene=>scene.instances.every(i=>starter.sourceArtworkIds.includes(i.artworkId)))).toBe(true);
 expect(JSON.stringify({state,existing})).toBe(bytes);
 const scenes=sceneSet([...existing.scenes,...plan.scenes]);scenes.activeSceneId=plan.activeSceneId;
 const plain=planSceneExampleImport(state,loaded.project,scenes,base.vectorRecording,{excludeSceneIds:Object.values(PERSPECTIVE_CANDIDATE_SCENE_IDS)});
 expect(plain.reused).toBe(true);expect(plain.scene).toBe(starter.scene);
});

test('repeat actions preserve candidate edits and names; only B navigation moves to 90°',async()=>{
 const loaded=await load(),first=planPerspectiveCandidateImport({},loaded),scenes=structuredClone(first.scenes);
 scenes[0].name='My B';scenes[0].angle={x:33,y:4};endpoint(scenes[0]).value.nodes[0].position[0]+=.002;
 scenes[0].warps[0].draft={angle:{x:90,y:0},value:structuredClone(endpoint(scenes[0]).value)};
 scenes[1].name='My C';scenes[1].angle={x:61,y:0};scenes[1].visibilityTracks[0].keys[0].value=false;
 const before=JSON.stringify(scenes),existing=sceneSet(scenes);vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw Error('Repeat must not allocate');});
 const again=planPerspectiveCandidateImport(first.state,loaded,existing);
 expect(again.reused).toBe(true);expect(again.reusedScenes).toEqual({B:true,C:true});expect(again.steps).toEqual([]);expect(again.state).toBe(first.state);
 expect(again.scenes[0]).toEqual({...scenes[0],angle:{x:90,y:0}});expect(again.scenes[1]).toBe(scenes[1]);expect(JSON.stringify(scenes)).toBe(before);
 parseRecordingScenes(sceneSet(again.scenes));
});

test('uncertain reuse cannot append a sixth source or import into an arbitrary three-source library',async()=>{
 const loaded=await load(),base=parseLandmarks(baseRaw),starter=planSceneExampleImport(base,loaded.project),state=structuredClone(starter.state);
 const side=starter.sourceArtworkIds[1],item=state.drawingSnapshots!.items.find(item=>item.id===side)!;
 item.drawing=addLayer(item.drawing,'Changed source structure');if(state.drawingSnapshots!.activeId===side)state.drawing=structuredClone(item.drawing);
 const before=JSON.stringify(state);expect(()=>planPerspectiveCandidateImport(state,loaded)).toThrow('未新增画稿');expect(JSON.stringify(state)).toBe(before);
 const arbitrary=structuredClone(base),changed=arbitrary.drawingSnapshots!.items.find(item=>item.id!==arbitrary.drawingSnapshots!.activeId)!;changed.id='unrelated';
 expect(()=>planPerspectiveCandidateImport(arbitrary,loaded)).toThrow('未新增画稿');
});

test('the real default three-artwork project imports candidates in one store Undo without changing the input',async()=>{
 const original=useEditor.getState();vi.useFakeTimers();
 try{
  const loaded=await load(),project=parseLandmarks(baseRaw);project.meta.name='Keep my project';useEditor.setState({project,past:[],future:[]});
  const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planPerspectiveCandidateImport(before,loaded,before.recordingScenes,before.vectorRecording),editor=useEditor.getState();
  editor.beginEdit();try{
   for(const step of plan.steps)editor.setDrawingSnapshotState(step);
   const current=useEditor.getState().project.recordingScenes??{version:1 as const,scenes:[]};
   editor.setRecordingScenes({...current,activeSceneId:plan.activeSceneId,scenes:[...current.scenes,...plan.scenes]});
  }finally{editor.endEdit();}
  const after=useEditor.getState().project;
  expect(after.drawingSnapshots!.items).toHaveLength(5);expect(after.drawingSnapshots!.items.slice(0,3)).toEqual(before.drawingSnapshots!.items);
  expect(after.vectorRecording).toEqual(before.vectorRecording);expect(after.poseRecording).toEqual(before.poseRecording);expect(after.meta.name).toBe(before.meta.name);
  expect(after.recordingScenes!.scenes.slice(0,before.recordingScenes?.scenes.length??0)).toEqual(before.recordingScenes?.scenes??[]);
  expect(JSON.stringify(before)).toBe(bytes);expect(useEditor.getState().past).toHaveLength(1);
  const reloaded=parseLandmarks(JSON.stringify(after));expect(reloaded.recordingScenes).toEqual(after.recordingScenes);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);
 }finally{useEditor.setState(original);}
});

test('loader rejects altered rest bounds before importing any source',async()=>{
 const grids=JSON.parse(gridRaw);grids.B.bounds.min[0]-=.1;
 await expect(loadPerspectiveCandidates(async()=>({project:raw,grids:JSON.stringify(grids)}))).rejects.toThrow('rest');
});
