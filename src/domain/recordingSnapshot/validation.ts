import {sameAngle,type Angle} from '../vectorRecording/interpolation';
import {finitePoint} from '../drawing/model';
import {validateWarpGrid} from '../vectorWarp/model';
import {validateScenePlacement,validateSceneShape} from '../recordingScene/validation';
import {validateIntervalOverrides} from '../vectorRecording/intervals';
import {snapshotChannelKey,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotPoseTrack,type SnapshotLayerState,type SnapshotMaterialIssue} from './model';

const fail=(message:string):never=>{throw Error(`Invalid recording snapshot: ${message}`);};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=16384;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const angle=(value:unknown)=>record(value)&&typeof value.x==='number'&&typeof value.y==='number'&&[value.x,value.y].every(n=>Number.isFinite(n)&&n>=-90&&n<=90);
const unique=(values:string[],what:string)=>{if(values.some(v=>!id(v))||new Set(values).size!==values.length)fail(`${what} IDs`);};
function materialIssue(issue:SnapshotMaterialIssue):void {if(!issue||!id(issue.sourceSnapshotId)||typeof issue.sourceSignature!=='string'||!issue.sourceSignature||typeof issue.message!=='string')fail('source material issue');}
function deformation(state:SnapshotDeformationState):void {
 if(!state||!Array.isArray(state.warps)||!Array.isArray(state.bindings)||!record(state.layers)||!record(state.relationPositions))fail('deformation state');
 unique(state.warps.map(w=>w.id),'Warp');const warps=new Map(state.warps.map(w=>[w.id,w]));
 for(const warp of state.warps){validateWarpGrid(warp.restGrid);validateWarpGrid(warp.grid);if(JSON.stringify([warp.grid.rows,warp.grid.columns,warp.grid.bounds])!==JSON.stringify([warp.restGrid.rows,warp.restGrid.columns,warp.restGrid.bounds]))fail('Warp rest domain changed');const visited=new Set<string>();let current:typeof warp|undefined=warp;while(current){if(visited.has(current.id))fail('Warp cycle');visited.add(current.id);if(current.parentId&&!warps.has(current.parentId))fail('missing Warp parent');current=current.parentId?warps.get(current.parentId):undefined;}}
 unique(state.bindings.map(b=>b.layerId),'bound layer');for(const binding of state.bindings)if(!id(binding.warpId)||!warps.has(binding.warpId))fail('missing bound Warp');
 for(const [layerId,layerState] of Object.entries(state.layers) as Array<[string,SnapshotLayerState]>){
  if(!id(layerId)||(!layerState||typeof layerState!=='object'||Array.isArray(layerState)))fail('layer state');if(layerState.placement)validateScenePlacement(layerState.placement);if(layerState.shape)validateSceneShape(layerState.shape);
  if(layerState.depth!==undefined&&(!Number.isFinite(layerState.depth)||Math.abs(layerState.depth)>10000))fail('depth');
  if(layerState.visibility&&(!record(layerState.visibility)||Object.entries(layerState.visibility).some(([key,value])=>!id(key)||value!==null&&typeof value!=='boolean')))fail('visibility');
  if(layerState.intervals)for(const value of Object.values(layerState.intervals))interval(value);
 }
 if(state.intervalMaterialIssues){if(!record(state.intervalMaterialIssues))fail('static source material issues');for(const [key,issue] of Object.entries(state.intervalMaterialIssues)){if(!id(key))fail('static interval target');materialIssue(issue);}}
 for(const value of Object.values(state.relationPositions))if(!value||!Array.isArray(value.sourceLinkIds)||!value.sourceLinkIds.length||value.sourceLinkIds.some(x=>!id(x))||!finitePoint(value.offset))fail('relation position');
}
function interval(value:any):void {
 if(!value||!record(value.enabled)||Object.values(value.enabled).some(v=>typeof v!=='boolean'))fail('interval');
 if(value.appearance!==null)validateIntervalOverrides([value.appearance]);
}
function track(track:SnapshotPoseTrack):void {
 if(!id(track.id)||!id(track.targetId)||track.elementId!==undefined&&!id(track.elementId)||!Array.isArray(track.keys)||track.interpolation!==undefined&&!['independent','legacy'].includes(track.interpolation))fail('track');
 if(track.channel==='interval'&&track.materialIssue)materialIssue(track.materialIssue);
 unique(track.keys.map(k=>k.id),'key');const positions:Angle[]=[];
 const value=(v:unknown)=>{switch(track.channel){case 'placement':validateScenePlacement(v as any);break;case 'shape':validateSceneShape(v as any);break;case 'warp':validateWarpGrid(v as any);break;case 'depth':if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>10000)fail('depth key');break;case 'visibility':if(v!==null&&typeof v!=='boolean')fail('visibility key');break;case 'interval':if(!id(track.sourceTrackId))fail('interval target');interval(v);break;case 'relationPosition':if(!finitePoint(v))fail('relation key');break;default:fail('unknown channel');}};
 for(const key of track.keys){if(!angle(key.angle))fail('key angle');if(positions.some(at=>sameAngle(at,key.angle)))fail('duplicate key angle');positions.push(key.angle);value(key.value);}
 if(track.draft){if(!angle(track.draft.angle))fail('draft angle');value(track.draft.value);}
}
export function validateSnapshotGraph(workspace:RecordingSnapshotWorkspace):void {
 const nodes=new Map(workspace.snapshots.map(s=>[s.id,s])),done=new Set<string>(),visiting=new Set<string>();
 const visit=(snapshot:RecordingSnapshot)=>{if(visiting.has(snapshot.id))fail(`snapshot cycle at ${snapshot.id}`);if(done.has(snapshot.id))return;visiting.add(snapshot.id);for(const layer of snapshot.layers)if(layer.kind==='reference'){const parent=nodes.get(layer.baseSnapshotId);if(parent)visit(parent);}visiting.delete(snapshot.id);done.add(snapshot.id);};
 for(const snapshot of workspace.snapshots)visit(snapshot);
}
export function validateRecordingSnapshotWorkspace(workspace:RecordingSnapshotWorkspace):void {
 if(!workspace||workspace.version!==2||!record(workspace.library)||!Array.isArray(workspace.snapshots)||!Array.isArray(workspace.recordings))fail('workspace');
 for(const category of ['nodes','curves','fills','offsets'] as const){const values=workspace.library[category];if(!record(values))fail('canonical library');for(const [key,value] of Object.entries(values))if(!id(key)||!value||value.id!==key)fail('canonical element key');}
 const allIds=[...Object.keys(workspace.library.nodes),...Object.keys(workspace.library.curves),...Object.keys(workspace.library.fills),...Object.keys(workspace.library.offsets)];unique(allIds,'canonical element');
 for(const node of Object.values(workspace.library.nodes))if(!finitePoint(node.position))fail('canonical node');
 for(const curve of Object.values(workspace.library.curves))if(!Array.isArray(curve.nodes)||curve.nodes.length!==2||curve.nodes.some(n=>!id(n))||!Array.isArray(curve.handles)||curve.handles.length!==2||curve.handles.some(h=>!finitePoint(h)))fail('canonical curve');
 unique(workspace.snapshots.map(s=>s.id),'snapshot');unique(workspace.recordings.map(r=>r.id),'recording');
 for(const snapshot of workspace.snapshots){
  if(typeof snapshot.name!=='string'||!['drawing','sculpt','view','assembly'].includes(snapshot.kind)||!angle(snapshot.angle)||!Array.isArray(snapshot.layers)||!record(snapshot.relations)||!Array.isArray(snapshot.authored))fail('snapshot');
  unique(snapshot.layers.map(l=>l.id),'snapshot layer');
  for(const layer of snapshot.layers){if(typeof layer.name!=='string')fail('layer name');if(layer.kind==='original'){if(!Array.isArray(layer.items))fail('original layer');unique(layer.items,'original member');}else if(layer.kind==='reference'){if(!id(layer.baseSnapshotId)||!id(layer.baseLayerId))fail('base reference');}else fail('layer kind');}
  for(const patch of Object.values(snapshot.relations)){if(!record(patch))fail('relation patch');for(const operation of ['add','update','disable'] as const)if(patch[operation]!==undefined&&!Array.isArray(patch[operation]))fail('relation operation');for(const operation of ['add','update'] as const){const values=patch[operation] as {id:string}[]|undefined;if(values)unique(values.map(v=>v?.id),'relation');}if(patch.disable)unique(patch.disable as string[],'disabled relation');}
  deformation(snapshot.deformation);if(snapshot.inheritedState)deformation(snapshot.inheritedState);
  for(const ref of snapshot.authored)if(!id(ref.trackId)||!id(ref.keyId))fail('authored reference');
  if(snapshot.draft){if(!angle(snapshot.draft.angle)||!Array.isArray(snapshot.draft.channels))fail('snapshot draft');deformation(snapshot.draft.deformation);}
 }
 for(const recording of workspace.recordings){
  if(typeof recording.name!=='string'||!angle(recording.angle)||!Array.isArray(recording.snapshotIds)||!Array.isArray(recording.tracks))fail('recording');unique(recording.snapshotIds,'recording snapshot');unique(recording.tracks.map(t=>t.id),'track');
  const targets=new Set<string>();for(const t of recording.tracks){track(t);const key=snapshotChannelKey(t.channel,t.targetId,t.channel==='interval'?t.sourceTrackId:t.elementId);if(targets.has(key))fail('duplicate channel target');targets.add(key);}
  if(recording.activeSnapshotId!==undefined&&!recording.snapshotIds.includes(recording.activeSnapshotId))fail('active snapshot');
  for(const snapshotId of recording.snapshotIds){const snapshot=workspace.snapshots.find(s=>s.id===snapshotId);if(!snapshot)fail('missing recording snapshot');for(const ref of snapshot!.authored){const authored=recording.tracks.find(t=>t.id===ref.trackId)?.keys.find(k=>k.id===ref.keyId);if(!authored)fail('missing authored key');if(authored!.angle.x!==snapshot!.angle.x||authored!.angle.y!==snapshot!.angle.y)fail('authored key coordinate');}}
 }
 if(workspace.activeRecordingId!==undefined&&!workspace.recordings.some(r=>r.id===workspace.activeRecordingId))fail('active recording');validateSnapshotGraph(workspace);
}
export const validateRecordingSnapshots=validateRecordingSnapshotWorkspace;
