import type {Cubic} from '../drawing/model';
import type {RecordingSnapshotWorkspace} from './model';
import {resolveSnapshot} from './evaluation';
import {layerCageCurveIds} from './layerCageScope';

/** Contract for a reference layer. Absent membership means live,
 * complete inheritance. These IDs are membership, never geometry or pose keys. */
export interface SnapshotLocalMembership {
 addElementIds?:readonly string[];
 excludeElementIds?:readonly string[];
 /** Listed live IDs keep this authored order; new parent members follow afterward. */
 orderOverride?:readonly string[];
}

function uniqueIds(values:readonly string[],label:string):void {
 if(values.some(value=>typeof value!=='string'||!value)||new Set(values).size!==values.length)throw Error(`${label} must contain distinct nonempty canonical IDs.`);
}

export function validateSnapshotLocalMembership(membership:SnapshotLocalMembership):void {
 const added=membership.addElementIds??[],excluded=membership.excludeElementIds??[];
 uniqueIds(added,'Local additions');uniqueIds(excluded,'Local exclusions');if(membership.orderOverride)uniqueIds(membership.orderOverride,'Local member order');
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
 const live=[...inheritedElementIds,...localElementIds],preferred=membership.orderOverride??[],positions=new Map(preferred.map((id,index)=>[id,index]));
 return {elementIds:preferred.length?live.sort((a,b)=>(positions.get(a)??Infinity)-(positions.get(b)??Infinity)):live,inheritedElementIds,localElementIds};
}

/** Remove an ID from this reference only. Keep tombstones even if a parent
 * temporarily loses the member; a later source restoration must stay excluded.
 * Removing a local original releases its local membership, never its library ID. */
export function excludeSnapshotLocalMembers(membership:SnapshotLocalMembership,elementIds:readonly string[]):SnapshotLocalMembership {
 validateSnapshotLocalMembership(membership);uniqueIds(elementIds,'Removed members');
 const added=new Set(membership.addElementIds),removed=new Set(elementIds);
 const addElementIds=[...added].filter(id=>!removed.has(id));
 const excludeElementIds=[...new Set([...(membership.excludeElementIds??[]),...elementIds.filter(id=>!added.has(id))])];
 return {...(addElementIds.length?{addElementIds}:{}),...(excludeElementIds.length?{excludeElementIds}:{}),...(membership.orderOverride?{orderOverride:membership.orderOverride.filter(id=>!removed.has(id))}:{})};
}

export type SnapshotMembershipCommand=
 | {op:'createLocalLayer';name?:string;ref?:string}
 | {op:'createLocalCurve';layerId:string;/** Layer-input controls, before this snapshot's local deformation. */shape:Cubic;width?:number;name?:string;ref?:string}
 | {op:'excludeElements'|'restoreElements';layerId:string;elementIds:string[]};

/** Mutates only a caller-owned transaction draft. The explicit target lets
 * Drawing and Recording share this operation without changing active Recording.
 * Real-frame angle gating belongs to the room/facade that owns the cursor. */
export function applySnapshotMembershipEdit(workspace:RecordingSnapshotWorkspace,snapshotId:string,command:SnapshotMembershipCommand,fresh:()=>string):{createdLayerId?:string;createdCurveId?:string;createdNodeIds:string[];removedIds:string[]} {
 const snapshot=workspace.snapshots.find(value=>value.id===snapshotId);if(!snapshot)throw Error('Local membership target snapshot is missing.');
 if(command.op==='createLocalLayer'){
  const name=command.name??'Local layer';if(typeof name!=='string'||!name.trim()||name.length>256)throw Error('Local layer name is invalid.');
  const layerId=fresh();if(!layerId||workspace.snapshots.some(value=>value.layers.some(layer=>layer.id===layerId))||Object.values(workspace.library).some(map=>Object.hasOwn(map,layerId)))throw Error('Local layer ID collides with an existing canonical identity.');
  snapshot.layers.unshift({kind:'original',id:layerId,name:name.trim(),visible:true,locked:false,items:[]});
  return {createdLayerId:layerId,createdNodeIds:[],removedIds:[]};
 }
 const layer=snapshot.layers.find(value=>value.id===command.layerId);if(!layer)throw Error('Local membership target layer is missing.');
 if(layer.kind==='original'&&Object.hasOwn(snapshot.source?.originIds??{},layer.id))throw Error('Edit Drawing-owned originals through their source adapter.');
 const before=layer.kind==='reference'?layer.membership??{}:{};validateSnapshotLocalMembership(before);
 if(command.op==='createLocalCurve'){
  const shape=command.shape,width=command.width??.01,name=command.name??'Local curve';
  if(!Array.isArray(shape)||shape.length!==4||shape.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)))throw Error('Local curve shape must contain four finite layer-input points.');
  if(!Number.isFinite(width)||width<=0||width>1||typeof name!=='string'||!name.trim()||name.length>256)throw Error('Local curve name or width is invalid.');
  const curveId=fresh(),nodeIds=[fresh(),fresh()] as [string,string],allocated=[curveId,...nodeIds];uniqueIds(allocated,'New canonical IDs');
  if(allocated.some(id=>Object.values(workspace.library).some(map=>Object.hasOwn(map,id))))throw Error('Local curve ID collides with an existing canonical element.');
  workspace.library.nodes[nodeIds[0]]={id:nodeIds[0],position:[...shape[0]]};workspace.library.nodes[nodeIds[1]]={id:nodeIds[1],position:[...shape[3]]};
  workspace.library.curves[curveId]={id:curveId,name:name.trim(),nodes:nodeIds,handles:[[...shape[1]],[...shape[2]]],width,visible:true,locked:false};
  if(layer.kind==='reference')layer.membership={...before,addElementIds:[...(before.addElementIds??[]),curveId]};else layer.items.unshift(curveId);
  return {createdCurveId:curveId,createdNodeIds:nodeIds,removedIds:[]};
 }
 if(layer.kind!=='reference')throw Error('Use the Drawing topology transaction to delete locally owned originals.');
 uniqueIds(command.elementIds,'Membership edit IDs');if(!command.elementIds.length)throw Error('Select at least one member.');
 if(command.op==='excludeElements'){
  for(const id of command.elementIds)if(!Object.hasOwn(workspace.library.curves,id)&&!Object.hasOwn(workspace.library.fills,id)&&!Object.hasOwn(workspace.library.offsets,id))throw Error(`Canonical member ${id} does not exist.`);
  const states=[snapshot.deformation,...snapshot.inheritedState?[snapshot.inheritedState]:[],...snapshot.draft?[snapshot.draft.deformation]:[]];
  if(states.some(state=>state.layerDomains?.some(domain=>domain.kind==='h-coons'&&domain.strokeScope))){const drawing=resolveSnapshot(workspace,snapshotId,{useDraft:true,diagnostics:'preview'}).drawing;for(const state of states)for(const domain of state.layerDomains??[])if(domain.kind==='h-coons'&&domain.strokeScope)domain.strokeScope={...domain.strokeScope,curveIds:[...new Set([...domain.strokeScope.curveIds,...layerCageCurveIds(drawing,domain)])]};}
  layer.membership=excludeSnapshotLocalMembers(before,command.elementIds) as NonNullable<typeof layer.membership>;
 }else{
  const restored=new Set(command.elementIds),remaining=(before.excludeElementIds??[]).filter(id=>!restored.has(id));
  layer.membership={...(before.addElementIds?.length?{addElementIds:[...before.addElementIds]}:{}),...(remaining.length?{excludeElementIds:remaining}:{}),...(before.orderOverride?{orderOverride:[...before.orderOverride]}:{})};
 }
 if(!layer.membership.addElementIds?.length&&!layer.membership.excludeElementIds?.length&&!layer.membership.orderOverride?.length)delete layer.membership;
 return {createdNodeIds:[],removedIds:command.op==='excludeElements'?[...command.elementIds]:[]};
}

export function validateSnapshotMemberSources(value:unknown):asserts value is Record<string,string> {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([id,source])=>!id||id.length>16384||typeof source!=='string'||!source||source.length>16384))throw Error('Invalid snapshot member source addresses.');
}
