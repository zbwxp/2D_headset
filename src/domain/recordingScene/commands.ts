import {uid,validInkEnds,type Point2,type TerminusBrushStyle,type DisplayIntervalMode,type DrawingDocument} from '../drawing/model';
import {changeDisplayInterval,setDisplayIntervalEnd} from '../drawing/displayIntervals';
import {planArtworkLayerImport} from '../drawing/importArtworkLayers';
import {createWarpGrid,moveWarpNode,validateWarpGrid,type WarpGrid} from '../vectorWarp/model';
import {pinWarpPoint} from '../vectorWarp/constraints';
import {warpPatchControlPoints} from '../vectorWarp/evaluation';
import {sameAngle} from '../vectorRecording/interpolation';
import {drawingSignature,sourceIntervalFrames} from '../vectorRecording/model';
import {sourceStructureSignature} from '../vectorRecording/sourceCompatibility';
import {applyIntervalOverrides} from '../vectorRecording/intervals';
import {emptyRecordingScene,identityScenePlacement,sceneLayerKey,layerTrackIds,type Angle,type SceneLayerRef,type SceneObjectRef,type RecordingScenes,type RecordingScene,type SceneSourceResolver,type SceneWarp,type SceneTrack,type SceneIntervalTrack,type SceneIntervalValue,type ScenePlacementTrack,type ScenePlacementValue} from './model';
import {evaluateWarpTrack,evaluateVisibilityTrack,evaluateIntervalTrack,evaluateDepthTrack,evaluatePlacementTrack} from './tracks';
import {validateRecordingScenes} from './validation';

export interface SceneSelection {instanceIds?:string[];warpIds?:string[];layerRefs?:SceneLayerRef[]}
export interface SceneWarpDimensions {name?:string;rows?:number;columns?:number;ref?:string}
export type SceneCommand=
 | {op:'createScene';name:string;ref?:string}
 | {op:'selectScene';sceneId:string}
 | {op:'renameScene';sceneId:string;name:string}
 | {op:'deleteScene';sceneId:string}
 | {op:'createViewpoint';name?:string;angle?:Angle;ref?:string}
 | {op:'updateViewpoint';viewpointId:string}
 | {op:'renameViewpoint';viewpointId:string;name:string}
 | {op:'deleteViewpoint';viewpointId:string}
 | {op:'addInstance';artworkId:string;name?:string;sourceLayerIds?:string[];ref?:string}
 | {op:'renameInstance';instanceId:string;name:string}
 | {op:'removeInstance';instanceId:string}
 | {op:'setInstanceLayers';instanceId:string;sourceLayerIds:string[]|null}
 | {op:'setInstancePlacement';instanceId:string;value:ScenePlacementValue}
 | ({op:'createWarp';layerRefs:SceneLayerRef[]}&SceneWarpDimensions)
 | ({op:'wrapParent';warpIds:string[]}&SceneWarpDimensions)
 | ({op:'createChild';parentWarpId:string;layerRefs:SceneLayerRef[]}&SceneWarpDimensions)
 | {op:'rebindLayers';layerRefs:SceneLayerRef[];warpId:string|null}
 | {op:'setWarp';warpId:string;name?:string;parentId?:string|null}
 | {op:'deleteWarp';warpId:string}
 | {op:'editWarpNodes';warpId:string;edits:{index:number;position?:Point2;handleU?:Point2;handleV?:Point2;twist?:Point2}[];moveHandles?:boolean}
 | {op:'pinWarpPoint';warpId:string;sourcePoint:Point2;targetPoint:Point2}
 | {op:'setAngle';angle:Angle}
 | ({op:'saveSelected';name?:string}&SceneSelection)
 | ({op:'discardSelected'}&SceneSelection)
 | {op:'renameKey';trackId:string;keyId:string;name:string}
 | {op:'deleteKey';trackId:string;keyId:string}
 | {op:'setVisibility';target:SceneObjectRef;visible:boolean|null;ref?:string}
 | {op:'changeInterval';instanceId:string;sourceTrackId:string;rangeId:string;mode?:DisplayIntervalMode;start?:number;end?:number;fullLoop?:boolean;ref?:string}
 | {op:'setIntervalEnd';instanceId:string;sourceTrackId:string;rangeId:string;end:0|1;style:TerminusBrushStyle;ref?:string}
 | {op:'setIntervalEnabled';instanceId:string;sourceTrackId:string;rangeId:string;enabled:boolean;ref?:string}
 | {op:'setLayerOrder';target:SceneLayerRef;value:number;ref?:string}
 | {op:'setTolerance';pixels:number}
 | {op:'cleanupUnused';removeUnboundWarps?:boolean};

export const sceneCommandNames:SceneCommand['op'][]=['createScene','selectScene','renameScene','deleteScene','createViewpoint','updateViewpoint','renameViewpoint','deleteViewpoint','addInstance','renameInstance','removeInstance','setInstanceLayers','setInstancePlacement','createWarp','wrapParent','createChild','rebindLayers','setWarp','deleteWarp','editWarpNodes','pinWarpPoint','setAngle','saveSelected','discardSelected','renameKey','deleteKey','setVisibility','changeInterval','setIntervalEnd','setIntervalEnabled','setLayerOrder','setTolerance','cleanupUnused'];

export class SceneCommandError extends Error{constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SceneCommandError(code,message);};
const clone=<T,>(value:T):T=>structuredClone(value);
const object=(value:unknown,allowed:readonly string[]):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('INVALID_REQUEST','Expected a JSON object.');const o=value as Record<string,unknown>,extra=Object.keys(o).filter(k=>!allowed.includes(k));if(extra.length)fail('INVALID_REQUEST',`Unknown fields: ${extra.join(', ')}`);return o;};
const id=(v:unknown,label='id'):string=>{if(typeof v!=='string'||!v||v.length>4096)return fail('INVALID_REQUEST',`${label} must be a nonempty ID.`);return v;};
const name=(v:unknown):string=>{if(typeof v!=='string'||!v.trim()||v.length>256)return fail('INVALID_REQUEST','name must contain 1–256 characters.');return v.trim();};
const number=(v:unknown,label:string,min=-10000,max=10000):number=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)return fail('INVALID_REQUEST',`${label} must be finite in ${min}…${max}.`);return v;};
const bool=(v:unknown):boolean=>{if(typeof v!=='boolean')return fail('INVALID_REQUEST','Expected a boolean.');return v;};
const point=(v:unknown):Point2=>{if(!Array.isArray(v)||v.length!==2)return fail('INVALID_REQUEST','Expected [x,y].');return [number(v[0],'x'),number(v[1],'y')];};
const ids=(v:unknown,empty=false):string[]=>{if(!Array.isArray(v)||v.length>16384||!empty&&!v.length)return fail('INVALID_REQUEST','Expected a nonempty ID array.');const out=v.map(x=>id(x));if(new Set(out).size!==out.length)fail('INVALID_REQUEST','IDs must be unique.');return out;};
const placement=(v:unknown):ScenePlacementValue=>{const p=object(v,['translation','rotation','scale']);if(!Array.isArray(p.translation)||p.translation.length!==2)fail('INVALID_REQUEST','translation must be [x,y].');const translation=p.translation as unknown[];return {translation:[number(translation[0],'translation.x',-1e6,1e6),number(translation[1],'translation.y',-1e6,1e6)],rotation:number(p.rotation,'rotation',-1e9,1e9),scale:number(p.scale,'scale',1e-6,1e6)};};
const angle=(v:unknown):Angle=>{const a=object(v,['x','y']);return {x:number(a.x,'angle.x',-90,90),y:number(a.y,'angle.y',-90,90)};};
const fields:Record<SceneCommand['op'],string[]>={createScene:['name','ref'],selectScene:['sceneId'],renameScene:['sceneId','name'],deleteScene:['sceneId'],createViewpoint:['name','angle','ref'],updateViewpoint:['viewpointId'],renameViewpoint:['viewpointId','name'],deleteViewpoint:['viewpointId'],addInstance:['artworkId','name','sourceLayerIds','ref'],renameInstance:['instanceId','name'],removeInstance:['instanceId'],setInstanceLayers:['instanceId','sourceLayerIds'],setInstancePlacement:['instanceId','value'],createWarp:['layerRefs','name','rows','columns','ref'],wrapParent:['warpIds','name','rows','columns','ref'],createChild:['parentWarpId','layerRefs','name','rows','columns','ref'],rebindLayers:['layerRefs','warpId'],setWarp:['warpId','name','parentId'],deleteWarp:['warpId'],editWarpNodes:['warpId','edits','moveHandles'],pinWarpPoint:['warpId','sourcePoint','targetPoint'],setAngle:['angle'],saveSelected:['instanceIds','warpIds','layerRefs','name'],discardSelected:['instanceIds','warpIds','layerRefs'],renameKey:['trackId','keyId','name'],deleteKey:['trackId','keyId'],setVisibility:['target','visible','ref'],changeInterval:['instanceId','sourceTrackId','rangeId','mode','start','end','fullLoop','ref'],setIntervalEnd:['instanceId','sourceTrackId','rangeId','end','style','ref'],setIntervalEnabled:['instanceId','sourceTrackId','rangeId','enabled','ref'],setLayerOrder:['target','value','ref'],setTolerance:['pixels'],cleanupUnused:['removeUnboundWarps']};
export interface SceneCreation{kind:'scene'|'viewpoint'|'instance'|'warp'|'visibilityTrack'|'intervalTrack'|'depthTrack'|'placementTrack'|'key';id:string;ref?:string;created:boolean}
export interface SceneCommandEffects{created:SceneCreation[];removedIds:string[];pinResults:unknown[]}

/** Mutate only a caller-owned detached draft. prepareSceneBatch is the pure
 * transaction boundary shared by UI and AI; no store/source writes occur here. */
export function applySceneCommand(draft:RecordingScenes,raw:unknown,resolve:SceneSourceResolver):SceneCommandEffects{
 const c=object(raw,['op',...new Set(Object.values(fields).flat())]),op=c.op as SceneCommand['op'];
 if(!Object.hasOwn(fields,op))fail('UNKNOWN_COMMAND',`Unknown scene command: ${String(op)}`);object(c,['op',...fields[op]]);
 const effects:SceneCommandEffects={created:[],removedIds:[],pinResults:[]};
 const occupied=new Set(draft.scenes.flatMap(s=>[s.id,...(s.viewpoints??[]).map(v=>v.id),...s.instances.map(i=>i.id),...[...s.warps,...s.visibilityTracks,...s.intervalTracks,...(s.depthTracks??[]),...(s.placementTracks??[])].flatMap(t=>[t.id,...t.keys.map(k=>k.id)])]));
 const fresh=()=>{for(let i=0;i<32;i++){const value=uid();if(!occupied.has(value)){occupied.add(value);return value;}}return fail('ID_COLLISION','Unable to allocate a fresh scene ID.');};
 const created=(kind:SceneCreation['kind'],entityId:string,isNew=true)=>effects.created.push({kind,id:entityId,created:isNew,...(c.ref===undefined?{}:{ref:id(c.ref,'ref')})});
 const findScene=(value:unknown)=>draft.scenes.find(s=>s.id===id(value,'sceneId'))??fail('NOT_FOUND','Scene does not exist.');
 if(op==='createScene'){const scene=emptyRecordingScene(fresh(),name(c.name));draft.scenes.push(scene);draft.activeSceneId=scene.id;created('scene',scene.id);return effects;}
 if(op==='selectScene'){draft.activeSceneId=findScene(c.sceneId).id;return effects;}
 if(op==='renameScene'){findScene(c.sceneId).name=name(c.name);return effects;}
 if(op==='deleteScene'){const s=findScene(c.sceneId);draft.scenes=draft.scenes.filter(x=>x!==s);if(draft.activeSceneId===s.id)draft.activeSceneId=draft.scenes[0]?.id;effects.removedIds.push(s.id);return effects;}
 const scene=draft.scenes.find(s=>s.id===draft.activeSceneId)??fail('NO_SCENE','Create or select a Recording scene first.');
 const viewpoint=(value:unknown)=>{const viewpointId=id(value,'viewpointId');return (scene.viewpoints??[]).find(v=>v.id===viewpointId)??fail('NOT_FOUND','Viewpoint does not exist.');};
 const instance=(value:unknown)=>scene.instances.find(i=>i.id===id(value,'instanceId'))??fail('NOT_FOUND','Instance does not exist.');
 const source=(value:unknown)=>{const i=instance(value),d=resolve(i.artworkId);if(!d)return fail('MISSING_SOURCE',`Missing source artwork: ${i.artworkId}`);return d;};
 const completeLayers=(d:DrawingDocument,selected:string[])=>{const plan=planArtworkLayerImport(d,selected);if(plan.additionalLayerIds.length)fail('LAYER_DEPENDENCIES',`Also select dependent source layers: ${plan.additionalLayerIds.map(id=>d.layers.find(l=>l.id===id)!.name).join(', ')}.`);return selected;};
 const warp=(value:unknown)=>scene.warps.find(w=>w.id===id(value,'warpId'))??fail('NOT_FOUND','Warp does not exist.');
 const ref=(value:unknown,withObject=false):SceneObjectRef=>{const r=object(value,withObject?['instanceId','sourceLayerId','sourceObjectId']:['instanceId','sourceLayerId']),i=instance(r.instanceId),d=source(i.id),layerId=id(r.sourceLayerId,'sourceLayerId'),layer=d.layers.find(l=>l.id===layerId);if(!layer||i.layerIds&&!i.layerIds.includes(layerId))return fail('MISSING_LAYER','The source layer is absent or not included by this instance.');const objectId=r.sourceObjectId===undefined?undefined:id(r.sourceObjectId,'sourceObjectId');if(objectId&&!layer.items.includes(objectId))return fail('MISSING_OBJECT','The source object is not owned by this layer.');return {instanceId:i.id,sourceLayerId:layerId,...(objectId?{sourceObjectId:objectId}:{})};};
 const refs=(value:unknown):SceneLayerRef[]=>{if(!Array.isArray(value)||!value.length||value.length>16384)return fail('INVALID_REQUEST','Provide nonempty layerRefs.');const out=value.map(r=>ref(r));if(new Set(out.map(sceneLayerKey)).size!==out.length)fail('INVALID_REQUEST','Layer references must be unique.');return out;};
 const bounds=(selected:SceneLayerRef[])=>{const points:Point2[]=[];for(const r of selected){const d=source(r.instanceId),layer=d.layers.find(l=>l.id===r.sourceLayerId)!;for(const curve of d.curves.filter(c=>layer.items.includes(c.id))){for(const nodeId of curve.nodes){const node=d.nodes.find(n=>n.id===nodeId);if(node)points.push(node.position);}points.push(...curve.handles);}}if(!points.length)return {min:[-1,-1] as Point2,max:[1,1] as Point2};const min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))],pad=Math.max(max[0]-min[0],max[1]-min[1],.1)*.08;return {min:[min[0]-pad,min[1]-pad] as Point2,max:[max[0]+pad,max[1]+pad] as Point2};};
 const dimensions=()=>{const rows=c.rows===undefined?3:number(c.rows,'rows',1,16),columns=c.columns===undefined?3:number(c.columns,'columns',1,16);if(!Number.isInteger(rows)||!Number.isInteger(columns))fail('INVALID_REQUEST','Grid subdivisions must be integers.');return {rows,columns};};
 const newWarp=(b:WarpGrid['bounds'],parentId?:string)=>{
  const {rows,columns}=dimensions(),w:SceneWarp={id:fresh(),name:c.name===undefined?`Warp ${scene.warps.length+1}`:name(c.name),restGrid:createWarpGrid(b,rows,columns),keys:[],...(parentId?{parentId}:{})};scene.warps.push(w);created('warp',w.id);
  // Existing views stay neutral for this new control, even at nonzero angles.
  // Do not sample or add keys to any pre-existing object.
  for(const v of scene.viewpoints??[]){const key={id:fresh(),angle:clone(v.angle),value:clone(w.restGrid)};w.keys.push(key);effects.created.push({kind:'key',id:key.id,created:true});}
  return w;
 };
 const writable=(t:{draft?:{angle:Angle}})=>{if(t.draft&&!sameAngle(t.draft.angle,scene.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','This object has a draft at another angle. Return to that angle or explicitly discard its draft.');};
 const setDraft=<T,>(t:SceneTrack<T>,value:T)=>{writable(t);t.draft={angle:clone(scene.angle),value:clone(value)};};
 const tracks=()=>[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[])];
 const writableLayer=(r:SceneLayerRef)=>{const selected=new Set(layerTrackIds(scene,r,resolve));for(const t of tracks())if(selected.has(t.id))writable(t);};
 const ensurePlacement=(instanceId:string):ScenePlacementTrack=>{
  scene.placementTracks??=[];const existing=scene.placementTracks.find(t=>t.instanceId===instanceId);if(existing)return existing;
  const track:ScenePlacementTrack={id:fresh(),instanceId,keys:[]};scene.placementTracks.push(track);created('placementTrack',track.id);
  // Established viewpoints stay neutral when this instance first gets a pose.
  for(const v of scene.viewpoints??[]){const key={id:fresh(),angle:clone(v.angle),value:identityScenePlacement()};track.keys.push(key);effects.created.push({kind:'key',id:key.id,created:true});}
  return track;
 };
 const selectedTracks=()=>{const instances=c.instanceIds===undefined?[]:ids(c.instanceIds,true).map(id=>instance(id)),warps=c.warpIds===undefined?[]:ids(c.warpIds,true).map(id=>warp(id)),layers=c.layerRefs===undefined?[]:refs(c.layerRefs);if(!instances.length&&!warps.length&&!layers.length)fail('INVALID_REQUEST','Select explicit instanceIds, warpIds and/or layerRefs.');const selected=new Set([...instances.flatMap(i=>(scene.placementTracks??[]).filter(t=>t.instanceId===i.id).map(t=>t.id)),...warps.map(w=>w.id),...layers.flatMap(r=>layerTrackIds(scene,r,resolve))]);return {items:tracks().filter(t=>selected.has(t.id)),instances,layers};};
 const poseValue=(t:ReturnType<typeof tracks>[number]):unknown=>{if(scene.warps.includes(t as SceneWarp))return evaluateWarpTrack(t as SceneWarp,scene.angle);if(scene.placementTracks?.includes(t as ScenePlacementTrack))return evaluatePlacementTrack(t as ScenePlacementTrack,scene.angle);if(scene.visibilityTracks.includes(t as typeof scene.visibilityTracks[number]))return evaluateVisibilityTrack(t as typeof scene.visibilityTracks[number],scene.angle);if(scene.intervalTracks.includes(t as SceneIntervalTrack)){const it=t as SceneIntervalTrack,d=source(it.instanceId);if(it.materialIssue&&it.materialIssue.sourceSignature!==drawingSignature(d))fail('SOURCE_MATERIAL','This interval channel awaits a valid source-material mapping.');return evaluateIntervalTrack(it,d,scene.angle);}return evaluateDepthTrack(t as NonNullable<typeof scene.depthTracks>[number],scene.angle);};
 switch(op){
  case 'createViewpoint':{const at=c.angle===undefined?clone(scene.angle):angle(c.angle),label=c.name===undefined?`Viewpoint ${(scene.viewpoints?.length??0)+1}`:name(c.name);if(scene.viewpoints?.some(v=>sameAngle(v.angle,at)))fail('VIEWPOINT_EXISTS','A viewpoint already exists at this angle.');const v={id:fresh(),name:label,angle:at};(scene.viewpoints??=[]).push(v);scene.angle=clone(at);created('viewpoint',v.id);break;}
  case 'updateViewpoint':{
   const v=viewpoint(c.viewpointId);scene.angle=clone(v.angle);
   for(const raw of tracks()){
    const t=raw as SceneTrack<unknown>&{id:string};if(!t.draft||!sameAngle(t.draft.angle,v.angle))continue;
    const value=clone(poseValue(raw)),old=t.keys.find(k=>sameAngle(k.angle,v.angle)),key={id:old?.id??fresh(),angle:clone(v.angle),value,...(old?.name?{name:old.name}:{})};
    t.keys=old?t.keys.map(k=>k===old?key:k):[...t.keys,key];delete t.draft;effects.created.push({kind:'key',id:key.id,created:!old});
   }
   break;
  }
  case 'renameViewpoint':viewpoint(c.viewpointId).name=name(c.name);break;
  case 'deleteViewpoint':{const v=viewpoint(c.viewpointId);scene.viewpoints=scene.viewpoints!.filter(item=>item!==v);effects.removedIds.push(v.id);break;}
  case 'addInstance':{const artworkId=id(c.artworkId,'artworkId'),d=resolve(artworkId);if(!d)fail('MISSING_SOURCE','The source artwork does not exist.');const layerIds=c.sourceLayerIds===undefined?undefined:completeLayers(d!,ids(c.sourceLayerIds,true));const i={id:fresh(),artworkId,name:c.name===undefined?artworkId:name(c.name),...(layerIds?{layerIds}:{}),sourceSignature:drawingSignature(d!),sourceStructureSignature:sourceStructureSignature(d!),sourceIntervalFrames:sourceIntervalFrames(d!)};scene.instances.push(i);created('instance',i.id);break;}
  case 'renameInstance':instance(c.instanceId).name=name(c.name);break;
  case 'removeInstance':{const i=instance(c.instanceId);scene.instances=scene.instances.filter(x=>x!==i);scene.bindings=scene.bindings.filter(b=>b.instanceId!==i.id);scene.visibilityTracks=scene.visibilityTracks.filter(t=>t.target.instanceId!==i.id);scene.intervalTracks=scene.intervalTracks.filter(t=>t.instanceId!==i.id);scene.depthTracks=scene.depthTracks?.filter(t=>t.target.instanceId!==i.id);if(scene.placementTracks)scene.placementTracks=scene.placementTracks.filter(t=>t.instanceId!==i.id);effects.removedIds.push(i.id);break;}
  case 'setInstanceLayers':{const i=instance(c.instanceId);if(c.sourceLayerIds===null)delete i.layerIds;else i.layerIds=completeLayers(source(i.id),ids(c.sourceLayerIds,true));break;}
  case 'setInstancePlacement':{const i=instance(c.instanceId),value=placement(c.value),track=ensurePlacement(i.id);setDraft(track,value);break;}
  case 'createWarp':{const selected=refs(c.layerRefs),keys=new Set(selected.map(sceneLayerKey));if(scene.bindings.some(b=>keys.has(sceneLayerKey(b))))fail('ALREADY_BOUND','Create shared Warp requires unbound layers. Use wrapParent, createChild or explicit rebindLayers for existing controls.');const w=newWarp(bounds(selected));scene.bindings.push(...selected.map(r=>({...r,warpId:w.id})));break;}
  case 'createChild':{const parent=warp(c.parentWarpId),selected=refs(c.layerRefs),keys=new Set(selected.map(sceneLayerKey));if(selected.some(r=>scene.bindings.find(b=>sceneLayerKey(b)===sceneLayerKey(r))?.warpId!==parent.id))fail('NOT_DIRECT_PARENT','A child Warp can take only layers directly bound to its parent.');const child=newWarp(bounds(selected),parent.id);scene.bindings=scene.bindings.map(b=>keys.has(sceneLayerKey(b))?{...b,warpId:child.id}:b);break;}
  case 'wrapParent':{const children=ids(c.warpIds).map(id=>warp(id)),parentId=children[0].parentId;if(children.some(w=>w.parentId!==parentId))fail('PARENT_MISMATCH','Selected Warps must share the same immediate parent to be wrapped.');const grids=children.flatMap(w=>[w.restGrid,evaluateWarpTrack(w,scene.angle),...w.keys.map(k=>k.value),...(w.draft?[w.draft.value]:[])]),points=grids.flatMap(g=>[g.bounds.min,g.bounds.max,...g.nodes.flatMap(n=>[n.position,n.handleU,n.handleV]),...Array.from({length:g.rows*g.columns},(_,i)=>warpPatchControlPoints(g,Math.floor(i/g.columns),i%g.columns)).flat()]),min:Point2=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:Point2=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))],w=newWarp({min,max},parentId);children.forEach(child=>child.parentId=w.id);break;}
  case 'rebindLayers':{const selected=refs(c.layerRefs),keys=new Set(selected.map(sceneLayerKey)),target=c.warpId===null?null:warp(c.warpId);scene.bindings=scene.bindings.filter(b=>!keys.has(sceneLayerKey(b)));if(target)scene.bindings.push(...selected.map(r=>({...r,warpId:target.id})));break;}
  case 'setWarp':{const w=warp(c.warpId);if(c.name===undefined&&c.parentId===undefined)fail('INVALID_REQUEST','Provide a name or explicit parentId.');if(c.name!==undefined)w.name=name(c.name);if(c.parentId!==undefined){if(c.parentId===null)delete w.parentId;else w.parentId=warp(c.parentId).id;}break;}
  case 'deleteWarp':{const w=warp(c.warpId);scene.warps=scene.warps.filter(x=>x!==w).map(child=>child.parentId===w.id?{...child,parentId:w.parentId}:child);scene.bindings=scene.bindings.flatMap(b=>b.warpId!==w.id?[b]:w.parentId?[{...b,warpId:w.parentId}]:[]);effects.removedIds.push(w.id);break;}
  case 'editWarpNodes':{const w=warp(c.warpId);writable(w);let grid=clone(evaluateWarpTrack(w,scene.angle));const follow=c.moveHandles===undefined?true:bool(c.moveHandles);if(!Array.isArray(c.edits)||!c.edits.length||c.edits.length>grid.nodes.length)fail('INVALID_REQUEST','Provide 1…node-count unique edits.');const seen=new Set<number>();for(const raw of c.edits as unknown[]){const e=object(raw,['index','position','handleU','handleV','twist']),i=number(e.index,'index',0,grid.nodes.length-1);if(!Number.isInteger(i)||seen.has(i))fail('INVALID_REQUEST','Node indices must be unique integers.');seen.add(i);if(!['position','handleU','handleV','twist'].some(k=>e[k]!==undefined))fail('INVALID_REQUEST','Each edit needs a position or handle value.');if(e.position!==undefined)grid=moveWarpNode(grid,i,point(e.position),follow);for(const key of ['handleU','handleV','twist'] as const)if(e[key]!==undefined)grid.nodes[i][key]=point(e[key]);}validateWarpGrid(grid);setDraft(w,grid);break;}
  case 'pinWarpPoint':{const w=warp(c.warpId);writable(w);const parent=w.parentId?warp(w.parentId):undefined,result=pinWarpPoint(evaluateWarpTrack(w,scene.angle),{sourcePoint:point(c.sourcePoint),targetPoint:point(c.targetPoint),gridParentId:parent?.id??null,targetParentId:parent?.id??null,...(parent?{parentBounds:parent.restGrid.bounds}:{})});setDraft(w,result.grid);const {grid,...report}=result;void grid;effects.pinResults.push({warpId:w.id,angle:clone(scene.angle),...report});break;}
  case 'setAngle':scene.angle=angle(c.angle);break;
  case 'saveSelected':{const selection=selectedTracks();for(const i of selection.instances){const t=ensurePlacement(i.id);if(!selection.items.includes(t))selection.items.push(t);}for(const r of selection.layers)if(!selection.items.some(t=>scene.visibilityTracks.includes(t as typeof scene.visibilityTracks[number])&&sceneLayerKey((t as typeof scene.visibilityTracks[number]).target)===sceneLayerKey(r))){const t={id:fresh(),target:r,keys:[]};scene.visibilityTracks.push(t);selection.items.push(t);created('visibilityTrack',t.id);}for(const raw of selection.items){const t=raw as SceneTrack<unknown>&{id:string};writable(t);const value=clone(poseValue(raw)),old=t.keys.find(k=>sameAngle(k.angle,scene.angle)),key={id:old?.id??fresh(),angle:clone(scene.angle),value,...(c.name!==undefined?{name:name(c.name)}:old?.name?{name:old.name}:{})};t.keys=old?t.keys.map(k=>k===old?key:k):[...t.keys,key];delete t.draft;effects.created.push({kind:'key',id:key.id,created:!old});}break;}
  case 'discardSelected':for(const t of selectedTracks().items)delete t.draft;break;
  case 'renameKey':case 'deleteKey':{const t=tracks().find(t=>t.id===id(c.trackId,'trackId'))??fail('NOT_FOUND','Track does not exist.'),key=t.keys.find(k=>k.id===id(c.keyId,'keyId'))??fail('NOT_FOUND','Key does not exist on this track.');if(op==='renameKey')key.name=name(c.name);else{t.keys=t.keys.filter(k=>k!==key) as typeof t.keys;effects.removedIds.push(key.id);}break;}
  case 'setVisibility':{const target=ref(c.target,true);writableLayer(target);const visible=c.visible===null?null:bool(c.visible);let t=scene.visibilityTracks.find(t=>t.target.instanceId===target.instanceId&&t.target.sourceLayerId===target.sourceLayerId&&t.target.sourceObjectId===target.sourceObjectId);const isNew=!t;if(!t){t={id:fresh(),target,keys:[]};scene.visibilityTracks.push(t);}setDraft(t,visible);created('visibilityTrack',t.id,isNew);break;}
  case 'changeInterval':case 'setIntervalEnd':case 'setIntervalEnabled':{const i=instance(c.instanceId),d=source(i.id),sourceTrackId=id(c.sourceTrackId,'sourceTrackId'),base=d.displayIntervals?.find(t=>t.id===sourceTrackId)??fail('MISSING_INTERVAL','The source interval track does not exist.');const owner=d.layers.find(l=>l.items.includes(base.anchor.id))!;writableLayer(ref({instanceId:i.id,sourceLayerId:owner.id}));let t=scene.intervalTracks.find(t=>t.instanceId===i.id&&t.sourceTrackId===sourceTrackId);const isNew=!t;if(!t){t={id:fresh(),instanceId:i.id,sourceTrackId,keys:[]};scene.intervalTracks.push(t);}writable(t);if(t.materialIssue&&t.materialIssue.sourceSignature!==drawingSignature(d))fail('SOURCE_MATERIAL','Restore or explicitly repair the source material mapping before editing this interval channel.');const value:SceneIntervalValue=clone(evaluateIntervalTrack(t,d,scene.angle)),appearance=value.appearance??base,rangeId=id(c.rangeId,'rangeId');if(!appearance.ranges.some(r=>r.id===rangeId))fail('NOT_FOUND','Range does not exist in this current track appearance.');
   if(op==='setIntervalEnabled')value.enabled={...value.enabled,[rangeId]:bool(c.enabled)};
   else{const doc=applyIntervalOverrides(d,[appearance]);let changed:DrawingDocument;if(op==='setIntervalEnd'){if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');const style=object(c.style,['taper','taperWidthScale','extension','interior']);if(!validInkEnds([style,{}]))fail('INVALID_REQUEST','Invalid terminal brush.');changed=setDisplayIntervalEnd(doc,sourceTrackId,rangeId,c.end as 0|1,style as TerminusBrushStyle);}else{if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');const patch={...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.start===undefined?{}:{start:number(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:number(c.end,'end',0,1)}),...(c.fullLoop===undefined?{}:{fullLoop:bool(c.fullLoop)})};if(!Object.keys(patch).length)fail('INVALID_REQUEST','Provide an interval property.');changed=changeDisplayInterval(doc,sourceTrackId,rangeId,patch);}value.appearance=clone(changed.displayIntervals!.find(t=>t.id===sourceTrackId)!);}setDraft(t,value);created('intervalTrack',t.id,isNew);break;}
  case 'setLayerOrder':{const target=ref(c.target);writableLayer(target);const value=number(c.value,'value');scene.depthTracks??=[];let t=scene.depthTracks.find(t=>sceneLayerKey(t.target)===sceneLayerKey(target));const isNew=!t;if(!t){t={id:fresh(),target,keys:[]};scene.depthTracks.push(t);}setDraft(t,value);created('depthTrack',t.id,isNew);break;}
  case 'setTolerance':scene.tolerance=number(c.pixels,'pixels',.1,20)/250;break;
  case 'cleanupUnused':{if(c.removeUnboundWarps!==undefined)bool(c.removeUnboundWarps);const validLayer=(r:SceneLayerRef)=>{const i=scene.instances.find(i=>i.id===r.instanceId),d=i&&resolve(i.artworkId);return !!d?.layers.some(l=>l.id===r.sourceLayerId);};scene.bindings=scene.bindings.filter(validLayer);const removed=tracks().filter(t=>scene.placementTracks?.includes(t as ScenePlacementTrack)?!scene.instances.some(i=>i.id===(t as ScenePlacementTrack).instanceId):scene.visibilityTracks.includes(t as typeof scene.visibilityTracks[number])?!validLayer((t as typeof scene.visibilityTracks[number]).target):scene.depthTracks?.includes(t as NonNullable<typeof scene.depthTracks>[number])?!validLayer((t as NonNullable<typeof scene.depthTracks>[number]).target):scene.intervalTracks.includes(t as SceneIntervalTrack)?!resolve(scene.instances.find(i=>i.id===(t as SceneIntervalTrack).instanceId)?.artworkId??'')?.displayIntervals?.some(s=>s.id===(t as SceneIntervalTrack).sourceTrackId):false);const deleted=new Set(removed.map(t=>t.id));scene.visibilityTracks=scene.visibilityTracks.filter(t=>!deleted.has(t.id));scene.intervalTracks=scene.intervalTracks.filter(t=>!deleted.has(t.id));scene.depthTracks=scene.depthTracks?.filter(t=>!deleted.has(t.id));if(scene.placementTracks)scene.placementTracks=scene.placementTracks.filter(t=>!deleted.has(t.id));if(c.removeUnboundWarps){const used=new Set<string>();for(const b of scene.bindings){let w:SceneWarp|undefined=warp(b.warpId);while(w&&!used.has(w.id)){used.add(w.id);w=w.parentId?warp(w.parentId):undefined;}}for(const w of scene.warps)if(!used.has(w.id))deleted.add(w.id);scene.warps=scene.warps.filter(w=>used.has(w.id));}effects.removedIds.push(...deleted);break;}
 }
 validateRecordingScenes(draft);return effects;
}
