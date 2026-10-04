import {describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotBatch,prepareSnapshotPreview,snapshotCommandNames,snapshotOverview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {evaluateRecordingSnapshot as evaluateWorkspace,resolveSnapshot,resolveEndpointPairBasis} from '../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../domain/recordingSnapshot/angleGraph';
import {emptyRecordingScene} from '../domain/recordingScene/model';
import {emptyVectorRecording} from '../domain/vectorRecording/model';
import {emptyDrawing} from '../domain/drawing/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {RECORDING_RETIRED_MESSAGE} from '../domain/recordingSnapshot/retirement';

function fixture(mode:'tracks'|'endpoint-pair'|'triangulated'='triangulated'){
 const workspace=emptyRecordingSnapshotWorkspace(),snapshot=emptyRecordingSnapshot('view','Front'),recording=emptySnapshotRecording('recording','Test recording');
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 workspace.library.curves={curve:{id:'curve',name:'Line',nodes:['a','b'],handles:[[.2,0],[.8,0]],visible:true,locked:false,width:.01}};
 snapshot.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}];
 recording.snapshotIds=[snapshot.id];recording.activeSnapshotId=snapshot.id;
 if(mode!=='tracks')recording.mode=mode;
 if(mode==='triangulated')recording.angleGraph=createSnapshotAngleGraph([{snapshotId:snapshot.id,angle:snapshot.angle}]);
 workspace.recordings=[recording];workspace.snapshots=[snapshot];workspace.activeRecordingId=recording.id;
 const project:LandmarkProject={...createEmptyProject(),drawing:emptyDrawing(),recordingSnapshots:workspace};
 return {workspace,snapshot,recording,project};
}
function harness(project:LandmarkProject){
 const commit=vi.fn(),api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=> 'recording',commitDrawing:commit,commitRecording:commit,commitRecordingScenes:commit,commitRecordingSnapshots:commit,undo(){},redo(){}});
 return {api,commit};
}
const retired=(action:()=>unknown)=>expect(action).toThrow(RECORDING_RETIRED_MESSAGE);

describe('retired Recording API boundaries',()=>{
 it.each(['tracks','endpoint-pair'] as const)('inspects %s metadata without resolving an invalid legacy graph',mode=>{
  const {project,snapshot,recording}=fixture(mode);
  snapshot.layers=[{kind:'reference',id:'broken-layer',name:'Archived layer',baseSnapshotId:'missing-parent',baseLayerId:'missing-layer'}];
  recording.snapshotIds.push('missing-snapshot');
  const before=JSON.stringify(project),overview=snapshotOverview(project),{api}=harness(project);
  expect(overview).toMatchObject({exists:true,readOnly:true,retired:true,retiredReason:RECORDING_RETIRED_MESSAGE,recordingId:'recording',snapshotId:'view',layers:[],warps:[],bindings:[],diagnostics:[]});
  expect(overview).not.toHaveProperty('angleSurface',expect.anything());
  expect(api.inspectSnapshots()).toMatchObject({ok:true,value:{snapshotEditable:false,retired:true}});
  retired(()=>prepareSnapshotBatch(project,{commands:[]}));
  retired(()=>prepareSnapshotPreview(project,{commands:[{op:'setAngle',angle:{x:20,y:0}}]}));
  retired(()=>evaluateRecordingSnapshot(project));
  expect(api.previewSnapshot()).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED'}});
  expect(api.previewSnapshotFrames()).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED'}});
  expect(JSON.stringify(project)).toBe(before);
 });

 it('blocks mixed workspaces and legacy scene fallback before any runtime traversal',()=>{
  const {project,workspace,recording}=fixture(),legacy=emptySnapshotRecording('old','Archived');
  legacy.legacy={scene:emptyRecordingScene('archived-scene'),reason:'Keep for export',readOnly:true};
  workspace.recordings.push(legacy);
  const before=JSON.stringify(project);
  retired(()=>evaluateWorkspace(workspace,recording.id));
  retired(()=>resolveSnapshot(workspace,'view'));
  retired(()=>resolveSnapshot(workspace,'missing-snapshot'));
  retired(()=>resolveEndpointPairBasis(workspace,'old'));
  retired(()=>prepareSnapshotBatch(project,{recordingId:recording.id,commands:[{op:'setAngle',angle:{x:10,y:0}}]}));
  expect(snapshotOverview(project,{recordingId:recording.id})).toMatchObject({readOnly:true,retired:true,layers:[],retirement:{recordingCount:2,newRecordingCount:1}});
  expect(JSON.stringify(project)).toBe(before);
 });

 it('does not migrate or execute scene/vector-only projects during inspection',()=>{
  const projects:LandmarkProject[]=[
   {...createEmptyProject(),recordingScenes:{version:1,activeSceneId:'scene',scenes:[emptyRecordingScene('scene','Archived scene')]}},
   {...createEmptyProject(),vectorRecording:{...emptyVectorRecording(),rigs:[{id:'rig',artworkId:'$working',deformers:[],bindings:{},keys:[],angle:{x:0,y:0}}]}},
  ];
  for(const project of projects){
   delete project.recordingSnapshots;
   const before=JSON.stringify(project),overview=snapshotOverview(project);
   expect(overview).toMatchObject({exists:true,readOnly:true,retired:true,recordings:[],availableSnapshots:[],retirement:{recordingCount:1}});
   retired(()=>prepareSnapshotBatch(project,{commands:[{op:'createTriangulatedRecording'}]}));
   retired(()=>evaluateRecordingSnapshot(project));
   expect(JSON.stringify(project)).toBe(before);
  }
 });

 it.each(['createRecording','createEndpointPairRecording','createTriangulatedRecordingCopy'] as const)('rejects retired creation command %s atomically in writes and previews',op=>{
  const {project}=fixture(),before=JSON.stringify(project),commands=[{op:'renameRecording',recordingId:'recording',name:'Temporary'}, {op}] as SnapshotCommand[],{api,commit}=harness(project);
  for(const dryRun of [false,true])expect(api.snapshot({commands,dryRun})).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED',commandIndex:1,message:expect.stringContaining('createTriangulatedRecording')}});
  expect(api.previewSnapshot({commands})).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED',commandIndex:1}});
  expect(api.snapshot({commands:[{op,startSnapshotId:'$unknown',endSnapshotId:'$unknown'} as SnapshotCommand]})).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED',commandIndex:0}});
  expect(commit).not.toHaveBeenCalled();expect(JSON.stringify(project)).toBe(before);
  const fresh={...createEmptyProject(),recordingSnapshots:emptyRecordingSnapshotWorkspace()};
  expect(()=>prepareSnapshotBatch(fresh,{commands:[{op}]})).toThrow('retired');
 });

 it('unconditionally rejects scene/vector entrypoints even before any snapshots exist',()=>{
  const project=createEmptyProject();delete project.recordingSnapshots;delete project.recordingScenes;delete project.vectorRecording;
  const before=JSON.stringify(project),{api,commit}=harness(project);
  for(const result of [api.inspectScene(),api.scene({commands:[]}),api.previewScene(),api.previewSceneFrames()])expect(result).toMatchObject({ok:false,error:{code:'LEGACY_SCENE_RETIRED',message:RECORDING_RETIRED_MESSAGE}});
  for(const result of [api.inspectRecording(),api.recording({commands:[]}),api.previewRecording(),api.previewRecordingFrames()])expect(result).toMatchObject({ok:false,error:{code:'LEGACY_RECORDING_RETIRED',message:RECORDING_RETIRED_MESSAGE}});
  const help=api.help();
  expect(help.methods).not.toContain('scene');expect(help.methods).not.toContain('recording');expect(help.methods).not.toContain('previewScene');expect(help.methods).not.toContain('previewRecording');
  expect(help.sceneCommands).toEqual([]);expect(help.recordingCommands).toEqual([]);expect(help.legacyRecordingMethods).toEqual([]);
  expect(snapshotCommandNames).toContain('createTriangulatedRecording');
  for(const op of ['createRecording','createEndpointPairRecording','createTriangulatedRecordingCopy'])expect(help.snapshotCommands).not.toContain(op);
  expect(commit).not.toHaveBeenCalled();expect(JSON.stringify(project)).toBe(before);
 });

 it('preserves triangulated evaluation, source resolution, inspection, and fresh authoring',()=>{
  const {project,workspace}=fixture(),before=JSON.stringify(project);
  expect(evaluateWorkspace(workspace,'recording').drawing.curves).toHaveLength(1);
  expect(resolveSnapshot(workspace,'view').drawing.curves).toHaveLength(1);
  expect(evaluateRecordingSnapshot(project).angleSurface?.role).toBe('basis');
  expect(snapshotOverview(project)).toMatchObject({exists:true,readOnly:false,retired:false,layers:[{id:'layer'}]});
  const preview=prepareSnapshotPreview(project,{commands:[{op:'setAngle',angle:{x:10,y:0}}]});
  expect(preview.changed).toBe(true);expect(JSON.stringify(project)).toBe(before);
  const fresh={...createEmptyProject(),recordingSnapshots:emptyRecordingSnapshotWorkspace()},plan=prepareSnapshotBatch(fresh,{commands:[{op:'createTriangulatedRecording',name:'New recording'}]});
  expect(plan.recordingSnapshots.recordings).toMatchObject([{mode:'triangulated',name:'New recording'}]);
  const sourceOnly:RecordingSnapshotWorkspace={...workspace,recordings:[],activeRecordingId:undefined};
  expect(resolveSnapshot(sourceOnly,'view').drawing.curves).toHaveLength(1);
 });

 it('exports the unchanged raw artwork from a retired workspace',()=>{
  const {project}=fixture('tracks'),{api}=harness(project),result=api.exportSource();
  expect(result).toMatchObject({ok:true,value:{document:project.drawing}});
 });
});
