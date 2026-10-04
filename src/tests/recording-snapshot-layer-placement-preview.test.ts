import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview,SnapshotApiError,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {curveChange,layerChange} from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {applyScenePlacement} from '../domain/recordingScene/tracks';

function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);
  Object.values(value).forEach(freeze);
 }
 return value;
}

function fixture(options:{count?:number;linked?:boolean;lock?:'curve'|'layer'}={}) {
 let drawing:DrawingDocument=emptyDrawing();
 for(let index=0;index<(options.count??13);index++){
  const x=index*2,y=index*.3;
  drawing.nodes.push({id:`a-${index}`,position:[x,y]},{id:`b-${index}`,position:[x+1,y+.4]});
  drawing.curves.push({id:`curve-${index}`,name:`Curve ${index}`,nodes:[`a-${index}`,`b-${index}`],handles:[[x+.2,y+.5],[x+.8,y-.1]],width:.02,visible:true,locked:false});
  drawing.layers.push({id:`layer-${index}`,name:`Layer ${index}`,items:[`curve-${index}`],visible:true,locked:false});
 }
 if(options.linked){
  drawing.nodes.find(node=>node.id==='a-1')!.position=[...drawing.nodes.find(node=>node.id==='b-0')!.position];
  drawing.endpointLinks=[{id:'link',a:{curveId:'curve-0',end:1},b:{curveId:'curve-1',end:0}}];
 }
 if(options.lock==='curve')drawing=curveChange(drawing,'curve-1',{locked:true});
 if(options.lock==='layer')drawing=layerChange(drawing,'layer-1',{locked:true});
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing});
 const source=drawingSnapshotForArtwork(project.recordingSnapshots!,'$working')!;
 const apply=(commands:SnapshotCommand[])=>{
  project={...project,recordingSnapshots:prepareSnapshotBatch(project,{commands}).recordingSnapshots};
 };
 apply([{op:'createTriangulatedRecording',name:'Translation preview'},{op:'pasteLayers',sourceSnapshotId:source.id}]);
 apply([{op:'createSnapshot',name:'Left basis',angle:{x:-90,y:0}},{op:'pasteLayers',sourceSnapshotId:source.id}]);
 const workspace=project.recordingSnapshots!,recording=workspace.recordings.find(value=>value.id===workspace.activeRecordingId)!;
 const snapshot=workspace.snapshots.find(value=>value.id===recording.activeSnapshotId)!;
 expect(recording.mode).toBe('triangulated');
 expect(recording.angle).toEqual({x:-90,y:0});
 expect(snapshot.layers.map(layer=>layer.id)).toEqual(source.layers.map(layer=>layer.id));
 expect(snapshot.layers.every(layer=>layer.kind==='reference'&&layer.baseSnapshotId===source.id&&layer.baseLayerId===layer.id)).toBe(true);
 return {project,recordingId:recording.id,snapshotId:snapshot.id,layerIds:snapshot.layers.map(layer=>layer.id)};
}

const id=(raw:string)=>canonicalElementId('$working',raw);
const translated=(translation:Point2):ScenePlacementValue=>({...identityScenePlacement(),translation});
const placements=(layerIds:string[],value:ScenePlacementValue):SnapshotCommand[]=>layerIds.map(layerId=>({op:'setLayerPlacement',layerId,value}));
const evaluate=(project:LandmarkProject,recordingId:string)=>evaluateRecordingSnapshot(project.recordingSnapshots!,recordingId,{useDraft:true,diagnostics:'preview',immutableInputs:true});
const near=(actual:Point2,wanted:Point2)=>{
 expect(actual[0]).toBeCloseTo(wanted[0],10);
 expect(actual[1]).toBeCloseTo(wanted[1],10);
};

function expectTransformed(before:DrawingDocument,after:DrawingDocument,value:ScenePlacementValue) {
 expect(after.nodes.map(node=>node.id)).toEqual(before.nodes.map(node=>node.id));
 expect(after.curves.map(curve=>curve.id)).toEqual(before.curves.map(curve=>curve.id));
 for(const node of before.nodes)near(after.nodes.find(next=>next.id===node.id)!.position,applyScenePlacement(value,node.position));
 for(const curve of before.curves)for(const end of [0,1] as const){
  near(after.curves.find(next=>next.id===curve.id)!.handles[end],applyScenePlacement(value,curve.handles[end]));
 }
}

function expectError(action:()=>unknown,code:string,commandIndex:number) {
 let caught:unknown;
 try{action();}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(SnapshotApiError);
 expect(caught).toMatchObject({code,commandIndex});
 return caught as SnapshotApiError;
}

describe('immutable basis layer placement previews',()=>{
 it('translates all 13 same-ID reference layers and matches the strict batch on every control and placement',()=>{
  const f=fixture(),project=freeze(f.project),workspace=project.recordingSnapshots!,serialized=JSON.stringify(project);
  const before=evaluate(project,f.recordingId),value=translated([.37,-.23]),commands=placements(f.layerIds,value);
  expect(before.angleSurface?.role).toBe('basis');
  expect(before.drawing.layers).toHaveLength(13);
  const preview=prepareSnapshotPreview(project,{commands});
  // The first immutable read must see the complete batch, not the first write
  // cached by validation while later commands mutated the same snapshot object.
  const actual=evaluate({...project,recordingSnapshots:preview.recordingSnapshots},f.recordingId);
  const strict=prepareSnapshotBatch(project,{commands,dryRun:true});
  const expected=evaluate({...project,recordingSnapshots:strict.recordingSnapshots},f.recordingId);
  expect(preview.changed).toBe(true);
  expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);
  expect(actual.drawing.nodes).toEqual(expected.drawing.nodes);
  expect(actual.drawing.curves).toEqual(expected.drawing.curves);
  expect(actual.placements).toEqual(expected.placements);
  expectTransformed(before.drawing,actual.drawing,value);
  for(const layerId of f.layerIds)expect(actual.placements[layerId]).toEqual(value);
  expect(preview.recordingSnapshots.library).toBe(workspace.library);
  for(const snapshot of workspace.snapshots){
   const next=preview.recordingSnapshots.snapshots.find(value=>value.id===snapshot.id)!;
   if(snapshot.id===f.snapshotId)expect(next).not.toBe(snapshot);
   else expect(next).toBe(snapshot);
  }
  expect(JSON.stringify(project)).toBe(serialized);
  expect(evaluate(project,f.recordingId).drawing).toEqual(before.drawing);
 });

 it('keeps descendant saved geometry stable during a parent preview and refreshes it after saving',()=>{
  const f=fixture({count:3});
  const child=prepareSnapshotBatch(f.project,{commands:[
   {op:'createTriangulatedRecording',name:'Descendant'},
   {op:'pasteLayers',sourceSnapshotId:f.snapshotId},
  ]});
  const project=freeze({...f.project,recordingSnapshots:child.recordingSnapshots}),serialized=JSON.stringify(project);
  const savedOptions={useDraft:false,diagnostics:'preview',immutableInputs:true} as const;
  const before=resolveSnapshot(project.recordingSnapshots,child.snapshotId!,savedOptions),parentBefore=evaluate(project,f.recordingId);
  const value=translated([.31,-.27]),commands=placements(f.layerIds,value);
  const preview=prepareSnapshotPreview(project,{recordingId:f.recordingId,commands});
  const during=resolveSnapshot(preview.recordingSnapshots,child.snapshotId!,savedOptions);
  expect(during.drawing).toEqual(before.drawing);
  expect(during.placements).toEqual(before.placements);
  expect(resolveSnapshot(preview.recordingSnapshots,f.snapshotId,savedOptions).drawing).toEqual(parentBefore.drawing);
  expectTransformed(parentBefore.drawing,evaluate({...project,recordingSnapshots:preview.recordingSnapshots},f.recordingId).drawing,value);

  const previewProject=freeze({...project,recordingSnapshots:preview.recordingSnapshots});
  const saved=prepareSnapshotBatch(previewProject,{recordingId:f.recordingId,commands:[{op:'updateSnapshot'}]});
  const after=resolveSnapshot(saved.recordingSnapshots,child.snapshotId!,savedOptions);
  expectTransformed(before.drawing,after.drawing,value);
  expect(saved.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===f.snapshotId)!.draft).toBeUndefined();
  expect(JSON.stringify(project)).toBe(serialized);
  expect(resolveSnapshot(preview.recordingSnapshots,child.snapshotId!,savedOptions).drawing).toEqual(before.drawing);
 });

 it('rejects separating linked layers and accepts their common translation in the same batch',()=>{
  const f=fixture({count:2,linked:true}),project=freeze(f.project),serialized=JSON.stringify(project),before=evaluate(project,f.recordingId);
  const value=translated([.4,-.2]),commands=placements(f.layerIds,value);
  for(const prepare of [prepareSnapshotPreview,prepareSnapshotBatch]){
   const error=expectError(()=>prepare(project,{commands:commands.slice(0,1)}),'LINKED_LAYER_PLACEMENT',0);
   expect(error.message).toContain('Layer 0 and Layer 1');
  }
  const preview=prepareSnapshotPreview(project,{commands}),actual=evaluate({...project,recordingSnapshots:preview.recordingSnapshots},f.recordingId);
  const strict=prepareSnapshotBatch(project,{commands,dryRun:true});
  expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);
  expectTransformed(before.drawing,actual.drawing,value);
  for(const layerId of f.layerIds)expect(actual.placements[layerId]).toEqual(value);
  expect(JSON.stringify(project)).toBe(serialized);
 });

 it.each(['curve','layer'] as const)('rejects a locked %s after an earlier placement without changing the project',lock=>{
  const f=fixture({count:2,lock}),project=freeze(f.project),serialized=JSON.stringify(project),before=evaluate(project,f.recordingId);
  expect(before.drawing.curves.find(curve=>curve.id===id('curve-1'))!.locked).toBe(true);
  const commands=placements(f.layerIds,translated([.5,.2]));
  for(const prepare of [prepareSnapshotPreview,prepareSnapshotBatch]){
   const error=expectError(()=>prepare(project,{commands}),'CONSTRAINT_VIOLATION',1);
   expect(error.message).toContain('Unlock the selected objects');
  }
  expect(JSON.stringify(project)).toBe(serialized);
  expect(evaluate(project,f.recordingId).drawing).toEqual(before.drawing);
 });

 it('uses fresh intermediate geometry for a mixed placement and handle batch',()=>{
  const f=fixture({count:3}),project=freeze(f.project),serialized=JSON.stringify(project),value=translated([.4,-.3]);
  const target:Point2=[1.2,.9],commands:SnapshotCommand[]=[
   ...placements([f.layerIds[0]],value),
   {op:'moveShapeHandle',layerId:f.layerIds[0],curveId:id('curve-0'),end:0,position:target},
   ...placements(f.layerIds.slice(1),value),
   {op:'setVisibility',layerId:f.layerIds[2],objectId:id('curve-2'),visible:false},
  ];
  const preview=prepareSnapshotPreview(project,{commands}),actual=evaluate({...project,recordingSnapshots:preview.recordingSnapshots},f.recordingId);
  const strict=prepareSnapshotBatch(project,{commands,dryRun:true}),expected=evaluate({...project,recordingSnapshots:strict.recordingSnapshots},f.recordingId);
  expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);
  expect(actual.drawing.nodes).toEqual(expected.drawing.nodes);
  expect(actual.drawing.curves).toEqual(expected.drawing.curves);
  expect(actual.placements).toEqual(expected.placements);
  near(actual.drawing.curves.find(curve=>curve.id===id('curve-0'))!.handles[0],target);
  expect(actual.drawing.curves.find(curve=>curve.id===id('curve-2'))!.visible).toBe(false);
  for(const layerId of f.layerIds)expect(actual.placements[layerId]).toEqual(value);
  expect(JSON.stringify(project)).toBe(serialized);
 });

 it('preserves lock changes and normal validation when a mixed batch takes the strict path',()=>{
  const f=fixture({count:2}),project=freeze(f.project),serialized=JSON.stringify(project),value=translated([.2,.3]);
  const commands:SnapshotCommand[]=[
   ...placements([f.layerIds[0]],value),
   {op:'setObjectLocks',objectIds:[id('curve-1')],locked:true},
   ...placements([f.layerIds[1]],value),
  ];
  const error=expectError(()=>prepareSnapshotPreview(project,{commands}),'CONSTRAINT_VIOLATION',2);
  expect(error.message).toContain('Unlock the selected objects');
  expect(JSON.stringify(project)).toBe(serialized);
  expect(evaluate(project,f.recordingId).drawing.curves.every(curve=>!curve.locked)).toBe(true);
 });

 it('keeps mixed angle navigation subject to the real-basis requirement',()=>{
  const f=fixture({count:2}),project=freeze(f.project),serialized=JSON.stringify(project);
  const commands:SnapshotCommand[]=[{op:'setAngle',angle:{x:-45,y:0}},...placements([f.layerIds[0]],translated([.2,.3]))];
  expectError(()=>prepareSnapshotPreview(project,{commands}),'REAL_SNAPSHOT_REQUIRED',1);
  expect(JSON.stringify(project)).toBe(serialized);
 });

 it.each(['missing-layer','invalid-placement','unknown-field'] as const)('reports an invalid second %s command atomically',kind=>{
  const f=fixture({count:2}),project=freeze(f.project),serialized=JSON.stringify(project),value=translated([.2,.3]);
  const invalid:SnapshotCommand=kind==='missing-layer'
   ?{op:'setLayerPlacement',layerId:'missing',value}
   :kind==='invalid-placement'
    ?{op:'setLayerPlacement',layerId:f.layerIds[1],value:{...value,scale:-1}}
    :{op:'setLayerPlacement',layerId:f.layerIds[1],value,unexpected:true} as unknown as SnapshotCommand;
  const commands=[...placements([f.layerIds[0]],value),invalid],code=kind==='missing-layer'?'MISSING_LAYER':'INVALID_REQUEST';
  for(const prepare of [prepareSnapshotPreview,prepareSnapshotBatch])expectError(()=>prepare(project,{commands}),code,1);
  expect(JSON.stringify(project)).toBe(serialized);
  expect(project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id===f.snapshotId)!.draft).toBeUndefined();
 });
});
