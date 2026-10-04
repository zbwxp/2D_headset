import type {RecordingSnapshotWorkspace,SnapshotDeformationState,SnapshotAngleGraph} from './model';

/** One coarse change vocabulary for transaction propagation and prepared
 * evaluation. These are invalidation hints; semantic dependency tokens remain
 * authoritative and must not treat an unrelated source revision as a miss. */
export interface PreparedRecordingChanges {
 source?:boolean;
 sourceSnapshots?:readonly string[];
 structure?:readonly string[];
 geometry?:readonly string[];
 drafts?:readonly string[];
 responses?:readonly string[];
 material?:readonly string[];
 relations?:readonly string[];
 mirrors?:readonly string[];
 mesh?:readonly string[];
}
const different=(a:unknown,b:unknown)=>a!==b;
const hasChanged=(a:object|undefined,b:object|undefined,keys:readonly string[])=>keys.some(key=>different((a as Record<string,unknown>|undefined)?.[key],(b as Record<string,unknown>|undefined)?.[key]));
const blank=(value:unknown)=>value===undefined||!!value&&typeof value==='object'&&Object.keys(value).length===0;
const nonemptyChanged=(a:object|undefined,b:object|undefined,keys:readonly string[])=>keys.some(key=>{const x=(a as Record<string,unknown>|undefined)?.[key],y=(b as Record<string,unknown>|undefined)?.[key];return x!==y&&!(blank(x)&&blank(y));});
function deformationChanges(a:SnapshotDeformationState|undefined,b:SnapshotDeformationState|undefined):{geometry:boolean;material:boolean} {
 if(a===b)return {geometry:false,material:false};
 let geometry=nonemptyChanged(a,b,['warps','bindings','layerDomains','relationPositions']),material=nonemptyChanged(a,b,['intervalMaterialIssues']);
 for(const id of new Set([...Object.keys(a?.layers??{}),...Object.keys(b?.layers??{})])){
  const x=a?.layers[id],y=b?.layers[id];if(x===y)continue;
  geometry ||= hasChanged(x,y,['placement','elementPlacements','shape']);
  material ||= hasChanged(x,y,['visibility','curveAppearance','paintAppearance','intervals','depth']);
 }
 return {geometry,material};
}
function frameFields(graph:SnapshotAngleGraph|undefined,kind:'geometry'|'material'):unknown[][] {
 return (graph?.correctionFrames??[]).flatMap(frame=>{
  const values=kind==='geometry'?[frame.edgeResponses,frame.triangleResponses,frame.responseExpressions,frame.basisAdjustment]:[frame.propertyResponses];
  return values.some(value=>value!==undefined)?[[frame.id,frame.status,frame.angle.x,frame.angle.y,...values]]:[];
 });
}
const sameRows=(a:unknown[][],b:unknown[][])=>a.length===b.length&&a.every((row,i)=>row.length===b[i].length&&row.every((value,j)=>value===b[i][j]));

/** Classify a completed immutable candidate once. Never cache a partially
 * mutated external command batch by object identity. */
export function classifyRecordingWorkspaceChanges(before:RecordingSnapshotWorkspace|undefined,after:RecordingSnapshotWorkspace):PreparedRecordingChanges {
 const sourceSnapshots=new Set<string>(),structure=new Set<string>(),geometry=new Set<string>(),drafts=new Set<string>(),responses=new Set<string>(),material=new Set<string>(),relations=new Set<string>(),mirrors=new Set<string>(),mesh=new Set<string>();
 const prior=new Map((before?.snapshots??[]).map(snapshot=>[snapshot.id,snapshot])),next=new Map(after.snapshots.map(snapshot=>[snapshot.id,snapshot]));
 for(const id of new Set([...prior.keys(),...next.keys()])){
  const a=prior.get(id),b=next.get(id);if(a===b)continue;
  if(!a||!b){structure.add(id);geometry.add(id);if(a?.source||b?.source)sourceSnapshots.add(id);continue;}
  if(hasChanged(a,b,['layers','parentSnapshotId','parentLayers','memberSources','nodeAliases','nodeForks','objectLocks','source']))structure.add(id);
  if(a.source!==b.source)sourceSnapshots.add(id);
  if(hasChanged(a.relations,b.relations,['joins','endpointLinks','groups']))relations.add(id);
  if(hasChanged(a.relations,b.relations,['displayIntervals']))material.add(id);
  if(a.inputMirror!==b.inputMirror||hasChanged(a.source,b.source,['mirrorAxisX','mirrorEditing']))mirrors.add(id);
  if(a.draft!==b.draft)drafts.add(id);
  for(const [x,y] of [[a.deformation,b.deformation],[a.inheritedState,b.inheritedState],[a.draft?.deformation,b.draft?.deformation]] as const){const changed=deformationChanges(x,y);if(changed.geometry)geometry.add(id);if(changed.material)material.add(id);}
  // Legacy saved-angle adapters may still influence a directly resolved node.
  if(a.angle.x!==b.angle.x||a.angle.y!==b.angle.y)geometry.add(id);
 }
 const recordings=new Map((before?.recordings??[]).map(recording=>[recording.id,recording]));
 for(const b of after.recordings){
  const a=recordings.get(b.id);recordings.delete(b.id);if(a===b)continue;
  const x=a?.angleGraph,y=b.angleGraph;
  if(!a||a.mode!==b.mode||a.snapshotIds!==b.snapshotIds||x?.mesh!==y?.mesh)mesh.add(b.id);
  if(x?.viewMirror!==y?.viewMirror)mirrors.add(b.id);
  if(!a||a.tracks!==b.tracks||hasChanged(x,y,['edgeResponses','triangleResponses','responseExpressions'])||!sameRows(frameFields(x,'geometry'),frameFields(y,'geometry')))responses.add(b.id);
  if(hasChanged(x,y,['propertyResponses','materialRecipes','materialBasisRecipes','materialPartitions','materialPathLineages','visibilityRecipes','visibilityBasisRecipes'])||!sameRows(frameFields(x,'material'),frameFields(y,'material')))material.add(b.id);
 }
 for(const id of recordings.keys())mesh.add(id);
 const result:PreparedRecordingChanges={};if(!before||before.library!==after.library)result.source=true;
 for(const [key,values] of Object.entries({sourceSnapshots,structure,geometry,drafts,responses,material,relations,mirrors,mesh}))if(values.size)Object.assign(result,{[key]:[...values].sort()});
 return result;
}

/** Membership propagation consumes source/structure changes, never pointer
 * coordinates or scalar response updates. Draft geometry has no saved-parent
 * membership effect. The evaluator separately handles live companion drafts. */
export function needsSnapshotLayerPropagation(changes:PreparedRecordingChanges):boolean {
 return !!(changes.source||changes.sourceSnapshots?.length||changes.structure?.length||changes.relations?.length||changes.mirrors?.length||changes.mesh?.length);
}

/** Reuse only old immutable fragments that equal already validated fresh data.
 * External inputs are still defensively copied by the parser before this step;
 * no new caller-owned object is adopted. Key order and -0 are preserved. */
export function shareValidatedRecordingWorkspace(before:RecordingSnapshotWorkspace|undefined,validated:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace {
 const share=(old:unknown,next:unknown):unknown=>{
  if(Object.is(old,next))return old;
  if(!old||!next||typeof old!=='object'||typeof next!=='object'||Array.isArray(old)!==Array.isArray(next))return next;
  if(Array.isArray(next)){
   const prior=old as unknown[],out=next.map((value,index)=>share(prior[index],value));
   return prior.length===out.length&&out.every((value,index)=>Object.is(value,prior[index]))?old:out;
  }
  const proto=Object.getPrototypeOf(next);if((proto!==Object.prototype&&proto!==null)||Object.getPrototypeOf(old)!==proto)return next;
  const a=old as Record<string,unknown>,b=next as Record<string,unknown>,keys=Object.keys(b),priorKeys=Object.keys(a),out=Object.create(proto) as Record<string,unknown>;
  let same=keys.length===priorKeys.length&&keys.every((key,index)=>key===priorKeys[index]);
  for(const key of keys){const value=share(a[key],b[key]);Object.defineProperty(out,key,{value,enumerable:true,writable:true,configurable:true});same&&=Object.is(value,a[key]);}
  return same?old:out;
 };
 return share(before,validated) as RecordingSnapshotWorkspace;
}
