import {layerFor,nodeAt,type DrawingDocument,type StrokeDisplayIntervals} from '../drawing/model';
import {linkedNodeIds} from '../drawing/endpointLinks';
import {localDisplayPath} from '../drawing/displayIntervals';
import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {drawingSourceOwns} from './sources';
import type {RecordingSnapshot,SnapshotRelationCollection,SnapshotRelationPatch} from './model';

/** Explicit host intent for a relation command. Geometry changes made by that
 * command belong to this Snapshot, including a source-owned follower. A direct
 * node/handle command does not acquire this intent from its geometry diff. */
export interface SnapshotRelationAuthoringIntent {
 readonly kind:'snapshot-relation-authoring';
 readonly snapshotId:string;
 readonly endpointLinkIds:readonly string[];
 readonly displayIntervalIds:readonly string[];
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const changedIds=<T extends {id:string}>(before:readonly T[],after:readonly T[])=>[...new Set([...before,...after].map(value=>value.id))].filter(id=>!same(before.find(value=>value.id===id),after.find(value=>value.id===id))).sort();

/** Call only at an explicit link, unlink, route, brush or interval command
 * entry. The document diff records its relation IDs, never infers its cause. */
export function createSnapshotRelationAuthoringIntent(snapshotId:string,before:DrawingDocument,after:DrawingDocument):SnapshotRelationAuthoringIntent|undefined {
 if(!snapshotId)throw Error('A relation authoring intent requires its owning Snapshot.');
 const endpointLinkIds=changedIds(before.endpointLinks??[],after.endpointLinks??[]),displayIntervalIds=changedIds(before.displayIntervals??[],after.displayIntervals??[]);
 return endpointLinkIds.length||displayIntervalIds.length?{kind:'snapshot-relation-authoring',snapshotId,endpointLinkIds,displayIntervalIds}:undefined;
}
export function mapSnapshotRelationAuthoringIntent(intent:SnapshotRelationAuthoringIntent,id:(id:string)=>string):SnapshotRelationAuthoringIntent {
 return {...intent,endpointLinkIds:intent.endpointLinkIds.map(id),displayIntervalIds:intent.displayIntervalIds.map(id)};
}

/** Use the authored route's actual traversal. An anchor alone does not identify
 * the owner of a through-display interval. Invalid routes must not fall back to
 * their anchor's local stroke when deciding which source may be written. */
function intervalCurveIds(drawing:DrawingDocument,track:StrokeDisplayIntervals):string[] {
 if(track.scope==='CURVE')return [track.anchor.id];
 if(!track.displayRoute)return localDisplayPath(drawing,track.anchor.id).segments.map(use=>use.id);
 const resolved=resolveDisplayRoute(drawing,track.displayRoute);
 if(resolved.diagnostics.length)throw Error(`Cannot resolve relation ownership: ${resolved.diagnostics[0].message}`);
 const links=resolved.usedLinkIds.map(id=>drawing.endpointLinks!.find(link=>link.id===id)!);
 return [...new Set([...resolved.path.segments.map(use=>use.id),...links.flatMap(link=>[link.a.curveId,link.b.curveId])])];
}
export function snapshotRelationCurveIds<K extends keyof SnapshotRelationCollection>(drawing:DrawingDocument,kind:K,value:SnapshotRelationCollection[K][number]):string[] {
 if(kind==='displayIntervals')return intervalCurveIds(drawing,value as StrokeDisplayIntervals);
 if(kind==='groups')return [...(value as SnapshotRelationCollection['groups'][number]).curveIds];
 const link=value as SnapshotRelationCollection['endpointLinks'][number];return [link.a.curveId,link.b.curveId];
}
export type SnapshotDrawingWriteOwner='source-original'|'snapshot-local';
/** New Pen identities use this layer owner: source originals go through source
 * synchronization; reference additions retain their new canonical IDs verbatim. */
export function snapshotLayerWriteOwner(snapshot:RecordingSnapshot,layerId:string):SnapshotDrawingWriteOwner {
 const layer=snapshot.layers.find(value=>value.id===layerId);if(!layer)throw Error('The edited Snapshot layer no longer exists.');
 return layer.kind==='original'&&drawingSourceOwns(snapshot,layerId)?'source-original':'snapshot-local';
}
export function snapshotRelationWriteOwner<K extends keyof SnapshotRelationCollection>(snapshot:RecordingSnapshot,drawing:DrawingDocument,kind:K,value:SnapshotRelationCollection[K][number]):SnapshotDrawingWriteOwner {
 const ids=snapshotRelationCurveIds(drawing,kind,value),layers=new Set(ids.map(id=>{const layer=layerFor(drawing,id);if(!layer)throw Error('A relation member has no current Snapshot layer.');return layer.id;}));
 const patch=snapshot.relations[kind];
 if(ids.some(id=>Object.hasOwn(snapshot.memberSources??{},id)||!drawingSourceOwns(snapshot,id)&&snapshot.layers.some(layer=>layer.membership?.addElementIds?.includes(id)))||layers.size!==1||patch?.update?.some(relation=>relation.id===value.id)||patch?.disable?.includes(value.id)||patch?.add?.some(relation=>relation.id===value.id&&!drawingSourceOwns(snapshot,value.id)))return 'snapshot-local';
 return snapshotLayerWriteOwner(snapshot,[...layers][0]);
}

export interface SnapshotRelationAuthoringScope {
 readonly curveIds:ReadonlySet<string>;
 readonly nodeIds:ReadonlySet<string>;
 readonly endpointLinkIds:ReadonlySet<string>;
 readonly displayIntervalIds:ReadonlySet<string>;
}
/** This scope is the command's local residual domain. It includes both old and
 * new traversals (detach/unlink included) and existing linked followers, using
 * Drawing's component resolver rather than another endpoint binding engine. */
export function resolveSnapshotRelationAuthoringScope(intent:SnapshotRelationAuthoringIntent,snapshotId:string,before:DrawingDocument,after:DrawingDocument):SnapshotRelationAuthoringScope {
 const expected=createSnapshotRelationAuthoringIntent(snapshotId,before,after);
 if(intent.kind!=='snapshot-relation-authoring'||intent.snapshotId!==snapshotId||!expected||!same([...intent.endpointLinkIds].sort(),expected.endpointLinkIds)||!same([...intent.displayIntervalIds].sort(),expected.displayIntervalIds))throw Error('The Snapshot relation intent and command result no longer agree.');
 const curveIds=new Set<string>(),nodeIds=new Set<string>(),endpointLinkIds=new Set(intent.endpointLinkIds),displayIntervalIds=new Set(intent.displayIntervalIds);
 for(const drawing of [before,after]){
  const seeds=new Set<string>();
  for(const link of drawing.endpointLinks??[])if(endpointLinkIds.has(link.id)){seeds.add(nodeAt(drawing,link.a).id);seeds.add(nodeAt(drawing,link.b).id);}
  for(const track of drawing.displayIntervals??[])if(displayIntervalIds.has(track.id))for(const id of intervalCurveIds(drawing,track))curveIds.add(id);
  for(const nodeId of seeds)for(const linked of linkedNodeIds(drawing,nodeId))nodeIds.add(linked);
  for(const curve of drawing.curves)if(curve.nodes.some(id=>nodeIds.has(id)))curveIds.add(curve.id);
 }
 // A brush may reorient a handle at either end of an incident curve. The host
 // excludes all these controls from its source write for this explicit action.
 for(const drawing of [before,after])for(const curve of drawing.curves)if(curveIds.has(curve.id))curve.nodes.forEach(id=>nodeIds.add(id));
 return {curveIds,nodeIds,endpointLinkIds,displayIntervalIds};
}

/** One relation patch operation for both hosts. Adapter-owned add entries are
 * immutable source baselines; a local override uses update/disable. A local
 * add remains an add, and deleting it does not invent an inherited tombstone. */
export function patchSnapshotRelations<T extends {id:string}>(patch:SnapshotRelationPatch<T>|undefined,before:readonly T[],after:readonly T[],isSourceOwned:(id:string)=>boolean):SnapshotRelationPatch<T>|undefined {
 const previous=new Map(before.map(value=>[value.id,value])),next=new Map(after.map(value=>[value.id,value])),result=structuredClone(patch??{});
 for(const value of before)if(!next.has(value.id)){
  const ownAdd=result.add?.some(item=>item.id===value.id)&&!isSourceOwned(value.id);
  result.add=result.add?.filter(item=>item.id!==value.id||isSourceOwned(item.id));result.update=result.update?.filter(item=>item.id!==value.id);
  if(ownAdd)result.disable=result.disable?.filter(id=>id!==value.id);else result.disable=[...new Set([...(result.disable??[]),value.id])];
 }
 for(const value of after)if(!same(previous.get(value.id),value)){
  const inherited=!!result.update?.some(item=>item.id===value.id)||!!result.disable?.includes(value.id);
  const ownAdd=!!result.add?.some(item=>item.id===value.id)&&!isSourceOwned(value.id);
  result.disable=result.disable?.filter(id=>id!==value.id);
  const operation=!isSourceOwned(value.id)&&(ownAdd||!previous.has(value.id)&&!inherited)?'add':'update';
  result[operation]=[...(result[operation]??[]).filter(item=>item.id!==value.id),structuredClone(value)];
 }
 for(const operation of ['add','update','disable'] as const)if(!result[operation]?.length)delete result[operation];
 return Object.keys(result).length?result:undefined;
}
