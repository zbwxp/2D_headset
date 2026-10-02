import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {ensureRecordingSnapshots,snapshotMigrationId} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {evaluateScene} from '../../domain/recordingScene/evaluation';
import {recordingSceneSources} from '../../domain/recordingScene/sources';
import {instanceObjectId} from '../../domain/recordingScene/model';
import type {DrawingDocument} from '../../domain/drawing/model';

const fixture=process.env.RECORDING_MIGRATION_FIXTURE;
test.skipIf(!fixture)('a supplied v33 project retains exact native poses, paint and relations after migration',()=>{
 const bytes=readFileSync(fixture!),raw=bytes.toString('utf8'),sha256=createHash('sha256').update(bytes).digest('hex'),project=parseLandmarks(raw),next=ensureRecordingSnapshots(project,raw),workspace=next.recordingSnapshots,sources=recordingSceneSources(project),results:unknown[]=[];
 expect(workspace.legacyArchive?.projectJSON).toBe(raw);
 for(const scene of project.recordingScenes!.scenes){
  const recording=workspace.recordings.find(r=>r.id===snapshotMigrationId('recording',scene.id))!;expect(recording.legacy?.reason).toBeUndefined();
  const ids=new Map<string,string>();for(const instance of scene.instances){for(const [canonical,original] of Object.entries(workspace.snapshots.find(s=>s.source?.artworkId===instance.artworkId)!.source!.originIds))ids.set(canonical,instanceObjectId(instance.id,original));for(const layer of sources[instance.artworkId].layers)ids.set(snapshotMigrationId('layer',scene.id,instance.id,canonicalElementId(instance.artworkId,layer.id)),instanceObjectId(instance.id,layer.id));}
  const allTracks=[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[]),...(scene.shapeTracks??[])],angles=new Map([...[-90,-60,-30,0,30,60,90].map(x=>({x,y:0})),{x:-45,y:.55},{x:-30,y:-10},{x:30,y:10},scene.angle,...(scene.viewpoints??[]).map(v=>v.angle),...allTracks.flatMap(t=>[...t.keys.map(k=>k.angle),...(t.draft?[t.draft.angle]:[])])].map(angle=>[JSON.stringify(angle),angle]));
  for(const angle of angles.values()){
   const old=evaluateScene(scene,id=>sources[id],{angle,useDraft:true}),evaluated=evaluateRecordingSnapshot(workspace,recording.id,{angle,useDraft:true}),actual=remapDrawingIdentities(evaluated.drawing,id=>ids.get(id)??id);let maxCoordinateError=0;
   expect(actual.curves.length).toBe(old.drawing.curves.length);expect(actual.nodes.length).toBe(old.drawing.nodes.length);
   for(const node of actual.nodes){const prior=old.drawing.nodes.find(n=>n.id===node.id)!;expect(prior).toBeDefined();for(const axis of [0,1])maxCoordinateError=Math.max(maxCoordinateError,Math.abs(node.position[axis]-prior.position[axis]));}
   for(const curve of actual.curves){const prior=old.drawing.curves.find(c=>c.id===curve.id)!;expect(prior).toBeDefined();for(const end of [0,1])for(const axis of [0,1])maxCoordinateError=Math.max(maxCoordinateError,Math.abs(curve.handles[end][axis]-prior.handles[end][axis]));expect({...curve,handles:[]}).toEqual({...prior,handles:[]});}
   expect(maxCoordinateError).toBeLessThan(1e-9);
   const sorted=(values:unknown)=>(values as Array<{id:string}>|undefined??[]).slice().sort((a,b)=>a.id.localeCompare(b.id));
   for(const key of ['fills','offsets','joins','endpointLinks','groups','displayIntervals'] as const)expect(sorted(actual[key])).toEqual(sorted(old.drawing[key]));
   expect(actual.layers.map(l=>({id:l.id,items:l.items}))).toEqual(old.drawing.layers.map(l=>({id:l.id,items:l.items})));
   results.push({sceneId:scene.id,angle,native:true,maxCoordinateError,curves:actual.curves.length,nodes:actual.nodes.length,fills:actual.fills.length,intervals:actual.displayIntervals?.length??0,oldDiagnostics:old.diagnostics.length,newDiagnostics:evaluated.diagnostics.length});
  }
  for(const old of allTracks){const mapped=recording.tracks.filter(t=>t.id===snapshotMigrationId('track',scene.id,old.id)||t.id.startsWith(snapshotMigrationId('track',scene.id,old.id).slice(0,-1)+','));expect(mapped.length).toBeGreaterThan(0);for(const track of mapped){expect(track.keys.map(k=>({angle:k.angle,name:k.name}))).toEqual(old.keys.map(k=>({angle:k.angle,name:k.name})));expect(track.draft?.angle).toEqual(old.draft?.angle);expect(track.interpolation).toBe(old.interpolation);}}
 }
 const after=createHash('sha256').update(readFileSync(fixture!)).digest('hex');expect(after).toBe(sha256);
 const report={sourceSha256:sha256,sourceBytes:bytes.length,unchanged:after===sha256,archivedExact:true,recordings:workspace.recordings.length,canonicalCurves:Object.keys(workspace.library.curves).length,results};
 if(process.env.RECORDING_MIGRATION_REPORT){mkdirSync(dirname(process.env.RECORDING_MIGRATION_REPORT),{recursive:true});writeFileSync(process.env.RECORDING_MIGRATION_REPORT,JSON.stringify(report,null,2));}
 console.info(JSON.stringify(report));
},60000);
