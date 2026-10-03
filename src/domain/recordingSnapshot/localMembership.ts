import type {Cubic} from '../drawing/model';
import type {RecordingSnapshotWorkspace} from './model';

/** Contract for a reference layer. Absent membership means live,
 * complete inheritance. These IDs are membership, never geometry or pose keys. */
export interface SnapshotLocalMembership {
 addElementIds?:readonly string[];
 excludeElementIds?:readonly string[];
}

function uniqueIds(values:readonly string[],label:string):void {
 if(values.some(value=>typeof value!=='string'||!value)||new Set(values).size!==values.length)throw Error(`${label} must contain distinct nonempty canonical IDs.`);
}

export function validateSnapshotLocalMembership(membership:SnapshotLocalMembership):void {
 const added=membership.addElementIds??[],excluded=membership.excludeElementIds??[];
 uniqueIds(added,'Local additions');uniqueIds(excluded,'Local exclusions');
 if(added.some(id=>excluded.includes(id)))throw Error('An element cannot be both added and excluded in one membership patch.');
}

/** Missing parent state is represented by an empty parent list, so independently
 * authored local members can still resolve while the caller reports provenance.
 * Geometry lookup/ownership checks belong to the transaction/evaluation layer. */
export function resolveSnapshotLocalMembership(parentElementIds:readonly string[],membership:SnapshotLocalMembership={}):{
 elementIds:string[];inheritedElementIds:string[];localElementIds:string[];
} {
 uniqueIds(parentElementIds,'Parent members');validateSnapshotLocalMembership(membership);
 const excluded=new Set(membership.excludeElementIds),parent=new Set(parentElementIds);
 const inheritedElementIds=parentElementIds.filter(id=>!excluded.has(id));
 const localElementIds=(membership.addElementIds??[]).filter(id=>!parent.has(id));
 return {elementIds:[...inheritedElementIds,...localElementIds],inheritedElementIds,localElementIds};
}

/** Remove an ID from this reference only. Keep tombstones even if a parent
 * temporarily loses the member; a later source restoration must stay excluded.
 * Removing a local original releases its local membership, never its library ID. */
export function excludeSnapshotLocalMembers(membership:SnapshotLocalMembership,elementIds:readonly string[]):SnapshotLocalMembership {
 validateSnapshotLocalMembership(membership);uniqueIds(elementIds,'Removed members');
 const added=new Set(membership.addElementIds),removed=new Set(elementIds);
 const addElementIds=[...added].filter(id=>!removed.has(id));
 const excludeElementIds=[...new Set([...(membership.excludeElementIds??[]),...elementIds.filter(id=>!added.has(id))])];
 return {...(addElementIds.length?{addElementIds}:{}),...(excludeElementIds.length?{excludeElementIds}:{})};
}

export type SnapshotMembershipCommand=
 | {op:'createLocalCurve';layerId:string;/** Layer-input controls, before this snapshot's local deformation. */shape:Cubic;width?:number;name?:string;ref?:string}
 | {op:'excludeElements'|'restoreElements';layerId:string;elementIds:string[]};

/** Mutates only a caller-owned transaction draft. The explicit target lets
 * Drawing and Recording share this operation without changing active Recording.
 * Real-frame angle gating belongs to the room/facade that owns the cursor. */
export function applySnapshotMembershipEdit(workspace:RecordingSnapshotWorkspace,snapshotId:string,command:SnapshotMembershipCommand,fresh:()=>string):{createdCurveId?:string;createdNodeIds:string[];removedIds:string[]} {
 const snapshot=workspace.snapshots.find(value=>value.id===snapshotId);if(!snapshot)throw Error('Local membership target snapshot is missing.');
 const layer=snapshot.layers.find(value=>value.id===command.layerId);if(!layer)throw Error('Local membership target layer is missing.');
 if(layer.kind!=='reference')throw Error('Local membership edits require a referenced layer; edit owned originals through their source adapter.');
 const before=layer.membership??{};validateSnapshotLocalMembership(before);
 if(command.op==='createLocalCurve'){
  const shape=command.shape,width=command.width??.01,name=command.name??'Local curve';
  if(!Array.isArray(shape)||shape.length!==4||shape.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)))throw Error('Local curve shape must contain four finite layer-input points.');
  if(!Number.isFinite(width)||width<=0||width>1||typeof name!=='string'||!name.trim()||name.length>256)throw Error('Local curve name or width is invalid.');
  const curveId=fresh(),nodeIds=[fresh(),fresh()] as [string,string],allocated=[curveId,...nodeIds];uniqueIds(allocated,'New canonical IDs');
  if(allocated.some(id=>Object.values(workspace.library).some(map=>Object.hasOwn(map,id))))throw Error('Local curve ID collides with an existing canonical element.');
  workspace.library.nodes[nodeIds[0]]={id:nodeIds[0],position:[...shape[0]]};workspace.library.nodes[nodeIds[1]]={id:nodeIds[1],position:[...shape[3]]};
  workspace.library.curves[curveId]={id:curveId,name:name.trim(),nodes:nodeIds,handles:[[...shape[1]],[...shape[2]]],width,visible:true,locked:false};
  layer.membership={...before,addElementIds:[...(before.addElementIds??[]),curveId]};
  return {createdCurveId:curveId,createdNodeIds:nodeIds,removedIds:[]};
 }
 uniqueIds(command.elementIds,'Membership edit IDs');if(!command.elementIds.length)throw Error('Select at least one member.');
 if(command.op==='excludeElements'){
  for(const id of command.elementIds)if(!Object.hasOwn(workspace.library.curves,id)&&!Object.hasOwn(workspace.library.fills,id)&&!Object.hasOwn(workspace.library.offsets,id))throw Error(`Canonical member ${id} does not exist.`);
  layer.membership=excludeSnapshotLocalMembers(before,command.elementIds) as NonNullable<typeof layer.membership>;
 }else{
  const restored=new Set(command.elementIds),remaining=(before.excludeElementIds??[]).filter(id=>!restored.has(id));
  layer.membership={...(before.addElementIds?.length?{addElementIds:[...before.addElementIds]}:{}),...(remaining.length?{excludeElementIds:remaining}:{})};
 }
 if(!layer.membership.addElementIds?.length&&!layer.membership.excludeElementIds?.length)delete layer.membership;
 return {createdNodeIds:[],removedIds:command.op==='excludeElements'?[...command.elementIds]:[]};
}

/** Resolved structural membership at real snapshots. Correction frames never
 * enter the triangulation and are not sources of membership. */
export interface SnapshotPresenceMembership {
 snapshotId:string;
 elementIds:readonly string[];
}

/** Structural subset of locateSnapshotSimplex output. Weights are the ORIGINAL
 * geometric barycentric weights, before inverse/response correction. */
export interface SnapshotPresenceSimplex {
 snapshotIds:readonly string[];
 geometricWeights:readonly number[];
}

/** Intersect only the located simplex's active vertices. No ID-dependent
 * triangulation, global nearest-ID search, epsilon threshold or response-weight
 * interpretation is allowed here. Exact geometric predicates belong to the
 * shared triangulation; its true boundary vertices carry exactly zero weight. */
export function resolveSnapshotSimplexPresence(simplex:SnapshotPresenceSimplex|null,memberships:readonly SnapshotPresenceMembership[]):{
 kind:'outside'|'vertex'|'edge'|'triangle';activeSnapshotIds:string[];elementIds:string[];
} {
 if(!simplex)return {kind:'outside',activeSnapshotIds:[],elementIds:[]};
 const {snapshotIds,geometricWeights}=simplex;
 if(!snapshotIds.length||snapshotIds.length>3||snapshotIds.length!==geometricWeights.length)throw Error('Presence simplex needs one to three matched geometric vertices.');
 uniqueIds(snapshotIds,'Simplex snapshots');uniqueIds(memberships.map(sample=>sample.snapshotId),'Membership snapshots');
 if(geometricWeights.some(weight=>!Number.isFinite(weight)||weight<0)||Math.abs(geometricWeights.reduce((sum,weight)=>sum+weight,0)-1)>64*Number.EPSILON)throw Error('Presence requires normalized nonnegative original geometric weights.');
 const activeSnapshotIds=snapshotIds.filter((_,index)=>geometricWeights[index]!==0);
 if(!activeSnapshotIds.length)throw Error('Presence simplex has no active geometric vertices.');
 const active=activeSnapshotIds.map(id=>memberships.find(sample=>sample.snapshotId===id)??(()=>{throw Error(`Missing real snapshot membership: ${id}`);})());
 for(const sample of active)uniqueIds(sample.elementIds,'Snapshot members');
 const others=active.slice(1).map(sample=>new Set(sample.elementIds));
 return {kind:active.length===1?'vertex':active.length===2?'edge':'triangle',activeSnapshotIds,elementIds:active[0].elementIds.filter(id=>others.every(members=>members.has(id)))};
}
