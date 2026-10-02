import type {LandmarkProject} from '../domain/landmarks/model';
import {drawingSignature} from '../domain/vectorRecording/model';
import {applySceneCommand,SceneCommandError,sceneCommandNames,type SceneCommand,type SceneCreation} from '../domain/recordingScene/commands';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {emptyRecordingScenes,type RecordingScenes,type Angle} from '../domain/recordingScene/model';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {recordingSceneSources} from './recordingSceneSources';

export {sceneCommandNames};
export type {SceneCommand};
export interface SceneBatch {sceneId?:string;commands:SceneCommand[];expectedRevision?:string;dryRun?:boolean}
export interface SceneQuery {sceneId?:string;instanceIds?:string[];warpIds?:string[];nameIncludes?:string;includeKeyValues?:boolean;expectedRevision?:string}
export class SceneApiError extends Error{constructor(readonly code:string,message:string,readonly commandIndex?:number){super(message);}}
const fail=(code:string,message:string):never=>{throw new SceneApiError(code,message);};
const object=(v:unknown,allowed:readonly string[])=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail('INVALID_REQUEST','Expected a JSON object.');const o=v as Record<string,unknown>,extra=Object.keys(o).filter(k=>!allowed.includes(k));if(extra.length)fail('INVALID_REQUEST',`Unknown fields: ${extra.join(', ')}`);return o;};
const id=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>4096)return fail('INVALID_REQUEST','Expected an ID.');return v;};
const bool=(v:unknown)=>{if(typeof v!=='boolean')fail('INVALID_REQUEST','Expected a boolean.');return v as boolean;};
const list=(v:unknown)=>{if(!Array.isArray(v)||v.length>16384)return fail('INVALID_REQUEST','Expected an ID array.');return v.map(id);};
const allSceneIds=(v:RecordingScenes)=>v.scenes.flatMap(s=>[s.id,...(s.viewpoints??[]).map(v=>v.id),...s.instances.map(i=>i.id),...[...s.warps,...s.visibilityTracks,...s.intervalTracks,...(s.depthTracks??[]),...(s.placementTracks??[])].flatMap(t=>[t.id,...t.keys.map(k=>k.id)])]);

/** UI and AI share this pure, detached, fully validated transaction plan. Mode
 * and expectedRevision are checked by the host/facade before this call. */
export function prepareSceneBatch(project:LandmarkProject,raw:unknown){
 const request=object(raw,['sceneId','commands','expectedRevision','dryRun']);if(request.expectedRevision!==undefined)id(request.expectedRevision);if(request.dryRun!==undefined)bool(request.dryRun);
 if(!Array.isArray(request.commands)||request.commands.length>1000)fail('INVALID_REQUEST','commands must contain at most 1000 items.');
 const before=project.recordingScenes??emptyRecordingScenes(),draft=parseRecordingScenes(before),sources=recordingSceneSources(project),resolve=(id:string)=>Object.hasOwn(sources,id)?sources[id]:undefined;
 const priorActive=draft.activeSceneId;let explicitSelection=false;
 if(request.sceneId!==undefined){const target=id(request.sceneId);if(!draft.scenes.some(s=>s.id===target))fail('NOT_FOUND','Scene does not exist.');draft.activeSceneId=target;}
 const sourceIds=new Set(Object.entries(sources).flatMap(([id,d])=>[id,...[...d.layers,...d.nodes,...d.curves,...d.fills,...d.offsets,...(d.displayIntervals??[]),...(d.displayIntervals??[]).flatMap(t=>t.ranges)].map(x=>x.id)]));
 const refs=new Map<string,string>(),created:Array<SceneCreation&{commandIndex:number}>=[],removedIds:string[]=[],pinResults:unknown[]=[];
 const canonical=(value:string)=>sourceIds.has(value)||allSceneIds(draft).includes(value);
 const dereference=(value:unknown,key=''):unknown=>{if(typeof value==='string'&&/Id$|Ids$/.test(key)&&value.startsWith('$')){if(canonical(value))return value;return refs.get(value.slice(1))??fail('UNKNOWN_REFERENCE',`Unknown batch reference ${value}.`);}if(Array.isArray(value))return value.map(v=>dereference(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,dereference(v,k)]));return value;};
 for(const [index,command] of (request.commands as unknown[]).entries())try{
  const resolved=dereference(command),effects=applySceneCommand(draft,resolved,resolve),op=(resolved as SceneCommand).op;
  if(['createScene','selectScene','deleteScene'].includes(op))explicitSelection=true;
  for(const item of effects.created){if(item.ref!==undefined){if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.ref))fail('INVALID_REQUEST','Invalid batch ref.');if(refs.has(item.ref))fail('DUPLICATE_REFERENCE','Batch refs must be unique.');if(canonical(`$${item.ref}`))fail('REFERENCE_COLLISION','Batch ref collides with a canonical ID.');refs.set(item.ref,item.id);}created.push({...item,commandIndex:index});}
  removedIds.push(...effects.removedIds);pinResults.push(...effects.pinResults);
 }catch(error){const e=error as Error;throw new SceneApiError(e instanceof SceneApiError||e instanceof SceneCommandError?e.code:'CONSTRAINT_VIOLATION',e.message,index);}
 const sceneId=draft.activeSceneId;if(request.sceneId!==undefined&&!explicitSelection)draft.activeSceneId=priorActive;
 const recordingScenes=parseRecordingScenes(draft);return {before,recordingScenes,sceneId,changed:JSON.stringify(before)!==JSON.stringify(recordingScenes),dryRun:request.dryRun===true,created,removedIds:[...new Set(removedIds)],pinResults};
}

export function sceneOverview(project:LandmarkProject,raw:unknown={}){
 const q=object(raw,['sceneId','instanceIds','warpIds','nameIncludes','includeKeyValues','expectedRevision']);if(q.includeKeyValues!==undefined)bool(q.includeKeyValues);if(q.nameIncludes!==undefined&&typeof q.nameIncludes!=='string')fail('INVALID_REQUEST','nameIncludes must be text.');
 const recording=project.recordingScenes??emptyRecordingScenes(),sceneId=q.sceneId===undefined?recording.activeSceneId:id(q.sceneId),scene=recording.scenes.find(s=>s.id===sceneId),sources=recordingSceneSources(project);
 if(q.sceneId!==undefined&&!scene)fail('NOT_FOUND','Scene does not exist.');
 const availableArtworks=Object.entries(sources).map(([artworkId,d])=>({artworkId,name:project.drawingSnapshots?.items.find(a=>a.id===artworkId)?.name??'Current working artwork',sourceSignature:drawingSignature(d),liveWorkingCopy:(project.drawingSnapshots?.activeId??'$working')===artworkId&&!!project.drawing,hasWorkingCopy:Object.hasOwn(project.drawingWorkingCopies??{},artworkId),sourceOrigin:(project.drawingSnapshots?.activeId??'$working')===artworkId&&project.drawing?'activeDrawing':Object.hasOwn(project.drawingWorkingCopies??{},artworkId)?'workingCopy':'checkpoint',layers:d.layers.map(l=>({id:l.id,name:l.name,members:l.items.map(id=>{const item=[...d.curves,...d.fills,...d.offsets].find(x=>x.id===id);return {id,name:item?.name??id,kind:d.curves.some(c=>c.id===id)?'curve':d.fills.some(f=>f.id===id)?'fill':'offset',visible:item?.visible??false,...(d.curves.some(c=>c.id===id)?{inkVisible:d.curves.find(c=>c.id===id)!.inkVisible!==false}:{})};})}))}));
 const summary=recording.scenes.map(s=>({id:s.id,name:s.name,angle:s.angle,viewpointCount:s.viewpoints?.length??0,hasExplicitViewpoints:s.viewpoints!==undefined,instanceCount:s.instances.length,warpCount:s.warps.length,placementTrackCount:s.placementTracks?.length??0}));
 if(!scene)return {exists:false,scenes:summary,availableArtworks,sourceReadOnly:true};
 const instanceIds=q.instanceIds===undefined?undefined:list(q.instanceIds),warpIds=q.warpIds===undefined?undefined:list(q.warpIds),matches=(name:string)=>q.nameIncludes===undefined||name.toLocaleLowerCase().includes(String(q.nameIncludes).toLocaleLowerCase());
 const evaluated=evaluateScene(scene,id=>Object.hasOwn(sources,id)?sources[id]:undefined,{diagnostics:'preview'});
 const track=<T extends {keys:unknown[];draft?:unknown}>(t:T)=>q.includeKeyValues?t:{...t,keys:(t.keys as {id:string;name?:string;angle:Angle}[]).map(k=>({id:k.id,name:k.name,angle:k.angle})),...(t.draft?{draft:{angle:(t.draft as {angle:Angle}).angle}}:{})};
 return structuredClone({exists:true,sceneId:scene.id,name:scene.name,angle:scene.angle,viewpoints:scene.viewpoints??[],hasExplicitViewpoints:scene.viewpoints!==undefined,scenes:summary,availableArtworks,sourceReadOnly:true,
  instances:scene.instances.filter(i=>(!instanceIds||instanceIds.includes(i.id))&&matches(i.name)).map(i=>({...i,currentPlacement:evaluated.placements[i.id],placementTrackId:scene.placementTracks?.find(t=>t.instanceId===i.id)?.id,placementKeyCount:scene.placementTracks?.find(t=>t.instanceId===i.id)?.keys.length??0,layers:evaluated.layers.filter(l=>l.instanceId===i.id),sourceSignature:resolveSignature(i.artworkId),missingSource:!Object.hasOwn(sources,i.artworkId)})),
  warps:scene.warps.filter(w=>(!warpIds||warpIds.includes(w.id))&&matches(w.name)).map(w=>({...track(w),currentGrid:evaluated.warpGrids[w.id],boundLayers:scene.bindings.filter(b=>b.warpId===w.id)})),bindings:scene.bindings,placementTracks:(scene.placementTracks??[]).map(track),visibilityTracks:scene.visibilityTracks.map(track),intervalTracks:scene.intervalTracks.map(track),depthTracks:(scene.depthTracks??[]).map(track),diagnostics:evaluated.diagnostics,hasDraft:[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[])].some(t=>!!t.draft),tolerancePixels:(scene.tolerance??1/250)*250,
 });
 function resolveSignature(artworkId:string){return Object.hasOwn(sources,artworkId)?drawingSignature(sources[artworkId]):null;}
}

export function evaluateRecordingScene(project:LandmarkProject,request:{sceneId?:string;angle?:Angle;useDraft?:boolean;stopAtWarpId?:string}={}){
 const recording=project.recordingScenes??emptyRecordingScenes(),sceneId=request.sceneId??recording.activeSceneId,scene=recording.scenes.find(s=>s.id===sceneId)??fail('NO_SCENE','Create or select a Recording scene first.'),sources=recordingSceneSources(project);
 if(request.stopAtWarpId!==undefined&&!scene.warps.some(w=>w.id===request.stopAtWarpId))fail('NOT_FOUND','Local preview Warp does not exist.');
 if(request.angle&&(!Number.isFinite(request.angle.x)||!Number.isFinite(request.angle.y)||Math.abs(request.angle.x)>90||Math.abs(request.angle.y)>90))fail('INVALID_REQUEST','Angle must be finite in −90…90.');
 const useDraft=request.useDraft??request.angle===undefined,evaluated=evaluateScene(scene,id=>Object.hasOwn(sources,id)?sources[id]:undefined,{...request,useDraft,diagnostics:'full'}),tracks=[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[])],drafts=tracks.filter(t=>t.draft);
 return {...evaluated,sceneId:scene.id,usedDraft:useDraft&&drafts.some(t=>Math.abs(t.draft!.angle.x-evaluated.angle.x)<.00001&&Math.abs(t.draft!.angle.y-evaluated.angle.y)<.00001),hasUnappliedDraft:drafts.some(t=>!useDraft||Math.abs(t.draft!.angle.x-evaluated.angle.x)>=.00001||Math.abs(t.draft!.angle.y-evaluated.angle.y)>=.00001)};
}
