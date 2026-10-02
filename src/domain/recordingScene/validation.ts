import {validateWarpGrid} from '../vectorWarp/model';
import {validateIntervalOverrides} from '../vectorRecording/intervals';
import {sameAngle} from '../vectorRecording/interpolation';
import {sceneLayerKey,type RecordingScene,type RecordingScenes,type SceneTrack,type SceneLayerRef,type Angle,type ScenePlacementValue,type SceneShapeValue} from './model';

const fail=(message:string):never=>{throw Error(`Invalid recording scene: ${message}`);};
const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=4096;
const angle=(a:Angle)=>!!a&&[a.x,a.y].every(n=>Number.isFinite(n)&&n>=-90&&n<=90);
const unique=(values:string[],what:string)=>{if(values.some(v=>!id(v))||new Set(values).size!==values.length)fail(`${what} IDs`);};
const ref=(r:SceneLayerRef)=>{if(!r||!id(r.instanceId)||!id(r.sourceLayerId))fail('layer reference');};
export function validateScenePlacement(value:ScenePlacementValue):void {
 if(!value||!Array.isArray(value.translation)||value.translation.length!==2||value.translation.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6)||!Number.isFinite(value.rotation)||Math.abs(value.rotation)>1e9||!Number.isFinite(value.scale)||value.scale<1e-6||value.scale>1e6)fail('instance placement');
 if([value.scaleX,value.scaleY].some(n=>n!==undefined&&(!Number.isFinite(n)||n<0||n>1e6)))fail('instance axis scale');
}
export function validateSceneShape(value:SceneShapeValue):void {
 const record=(r:unknown)=>!!r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).length<=16384&&Object.keys(r).every(id);
 const point=(p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6);
 if(!value||!record(value.nodes)||!record(value.handles)||Object.values(value.nodes).some(p=>!point(p))||Object.values(value.handles).some(p=>!Array.isArray(p)||p.length!==2||p.some(h=>!point(h))))fail('shape offsets');
}
function track<T>(t:SceneTrack<T>,value:(v:T)=>void){
 if(!Array.isArray(t.keys)||t.keys.length>4096||t.interpolation!==undefined&&!['legacy','independent'].includes(t.interpolation))fail('track');
 unique(t.keys.map(k=>k.id),'key');const coordinates:Angle[]=[];
 for(const k of t.keys){if(!angle(k.angle))fail('key angle');if(coordinates.some(a=>sameAngle(a,k.angle)))fail('duplicate key angle');coordinates.push(k.angle);value(k.value);}
 if(t.draft){if(!angle(t.draft.angle))fail('draft angle');value(t.draft.value);}
}
/** Validate format and the scene's own graph. Missing external source objects
 * remain orphan references for evaluation to report locally and reversibly. */
export function validateScene(scene:RecordingScene):void {
 if(!scene||!id(scene.id)||typeof scene.name!=='string'||!angle(scene.angle)||![scene.instances,scene.warps,scene.bindings,scene.visibilityTracks,scene.intervalTracks,scene.depthTracks??[],scene.placementTracks??[],scene.shapeTracks??[]].every(Array.isArray)||scene.viewpoints!==undefined&&!Array.isArray(scene.viewpoints))fail('scene shape');
 if(scene.tolerance!==undefined&&(!Number.isFinite(scene.tolerance)||scene.tolerance<=0))fail('tolerance');
 if(scene.viewpoints){
  if(scene.viewpoints.length>4096)fail('viewpoint limit');
  unique(scene.viewpoints.map(v=>v?.id),'viewpoint');const coordinates:Angle[]=[];
  for(const viewpoint of scene.viewpoints){if(typeof viewpoint.name!=='string'||!viewpoint.name.trim()||viewpoint.name.length>256||!angle(viewpoint.angle))fail('viewpoint');if(coordinates.some(a=>sameAngle(a,viewpoint.angle)))fail('duplicate viewpoint angle');coordinates.push(viewpoint.angle);}
 }
 unique(scene.instances.map(i=>i.id),'instance');unique(scene.warps.map(w=>w.id),'warp');
 const instances=new Set(scene.instances.map(i=>i.id)),instanceRef=(instanceId:string)=>{if(!instances.has(instanceId))fail('missing scene instance');};
 unique([...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[]),...(scene.shapeTracks??[])].map(t=>t.id),'object track');
 for(const instance of scene.instances){if(!id(instance.artworkId)||typeof instance.name!=='string')fail('instance');if(instance.layerIds)unique(instance.layerIds,'instance layer');}
 const warps=new Map(scene.warps.map(w=>[w.id,w]));
 for(const warp of scene.warps){
  validateWarpGrid(warp.restGrid);
  const topology=JSON.stringify([warp.restGrid.rows,warp.restGrid.columns,warp.restGrid.bounds]);
  track(warp,grid=>{validateWarpGrid(grid);if(JSON.stringify([grid.rows,grid.columns,grid.bounds])!==topology)fail('warp key rest domain changed');});
  const visited=new Set<string>();let current:typeof warp|undefined=warp;
  while(current){if(visited.has(current.id))fail('warp parent cycle');visited.add(current.id);if(current.parentId&&!warps.has(current.parentId))fail('missing warp parent');current=current.parentId?warps.get(current.parentId):undefined;}
 }
 const leaves=new Set<string>();for(const binding of scene.bindings){ref(binding);instanceRef(binding.instanceId);if(!warps.has(binding.warpId))fail('missing bound warp');const key=sceneLayerKey(binding);if(leaves.has(key))fail('multiple leaf bindings for one layer');leaves.add(key);}
 const visibility=new Set<string>();for(const t of scene.visibilityTracks){ref(t.target);instanceRef(t.target.instanceId);if(t.target.sourceObjectId!==undefined&&!id(t.target.sourceObjectId))fail('object reference');const key=JSON.stringify([t.target.instanceId,t.target.sourceLayerId,t.target.sourceObjectId??null]);if(visibility.has(key))fail('duplicate visibility target');visibility.add(key);track(t,v=>{if(v!==null&&typeof v!=='boolean')fail('visibility key');});}
 const intervals=new Set<string>();for(const t of scene.intervalTracks){
  if(!id(t.instanceId)||!id(t.sourceTrackId))fail('interval reference');instanceRef(t.instanceId);const key=JSON.stringify([t.instanceId,t.sourceTrackId]);if(intervals.has(key))fail('duplicate interval target');intervals.add(key);
  if(t.materialIssue&&(!id(t.materialIssue.sourceSignature)||typeof t.materialIssue.message!=='string'))fail('interval material issue');
  track(t,v=>{if(!v||v.appearance!==null&&!v.appearance||!v.enabled||typeof v.enabled!=='object'||Array.isArray(v.enabled)||Object.entries(v.enabled).some(([k,b])=>!id(k)||typeof b!=='boolean'))fail('interval value');if(v.appearance){if(v.appearance.id!==t.sourceTrackId)fail('interval target mismatch');validateIntervalOverrides([v.appearance]);}});
 }
 const depths=new Set<string>();for(const t of scene.depthTracks??[]){ref(t.target);instanceRef(t.target.instanceId);const key=sceneLayerKey(t.target);if(depths.has(key))fail('duplicate depth target');depths.add(key);track(t,n=>{if(!Number.isFinite(n)||Math.abs(n)>10000)fail('layer depth');});}
 const placements=new Set<string>();for(const t of scene.placementTracks??[]){if(!id(t.instanceId))fail('placement reference');instanceRef(t.instanceId);if(placements.has(t.instanceId))fail('duplicate placement target');placements.add(t.instanceId);track(t,validateScenePlacement);}
 const shapes=new Set<string>();for(const t of scene.shapeTracks??[]){if(!id(t.instanceId))fail('shape reference');instanceRef(t.instanceId);if(shapes.has(t.instanceId))fail('duplicate shape target');shapes.add(t.instanceId);track(t,validateSceneShape);}
}
export function validateRecordingScenes(value:RecordingScenes):void {
 if(!value||value.version!==1||!Array.isArray(value.scenes))fail('container');unique(value.scenes.map(s=>s.id),'scene');
 if(value.activeSceneId!==undefined&&!value.scenes.some(s=>s.id===value.activeSceneId))fail('active scene');for(const scene of value.scenes)validateScene(scene);
}
