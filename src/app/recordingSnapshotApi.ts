import {prepareSnapshotEdit,snapshotEditContext} from './snapshotEditTransaction';
import type {LandmarkProject} from '../domain/landmarks/model';
import {prepareSnapshotCommand,snapshotCommandStage,allSnapshotIds,SnapshotCommandError,snapshotCommandNames as allSnapshotCommandNames,type SnapshotCommand,type SnapshotCreation} from '../domain/recordingSnapshot/commands';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {evaluateRecordingSnapshot as evaluateWorkspace,resolveSnapshot,type SnapshotEvaluationOptions} from '../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshotWorkspace,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotRecording,type Angle} from '../domain/recordingSnapshot/model';
import {recordingPoseTrackIndex} from '../domain/recordingSnapshot/tracks';
import {recordingRetirementStatus,assertRecordingProjectActive,RECORDING_RETIRED_MESSAGE} from '../domain/recordingSnapshot/retirement';

const retiredCreationOps=new Set<SnapshotCommand['op']>(['createRecording','createEndpointPairRecording','createTriangulatedRecordingCopy']);
export const snapshotCommandNames=allSnapshotCommandNames.filter(op=>!retiredCreationOps.has(op));
export const recordingRetiredReason=RECORDING_RETIRED_MESSAGE;
export type {SnapshotCommand};
export interface SnapshotBatch {recordingId?:string;commands:SnapshotCommand[];expectedRevision?:string;dryRun?:boolean}
export interface SnapshotQuery {recordingId?:string;snapshotId?:string;layerIds?:string[];nameIncludes?:string;includeKeyValues?:boolean;expectedRevision?:string}
export class SnapshotApiError extends Error {constructor(readonly code:string,message:string,readonly commandIndex?:number){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotApiError(code,message);};
const object=(v:unknown,allowed:readonly string[]):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail('INVALID_REQUEST','Expected a JSON object.');const o=v as Record<string,unknown>,extra=Object.keys(o).filter(k=>!allowed.includes(k));if(extra.length)fail('INVALID_REQUEST',`Unknown fields: ${extra.join(', ')}`);return o;};
const id=(v:unknown):string=>typeof v==='string'&&!!v&&v.length<=16384?v:fail('INVALID_REQUEST','Expected an ID.');
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail('INVALID_REQUEST','Expected a boolean.');
const list=(v:unknown):string[]=>{if(!Array.isArray(v)||v.length>16384)fail('INVALID_REQUEST','Expected an ID array.');return (v as unknown[]).map(id);};
function assertProjectRecordingActive(project:LandmarkProject):void {try{assertRecordingProjectActive(project);}catch{fail('LEGACY_RECORDING_RETIRED',recordingRetiredReason);}}

/** Both native previews and external requests use this command transaction.
 * JSON request/body validation remains at the edge; completed command outputs
 * stay immutable through sequential authoring and the common project gate. */
function prepareSnapshotCommands(project:LandmarkProject,raw:unknown,validation:'full'|'preview'){
 const request=object(raw,['recordingId','commands','expectedRevision','dryRun']);if(request.expectedRevision!==undefined)id(request.expectedRevision);if(request.dryRun!==undefined)bool(request.dryRun);if(!Array.isArray(request.commands)||request.commands.length>1000)fail('INVALID_REQUEST','commands must contain at most 1000 items.');
 assertProjectRecordingActive(project);
 const before=project.recordingSnapshots??emptyRecordingSnapshotWorkspace();
 const commands=request.commands as unknown[],placementOnly=commands.length>0&&commands.every(command=>(command as SnapshotCommand)?.op==='setLayerPlacement');
 let placementEvaluation:ReturnType<typeof resolveSnapshot>|undefined;
 const placementChecks=new Map<string,{recordingId:string;snapshotId:string;angle:Angle;distances:Map<string,number>;commandIndex:number}>();
 const linkDistances=(evaluation:ReturnType<typeof resolveSnapshot>)=>new Map((evaluation.drawing.endpointLinks??[]).map(link=>{const a=evaluation.drawing.curves.find(curve=>curve.id===link.a.curveId),b=evaluation.drawing.curves.find(curve=>curve.id===link.b.curveId),p=a&&evaluation.drawing.nodes.find(node=>node.id===a.nodes[link.a.end])?.position,q=b&&evaluation.drawing.nodes.find(node=>node.id===b.nodes[link.b.end])?.position;return [link.id,p&&q?Math.hypot(p[0]-q[0],p[1]-q[1]):Infinity] as const;}));
 const refs=new Map<string,string>(),created:Array<SnapshotCreation&{commandIndex:number}>=[],removedIds:string[]=[],idMaps:Array<{commandIndex:number;idMap:Record<string,string>}>=[],diagnostics:Array<{code:string;message:string}>=[];
 let completed!:{workspace:RecordingSnapshotWorkspace;recordingId?:string;recording?:SnapshotRecording;snapshotId?:string};
 let preparedPlan:ReturnType<typeof prepareSnapshotEdit>;
 try{preparedPlan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-build',validation:commands.some(command=>snapshotCommandStage(command)==='structural')?'full':validation,build:initial=>{
 const priorActive=initial.activeRecordingId;let candidate=initial,explicitSelection=false;
 if(request.recordingId!==undefined){const target=id(request.recordingId);if(!candidate.recordings.some(recording=>recording.id===target))fail('NOT_FOUND','Recording does not exist.');if(target!==candidate.activeRecordingId)candidate={...candidate,activeRecordingId:target};}
 const canonical=(value:string)=>allSnapshotIds(candidate).includes(value);
 const dereference=(value:unknown,key=''):unknown=>{if(typeof value==='string'&&/Id$|Ids$/.test(key)&&value.startsWith('$')){if(canonical(value))return value;return refs.get(value.slice(1))??fail('UNKNOWN_REFERENCE',`Unknown batch reference ${value}.`);}if(Array.isArray(value))return value.map(value=>dereference(value,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,dereference(value,key)]));return value;};
 for(const [index,command] of commands.entries())try{
  const op=(command as SnapshotCommand)?.op;
  if(retiredCreationOps.has(op))fail('LEGACY_RECORDING_RETIRED',`${op} is retired. Use createTriangulatedRecording for a new Recording. ${recordingRetiredReason}`);
  const resolved=dereference(command);
  if(op==='setLayerPlacement'){
   const current=candidate.recordings.find(recording=>recording.id===candidate.activeRecordingId),snapshotId=current?.activeSnapshotId;
   if(current&&snapshotId){const key=JSON.stringify([current.id,snapshotId,current.angle]);if(!placementChecks.has(key)){
    // This identity is complete and will never be mutated. Placement-only
    // batches intentionally share one frame for membership and lock checks.
    const evaluation=current.mode==='triangulated'?evaluateWorkspace(candidate,current.id,{angle:current.angle,diagnostics:'preview',immutableInputs:true}):resolveSnapshot(candidate,snapshotId,{angle:current.angle,diagnostics:'preview'});
    if(placementOnly)placementEvaluation=evaluation;
    placementChecks.set(key,{recordingId:current.id,snapshotId,angle:{...current.angle},distances:linkDistances(evaluation),commandIndex:index});
   }}
  }
  const prepared=prepareSnapshotCommand(candidate,resolved,placementEvaluation?{layerPlacementDrawing:placementEvaluation.drawing}:undefined);candidate=prepared.workspace;
  if(['createTriangulatedRecording','selectRecording','deleteRecording'].includes(op))explicitSelection=true;
  for(const item of prepared.effects.created){if(item.ref!==undefined){if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.ref))fail('INVALID_REQUEST','Invalid batch ref.');if(refs.has(item.ref))fail('DUPLICATE_REFERENCE','Batch refs must be unique.');if(canonical(`$${item.ref}`))fail('REFERENCE_COLLISION','Batch ref collides with a canonical ID.');refs.set(item.ref,item.id);}created.push({...item,commandIndex:index});}
  removedIds.push(...prepared.effects.removedIds);diagnostics.push(...prepared.effects.diagnostics??[]);if(prepared.effects.idMap)idMaps.push({commandIndex:index,idMap:prepared.effects.idMap});
 }catch(error){const value=error as Error;throw new SnapshotApiError(value instanceof SnapshotApiError||value instanceof SnapshotCommandError?value.code:'CONSTRAINT_VIOLATION',value.message,index);}
 const recordingId=candidate.activeRecordingId,recording=candidate.recordings.find(recording=>recording.id===recordingId),snapshotId=recording?.activeSnapshotId;
 if(request.recordingId!==undefined&&!explicitSelection&&candidate.activeRecordingId!==priorActive)candidate={...candidate,activeRecordingId:priorActive};
 completed={workspace:candidate,recordingId,recording,snapshotId};return candidate;
 }});}catch(error){if(error instanceof SnapshotApiError)throw error;throw new SnapshotApiError('CONSTRAINT_VIOLATION',(error as Error).message,commands.length?commands.length-1:undefined);}
 const {recordingId,recording,snapshotId}=completed,recordingSnapshots=preparedPlan.project.recordingSnapshots??completed.workspace;diagnostics.push(...preparedPlan.diagnostics??[]);
 // Linked placements are a coherent batch constraint, checked on the complete
 // propagated candidate, never on a partially written mutable snapshot.
 for(const check of placementChecks.values()){
  if(!recordingSnapshots.snapshots.some(snapshot=>snapshot.id===check.snapshotId))continue;
  const owner=recordingSnapshots.recordings.find(recording=>recording.id===check.recordingId),result=owner?.mode==='triangulated'?evaluateWorkspace(recordingSnapshots,owner.id,{angle:check.angle,diagnostics:'preview',immutableInputs:true}):resolveSnapshot(recordingSnapshots,check.snapshotId,{angle:check.angle,diagnostics:'preview'}),distances=linkDistances(result);
  for(const link of result.drawing.endpointLinks??[]){if((check.distances.get(link.id)??Infinity)>1e-8||(distances.get(link.id)??0)<=1e-8)continue;const owners=[link.a,link.b].map(end=>result.drawing.layers.find(layer=>layer.items.includes(end.curveId)));if(owners[0]?.id===owners[1]?.id)continue;throw new SnapshotApiError('LINKED_LAYER_PLACEMENT',`Placement separates linked layers ${owners.map(layer=>layer?.name??'missing layer').join(' and ')}. Include both linked layers in the same placement transform.`,check.commandIndex);}
 }
 try{const needsResolution=commands.some(command=>['pasteLayers','moveLayers','cloneLayers','createSnapshot','createEndpointPairRecording','createTriangulatedRecordingCopy','removeLayers','rebindLayers','setWarp','deleteWarp'].includes((command as SnapshotCommand).op));if(needsResolution&&snapshotId&&!recording?.legacy)recording?.mode==='triangulated'?evaluateWorkspace(recordingSnapshots,recording.id,{useDraft:true,angle:recording.angle,diagnostics:'preview',immutableInputs:true}):resolveSnapshot(recordingSnapshots,snapshotId,{useDraft:true,angle:recording?.angle,diagnostics:'preview'});}
 catch(error){throw new SnapshotApiError('CONSTRAINT_VIOLATION',(error as Error).message,commands.length?commands.length-1:undefined);}
 return {before,recordingSnapshots,preparedPlan,recordingId,snapshotId,angle:recording?.angle,changed:preparedPlan.changed,dryRun:request.dryRun===true,created,removedIds:[...new Set(removedIds)],idMaps,diagnostics};
}
export function prepareSnapshotBatch(project:LandmarkProject,raw:unknown){return prepareSnapshotCommands(project,raw,'full');}
export interface SnapshotPreviewRequest {recordingId?:string;commands:readonly SnapshotCommand[]}
/** Native command bodies use the same typed writers; structural operations
 * select explicit full validation rather than a widened preview trust flag. */
export function prepareSnapshotPreview(project:LandmarkProject,request:SnapshotPreviewRequest):SnapshotBatchPlan {
 const query=object(request,['recordingId','commands']);if(!Array.isArray(query.commands)||query.commands.length>1000)fail('INVALID_REQUEST','commands must contain at most 1000 items.');
 return prepareSnapshotCommands(project,{...request,dryRun:true},request.commands.some(command=>snapshotCommandStage(command)==='structural')?'full':'preview');
}

export function snapshotOverview(project:LandmarkProject,raw:unknown={}){
 const q=object(raw,['recordingId','snapshotId','layerIds','nameIncludes','includeKeyValues','expectedRevision']);if(q.includeKeyValues!==undefined)bool(q.includeKeyValues);if(q.nameIncludes!==undefined&&typeof q.nameIncludes!=='string')fail('INVALID_REQUEST','nameIncludes must be text.');if(q.expectedRevision!==undefined)id(q.expectedRevision);
 const retirement=recordingRetirementStatus(project),workspace=retirement?(project.recordingSnapshots??emptyRecordingSnapshotWorkspace()):ensureRecordingSnapshots(project).recordingSnapshots,recordingId=q.recordingId===undefined?workspace.activeRecordingId:id(q.recordingId),recording=workspace.recordings.find(r=>r.id===recordingId);if(q.recordingId!==undefined&&!recording)fail('NOT_FOUND','Recording does not exist.');
 const recordings=workspace.recordings.map(r=>({id:r.id,name:r.name,mode:r.mode??'tracks',endpointPair:r.endpointPair,angleGraph:r.angleGraph,angle:r.angle,snapshotIds:r.snapshotIds,activeSnapshotId:r.activeSnapshotId,snapshotCount:r.snapshotIds.length,trackCount:r.tracks.length,authoredKeyCount:r.tracks.reduce((n,t)=>n+t.keys.length,0),readOnly:!!retirement,retired:r.mode!=='triangulated'||!!r.legacy}));
 const boundAngle=(snapshot:RecordingSnapshot,owner=workspace.recordings.find(recording=>recording.snapshotIds.includes(snapshot.id)))=>owner?.mode==='triangulated'?owner.angleGraph?.mesh.vertices.find(vertex=>vertex.snapshotId===snapshot.id)?.angle??snapshot.angle:snapshot.angle;
 const availableSnapshots=workspace.snapshots.map(s=>({id:s.id,name:s.name,kind:s.kind,angle:boundAngle(s),layers:s.layers,authoredKeyCount:s.authored.length,...(s.source?{artworkId:s.source.artworkId}:{})}));
 if(!recording)return structuredClone({exists:!!retirement,recordings,availableSnapshots,sourceReadOnly:true,readOnly:!!retirement,retired:!!retirement,retiredReason:retirement?recordingRetiredReason:undefined,retirement});
 const snapshotId=q.snapshotId===undefined?undefined:id(q.snapshotId);if(snapshotId&&!recording.snapshotIds.includes(snapshotId))fail('NOT_FOUND','Snapshot does not belong to this Recording.');
 const evaluation=!retirement&&recording.snapshotIds.length?evaluateWorkspace(workspace,recording.id,{snapshotId,diagnostics:'preview'}):undefined,selected=evaluation&&workspace.snapshots.find(s=>s.id===evaluation.snapshotId),layerIds=q.layerIds===undefined?undefined:list(q.layerIds),matches=(name:string)=>q.nameIncludes===undefined||name.toLocaleLowerCase().includes(String(q.nameIncludes).toLocaleLowerCase());
 const tracks=recording.tracks.map(t=>q.includeKeyValues?t:{...t,keys:t.keys.map(k=>({id:k.id,name:k.name,angle:k.angle})),...(t.draft?{draft:{angle:t.draft.angle}}:{})});
 return structuredClone({exists:true,recordingId:recording.id,snapshotId:selected?.id??(retirement?snapshotId??recording.activeSnapshotId:undefined),name:recording.name,mode:recording.mode??'tracks',endpointPair:recording.endpointPair,angleGraph:recording.angleGraph,angleSurface:evaluation?.angleSurface?{role:evaluation.angleSurface.role,coordinateSpace:evaluation.angleSurface.coordinateSpace,simplex:evaluation.angleSurface.simplex,basisSnapshotIds:evaluation.angleSurface.bases.map(base=>base.snapshotId),outsideCurves:evaluation.angleSurface.outsideCurves.map(({cubic,...curve})=>curve)}:undefined,angle:recording.angle,recordings,availableSnapshots,snapshots:recording.snapshotIds.map(sid=>workspace.snapshots.find(s=>s.id===sid)).filter((s):s is RecordingSnapshot=>!!s).map(s=>({id:s.id,name:s.name,kind:s.kind,angle:boundAngle(s,recording),layerCount:s.layers.length,authored:s.authored})),layers:(selected?.layers??[]).filter(l=>(!layerIds||layerIds.includes(l.id))&&matches(l.name)).map(l=>({...l,currentPlacement:evaluation?.placements[l.id],currentShape:evaluation?.state.layers[l.id]?.shape??{nodes:{},handles:{}},members:evaluation?.drawing.layers.find(x=>x.id===l.id)?.items??[],authoredKeyCount:recording.tracks.filter(t=>t.targetId===l.id).reduce((n,t)=>n+t.keys.length,0)})),warps:evaluation?.state.warps??[],bindings:evaluation?.state.bindings??[],tracks,trackIndex:retirement?undefined:recordingPoseTrackIndex(recording,workspace),diagnostics:evaluation?.diagnostics??[],readOnly:!!retirement,retired:!!retirement,retiredReason:retirement?recordingRetiredReason:undefined,retirement,legacyReason:recording.legacy?.reason,hasDraft:!!recording.endpointPair?.draft||recording.angleGraph?.correctionFrames?.some(frame=>frame.status==='draft')||recording.snapshotIds.some(id=>workspace.snapshots.find(snapshot=>snapshot.id===id)?.draft)||recording.mode!=='triangulated'&&recording.tracks.some(t=>!!t.draft),tolerancePixels:(recording.tolerance??1/250)*250,sourceReadOnly:true});
}

export function evaluateRecordingSnapshot(project:LandmarkProject,request:Pick<SnapshotEvaluationOptions,'angle'|'useDraft'|'snapshotId'|'stopAtWarpId'|'omitPlacements'>&{recordingId?:string}={}){
 const q=object(request,['recordingId','snapshotId','angle','useDraft','stopAtWarpId','omitPlacements']);if(q.useDraft!==undefined)bool(q.useDraft);if(q.omitPlacements!==undefined)bool(q.omitPlacements);
 assertProjectRecordingActive(project);
 const workspace=ensureRecordingSnapshots(project).recordingSnapshots,recordingId=q.recordingId===undefined?workspace.activeRecordingId:id(q.recordingId),recording=workspace.recordings.find(r=>r.id===recordingId)??fail('NO_RECORDING','Create or select a Recording first.');
 if(q.angle!==undefined){const angle=object(q.angle,['x','y']);if(![angle.x,angle.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-90&&n<=90))fail('INVALID_REQUEST','Angle must be finite in −90…90.');}
 if(q.snapshotId!==undefined&&!recording.snapshotIds.includes(id(q.snapshotId)))fail('NOT_FOUND','Snapshot does not belong to this Recording.');if(q.stopAtWarpId!==undefined)id(q.stopAtWarpId);
 const useDraft=q.useDraft===undefined?q.angle===undefined:bool(q.useDraft),result=evaluateWorkspace(workspace,recording.id,{...request,useDraft,diagnostics:'full'});if(q.stopAtWarpId!==undefined&&!result.state.warps.some(w=>w.id===q.stopAtWarpId))fail('NOT_FOUND','Local preview Warp does not exist.');
 const surfaceDraft=recording.angleGraph?.correctionFrames?.some(frame=>frame.status==='draft'),usedBasisIds=new Set([...(result.angleSurface?.bases.map(base=>base.snapshotId)??[]),...(result.angleSurface?.outsideCurves.flatMap(curve=>curve.snapshotIds)??[])]),localDraft=recording.mode==='triangulated'&&recording.angleGraph?.mesh.vertices.some(vertex=>usedBasisIds.has(vertex.snapshotId)&&vertex.angle.x===recording.angle.x&&vertex.angle.y===recording.angle.y&&workspace.snapshots.find(snapshot=>snapshot.id===vertex.snapshotId)?.draft);
 return {...result,recordingId:recording.id,usedDraft:useDraft&&!!(surfaceDraft||localDraft),hasUnappliedDraft:!!surfaceDraft&&!useDraft||recording.snapshotIds.some(id=>{const snapshot=workspace.snapshots.find(snapshot=>snapshot.id===id),vertex=recording.angleGraph?.mesh.vertices.find(vertex=>vertex.snapshotId===id);return !!snapshot?.draft&&(!useDraft||!vertex||!usedBasisIds.has(id)||vertex.angle.x!==recording.angle.x||vertex.angle.y!==recording.angle.y);})};

}
export type SnapshotBatchPlan=ReturnType<typeof prepareSnapshotBatch>;
