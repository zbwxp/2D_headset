import {type DrawingDocument,type StrokeDisplayIntervals,type CurveUse,type Endpoint} from '../drawing/model';
import {mapDisplayRouteReferences} from '../drawing/displayRoutes';
import type {DrawingSnapshotState} from '../drawing/snapshots';
import {recordingSceneSources} from '../recordingScene/sources';
import {displayPath} from '../drawing/displayIntervals';
import {transportDeformedIntervals} from '../drawing/deform';
import {applyIntervalOverrides,validateIntervalOverrides} from '../vectorRecording/intervals';
import {drawingSignature} from '../vectorRecording/model';
import {removeDeletedSourceReferences} from './sourceDeletion';
import {emptyRecordingSnapshot,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SceneIntervalValue,type SnapshotMaterialIssue,type SnapshotRelationPatch,type SnapshotRelationOverrides} from './model';

/** Canonical IDs are scoped by the legacy artwork identity, never its current
 * geometry. Two legacy artworks can reuse every raw ID and still be distinct. */
export const canonicalSourceId=(artworkId:string):string=>`source:${JSON.stringify([artworkId])}`;
/** Keep the original suffix verbatim: Drawing chooses path direction by source
 * ID ordering, and JSON escaping would change that order for punctuation. */
export const canonicalElementId=(artworkId:string,originalId:string):string=>`original:${artworkId.length}:${artworkId}:${originalId}`;

export function drawingIdentityIds(drawing:DrawingDocument):string[]{
 return [...drawing.nodes,...drawing.curves,...drawing.fills,...drawing.offsets,...drawing.layers,...drawing.joins,...(drawing.endpointLinks??[]),...(drawing.groups??[]),...(drawing.displayIntervals??[]),...(drawing.displayIntervals??[]).flatMap(t=>t.ranges),...(drawing.mirrorEditing?.curvePairs??[])].map(x=>x.id);
}

export function remapIntervalIdentities(track:StrokeDisplayIntervals,id:(id:string)=>string):StrokeDisplayIntervals{
 const use=(u:CurveUse):CurveUse=>({...u,id:id(u.id)});
 return {...structuredClone(track),id:id(track.id),anchor:use(track.anchor),...(track.displayRoute?{displayRoute:mapDisplayRouteReferences(track.displayRoute,id,id)}:{}),ranges:track.ranges.map(range=>({...structuredClone(range),id:id(range.id),...(range.originId?{originId:id(range.originId)}:{})}))};
}

/** Explicit field mapping deliberately excludes labels and arbitrary strings.
 * References to currently missing IDs are mapped too, preserving orphan data. */
export function remapDrawingIdentities(drawing:DrawingDocument,id:(id:string)=>string):DrawingDocument{
 const d=structuredClone(drawing),use=(u:CurveUse):CurveUse=>({...u,id:id(u.id)}),end=(e:Endpoint):Endpoint=>({...e,curveId:id(e.curveId)});
 return {...d,
  nodes:d.nodes.map(n=>({...n,id:id(n.id)})),
  curves:d.curves.map(c=>({...c,id:id(c.id),nodes:[id(c.nodes[0]),id(c.nodes[1])]})),
  fills:d.fills.map(f=>({...f,id:id(f.id),boundary:f.boundary.map(use)})),
  offsets:d.offsets.map(o=>({...o,id:id(o.id),source:o.source.map(use)})),
  layers:d.layers.map(l=>({...l,id:id(l.id),items:l.items.map(id)})),
  joins:d.joins.map(j=>({...j,id:id(j.id),a:end(j.a),b:end(j.b)})),
  ...(d.endpointLinks?{endpointLinks:d.endpointLinks.map(l=>({...l,id:id(l.id),a:end(l.a),b:end(l.b)}))}:{}),
  ...(d.groups?{groups:d.groups.map(g=>({...g,id:id(g.id),curveIds:g.curveIds.map(id)}))}:{}),
  ...(d.displayIntervals?{displayIntervals:d.displayIntervals.map(t=>remapIntervalIdentities(t,id))}:{}),
  ...(d.mirrorEditing?{mirrorEditing:{...d.mirrorEditing,curvePairs:d.mirrorEditing.curvePairs.map(p=>({...p,id:id(p.id),a:id(p.a),b:id(p.b)})),...(d.mirrorEditing.axisNodeIds?{axisNodeIds:d.mirrorEditing.axisNodeIds.map(id)}:{})}}:{}),
 };
}

export function drawingSnapshotForArtwork(workspace:RecordingSnapshotWorkspace,artworkId:string):RecordingSnapshot|undefined{
 return workspace.snapshots.find(snapshot=>snapshot.kind==='drawing'&&snapshot.source?.artworkId===artworkId);
}

/** The Drawing compatibility adapter owns only identities in originIds. A
 * source snapshot can also have its own references and residual local state. */
export function drawingSourceOwns(snapshot:RecordingSnapshot,id:string):boolean{
 return !!snapshot.source&&Object.hasOwn(snapshot.source.originIds,id);
}

function refreshSourceRelations(previous:RecordingSnapshot|undefined,canonical:DrawingDocument):SnapshotRelationOverrides{
 const refresh=<T extends {id:string}>(patch:SnapshotRelationPatch<T>|undefined,originals:T[]):SnapshotRelationPatch<T>=>({
  ...patch,add:[...originals,...(patch?.add??[]).filter(value=>!previous||!drawingSourceOwns(previous,value.id))],
 });
 return {joins:refresh(previous?.relations.joins,canonical.joins),endpointLinks:refresh(previous?.relations.endpointLinks,canonical.endpointLinks??[]),groups:refresh(previous?.relations.groups,canonical.groups??[]),displayIntervals:refresh(previous?.relations.displayIntervals,canonical.displayIntervals??[])};
}

/** Reconstruct original geometry from the canonical store. For a Drawing
 * adapter this is only its owned originals, before local relation overrides,
 * referenced layers and deformation. Material transport and legacy evaluation
 * must use the same baseline. This transient document is never serialized. */
export function materializeOriginalSnapshot(workspace:RecordingSnapshotWorkspace,snapshotId:string):DrawingDocument|undefined{
 const stored=workspace.snapshots.find(s=>s.id===snapshotId);if(!stored)return undefined;
 const snapshot:RecordingSnapshot=stored.source?{...stored,layers:stored.layers.filter(layer=>layer.kind==='original'&&drawingSourceOwns(stored,layer.id)),relations:Object.fromEntries(Object.entries(stored.relations).map(([kind,patch])=>[kind,{add:patch.add?.filter((value:{id:string})=>drawingSourceOwns(stored,value.id))??[]}]))}:stored;
 if(snapshot.layers.some(layer=>layer.kind!=='original'))return undefined;
 const layers=snapshot.layers.map(layer=>{const {kind,...rest}=layer;void kind;return structuredClone(rest) as DrawingDocument['layers'][number];}),items=new Set(layers.flatMap(l=>l.items));
 const curves=[...items].flatMap(id=>Object.hasOwn(workspace.library.curves,id)?[structuredClone(workspace.library.curves[id])]:[]),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 const relation=<T extends {id:string}>(patch:{add?:T[];update?:T[];disable?:string[]}|undefined):T[]=>{
  const map=new Map((patch?.add??[]).map(value=>[value.id,structuredClone(value)]));for(const value of patch?.update??[])map.set(value.id,structuredClone(value));for(const id of patch?.disable??[])map.delete(id);return [...map.values()];
 };
 return {version:3,layers,curves,nodes:[...nodeIds].flatMap(id=>Object.hasOwn(workspace.library.nodes,id)?[structuredClone(workspace.library.nodes[id])]:[]),fills:[...items].flatMap(id=>Object.hasOwn(workspace.library.fills,id)?[structuredClone(workspace.library.fills[id])]:[]),offsets:[...items].flatMap(id=>Object.hasOwn(workspace.library.offsets,id)?[structuredClone(workspace.library.offsets[id])]:[]),
  joins:relation(snapshot.relations.joins),endpointLinks:relation(snapshot.relations.endpointLinks),groups:relation(snapshot.relations.groups),displayIntervals:relation(snapshot.relations.displayIntervals),
  ...(snapshot.source?.reference?{reference:structuredClone(snapshot.source.reference)}:{}),...(snapshot.source?.mirrorAxisX!==undefined?{mirrorAxisX:snapshot.source.mirrorAxisX}:{}),...(snapshot.source?.mirrorEditing?{mirrorEditing:structuredClone(snapshot.source.mirrorEditing)}:{}),
 };
}

/** Ingest the full Drawing adapter document. IDs that already belong to this
 * source are reused, even after an unsaved source receives a library name. */
export function upsertDrawingSource(workspace:RecordingSnapshotWorkspace,artworkId:string,drawing:DrawingDocument,name='Drawing source'):RecordingSnapshotWorkspace{
 // Legacy Drawing deletion retains invalid paint paths. They are not live
 // originals and must not be re-imported on the next edit or reload.
 const curves=new Set(drawing.curves.map(curve=>curve.id)),removedPaint=new Set([...drawing.fills.filter(fill=>fill.boundary.some(use=>!curves.has(use.id))),...drawing.offsets.filter(offset=>offset.source.some(use=>!curves.has(use.id)))].map(value=>value.id));
 if(removedPaint.size)drawing={...drawing,fills:drawing.fills.filter(fill=>!removedPaint.has(fill.id)),offsets:drawing.offsets.filter(offset=>!removedPaint.has(offset.id)),layers:drawing.layers.map(layer=>({...layer,items:layer.items.filter(id=>!removedPaint.has(id))}))};
 const previous=drawingSnapshotForArtwork(workspace,artworkId),existing=new Map(Object.entries(previous?.source?.originIds??{}).map(([canonical,original])=>[original,canonical]));
 // The stable source snapshot retains its initial namespace after $working is
 // saved. New members must share that prefix so traversal ordering stays live.
 let identityScope=artworkId;if(previous?.id.startsWith('source:')){try{const parts=JSON.parse(previous.id.slice('source:'.length));if(Array.isArray(parts)&&parts.length===1&&typeof parts[0]==='string')identityScope=parts[0];}catch{/* A user-created source ID uses its explicit artwork scope. */}}
 // A promoted $working source still owns its initial namespace. A subsequent
 // unnamed document must allocate another namespace, never overwrite it.
 if(!previous){let suffix=2;const occupied=(scope:string)=>workspace.snapshots.some(snapshot=>snapshot.id===canonicalSourceId(scope))||Object.values(workspace.library).some(elements=>Object.keys(elements).some(id=>id.startsWith(canonicalElementId(scope,''))));while(occupied(identityScope))identityScope=`${artworkId}#${suffix++}`;}
 const id=(raw:string)=>existing.get(raw)??canonicalElementId(identityScope,raw),canonical=remapDrawingIdentities(drawing,id),originIds=Object.fromEntries(drawingIdentityIds(drawing).map(raw=>[id(raw),raw]));
 const deletedIds=new Set(Object.keys(previous?.source?.originIds??{}).filter(id=>!Object.hasOwn(originIds,id)));
 const originals=canonical.layers.map(layer=>({...layer,kind:'original' as const}));let nextOriginal=0;
 // Preserve local slots in order while refreshing the adapter's ordered slots.
 const layers=previous?previous.layers.flatMap(layer=>layer.kind==='original'&&drawingSourceOwns(previous,layer.id)?(nextOriginal<originals.length?[originals[nextOriginal++]]:[]):[layer]):[];
 layers.push(...originals.slice(nextOriginal));
 const source:RecordingSnapshot={...(previous??emptyRecordingSnapshot(canonicalSourceId(identityScope),name,'drawing')),name,layers,relations:refreshSourceRelations(previous,canonical),source:{artworkId,originIds,...(canonical.reference?{reference:canonical.reference}:{}),...(canonical.mirrorAxisX!==undefined?{mirrorAxisX:canonical.mirrorAxisX}:{}),...(canonical.mirrorEditing?{mirrorEditing:canonical.mirrorEditing}:{})}};
 const library={...workspace.library};let changed=JSON.stringify(previous)!==JSON.stringify(source);
 for(const kind of ['nodes','curves','fills','offsets'] as const){
  const entries=canonical[kind];let map=library[kind] as Record<string,{id:string}>;
  for(const element of entries)if(JSON.stringify(map[element.id])!==JSON.stringify(element)){if(map===workspace.library[kind])map={...map};map[element.id]=element;changed=true;}
  (library[kind] as Record<string,{id:string}>)=map;
 }
 if(!changed)return workspace;
 const refreshed={...workspace,library,snapshots:previous?workspace.snapshots.map(snapshot=>snapshot===previous?source:snapshot):[...workspace.snapshots,source]};
 return removeDeletedSourceReferences(workspace,refreshed,source.id,deletedIds);
}

/** Saving the working Drawing changes the adapter identity, never canonical
 * element identity or any downstream snapshot reference. */
export function remapWorkingSnapshotSource(workspace:RecordingSnapshotWorkspace|undefined,artworkId:string):RecordingSnapshotWorkspace|undefined{
 if(!workspace)return workspace;const source=drawingSnapshotForArtwork(workspace,'$working');if(!source?.source)return workspace;
 return {...workspace,snapshots:workspace.snapshots.map(s=>s===source?{...s,source:{...source.source!,artworkId}}:s)};
}

export type SnapshotSourceProject=DrawingSnapshotState&{recordingSnapshots?:RecordingSnapshotWorkspace};
/** The host commits this with the Drawing edit in the same Undo transaction. */
export function syncRecordingSnapshotSources<T extends SnapshotSourceProject>(project:T,_beforeProject?:SnapshotSourceProject):T{
 if(!project.recordingSnapshots)return project;let workspace=project.recordingSnapshots;
 for(const [artworkId,drawing] of Object.entries(recordingSceneSources(project))){
  const name=project.drawingSnapshots?.items.find(item=>item.id===artworkId)?.name??'Current drawing';workspace=upsertDrawingSource(workspace,artworkId,drawing,name);
 }
 if(workspace===project.recordingSnapshots)return project;
 workspace=transportSnapshotSourceIntervals(project.recordingSnapshots,workspace);
 return {...project,recordingSnapshots:workspace};
}

function moveSourceAppearance(appearance:StrokeDisplayIntervals,before:DrawingDocument,after:DrawingDocument):StrokeDisplayIntervals{
 const prior=before.displayIntervals?.find(track=>track.id===appearance.id),next=after.displayIntervals?.find(track=>track.id===appearance.id);if(!prior||!next)throw Error('The canonical source interval track is missing.');
 if(JSON.stringify(prior.ranges.map(range=>range.id).sort())!==JSON.stringify(next.ranges.map(range=>range.id).sort()))throw Error(`Recording interval ${appearance.id} cannot follow changed range identities; restore or explicitly replace its authored interval before editing the source.`);
 validateIntervalOverrides([appearance],before);validateIntervalOverrides([appearance],after);
 const path=displayPath(before,appearance.anchor.id);if(JSON.stringify(path)!==JSON.stringify(displayPath(after,appearance.anchor.id)))throw Error(`Recording interval ${appearance.id} cannot follow a changed source traversal.`);
 const original={...applyIntervalOverrides(before,[appearance]),displayIntervals:[appearance]},moved=transportDeformedIntervals(original,{...after,displayIntervals:[appearance]}),value=moved.displayIntervals?.find(track=>track.id===appearance.id);
 if(!value)throw Error(`Recording interval ${appearance.id} lost its source material.`);
 const restored=transportDeformedIntervals(moved,{...before,displayIntervals:moved.displayIntervals}).displayIntervals?.find(track=>track.id===appearance.id),closed=path.closed&&appearance.scope!=='CURVE';
 for(const range of appearance.ranges){const roundtrip=restored?.ranges.find(r=>r.id===range.id);if(!roundtrip)throw Error(`Recording interval ${appearance.id} lost a source range.`);for(const side of ['start','end'] as const){const delta=Math.abs(range[side]-roundtrip[side]);if((closed?Math.min(delta,Math.abs(1-delta)):delta)>1e-8)throw Error(`Recording interval ${appearance.id} would lose a material cut in this source edit.`);}}
 validateIntervalOverrides([value],after);return value;
}

/** Rebase material fractions in every stored authored/fallback value, while
 * preserving enabled flags, key coordinates and draft ownership. Incompatible
 * material edits suspend only their affected channel, retaining all authored
 * bytes and allowing every other channel and the source edit to proceed. */
export function transportSnapshotSourceIntervals(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace{
 const sources=new Map<string,{before:DrawingDocument;after:DrawingDocument;sourceSnapshotId:string;beforeSignature:string;afterSignature:string}>();
 for(const snapshot of after.snapshots.filter(s=>s.kind==='drawing')){
  const prior=materializeOriginalSnapshot(before,snapshot.id),next=materializeOriginalSnapshot(after,snapshot.id);if(!prior||!next)continue;const beforeSignature=drawingSignature(prior),afterSignature=drawingSignature(next);
  for(const track of prior.displayIntervals??[])sources.set(track.id,{before:prior,after:next,sourceSnapshotId:snapshot.id,beforeSignature,afterSignature});
 }
 if(!sources.size)return after;
 const currentSignature=(issue:SnapshotMaterialIssue)=>{const current=materializeOriginalSnapshot(after,issue.sourceSnapshotId);return current&&drawingSignature(current);};
 const process=<T,>(trackId:string,values:T[],map:(value:T,move:(appearance:StrokeDisplayIntervals)=>StrokeDisplayIntervals)=>T,issue?:SnapshotMaterialIssue):{values:T[];issue?:SnapshotMaterialIssue}=>{
  if(issue){if(currentSignature(issue)===issue.sourceSignature)return {values};return {values,issue};}
  const source=sources.get(trackId);if(!source||source.beforeSignature===source.afterSignature)return {values};
  try{return {values:values.map(value=>map(value,appearance=>moveSourceAppearance(appearance,source.before,source.after)))};}catch(error){return {values,issue:{sourceSnapshotId:source.sourceSnapshotId,sourceSignature:source.beforeSignature,message:error instanceof Error?error.message:String(error)}};}
 };
 const valueMap=(value:SceneIntervalValue,move:(appearance:StrokeDisplayIntervals)=>StrokeDisplayIntervals):SceneIntervalValue=>!value.appearance?value:{...value,appearance:move(value.appearance)};
 const state=(value:SnapshotDeformationState):SnapshotDeformationState=>{
  const issues={...value.intervalMaterialIssues},layers=Object.fromEntries(Object.entries(value.layers).map(([id,layer])=>{if(!layer.intervals)return [id,layer];return [id,{...layer,intervals:Object.fromEntries(Object.entries(layer.intervals).map(([trackId,value])=>{const result=process(trackId,[value],valueMap,issues[trackId]);if(result.issue)issues[trackId]=result.issue;else delete issues[trackId];return [trackId,result.values[0]];}))}];}));
  const {intervalMaterialIssues,...rest}=value;void intervalMaterialIssues;return {...rest,layers,...(Object.keys(issues).length?{intervalMaterialIssues:issues}:{})};
 };
 const recordings=after.recordings.map(recording=>({...recording,tracks:recording.tracks.map(track=>{
  if(track.channel!=='interval')return track;
  const values=[...track.keys.map(key=>key.value),...(track.draft?[track.draft.value]:[])],result=process(track.sourceTrackId,values,valueMap,track.materialIssue),{materialIssue,...rest}=track;void materialIssue;
  return {...rest,keys:track.keys.map((key,index)=>({...key,value:result.values[index]})),...(track.draft?{draft:{...track.draft,value:result.values[track.keys.length]}}:{}),...(result.issue?{materialIssue:result.issue}:{})};
 })}));
 const snapshots=after.snapshots.map(snapshot=>{
  const deformation=state(snapshot.deformation),issues={...deformation.intervalMaterialIssues},patch=snapshot.relations.displayIntervals;
  const movePatch=(values:StrokeDisplayIntervals[]|undefined,originals=false)=>values?.map(value=>{if(originals&&drawingSourceOwns(snapshot,value.id))return value;const result=process(value.id,[value],(value,move)=>move(value),issues[value.id]);if(result.issue)issues[value.id]=result.issue;else delete issues[value.id];return result.values[0];});
  const relations={...snapshot.relations,...(patch?{displayIntervals:{...patch,...(patch.add?{add:movePatch(patch.add,true)}:{}),...(patch.update?{update:movePatch(patch.update)}:{})}}:{})};
  if(Object.keys(issues).length)deformation.intervalMaterialIssues=issues;else delete deformation.intervalMaterialIssues;
  return {...snapshot,deformation,...(snapshot.inheritedState?{inheritedState:state(snapshot.inheritedState)}:{}),...(snapshot.draft?{draft:{...snapshot.draft,deformation:state(snapshot.draft.deformation)}}:{}),relations};
 });
 return {...after,recordings,snapshots};
}
