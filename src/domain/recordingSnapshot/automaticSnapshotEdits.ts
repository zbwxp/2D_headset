import {emptyRecordingSnapshot,type RecordingSnapshot,type RecordingSnapshotWorkspace,type ReferencedSnapshotLayer,type SnapshotDiagnostic,type SnapshotLayer} from './model';
import {resolveSnapshot,prepareSnapshotParentInput} from './evaluation';
import type {SnapshotMirrorOptions} from './snapshotMirror';
import {insertSnapshotVertex} from './triangulation';
import {reconcileSnapshotAngleGraphMesh} from './angleGraph';

export interface AutomaticSnapshotEditDiagnostic {code:string;message:string;snapshotId?:string}
export interface AutomaticSnapshotSeedOptions {mirror?:SnapshotMirrorOptions}
export interface AutomaticSnapshotSeedResult {createdSnapshotIds:string[];diagnostics:AutomaticSnapshotEditDiagnostic[]}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const inherited=(snapshot:RecordingSnapshot,layer:SnapshotLayer):layer is ReferencedSnapshotLayer=>layer.kind==='reference'&&layer.baseSnapshotId===snapshot.parentSnapshotId;

/** Synchronize only explicitly opted-in children during an ordinary transaction.
 * Loading/evaluation never adds snapshots, layers, or points. The caller keeps
 * the old workspace for Undo; only changed snapshot records are replaced. */
export function propagateAutomaticSnapshotLayers(before:RecordingSnapshotWorkspace|undefined,after:RecordingSnapshotWorkspace):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]} {
 let workspace=after;const diagnostics:SnapshotDiagnostic[]=[],done=new Set<string>(),visiting=new Set<string>();
 const replace=(value:RecordingSnapshot)=>{workspace={...workspace,snapshots:workspace.snapshots.map(snapshot=>snapshot.id===value.id?value:snapshot)};};
 const visit=(id:string):void=>{
  if(done.has(id))return;if(visiting.has(id))throw Error('Snapshot parent cycle while propagating layers.');visiting.add(id);
  let snapshot=workspace.snapshots.find(value=>value.id===id)!;
  if(snapshot.parentLayers&&snapshot.parentSnapshotId){
   const parent=workspace.snapshots.find(value=>value.id===snapshot.parentSnapshotId);
   if(parent){
    visit(parent.id);snapshot=workspace.snapshots.find(value=>value.id===id)!;
    const currentParent=workspace.snapshots.find(value=>value.id===parent.id)!;
    const mirroredInput=!!snapshot.inputMirror||workspace.recordings.some(recording=>recording.angleGraph?.viewMirror?.targetSnapshotId===snapshot.id);
    const input=mirroredInput?prepareSnapshotParentInput(workspace,snapshot,resolveSnapshot(workspace,parent.id,{useDraft:false,diagnostics:'preview'})):undefined;
    if(input)diagnostics.push(...input.diagnostics.filter(issue=>issue.code==='INPUT_MIRROR'));
    const sourceLayers=input?.drawing.layers??currentParent.layers,available=new Set(sourceLayers.map(layer=>layer.id));
    const previous=before?.snapshots.find(value=>value.id===id),excluded=new Set(snapshot.parentLayers!.excludedLayerIds??[]);
    const currentByBase=new Map(snapshot.layers.filter(layer=>inherited(snapshot,layer)).map(layer=>[layer.baseLayerId,layer]));
    // A user removal is distinguished from the parent's own disappearance.
    for(const layer of previous?.layers??[])if(inherited(previous!,layer)&&!currentByBase.has(layer.baseLayerId)&&available.has(layer.baseLayerId))excluded.add(layer.baseLayerId);
    // An explicit re-add clears that layer's earlier deletion intent.
    for(const [baseId] of currentByBase)if(previous&&!previous.layers.some(layer=>inherited(previous,layer)&&layer.baseLayerId===baseId))excluded.delete(baseId);
    let orderOverride=!!snapshot.parentLayers!.orderOverride;
    if(previous){const currentIds=new Set(snapshot.layers.map(layer=>layer.id)),old=previous.layers.filter(layer=>currentIds.has(layer.id)).map(layer=>layer.id),oldIds=new Set(old),current=snapshot.layers.filter(layer=>oldIds.has(layer.id)).map(layer=>layer.id);if(!same(old,current))orderOverride=true;}
    const desired:ReferencedSnapshotLayer[]=[],occupied=new Set(snapshot.layers.filter(layer=>!inherited(snapshot,layer)).map(layer=>layer.id));
    for(const source of sourceLayers){
     if(excluded.has(source.id))continue;const existing=currentByBase.get(source.id);
     if(existing){desired.push(existing);continue;}
     // Layer identities can repeat in different snapshots; this stable slot ID
     // keeps a temporarily missing parent's child residual address intact.
     if(occupied.has(source.id)){diagnostics.push({code:'MISSING_LAYER',snapshotId:id,layerId:source.id,message:'A local layer already owns this inherited slot ID; the local layer is retained.'});continue;}
     desired.push({kind:'reference',id:source.id,name:source.name,baseSnapshotId:parent.id,baseLayerId:source.id});
    }
    const retained=snapshot.layers.filter(layer=>!inherited(snapshot,layer)||available.has(layer.baseLayerId)&&!excluded.has(layer.baseLayerId));
    let layers:SnapshotLayer[];
    if(orderOverride){const present=new Set(retained.filter(layer=>inherited(snapshot,layer)).map(layer=>layer.baseLayerId));layers=[...retained,...desired.filter(layer=>!present.has(layer.baseLayerId))];}
    else {const remaining=[...desired];layers=retained.flatMap<SnapshotLayer>(layer=>inherited(snapshot,layer)?remaining.length?[remaining.shift()!]:[]:[layer]);layers.push(...remaining);}
    const parentLayers={...(excluded.size?{excludedLayerIds:[...excluded]}:{}),...(orderOverride?{orderOverride:true}:{})};
    if(!same(layers,snapshot.layers)||!same(parentLayers,snapshot.parentLayers))replace({...snapshot,layers,parentLayers});
   }
  }
  visiting.delete(id);done.add(id);
 };
 for(const snapshot of workspace.snapshots)visit(snapshot.id);
 return {workspace,diagnostics};
}

/** Resolve a configured fixed source axis. No geometry/name heuristic is used. */
export function configuredSnapshotMirror(workspace:RecordingSnapshotWorkspace,parent:RecordingSnapshot):{mirror?:SnapshotMirrorOptions;diagnostics:AutomaticSnapshotEditDiagnostic[]} {
 const visited=new Set<string>(),sources:RecordingSnapshot[]=[];
 const visit=(id:string)=>{if(visited.has(id))return;visited.add(id);const snapshot=workspace.snapshots.find(value=>value.id===id);if(!snapshot)return;if(snapshot.source)sources.push(snapshot);for(const layer of snapshot.layers)if(layer.kind==='reference')visit(layer.baseSnapshotId);};visit(parent.id);
 const configured=sources.filter(source=>source.source!.mirrorAxisX!==undefined),axes=[...new Set(configured.map(source=>source.source!.mirrorAxisX!))];
 if(axes.length!==1)return {diagnostics:[{code:axes.length?'MIRROR_AXIS_CONFLICT':'MIRROR_AXIS_REQUIRED',snapshotId:parent.id,message:axes.length?'Source layers have different configured mirror axes; select one explicit axis for the opposite view.':'Select a fixed mirror axis before creating an opposite view.'}]};
 return {mirror:{axisX:axes[0],curvePairs:configured.flatMap(source=>source.source!.mirrorEditing?.curvePairs??[]),axisNodeIds:[...new Set(configured.flatMap(source=>source.source!.mirrorEditing?.axisNodeIds??[]))]},diagnostics:[]};
}

/** Explicit creation-workflow edit, mutating its caller-owned transaction draft.
 * It fills only missing extremes requested by this new real equatorial view.
 * This is never called on load, generic edits, or deletion. */
export function seedAutomaticExtremeSnapshots(workspace:RecordingSnapshotWorkspace,recordingId:string,newRealSnapshotId:string,fresh:()=>string,options:AutomaticSnapshotSeedOptions={}):AutomaticSnapshotSeedResult {
 const recording=workspace.recordings.find(value=>value.id===recordingId),parent=workspace.snapshots.find(value=>value.id===newRealSnapshotId);
 if(!recording||!parent||recording.mode!=='triangulated'||!recording.angleGraph||!recording.snapshotIds.includes(parent.id))return {createdSnapshotIds:[],diagnostics:[]};
 const at=recording.angleGraph.mesh.vertices.find(vertex=>vertex.snapshotId===parent.id)?.angle;
 if(!at||at.y!==0||![0,-90,90].includes(at.x))return {createdSnapshotIds:[],diagnostics:[]};
 const createdSnapshotIds:string[]=[],diagnostics:AutomaticSnapshotEditDiagnostic[]=[],occupied=new Set(workspace.snapshots.map(snapshot=>snapshot.id));
 const allocate=()=>{for(let attempt=0;attempt<100;attempt++){const id=fresh();if(id&&!occupied.has(id)){occupied.add(id);return id;}}throw Error('Unable to allocate an automatic snapshot ID.');};
 const existing=(x:number,y:number)=>recording.angleGraph!.mesh.vertices.find(vertex=>vertex.angle.x===x&&vertex.angle.y===y);
 const add=(base:RecordingSnapshot,x:number,y:number,mirror?:SnapshotMirrorOptions):RecordingSnapshot|undefined=>{
  if(existing(x,y))return undefined;
  const child=emptyRecordingSnapshot(allocate(),y===0?`Mirror ${x}°`:`Placeholder ${x}°, ${y}°`,'view',{x,y});child.parentSnapshotId=base.id;child.parentLayers={};if(mirror)child.inputMirror=structuredClone(mirror);
  const mesh=insertSnapshotVertex(recording.angleGraph!.mesh,{snapshotId:child.id,angle:{x,y}}),reconciled=reconcileSnapshotAngleGraphMesh(recording.angleGraph!,mesh,{id:allocate(),reason:'mesh-change',message:'Responses retired when creating automatic extreme snapshots.'});
  if(!reconciled.ok)throw Error(reconciled.diagnostics.map(issue=>issue.message).join(' '));
  diagnostics.push(...reconciled.diagnostics);recording.angleGraph=reconciled.graph;workspace.snapshots.push(child);recording.snapshotIds.push(child.id);createdSnapshotIds.push(child.id);return child;
 };
 add(parent,at.x,-90);add(parent,at.x,90);
 if(at.x===-90&&!existing(90,0)){
  const selected=options.mirror?{mirror:options.mirror,diagnostics:[]}:configuredSnapshotMirror(workspace,parent);diagnostics.push(...selected.diagnostics);
  if(selected.mirror){const child=add(parent,90,0,selected.mirror);if(child){
   const zero=existing(0,0);if(zero)recording.angleGraph!.viewMirror={zeroSnapshotId:zero.snapshotId,sourceSnapshotId:parent.id,targetSnapshotId:child.id};
   else diagnostics.push({code:'VIEW_MIRROR_ZERO_REQUIRED',snapshotId:child.id,message:'No local 0° basis is bound; this legacy opposite view retains its explicit absolute input mirror.'});
   add(child,90,-90);add(child,90,90);
  }}
 }
 const propagated=propagateAutomaticSnapshotLayers(undefined,workspace);workspace.snapshots=propagated.workspace.snapshots;diagnostics.push(...propagated.diagnostics);
 return {createdSnapshotIds,diagnostics};
}
