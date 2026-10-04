import {resolveSnapshot} from './evaluation';
import {transferSnapshotMemberState} from './memberState';
import type {RecordingSnapshotWorkspace} from './model';

/** A source member keeps its canonical identity when its owning source layer
 * changes. Move existing descendant object records with that identity; their
 * values remain residuals over the newly live source, never captured poses. */
export function reconcileSnapshotSourceMemberMoves(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace,sourceId:string):RecordingSnapshotWorkspace {
 const prior=before.snapshots.find(snapshot=>snapshot.id===sourceId),source=after.snapshots.find(snapshot=>snapshot.id===sourceId);if(!prior||!source)return after;
 const owner=(snapshot:typeof source)=>new Map(snapshot.layers.flatMap(layer=>layer.kind==='original'?layer.items.map(id=>[id,layer.id] as const):[])),oldOwners=owner(prior),newOwners=owner(source);
 if(![...oldOwners].some(([id,layer])=>newOwners.has(id)&&newOwners.get(id)!==layer))return after;
 let workspace=after;
 for(const snapshot of after.snapshots){if(!before.snapshots.some(value=>value.id===snapshot.id))continue;
  const old=resolveSnapshot(before,snapshot.id,{useDraft:false,diagnostics:'preview'}).drawing,next=resolveSnapshot(workspace,snapshot.id,{useDraft:false,diagnostics:'preview'}).drawing,oldLayers=new Map(old.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const))),nextLayers=new Map(next.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const))),moves=[...oldLayers].flatMap(([id,from])=>{const to=nextLayers.get(id);return to&&to!==from?[{id,from,to}]:[];});if(!moves.length)continue;
  const local=structuredClone(snapshot),states=[local.deformation,...local.inheritedState?[local.inheritedState]:[],...local.draft?[local.draft.deformation]:[]],original=JSON.stringify(states);
  for(const state of states)transferSnapshotMemberState(state,old,next,moves);
  if(JSON.stringify(states)!==original)workspace={...workspace,snapshots:workspace.snapshots.map(value=>value.id===snapshot.id?local:value)};
 }
 return workspace;
}
