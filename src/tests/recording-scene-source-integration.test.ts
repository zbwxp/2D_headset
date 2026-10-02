import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareSceneBatch,evaluateRecordingScene} from '../app/recordingSceneApi';
import {prepareArtworkAction} from '../app/vectorArtworkApi';
import {serializeProject} from '../app/autosave';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {moveHandle} from '../domain/drawing/commands';
import {shapeOf} from '../domain/drawing/model';
import {instanceObjectId} from '../domain/recordingScene/model';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import type {SceneCommand} from '../domain/recordingScene/commands';

const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
const raw=readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8');
const activeScene=()=>{const r=useEditor.getState().project.recordingScenes!;return r.scenes.find(s=>s.id===r.activeSceneId)!;};
function sceneCommands(commands:SceneCommand[]){const plan=prepareSceneBatch(useEditor.getState().project,{commands});useEditor.getState().commitRecordingScenes(plan.recordingScenes);return plan;}
function setup(){
 useEditor.getState().load(parseLandmarks(raw));const project=useEditor.getState().project,artworkId=project.drawingSnapshots!.activeId!;
 sceneCommands([{op:'addInstance',artworkId,name:'Second reference to the same source'}]);useEditor.setState({past:[],future:[]});
 const source=useEditor.getState().project.drawing!,layer=source.layers.find(l=>l.name==='嘴部')!,mouth=source.curves.find(c=>layer.items.includes(c.id))!;
 return {artworkId,mouthId:mouth.id,source,scene:activeScene(),project:useEditor.getState().project};
}
function sourceEdit(id:string,dy=.01){const s=useEditor.getState(),d=s.project.drawing!,h=d.curves.find(c=>c.id===id)!.handles[0];s.beginEdit();try{s.setDrawing(moveHandle(d,{curveId:id,end:0},[h[0],h[1]+dy]));}finally{s.endEdit();}}
function artwork(request:unknown){const plan=prepareArtworkAction(useEditor.getState().project,request),s=useEditor.getState();s.beginEdit();try{s.setDrawingSnapshotState(plan.state);}finally{s.endEdit();}return plan;}
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});

test('one live source edit updates two independently namespaced instances, keeps every scene key, and has one Undo',()=>{
 const base=setup(),before=evaluateRecordingScene(base.project,{angle:{x:0,y:0}}),authored=JSON.stringify({warps:base.scene.warps,bindings:base.scene.bindings,visibilityTracks:base.scene.visibilityTracks,intervalTracks:base.scene.intervalTracks});
 sourceEdit(base.mouthId);const changed=useEditor.getState().project,next=evaluateRecordingScene(changed,{angle:{x:0,y:0}}),scene=activeScene();
 for(const instance of scene.instances){const id=instanceObjectId(instance.id,base.mouthId),old=shapeOf(before.drawing,id),now=shapeOf(next.drawing,id);expect(now[1][1]-old[1][1]).toBeCloseTo(.01,10);}
 expect(JSON.stringify({warps:scene.warps,bindings:scene.bindings,visibilityTracks:scene.visibilityTracks,intervalTracks:scene.intervalTracks})).toBe(authored);expect(scene.instances[0].sourceSignature).toBe(scene.instances[1].sourceSignature);expect(useEditor.getState().past).toHaveLength(1);
 expect(changed.drawingSnapshots).toBe(base.project.drawingSnapshots);expect(next.diagnostics).toEqual([]);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(base.project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(changed);
},15000);

test('renaming the source preserves both references, and saving a duplicate never retargets them',()=>{
 const base=setup(),ids=base.scene.instances.map(i=>[i.id,i.artworkId]);artwork({op:'rename',artworkId:base.artworkId,name:'Renamed shared source'});expect(activeScene().instances.map(i=>[i.id,i.artworkId])).toEqual(ids);
 const originalSource=useEditor.getState().project.drawingSnapshots!.items.find(a=>a.id===base.artworkId)!.drawing,copy=artwork({op:'save',name:'Independent source duplicate'});expect(copy.result.artworkId).not.toBe(base.artworkId);expect(activeScene().instances.map(i=>[i.id,i.artworkId])).toEqual(ids);
 sourceEdit(base.mouthId,.02);const current=useEditor.getState().project,result=evaluateRecordingScene(current,{angle:{x:0,y:0}});for(const instance of activeScene().instances)expect(shapeOf(result.drawing,instanceObjectId(instance.id,base.mouthId))).toEqual(shapeOf(originalSource,base.mouthId));
});

test('a scene-only asset deletion keeps scene keys and explicit orphan references; source Undo reconnects them',()=>{
 const base=setup();useEditor.setState({project:{...base.project,vectorRecording:undefined},past:[],future:[]});const before=useEditor.getState().project,sceneJSON=JSON.stringify(activeScene());
 artwork({op:'delete',artworkId:base.artworkId});const deleted=useEditor.getState().project;expect(JSON.stringify(activeScene())).toBe(sceneJSON);
 const result=evaluateRecordingScene(deleted);expect(result.diagnostics.filter(d=>d.code==='MISSING_SOURCE').map(d=>d.instanceId)).toEqual(activeScene().instances.map(i=>i.id));expect(deleted.drawing).toBe(before.drawing);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);expect(evaluateRecordingScene(useEditor.getState().project).diagnostics).toEqual([]);
});

test('removing scene instances and unused Warps preserves the complete Drawing library and archived rig',()=>{
 const base=setup(),library=JSON.stringify(base.project.drawingSnapshots),source=JSON.stringify(base.project.drawing),legacy=JSON.stringify(base.project.vectorRecording);useWorkspaceMode.getState().setMode('recording');
 sceneCommands([...base.scene.instances.map(i=>({op:'removeInstance' as const,instanceId:i.id})),{op:'cleanupUnused',removeUnboundWarps:true}]);
 const after=useEditor.getState().project;expect(activeScene().instances).toHaveLength(0);expect(activeScene().warps).toHaveLength(0);expect(JSON.stringify(after.drawingSnapshots)).toBe(library);expect(JSON.stringify(after.drawing)).toBe(source);expect(JSON.stringify(after.vectorRecording)).toBe(legacy);expect(useEditor.getState().past).toHaveLength(1);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(base.project);
});

test('an old unsaved working rig migrates, gains a stable source ID on first save, and survives another active artwork and reload',()=>{
 const old=parseLandmarks(raw),working={...old,drawingSnapshots:undefined,recordingScenes:undefined,vectorRecording:{...old.vectorRecording!,rigs:old.vectorRecording!.rigs.map(r=>({...r,artworkId:'$working'}))}};
 useEditor.getState().load(working);useEditor.setState({past:[],future:[]});const before=useEditor.getState().project,keys=JSON.stringify(activeScene().warps),plan=artwork({op:'save',name:'First library asset'}),saved=useEditor.getState().project;
 expect(activeScene().instances.every(i=>i.artworkId===plan.result.artworkId)).toBe(true);expect(evaluateRecordingScene(saved).diagnostics).toEqual([]);expect(JSON.stringify(activeScene().warps)).toBe(keys);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);expect(activeScene().instances.every(i=>i.artworkId==='$working')).toBe(true);useEditor.getState().redo();expect(useEditor.getState().project).toBe(saved);
 const copy=artwork({op:'save',name:'Another active Drawing artwork'}),layer=saved.drawing!.layers.find(l=>l.name==='嘴部')!,mouth=saved.drawing!.curves.find(c=>layer.items.includes(c.id))!;sourceEdit(mouth.id,.02);
 const changed=useEditor.getState().project;expect(changed.drawingSnapshots!.activeId).toBe(copy.result.artworkId);expect(activeScene().instances.every(i=>i.artworkId===plan.result.artworkId)).toBe(true);
 useEditor.getState().load(parseLandmarks(serializeProject(changed)));const reloaded=useEditor.getState().project;expect(reloaded.drawingSnapshots!.activeId).toBe(copy.result.artworkId);expect(activeScene().instances.every(i=>i.artworkId===plan.result.artworkId)).toBe(true);expect(JSON.stringify(activeScene().warps)).toBe(keys);
 const result=evaluateRecordingScene(reloaded,{angle:{x:0,y:0}}),instance=activeScene().instances[0];expect(shapeOf(result.drawing,instanceObjectId(instance.id,mouth.id))).toEqual(shapeOf(saved.drawing!,mouth.id));expect(result.diagnostics).toEqual([]);
},15000);

test('updated source, shared references, scene keys and previews survive save and reload',()=>{
 const base=setup();sourceEdit(base.mouthId);artwork({op:'save',name:'Updated source',artworkId:base.artworkId});const before=useEditor.getState().project,sceneJSON=JSON.stringify(before.recordingScenes),output=evaluateRecordingScene(before,{angle:{x:60,y:0}});
 useEditor.getState().load(parseLandmarks(serializeProject(before)));const reloaded=useEditor.getState().project;expect(JSON.stringify(reloaded.recordingScenes)).toBe(sceneJSON);expect(reloaded.drawing).toEqual(before.drawing);expect(evaluateRecordingScene(reloaded,{angle:{x:60,y:0}}).drawing).toEqual(output.drawing);
},15000);

test('two instances migrate their different route cuts once each when the shared source jaw curvature changes',()=>{
 const base=setup(),track=base.source.displayIntervals!.find(t=>t.displayRoute)!,range=track.ranges.find(r=>r.mode==='SHOW')!,owner=base.source.layers.find(l=>l.items.includes(track.anchor.id))!,instances=base.scene.instances;
 useWorkspaceMode.getState().setMode('recording');sceneCommands([
  {op:'changeInterval',instanceId:instances[0].id,sourceTrackId:track.id,rangeId:range.id,start:.4,end:.6},
  {op:'changeInterval',instanceId:instances[1].id,sourceTrackId:track.id,rangeId:range.id,start:.43,end:.55},
  {op:'saveSelected',layerRefs:instances.map(i=>({instanceId:i.id,sourceLayerId:owner.id}))},
 ]);useEditor.setState({past:[],future:[]});const before=useEditor.getState().project,sceneBefore=activeScene(),warps=JSON.stringify(sceneBefore.warps),fieldBefore=createDisplayRouteField(before.drawing!,track.displayRoute!);
 const oldRanges=instances.map(i=>sceneBefore.intervalTracks.find(t=>t.instanceId===i.id&&t.sourceTrackId===track.id)!.keys.find(k=>k.angle.x===0&&k.angle.y===0)!.value.appearance!.ranges.find(r=>r.id===range.id)!);
 const materials=oldRanges.map(r=>[fieldBefore.materialAt(r.start)!,fieldBefore.materialAt(r.end)!]);expect(materials[0][0].kind).toBe('curve');const first=materials[0][0];if(first.kind!=='curve')throw Error('Fixture start must lie on the jaw cubic');
 useWorkspaceMode.getState().setMode('drawing');sourceEdit(first.curveId,.005);const after=useEditor.getState().project,scene=activeScene(),fieldAfter=createDisplayRouteField(after.drawing!,track.displayRoute!);
 instances.forEach((i,index)=>{const own=scene.intervalTracks.find(t=>t.instanceId===i.id&&t.sourceTrackId===track.id)!;expect(own.materialIssue).toBeUndefined();const updated=own.keys.find(k=>k.angle.x===0&&k.angle.y===0)!.value.appearance!.ranges.find(r=>r.id===range.id)!;
  expect(updated.start).toBeCloseTo(fieldAfter.positionOf(materials[index][0])!,10);expect(updated.end).toBeCloseTo(fieldAfter.positionOf(materials[index][1])!,10);expect(updated.start).not.toBe(oldRanges[index].start);
 });
 expect(JSON.stringify(scene.warps)).toBe(warps);expect(useEditor.getState().past).toHaveLength(1);expect(after.drawingSnapshots).toBe(before.drawingSnapshots);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
},15000);
