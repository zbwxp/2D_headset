import type {RecordingSnapshotWorkspace} from './model';
import type {SnapshotScalarTarget,SnapshotSimplexRevisionChanges} from './simplexGeometry';

/** Private runtime provenance for completed, immutable geometry transactions.
 * It contains addresses only and is never a serialized approximation of an edit.
 * Unknown external changes retain the canonical full evaluation path. */
interface ControlRevision {
 readonly before:RecordingSnapshotWorkspace;
 readonly recordingId:string;
 readonly changes:SnapshotSimplexRevisionChanges;
}
const revisions=new WeakMap<RecordingSnapshotWorkspace,ControlRevision>();
const targetKey=(target:SnapshotScalarTarget)=>JSON.stringify(target.kind==='node'?['node',target.nodeId]:['handle',target.curveId,target.end]);
const copyTarget=(target:SnapshotScalarTarget):SnapshotScalarTarget=>Object.freeze(target.kind==='node'?{kind:'node',nodeId:target.nodeId}:{kind:'handle',curveId:target.curveId,end:target.end});
function frozenChanges(changes:SnapshotSimplexRevisionChanges):SnapshotSimplexRevisionChanges {
 return {structureUnchanged:true,basisControls:new Map([...changes.basisControls].map(([id,targets])=>[id,Object.freeze(targets.map(copyTarget))])),responseControls:Object.freeze(changes.responseControls.map(copyTarget))};
}
/** Only a controlled target/capture or response writer may supply this complete
 * dependency set after validating ownership and unchanged structural content. */
export function registerPreparedControlChanges(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace,recordingId:string,changes:SnapshotSimplexRevisionChanges):void {
 if(before!==after)revisions.set(after,{before,recordingId,changes:frozenChanges(changes)});
}
/** A defensive validator may replace a candidate with an equal immutable copy.
 * Call only after validation/structural sharing, never on an unparsed import. */
export function retainPreparedControlChanges(validated:RecordingSnapshotWorkspace,candidate:RecordingSnapshotWorkspace):void {
 const revision=revisions.get(candidate);if(revision&&validated!==candidate)revisions.set(validated,revision);
}
/** Follow only recorded transaction ancestry. No whole scene comparison or
 * guessed selected-curve invalidation is used to construct the dirty closure. */
export function preparedControlChangesBetween(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace,recordingId:string):SnapshotSimplexRevisionChanges|undefined {
 const basis=new Map<string,Map<string,SnapshotScalarTarget>>(),responses=new Map<string,SnapshotScalarTarget>(),seen=new Set<RecordingSnapshotWorkspace>();
 let current=after;
 while(current!==before){
  if(seen.has(current))return undefined;seen.add(current);
  const revision=revisions.get(current);if(!revision||revision.recordingId!==recordingId)return undefined;
  for(const [id,targets] of revision.changes.basisControls){let out=basis.get(id);if(!out){out=new Map();basis.set(id,out);}for(const target of targets)out.set(targetKey(target),target);}
  for(const target of revision.changes.responseControls)responses.set(targetKey(target),target);
  current=revision.before;
 }
 return {structureUnchanged:true,basisControls:new Map([...basis].map(([id,targets])=>[id,[...targets.values()]])),responseControls:[...responses.values()]};
}
