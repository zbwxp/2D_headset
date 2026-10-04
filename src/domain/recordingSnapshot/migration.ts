import {type DrawingDocument,type Point2} from '../drawing/model';
import type {DrawingSnapshotState} from '../drawing/snapshots';
import {drawingSignature,type VectorRecording} from '../vectorRecording/model';
import {sourceOnlyRecordingWorkspace} from './retirement';
import type {RecordingScene,RecordingScenes,SceneShapeValue,SceneTrack,Angle} from '../recordingScene/model';
import {canonicalElementId,drawingSnapshotForArtwork,remapIntervalIdentities} from './sources';
import {emptyRecordingSnapshot,emptySnapshotRecording,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotRecording,type SnapshotPoseTrack,type SnapshotDeformationState} from './model';

export type LegacySnapshotProject=DrawingSnapshotState&{recordingScenes?:RecordingScenes;vectorRecording?:VectorRecording;recordingSnapshots?:RecordingSnapshotWorkspace};
const clone=<T,>(value:T):T=>structuredClone(value);
export const snapshotMigrationId=(kind:string,...parts:string[]):string=>`v2-${kind}:${JSON.stringify(parts)}`;
const angleKey=(angle:Angle)=>JSON.stringify([angle.x,angle.y]);
const point=(value:Point2|undefined):Point2=>value??[0,0];
function mappedTrack<A,B>(track:SceneTrack<A>,id:string,value:(value:A)=>B):SceneTrack<B>&{id:string}{
 return {id,...(track.interpolation?{interpolation:track.interpolation}:{}),keys:track.keys.map(key=>({...clone(key),id:snapshotMigrationId('key',id,key.id),value:value(key.value)})),...(track.draft?{draft:{angle:clone(track.draft.angle),value:value(track.draft.value)}}:{})};
}
interface LinkComponent {id:string;nodeIds:string[];linkIds:string[]}
function linkComponents(source:DrawingDocument):LinkComponent[]{
 const parent=new Map(source.nodes.map(node=>[node.id,node.id])),root=(id:string):string=>{let current=id;while(parent.get(current)!==current&&parent.has(current))current=parent.get(current)!;return current;};
 const curves=new Map(source.curves.map(curve=>[curve.id,curve])),links=source.endpointLinks??[];
 for(const link of links){const a=curves.get(link.a.curveId)?.nodes[link.a.end],b=curves.get(link.b.curveId)?.nodes[link.b.end];if(a&&b)parent.set(root(b),root(a));}
 const result=new Map<string,LinkComponent>();
 for(const link of links){const a=curves.get(link.a.curveId)?.nodes[link.a.end];if(!a)continue;const key=root(a),group=result.get(key)??{id:key,nodeIds:[],linkIds:[]};group.linkIds.push(link.id);result.set(key,group);}
 for(const node of source.nodes){const group=result.get(root(node.id));if(group)group.nodeIds.push(node.id);}
 return [...result.values()].map(group=>({...group,id:JSON.stringify([...group.linkIds].sort())}));
}

/** A normal scene becomes editable layer channels. Only a missing dependency,
 * explicit linked-position conflict or duplicate branch needs archived fallback. */
export function migrateRecordingScene(workspace:RecordingSnapshotWorkspace,scene:RecordingScene,sources:Record<string,DrawingDocument>):{recording:SnapshotRecording;snapshots:RecordingSnapshot[]}{
 const recording=emptySnapshotRecording(snapshotMigrationId('recording',scene.id),scene.name);recording.angle=clone(scene.angle);if(scene.tolerance!==undefined)recording.tolerance=scene.tolerance;
 const layers:RecordingSnapshot['layers']=[],deformation:SnapshotDeformationState={warps:[],bindings:[],layers:{},relationPositions:{}},tracks:SnapshotPoseTrack[]=[],issues:string[]=[];
 const slotByInstanceLayer=new Map<string,string>(),mapByInstance=new Map<string,(id:string)=>string>(),sourceByInstance=new Map<string,DrawingDocument>(),membersBySlot=new Map<string,Set<string>>(),seenMembers=new Set<string>();
 const slot=(instanceId:string,sourceLayerId:string)=>slotByInstanceLayer.get(JSON.stringify([instanceId,sourceLayerId]));
 for(const instance of scene.instances){
  const source=sources[instance.artworkId],snapshot=drawingSnapshotForArtwork(workspace,instance.artworkId);
  if(!source||!snapshot){issues.push(`Missing source artwork ${instance.artworkId}.`);continue;}
  sourceByInstance.set(instance.id,source);const known=new Map(Object.entries(snapshot.source!.originIds).map(([canonical,raw])=>[raw,canonical])),map=(raw:string)=>known.get(raw)??canonicalElementId(instance.artworkId,raw);mapByInstance.set(instance.id,map);
  const selected=instance.layerIds??source.layers.map(layer=>layer.id);
  for(const rawLayerId of selected){
   const original=source.layers.find(layer=>layer.id===rawLayerId);if(!original){issues.push(`Missing source layer ${rawLayerId}.`);continue;}
   const id=snapshotMigrationId('layer',scene.id,instance.id,map(original.id));slotByInstanceLayer.set(JSON.stringify([instance.id,original.id]),id);membersBySlot.set(id,new Set(original.items));
   layers.push({kind:'reference',id,name:original.name,baseSnapshotId:snapshot.id,baseLayerId:map(original.id)});
   for(const member of original.items){const canonical=map(member);if(seenMembers.has(canonical))issues.push(`Canonical element ${canonical} occurs through multiple legacy instance branches.`);seenMembers.add(canonical);}
  }
 }
 const warpIds=new Map(scene.warps.map(warp=>[warp.id,snapshotMigrationId('warp',scene.id,warp.id)]));
 for(const warp of scene.warps){const id=warpIds.get(warp.id)!;deformation.warps.push({id,name:warp.name,...(warp.parentId?{parentId:warpIds.get(warp.parentId)!}:{}),restGrid:clone(warp.restGrid),grid:clone(warp.restGrid)});tracks.push({...mappedTrack(warp,snapshotMigrationId('track',scene.id,warp.id),clone),channel:'warp',targetId:id});}
 for(const binding of scene.bindings){const target=slot(binding.instanceId,binding.sourceLayerId);if(target)deformation.bindings.push({layerId:target,warpId:warpIds.get(binding.warpId)!});else issues.push(`Missing bound source layer ${binding.sourceLayerId}.`);}
 for(const track of scene.placementTracks??[]){
  const instance=scene.instances.find(i=>i.id===track.instanceId),source=instance&&sourceByInstance.get(instance.id);
  for(const layer of source?.layers??[]){const target=slot(track.instanceId,layer.id);if(target)tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id,target),clone),channel:'placement',targetId:target});}
 }
 for(const track of scene.shapeTracks??[]){
  const source=sourceByInstance.get(track.instanceId),map=mapByInstance.get(track.instanceId);if(!source||!map)continue;
  const owners=new Map(source.curves.flatMap(curve=>curve.nodes.map(node=>[node,source.layers.find(layer=>layer.items.includes(curve.id))!.id] as const))),curveOwners=new Map(source.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const)));
  const samples=[...track.keys.map(key=>key.value),...(track.draft?[track.draft.value]:[])],groups=linkComponents(source),linkedNodes=new Set(groups.flatMap(group=>group.nodeIds));
  for(const sample of samples){for(const id of Object.keys(sample.nodes))if(!owners.has(id))issues.push(`Shape channel retains missing node ${id}.`);for(const id of Object.keys(sample.handles))if(!source.curves.some(curve=>curve.id===id))issues.push(`Shape channel retains missing curve ${id}.`);}
  for(const group of groups){
   if(!samples.some(sample=>group.nodeIds.some(id=>Object.hasOwn(sample.nodes,id))))continue;
   const target=snapshotMigrationId('relation',scene.id,track.instanceId,group.id);
   for(const sample of samples){const first=point(sample.nodes[group.nodeIds[0]]);if(group.nodeIds.some(id=>{const p=point(sample.nodes[id]);return Math.hypot(first[0]-p[0],first[1]-p[1])>1e-8;}))issues.push(`Linked node shape offsets conflict in ${group.id}.`);}
   deformation.relationPositions[target]={sourceLinkIds:group.linkIds.map(map),offset:[0,0]};
   tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id,target),sample=>clone(point(sample.nodes[group.nodeIds[0]]))),channel:'relationPosition',targetId:target});
  }
  for(const layer of source.layers){const target=slot(track.instanceId,layer.id);if(!target)continue;
   const value=(sample:SceneShapeValue):SceneShapeValue=>({nodes:Object.fromEntries(Object.entries(sample.nodes).filter(([id])=>owners.get(id)===layer.id&&!linkedNodes.has(id)).map(([id,value])=>[map(id),clone(value)])),handles:Object.fromEntries(Object.entries(sample.handles).filter(([id])=>curveOwners.get(id)===layer.id).map(([id,value])=>[map(id),clone(value)]))});
   tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id,target),value),channel:'shape',targetId:target});
  }
 }
 for(const track of scene.visibilityTracks){const target=slot(track.target.instanceId,track.target.sourceLayerId),map=mapByInstance.get(track.target.instanceId);if(!target||!map){issues.push(`Visibility target layer ${track.target.sourceLayerId} is missing.`);continue;}tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id),clone),channel:'visibility',targetId:target,...(track.target.sourceObjectId?{elementId:map(track.target.sourceObjectId)}:{})});}
 for(const track of scene.depthTracks??[]){const target=slot(track.target.instanceId,track.target.sourceLayerId);if(!target){issues.push(`Depth target layer ${track.target.sourceLayerId} is missing.`);continue;}tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id),clone),channel:'depth',targetId:target});}
 for(const track of scene.intervalTracks){
  const source=sourceByInstance.get(track.instanceId),map=mapByInstance.get(track.instanceId),base=source?.displayIntervals?.find(interval=>interval.id===track.sourceTrackId),owner=base&&source?.layers.find(layer=>layer.items.includes(base.anchor.id)),target=owner&&slot(track.instanceId,owner.id);
  if(!target||!map||!source){issues.push(`Interval target ${track.sourceTrackId} is missing.`);continue;}
  if(track.materialIssue&&track.materialIssue.sourceSignature!==drawingSignature(source))issues.push(`Interval ${track.sourceTrackId} has unresolved source material: ${track.materialIssue.message}`);
  tracks.push({...mappedTrack(track,snapshotMigrationId('track',scene.id,track.id),value=>({appearance:value.appearance?remapIntervalIdentities(value.appearance,map):null,enabled:Object.fromEntries(Object.entries(value.enabled).map(([id,enabled])=>[map(id),enabled]))})),channel:'interval',targetId:target,elementId:map(track.sourceTrackId),sourceTrackId:map(track.sourceTrackId)});
 }
 recording.tracks=tracks;
 const positions=new Map<string,{id:string;name:string;angle:Angle}>();
 for(const viewpoint of scene.viewpoints??[])positions.set(angleKey(viewpoint.angle),{id:snapshotMigrationId('view',scene.id,viewpoint.id),name:viewpoint.name,angle:clone(viewpoint.angle)});
 for(const track of tracks)for(const key of [...track.keys,...(track.draft?[{...track.draft,id:'draft',name:undefined}]:[])])if(!positions.has(angleKey(key.angle)))positions.set(angleKey(key.angle),{id:snapshotMigrationId('view',scene.id,angleKey(key.angle)),name:key.name??`X ${key.angle.x}° / Y ${key.angle.y}°`,angle:clone(key.angle)});
 if(!positions.has(angleKey(scene.angle)))positions.set(angleKey(scene.angle),{id:snapshotMigrationId('view',scene.id,angleKey(scene.angle)),name:`X ${scene.angle.x}° / Y ${scene.angle.y}°`,angle:clone(scene.angle)});
 const snapshots=[...positions.values()].map(position=>({...emptyRecordingSnapshot(position.id,position.name,'view',position.angle),layers:clone(layers),deformation:clone(deformation),authored:tracks.flatMap(track=>track.keys.filter(key=>angleKey(key.angle)===angleKey(position.angle)).map(key=>({trackId:track.id,keyId:key.id})))}));
 recording.snapshotIds=snapshots.map(snapshot=>snapshot.id);recording.activeSnapshotId=snapshots.find(snapshot=>angleKey(snapshot.angle)===angleKey(scene.angle))!.id;
 if(issues.length)recording.legacy={scene:clone(scene),readOnly:true,reason:[...new Set(issues)].join(' ')};
 return {recording,snapshots};
}

/** Initialize only the unified source workspace. Old payloads remain untouched
 * for explicit user review; opening a file never converts or clears them. */
export function ensureRecordingSnapshots<T extends LegacySnapshotProject>(project:T,_originalJSON?:string):T&{recordingSnapshots:RecordingSnapshotWorkspace}{
 if(project.recordingSnapshots)return project as T&{recordingSnapshots:RecordingSnapshotWorkspace};
 return {...project,recordingSnapshots:sourceOnlyRecordingWorkspace(project)};
}

/** Returns the exact archived text; opening it uses the usual project parser. */
export function archivedRecordingProjectJSON(workspace:RecordingSnapshotWorkspace):string|undefined{return workspace.legacyArchive?.projectJSON;}
