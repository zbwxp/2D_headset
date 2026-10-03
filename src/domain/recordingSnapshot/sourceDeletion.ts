import type {StrokeDisplayIntervals} from '../drawing/model';
import type {RecordingSnapshotWorkspace,SnapshotDeformationState,SnapshotLayerState,SnapshotPoseTrack,SceneIntervalValue,SceneShapeValue,SnapshotEndpointResponses,SnapshotTriangleResponses,SnapshotRelationPatch,SnapshotPropertyResponses} from './model';

const without=<T>(values:Record<string,T>,removed:ReadonlySet<string>):Record<string,T>=>Object.fromEntries(Object.entries(values).filter(([id])=>!removed.has(id)));
const address=(snapshotId:string,layerId:string)=>JSON.stringify([snapshotId,layerId]);

/** A Drawing deletion is a shared transaction, unlike a child membership edit.
 * Only IDs proven deleted from this source (and their live dependents) are
 * removed. Unrelated unresolved references and recovery archives stay intact. */
export function removeDeletedSourceReferences(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace,sourceSnapshotId:string,deletedIds:ReadonlySet<string>):RecordingSnapshotWorkspace {
 if(!deletedIds.size)return after;
 const removed=new Set(deletedIds),removedLayers=new Set<string>(),removedLayerIds=new Set<string>();
 const priorSource=before.snapshots.find(snapshot=>snapshot.id===sourceSnapshotId),liveSourceIds=new Set(Object.keys(after.snapshots.find(snapshot=>snapshot.id===sourceSnapshotId)?.source?.originIds??{}));
 for(const layer of priorSource?.layers??[])if(layer.kind==='original'&&deletedIds.has(layer.id)){removedLayers.add(address(sourceSnapshotId,layer.id));removedLayerIds.add(layer.id);}
 // Layer IDs are scoped by their snapshot: an unrelated local slot can legally
 // reuse an ID and must not be deleted with another branch's source slot.
 let changed=true;
 while(changed){changed=false;for(const snapshot of before.snapshots)for(const layer of snapshot.layers)if(layer.kind==='reference'&&removedLayers.has(address(layer.baseSnapshotId,layer.baseLayerId))&&!removedLayers.has(address(snapshot.id,layer.id))){removedLayers.add(address(snapshot.id,layer.id));removedLayerIds.add(layer.id);changed=true;}}
 const intervalDepends=(track:StrokeDisplayIntervals)=>removed.has(track.id)||removed.has(track.anchor.id)||!!track.displayRoute&&(track.displayRoute.seed.segments.some(use=>removed.has(use.id))||track.displayRoute.throughLinkIds.some(id=>removed.has(id)));
 // Collect transitive dependencies before rewriting any record, so a relation
 // patch encountered after its consumer cannot leave a stale route or pose.
 changed=true;
 while(changed){
  const count=removed.size;
  for(const fill of Object.values(after.library.fills))if(fill.boundary.some(use=>removed.has(use.id)))removed.add(fill.id);
  for(const offset of Object.values(after.library.offsets))if(offset.source.some(use=>removed.has(use.id)))removed.add(offset.id);
  for(const snapshot of after.snapshots){
   for(const kind of ['joins','endpointLinks'] as const)for(const relation of [...snapshot.relations[kind]?.add??[],...snapshot.relations[kind]?.update??[]])if(!liveSourceIds.has(relation.id)&&(removed.has(relation.a.curveId)||removed.has(relation.b.curveId)))removed.add(relation.id);
   for(const group of [...snapshot.relations.groups?.add??[],...snapshot.relations.groups?.update??[]])if(!liveSourceIds.has(group.id)&&group.curveIds.every(id=>removed.has(id)))removed.add(group.id);
   for(const track of [...snapshot.relations.displayIntervals?.add??[],...snapshot.relations.displayIntervals?.update??[]])if(!liveSourceIds.has(track.id)&&intervalDepends(track)){removed.add(track.id);for(const range of track.ranges)if(!liveSourceIds.has(range.id))removed.add(range.id);}
  }
  changed=removed.size!==count;
 }
 const appearance=(track:StrokeDisplayIntervals):StrokeDisplayIntervals=>({...track,ranges:track.ranges.filter(range=>!removed.has(range.id)).map(range=>{if(!range.originId||!removed.has(range.originId))return range;const {originId,...rest}=range;void originId;return rest;})});
 const interval=(value:SceneIntervalValue):SceneIntervalValue=>({...value,appearance:value.appearance?appearance(value.appearance):null,enabled:without(value.enabled,removed)});
 const shape=(value:SceneShapeValue):SceneShapeValue=>({...value,nodes:without(value.nodes,removed),handles:without(value.handles,removed)});
 const layerState=(value:SnapshotLayerState):SnapshotLayerState=>({...value,
  ...(value.shape?{shape:shape(value.shape)}:{}),...(value.elementPlacements?{elementPlacements:without(value.elementPlacements,removed)}:{}),...(value.visibility?{visibility:without(value.visibility,removed)}:{}),
  ...(value.intervals?{intervals:Object.fromEntries(Object.entries(value.intervals).filter(([id,value])=>!removed.has(id)&&(!value.appearance||!intervalDepends(value.appearance))).map(([id,value])=>[id,interval(value)]))}:{}),
 });
 const removedRelationsBySnapshot=new Map<string,Set<string>>();
 const state=(value:SnapshotDeformationState,snapshotId:string):SnapshotDeformationState=>{
  const relations=removedRelationsBySnapshot.get(snapshotId)??new Set<string>();removedRelationsBySnapshot.set(snapshotId,relations);
  const relationPositions=Object.fromEntries(Object.entries(value.relationPositions).flatMap(([id,relation])=>{const sourceLinkIds=relation.sourceLinkIds.filter(id=>!removed.has(id));if(removed.has(id)||!sourceLinkIds.length){relations.add(id);return [];}return [[id,{...relation,sourceLinkIds}]];}));
  return {...value,bindings:value.bindings.filter(binding=>!removedLayers.has(address(snapshotId,binding.layerId))),layers:Object.fromEntries(Object.entries(value.layers).filter(([id])=>!removedLayers.has(address(snapshotId,id))).map(([id,layer])=>[id,layerState(layer)])),relationPositions,...(value.intervalMaterialIssues?{intervalMaterialIssues:without(value.intervalMaterialIssues,removed)}:{})};
 };
 const snapshots=after.snapshots.map(snapshot=>{
  const relations={...snapshot.relations};
  const cleanPair=<T extends {id:string;a:{curveId:string};b:{curveId:string}}>(patch:SnapshotRelationPatch<T>):SnapshotRelationPatch<T>=>({...patch,...(patch.add?{add:patch.add.filter(value=>!removed.has(value.id)&&!removed.has(value.a.curveId)&&!removed.has(value.b.curveId))}:{}),...(patch.update?{update:patch.update.filter(value=>!removed.has(value.id)&&!removed.has(value.a.curveId)&&!removed.has(value.b.curveId))}:{}),...(patch.disable?{disable:patch.disable.filter(id=>!removed.has(id))}:{})});
  if(relations.joins)relations.joins=cleanPair(relations.joins);if(relations.endpointLinks)relations.endpointLinks=cleanPair(relations.endpointLinks);
  const groups=relations.groups;if(groups){const clean=(values:NonNullable<typeof groups.add>)=>values.filter(value=>!removed.has(value.id)).map(value=>({...value,curveIds:value.curveIds.filter(id=>!removed.has(id))}));relations.groups={...groups,...(groups.add?{add:clean(groups.add)}:{}),...(groups.update?{update:clean(groups.update)}:{}),...(groups.disable?{disable:groups.disable.filter(id=>!removed.has(id))}:{})};}
  const intervals=relations.displayIntervals;if(intervals){const clean=(values:StrokeDisplayIntervals[])=>values.filter(value=>!intervalDepends(value)).map(appearance);relations.displayIntervals={...intervals,...(intervals.add?{add:clean(intervals.add)}:{}),...(intervals.update?{update:clean(intervals.update)}:{}),...(intervals.disable?{disable:intervals.disable.filter(id=>!removed.has(id))}:{})};}
  const mirror=snapshot.inputMirror;
  return {...snapshot,layers:snapshot.layers.filter(layer=>!removedLayers.has(address(snapshot.id,layer.id))).map(layer=>layer.kind==='original'?{...layer,items:layer.items.filter(id=>!removed.has(id))}:{...layer,...(layer.membership?{membership:{...(layer.membership.addElementIds?{addElementIds:layer.membership.addElementIds.filter(id=>!removed.has(id))}:{}),...(layer.membership.excludeElementIds?{excludeElementIds:layer.membership.excludeElementIds.filter(id=>!removed.has(id))}:{})}}:{})}),relations,
   deformation:state(snapshot.deformation,snapshot.id),...(snapshot.inheritedState?{inheritedState:state(snapshot.inheritedState,snapshot.id)}:{}),...(snapshot.draft?{draft:{...snapshot.draft,deformation:state(snapshot.draft.deformation,snapshot.id)}}:{}),
   ...(snapshot.source?{source:{...snapshot.source,originIds:without(snapshot.source.originIds,removed)}}:{}),
   ...(mirror?{inputMirror:{...mirror,curvePairs:mirror.curvePairs.filter(pair=>!removed.has(pair.id)&&!removed.has(pair.a)&&!removed.has(pair.b)),...(mirror.axisNodeIds?{axisNodeIds:mirror.axisNodeIds.filter(id=>!removed.has(id))}:{})}}:{}),
   ...(snapshot.parentLayers?.excludedLayerIds?{parentLayers:{...snapshot.parentLayers,excludedLayerIds:snapshot.parentLayers.excludedLayerIds.filter(id=>!removedLayers.has(address(snapshot.parentSnapshotId!,id)))}}:{}),
  };
 });
 const responses=<T extends SnapshotEndpointResponses|SnapshotTriangleResponses>(value:T):T=>({...value,nodes:Object.fromEntries(Object.entries(value.nodes).filter(([id])=>!removed.has(id))),handles:Object.fromEntries(Object.entries(value.handles).filter(([id])=>!removed.has(id)))});
 const responseMap=<T extends SnapshotEndpointResponses|SnapshotTriangleResponses>(values:Record<string,T>)=>Object.fromEntries(Object.entries(values).map(([id,value])=>[id,responses(value)]));
 const removedTrackIdsBySnapshot=new Map<string,Set<string>>();
 const recordings=after.recordings.map(recording=>{
  const liveLayers=new Set(snapshots.filter(snapshot=>recording.snapshotIds.includes(snapshot.id)).flatMap(snapshot=>snapshot.layers.map(layer=>layer.id))),deadLayers=new Set([...removedLayerIds].filter(id=>!liveLayers.has(id)));
  const liveRelations=new Set(snapshots.filter(snapshot=>recording.snapshotIds.includes(snapshot.id)).flatMap(snapshot=>[snapshot.deformation,snapshot.inheritedState,snapshot.draft?.deformation].flatMap(state=>Object.keys(state?.relationPositions??{}))));
  const deadRelations=new Set(recording.snapshotIds.flatMap(id=>[...removedRelationsBySnapshot.get(id)??[]]).filter(id=>!liveRelations.has(id)));
  const removeTrack=(id:string)=>{for(const snapshotId of recording.snapshotIds){const ids=removedTrackIdsBySnapshot.get(snapshotId)??new Set<string>();ids.add(id);removedTrackIdsBySnapshot.set(snapshotId,ids);}};
  const tracks=recording.tracks.flatMap<SnapshotPoseTrack>(track=>{
   if(deadLayers.has(track.targetId)||track.elementId&&removed.has(track.elementId)||track.channel==='relationPosition'&&(deadRelations.has(track.targetId)||removed.has(track.targetId))||track.channel==='interval'&&(removed.has(track.sourceTrackId)||track.keys.some(key=>key.value.appearance&&intervalDepends(key.value.appearance))||track.draft?.value.appearance&&intervalDepends(track.draft.value.appearance))){removeTrack(track.id);return [];}
   if(track.channel==='shape')return [{...track,keys:track.keys.map(key=>({...key,value:shape(key.value)})),...(track.draft?{draft:{...track.draft,value:shape(track.draft.value)}}:{})}];
   if(track.channel==='interval')return [{...track,keys:track.keys.map(key=>({...key,value:interval(key.value)})),...(track.draft?{draft:{...track.draft,value:interval(track.draft.value)}}:{})}];
   return [track];
  });
  const pair=recording.endpointPair,graph=recording.angleGraph;
  const propertyResponses=(values:SnapshotPropertyResponses):SnapshotPropertyResponses=>{
   const active=(value:{target:{layerId:string;sourceTrackId:string;rangeId:string}})=>!deadLayers.has(value.target.layerId)&&!removed.has(value.target.sourceTrackId)&&!removed.has(value.target.rangeId);
   return {edges:Object.fromEntries(Object.entries(values.edges).map(([id,entries])=>[id,entries.filter(active)])),triangles:Object.fromEntries(Object.entries(values.triangles).map(([id,entries])=>[id,entries.filter(active)]))};
  };
  return {...recording,tracks,
   ...(pair?{endpointPair:{...pair,...(pair.responses?{responses:responses(pair.responses)}:{}),...(pair.draft?{draft:{...pair.draft,responses:responses(pair.draft.responses)}}:{})}}:{}),
   ...(graph?{angleGraph:{...graph,...(graph.propertyResponses?{propertyResponses:propertyResponses(graph.propertyResponses)}:{}),edgeResponses:responseMap(graph.edgeResponses),triangleResponses:responseMap(graph.triangleResponses),...(graph.correctionFrames?{correctionFrames:graph.correctionFrames.map(frame=>({...frame,...(frame.propertyResponses?{propertyResponses:propertyResponses(frame.propertyResponses)}:{}),...(frame.edgeResponses?{edgeResponses:responseMap(frame.edgeResponses)}:{}),...(frame.triangleResponses?{triangleResponses:responseMap(frame.triangleResponses)}:{})}))}:{})}}:{}),
  };
 });
 return {...after,library:{nodes:without(after.library.nodes,removed),curves:without(after.library.curves,removed),fills:without(after.library.fills,removed),offsets:without(after.library.offsets,removed)},snapshots:snapshots.map(snapshot=>({...snapshot,authored:snapshot.authored.filter(ref=>!removedTrackIdsBySnapshot.get(snapshot.id)?.has(ref.trackId)),...(snapshot.draft?{draft:{...snapshot.draft,channels:snapshot.draft.channels.filter(ref=>!removedTrackIdsBySnapshot.get(snapshot.id)?.has(ref.trackId))}}:{})})),recordings};
}
