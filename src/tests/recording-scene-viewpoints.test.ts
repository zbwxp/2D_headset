import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch,sceneOverview,evaluateRecordingScene,type SceneCommand} from '../app/recordingSceneApi';
import {emptyDrawing} from '../domain/drawing/model';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {instanceObjectId} from '../domain/recordingScene/model';
import {evaluateWarpTrack} from '../domain/recordingScene/tracks';
import type {LandmarkProject} from '../domain/landmarks/model';

function harness(){
 let drawing=addLayer(emptyDrawing(),'Face');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.02,'Contour','contour');drawing=addDisplayInterval(drawing,'contour','SHOW');
 let project:LandmarkProject={...createEmptyProject(),...saveDrawingSnapshot({drawing},'Face artwork')};
 const apply=(...commands:SceneCommand[])=>{const plan=prepareSceneBatch(project,{commands});project={...project,recordingScenes:plan.recordingScenes};return plan;};
 apply({op:'createScene',name:'Bookmarks'});
 return {apply,project:()=>project,scene:()=>project.recordingScenes!.scenes[0],artworkId:project.drawingSnapshots!.activeId!,layerId:drawing.layers[0].id};
}
const createdId=(plan:ReturnType<typeof prepareSceneBatch>,ref:string)=>plan.created.find(c=>c.ref===ref)!.id;
const angle=(x:number)=>({x,y:0});

test('zero-Warp viewpoints exist without tracks, commit a hidden member, and leave a newly bookmarked neutral view unchanged',()=>{
 const h=harness(),initial=structuredClone(h.project()),v90=createdId(h.apply({op:'createViewpoint',name:'Right',angle:angle(90),ref:'right'}),'right');
 expect(h.scene().angle).toEqual(angle(90));expect(h.scene().viewpoints).toEqual([{id:v90,name:'Right',angle:angle(90)}]);
 expect(h.scene().warps).toEqual([]);expect(h.scene().visibilityTracks).toEqual([]);expect(h.scene().intervalTracks).toEqual([]);
 expect(h.apply({op:'updateViewpoint',viewpointId:v90}).changed).toBe(false);
 const instanceId=createdId(h.apply({op:'addInstance',artworkId:h.artworkId,ref:'instance'}),'instance'),target={instanceId,sourceLayerId:h.layerId,sourceObjectId:'contour'};
 h.apply({op:'setVisibility',target,visible:false},{op:'updateViewpoint',viewpointId:v90});
 const saved=structuredClone(h.scene().visibilityTracks);expect(saved).toHaveLength(1);expect(saved[0].keys).toHaveLength(1);expect(saved[0].keys[0]).toMatchObject({angle:angle(90),value:false});expect(saved[0].draft).toBeUndefined();
 const v0=createdId(h.apply({op:'createViewpoint',name:'Front',angle:angle(0),ref:'front'}),'front');
 expect(h.scene().visibilityTracks).toEqual(saved);expect(h.scene().warps).toHaveLength(0);
 h.apply({op:'updateViewpoint',viewpointId:v0});expect(h.scene().visibilityTracks).toEqual(saved);
 const visible=(x:number)=>evaluateRecordingScene(h.project(),{angle:angle(x)}).drawing.curves.find(c=>c.id===instanceObjectId(instanceId,'contour'))!.visible;
 expect(visible(0)).toBe(true);expect(visible(90)).toBe(false);
 expect(h.project().drawing).toEqual(initial.drawing);expect(h.project().drawingSnapshots).toEqual(initial.drawingSnapshots);
 expect(parseLandmarks(JSON.stringify(h.project())).recordingScenes).toEqual(h.project().recordingScenes);
 expect(sceneOverview(h.project())).toMatchObject({hasExplicitViewpoints:true,viewpoints:[{id:v90},{id:v0}]});
});

test('a later Warp starts neutral at established 0/90 views; updating only dirty matching tracks preserves clean keys and other-angle drafts',()=>{
 const h=harness(),v90=createdId(h.apply({op:'createViewpoint',angle:angle(0)},{op:'createViewpoint',angle:angle(90),ref:'right'}),'right'),created=h.apply(
  {op:'addInstance',artworkId:h.artworkId,ref:'a'},{op:'addInstance',artworkId:h.artworkId,ref:'b'},{op:'addInstance',artworkId:h.artworkId,ref:'c'},
  {op:'createWarp',layerRefs:[{instanceId:'$a',sourceLayerId:h.layerId}],ref:'wa'},{op:'createWarp',layerRefs:[{instanceId:'$b',sourceLayerId:h.layerId}],ref:'wb'},{op:'createWarp',layerRefs:[{instanceId:'$c',sourceLayerId:h.layerId}],ref:'wc'}),wa=createdId(created,'wa'),wb=createdId(created,'wb'),wc=createdId(created,'wc');
 const a=h.scene().warps.find(w=>w.id===wa)!,neutral=structuredClone(a.restGrid),clean=structuredClone(h.scene().warps.find(w=>w.id===wb)!);
 expect(a.keys.map(k=>k.angle)).toEqual([angle(0),angle(90)]);expect(a.keys.every(k=>JSON.stringify(k.value)===JSON.stringify(neutral))).toBe(true);
 const rightKeyId=a.keys[1].id;h.apply({op:'renameKey',trackId:wa,keyId:rightKeyId,name:'Edited endpoint'});
 h.apply({op:'setAngle',angle:angle(30)},{op:'editWarpNodes',warpId:wc,edits:[{index:0,position:[-.3,-.2]}]});
 const other=structuredClone(h.scene().warps.find(w=>w.id===wc)!);
 h.apply({op:'setAngle',angle:angle(90)},{op:'editWarpNodes',warpId:wa,edits:neutral.nodes.map((n,index)=>({index,position:[n.position[0]+2,n.position[1]+1]}))},{op:'setAngle',angle:angle(0)},{op:'updateViewpoint',viewpointId:v90});
 const saved=h.scene().warps.find(w=>w.id===wa)!;expect(h.scene().angle).toEqual(angle(90));expect(saved.keys).toHaveLength(2);expect(saved.draft).toBeUndefined();
 expect(saved.keys[1]).toMatchObject({id:rightKeyId,name:'Edited endpoint'});
 expect(h.scene().warps.find(w=>w.id===wb)).toEqual(clean);expect(clean.keys).toHaveLength(2);expect(h.scene().warps.find(w=>w.id===wc)).toEqual(other);expect(other.draft!.angle).toEqual(angle(30));
 for(const [x,weight] of [[0,0],[45,.5],[90,1]]){const grid=evaluateWarpTrack(saved,angle(x),false);grid.nodes.forEach((n,index)=>{expect(n.position[0]).toBeCloseTo(neutral.nodes[index].position[0]+weight*2);expect(n.position[1]).toBeCloseTo(neutral.nodes[index].position[1]+weight);});}
 expect(h.scene().visibilityTracks).toEqual([]);expect(h.scene().intervalTracks).toEqual([]);expect(h.scene().depthTracks).toEqual([]);
});

test('new Warps preserve an untouched nonzero viewpoint and interpolate only between their own 30/90 keys',()=>{
 const h=harness(),created=h.apply({op:'createViewpoint',angle:angle(30)},{op:'createViewpoint',angle:angle(90),ref:'right'},{op:'addInstance',artworkId:h.artworkId,ref:'a'},{op:'createWarp',layerRefs:[{instanceId:'$a',sourceLayerId:h.layerId}],ref:'warp'}),warpId=createdId(created,'warp'),viewpointId=createdId(created,'right'),rest=structuredClone(h.scene().warps[0].restGrid);
 h.apply({op:'editWarpNodes',warpId,edits:rest.nodes.map((n,index)=>({index,position:[n.position[0]+4,n.position[1]]}))},{op:'updateViewpoint',viewpointId});
 const warp=h.scene().warps[0];expect(warp.keys.map(k=>k.angle)).toEqual([angle(30),angle(90)]);
 for(const [x,delta] of [[0,0],[30,0],[45,1],[90,4]])expect(evaluateWarpTrack(warp,angle(x),false).nodes[0].position[0]).toBeCloseTo(rest.nodes[0].position[0]+delta);
 const originalKeys=structuredClone(warp.keys),childId=createdId(h.apply({op:'createChild',parentWarpId:warpId,layerRefs:[{instanceId:createdId(created,'a'),sourceLayerId:h.layerId}],ref:'child'}),'child');
 const parentId=createdId(h.apply({op:'wrapParent',warpIds:[warpId],ref:'parent'}),'parent');
 for(const id of [childId,parentId]){const newWarp=h.scene().warps.find(w=>w.id===id)!;expect(newWarp.keys.map(k=>k.angle)).toEqual([angle(30),angle(90)]);expect(newWarp.keys.every(k=>JSON.stringify(k.value)===JSON.stringify(newWarp.restGrid))).toBe(true);}
 expect(h.scene().warps.find(w=>w.id===warpId)!.keys).toEqual(originalKeys);
});

test('viewpoint update commits matching visibility, interval and order drafts without adding any untouched channel',()=>{
 const h=harness(),created=h.apply({op:'createViewpoint',angle:angle(90),ref:'right'},{op:'addInstance',artworkId:h.artworkId,ref:'a'}),instanceId=createdId(created,'a'),viewpointId=createdId(created,'right'),target={instanceId,sourceLayerId:h.layerId},interval=h.project().drawing!.displayIntervals![0];
 h.apply({op:'setVisibility',target:{...target,sourceObjectId:'contour'},visible:false},{op:'changeInterval',instanceId,sourceTrackId:interval.id,rangeId:interval.ranges[0].id,start:.2,end:.8},{op:'setLayerOrder',target,value:3});
 const drafts=[h.scene().visibilityTracks[0].draft!,h.scene().intervalTracks[0].draft!,h.scene().depthTracks![0].draft!].map(d=>structuredClone(d));
 h.apply({op:'updateViewpoint',viewpointId});
 [h.scene().visibilityTracks[0],h.scene().intervalTracks[0],h.scene().depthTracks![0]].forEach((t,index)=>{expect(t.keys).toHaveLength(1);expect(t.keys[0]).toMatchObject(drafts[index]);expect(t.draft).toBeUndefined();});
 expect(h.scene().visibilityTracks).toHaveLength(1);expect(h.scene().warps).toHaveLength(0);
});

test('viewpoint names and deletion affect only bookmarks; old scenes retain omitted-field fallback and Warp creation behavior',()=>{
 const h=harness();expect(h.scene().viewpoints).toBeUndefined();expect(parseRecordingScenes(h.project().recordingScenes).scenes[0].viewpoints).toBeUndefined();expect(sceneOverview(h.project())).toMatchObject({hasExplicitViewpoints:false,viewpoints:[]});
 const created=h.apply({op:'addInstance',artworkId:h.artworkId,ref:'a'},{op:'createWarp',layerRefs:[{instanceId:'$a',sourceLayerId:h.layerId}],ref:'warp'}),warpId=createdId(created,'warp');expect(h.scene().warps[0].keys).toEqual([]);
 h.apply({op:'setAngle',angle:angle(30)},{op:'saveSelected',warpIds:[warpId]});const original=structuredClone(h.scene().warps[0]),viewpointId=createdId(h.apply({op:'createViewpoint',ref:'bookmark'}),'bookmark');
 expect(h.scene().viewpoints![0].angle).toEqual(angle(30));expect(h.scene().warps[0]).toEqual(original);
 h.apply({op:'renameViewpoint',viewpointId,name:' Side '});expect(h.scene().viewpoints![0].name).toBe('Side');
 const deleted=h.apply({op:'deleteViewpoint',viewpointId});expect(deleted.removedIds).toEqual([viewpointId]);expect(h.scene().viewpoints).toEqual([]);expect(h.scene().warps[0]).toEqual(original);expect(sceneOverview(h.project())).toMatchObject({hasExplicitViewpoints:true,viewpoints:[]});
});

test('viewpoint commands and persisted bookmarks strictly reject invalid fields, identities and angles atomically',()=>{
 const h=harness(),viewpointId=createdId(h.apply({op:'createViewpoint',angle:angle(30),ref:'side'}),'side'),before=JSON.stringify(h.project());
 const badCommands=[{op:'createViewpoint',angle:angle(30)},{op:'createViewpoint',angle:angle(91)},{op:'createViewpoint',name:' '},{op:'createViewpoint',angle:{x:1,y:0,z:0}},{op:'createViewpoint',warpIds:[]},{op:'updateViewpoint',viewpointId:'missing'},{op:'updateViewpoint',viewpointId,angle:angle(0)},{op:'renameViewpoint',viewpointId,name:''},{op:'deleteViewpoint',viewpointId:'missing'}];
 for(const command of badCommands)expect(()=>prepareSceneBatch(h.project(),{commands:[{op:'setAngle',angle:angle(45)},command]})).toThrow();
 expect(JSON.stringify(h.project())).toBe(before);
 const original=h.project().recordingScenes!,mutations=[(v:any)=>v.scenes[0].viewpoints[0].unexpected=true,(v:any)=>v.scenes[0].viewpoints[0].angle.x=91,(v:any)=>v.scenes[0].viewpoints[0].name=' ',(v:any)=>v.scenes[0].viewpoints[0].id='',(v:any)=>v.scenes[0].viewpoints.push({...v.scenes[0].viewpoints[0],id:'other'}),(v:any)=>v.scenes[0].viewpoints.push({...v.scenes[0].viewpoints[0],angle:angle(0)}),(v:any)=>v.scenes[0].viewpoints=null];
 for(const mutate of mutations){const value=structuredClone(original);mutate(value);expect(()=>parseRecordingScenes(value)).toThrow();}
});
