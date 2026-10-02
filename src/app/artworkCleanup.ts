import {parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {snapshotDrawing,type DrawingSnapshot} from '../domain/drawing/snapshots';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {RecordingScene,SceneTrack,SceneVisibilityTrack} from '../domain/recordingScene/model';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {drawingSignature,sourceIntervalFrames} from '../domain/vectorRecording/model';
import {sourceStructureSignature} from '../domain/vectorRecording/sourceCompatibility';
import type {ArtworkRig,VectorPose} from '../domain/vectorRecording/model';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import frontTemplate from '../assets/hairless-symmetric-two-face-mirror.json';
import sideTemplate from '../assets/right90-reference.json';
import recordingSideTemplate from '../assets/recording-side-part.json';

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const omit=(value:object,keys:readonly string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const mapped=(map:Map<string,string>,id:string)=>map.get(id)??`unknown:${id}`;

/** Full source content, including reference pixels, alignment, visibility,
 * fills, internal source IDs, and editing settings. Snapshot labels are outside it. */
export const artworkCleanupDrawingIdentity=(drawing:DrawingDocument):string=>canonical(drawing);

/** Normalize only generated rig/deformer/key identities and display labels.
 * All authored values and key angles survive. The cursor is view state, but a
 * legacy draft uses that cursor as its sampling angle and must include it. */
export function artworkCleanupRigIdentity(rig:ArtworkRig):string{
 const deformers=new Map(rig.deformers.map((d,i)=>[d.id,`deformer:${i}`]));
 const pose=(p:VectorPose)=>({...p,grids:Object.fromEntries(Object.entries(p.grids).map(([id,grid])=>[mapped(deformers,id),grid]))});
 return canonical({...omit(rig,['id','name','artworkId','angle','deformers','bindings','keys','draft']),
  deformers:rig.deformers.map(d=>({...omit(d,['id','name','parentId']),...(d.parentId?{parentId:mapped(deformers,d.parentId)}:{})})),
  bindings:Object.fromEntries(Object.entries(rig.bindings).map(([id,target])=>[id,mapped(deformers,target)])),
  keys:rig.keys.map(k=>({...omit(k,['id','name','grids']),grids:pose(k).grids})),
  ...(rig.draft?{draft:{...pose(rig.draft),angle:rig.angle}}:{})});
}

export function artworkCleanupSceneIdentity(scene:RecordingScene,sources:Record<string,DrawingDocument>):string{
 const instances=new Map(scene.instances.map((instance,i)=>[instance.id,`instance:${i}`])),warps=new Map(scene.warps.map((warp,i)=>[warp.id,`warp:${i}`]));
 const ref=<T extends {instanceId:string}>(value:T)=>({...value,instanceId:mapped(instances,value.instanceId)});
 const track=<T,>(value:SceneTrack<T>&{id:string})=>({...omit(value,['id','name','keys']),keys:value.keys.map(k=>omit(k,['id','name']))});
 return canonical({...omit(scene,['id','name','angle','instances','warps','bindings','visibilityTracks','intervalTracks','depthTracks','placementTracks','legacy']),
  instances:scene.instances.map(instance=>{
   const source=Object.hasOwn(sources,instance.artworkId)?sources[instance.artworkId]:undefined;
   return {...omit(instance,['id','name','artworkId']),source:source?artworkCleanupDrawingIdentity(source):{missing:instance.artworkId}};
  }),
  warps:scene.warps.map(warp=>({...track(warp),...(warp.parentId?{parentId:mapped(warps,warp.parentId)}:{})})),
  bindings:scene.bindings.map(binding=>({...ref(binding),warpId:mapped(warps,binding.warpId)})),
  visibilityTracks:scene.visibilityTracks.map(t=>({...track(t),target:ref(t.target)})),
  intervalTracks:scene.intervalTracks.map(t=>({...track(t),instanceId:mapped(instances,t.instanceId)})),
  depthTracks:(scene.depthTracks??[]).map(t=>({...track(t),target:ref(t.target)})),
  placementTracks:(scene.placementTracks??[]).map(t=>({...track(t),instanceId:mapped(instances,t.instanceId)})),
  ...(scene.legacy?{legacy:omit(scene.legacy,['rigId'])}:{})});
}

export async function artworkCleanupHash(identity:string):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const ORIGINAL_ARTWORK_IDS=['9c7fc5b1-bb99-44d7-bed8-e1671519a0c8','b153e894-d79f-46a3-9b3b-50458c607e07','a357b990-bf4f-4d4c-9e46-3d994d1759fb'] as const;
export const RECORDING_SIDE_LAYER_ID='5af1eb38-6a86-4521-abe6-113150188944';
export const RECORDING_SIDE_CURVE_IDS=['ad880840-7acf-49f8-9e3c-d8fa83904c5b','9435d89e-9e22-41d4-a6da-a56fb2abb05d','fd4eab8b-bd7b-4161-a103-9a1c0ce2ffd0','3c8616f7-334b-4405-b896-a666371a8cd2','eb4a3913-6a40-4054-96a0-064d524dfda6','fec6b82e-576b-40b1-8a15-e40c739457ce','4970fe67-87f5-4a28-8a44-da8e906a6d8a','126b44b9-8233-47de-8f4d-e012be0edfbd'] as const;
const front=parseDrawing(frontTemplate),side=parseDrawing(sideTemplate),defaultRecordingSide=parseDrawing(recordingSideTemplate),originals=new Set<string>(ORIGINAL_ARTWORK_IDS);
const sameIds=(actual:readonly string[],expected:readonly string[])=>actual.length===expected.length&&new Set(actual).size===actual.length&&actual.every(id=>expected.includes(id));
const shapeIds=(drawing:DrawingDocument,template:DrawingDocument)=>sameIds(drawing.curves.map(c=>c.id),template.curves.map(c=>c.id))&&sameIds(drawing.layers.map(l=>l.id),template.layers.map(l=>l.id));
export const isSymmetricFrontArtwork=(drawing:DrawingDocument):boolean=>shapeIds(drawing,front);
export const isFullRightArtwork=(drawing:DrawingDocument):boolean=>shapeIds({...drawing,curves:drawing.curves.filter(c=>!RECORDING_SIDE_CURVE_IDS.includes(c.id as typeof RECORDING_SIDE_CURVE_IDS[number])),layers:drawing.layers.filter(l=>l.id!==RECORDING_SIDE_LAYER_ID)},side);
export const isIndependentRecordingSide=(drawing:DrawingDocument):boolean=>drawing.layers.length===1&&drawing.layers[0].id===RECORDING_SIDE_LAYER_ID&&sameIds(drawing.curves.map(c=>c.id),RECORDING_SIDE_CURVE_IDS)&&drawing.fills.length===1&&drawing.fills[0].id==='0b614946-f58e-4885-a312-613bd14f11d8'&&drawing.offsets.length===0;

export interface ArtworkCleanupPlan {
 project:LandmarkProject;
 kept:{id:string;name:string;reasons:string[]}[];
 removed:{id:string;name:string;reason:string}[];
 archivedScenes:{id:string;name:string}[];
 archivedRigIds:string[];
 mappings:{fromArtworkId:string;toArtworkId:string;kind:'exact-copy'|'recording-side'}[];
 visibilityChanges:number;
 changed:boolean;
}
const evidence=(drawing:DrawingDocument)=>({sourceSignature:drawingSignature(drawing),sourceStructureSignature:sourceStructureSignature(drawing),sourceIntervalFrames:sourceIntervalFrames(drawing)});
const visibleMembers=(drawing:DrawingDocument)=>[...drawing.curves,...drawing.fills,...drawing.offsets];
function recordingPart(drawing:DrawingDocument):DrawingDocument|undefined{
 const layer=drawing.layers.find(layer=>layer.id===RECORDING_SIDE_LAYER_ID);if(!layer)return;
 const ids=new Set(layer.items),curves=drawing.curves.filter(curve=>ids.has(curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes));
 return {version:3,layers:[layer],curves,nodes:drawing.nodes.filter(node=>nodes.has(node.id)),fills:drawing.fills.filter(fill=>ids.has(fill.id)),offsets:drawing.offsets.filter(offset=>ids.has(offset.id)),joins:drawing.joins.filter(join=>ids.has(join.a.curveId)&&ids.has(join.b.curveId)),endpointLinks:(drawing.endpointLinks??[]).filter(link=>ids.has(link.a.curveId)&&ids.has(link.b.curveId)),groups:(drawing.groups??[]).filter(group=>group.curveIds.every(id=>ids.has(id))),displayIntervals:(drawing.displayIntervals??[]).filter(track=>ids.has(track.anchor.id))};
}
function sameRecordingPart(a:DrawingDocument,b:DrawingDocument):boolean{
 const normalized=(drawing:DrawingDocument)=>{const part=recordingPart(drawing)!;return {...part,layers:part.layers.map(layer=>({...layer,name:'录制用·独立侧前轮廓'})),curves:part.curves.map(curve=>({...curve,visible:false})),fills:part.fills.map(fill=>({...fill,visible:false})),offsets:part.offsets.map(offset=>({...offset,visible:false}))};};
 return artworkCleanupDrawingIdentity(normalized(a))===artworkCleanupDrawingIdentity(normalized(b));
}

/** Keep original IDs and exact coordinates. The separate recording layer is
 * hidden in Drawing; scene member appearance restores its previous defaults. */
function mergeRecordingSide(base:DrawingDocument,red:DrawingDocument):DrawingDocument{
 if(!isIndependentRecordingSide(red))throw Error('独立侧前轮廓的对象身份不完整，未整理画稿。');
 const prior=base.layers.find(l=>l.id===RECORDING_SIDE_LAYER_ID),priorIds=new Set(prior?.items??[]),priorCurves=base.curves.filter(c=>priorIds.has(c.id)),priorNodes=new Set(priorCurves.flatMap(c=>c.nodes));
 const retainedCurves=base.curves.filter(c=>!priorIds.has(c.id)),usedNodes=new Set(retainedCurves.flatMap(c=>c.nodes));
 if([...priorNodes].some(id=>usedNodes.has(id)))throw Error('独立侧前轮廓与完整侧稿共享节点，未整理画稿。');
 const clean={...base,layers:base.layers.filter(l=>l.id!==RECORDING_SIDE_LAYER_ID),curves:retainedCurves,nodes:base.nodes.filter(n=>!priorNodes.has(n.id)),fills:base.fills.filter(f=>!priorIds.has(f.id)),offsets:base.offsets.filter(o=>!priorIds.has(o.id)),joins:base.joins.filter(j=>!priorIds.has(j.a.curveId)&&!priorIds.has(j.b.curveId)),endpointLinks:base.endpointLinks?.filter(l=>!priorIds.has(l.a.curveId)&&!priorIds.has(l.b.curveId)),groups:base.groups?.filter(g=>!g.curveIds.some(id=>priorIds.has(id))),displayIntervals:base.displayIntervals?.filter(t=>!priorIds.has(t.anchor.id))};
 const existingIds=new Set([...clean.layers,...clean.curves,...clean.nodes,...clean.fills,...clean.offsets,...clean.joins,...(clean.endpointLinks??[]),...(clean.groups??[]),...(clean.displayIntervals??[])].map(item=>item.id));
 for(const item of [...red.layers,...red.curves,...red.nodes,...red.fills,...red.offsets,...red.joins,...(red.endpointLinks??[]),...(red.groups??[]),...(red.displayIntervals??[])])if(existingIds.has(item.id))throw Error('侧前轮廓与完整侧稿的对象 ID 冲突，未整理画稿。');
 const hidden=<T extends {visible:boolean}>(items:T[])=>items.map(item=>({...item,visible:false}));
 const result:DrawingDocument={...clean,layers:[...red.layers.map(l=>({...l,name:'录制用·独立侧前轮廓'})),...clean.layers],curves:[...clean.curves,...hidden(red.curves)],nodes:[...clean.nodes,...red.nodes],fills:[...clean.fills,...hidden(red.fills)],offsets:[...clean.offsets,...hidden(red.offsets)],joins:[...clean.joins,...red.joins],endpointLinks:[...(clean.endpointLinks??[]),...(red.endpointLinks??[])],groups:[...(clean.groups??[]),...(red.groups??[])],displayIntervals:[...(clean.displayIntervals??[]),...(red.displayIntervals??[])]};
 parseDrawing(result);return result;
}

/** Explicit, user-requested five-artwork arrangement. Everything outside the
 * five selected identities belongs in the caller's durable full-project backup.
 * The plan never writes storage and never edits its input. */
export function planArtworkCleanup(project:LandmarkProject):ArtworkCleanupPlan{
 const library=project.drawingSnapshots;if(!library)throw Error('找不到原画稿库，未整理画稿。');
 for(const id of ORIGINAL_ARTWORK_IDS)if(!library.items.some(item=>item.id===id))throw Error('原来的正面、微侧或稍侧画稿缺失，未整理画稿。');
 const sources=recordingSceneSources(project),sceneList=project.recordingScenes?.scenes??[],activeScene=sceneList.find(scene=>scene.id===project.recordingScenes?.activeSceneId);
 const currentReferences=new Set(activeScene?.instances.map(instance=>instance.artworkId));
 const candidates=(predicate:(drawing:DrawingDocument)=>boolean)=>library.items.filter(item=>!originals.has(item.id)&&sources[item.id]&&predicate(sources[item.id]));
 const frontCandidates=candidates(isSymmetricFrontArtwork),sideCandidates=candidates(isFullRightArtwork),redCandidates=candidates(isIndependentRecordingSide);
 const usedIds=new Set(library.items.map(item=>item.id));
 const fresh=(stem:string)=>{let id=stem,index=2;while(usedIds.has(id))id=`${stem}:${index++}`;usedIds.add(id);return id;};
 const make=(drawing:DrawingDocument,name:string,stem:string):DrawingSnapshot=>({id:fresh(stem),name,drawing:structuredClone(drawing)});
 const selectedFront=[...frontCandidates].reverse().find(item=>currentReferences.has(item.id))??frontCandidates.at(-1)??make(front,'对称两半正脸','contour-kept-symmetric-front');
 const selectedSide=[...sideCandidates].reverse().find(item=>currentReferences.has(item.id))??sideCandidates.at(-1)??make(side,'右侧90°','contour-kept-full-right');
 const keptFront=selectedFront.name==='对称两半正脸'?selectedFront:{...selectedFront,name:'对称两半正脸'};
 const keptSide=selectedSide.name==='右侧90°'?selectedSide:{...selectedSide,name:'右侧90°'};
 const keptRed=[...redCandidates].reverse().find(item=>currentReferences.has(item.id))??redCandidates.at(-1);
 const keptIds=new Set<string>([...ORIGINAL_ARTWORK_IDS,keptFront.id,keptSide.id]);
 const frontSource=sources[keptFront.id]??keptFront.drawing,sideSource=sources[keptSide.id]??keptSide.drawing;
 const targetRecordingSide=recordingPart(sideSource)??(keptRed?sources[keptRed.id]:defaultRecordingSide);
 const mappings:ArtworkCleanupPlan['mappings']=[],mapping=new Map<string,string>();
 for(const id of keptIds)mapping.set(id,id);
 const keptSources=new Map<string,DrawingDocument>([...ORIGINAL_ARTWORK_IDS.map(id=>[id,sources[id]] as const),[keptFront.id,frontSource],[keptSide.id,sideSource]]);
 for(const [id,drawing] of Object.entries(sources)){
  if(keptIds.has(id))continue;
  const exact=[...keptSources].find(([,kept])=>artworkCleanupDrawingIdentity(drawing)===artworkCleanupDrawingIdentity(kept));
  if(exact){mapping.set(id,exact[0]);mappings.push({fromArtworkId:id,toArtworkId:exact[0],kind:'exact-copy'});}
  else if(isIndependentRecordingSide(drawing)&&sameRecordingPart(drawing,targetRecordingSide)){mapping.set(id,keptSide.id);mappings.push({fromArtworkId:id,toArtworkId:keptSide.id,kind:'recording-side'});}
 }
 const redMappings=new Set(mappings.filter(m=>m.kind==='recording-side').map(m=>m.fromArtworkId));
 const copies=Object.fromEntries(Object.entries(project.drawingWorkingCopies??{}).filter(([id])=>keptIds.has(id)));
 const oldActive=library.activeId;
 if(oldActive&&keptIds.has(oldActive)&&project.drawing&&artworkCleanupDrawingIdentity(project.drawing)!==artworkCleanupDrawingIdentity(snapshotDrawing(library,oldActive)))copies[oldActive]=project.drawing;
 let sideSnapshot=keptSide,mergedSide=sideSource;
 const savedSide:DrawingDocument=library.items.some(item=>item.id===keptSide.id)?snapshotDrawing(library,keptSide.id):keptSide.drawing;
 if(!savedSide.layers.some(layer=>layer.id===RECORDING_SIDE_LAYER_ID)||!sideSource.layers.some(layer=>layer.id===RECORDING_SIDE_LAYER_ID)){
  const mergedSaved:DrawingDocument=savedSide.layers.some(layer=>layer.id===RECORDING_SIDE_LAYER_ID)?savedSide:mergeRecordingSide(savedSide,keptRed?snapshotDrawing(library,keptRed.id):defaultRecordingSide);
  mergedSide=sideSource.layers.some(layer=>layer.id===RECORDING_SIDE_LAYER_ID)?sideSource:mergeRecordingSide(sideSource,keptRed?sources[keptRed.id]:defaultRecordingSide);
  const {reference,...drawing}=mergedSaved;void reference;
  sideSnapshot={...keptSide,drawing};
  if(Object.hasOwn(copies,keptSide.id)||artworkCleanupDrawingIdentity(mergedSide)!==artworkCleanupDrawingIdentity(mergedSaved))copies[keptSide.id]=mergedSide;
 }
 const nextSources={...Object.fromEntries(keptSources),[keptSide.id]:mergedSide};
 const rigs=project.vectorRecording?.rigs??[],archivedRigSet=new Set(rigs.filter(rig=>!mapping.has(rig.artworkId)||redMappings.has(rig.artworkId)).map(rig=>rig.id));
 // Several old reference copies may each own a rig. Source deduplication cannot
 // put those rigs on one artwork: legacy storage permits exactly one per source.
 // Keep the retained artwork's own rig preferentially; archive collisions with
 // their compatibility scenes in the caller's verified full-project backup.
 const rigByArtwork=new Map<string,ArtworkRig>();
 for(const rig of rigs){
  if(archivedRigSet.has(rig.id))continue;
  const artworkId=mapping.get(rig.artworkId)!,prior=rigByArtwork.get(artworkId);
  if(!prior){rigByArtwork.set(artworkId,rig);continue;}
  if(rig.artworkId===artworkId&&prior.artworkId!==artworkId){archivedRigSet.add(prior.id);rigByArtwork.set(artworkId,rig);}
  else archivedRigSet.add(rig.id);
 }
 const archivedRigIds=rigs.filter(rig=>archivedRigSet.has(rig.id)).map(rig=>rig.id);
 const retainedRigs=rigs.filter(rig=>!archivedRigSet.has(rig.id)).map(rig=>{const artworkId=mapping.get(rig.artworkId)!;return artworkId===rig.artworkId&&artworkId!==keptSide.id?rig:{...rig,artworkId,...evidence(nextSources[artworkId])};});
 const archivedScenes:ArtworkCleanupPlan['archivedScenes']=[];let visibilityChanges=0;
 const reservedSceneIds=new Set(sceneList.flatMap(scene=>[scene.id,...scene.instances.map(i=>i.id),...[...scene.warps,...scene.visibilityTracks,...scene.intervalTracks,...(scene.depthTracks??[]),...(scene.placementTracks??[])].flatMap(track=>[track.id,...track.keys.map(key=>key.id)])]));
 const freshSceneId=(stem:string)=>{let id=stem,index=2;while(reservedSceneIds.has(id))id=`${stem}:${index++}`;reservedSceneIds.add(id);return id;};
 const scenes=sceneList.flatMap(scene=>{
  const redIndices=scene.instances.flatMap((instance,index)=>redMappings.has(instance.artworkId)?[index]:[]);
  if(redIndices.length>1||redIndices.length===1&&redIndices[0]!==scene.instances.length-1){
   if(scene.id===project.recordingScenes?.activeSceneId)throw Error('当前场景的红片后还有其他实例，需要先调整其来源排列，未整理');
   archivedScenes.push({id:scene.id,name:scene.name});return [];
  }
  if(scene.instances.some(instance=>!mapping.has(instance.artworkId))||scene.legacy&&archivedRigSet.has(scene.legacy.rigId)){
   archivedScenes.push({id:scene.id,name:scene.name});return [];
  }
  let tracks=scene.visibilityTracks,changed=false;
  const instances=scene.instances.map(instance=>{
   const artworkId=mapping.get(instance.artworkId)!,red=redMappings.has(instance.artworkId),source=nextSources[artworkId];
   if(red){
    const oldSource=sources[instance.artworkId],included=new Set(instance.layerIds??oldSource.layers.map(l=>l.id));
    for(const member of visibleMembers(oldSource).filter(member=>oldSource.layers.some(layer=>included.has(layer.id)&&layer.items.includes(member.id)))){
     const layer=oldSource.layers.find(layer=>layer.items.includes(member.id))!;
     const track=tracks.find(track=>track.target.instanceId===instance.id&&track.target.sourceObjectId===member.id&&track.target.sourceLayerId===layer.id);
     if(track){
      const keys=track.keys.map(key=>key.value===null?{...key,value:member.visible}:key),draft=track.draft?.value===null?{...track.draft,value:member.visible}:track.draft;
      if(!keys.some(key=>key.angle.x===0&&key.angle.y===0))keys.push({id:freshSceneId(`cleanup-neutral:${instance.id}:${member.id}`),angle:{x:0,y:0},value:member.visible});
      const replacement={...track,keys,...(draft?{draft}:{})};
      if(canonical(track)!==canonical(replacement)){tracks=tracks.map(t=>t===track?replacement:t);visibilityChanges++;}
     }else{
      const added:SceneVisibilityTrack={id:freshSceneId(`cleanup-visible:${instance.id}:${member.id}`),target:{instanceId:instance.id,sourceLayerId:layer.id,sourceObjectId:member.id},keys:[{id:freshSceneId(`cleanup-neutral:${instance.id}:${member.id}`),angle:{x:0,y:0},value:member.visible}]};
      tracks=[...tracks,added];visibilityChanges++;
     }
    }
   }
   const sourceChanged=artworkId!==instance.artworkId||artworkId===keptSide.id&&artworkCleanupDrawingIdentity(sideSource)!==artworkCleanupDrawingIdentity(mergedSide);
   if(!sourceChanged)return instance;
   changed=true;
   // Adding a hidden source layer must not expand an existing full-source
   // instance's explicit selection, even if a later appearance track shows it.
   const layerIds=instance.layerIds??sources[instance.artworkId]?.layers.map(layer=>layer.id);
   return {...instance,artworkId,...(layerIds?{layerIds}:{}),...evidence(source)};
  });
  return [changed||tracks!==scene.visibilityTracks?{...scene,instances,visibilityTracks:tracks}:scene];
 });
 const activeSceneId=scenes.some(scene=>scene.id===project.recordingScenes?.activeSceneId)?project.recordingScenes?.activeSceneId:scenes.find(scene=>!scene.legacy)?.id??scenes[0]?.id;
 const activeId=oldActive&&mapping.has(oldActive)?mapping.get(oldActive)!:keptFront.id;
 const keptItems=[...ORIGINAL_ARTWORK_IDS.map(id=>library.items.find(item=>item.id===id)!),keptFront,sideSnapshot];
 const imageIds=new Set(keptItems.flatMap(item=>item.reference?[item.reference.imageId]:[]));
 const drawing=activeId===keptSide.id?mergedSide:activeId===oldActive&&project.drawing?project.drawing:copies[activeId]??nextSources[activeId];
 const next:LandmarkProject={...project,drawing,drawingSnapshots:{...library,activeId,items:keptItems,images:library.images.filter(image=>imageIds.has(image.id))},...(project.drawingWorkingCopies!==undefined||Object.keys(copies).length?{drawingWorkingCopies:copies}:{}),...(project.recordingScenes?{recordingScenes:{...project.recordingScenes,activeSceneId,scenes}}:{}),...(project.vectorRecording?{vectorRecording:{...project.vectorRecording,rigs:retainedRigs}}:{})};
 if(next.recordingScenes)parseRecordingScenes(next.recordingScenes);
 if(next.vectorRecording)parseVectorRecording(next.vectorRecording);
 parseDrawing(next.drawing!);for(const item of keptItems)parseDrawing(snapshotDrawing(next.drawingSnapshots!,item.id));for(const copy of Object.values(copies))parseDrawing(copy);
 const changed=canonical(next)!==canonical(project);
 return {project:changed?next:project,kept:keptItems.map(({id,name},i)=>({id,name,reasons:[i<3?'保留原画稿':i===3?'保留对称两半正面':'保留完整90°侧稿']})),removed:library.items.filter(item=>!keptIds.has(item.id)).map(({id,name})=>({id,name,reason:'归档至整理前完整备份'})),archivedScenes,archivedRigIds,mappings,visibilityChanges,changed};
}
