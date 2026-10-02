import {readFileSync,writeFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../app/recordingSnapshotApi';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {applySnapshotCommand,type SnapshotCommand} from '../domain/recordingSnapshot/commands';
const fixture=process.env.CONTOUR_USER_TURNING_FIXTURE;
test.skipIf(!fixture)('measure native preview boundary on the read-only user fixture',()=>{
 const text=readFileSync(fixture!,'utf8'),project=ensureRecordingSnapshots(parseLandmarks(text),text),workspace=project.recordingSnapshots,recording=workspace.recordings.find(r=>!r.legacy&&r.snapshotIds.length)!;
 workspace.activeRecordingId=recording.id;const snapshot=workspace.snapshots.find(s=>s.id===recording.activeSnapshotId)!,evaluation=resolveSnapshot(workspace,snapshot.id,{angle:recording.angle}),curve=evaluation.prePlacementDrawing.curves.find(c=>!c.locked&&c.visible)!,layer=evaluation.drawing.layers.find(l=>l.items.includes(curve.id))!,node=evaluation.prePlacementDrawing.nodes.find(n=>n.id===curve.nodes[0])!,command:SnapshotCommand={op:'moveShapeNode',layerId:layer.id,nodeId:node.id,position:[node.position[0]+.004,node.position[1]]};
 const times:Record<string,number[]>={};const measure=(label:string,action:()=>unknown)=>{const t=performance.now();const result=action();(times[label]??=[]).push(performance.now()-t);return result;};
 for(let i=0;i<3;i++){measure('strict_parse',()=>parseRecordingSnapshots(workspace));measure('whole_clone',()=>structuredClone(workspace));measure('whole_json_twice',()=>{JSON.stringify(workspace);JSON.stringify(workspace);});const detached=structuredClone(workspace);measure('command',()=>applySnapshotCommand(detached,command));measure('strict_shape_batch',()=>prepareSnapshotBatch(project,{recordingId:recording.id,commands:[command],dryRun:true}));measure('preview_shape',()=>prepareSnapshotPreview(project,{recordingId:recording.id,commands:[command]}));measure('preview_angle',()=>prepareSnapshotPreview(project,{recordingId:recording.id,commands:[{op:'setAngle',angle:{x:10,y:0}}]}));measure('strict_angle_batch',()=>prepareSnapshotBatch(project,{recordingId:recording.id,commands:[{op:'setAngle',angle:{x:10,y:0}}],dryRun:true}));}
 if(process.env.CONTOUR_PERF_REPORT)writeFileSync(process.env.CONTOUR_PERF_REPORT,JSON.stringify(times,null,2));console.log('SNAPSHOT_PREVIEW_BASELINE_MS',JSON.stringify(Object.fromEntries(Object.entries(times).map(([name,v])=>[name,v.map(n=>Number(n.toFixed(2)))]))));expect(project.recordingSnapshots).toBe(workspace);
});

import {createEmptyProject} from '../app/emptyProject';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {drawingSnapshotForArtwork,canonicalElementId} from '../domain/recordingSnapshot/sources';
import {identityScenePlacement} from '../domain/recordingScene/model';
import type {LandmarkProject} from '../domain/landmarks/model';
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function previewFixture(linked=false){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:linked?[1,0]:[0,1]},{id:'d',position:linked?[2,0]:[1,1]}],curves:[{id:'curve-a',name:'A',nodes:['a','b'],handles:[[.25,0],[.75,0]],visible:true,locked:false,width:.02},{id:'curve-b',name:'B',nodes:['c','d'],handles:linked?[[1.25,0],[1.75,0]]:[[.25,1],[.75,1]],visible:true,locked:false,width:.02}],layers:[{id:'layer-a',name:'A',items:['curve-a'],visible:true,locked:false},{id:'layer-b',name:'B',items:['curve-b'],visible:true,locked:false}],...(linked?{endpointLinks:[{id:'link',a:{curveId:'curve-a',end:1 as const},b:{curveId:'curve-b',end:0 as const}}]}:{})};
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing});const source=drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!;
 const update=(commands:SnapshotCommand[])=>{const result=prepareSnapshotBatch(project,{commands});project={...project,recordingSnapshots:result.recordingSnapshots};return result;};update([{op:'createRecording',name:'Preview'},{op:'pasteLayers',sourceSnapshotId:source.id}]);const recording=project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!,snapshot=project.recordingSnapshots!.snapshots.find(s=>s.id===recording.activeSnapshotId)!,[a,b]=snapshot.layers.map(l=>l.id);
 return {project:()=>project,update,a,b,sourceId:source.id,nodeId:canonicalElementId('$working',linked?'b':'a'),recording:()=>project.recordingSnapshots!.recordings.find(r=>r.id===recording.id)!};
}

test('trusted angle navigation shares all immutable geometry, snapshots and tracks and equals strict navigation',()=>{
 const h=previewFixture(),project=h.project(),before=JSON.stringify(project),workspace=freeze(project.recordingSnapshots!),command:SnapshotCommand={op:'setAngle',angle:{x:22,y:0}},preview=prepareSnapshotPreview(project,{commands:[command]}),strict=prepareSnapshotBatch(project,{commands:[command],dryRun:true});
 expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.recordingSnapshots.library).toBe(workspace.library);expect(preview.recordingSnapshots.legacyArchive).toBe(workspace.legacyArchive);expect(preview.recordingSnapshots.snapshots).toBe(workspace.snapshots);expect(preview.recordingSnapshots.recordings.find(r=>r.id===h.recording().id)!.tracks).toBe(h.recording().tracks);expect(JSON.stringify(project)).toBe(before);expect(prepareSnapshotPreview(project,{commands:[{op:'setAngle',angle:{x:0,y:0}}]}).recordingSnapshots).toBe(workspace);
});

test('trusted shape preview detaches only its draft track and matches the strict batch without copying saved keys',()=>{
 const h=previewFixture();h.update([{op:'moveShapeNode',layerId:h.a,nodeId:h.nodeId,position:[.1,.1]},{op:'setLayerPlacement',layerId:h.b,value:identityScenePlacement()},{op:'updateSnapshot'}]);const project=h.project(),workspace=freeze(project.recordingSnapshots!),before=JSON.stringify(project),recording=h.recording(),command:SnapshotCommand={op:'moveShapeNode',layerId:h.a,nodeId:h.nodeId,position:[.15,.12]},preview=prepareSnapshotPreview(project,{commands:[command]}),strict=prepareSnapshotBatch(project,{commands:[command],dryRun:true}),next=preview.recordingSnapshots.recordings.find(r=>r.id===recording.id)!;
 expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.recordingSnapshots.library).toBe(workspace.library);expect(preview.recordingSnapshots.snapshots).toBe(workspace.snapshots);for(const track of recording.tracks){const changed=next.tracks.find(t=>t.id===track.id)!;expect(changed.keys).toBe(track.keys);if(track.channel==='shape'){expect(changed).not.toBe(track);expect(changed.draft).not.toBe(track.draft);}else expect(changed).toBe(track);}expect(JSON.stringify(project)).toBe(before);
});

test('new linked position declarations use copy-on-write while original sources and unrelated snapshots keep identity',()=>{
 const h=previewFixture(true);h.update([{op:'createSnapshot',angle:{x:90,y:0}}]);const project=h.project(),workspace=freeze(project.recordingSnapshots!),before=JSON.stringify(project),recording=h.recording(),preview=prepareSnapshotPreview(project,{commands:[{op:'moveShapeNode',layerId:h.a,nodeId:h.nodeId,position:[1.2,.1]}]});
 expect(JSON.stringify(project)).toBe(before);expect(preview.recordingSnapshots.library).toBe(workspace.library);for(const source of workspace.snapshots){const result=preview.recordingSnapshots.snapshots.find(s=>s.id===source.id)!;if(recording.snapshotIds.includes(source.id)){expect(result).not.toBe(source);expect(result.layers).toBe(source.layers);expect(result.relations).toBe(source.relations);expect(result.deformation.warps).toBe(source.deformation.warps);}else expect(result).toBe(source);}
 const saved={...project,recordingSnapshots:preview.recordingSnapshots};freeze(saved.recordingSnapshots);const again=prepareSnapshotPreview(saved,{commands:[{op:'moveShapeNode',layerId:h.a,nodeId:h.nodeId,position:[1.3,.1]}]});expect(again.recordingSnapshots.snapshots).toBe(saved.recordingSnapshots.snapshots);
});

test('trusted previews retain atomic command validation and placement closure',()=>{
 const h=previewFixture(true),project=h.project(),before=JSON.stringify(project);freeze(project.recordingSnapshots);expect(()=>prepareSnapshotPreview(project,{commands:[{op:'setLayerPlacement',layerId:h.a,value:{...identityScenePlacement(),translation:[1,0]}}]})).toThrow('Placement separates linked layers A and B');expect(()=>prepareSnapshotPreview(project,{commands:[{op:'setLayerPlacement',layerId:h.a,value:identityScenePlacement()},{op:'moveShapeNode',layerId:'missing',nodeId:h.nodeId,position:[2,2]}]})).toThrow('Layer does not exist');expect(()=>prepareSnapshotPreview(project,{commands:[{op:'moveShapeNode',layerId:h.a,nodeId:h.nodeId,position:[2,2],unknown:true} as unknown as SnapshotCommand]})).toThrow('Unknown fields');expect(JSON.stringify(project)).toBe(before);
 const paired=prepareSnapshotPreview(project,{commands:[{op:'setLayerPlacement',layerId:h.a,value:{...identityScenePlacement(),translation:[1,0]}},{op:'setLayerPlacement',layerId:h.b,value:{...identityScenePlacement(),translation:[1,0]}}]});expect(paired.changed).toBe(true);expect(JSON.stringify(project)).toBe(before);
});
