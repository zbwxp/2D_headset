import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {artworkCleanupDrawingIdentity,artworkCleanupHash,isFullRightArtwork,isSymmetricFrontArtwork,ORIGINAL_ARTWORK_IDS,planArtworkCleanup,RECORDING_SIDE_LAYER_ID} from '../app/artworkCleanup';
import {emptyDrawing,parseDrawing} from '../domain/drawing/model';
import {snapshotDrawing} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {emptyRecordingScene} from '../domain/recordingScene/model';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';
import {evaluateVisibilityTrack} from '../domain/recordingScene/tracks';

const asset=(name:string)=>readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8');
function fixture(){
 const project=parseLandmarks(asset('three-piece-scene-example')),side=parseDrawing(JSON.parse(asset('right90-reference'))),library=project.drawingSnapshots!;
 // The shipping example now contains the merged full-side source. Reconstruct
 // the old two-source input explicitly so this migration fixture stays stable.
 const instance=project.recordingScenes!.scenes[0].instances[1],red=parseDrawing(JSON.parse(asset('recording-side-part')));
 library.items=library.items.map(item=>item.id===instance.artworkId?{...item,drawing:red}:item);
 project.recordingScenes!.scenes[0].visibilityTracks=project.recordingScenes!.scenes[0].visibilityTracks.filter(track=>track.target.instanceId!==instance.id);
 const originals=ORIGINAL_ARTWORK_IDS.map((id,i)=>({id,name:['正面','微侧','稍侧'][i],drawing:{...emptyDrawing(),mirrorAxisX:i/10}}));
 return {...project,drawing:originals[0].drawing,drawingSnapshots:{...library,activeId:originals[0].id,items:[...originals,...library.items,{id:'complete-side',name:'完整侧面',drawing:side},{id:'throwaway',name:'独特测试',drawing:{...emptyDrawing(),mirrorAxisX:9}}]}};
}

test('keeps precisely the original three, structural front and full side; preserves original objects and working copies',()=>{
 const p=fixture(),dirty={...p.drawing!,mirrorAxisX:5},otherCopy={...p.drawingSnapshots.items[1].drawing,mirrorAxisX:6};
 p.drawing=dirty;p.drawingWorkingCopies={[ORIGINAL_ARTWORK_IDS[1]]:otherCopy,throwaway:{...emptyDrawing(),mirrorAxisX:10}};
 const before=JSON.stringify(p),plan=planArtworkCleanup(p),next=plan.project;
 expect(next.drawingSnapshots!.items).toHaveLength(5);expect(next.drawingSnapshots!.items.slice(0,3)).toEqual(p.drawingSnapshots.items.slice(0,3));
 for(let i=0;i<3;i++)expect(next.drawingSnapshots!.items[i]).toBe(p.drawingSnapshots.items[i]);
 expect(next.drawingSnapshots!.items.slice(3).map(item=>item.name)).toEqual(['对称两半正脸','右侧90°']);
 expect(next.drawing).toBe(dirty);expect(next.drawingWorkingCopies![ORIGINAL_ARTWORK_IDS[1]]).toBe(otherCopy);expect(next.drawingWorkingCopies![ORIGINAL_ARTWORK_IDS[0]]).toBe(dirty);
 expect(next.drawingWorkingCopies!.throwaway).toBeUndefined();expect(plan.removed.map(item=>item.id)).toContain('throwaway');expect(plan.archivedScenes).toEqual([]);
 expect(JSON.stringify(p)).toBe(before);expect(plan.changed).toBe(true);
 const again=planArtworkCleanup(next);expect(again.changed).toBe(false);expect(again.project).toBe(next);
});

test('red source joins full side with every source ID/coordinate retained, hidden members and explicit scene appearance',()=>{
 const p=fixture(),scene=p.recordingScenes!.scenes[0],redInstance=scene.instances[1],red=snapshotDrawing(p.drawingSnapshots,redInstance.artworkId),beforeSources=recordingSceneSources(p),plan=planArtworkCleanup(p),next=plan.project,source=recordingSceneSources(next)['complete-side'],updated=next.recordingScenes!.scenes[0];
 expect(source.layers[0]).toMatchObject({id:RECORDING_SIDE_LAYER_ID,name:'录制用·独立侧前轮廓'});expect(source.layers.slice(1)).toEqual(beforeSources['complete-side'].layers);
 expect(updated.warps).toBe(scene.warps);expect(updated.bindings).toBe(scene.bindings);expect(updated.depthTracks).toBe(scene.depthTracks);
 expect(updated.instances[1]).toMatchObject({id:redInstance.id,artworkId:'complete-side',layerIds:[RECORDING_SIDE_LAYER_ID]});
 expect(source.curves.filter(c=>red.curves.some(old=>old.id===c.id))).toEqual(red.curves.map(c=>({...c,visible:false})));
 expect(source.nodes.filter(n=>red.nodes.some(old=>old.id===n.id))).toEqual(red.nodes);
 expect(source.fills.filter(f=>red.fills.some(old=>old.id===f.id))).toEqual(red.fills.map(f=>({...f,visible:false})));
 expect(plan.visibilityChanges).toBe(9);
 for(const x of [0,45,90]){
  const before=evaluateScene(scene,id=>beforeSources[id],{angle:{x,y:0}}),after=evaluateScene(updated,id=>recordingSceneSources(next)[id],{angle:{x,y:0}});
  expect(after.diagnostics).toEqual([]);expect(after.intervalTransportErrors).toEqual([]);expect(after.warpGrids).toEqual(before.warpGrids);
  expect(after.drawing.curves).toEqual(before.drawing.curves);expect(after.drawing.nodes).toEqual(before.drawing.nodes);expect(after.drawing.fills).toEqual(before.drawing.fills);
  expect(after.paintBatches.map(batch=>[batch.owner??batch.item.id,batch.position])).toEqual(before.paintBatches.map(batch=>[batch.owner??batch.item.id,batch.position]));
 }
});

test('null visibility keys and drafts keep former source inheritance; explicit false and layer gates remain',()=>{
 const p=fixture(),scene=p.recordingScenes!.scenes[0],instance=scene.instances[1],source=recordingSceneSources(p)[instance.artworkId],id=source.curves[0].id;
 scene.visibilityTracks=[{id:'existing',target:{instanceId:instance.id,sourceLayerId:RECORDING_SIDE_LAYER_ID,sourceObjectId:id},keys:[{id:'hidden',angle:{x:90,y:0},value:false},{id:'inherited',angle:{x:-90,y:0},value:null}],draft:{angle:{x:45,y:0},value:null}},{id:'layer-gate',target:{instanceId:instance.id,sourceLayerId:RECORDING_SIDE_LAYER_ID},keys:[{id:'gated',angle:{x:0,y:0},value:false}]}];
 const next=planArtworkCleanup(p).project.recordingScenes!.scenes[0],track=next.visibilityTracks.find(t=>t.id==='existing')!;
 expect(track.keys.find(k=>k.id==='hidden')!.value).toBe(false);expect(track.keys.find(k=>k.id==='inherited')!.value).toBe(true);expect(track.draft!.value).toBe(true);
 expect(track.keys.find(k=>k.angle.x===0&&k.angle.y===0)!.value).toBe(true);expect(next.visibilityTracks.find(t=>t.id==='layer-gate')).toBe(scene.visibilityTracks[1]);
 expect(evaluateVisibilityTrack(track,{x:45,y:0})).toBe(true);
});

test('chooses current-scene front over latest structural candidate; exact duplicates remap while unique sources and dependants archive',()=>{
 const p=fixture(),front=p.drawingSnapshots.items.find(item=>item.id===p.recordingScenes!.scenes[0].instances[0].artworkId)!;
 p.drawingSnapshots.items.push({...front,id:'front-copy',name:'renamed exact copy'},{...front,id:'front-edited',name:front.name,drawing:{...front.drawing,mirrorAxisX:.1,mirrorEditing:{...front.drawing.mirrorEditing!,enabled:false}}});
 const copyScene={...emptyRecordingScene('copy-scene','copy'),instances:[{id:'copy-instance',name:'copy',artworkId:'front-copy'}]},uniqueScene={...emptyRecordingScene('unique-scene','unique'),instances:[{id:'unique-instance',name:'unique',artworkId:'front-edited'}]};
 p.recordingScenes!.scenes.push(copyScene,uniqueScene);const rig=createArtworkRig('throwaway');p.vectorRecording={...emptyVectorRecording(),rigs:[rig]};
 const plan=planArtworkCleanup(p);
 expect(plan.project.drawingSnapshots!.items[3].id).toBe(front.id);expect(plan.project.recordingScenes!.scenes.find(s=>s.id==='copy-scene')!.instances[0].artworkId).toBe(front.id);
 expect(plan.archivedScenes).toEqual([{id:'unique-scene',name:'unique'}]);expect(plan.archivedRigIds).toEqual([rig.id]);expect(plan.project.vectorRecording!.rigs).toEqual([]);
});

test('candidate identities use curve and layer IDs, never artwork names or visibility; missing original identities stop the plan',()=>{
 const p=fixture(),front=p.drawingSnapshots.items[3].drawing,side=p.drawingSnapshots.items[5].drawing;
 expect(isSymmetricFrontArtwork(front)).toBe(true);expect(isFullRightArtwork(side)).toBe(true);
 expect(isSymmetricFrontArtwork({...front,curves:front.curves.map((c,i)=>i?c:{...c,id:'wrong-id'})})).toBe(false);
 expect(isFullRightArtwork({...side,layers:side.layers.slice(1)})).toBe(false);
 p.drawingSnapshots.items=p.drawingSnapshots.items.filter(item=>item.id!==ORIGINAL_ARTWORK_IDS[0]);expect(()=>planArtworkCleanup(p)).toThrow(/缺失/);
});

test('drawing canonicalization includes reference pixels and alignment, filling, visibility, and mirror settings',async()=>{
 const p=fixture(),d=p.drawingSnapshots.items[3].drawing;
 const altered={...d,curves:d.curves.map((c,i)=>i?c:{...c,visible:!c.visible})};
 expect(artworkCleanupDrawingIdentity(altered)).not.toBe(artworkCleanupDrawingIdentity(d));
 expect(await artworkCleanupHash(artworkCleanupDrawingIdentity(d))).toHaveLength(64);
 expect(await artworkCleanupHash(artworkCleanupDrawingIdentity(altered))).not.toBe(await artworkCleanupHash(artworkCleanupDrawingIdentity(d)));
});

test('without standalone red artwork the recording part is added inside full side once, without a sixth artwork',()=>{
 const p=fixture(),redId=p.recordingScenes!.scenes[0].instances[1].artworkId;
 p.drawingSnapshots.items=p.drawingSnapshots.items.filter(item=>item.id!==redId);p.recordingScenes={version:1,scenes:[]};
 const next=planArtworkCleanup(p).project;
 expect(next.drawingSnapshots!.items).toHaveLength(5);expect(recordingSceneSources(next)['complete-side'].layers[0].id).toBe(RECORDING_SIDE_LAYER_ID);
 expect(planArtworkCleanup(next).changed).toBe(false);
 // A subsequent authored recording-part edit is not overwritten by the template.
 const library=next.drawingSnapshots!,item=library.items[4],firstRed=RECORDING_SIDE_LAYER_ID,member=item.drawing.layers.find(layer=>layer.id===firstRed)!.items[0];
 item.drawing={...item.drawing,curves:item.drawing.curves.map(curve=>curve.id===member?{...curve,width:.123}:curve)};
 expect(planArtworkCleanup(next).project.drawingSnapshots!.items[4].drawing.curves.find(curve=>curve.id===member)!.width).toBe(.123);
});

test('side and red working copies merge separately from both saved checkpoints',()=>{
 const p=fixture(),redId=p.recordingScenes!.scenes[0].instances[1].artworkId,sources=recordingSceneSources(p),red=sources[redId],side=sources['complete-side'];
 const redCopy={...red,curves:red.curves.map((c,i)=>i?c:{...c,width:.03})},sideCopy={...side,curves:side.curves.map((c,i)=>i?c:{...c,visible:!c.visible})};
 p.drawingWorkingCopies={[redId]:redCopy,'complete-side':sideCopy};
 const next=planArtworkCleanup(p).project,saved=snapshotDrawing(next.drawingSnapshots!,'complete-side'),effective=recordingSceneSources(next)['complete-side'];
 expect(saved.curves.find(c=>c.id===red.curves[0].id)!.width).toBe(red.curves[0].width);
 expect(saved.curves.find(c=>c.id===side.curves[0].id)!.visible).toBe(side.curves[0].visible);
 expect(effective.curves.find(c=>c.id===red.curves[0].id)!.width).toBe(.03);expect(effective.curves.find(c=>c.id===side.curves[0].id)!.visible).toBe(!side.curves[0].visible);
 expect(next.drawingWorkingCopies![redId]).toBeUndefined();expect(next.drawingWorkingCopies!['complete-side']).toBeDefined();
});

test('source ordering guard archives noncurrent risky scenes and blocks risky current scenes without mutations',()=>{
 const p=fixture(),scene=p.recordingScenes!.scenes[0],risk={...scene,id:'risk',name:'红后还有实例',instances:[...scene.instances,{id:'tail',name:'尾部',artworkId:ORIGINAL_ARTWORK_IDS[0]}]};
 p.recordingScenes!.scenes.push(risk);const plan=planArtworkCleanup(p);expect(plan.archivedScenes).toEqual([{id:'risk',name:risk.name}]);
 p.recordingScenes!.activeSceneId=risk.id;const before=JSON.stringify(p);expect(()=>planArtworkCleanup(p)).toThrow(/红片后还有其他实例/);expect(JSON.stringify(p)).toBe(before);
});

test('current scene full-side source wins over a later plain-side copy and repeated cleanup preserves its scene and keys',()=>{
 const p=parseLandmarks(asset('three-piece-scene-example')),old=fixture(),scene=p.recordingScenes!.scenes[0],sideId=scene.instances[1].artworkId;
 p.drawingSnapshots!.items.push(...old.drawingSnapshots.items.slice(0,3),old.drawingSnapshots.items[5]);
 const plan=planArtworkCleanup(p);
 expect(plan.project.drawingSnapshots!.items[4].id).toBe(sideId);expect(plan.archivedScenes).toEqual([]);expect(plan.project.recordingScenes!.scenes[0]).toBe(scene);
 expect(plan.project.recordingScenes!.scenes[0].warps).toBe(scene.warps);expect(plan.visibilityChanges).toBe(0);expect(plan.removed.map(item=>item.id)).toContain('complete-side');
 const again=planArtworkCleanup(plan.project);expect(again.changed).toBe(false);expect(again.project).toBe(plan.project);
});
