import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {prepareSnapshotBatch,prepareSnapshotPreview,snapshotOverview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {snapshotInterpolationWeight} from '../domain/recordingSnapshot/weights';
import {identityScenePlacement} from '../domain/recordingScene/model';

const result=<T,>(response:VectorResult<T>):T=>{if(!response.ok)throw Error(JSON.stringify(response.error));return response.value;};
const linear:Point2[]=[[0,0],[1,1]],slow:Point2[]=[[0,0],[.5,.2],[1,1]];
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:[0,1]},{id:'d',position:[1,1]}],curves:[{id:'curve-a',name:'A',nodes:['a','b'],handles:[[.25,0],[.75,0]],visible:true,locked:false,width:.02},{id:'curve-b',name:'B',nodes:['c','d'],handles:[[.25,1],[.75,1]],visible:true,locked:false,width:.02}],layers:[{id:'layer-a',name:'A',items:['curve-a'],visible:true,locked:false},{id:'layer-b',name:'B',items:['curve-b'],visible:true,locked:false}]};
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing});const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected Drawing mutation');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const apply=(...commands:SnapshotCommand[])=>result(api.snapshot({commands}));const source=drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!;apply({op:'createRecording'},{op:'pasteLayers',sourceSnapshotId:source.id});
 const recording=()=>project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!;
 const startSnapshotId=recording().activeSnapshotId!,[a,b]=project.recordingSnapshots!.snapshots.find(s=>s.id===startSnapshotId)!.layers.map(l=>l.id);
 apply({op:'setLayerPlacement',layerId:a,value:identityScenePlacement()},{op:'updateSnapshot'},{op:'createSnapshot',angle:{x:90,y:0}},{op:'setLayerPlacement',layerId:a,value:{...identityScenePlacement(),translation:[1,0]}},{op:'updateSnapshot'});
 const endSnapshotId=recording().activeSnapshotId!,curveId=canonicalElementId('$working','curve-a');
 const set=(targets:{layerId:string;curveId?:string}[],points:Point2[]=slow):SnapshotCommand=>({op:'setInterpolationWeight',startSnapshotId,endSnapshotId,targets,points});
 const reset=(targets:{layerId:string;curveId?:string}[]):SnapshotCommand=>({op:'resetInterpolationWeight',startSnapshotId,endSnapshotId,targets});
 return {api,apply,project:()=>project,recording,past,a,b,curveId,startSnapshotId,endSnapshotId,set,reset,sourceId:source.id};
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}

test('batch weight edits are layer/curve assets and preserve every saved endpoint, key and canonical source',()=>{
 const h=fixture(),before=structuredClone(h.project()),past=h.past.length;
 const applied=h.apply(h.set([{layerId:h.a},{layerId:h.b}]),h.set([{layerId:h.a,curveId:h.curveId}],linear));
 expect(h.recording().interpolationWeights).toHaveLength(3);expect(applied.created.filter(item=>item.kind==='interpolationWeight')).toHaveLength(3);expect(h.past).toHaveLength(past+1);
 expect(h.project().recordingSnapshots!.snapshots).toEqual(before.recordingSnapshots!.snapshots);expect(h.recording().tracks).toEqual(before.recordingSnapshots!.recordings.find(r=>r.id===h.recording().id)!.tracks);expect(h.project().recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(h.project().drawing).toEqual(before.drawing);
 expect(snapshotInterpolationWeight(h.recording(),h.startSnapshotId,h.endSnapshotId,h.a,.5,h.curveId)).toBe(.5);expect(snapshotInterpolationWeight(h.recording(),h.startSnapshotId,h.endSnapshotId,h.b,.5)).toBeCloseTo(.2);
 expect(snapshotOverview(h.project())).toMatchObject({interpolationWeights:h.recording().interpolationWeights,recordings:expect.arrayContaining([expect.objectContaining({interpolationWeightCount:3})])});expect(h.api.help().snapshotCommands).toEqual(expect.arrayContaining(['setInterpolationWeight','resetInterpolationWeight']));
});

test('reverse pair editing updates one stable asset and reset restores inheritance with atomic Undo/Redo',()=>{
 const h=fixture();h.apply(h.set([{layerId:h.a}]),h.set([{layerId:h.a,curveId:h.curveId}],linear));const curve=h.recording().interpolationWeights!.find(weight=>weight.target.curveId)!,before=h.project();
 h.apply({op:'setInterpolationWeight',startSnapshotId:h.endSnapshotId,endSnapshotId:h.startSnapshotId,targets:[{layerId:h.a,curveId:h.curveId}],points:slow});expect(h.recording().interpolationWeights).toHaveLength(2);expect(h.recording().interpolationWeights!.find(weight=>weight.target.curveId)!.id).toBe(curve.id);
 expect(snapshotInterpolationWeight(h.recording(),h.startSnapshotId,h.endSnapshotId,h.a,.5,h.curveId)).toBeCloseTo(.8);
 const changed=h.project();result(h.api.undo());expect(h.project()).toBe(before);result(h.api.redo());expect(h.project()).toBe(changed);
 const removed=h.apply(h.reset([{layerId:h.a,curveId:h.curveId}]));expect(removed.removedIds).toEqual([curve.id]);expect(snapshotInterpolationWeight(h.recording(),h.startSnapshotId,h.endSnapshotId,h.a,.5,h.curveId)).toBeCloseTo(.2);expect(h.recording().tracks).toEqual(changed.recordingSnapshots!.recordings.find(r=>r.id===h.recording().id)!.tracks);
 h.apply(h.reset([{layerId:h.a}]));expect(h.recording().interpolationWeights).toBeUndefined();expect(snapshotInterpolationWeight(h.recording(),h.startSnapshotId,h.endSnapshotId,h.a,.5,h.curveId)).toBe(.5);
});

test('project JSON round trip keeps weight IDs and explicit linear overrides, while old files remain linear',()=>{
 const h=fixture();expect(parseRecordingSnapshots(h.project().recordingSnapshots).recordings.find(r=>r.id===h.recording().id)!.interpolationWeights).toBeUndefined();h.apply(h.set([{layerId:h.a}]),h.set([{layerId:h.a,curveId:h.curveId}],linear));
 const loaded=parseLandmarks(JSON.stringify(h.project()));expect(loaded.recordingSnapshots).toEqual(h.project().recordingSnapshots);expect(loaded.recordingSnapshots!.recordings.find(r=>r.id===h.recording().id)!.interpolationWeights).toEqual(h.recording().interpolationWeights);
 const detached=structuredClone(h.project().recordingSnapshots!);detached.recordings.find(r=>r.id===h.recording().id)!.interpolationWeights![0].target.layerId='temporarily-missing-layer';expect(parseRecordingSnapshots(detached)).toEqual(detached);
});

test('invalid targets, pairs, curves and unknown fields reject the whole batch without project or history mutation',()=>{
 const h=fixture(),before=h.project(),past=h.past.length,valid=h.set([{layerId:h.a}]);
 const invalid:unknown[]=[{...valid,targets:[]},{...valid,targets:[{layerId:h.a},{layerId:h.a}]},{...valid,targets:[{layerId:'missing'}]},{...valid,targets:[{layerId:h.b,curveId:h.curveId}]},{...valid,startSnapshotId:h.endSnapshotId},{...valid,startSnapshotId:h.sourceId},{...valid,unexpected:true},{...valid,targets:[{layerId:h.a,unknown:true}]}];
 for(const command of invalid){expect(h.api.snapshot({commands:[valid,command] as SnapshotCommand[]})).toMatchObject({ok:false,error:{commandIndex:1}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(past);}
 expect(h.api.snapshot({commands:[valid],dryRun:true})).toMatchObject({ok:true,value:{applied:false,changed:true}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(past);
});

test('point constraints and malformed serialized assets fail explicitly',()=>{
 const h=fixture(),base=h.set([{layerId:h.a}]);
 for(const points of [[],[[0,0]],[[0,.1],[1,1]],[[0,0],[.5,.8],[.5,.9],[1,1]],[[0,0],[.3,.8],[.7,.2],[1,1]],[[0,0],[.5,1.1],[1,1]],[[0,0],[NaN,.5],[1,1]],[[0,0],[1,1,2]]])expect(h.api.snapshot({commands:[{...base,points}] as SnapshotCommand[]})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
 h.apply(base);const workspace=h.project().recordingSnapshots!;
 for(const mutate of [(w:typeof workspace)=>{const weights=w.recordings.find(r=>r.id===h.recording().id)!.interpolationWeights!,copy=structuredClone(weights[0]);copy.id+='-duplicate';[copy.startSnapshotId,copy.endSnapshotId]=[copy.endSnapshotId,copy.startSnapshotId];weights.push(copy);},(w:typeof workspace)=>{w.recordings.find(r=>r.id===h.recording().id)!.interpolationWeights![0].endSnapshotId='missing';},(w:typeof workspace)=>{Object.assign(w.recordings.find(r=>r.id===h.recording().id)!.interpolationWeights![0],{privateCache:123});}]){const invalid=structuredClone(workspace);mutate(invalid);expect(()=>parseRecordingSnapshots(invalid)).toThrow();}
});

test('native live curve preview is copy-on-write, equals strict editing and never mutates the frozen saved asset',()=>{
 const h=fixture();h.apply(h.set([{layerId:h.a}]));const before=freeze(h.project()),workspace=before.recordingSnapshots!,recording=h.recording(),command=h.set([{layerId:h.a}],[[0,0],[.5,.7],[1,1]]),preview=prepareSnapshotPreview(before,{commands:[command]}),strict=prepareSnapshotBatch(before,{commands:[command],dryRun:true});
 expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.changed).toBe(true);expect(preview.recordingSnapshots.library).toBe(workspace.library);expect(preview.recordingSnapshots.snapshots).toBe(workspace.snapshots);const changed=preview.recordingSnapshots.recordings.find(r=>r.id===recording.id)!;expect(changed.tracks).toBe(recording.tracks);expect(changed.interpolationWeights).not.toBe(recording.interpolationWeights);expect(recording.interpolationWeights![0].points).toEqual(slow);
 const again=prepareSnapshotPreview(before,{commands:[command]});expect(again.recordingSnapshots).toEqual(preview.recordingSnapshots);const noChange=prepareSnapshotPreview(before,{commands:[h.set([{layerId:h.a}])]});expect(noChange.changed).toBe(false);expect(noChange.recordingSnapshots).toBe(workspace);
 const reset=prepareSnapshotPreview(before,{commands:[h.reset([{layerId:h.a}])]});expect(reset.recordingSnapshots.recordings.find(r=>r.id===recording.id)!.interpolationWeights).toBeUndefined();expect(recording.interpolationWeights).toHaveLength(1);
});

test('batch references target the explicit new view and deleting that endpoint removes only its associated assets',()=>{
 const h=fixture(),before=h.project(),created=h.apply({op:'createSnapshot',angle:{x:45,y:0},ref:'middle'},{op:'setInterpolationWeight',startSnapshotId:h.startSnapshotId,endSnapshotId:'$middle',targets:[{layerId:h.a}],points:slow});const middle=created.created.find(item=>item.ref==='middle')!.id,weight=h.recording().interpolationWeights![0];expect(weight.endSnapshotId).toBe(middle);expect(weight.startSnapshotId).toBe(h.startSnapshotId);expect(h.recording().tracks).toEqual(before.recordingSnapshots!.recordings.find(r=>r.id===h.recording().id)!.tracks);
 h.apply(h.set([{layerId:h.b}]));const unrelated=h.recording().interpolationWeights!.find(asset=>asset.id!==weight.id)!;const deletion=h.apply({op:'deleteSnapshot',snapshotId:middle});expect(deletion.removedIds).toContain(weight.id);expect(h.recording().interpolationWeights).toEqual([unrelated]);result(h.api.undo());expect(h.recording().interpolationWeights).toContainEqual(weight);
});


test('diagonal endpoint pairs fail atomically instead of saving an unused runtime weight',()=>{
 const h=fixture(),before=h.project(),past=h.past.length;
 expect(h.api.snapshot({commands:[{op:'createSnapshot',angle:{x:45,y:45},ref:'diagonal'},{op:'setInterpolationWeight',startSnapshotId:h.startSnapshotId,endSnapshotId:'$diagonal',targets:[{layerId:h.a}],points:slow}]})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_INTERPOLATION_PAIR',commandIndex:1}});expect(h.project()).toBe(before);expect(h.past).toHaveLength(past);
});
