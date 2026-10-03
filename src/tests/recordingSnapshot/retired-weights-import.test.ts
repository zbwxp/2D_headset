import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,snapshotCommandNames,snapshotOverview} from '../../app/recordingSnapshotApi';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotEndpointResponses,type SnapshotPropertyResponses} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createSnapshotPropertyResponseSampler} from '../../domain/recordingSnapshot/propertyResponses';
import {locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';

const at=(x:number,y=0)=>({x,y});
const responses=():SnapshotEndpointResponses=>({nodes:{a:{x:[[.25,-2],[.75,3]],y:[[.5,.7]]}},handles:{curve:[{x:[[.5,2]],y:[[.5,-1]]},{}]}});
function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace(),source=emptyRecordingSnapshot('source','Source','drawing'),start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',at(90)),recording=emptySnapshotRecording('recording');
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};workspace.library.curves={curve:{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,0],[.7,0]],visible:true,locked:false,width:.01}};
 source.layers=[{kind:'original',id:'source-layer',name:'Source layer',visible:true,locked:false,items:['curve']}];for(const snapshot of [start,end])snapshot.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:source.id,baseLayerId:'source-layer'}];
 recording.snapshotIds=[start.id,end.id];recording.activeSnapshotId=start.id;recording.angle=at(30);
 recording.tracks=[
  {id:'placement',channel:'placement',targetId:'layer',interpolation:'independent',keys:[{id:'middle',name:'Zero width',angle:at(45),value:{...identityScenePlacement(),translation:[8,0],scaleX:0}},{id:'side',angle:at(90),value:{...identityScenePlacement(),translation:[10,0]}}],draft:{angle:at(30),value:{...identityScenePlacement(),scaleY:0}}},
  {id:'shape',channel:'shape',targetId:'layer',interpolation:'legacy',keys:[{id:'shape-side',angle:at(90),value:{nodes:{a:[0,2]},handles:{curve:[[0,1],[0,3]]}}}],draft:{angle:at(30),value:{nodes:{},handles:{}}}},
  {id:'depth',channel:'depth',targetId:'layer',keys:[{id:'depth-middle',angle:at(15),value:3}],draft:{angle:at(30),value:4}},
  {id:'visibility',channel:'visibility',targetId:'layer',elementId:'curve',keys:[{id:'hidden',angle:at(70),value:false}]},
 ];
 end.authored=[{trackId:'placement',keyId:'side'},{trackId:'shape',keyId:'shape-side'}];start.draft={angle:at(30),deformation:structuredClone(start.deformation),channels:[]};
 workspace.snapshots=[source,start,end];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 workspace.legacyArchive={format:'landmark-project-json',migrationVersion:2,projectJSON:'{ "original": true, "interpolationWeights": [ { "id": "archived-weight" } ] }\n'};
 return {workspace,recording,start,end};
}
const retiredAssets=[{id:'retired-weight',target:{layerId:'layer',curveId:'curve'},startSnapshotId:'start',endSnapshotId:'end',points:[[0,0],[.5,.2],[1,1]]}];
const withObsolete=(workspace:ReturnType<typeof fixture>['workspace'],value:unknown=retiredAssets)=>({...workspace,recordings:workspace.recordings.map(recording=>({...recording,interpolationWeights:value}))});

function frozen<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(frozen);}return value;}

describe('retired v40 common weights import compatibility',()=>{
 it('discards only the obsolete registry while preserving sparse channels, keys, drafts, source identities and archive bytes',()=>{
  const {workspace}=fixture(),uploaded=withObsolete(workspace),uploadJSON=JSON.stringify(uploaded),parsed=parseRecordingSnapshots(frozen(uploaded));
  expect(parsed).toEqual(workspace);expect(JSON.stringify(uploaded)).toBe(uploadJSON);expect(parsed.legacyArchive!.projectJSON).toBe(workspace.legacyArchive!.projectJSON);expect(parsed.recordings[0]).not.toHaveProperty('interpolationWeights');
  expect(parseRecordingSnapshots(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  for(const useDraft of [false,true])for(const x of [0,15,22.5,30,45,67.5,70,90]){
   const before=evaluateRecordingSnapshot(workspace,'recording',{angle:at(x),useDraft,diagnostics:'preview'}),after=evaluateRecordingSnapshot(parsed,'recording',{angle:at(x),useDraft,diagnostics:'preview'});
   expect(after.state).toEqual(before.state);expect(after.drawing).toEqual(before.drawing);
  }
  const middle=evaluateRecordingSnapshot(parsed,'recording',{angle:at(45),useDraft:false,diagnostics:'preview'});expect(middle.state.layers.layer.placement!.scaleX).toBe(0);expect(middle.state.layers.layer.placement!.translation).toEqual([8,0]);
 });
 it('accepts retired payloads without reviving validation, while continuing to reject unrelated unknown fields',()=>{
  const {workspace}=fixture();for(const value of [null,{unexpected:'retired'},['no longer active'],retiredAssets])expect(parseRecordingSnapshots(withObsolete(workspace,value))).toEqual(workspace);
  expect(()=>parseRecordingSnapshots({...workspace,recordings:[{...workspace.recordings[0],unrecognizedRegistry:[]}]})).toThrow(/unknown field/);
  expect(()=>parseRecordingSnapshots({...workspace,snapshots:[{...workspace.snapshots[0],interpolationWeights:[]},...workspace.snapshots.slice(1)]})).toThrow(/unknown field/);
 });
 it('preserves signed node and H-P endpoint responses with their saved and draft behavior',()=>{
  const {workspace,recording,start}=fixture();recording.mode='endpoint-pair';recording.tracks=recording.tracks.filter(track=>track.channel==='shape').map(track=>({...track,draft:undefined}));workspace.snapshots.find(snapshot=>snapshot.id==='end')!.authored=[{trackId:'shape',keyId:'shape-side'}];delete start.draft;
  recording.endpointPair={axis:'x',startSnapshotId:'start',endSnapshotId:'end',responses:responses(),draft:{angle:at(30),responses:{nodes:{a:{y:[[.5,-3]]}},handles:{curve:[{y:[[.5,2]]},{}]}}}};
  const parsed=parseRecordingSnapshots(withObsolete(workspace));expect(parsed).toEqual(workspace);
  for(const useDraft of [false,true])for(const x of [0,30,45,90])expect(evaluateRecordingSnapshot(parsed,'recording',{angle:at(x),useDraft,diagnostics:'preview'}).drawing).toEqual(evaluateRecordingSnapshot(workspace,'recording',{angle:at(x),useDraft,diagnostics:'preview'}).drawing);
 });
 it('preserves graph geometry and interval property responses, correction frames, orphaned support and embedded migration JSON',()=>{
  const {workspace,recording}=fixture(),third=emptyRecordingSnapshot('third','Up','view',at(0,90));third.layers=structuredClone(workspace.snapshots[1].layers);workspace.snapshots.push(third);recording.snapshotIds.push(third.id);recording.mode='triangulated';
  const graph=createSnapshotAngleGraph(workspace.snapshots.filter(snapshot=>recording.snapshotIds.includes(snapshot.id)).map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle}))),edge=graph.mesh.edges[0].id,triangle=graph.mesh.triangles[0].id;
  const properties:SnapshotPropertyResponses={edges:{[edge]:[{target:{kind:'interval-endpoint',layerId:'layer',sourceTrackId:'interval',rangeId:'range',end:'end'},knots:[[.5,-2]]}]},triangles:{[triangle]:[{target:{kind:'interval-endpoint',layerId:'layer',sourceTrackId:'interval',rangeId:'range',end:'start'},samples:[{id:'property-sample',at:[.2,.3,.5],weights:[-2,1,2]}]}]}};
  graph.edgeResponses[edge]=responses();graph.triangleResponses[triangle]={nodes:{a:{x:[{id:'node-sample',at:[.2,.3,.5],weights:[-1,3,-1]}]}},handles:{}};graph.propertyResponses=properties;
  graph.correctionFrames=[{id:'correction',status:'draft',angle:at(20,30),edgeResponses:{[edge]:responses()},propertyResponses:structuredClone(properties)}];
  graph.orphanedResponses=[{id:'old-support',reason:'mesh-change',message:'Prior support',mesh:structuredClone(graph.mesh),edgeResponses:{[edge]:responses()},triangleResponses:{},propertyResponses:structuredClone(properties)}];
  graph.migration={sourceRecordingId:'previous-pair',sourceMode:'endpoint-pair',sourceRecordingJSON:'{ "id": "previous-pair", "mode": "endpoint-pair", "interpolationWeights": [1] }\n',sourceSnapshotsJSON:'[ { "id": "saved-snapshot" } ]\n'};recording.angleGraph=graph;
  const parsed=parseRecordingSnapshots(withObsolete(workspace));expect(parsed).toEqual(workspace);expect(parsed.recordings[0].angleGraph!.migration).toEqual(graph.migration);
  const sampleAngle={x:20,y:30},location=locateSnapshotSimplex(graph.mesh,sampleAngle)!,target=properties.triangles[triangle][0].target;
  expect(createSnapshotPropertyResponseSampler(parsed.recordings[0].angleGraph!,location)(target,[.1,.2,.7])).toBe(createSnapshotPropertyResponseSampler(graph,location)(target,[.1,.2,.7]));
 });
 it('removes old commands and overview fields without mutating an attempted command input',()=>{
  const {workspace}=fixture(),project={...createEmptyProject(),recordingSnapshots:workspace},before=JSON.stringify(project);
  expect(snapshotCommandNames).not.toContain('setInterpolationWeight');expect(snapshotCommandNames).not.toContain('resetInterpolationWeight');
  for(const op of ['setInterpolationWeight','resetInterpolationWeight'])expect(()=>prepareSnapshotBatch(project,{commands:[{op}]})).toThrow(/Unknown snapshot command/);
  const overview=snapshotOverview(project);expect(overview).not.toHaveProperty('interpolationWeights');expect(overview.recordings![0]).not.toHaveProperty('interpolationWeightCount');expect(JSON.stringify(project)).toBe(before);
 });
});
