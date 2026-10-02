import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createEmptyProject} from '../app/emptyProject';
import {planSceneExampleImport} from '../app/sceneExamples';
import {artworkCleanupSceneIdentity} from '../app/artworkCleanup';
import {recordingSceneSources} from '../app/recordingSceneSources';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {prepareSceneBatch,sceneOverview,evaluateRecordingScene,type SceneCommand} from '../app/recordingSceneApi';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import type {LandmarkProject} from '../domain/landmarks/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {evaluatePlacementTrack} from '../domain/recordingScene/tracks';

const angle=(x:number)=>({x,y:0});
const pose=(x:number,rotation=0,scale=1):ScenePlacementValue=>({translation:[x,-x/2],rotation,scale});
const val=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function harness(){
 let drawing=addLayer(emptyDrawing(),'Face');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Contour','contour');
 let project:LandmarkProject={...createEmptyProject(),...saveDrawingSnapshot({drawing},'Face artwork')},mode:'drawing'|'recording'='recording';
 const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(){throw Error('Unexpected source write');},commitRecordingScenes(recordingScenes){past.push(project);future.length=0;project={...project,recordingScenes};},undo(){const prior=past.pop();if(prior){future.push(project);project=prior;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const apply=(...commands:SceneCommand[])=>val(api.scene({commands}));
 const result=apply({op:'createScene',name:'Placement scene'},{op:'addInstance',artworkId:project.drawingSnapshots!.activeId!,name:'A',ref:'a'},{op:'addInstance',artworkId:project.drawingSnapshots!.activeId!,name:'B',ref:'b'});
 const id=(ref:string)=>result.created.find(c=>c.ref===ref)!.id;
 return {api,apply,a:id('a'),b:id('b'),project:()=>project,replace:(p:LandmarkProject)=>project=p,scene:()=>project.recordingScenes!.scenes[0],past:()=>past,mode:(next:typeof mode)=>mode=next,layerId:drawing.layers[0].id};
}
const createdId=(result:ReturnType<ReturnType<typeof harness>['apply']>,ref:string)=>result.created.find(c=>c.ref===ref)!.id;

test('instance placement needs no Warp and starts neutral at every established viewpoint without changing another instance or source',()=>{
 const h=harness(),source=h.project().drawing,snapshots=h.project().drawingSnapshots;
 h.apply({op:'createViewpoint',angle:angle(30)},{op:'createViewpoint',angle:angle(90)});
 const result=h.apply({op:'setInstancePlacement',instanceId:h.a,value:pose(2,90,2)}),track=h.scene().placementTracks![0],seedIds=track.keys.map(k=>k.id);
 expect(result.created.filter(c=>c.kind==='placementTrack')).toHaveLength(1);
 expect(track.keys.map(k=>({angle:k.angle,value:k.value}))).toEqual([30,90].map(x=>({angle:angle(x),value:identityScenePlacement()})));
 expect(track.draft).toEqual({angle:angle(90),value:pose(2,90,2)});
 expect(evaluateRecordingScene(h.project(),{angle:angle(30)}).placements[h.a]).toEqual(identityScenePlacement());
 expect(evaluateRecordingScene(h.project()).placements[h.a]).toEqual(pose(2,90,2));
 h.apply({op:'saveSelected',instanceIds:[h.a],name:'Right pose'});
 expect(h.scene().placementTracks![0].keys.map(k=>k.id)).toEqual(seedIds);
 const at45=evaluatePlacementTrack(h.scene().placementTracks![0],angle(45));expect(at45.translation).toEqual([.5,-.25]);expect(at45.rotation).toBeCloseTo(22.5);
 expect(h.scene().placementTracks).toHaveLength(1);expect(evaluateRecordingScene(h.project()).placements[h.b]).toEqual(identityScenePlacement());
 const authored=structuredClone(h.scene().placementTracks);h.apply({op:'createViewpoint',angle:angle(60)});expect(h.scene().placementTracks).toEqual(authored);
 expect(h.scene().warps).toEqual([]);expect(h.scene().bindings).toEqual([]);expect(h.scene().visibilityTracks).toEqual([]);
 expect(h.project().drawing).toBe(source);expect(h.project().drawingSnapshots).toBe(snapshots);
 expect(parseLandmarks(JSON.stringify(h.project())).recordingScenes).toEqual(h.project().recordingScenes);
});

test('instance drafts keep their own angle guard while navigation and other instance and layer edits remain independent',()=>{
 const h=harness(),target={instanceId:h.a,sourceLayerId:h.layerId};
 h.apply({op:'setAngle',angle:angle(30)},{op:'setInstancePlacement',instanceId:h.a,value:pose(1)},{op:'setAngle',angle:angle(90)},{op:'setInstancePlacement',instanceId:h.b,value:pose(3)},{op:'setVisibility',target,visible:false});
 const before=h.project();
 for(const command of [{op:'setInstancePlacement',instanceId:h.a,value:pose(9)},{op:'saveSelected',instanceIds:[h.a]}])expect(h.api.scene({commands:[command] as SceneCommand[]})).toMatchObject({ok:false,error:{code:'OBJECT_DRAFT_AT_OTHER_ANGLE',commandIndex:0}});
 expect(h.project()).toBe(before);
 h.apply({op:'saveSelected',instanceIds:[h.b]});
 expect(h.scene().placementTracks!.find(t=>t.instanceId===h.a)!.draft?.angle).toEqual(angle(30));
 expect(h.scene().placementTracks!.find(t=>t.instanceId===h.b)!.draft).toBeUndefined();expect(h.scene().visibilityTracks[0].draft).toBeDefined();
 h.apply({op:'discardSelected',instanceIds:[h.a]});expect(h.scene().placementTracks!.find(t=>t.instanceId===h.a)!.draft).toBeUndefined();expect(h.scene().visibilityTracks[0].draft).toBeDefined();
 h.apply({op:'setInstancePlacement',instanceId:h.a,value:pose(4)});expect(h.scene().placementTracks!.find(t=>t.instanceId===h.a)!.draft?.angle).toEqual(angle(90));
 h.apply({op:'saveSelected',layerRefs:[target]});expect(h.scene().placementTracks!.find(t=>t.instanceId===h.a)!.draft).toBeDefined();
});

test('updating a viewpoint commits matching placement drafts and preserves clean keys and other-angle drafts',()=>{
 const h=harness(),v30=createdId(h.apply({op:'createViewpoint',angle:angle(30),ref:'left'}),'left'),v90=createdId(h.apply({op:'createViewpoint',angle:angle(90),ref:'right'}),'right');
 h.apply({op:'setInstancePlacement',instanceId:h.a,value:pose(2,720,2)},{op:'saveSelected',instanceIds:[h.a],name:'Turn twice'},{op:'setInstancePlacement',instanceId:h.a,value:pose(4,810,3)},{op:'setAngle',angle:angle(30)},{op:'setInstancePlacement',instanceId:h.b,value:pose(-2)});
 const original=structuredClone(h.scene().placementTracks!),a90=original[0].keys.find(k=>k.angle.x===90)!;
 h.apply({op:'updateViewpoint',viewpointId:v90});const updated=h.scene().placementTracks!;
 expect(updated[0].keys.find(k=>k.angle.x===90)).toEqual({...a90,value:pose(4,810,3)});expect(updated[0].keys.find(k=>k.angle.x===30)).toEqual(original[0].keys.find(k=>k.angle.x===30));
 expect(updated[0].draft).toBeUndefined();expect(updated[1]).toEqual(original[1]);
 const snapshot=structuredClone(updated);h.apply({op:'updateViewpoint',viewpointId:v90});expect(h.scene().placementTracks).toEqual(snapshot);
 h.apply({op:'updateViewpoint',viewpointId:v30});expect(h.scene().placementTracks![1].draft).toBeUndefined();expect(h.scene().placementTracks![1].keys.find(k=>k.angle.x===30)!.value).toEqual(pose(-2));
});

test('placement keys can be renamed and deleted without changing another instance or a viewpoint',()=>{
 const h=harness();h.apply({op:'createViewpoint',angle:angle(30)},{op:'setInstancePlacement',instanceId:h.a,value:pose(2)},{op:'setInstancePlacement',instanceId:h.b,value:pose(3)},{op:'saveSelected',instanceIds:[h.a,h.b]});
 const [a,b]=h.scene().placementTracks!,key=a.keys[0],other=structuredClone(b),viewpoints=structuredClone(h.scene().viewpoints);
 h.apply({op:'renameKey',trackId:a.id,keyId:key.id,name:'  Side placement  '});expect(h.scene().placementTracks![0].keys[0].name).toBe('Side placement');
 const result=h.apply({op:'deleteKey',trackId:a.id,keyId:key.id});expect(result.removedIds).toEqual([key.id]);expect(h.scene().placementTracks![0].keys).toEqual([]);expect(h.scene().placementTracks![1]).toEqual(other);expect(h.scene().viewpoints).toEqual(viewpoints);
});

test('old scenes remain unchanged by inspect and preview; saving an unedited instance creates only its neutral placement track',()=>{
 const h=harness(),before=JSON.stringify(h.project());expect(h.scene().placementTracks).toBeUndefined();expect(parseRecordingScenes(h.project().recordingScenes).scenes[0].placementTracks).toBeUndefined();
 expect(sceneOverview(h.project())).toMatchObject({placementTracks:[],instances:[{id:h.a,currentPlacement:identityScenePlacement(),placementKeyCount:0},{id:h.b,currentPlacement:identityScenePlacement(),placementKeyCount:0}]});
 expect(evaluateRecordingScene(h.project()).placements[h.a]).toEqual(identityScenePlacement());expect(JSON.stringify(h.project())).toBe(before);
 expect(h.apply({op:'discardSelected',instanceIds:[h.a]}).changed).toBe(false);
 h.apply({op:'setAngle',angle:angle(30)},{op:'saveSelected',instanceIds:[h.a]});expect(h.scene().placementTracks).toHaveLength(1);expect(h.scene().placementTracks![0].keys).toMatchObject([{angle:angle(30),value:identityScenePlacement()}]);expect(h.scene().warps).toEqual([]);expect(h.scene().visibilityTracks).toEqual([]);
});

test('inspection and previews expose placements and draft status without writing, and facade preserves mode, revision, dry-run and one-Undo rules',()=>{
 const h=harness(),before=h.project(),past=h.past().length,revision=h.api.inspectScene().revision,commands:SceneCommand[]=[{op:'setInstancePlacement',instanceId:h.a,value:pose(2,450,2)}];
 val(h.api.scene({commands,dryRun:true,expectedRevision:revision}));expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);
 val(h.api.scene({commands,expectedRevision:revision}));expect(h.past()).toHaveLength(past+1);const placed=h.project();
 const overview=val(h.api.inspectScene({instanceIds:[h.a]}));expect(overview).toMatchObject({hasDraft:true,scenes:[{placementTrackCount:1}],instances:[{id:h.a,currentPlacement:pose(2,450,2),placementKeyCount:0}],placementTracks:[{instanceId:h.a,draft:{angle:angle(0)}}]});
 expect((overview as any).placementTracks[0].draft).not.toHaveProperty('value');expect(val(h.api.inspectScene({includeKeyValues:true}))).toMatchObject({placementTracks:[{draft:{value:pose(2,450,2)}}]});
 expect(evaluateRecordingScene(h.project())).toMatchObject({usedDraft:true,hasUnappliedDraft:false});expect(evaluateRecordingScene(h.project(),{angle:angle(0)})).toMatchObject({usedDraft:false,hasUnappliedDraft:true});
 expect(h.api.scene({commands,expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
 val(h.api.undo());expect(h.project()).toBe(before);val(h.api.redo());expect(h.project()).toBe(placed);
 h.mode('drawing');expect(h.api.scene({commands})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(h.api.inspectScene().ok).toBe(true);val(h.api.previewScene({showFills:false}));expect(h.project()).toBe(placed);
 expect(h.api.help().sceneCommands).toContain('setInstancePlacement');
});

test('placement commands strictly validate values and selection identities and reject a whole batch atomically',()=>{
 const h=harness(),before=h.project(),past=h.past().length,valid=pose(2,360,2),badValues:unknown[]=[null,{}, {...valid,extra:true},{...valid,translation:[1]}, {...valid,translation:[1,2,3]}, {...valid,translation:['1',2]}, {...valid,translation:[NaN,0]}, {...valid,translation:[1e6+1,0]}, {...valid,rotation:Infinity}, {...valid,rotation:1e9+1}, {...valid,scale:0}, {...valid,scale:-1}, {...valid,scale:1e-7}, {...valid,scale:1e6+1}];
 const badCommands:unknown[]=[...badValues.map(value=>({op:'setInstancePlacement',instanceId:h.a,value})),{op:'setInstancePlacement',instanceId:'missing',value:valid},{op:'setInstancePlacement',instanceId:h.a,value:valid,warpId:'hidden'},{op:'setInstancePlacement',instanceId:h.a,value:valid,ref:'placement'},{op:'saveSelected',instanceIds:[h.a,h.a]},{op:'saveSelected',instanceIds:['missing']},{op:'discardSelected',instanceIds:[]},{op:'discardSelected',instanceIds:h.a}];
 for(const command of badCommands){expect(()=>prepareSceneBatch(h.project(),{commands:[{op:'setAngle',angle:angle(45)},command]})).toThrow();expect(h.api.scene({commands:[{op:'setAngle',angle:angle(45)},command] as SceneCommand[]})).toMatchObject({ok:false,error:{commandIndex:1}});}
 expect(h.project()).toBe(before);expect(h.past()).toHaveLength(past);
 const result=h.apply({op:'setInstancePlacement',instanceId:h.a,value:{translation:[-1e6,1e6],rotation:-1e9,scale:1e-6}});expect(result.applied).toBe(true);
});

test('removing an instance removes only its placement; cleanup preserves valid placements even when their source is missing',()=>{
 const h=harness();h.apply({op:'setInstancePlacement',instanceId:h.a,value:pose(1)},{op:'setInstancePlacement',instanceId:h.b,value:pose(2)},{op:'saveSelected',instanceIds:[h.a,h.b]},{op:'createWarp',layerRefs:[{instanceId:h.a,sourceLayerId:h.layerId},{instanceId:h.b,sourceLayerId:h.layerId}]});
 const other=structuredClone(h.scene().placementTracks![1]),warp=structuredClone(h.scene().warps[0]);h.apply({op:'removeInstance',instanceId:h.a});expect(h.scene().placementTracks).toEqual([other]);expect(h.scene().warps).toEqual([warp]);expect(h.scene().bindings).toHaveLength(1);
 const missing=structuredClone(h.project());missing.recordingScenes!.scenes[0].instances[0].artworkId='missing-source';h.replace(missing);h.apply({op:'cleanupUnused',removeUnboundWarps:true});expect(h.scene().placementTracks).toEqual([other]);expect(evaluateRecordingScene(h.project()).placements[h.b]).toEqual(pose(2));
});

test('documented native placement example executes through the real API without committing a dry run',()=>{
 const h=harness(),guide=readFileSync(new URL('../../docs/recording-scene-api.md',import.meta.url),'utf8'),match=guide.match(/<!-- placement-tested -->\s*```json\s*([\s\S]*?)```/);expect(match).not.toBeNull();
 const example=JSON.parse(match![1].replaceAll('INSTANCE_ID',h.a)),before=h.project();expect(h.api.scene(example.request).ok).toBe(true);expect(h.project()).toBe(before);
});


test('scene import remaps placement instances, tracks and keys while preserving pose values and drafts',()=>{
 const h=harness();h.apply({op:'setAngle',angle:angle(30)},{op:'setInstancePlacement',instanceId:h.a,value:pose(1,30,2)},{op:'saveSelected',instanceIds:[h.a]},{op:'setAngle',angle:angle(90)},{op:'setInstancePlacement',instanceId:h.a,value:pose(3,90,4)});
 const original=h.scene().placementTracks![0],before=JSON.stringify(h.project()),plan=planSceneExampleImport({},h.project()),track=plan.scene.placementTracks![0];
 expect(track.id).toBe(plan.idMaps.tracks[original.id]);expect(track.id).not.toBe(original.id);expect(track.instanceId).toBe(plan.idMaps.instances[h.a]);expect(track.instanceId).not.toBe(h.a);
 expect(track.keys[0]).toEqual({...original.keys[0],id:plan.idMaps.keys[JSON.stringify([original.id,original.keys[0].id])]});expect(track.keys[0].id).not.toBe(original.keys[0].id);expect(track.draft).toEqual(original.draft);
 expect(parseRecordingScenes({version:1,scenes:[plan.scene]}).scenes[0].placementTracks).toEqual([track]);expect(JSON.stringify(h.project())).toBe(before);
 const imported={...createEmptyProject(),...plan.state,recordingScenes:{version:1 as const,activeSceneId:plan.scene.id,scenes:[plan.scene]}};
 expect(evaluateRecordingScene(imported,{angle:angle(30)}).placements[track.instanceId]).toEqual(pose(1,30,2));expect(evaluateRecordingScene(imported).placements[track.instanceId]).toEqual(pose(3,90,4));
});

test('cleanup scene identity normalizes placement IDs but retains authored placement values',()=>{
 const h=harness();h.apply({op:'setInstancePlacement',instanceId:h.a,value:pose(1,30,2)},{op:'saveSelected',instanceIds:[h.a]});
 const original=h.scene(),renamed=structuredClone(original),sources=recordingSceneSources(h.project());renamed.id='renamed-scene';renamed.instances=renamed.instances.map((i,index)=>({...i,id:`instance-${index}`}));
 renamed.placementTracks=renamed.placementTracks!.map((t,index)=>({...t,id:`placement-${index}`,instanceId:renamed.instances[original.instances.findIndex(i=>i.id===t.instanceId)].id,keys:t.keys.map((k,i)=>({...k,id:`key-${i}`}))}));
 expect(artworkCleanupSceneIdentity(renamed,sources)).toBe(artworkCleanupSceneIdentity(original,sources));
 renamed.placementTracks[0].keys[0].value.translation[0]+=1;expect(artworkCleanupSceneIdentity(renamed,sources)).not.toBe(artworkCleanupSceneIdentity(original,sources));
});
