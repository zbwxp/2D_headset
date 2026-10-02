import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch,type SceneCommand} from '../app/recordingSceneApi';
import {serializeProject} from '../app/autosave';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {instanceObjectId} from '../domain/recordingScene/model';
import type {DrawingSelection} from '../ui/drawing/session';
import {pruneRemovedSceneInstanceSelection} from '../ui/vectorRecording/sceneWarpSelection';

const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
const activeScene=()=>{const recording=useEditor.getState().project.recordingScenes!;return recording.scenes.find(scene=>scene.id===recording.activeSceneId)!;};
function run(commands:SceneCommand[]){const plan=prepareSceneBatch(useEditor.getState().project,{commands});useEditor.getState().commitRecordingScenes(plan.recordingScenes);return plan;}
function setup(){
 let drawing=addLayer(emptyDrawing(),'Source layer');const layerId=drawing.layers[0].id;
 drawing=createCurve(drawing,layerId,[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Contour','contour');
 drawing=addDisplayInterval(drawing,'contour','SHOW');
 useEditor.getState().load({...createEmptyProject(),...saveDrawingSnapshot({drawing},'Shared Drawing')});
 useWorkspaceMode.getState().setMode('recording');
 const artworkId=useEditor.getState().project.drawingSnapshots!.activeId!,interval=drawing.displayIntervals![0];
 const result=run([
  {op:'createScene',name:'Other scene',ref:'other'},{op:'addInstance',artworkId,name:'Other reference'},
  {op:'createScene',name:'Active scene',ref:'scene'},{op:'addInstance',artworkId,name:'Remove me',ref:'removed'},{op:'addInstance',artworkId,name:'Keep me',ref:'kept'},
  {op:'createViewpoint',name:'Front',angle:{x:0,y:0}},
  {op:'createWarp',name:'Shared Warp',layerRefs:[{instanceId:'$removed',sourceLayerId:layerId},{instanceId:'$kept',sourceLayerId:layerId}],rows:1,columns:1,ref:'warp'},
  {op:'wrapParent',warpIds:['$warp'],name:'Shared parent',rows:1,columns:1,ref:'parent'},
  ...['$removed','$kept'].flatMap((instanceId,index):SceneCommand[]=>[
   {op:'setVisibility',target:{instanceId,sourceLayerId:layerId},visible:index===0},
   {op:'changeInterval',instanceId,sourceTrackId:interval.id,rangeId:interval.ranges[0].id,start:.1+index*.1,end:.9},
   {op:'setLayerOrder',target:{instanceId,sourceLayerId:layerId},value:index+1},
  ]),
  {op:'saveSelected',warpIds:['$warp','$parent'],layerRefs:[{instanceId:'$removed',sourceLayerId:layerId},{instanceId:'$kept',sourceLayerId:layerId}]},
  {op:'setAngle',angle:{x:30,y:0}},{op:'saveSelected',warpIds:['$warp','$parent']},
  {op:'editWarpNodes',warpId:'$warp',edits:[{index:0,position:[-.05,-.05]}]},
  {op:'setAngle',angle:{x:17,y:23}},
 ]);
 const id=(ref:string)=>result.created.find(item=>item.ref===ref)!.id;
 useEditor.setState({past:[],future:[]});
 return {removedId:id('removed'),keptId:id('kept'),warpId:id('warp'),otherId:id('other'),before:useEditor.getState().project,scene:activeScene()};
}
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});

test('current-scene removal at an unestablished angle removes only the instance channels and is one Undo/Redo',()=>{
 const f=setup(),beforeJSON=JSON.stringify(f.before);
 expect(f.scene.viewpoints?.some(view=>view.angle.x===17&&view.angle.y===23)).toBe(false);
 for(const tracks of [f.scene.visibilityTracks,f.scene.intervalTracks,f.scene.depthTracks!])expect(tracks).toHaveLength(2);
 const result=run([{op:'removeInstance',instanceId:f.removedId}]),after=useEditor.getState().project,scene=activeScene();
 expect(result.removedIds).toEqual([f.removedId]);expect(scene.instances).toEqual(f.scene.instances.filter(instance=>instance.id!==f.removedId));
 expect(scene.bindings).toEqual(f.scene.bindings.filter(binding=>binding.instanceId!==f.removedId));
 expect(scene.visibilityTracks).toEqual(f.scene.visibilityTracks.filter(track=>track.target.instanceId!==f.removedId));
 expect(scene.intervalTracks).toEqual(f.scene.intervalTracks.filter(track=>track.instanceId!==f.removedId));
 expect(scene.depthTracks).toEqual(f.scene.depthTracks!.filter(track=>track.target.instanceId!==f.removedId));
 expect(scene.angle).toEqual({x:17,y:23});expect(scene.viewpoints).toEqual(f.scene.viewpoints);
 expect(after.recordingScenes!.scenes.find(other=>other.id===f.otherId)).toEqual(f.before.recordingScenes!.scenes.find(other=>other.id===f.otherId));
 expect(after.drawing).toBe(f.before.drawing);expect(after.drawingSnapshots).toBe(f.before.drawingSnapshots);expect(after.drawingWorkingCopies).toBe(f.before.drawingWorkingCopies);
 expect(JSON.stringify(f.before)).toBe(beforeJSON);expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().future).toHaveLength(0);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.before);expect(useEditor.getState().past).toHaveLength(0);
 useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().future).toHaveLength(0);
});

test('removal preserves a shared Warp, its parent, every key and draft, and the surviving instance binding through reload',()=>{
 const f=setup(),warp=f.scene.warps.find(item=>item.id===f.warpId)!;
 expect(warp.keys).toHaveLength(2);expect(warp.draft?.angle).toEqual({x:30,y:0});
 expect(f.scene.bindings.filter(binding=>binding.warpId===f.warpId)).toHaveLength(2);
 run([{op:'removeInstance',instanceId:f.removedId}]);const after=useEditor.getState().project;
 expect(activeScene().warps).toEqual(f.scene.warps);expect(activeScene().bindings).toEqual([{instanceId:f.keptId,sourceLayerId:f.scene.bindings[0].sourceLayerId,warpId:f.warpId}]);
 useEditor.getState().load(parseLandmarks(serializeProject(after)));const reloaded=useEditor.getState().project;
 expect(reloaded.recordingScenes).toEqual(after.recordingScenes);expect(activeScene().warps).toEqual(f.scene.warps);
 expect(reloaded.drawing).toEqual(f.before.drawing);expect(reloaded.drawingSnapshots).toEqual(f.before.drawingSnapshots);
});

test('removing the final instance keeps unbound Warps and their authored data for explicit later reuse',()=>{
 const f=setup();run([{op:'removeInstance',instanceId:f.removedId},{op:'removeInstance',instanceId:f.keptId}]);
 const scene=activeScene();expect(scene.instances).toEqual([]);expect(scene.bindings).toEqual([]);expect(scene.visibilityTracks).toEqual([]);expect(scene.intervalTracks).toEqual([]);expect(scene.depthTracks).toEqual([]);expect(scene.warps).toEqual(f.scene.warps);
 expect(useEditor.getState().project.drawingSnapshots).toBe(f.before.drawingSnapshots);expect(useEditor.getState().past).toHaveLength(1);
});

test('instance removal prunes all stale selection channels and preserves another instance and unrelated selections',()=>{
 const removed=(id:string)=>instanceObjectId('one',id),kept=(id:string)=>instanceObjectId('one:two',id);
 const selection:DrawingSelection={ids:[removed('curve'),kept('curve'),'warp-id'],layers:[removed('layer'),kept('layer')],layer:removed('layer'),paintIds:[removed('paint'),kept('paint')],paint:removed('paint'),group:removed('group'),node:removed('node'),handle:{curveId:removed('curve'),end:0},displayInterval:{track:removed('track'),range:removed('range'),end:1},inkEnd:{id:removed('curve'),end:0},reference:true,mirrorAxis:true};
 const before=structuredClone(selection),next=pruneRemovedSceneInstanceSelection(selection,'one');
 expect(next).toEqual({ids:[kept('curve'),'warp-id'],layers:[kept('layer')],layer:kept('layer'),paintIds:[kept('paint')],paint:kept('paint'),group:undefined,node:undefined,handle:undefined,displayInterval:undefined,inkEnd:undefined,reference:true,mirrorAxis:true});
 expect(selection).toEqual(before);
 const survivor:DrawingSelection={...selection,ids:[kept('curve')],layers:[kept('layer')],layer:kept('layer'),paintIds:[kept('paint')],paint:kept('paint'),group:kept('group'),node:kept('node'),handle:{curveId:kept('curve'),end:1},displayInterval:{track:kept('track'),range:kept('range'),end:0},inkEnd:{id:kept('curve'),end:1}};
 expect(pruneRemovedSceneInstanceSelection(survivor,'one')).toEqual(survivor);
});
