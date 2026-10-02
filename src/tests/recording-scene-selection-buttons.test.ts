import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import type {SceneCommand} from '../domain/recordingScene/commands';
import {sceneSelectionPayload} from '../ui/vectorRecording/sceneSelection';

function fixture(){
 let project=parseLandmarks(readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8'));
 const run=(commands:SceneCommand[])=>{const result=prepareSceneBatch(project,{commands});project={...project,recordingScenes:result.recordingScenes};return project.recordingScenes!.scenes[0];};
 return {get scene(){return project.recordingScenes!.scenes[0];},run};
}

test('the Warp-only save button adds B45 without changing A or any layer keys',()=>{
 const f=fixture(),[a,b]=f.scene.warps;
 for(const x of [30,60])f.run([{op:'setAngle',angle:{x,y:0}},{op:'saveSelected',...sceneSelectionPayload([b.id],[])}]);
 expect(f.scene.warps.find(w=>w.id===a.id)!.keys).toHaveLength(2);expect(f.scene.warps.find(w=>w.id===b.id)!.keys).toHaveLength(4);
 const beforeA=structuredClone(f.scene.warps.find(w=>w.id===a.id)),beforeLayers=JSON.stringify([f.scene.visibilityTracks,f.scene.intervalTracks,f.scene.depthTracks]);
 const payload=sceneSelectionPayload([b.id],[]);expect(payload).not.toHaveProperty('layerRefs');
 const after=f.run([{op:'setAngle',angle:{x:45,y:0}},{op:'saveSelected',...payload}]);
 expect(after.warps.find(w=>w.id===b.id)!.keys).toHaveLength(5);expect(after.warps.find(w=>w.id===a.id)).toEqual(beforeA);
 expect(JSON.stringify([after.visibilityTracks,after.intervalTracks,after.depthTracks])).toBe(beforeLayers);
});

test('layer-only and mixed button selections write only their explicit objects',()=>{
 const f=fixture(),[a,b]=f.scene.warps,ref={instanceId:f.scene.instances[0].id,sourceLayerId:f.scene.instances[0].layerIds![0]},beforeWarps=structuredClone(f.scene.warps);
 const layerOnly=sceneSelectionPayload([],[ref]);expect(layerOnly).not.toHaveProperty('warpIds');
 f.run([{op:'setAngle',angle:{x:30,y:0}},{op:'saveSelected',...layerOnly}]);expect(f.scene.warps).toEqual(beforeWarps);
 expect(f.scene.visibilityTracks.find(t=>t.target.instanceId===ref.instanceId&&t.target.sourceLayerId===ref.sourceLayerId)!.keys).toHaveLength(1);
 f.run([{op:'setAngle',angle:{x:45,y:0}},{op:'saveSelected',...sceneSelectionPayload([b.id],[ref])}]);
 expect(f.scene.warps.find(w=>w.id===a.id)).toEqual(a);expect(f.scene.warps.find(w=>w.id===b.id)!.keys).toHaveLength(3);
 expect(f.scene.visibilityTracks.find(t=>t.target.instanceId===ref.instanceId&&t.target.sourceLayerId===ref.sourceLayerId)!.keys).toHaveLength(2);
});

test('Warp-only discard clears that draft and preserves a separate layer draft',()=>{
 const f=fixture(),b=f.scene.warps[1],ref={instanceId:f.scene.instances[0].id,sourceLayerId:f.scene.instances[0].layerIds![0]},p=b.restGrid.nodes[0].position;
 f.run([{op:'setAngle',angle:{x:45,y:0}},{op:'editWarpNodes',warpId:b.id,edits:[{index:0,position:[p[0]+.01,p[1]]}]},{op:'setVisibility',target:ref,visible:false}]);
 const layerBefore=structuredClone(f.scene.visibilityTracks),keysBefore=structuredClone(f.scene.warps.find(w=>w.id===b.id)!.keys);
 f.run([{op:'discardSelected',...sceneSelectionPayload([b.id],[])}]);
 expect(f.scene.warps.find(w=>w.id===b.id)!.draft).toBeUndefined();expect(f.scene.visibilityTracks).toEqual(layerBefore);expect(f.scene.warps.find(w=>w.id===b.id)!.keys).toEqual(keysBefore);
 expect(sceneSelectionPayload([],[])).toEqual({});
});
