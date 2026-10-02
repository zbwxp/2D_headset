import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createEmptyProject} from '../app/emptyProject';
import {planSceneExampleImport} from '../app/sceneExamples';
import {artworkCleanupSceneIdentity} from '../app/artworkCleanup';
import {recordingSceneSources} from '../app/recordingSceneSources';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecordingScene,type SceneCommand} from '../app/recordingSceneApi';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import type {LandmarkProject} from '../domain/landmarks/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {instanceObjectId,identityScenePlacement} from '../domain/recordingScene/model';
import {evaluateShapeTrack} from '../domain/recordingScene/tracks';

const angle=(x:number)=>({x,y:0});
const neutral=()=>({nodes:{},handles:{}});
const val=<T,>(r:VectorResult<T>):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const closePoint=(actual:Point2,expected:Point2)=>{expect(actual[0]).toBeCloseTo(expected[0],8);expect(actual[1]).toBeCloseTo(expected[1],8);};
function harness(){
 let drawing=addLayer(emptyDrawing(),'Face');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Contour','contour');
 let project:LandmarkProject={...createEmptyProject(),...saveDrawingSnapshot({drawing},'Face artwork')},mode:'drawing'|'recording'='recording';
 const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(){throw Error('Unexpected source write');},commitRecordingScenes(recordingScenes){past.push(project);future.length=0;project={...project,recordingScenes};},undo(){const prior=past.pop();if(prior){future.push(project);project=prior;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const apply=(...commands:SceneCommand[])=>val(api.scene({commands}));
 const result=apply({op:'createScene',name:'Shape scene'},{op:'addInstance',artworkId:project.drawingSnapshots!.activeId!,name:'A',ref:'a'},{op:'addInstance',artworkId:project.drawingSnapshots!.activeId!,name:'B',ref:'b'});
 const id=(ref:string)=>result.created.find(c=>c.ref===ref)!.id;
 const nodeId=drawing.curves[0].nodes[0];
 return {api,apply,a:id('a'),b:id('b'),nodeId,curveId:drawing.curves[0].id,layerId:drawing.layers[0].id,project:()=>project,replace:(p:LandmarkProject)=>project=p,scene:()=>project.recordingScenes!.scenes[0],past:()=>past,mode:(next:typeof mode)=>mode=next};
}

test('native shape edits need no Warp, seed neutral established viewpoints and leave another instance and source alone',()=>{
 const h=harness(),source=h.project().drawing,snapshots=h.project().drawingSnapshots;
 h.apply({op:'createViewpoint',angle:angle(30)},{op:'createViewpoint',angle:angle(90)});
 const result=h.apply({op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]}),track=h.scene().shapeTracks![0],seedIds=track.keys.map(k=>k.id);
 expect(result.created.filter(c=>c.kind==='shapeTrack')).toHaveLength(1);
 expect(track.keys.map(k=>({angle:k.angle,value:k.value}))).toEqual([30,90].map(x=>({angle:angle(x),value:neutral()})));
 closePoint(track.draft!.value.nodes[h.nodeId],[.2,.1]);
 const evaluated=evaluateRecordingScene(h.project());
 closePoint(evaluated.drawing.nodes.find(n=>n.id===instanceObjectId(h.a,h.nodeId))!.position,[.2,.1]);
 closePoint(evaluated.drawing.nodes.find(n=>n.id===instanceObjectId(h.b,h.nodeId))!.position,[0,0]);
 closePoint(evaluated.drawing.curves.find(c=>c.id===instanceObjectId(h.a,h.curveId))!.handles[0],[.5,.3]);
 h.apply({op:'saveSelected',instanceIds:[h.a],name:'Right shape'});
 expect(h.scene().shapeTracks![0].keys.map(k=>k.id)).toEqual(seedIds);
 closePoint(evaluateShapeTrack(h.scene().shapeTracks![0],angle(45)).nodes[h.nodeId],[.05,.025]);
 const saved=structuredClone(h.scene().shapeTracks);h.apply({op:'createViewpoint',angle:angle(60)});expect(h.scene().shapeTracks).toEqual(saved);
 expect(h.scene().warps).toEqual([]);expect(h.scene().bindings).toEqual([]);expect(h.scene().visibilityTracks).toEqual([]);
 expect(h.project().drawing).toBe(source);expect(h.project().drawingSnapshots).toBe(snapshots);
 expect(parseLandmarks(JSON.stringify(h.project())).recordingScenes).toEqual(h.project().recordingScenes);
});

test('handle commands accumulate in the instance shape draft and use unplaced absolute coordinates',()=>{
 const h=harness();h.apply({op:'setInstancePlacement',instanceId:h.a,value:{translation:[3,4],rotation:0,scale:2}},{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]},{op:'moveShapeHandle',instanceId:h.a,curveId:h.curveId,end:0,position:[.6,.4]});
 const value=h.scene().shapeTracks![0].draft!.value;closePoint(value.nodes[h.nodeId],[.2,.1]);closePoint(value.handles[h.curveId][0],[.1,.1]);
 const evaluated=evaluateRecordingScene(h.project());closePoint(evaluated.drawing.nodes.find(n=>n.id===instanceObjectId(h.a,h.nodeId))!.position,[3.4,4.2]);closePoint(evaluated.drawing.curves.find(c=>c.id===instanceObjectId(h.a,h.curveId))!.handles[0],[4.2,4.8]);
 h.apply({op:'discardSelected',instanceIds:[h.a]});expect(h.scene().shapeTracks![0].draft).toBeUndefined();expect(h.scene().placementTracks![0].draft).toBeUndefined();
});

test('shape drafts guard only their instance shape while viewpoint update commits matching shape and placement drafts',()=>{
 const h=harness(),v30=h.apply({op:'createViewpoint',angle:angle(30),ref:'v30'}).created.find(c=>c.ref==='v30')!.id,v90=h.apply({op:'createViewpoint',angle:angle(90),ref:'v90'}).created.find(c=>c.ref==='v90')!.id;
 h.apply({op:'setAngle',angle:angle(30)},{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]},{op:'setAngle',angle:angle(90)},{op:'setInstancePlacement',instanceId:h.a,value:{...identityScenePlacement(),translation:[2,0]}},{op:'moveShapeNode',instanceId:h.b,nodeId:h.nodeId,position:[.4,.2]});
 const before=h.project();
 for(const command of [{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[9,9]},{op:'moveShapeHandle',instanceId:h.a,curveId:h.curveId,end:0,position:[9,9]},{op:'saveSelected',instanceIds:[h.a]}])expect(h.api.scene({commands:[command] as SceneCommand[]})).toMatchObject({ok:false,error:{code:'OBJECT_DRAFT_AT_OTHER_ANGLE',commandIndex:0}});
 expect(h.project()).toBe(before);
 h.apply({op:'updateViewpoint',viewpointId:v90});expect(h.scene().shapeTracks!.find(t=>t.instanceId===h.b)!.draft).toBeUndefined();expect(h.scene().placementTracks![0].draft).toBeUndefined();expect(h.scene().shapeTracks![0].draft?.angle).toEqual(angle(30));
 h.apply({op:'updateViewpoint',viewpointId:v30});expect(h.scene().shapeTracks![0].draft).toBeUndefined();closePoint(h.scene().shapeTracks![0].keys.find(k=>k.angle.x===30)!.value.nodes[h.nodeId],[.2,.1]);
 const saved=structuredClone(h.scene().shapeTracks);h.apply({op:'updateViewpoint',viewpointId:v30});expect(h.scene().shapeTracks).toEqual(saved);
});

test('shape inspection and preview expose independent values and draft status, and facade keeps dry-run, revision, mode and undo guarantees',()=>{
 const h=harness(),before=h.project(),past=h.past().length,revision=h.api.inspectScene().revision,commands:SceneCommand[]=[{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]}];
 val(h.api.scene({commands,dryRun:true,expectedRevision:revision}));expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);
 val(h.api.scene({commands,expectedRevision:revision}));const edited=h.project();expect(h.past()).toHaveLength(past+1);
 const overview=val(h.api.inspectScene({instanceIds:[h.a]}));expect(overview).toMatchObject({hasDraft:true,scenes:[{shapeTrackCount:1}],instances:[{id:h.a,shapeKeyCount:0,currentShape:{nodes:{[h.nodeId]:[.2,.1]}}}],shapeTracks:[{instanceId:h.a,draft:{angle:angle(0)}}]});
 expect((overview as any).shapeTracks[0].draft).not.toHaveProperty('value');expect(val(h.api.inspectScene({includeKeyValues:true}))).toMatchObject({shapeTracks:[{draft:{value:{nodes:{[h.nodeId]:[.2,.1]}}}}]});
 expect(evaluateRecordingScene(h.project())).toMatchObject({usedDraft:true,hasUnappliedDraft:false});expect(evaluateRecordingScene(h.project(),{angle:angle(0)})).toMatchObject({usedDraft:false,hasUnappliedDraft:true});
 expect(h.api.scene({commands,expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
 val(h.api.undo());expect(h.project()).toBe(before);val(h.api.redo());expect(h.project()).toBe(edited);
 h.mode('drawing');expect(h.api.scene({commands})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(h.api.inspectScene().ok).toBe(true);expect(h.api.help().sceneCommands).toContain('moveShapeNode');expect(h.api.help().sceneCommands).toContain('moveShapeHandle');
});

test('shape commands reject malformed positions, missing identities and extra fields atomically',()=>{
 const h=harness(),before=h.project(),past=h.past().length;
 const badCommands:unknown[]=[...[[1],[1,2,3],[NaN,0],['1',0],[10001,0]].map(position=>({op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position})),{op:'moveShapeNode',instanceId:h.a,nodeId:'missing',position:[0,0]},{op:'moveShapeHandle',instanceId:h.a,curveId:'missing',end:0,position:[0,0]},{op:'moveShapeHandle',instanceId:h.a,curveId:h.curveId,end:2,position:[0,0]},{op:'moveShapeHandle',instanceId:h.a,curveId:h.curveId,end:'0',position:[0,0]},{op:'moveShapeNode',instanceId:'missing',nodeId:h.nodeId,position:[0,0]},{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[0,0],ref:'shape'}];
 for(const command of badCommands)expect(h.api.scene({commands:[{op:'setAngle',angle:angle(45)},command] as SceneCommand[]})).toMatchObject({ok:false,error:{commandIndex:1}});
 expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);expect(h.scene().shapeTracks).toBeUndefined();
 h.apply({op:'saveSelected',instanceIds:[h.a]});expect(h.scene().shapeTracks).toBeUndefined();
});

test('shape key edits and instance removal are scoped, and cleanup retains missing-source offsets for live instances',()=>{
 const h=harness();h.apply({op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]},{op:'moveShapeNode',instanceId:h.b,nodeId:h.nodeId,position:[.4,.2]},{op:'saveSelected',instanceIds:[h.a,h.b]});
 const [a,b]=h.scene().shapeTracks!,key=a.keys[0],other=structuredClone(b);
 h.apply({op:'renameKey',trackId:a.id,keyId:key.id,name:'  Node pose  '});expect(h.scene().shapeTracks![0].keys[0].name).toBe('Node pose');
 h.apply({op:'deleteKey',trackId:a.id,keyId:key.id});expect(h.scene().shapeTracks![0].keys).toEqual([]);expect(h.scene().shapeTracks![1]).toEqual(other);
 h.apply({op:'removeInstance',instanceId:h.a});expect(h.scene().shapeTracks).toEqual([other]);
 const missing=structuredClone(h.project());missing.recordingScenes!.scenes[0].instances[0].artworkId='missing-source';h.replace(missing);h.apply({op:'cleanupUnused',removeUnboundWarps:true});expect(h.scene().shapeTracks).toEqual([other]);
});

test('shape import remaps instance, track and key IDs while retaining source IDs, values and drafts; cleanup identities normalize only identities',()=>{
 const h=harness();h.apply({op:'setAngle',angle:angle(30)},{op:'moveShapeNode',instanceId:h.a,nodeId:h.nodeId,position:[.2,.1]},{op:'saveSelected',instanceIds:[h.a]},{op:'setAngle',angle:angle(90)},{op:'moveShapeHandle',instanceId:h.a,curveId:h.curveId,end:0,position:[.6,.4]});
 const original=h.scene().shapeTracks![0],plan=planSceneExampleImport({},h.project()),track=plan.scene.shapeTracks![0];
 expect(track.id).toBe(plan.idMaps.tracks[original.id]);expect(track.id).not.toBe(original.id);expect(track.instanceId).toBe(plan.idMaps.instances[h.a]);expect(track.keys[0]).toEqual({...original.keys[0],id:plan.idMaps.keys[JSON.stringify([original.id,original.keys[0].id])]});expect(track.draft).toEqual(original.draft);
 const renamed=structuredClone(h.scene()),sources=recordingSceneSources(h.project());renamed.shapeTracks=renamed.shapeTracks!.map(t=>({...t,id:'new-track',keys:t.keys.map(k=>({...k,id:'new-key'}))}));
 expect(artworkCleanupSceneIdentity(renamed,sources)).toBe(artworkCleanupSceneIdentity(h.scene(),sources));renamed.shapeTracks[0].keys[0].value.nodes[h.nodeId][0]+=1;expect(artworkCleanupSceneIdentity(renamed,sources)).not.toBe(artworkCleanupSceneIdentity(h.scene(),sources));
});

test('the documented native shape example runs through the real API as a pure dry run',()=>{
 const h=harness(),guide=readFileSync(new URL('../../docs/recording-scene-api.md',import.meta.url),'utf8'),match=guide.match(/<!-- shape-tested -->\s*```json\s*([\s\S]*?)```/);expect(match).not.toBeNull();
 const example=JSON.parse(match![1].replaceAll('INSTANCE_ID',h.a).replaceAll('SOURCE_NODE_ID',h.nodeId).replaceAll('SOURCE_CURVE_ID',h.curveId)),before=h.project();expect(h.api.scene(example.request).ok).toBe(true);expect(h.project()).toBe(before);
});
