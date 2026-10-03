import type {RecordingSnapshotWorkspace,SnapshotLayer,ReferencedSnapshotLayer,SnapshotDiagnostic} from './model';
import {drawingSnapshotForArtwork} from './sources';
import {resolveSnapshot,SnapshotResolutionError} from './evaluation';
import {planArtworkLayerImport} from '../drawing/importArtworkLayers';

/** Session transport shared by Drawing and Recording. It carries addresses,
 * not baked geometry. A source switch must not clear it; a project switch must. */
export interface SnapshotReferenceClipboard {
 projectId:string;
 intent:'reference'|'duplicate';
 sources:readonly {snapshotId:string;layerIds:readonly string[]}[];
}

/** The UI's cut action means capture reference. Existing independent-copy UI
 * must explicitly pass duplicate; only that intent requests fresh identities. */
export function captureSnapshotLayerClipboard(projectId:string,intent:SnapshotReferenceClipboard['intent'],sources:SnapshotReferenceClipboard['sources']):SnapshotReferenceClipboard {
 if(!projectId||!sources.length)throw Error('Clipboard needs a project and source layers.');
 const seen=new Set<string>();
 for(const source of sources){
  if(!source.snapshotId||!source.layerIds.length)throw Error('Clipboard source needs a snapshot and layers.');
  for(const id of source.layerIds){const key=JSON.stringify([source.snapshotId,id]);if(!id||seen.has(key))throw Error('Clipboard layer references must be distinct.');seen.add(key);}
 }
 return {projectId,intent,sources:sources.map(source=>({snapshotId:source.snapshotId,layerIds:[...source.layerIds]}))};
}

/** Clipboard capture/paste never means moveLayers. Commands resolve the live
 * source at paste time, while preserving the source snapshot and canonical IDs. */
export function snapshotClipboardPasteCommands(clipboard:SnapshotReferenceClipboard,projectId:string):{
 op:'pasteLayers'|'cloneLayers';sourceSnapshotId:string;layerIds:string[];
}[] {
 if(clipboard.projectId!==projectId)throw Error('Clipboard belongs to another project.');
 return clipboard.sources.map(source=>({op:clipboard.intent==='reference'?'pasteLayers':'cloneLayers',sourceSnapshotId:source.snapshotId,layerIds:[...source.layerIds]}));
}

/** Drawing's raw layer IDs become addresses in its existing source adapter.
 * Never materialize a composite Drawing and ingest it as new source geometry. */
export function captureDrawingLayerClipboard(workspace:RecordingSnapshotWorkspace,projectId:string,artworkId:string,layerIds:readonly string[],intent:SnapshotReferenceClipboard['intent']='reference'):SnapshotReferenceClipboard {
 const snapshot=drawingSnapshotForArtwork(workspace,artworkId);if(!snapshot?.source)throw Error('Synchronize the Drawing source before capturing layer references.');
 const canonical=layerIds.map(raw=>{const layer=snapshot.layers.find(layer=>layer.kind==='original'&&snapshot.source!.originIds[layer.id]===raw);if(!layer)throw Error(`Drawing layer ${raw} has no original source address.`);return layer.id;});
 return captureSnapshotLayerClipboard(projectId,intent,[{snapshotId:snapshot.id,layerIds:canonical}]);
}

/** An explicit destination is required when the caller is Drawing, whose source
 * snapshot need not be the active Recording's snapshot. Execution belongs to
 * the shared snapshot transaction; this plan never switches a Recording. */
export function planSnapshotClipboardPaste(workspace:RecordingSnapshotWorkspace,clipboard:SnapshotReferenceClipboard,projectId:string,targetSnapshotId:string):{
 targetSnapshotId:string;commands:ReturnType<typeof snapshotClipboardPasteCommands>;
} {
 if(!workspace.snapshots.some(snapshot=>snapshot.id===targetSnapshotId))throw Error('Clipboard target snapshot is missing.');
 const commands=snapshotClipboardPasteCommands(clipboard,projectId);
 for(const command of commands){const source=workspace.snapshots.find(snapshot=>snapshot.id===command.sourceSnapshotId);if(!source||command.layerIds.some(id=>!source.layers.some(layer=>layer.id===id)))throw Error('Clipboard source layer is no longer available.');if(command.op==='pasteLayers'&&source.id===targetSnapshotId)throw Error('A snapshot cannot reference itself.');}
 return {targetSnapshotId,commands};
}

export interface SnapshotReferencePasteRequest {
 targetSnapshotId:string;
 sourceSnapshotId:string;
 layerIds?:readonly string[];
}
export interface SnapshotReferencePasteDiagnostic {
 code:string;message:string;sourceSnapshotId:string;targetSnapshotId:string;
 sourceLayerId?:string;existingLayerId?:string;elementId?:string;
}
export interface SnapshotReferencePasteResult {
 workspace:RecordingSnapshotWorkspace;
 changed:boolean;
 created:ReferencedSnapshotLayer[];
 reused:ReferencedSnapshotLayer[];
 diagnostics:SnapshotReferencePasteDiagnostic[];
 /** A failed plan leaves workspace identical to its input, including sources. */
 blockedCode?:string;
}

/** Pure explicit-target transaction for same-ID reference paste. The destination
 * may be a Drawing source, sculpt or Recording view and need not be active.
 * Layer IDs are snapshot-scoped: a new reference preserves its captured layer
 * ID. Legacy same-address slots retain their IDs. The optional allocator is
 * retained for call compatibility and is never used for reference paste.
 * Duplicate intent still belongs to cloneLayers, never to this function. */
export function prepareSnapshotReferencePaste(workspace:RecordingSnapshotWorkspace,request:SnapshotReferencePasteRequest,_fresh?:()=>string):SnapshotReferencePasteResult {
 const {targetSnapshotId,sourceSnapshotId}=request,diagnostics:SnapshotReferencePasteDiagnostic[]=[],created:ReferencedSnapshotLayer[]=[],reused:ReferencedSnapshotLayer[]=[];
 const report=(code:string,message:string,extra:Partial<SnapshotReferencePasteDiagnostic>={})=>diagnostics.push({code,message,sourceSnapshotId,targetSnapshotId,...extra});
 const blocked=(code:string,message:string):SnapshotReferencePasteResult=>{report(code,message);return {workspace,changed:false,created:[],reused:[],diagnostics,blockedCode:code};};
 const target=workspace.snapshots.find(snapshot=>snapshot.id===targetSnapshotId),source=workspace.snapshots.find(snapshot=>snapshot.id===sourceSnapshotId);
 if(!target||!source)return blocked('MISSING_SNAPSHOT',!target?'Reference paste target snapshot is missing.':'Reference paste source snapshot is missing.');
 if(target===source)return blocked('SNAPSHOT_CYCLE','A snapshot cannot reference itself.');
 const layerIds=request.layerIds??source.layers.map(layer=>layer.id);
 if(!Array.isArray(layerIds)||!layerIds.length||layerIds.length>16384||layerIds.some(id=>typeof id!=='string'||!id)||new Set(layerIds).size!==layerIds.length)return blocked('INVALID_REQUEST','Select distinct source layer IDs.');
 const selected=layerIds.map(id=>source.layers.find(layer=>layer.id===id));if(selected.some(layer=>!layer))return blocked('MISSING_LAYER','A selected source layer is missing.');
 for(const layer of selected as SnapshotLayer[]){
  const existing=target.layers.find(candidate=>candidate.kind==='reference'&&candidate.baseSnapshotId===sourceSnapshotId&&candidate.baseLayerId===layer.id) as ReferencedSnapshotLayer|undefined;
  if(existing){reused.push(existing);report('ALREADY_REFERENCED','This exact source layer already has a live reference here; its local membership and edits are retained.',{sourceLayerId:layer.id,existingLayerId:existing.id});}
  else if(target.layers.some(candidate=>candidate.id===layer.id))return blocked('LAYER_ID_CONFLICT',`Layer ${layer.id} already belongs to a different source or local state in this snapshot. Reference paste cannot replace it or create a new identity.`);
 }
 // A repeated paste is a true no-op, even if the retained source subsequently
 // becomes unavailable. It must not create a duplicate branch or repair data.
 if(reused.length===selected.length)return {workspace,changed:false,created,reused,diagnostics};
 const addDiagnostics=(values:SnapshotDiagnostic[])=>{for(const issue of values)report(issue.code,issue.message,{...(issue.layerId?{sourceLayerId:issue.layerId}:{}),...(issue.elementId?{elementId:issue.elementId}:{})});};
 try{
  const evaluated=resolveSnapshot(workspace,sourceSnapshotId,{useDraft:false,diagnostics:'preview'}),dependencyPlan=planArtworkLayerImport(evaluated.drawing,layerIds);
  if(dependencyPlan.additionalLayerIds.length)return blocked('LAYER_DEPENDENCIES',`Also select dependent layers: ${dependencyPlan.additionalLayerIds.join(', ')}.`);
  addDiagnostics(evaluated.diagnostics);
  for(const layer of selected as SnapshotLayer[]){
   if(reused.some(existing=>existing.baseLayerId===layer.id))continue;
   created.push({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:sourceSnapshotId,baseLayerId:layer.id});
  }
  const next={...workspace,snapshots:workspace.snapshots.map(snapshot=>snapshot===target?{...target,layers:[...target.layers,...created]}:snapshot)};
  const resolved=resolveSnapshot(next,targetSnapshotId,{useDraft:false,diagnostics:'preview'});addDiagnostics(resolved.diagnostics);
  return {workspace:next,changed:true,created,reused,diagnostics};
 }catch(error){
  const message=error instanceof Error?error.message:String(error),code=error instanceof SnapshotResolutionError?error.diagnostic.code:/snapshot cycle/i.test(message)?'SNAPSHOT_CYCLE':'REFERENCE_PASTE_BLOCKED';
  return blocked(code,message);
 }
}
