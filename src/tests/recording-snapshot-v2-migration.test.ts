import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {migrateLegacyRecordingScenes} from '../domain/recordingScene/migration';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {emptyRecordingScene,instanceObjectId,type SceneShapeValue} from '../domain/recordingScene/model';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {ensureRecordingSnapshots,archivedRecordingProjectJSON,snapshotMigrationId} from '../domain/recordingSnapshot/migration';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {canonicalElementId,materializeOriginalSnapshot,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';

const source=():DrawingDocument=>({...emptyDrawing(),nodes:[{id:'n0',position:[0,0]},{id:'n1',position:[1,0]}],curves:[{id:'c',name:'Curve',nodes:['n0','n1'],handles:[[.25,.1],[.75,-.1]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]});

test('native migration retains sparse empty shape keys, draft coordinates and true zero placement without baking originals',()=>{
 const drawing=source(),scene=emptyRecordingScene('scene','Native scene');scene.instances=[{id:'instance',artworkId:'$working',name:'Source'}];scene.angle={x:45,y:0};
 scene.shapeTracks=[{id:'shape',instanceId:'instance',interpolation:'legacy',keys:[{id:'empty',name:'Front',angle:{x:0,y:0},value:{nodes:{},handles:{}}},{id:'side',angle:{x:90,y:0},value:{nodes:{n0:[.3,.2]},handles:{c:[[.1,0],[0,.2]]}}}],draft:{angle:{x:45,y:0},value:{nodes:{n0:[.05,.04]},handles:{}}}}];
 scene.placementTracks=[{id:'placement',instanceId:'instance',keys:[{id:'front',angle:{x:0,y:0},value:{translation:[0,0],rotation:0,scale:1}},{id:'zero',name:'Zero width',angle:{x:90,y:0},value:{translation:[.4,-.1],rotation:20,scale:1,scaleX:0,scaleY:1.3}}]}];
 const project={drawing,recordingScenes:{version:1 as const,activeSceneId:scene.id,scenes:[scene]}},before=JSON.stringify(project),next=ensureRecordingSnapshots(project),workspace=next.recordingSnapshots,recording=workspace.recordings[0];
 expect(recording.legacy).toBeUndefined();const shape=recording.tracks.find(t=>t.channel==='shape')!;
 expect(shape.interpolation).toBe('legacy');expect(shape.keys.map(k=>k.angle)).toEqual(scene.shapeTracks[0].keys.map(k=>k.angle));expect(shape.keys[0].value).toEqual({nodes:{},handles:{}});expect(shape.draft?.angle).toEqual({x:45,y:0});
 expect(recording.tracks.find(t=>t.channel==='placement')!.keys[1].value).toEqual(scene.placementTracks[0].keys[1].value);
 expect(Object.values(workspace.library.curves)[0].handles).toEqual(drawing.curves[0].handles);expect(JSON.stringify(project)).toBe(before);expect(archivedRecordingProjectJSON(workspace)).toBe(before);
 for(const x of [0,15,45,75,90])for(const useDraft of [false,true]){
  const old=evaluateScene(scene,id=>id==='$working'?drawing:undefined,{angle:{x,y:0},useDraft}),actual=evaluateRecordingSnapshot(workspace,recording.id,{angle:{x,y:0},useDraft});
  for(const node of drawing.nodes){const expected=old.drawing.nodes.find(n=>n.id===instanceObjectId('instance',node.id))!.position,position=actual.drawing.nodes.find(n=>n.id===canonicalElementId('$working',node.id))!.position;expect(position[0]).toBeCloseTo(expected[0],12);expect(position[1]).toBeCloseTo(expected[1],12);}
 }
 expect(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
});

test.each(['three-piece-scene-example','yaw-turning-example'])('%s migrates to editable canonical layers with faithful sampled geometry',name=>{
 const raw=readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8'),project=migrateLegacyRecordingScenes(parseLandmarks(raw)),next=ensureRecordingSnapshots(project,raw),workspace=next.recordingSnapshots,sources=recordingSceneSources(project);
 expect(archivedRecordingProjectJSON(workspace)).toBe(raw);
 for(const scene of project.recordingScenes!.scenes){
  const recording=workspace.recordings.find(r=>r.id===snapshotMigrationId('recording',scene.id))!;expect(recording.legacy).toBeUndefined();
  for(const x of [0,15,45,75,90]){
   const old=evaluateScene(scene,id=>sources[id],{angle:{x,y:0},useDraft:false}),actual=evaluateRecordingSnapshot(workspace,recording.id,{angle:{x,y:0},useDraft:false});
   expect(actual.drawing.curves).toHaveLength(old.drawing.curves.length);expect(actual.drawing.fills).toHaveLength(old.drawing.fills.length);
   for(const instance of scene.instances)for(const curve of sources[instance.artworkId].curves){
    const expected=old.drawing.curves.find(c=>c.id===instanceObjectId(instance.id,curve.id)),value=actual.drawing.curves.find(c=>c.id===canonicalElementId(instance.artworkId,curve.id));if(!expected){expect(value).toBeUndefined();continue;}expect(value).toBeDefined();
    for(const end of [0,1] as const)for(const axis of [0,1])expect(value!.handles[end][axis]).toBeCloseTo(expected.handles[end][axis],9);
   }
  }
 }
},30000);

test('canonical source synchronization updates shared originals without changing any recording channel or view reference',()=>{
 const drawing=source(),project=ensureRecordingSnapshots({drawing}),workspace=project.recordingSnapshots,before=JSON.stringify(workspace.recordings),snapshot=workspace.snapshots.find(s=>s.kind==='drawing')!;
 const changed={...drawing,curves:drawing.curves.map(curve=>({...curve,handles:[[.25,.3],curve.handles[1]] as [[number,number],[number,number]]}))},next=syncRecordingSnapshotSources({...project,drawing:changed});
 expect(materializeOriginalSnapshot(next.recordingSnapshots,snapshot.id)!.curves[0].handles[0]).toEqual([.25,.3]);expect(JSON.stringify(next.recordingSnapshots.recordings)).toBe(before);expect(project.recordingSnapshots.library.curves[canonicalElementId('$working','c')].handles[0]).toEqual([.25,.1]);
});

test('strict parser rejects malformed canonical values and malformed relationship endpoints',()=>{
 const workspace=ensureRecordingSnapshots({drawing:source()}).recordingSnapshots;
 for(const value of [-1,NaN]){const bad=structuredClone(workspace);Object.values(bad.library.curves)[0].width=value;expect(()=>parseRecordingSnapshots(bad)).toThrow();}
 const endpoint=structuredClone(workspace),snapshot=endpoint.snapshots.find(s=>s.kind==='drawing')!;snapshot.relations.endpointLinks={add:[{id:'bad',a:{curveId:'c',end:2 as 0},b:{curveId:'c',end:1},joinBrush:{kind:'ARC',trimDistance:-1}}]};expect(()=>parseRecordingSnapshots(endpoint)).toThrow();
 const fill=structuredClone(workspace);fill.library.fills.bad={id:'bad',name:'Bad',visible:true,locked:false,color:'white',boundary:null as unknown as []};expect(()=>parseRecordingSnapshots(fill)).toThrow();
});

test('source curvature transports authored interval keys and drafts; incompatible edits suspend only that channel and source Undo reconnects',()=>{
 const drawing=source();drawing.curves[0].handles=[[1/3,0],[2/3,0]];drawing.displayIntervals=[{id:'interval',anchor:{id:'c',reverse:false},ranges:[{id:'range',start:0,end:1}]}];
 const scene=emptyRecordingScene('interval-scene');scene.instances=[{id:'instance',artworkId:'$working',name:'Source'}];
 const appearance=(start:number,end:number)=>({...drawing.displayIntervals![0],ranges:[{id:'range',start,end}]});
 scene.intervalTracks=[{id:'interval-track',instanceId:'instance',sourceTrackId:'interval',keys:[{id:'front',angle:{x:0,y:0},value:{appearance:appearance(.2,.8),enabled:{range:false}}}],draft:{angle:{x:30,y:0},value:{appearance:appearance(.3,.7),enabled:{range:true}}}}];
 const project=ensureRecordingSnapshots({drawing,recordingScenes:{version:1 as const,scenes:[scene]}}),track=project.recordingSnapshots.recordings[0].tracks.find(t=>t.channel==='interval')!;
 const curved={...drawing,curves:[{...drawing.curves[0],handles:[[.1,.5],[2/3,0]] as [[number,number],[number,number]]}]},next=syncRecordingSnapshotSources({...project,drawing:curved},project),moved=next.recordingSnapshots.recordings[0].tracks.find(t=>t.channel==='interval')!;
 if(moved.channel!=='interval'||track.channel!=='interval')throw Error('interval');
 expect(moved.materialIssue).toBeUndefined();expect(moved.keys[0].value.appearance!.ranges[0].start).not.toBe(.2);expect(moved.draft!.value.appearance!.ranges[0].start).not.toBe(.3);expect(moved.keys[0].value.enabled).toEqual(track.keys[0].value.enabled);expect(moved.draft!.angle).toEqual({x:30,y:0});
 const arcAt=(t:number)=>{const p=(t:number)=>{const u=1-t;return [3*u*u*t*.1+3*u*t*t*(2/3)+t*t*t,3*u*u*t*.5];};let last=p(0),partial=0,total=0;for(let i=1;i<=10000;i++){const current=p(i/10000),length=Math.hypot(current[0]-last[0],current[1]-last[1]);total+=length;if(i/10000<=t)partial+=length;last=current;}return partial/total;};
 expect(moved.keys[0].value.appearance!.ranges[0].start).toBeCloseTo(arcAt(.2),3);
 const collapsed={...drawing,nodes:drawing.nodes.map(n=>({...n,position:[0,0] as [number,number]})),curves:[{...drawing.curves[0],handles:[[0,0],[0,0]] as [[number,number],[number,number]]}]},blocked=syncRecordingSnapshotSources({...project,drawing:collapsed},project),retained=blocked.recordingSnapshots.recordings[0].tracks.find(t=>t.channel==='interval')!;
 if(retained.channel!=='interval')throw Error('interval');expect(retained.materialIssue).toBeDefined();expect(retained.keys).toEqual(track.keys);expect(blocked.drawing).toBe(collapsed);expect(parseRecordingSnapshots(blocked.recordingSnapshots)).toEqual(blocked.recordingSnapshots);
 const evaluated=evaluateRecordingSnapshot(blocked.recordingSnapshots,blocked.recordingSnapshots.recordings[0].id);expect(evaluated.diagnostics.some(d=>d.code==='SOURCE_MATERIAL')).toBe(true);
 const restored=syncRecordingSnapshotSources({...blocked,drawing},blocked),restoredTrack=restored.recordingSnapshots.recordings[0].tracks.find(t=>t.channel==='interval')!;if(restoredTrack.channel!=='interval')throw Error('interval');expect(restoredTrack.materialIssue).toBeUndefined();expect(restoredTrack.keys).toEqual(track.keys);
});

test('an unrepresentable duplicate legacy branch remains exact and explicitly read-only',()=>{
 const drawing=source(),scene=emptyRecordingScene('duplicate');scene.instances=[{id:'a',artworkId:'$working',name:'A'},{id:'b',artworkId:'$working',name:'B'}];scene.placementTracks=[{id:'position',instanceId:'b',keys:[{id:'key',angle:{x:0,y:0},value:{translation:[.3,.2],rotation:20,scale:1}}]}];
 const workspace=ensureRecordingSnapshots({drawing,recordingScenes:{version:1,scenes:[scene]}}).recordingSnapshots,recording=workspace.recordings[0];expect(recording.legacy?.readOnly).toBe(true);expect(recording.legacy?.reason).toMatch(/multiple legacy instance branches/);
 const old=evaluateScene(scene,()=>drawing),evaluated=evaluateRecordingSnapshot(workspace,recording.id);expect(evaluated.drawing).toEqual(old.drawing);expect(evaluated.diagnostics.some(d=>d.code==='LEGACY_READ_ONLY')).toBe(true);
});
