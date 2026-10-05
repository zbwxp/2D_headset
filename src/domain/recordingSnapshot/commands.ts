import {validateSnapshotViewMirrorRelation} from './viewMirrorRelation';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan,type DrawingControlEditPlan} from '../drawing/controlEditPlan';
import {snapshotWithObjectLocks,assertSnapshotObjectsUnlocked} from './objectLocks';
import {layerUsesCage} from './layerDomainControlEdit';
import {prepareSnapshotDrawingControlTarget} from './drawingControlTargetEdit';
import {snapshotPathMaterialValue} from './materialPathMapping';
import {snapshotMaterialPartitionAddress,snapshotMaterialPartitionParentValue,snapshotMaterialPartitionValue,prepareSnapshotPartitionIntervalEdit} from './materialSplit';
import {trySnapshotControlInverse} from './controlSpace';
import {prepareIndependentSnapshotLayers,SnapshotIndependentCopyError} from './independentCopy';
import {captureSnapshotResponseMembership,reconcileSnapshotMembershipResponses} from './membershipResponses';
import {snapshotIntervalMaterialSource} from './routeMaterialSource';
import {prepareSnapshotDrawingTopologyEdit,prepareSnapshotLocalDrawingEdit,assertSnapshotTopologyVertex,type SnapshotDrawingTopologyEdit} from './drawingTopology';
import {prepareSnapshotSurfaceInsertion,SnapshotSurfaceInsertionError} from './responseExpressionInsertion';
import type {SnapshotAngleGraph,SnapshotViewMirrorRelation} from './model';
import {configuredSnapshotMirror,seedAutomaticExtremeSnapshots} from './automaticSnapshotEdits';
import {createSnapshotAngleGraph,createTriangulatedRecordingCopy,reconcileSnapshotAngleGraphMesh} from './angleGraph';
import {insertSnapshotVertex,removeSnapshotVertex,rebindSnapshotVertex,locateSnapshotSimplex} from './triangulation';
import {effectiveSnapshotSurfaceResponses,snapshotSurfaceOwnsBasisDraft} from './surfaceTargets';
import {createSnapshotPropertyResponseSampler,prepareSnapshotPropertyTargetEdit,finishSnapshotPropertyDraft,SnapshotPropertyResponseError} from './propertyResponses';
import {snapshotSimplexIntervalBasisValues} from './simplexMaterial';
import {mergeSnapshotDeformation} from './tracks';
import {prepareSnapshotReferencePaste} from './referenceClipboard';
import {applySnapshotMembershipEdit,type SnapshotMembershipCommand} from './localMembership';
import {elementPlacementConflicts} from './elementPlacement';
import {projectSnapshotTransformTargets} from './transformTargets';
import {uid,sub,length,nodeAt,curveById,type DrawingDocument,type Point2,type StrokeDisplayIntervals,type DisplayIntervalMode,type TerminusBrushStyle,validInkEnds} from '../drawing/model';
import {moveNode,moveHandle,transform} from '../drawing/commands';
import {setDepthOffset,type DepthScope} from '../drawing/depth';
import {linkedNodeIds} from '../drawing/endpointLinks';
import {projectSceneSmoothHandle} from '../recordingScene/shapes';
import {applyScenePlacement,applyScenePlacementMatrix,isScenePlacementSimilarity} from '../recordingScene/tracks';
import {changeDisplayInterval,setDisplayIntervalEnd} from '../drawing/displayIntervals';
import {planArtworkLayerImport} from '../drawing/importArtworkLayers';
import {createWarpGrid,moveWarpNode,validateWarpGrid,type WarpGrid} from '../vectorWarp/model';
import {sameAngle} from '../vectorRecording/interpolation';
import {identityScenePlacement,identitySceneShape,type SceneTrack,type ScenePlacementValue,type SceneShapeValue,type SceneIntervalValue} from '../recordingScene/model';
import {emptyRecordingSnapshot,emptySnapshotRecording,emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotRecording,type SnapshotDeformationState,type SnapshotPoseTrack,type SnapshotControlResponse,type SnapshotEndpointResponses,type SnapshotTriangleResponses,type Angle} from './model';
import {prepareRecordingContext,resolveSnapshot,retainSnapshotSavedEvaluationIdentity,evaluateRecordingSnapshot as evaluateWorkspace} from './evaluation';
import {endpointPairCompatibility,endpointPairNodeAuthorities,invertEndpointPairCoordinate,interpolateEndpointPairGeometry,validateSnapshotControlResponse,validateSnapshotEndpointResponses} from './endpointPair';

export interface SnapshotSelection {layerIds?:string[];warpIds?:string[]}
export type SnapshotControlTarget={layerId:string;nodeId:string}|{layerId:string;curveId:string;end:0|1};
export interface SnapshotWarpDimensions {name?:string;rows?:number;columns?:number;ref?:string}
export type SnapshotCommand=
 | SnapshotMembershipCommand
 | ({op:'applyDrawingTopology'}&Pick<SnapshotDrawingTopologyEdit,'beforeDrawing'|'drawing'>)
 | {op:'createRecording'|'createTriangulatedRecording';name?:string;ref?:string}
 | {op:'createTriangulatedRecordingCopy';recordingId?:string;name?:string;ref?:string}
 | {op:'createEndpointPairRecording';startSnapshotId:string;endSnapshotId:string;name?:string;ref?:string}
 | {op:'correctShapeNode';layerId:string;nodeId:string;position:Point2}
 | {op:'correctShapeHandle';layerId:string;curveId:string;end:0|1;position:Point2}
 | {op:'setControlResponse';targets:SnapshotControlTarget[];axis:'x'|'y';points:Point2[]}
 | {op:'resetControlResponse';targets:SnapshotControlTarget[];axis:'x'|'y'}
 | {op:'updateEndpointCorrection'|'discardEndpointCorrection'}
 | {op:'selectRecording';recordingId:string}
 | {op:'renameRecording';recordingId:string;name:string}
 | {op:'deleteRecording';recordingId:string}
 | {op:'setAngle';angle:Angle}
 | {op:'createSnapshot';name?:string;kind?:'view'|'sculpt'|'assembly';angle?:Angle;ref?:string}
 | {op:'selectSnapshot';snapshotId:string}
 | {op:'setViewMirror';relation:SnapshotViewMirrorRelation}
 | {op:'rebindSnapshotAngle';snapshotId:string;angle:Angle}
 | {op:'updateSnapshot';snapshotId?:string;name?:string}
 | {op:'deleteSnapshot';snapshotId:string}
 | {op:'pasteLayers'|'cloneLayers';sourceSnapshotId:string;layerIds?:string[];ref?:string}
 | {op:'moveLayers';sourceSnapshotId:string;layerIds:string[]}
 | {op:'removeLayers'|'reorderLayers';layerIds:string[]}
 | {op:'setLayerPlacement';layerId:string;value:ScenePlacementValue}
 | {op:'transformShapeElements'|'setShapeElementPlacement';curveIds:string[];value:ScenePlacementValue}
 | {op:'setObjectLocks';objectIds:string[];locked:boolean}
 | {op:'setDepth';curveId?:string;fillId?:string;offset:number;scope?:DepthScope}
 | {op:'moveShapeNode';layerId:string;nodeId:string;position:Point2}
 | {op:'moveShapeHandle';layerId:string;curveId:string;end:0|1;position:Point2}
 | ({op:'createWarp';layerIds:string[]}&SnapshotWarpDimensions)
 | ({op:'createChild';parentWarpId:string;layerIds:string[]}&SnapshotWarpDimensions)
 | ({op:'wrapParent';warpIds:string[]}&SnapshotWarpDimensions)
 | {op:'rebindLayers';layerIds:string[];warpId:string|null}
 | {op:'setWarp';warpId:string;name?:string;parentId?:string|null}
 | {op:'deleteWarp';warpId:string}
 | {op:'editWarpNodes';warpId:string;edits:{index:number;position?:Point2;handleU?:Point2;handleV?:Point2;twist?:Point2}[];moveHandles?:boolean}
 | {op:'setVisibility';layerId:string;objectId?:string;visible:boolean|null}
 | {op:'setLayerOrder';layerId:string;value:number}
 | {op:'changeInterval';layerId:string;sourceTrackId:string;rangeId:string;mode?:DisplayIntervalMode;start?:number;end?:number;fullLoop?:boolean}
 | {op:'setIntervalEnd';layerId:string;sourceTrackId:string;rangeId:string;end:0|1;style:TerminusBrushStyle}
 | {op:'setIntervalEnabled';layerId:string;sourceTrackId:string;rangeId:string;enabled:boolean}
 | ({op:'saveSelected';name?:string}&SnapshotSelection)
 | ({op:'discardSelected'}&SnapshotSelection)
 | {op:'renameKey';trackId:string;keyId:string;name:string}
 | {op:'deleteKey';trackId:string;keyId:string}
 | {op:'setTolerance';pixels:number};
const fields:Record<SnapshotCommand['op'],string[]>={setDepth:['curveId','fillId','offset','scope'],setViewMirror:['relation'],setObjectLocks:['objectIds','locked'],applyDrawingTopology:['beforeDrawing','drawing'],createLocalLayer:['name','ref'],createLocalCurve:['layerId','shape','width','name','ref'],excludeElements:['layerId','elementIds'],restoreElements:['layerId','elementIds'],createRecording:['name','ref'],createTriangulatedRecording:['name','ref'],createTriangulatedRecordingCopy:['recordingId','name','ref'],createEndpointPairRecording:['startSnapshotId','endSnapshotId','name','ref'],correctShapeNode:['layerId','nodeId','position'],correctShapeHandle:['layerId','curveId','end','position'],setControlResponse:['targets','axis','points'],resetControlResponse:['targets','axis'],updateEndpointCorrection:[],discardEndpointCorrection:[],selectRecording:['recordingId'],renameRecording:['recordingId','name'],deleteRecording:['recordingId'],setAngle:['angle'],createSnapshot:['name','kind','angle','ref'],selectSnapshot:['snapshotId'],rebindSnapshotAngle:['snapshotId','angle'],updateSnapshot:['snapshotId','name'],deleteSnapshot:['snapshotId'],pasteLayers:['sourceSnapshotId','layerIds','ref'],cloneLayers:['sourceSnapshotId','layerIds','ref'],moveLayers:['sourceSnapshotId','layerIds'],removeLayers:['layerIds'],reorderLayers:['layerIds'],setLayerPlacement:['layerId','value'],transformShapeElements:['curveIds','value'],setShapeElementPlacement:['curveIds','value'],moveShapeNode:['layerId','nodeId','position'],moveShapeHandle:['layerId','curveId','end','position'],createWarp:['layerIds','name','rows','columns','ref'],createChild:['parentWarpId','layerIds','name','rows','columns','ref'],wrapParent:['warpIds','name','rows','columns','ref'],rebindLayers:['layerIds','warpId'],setWarp:['warpId','name','parentId'],deleteWarp:['warpId'],editWarpNodes:['warpId','edits','moveHandles'],setVisibility:['layerId','objectId','visible'],setLayerOrder:['layerId','value'],changeInterval:['layerId','sourceTrackId','rangeId','mode','start','end','fullLoop'],setIntervalEnd:['layerId','sourceTrackId','rangeId','end','style'],setIntervalEnabled:['layerId','sourceTrackId','rangeId','enabled'],saveSelected:['layerIds','warpIds','name'],discardSelected:['layerIds','warpIds'],renameKey:['trackId','keyId','name'],deleteKey:['trackId','keyId'],setTolerance:['pixels']};
export const snapshotCommandNames=Object.keys(fields) as SnapshotCommand['op'][];
export type RecordingSnapshotCommand=SnapshotCommand;
export class SnapshotCommandError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotCommandError(code,message);};
const clone=<T,>(value:T):T=>structuredClone(value);
const responseControl=(responses:SnapshotEndpointResponses,id:string,end?:0|1):SnapshotControlResponse=>{const map=end===undefined?responses.nodes:responses.handles;if(!Object.hasOwn(map,id))Object.defineProperty(map,id,{value:end===undefined?{}:[{},{}],writable:true,enumerable:true,configurable:true});return end===undefined?responses.nodes[id]:responses.handles[id][end];};
const object=(value:unknown,allowed:readonly string[]):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail('INVALID_REQUEST','Expected a JSON object.');const o=value as Record<string,unknown>,extra=Object.keys(o).filter(k=>!allowed.includes(k));if(extra.length)fail('INVALID_REQUEST',`Unknown fields: ${extra.join(', ')}`);return o;};
const id=(value:unknown,label='id'):string=>typeof value==='string'&&value.length>0&&value.length<=16384?value:fail('INVALID_REQUEST',`${label} must be a nonempty ID.`);
const name=(value:unknown):string=>typeof value==='string'&&!!value.trim()&&value.length<=256?value.trim():fail('INVALID_REQUEST','name must contain 1–256 characters.');
const number=(value:unknown,label:string,min=-10000,max=10000):number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:fail('INVALID_REQUEST',`${label} must be finite in ${min}…${max}.`);
const bool=(value:unknown):boolean=>typeof value==='boolean'?value:fail('INVALID_REQUEST','Expected a boolean.');
const point=(value:unknown):Point2=>{if(!Array.isArray(value)||value.length!==2)fail('INVALID_REQUEST','Expected [x,y].');const p=value as unknown[];return [number(p[0],'x',-1e6,1e6),number(p[1],'y',-1e6,1e6)];};
const ids=(value:unknown,empty=false):string[]=>{if(!Array.isArray(value)||value.length>16384||!empty&&!value.length)fail('INVALID_REQUEST','Expected a nonempty ID array.');const out=(value as unknown[]).map(v=>id(v));if(new Set(out).size!==out.length)fail('INVALID_REQUEST','IDs must be unique.');return out;};
const angle=(value:unknown):Angle=>{const a=object(value,['x','y']);return {x:number(a.x,'angle.x',-90,90),y:number(a.y,'angle.y',-90,90)};};
const placement=(value:unknown):ScenePlacementValue=>{const p=object(value,['translation','rotation','scale','scaleX','scaleY']);return {translation:point(p.translation),rotation:number(p.rotation,'rotation',-1e9,1e9),scale:number(p.scale,'scale',1e-6,1e6),...(p.scaleX===undefined?{}:{scaleX:number(p.scaleX,'scaleX',0,1e6)}),...(p.scaleY===undefined?{}:{scaleY:number(p.scaleY,'scaleY',0,1e6)})};};
export interface SnapshotCreation {kind:'curve'|'node'|'recording'|'snapshot'|'layer'|'warp'|'track'|'key';id:string;ref?:string;created:boolean}
export interface SnapshotCommandEffects {created:SnapshotCreation[];removedIds:string[];idMap?:Record<string,string>;diagnostics?:Array<{code:string;message:string}>}
export const allSnapshotIds=(workspace:RecordingSnapshotWorkspace):string[]=>[...Object.values(workspace.library).flatMap(map=>Object.keys(map)),...workspace.snapshots.flatMap(s=>[s.id,...Object.keys(s.nodeForks??{}),...s.layers.map(l=>l.id),...s.deformation.warps.map(w=>w.id),...(s.inheritedState?.warps??[]).map(w=>w.id)]),...workspace.recordings.flatMap(r=>[r.id,...r.tracks.flatMap(t=>[t.id,...t.keys.map(k=>k.id)])])];

/** The finite nonstructural command family can use snapshot-local copy on
 * write. Everything else retains the detached structural writer and full
 * validation; a caller cannot promote an unknown command with a trust flag. */
const localCommands=new Set<SnapshotCommand['op']>(['setAngle','selectSnapshot','setLayerPlacement','setShapeElementPlacement','moveShapeNode','moveShapeHandle','transformShapeElements','editWarpNodes','setVisibility','setLayerOrder','changeInterval','setIntervalEnd','setIntervalEnabled','setObjectLocks','setDepth','saveSelected','discardSelected','updateSnapshot','setTolerance','correctShapeNode','correctShapeHandle','setControlResponse','resetControlResponse','updateEndpointCorrection','discardEndpointCorrection']);
export function snapshotCommandStage(raw:unknown):'local'|'structural' {return raw&&typeof raw==='object'&&localCommands.has((raw as SnapshotCommand).op)?'local':'structural';}
export interface SnapshotCommandOptions {
 /** A placement-only batch validates membership/locks against its one complete
  * initial frame and checks linked-layer distances after all placements. */
 layerPlacementDrawing?:DrawingDocument;
}
interface SnapshotCommandMutationOptions extends SnapshotCommandOptions {
 readonly inputWorkspace?:RecordingSnapshotWorkspace;
 readonly completeWorkspace?:(workspace:RecordingSnapshotWorkspace)=>void;
 readonly snapshotForWrite?:(snapshotId:string)=>RecordingSnapshot;
 readonly trackForWrite?:(trackId:string)=>SnapshotPoseTrack;
}
export interface PreparedSnapshotCommand {workspace:RecordingSnapshotWorkspace;effects:SnapshotCommandEffects;stage:'local'|'structural'}
/** Every sequential command consumes one immutable, completed input and returns
 * one completed candidate. Evaluation never observes an identity still being
 * mutated by the command or another command later in its batch. */
export function prepareSnapshotCommand(before:RecordingSnapshotWorkspace,raw:unknown,options:SnapshotCommandOptions={}):PreparedSnapshotCommand {
 const original=before.recordings.find(recording=>recording.id===before.activeRecordingId),stage=snapshotCommandStage(raw),context=prepareRecordingContext(before,{immutableInputs:true,diagnostics:'preview'});
 const completed=(workspace:RecordingSnapshotWorkspace,effects:SnapshotCommandEffects,stage:'local'|'structural'):PreparedSnapshotCommand=>{context.fork(workspace);return {workspace,effects,stage};};
 if(stage==='structural'||original?.mode!=='triangulated'){
  const draft=clone(before),effects=executeSnapshotCommand(draft,raw,options);return completed(draft,effects,'structural');
 }
 const recording={...original},draft={...before,recordings:before.recordings.map(value=>value===original?recording:value)},written=new Map<string,RecordingSnapshot>();
 const snapshotForWrite=(snapshotId:string)=>{
  const known=written.get(snapshotId);if(known)return known;
  const source=before.snapshots.find(snapshot=>snapshot.id===snapshotId)??fail('NOT_FOUND','Snapshot does not exist.'),copy={...source,deformation:{...source.deformation,relationPositions:{...source.deformation.relationPositions}}};
  // These commands write drafts only, so saved-basis evaluation remains valid.
  if((raw as SnapshotCommand).op==='setLayerPlacement'||(raw as SnapshotCommand).op==='setShapeElementPlacement')retainSnapshotSavedEvaluationIdentity(copy,source);
  written.set(snapshotId,copy);draft.snapshots=draft.snapshots.map(value=>value===source?copy:value);return copy;
 };
 let complete:RecordingSnapshotWorkspace|undefined;
 const effects=executeSnapshotCommand(draft,raw,{...options,inputWorkspace:before,snapshotForWrite,completeWorkspace:workspace=>{complete=workspace;}});
 if(complete)return completed(complete,effects,stage);
 const changed=written.size>0||Object.keys(recording).some(key=>{const next=recording[key as keyof SnapshotRecording],prior=original[key as keyof SnapshotRecording];return next!==prior&&JSON.stringify(next)!==JSON.stringify(prior);});
 return completed(changed?draft:before,effects,stage);
}
/** Compatibility for domain callers that deliberately own a mutable draft.
 * Modern editor/API transactions consume prepareSnapshotCommand directly. */
export function applySnapshotCommand(workspace:RecordingSnapshotWorkspace,raw:unknown,options:SnapshotCommandOptions={}):SnapshotCommandEffects {
 // Never register immutable evaluation caches under the mutable facade input.
 const result=prepareSnapshotCommand(clone(workspace),raw,options);
 const replace=<T extends object>(target:T,value:T):T=>{for(const key of Object.keys(target))if(!Object.hasOwn(value,key))delete (target as Record<string,unknown>)[key];return Object.assign(target,value);};
 const snapshots=new Map(workspace.snapshots.map(value=>[value.id,value])),recordings=new Map(workspace.recordings.map(value=>[value.id,value]));
 const next={...result.workspace,snapshots:result.workspace.snapshots.map(value=>snapshots.has(value.id)?replace(snapshots.get(value.id)!,value):value),recordings:result.workspace.recordings.map(value=>recordings.has(value.id)?replace(recordings.get(value.id)!,value):value)};
 replace(workspace,next);return result.effects;
}
/** Existing typed writers own representation and geometry semantics. Structural
 * writers mutate only their detached transaction; local reads stay frozen. */
function executeSnapshotCommand(workspace:RecordingSnapshotWorkspace,raw:unknown,options:SnapshotCommandMutationOptions={}):SnapshotCommandEffects {
 const c=object(raw,['op',...new Set(Object.values(fields).flat())]),op=c.op as SnapshotCommand['op'];if(!Object.hasOwn(fields,op))fail('UNKNOWN_COMMAND',`Unknown snapshot command: ${String(op)}`);object(c,['op',...fields[op]]);
 const membershipBefore=['removeLayers','excludeElements','moveLayers','applyDrawingTopology'].includes(op)?captureSnapshotResponseMembership(workspace):undefined;
 const effects:SnapshotCommandEffects={created:[],removedIds:[]};let occupied:Set<string>|undefined;
 const fresh=()=>{occupied??=new Set(allSnapshotIds(workspace));for(let i=0;i<100;i++){const value=uid();if(!occupied.has(value)){occupied.add(value);return value;}}return fail('ID_COLLISION','Unable to allocate a fresh ID.');};
 const created=(kind:SnapshotCreation['kind'],entityId:string,isNew=true,withRef=false)=>effects.created.push({kind,id:entityId,created:isNew,...(withRef&&c.ref!==undefined?{ref:id(c.ref,'ref')}:{})});
 const seedExtremes=(recordingId:string,snapshotId:string)=>{
  const recording=workspace.recordings.find(r=>r.id===recordingId)!,view=workspace.snapshots.find(s=>s.id===snapshotId)!;
  let mirror=configuredSnapshotMirror(workspace,view).mirror;
  if(!mirror){const origin=recording.angleGraph?.mesh.vertices.find(vertex=>vertex.angle.x===0&&vertex.angle.y===0),front=origin&&workspace.snapshots.find(s=>s.id===origin.snapshotId);if(front)mirror=configuredSnapshotMirror(workspace,front).mirror;}
  const seeded=seedAutomaticExtremeSnapshots(workspace,recordingId,snapshotId,fresh,{mirror:mirror??{axisX:0,curvePairs:[]}});
  for(const sid of seeded.createdSnapshotIds)created('snapshot',sid);
  if(seeded.diagnostics.length)(effects.diagnostics??=[]).push(...seeded.diagnostics);
 };
 const findRecording=(value:unknown)=>workspace.recordings.find(r=>r.id===id(value,'recordingId'))??fail('NOT_FOUND','Recording does not exist.');
 const findSnapshot=(value:unknown)=>workspace.snapshots.find(s=>s.id===id(value,'snapshotId'))??fail('NOT_FOUND','Snapshot does not exist.');
 const snapshotForWrite=(snapshot:RecordingSnapshot)=>options.snapshotForWrite?.(snapshot.id)??snapshot;
 if(op==='createRecording'||op==='createTriangulatedRecording') {const recording=emptySnapshotRecording(fresh(),c.name===undefined?'Recording':name(c.name)),view=emptyRecordingSnapshot(fresh(),'View 1');workspace.recordings.push(recording);workspace.snapshots.push(view);recording.snapshotIds.push(view.id);recording.activeSnapshotId=view.id;workspace.activeRecordingId=recording.id;if(op==='createTriangulatedRecording'){recording.mode='triangulated';recording.angleGraph=createSnapshotAngleGraph([{snapshotId:view.id,angle:view.angle}]);}created('recording',recording.id,true,true);created('snapshot',view.id);if(op==='createTriangulatedRecording')seedExtremes(recording.id,view.id);return effects;}
 if(op==='createTriangulatedRecordingCopy'){const sourceId=c.recordingId===undefined?workspace.activeRecordingId:id(c.recordingId,'recordingId');if(!sourceId)fail('NO_RECORDING','Select an endpoint-pair Recording to copy.');const result=createTriangulatedRecordingCopy(workspace,sourceId!,{id:fresh(),...(c.name===undefined?{}:{name:name(c.name)})});if(!result.ok)fail(result.diagnostics[0]?.code??'INVALID_GRAPH',result.diagnostics.map(issue=>issue.message).join(' '));else{workspace.snapshots=result.workspace.snapshots;workspace.recordings=result.workspace.recordings;workspace.activeRecordingId=result.recordingId;created('recording',result.recordingId,true,true);for(const snapshotId of Object.values(result.snapshotIdMap))created('snapshot',snapshotId);for(const snapshotId of Object.values(result.snapshotIdMap))seedExtremes(result.recordingId,snapshotId);}return effects;}
 if(op==='selectRecording'){workspace.activeRecordingId=findRecording(c.recordingId).id;return effects;}
 if(op==='renameRecording'){findRecording(c.recordingId).name=name(c.name);return effects;}
 if(op==='deleteRecording'){const target=findRecording(c.recordingId);workspace.recordings=workspace.recordings.filter(r=>r!==target);if(workspace.activeRecordingId===target.id)workspace.activeRecordingId=workspace.recordings[0]?.id;effects.removedIds.push(target.id);return effects;}
 const recording=workspace.recordings.find(r=>r.id===workspace.activeRecordingId)??fail('NO_RECORDING','Create or select a Recording first.');
 if(recording.legacy)fail('LEGACY_READ_ONLY',recording.legacy.reason);
 const graph=recording.mode==='triangulated'?recording.angleGraph:undefined;
 const boundAngle=(view:RecordingSnapshot)=>graph?.mesh.vertices.find(vertex=>vertex.snapshotId===view.id)?.angle??view.angle;
 const sameBinding=(a:Angle,b:Angle)=>graph?a.x===b.x&&a.y===b.y:sameAngle(a,b);
 const realVertex=()=>graph?.mesh.vertices.find(vertex=>sameBinding(vertex.angle,recording.angle));
 const coupled=graph?.correctionFrames?.find(frame=>frame.status==='draft'&&frame.basisAdjustment);
 if(coupled&&(['createSnapshot','deleteSnapshot','rebindSnapshotAngle','setViewMirror'].includes(op)||realVertex()&&!['setAngle','selectSnapshot','setTolerance','discardEndpointCorrection','updateEndpointCorrection'].includes(op)))fail('SURFACE_BASIS_DRAFT_OWNED','Return to the intermediate correction angle and save or discard its coupled basis and responses before editing real views or their dependencies.');
 const snapshot=()=>{const selectedId=realVertex()?.snapshotId??recording.activeSnapshotId,s=selectedId&&workspace.snapshots.find(s=>s.id===selectedId);return s||fail('NO_SNAPSHOT','Create or select a snapshot first.');};
 const ownedSnapshot=(value:unknown)=>{const s=findSnapshot(value);if(!recording.snapshotIds.includes(s.id))fail('NOT_FOUND','Snapshot does not belong to this Recording.');return s;};
 const layer=(value:unknown,s=snapshot())=>s.layers.find(l=>l.id===id(value,'layerId'))??fail('MISSING_LAYER','Layer does not exist in this snapshot.');
 const selectedLayers=(value:unknown,s=snapshot())=>ids(value).map(value=>layer(value,s));
 const evaluated=(s=snapshot(),at=recording.angle,useDraft=true)=>recording.mode==='endpoint-pair'||graph?evaluateWorkspace(options.inputWorkspace??workspace,recording.id,{snapshotId:s.id,angle:at,useDraft,diagnostics:'preview',immutableInputs:!!options.inputWorkspace}):resolveSnapshot(options.inputWorkspace??workspace,s.id,{angle:at,useDraft});
 const state=()=>evaluated().state;
 const writable=(track:SnapshotPoseTrack)=>{if(track.draft&&!sameAngle(track.draft.angle,recording.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','This channel has a draft at another angle. Return to that angle or discard its draft.');};
 const ensureTrack=(channel:SnapshotPoseTrack['channel'],targetId:string,elementId?:string,sourceTrackId?:string):SnapshotPoseTrack=>{if(graph)return {id:JSON.stringify(['snapshot-local',channel,targetId,elementId,sourceTrackId]),channel,targetId,keys:[],...(elementId?{elementId}:{}),...(sourceTrackId?{sourceTrackId}:{})} as SnapshotPoseTrack;let track=recording.tracks.find(t=>t.channel===channel&&t.targetId===targetId&&(channel==='interval'?t.channel==='interval'&&t.sourceTrackId===sourceTrackId:t.elementId===elementId));if(!track){track={id:fresh(),channel,targetId,keys:[],interpolation:'independent',...(elementId?{elementId}:{}),...(sourceTrackId?{sourceTrackId}:{})} as SnapshotPoseTrack;recording.tracks.push(track);created('track',track.id);if(recording.mode==='endpoint-pair'){const seeds=recording.snapshotIds.map(sid=>{const view=findSnapshot(sid),saved=resolveSnapshot(workspace,view.id,{angle:view.angle,useDraft:false,diagnostics:'preview'}).state;return {view,value:channelValue(saved,track!)??defaultChannelValue(track!)};});for(const {view,value} of seeds){if(value===undefined)continue;const key={id:fresh(),angle:clone(view.angle),value:clone(value)};(track as SceneTrack<unknown>).keys.push(key);snapshotForWrite(view).authored=[...view.authored,{trackId:track.id,keyId:key.id}];created('key',key.id);}}}return track;};
 const setDraft=(track:SnapshotPoseTrack,value:unknown)=>{if(graph){
  if(!realVertex())fail('REAL_SNAPSHOT_REQUIRED','Select a real saved vertex before editing snapshot-local channels.');
  const target=snapshotForWrite(snapshot()),prior=target.draft?.deformation??emptySnapshotDeformationState(),next={...prior,layers:{...prior.layers},relationPositions:{...prior.relationPositions}};
  if(track.channel==='warp'){const warp=prior.warps.find(warp=>warp.id===track.targetId)??state().warps.find(warp=>warp.id===track.targetId)??fail('NOT_FOUND','Warp does not exist.');next.warps=[...prior.warps.filter(warp=>warp.id!==track.targetId),{...warp,grid:clone(value) as WarpGrid}];}
  else if(track.channel==='relationPosition'){const relation=prior.relationPositions[track.targetId]??state().relationPositions[track.targetId]??fail('NOT_FOUND','Linked position does not exist.');next.relationPositions[track.targetId]={...relation,offset:clone(value) as Point2};}
  else {const local={...prior.layers[track.targetId]};switch(track.channel){case 'placement':if(track.elementId)local.elementPlacements={...local.elementPlacements,[track.elementId]:clone(value) as ScenePlacementValue};else local.placement=clone(value) as ScenePlacementValue;break;case 'shape':local.shape=clone(value) as SceneShapeValue;break;case 'visibility':local.visibility={...local.visibility,[track.elementId??track.targetId]:value as boolean|null};break;case 'interval':local.intervals={...local.intervals,[track.sourceTrackId]:clone(value) as SceneIntervalValue};break;case 'depth':local.depth=value as number;break;}next.layers[track.targetId]=local;}
  target.draft={angle:clone(target.angle),deformation:next,channels:[]};return;
 }writable(track);const target=options.trackForWrite?.(track.id)??track;(target as SceneTrack<unknown>).draft={angle:clone(recording.angle),value:clone(value)};};
 const commit=(tracks:SnapshotPoseTrack[],target:RecordingSnapshot,label?:string)=>{for(const track of tracks){if(!track.draft||!sameAngle(track.draft.angle,target.angle))continue;const old=track.keys.find(k=>sameAngle(k.angle,target.angle)),key={id:old?.id??fresh(),angle:clone(target.angle),value:clone(track.draft.value),...(label?{name:label}:old?.name?{name:old.name}:{})};(track as SceneTrack<unknown>).keys=old?track.keys.map(k=>k===old?key:k):[...track.keys,key];delete track.draft;for(const other of workspace.snapshots)if(other!==target)other.authored=other.authored.filter(ref=>ref.keyId!==key.id);target.authored=target.authored.filter(ref=>ref.trackId!==track.id);target.authored.push({trackId:track.id,keyId:key.id});created('key',key.id,!old);}};
 const selectedTracks=()=>{const ls=c.layerIds===undefined?[]:selectedLayers(c.layerIds).map(l=>l.id),ws=c.warpIds===undefined?[]:ids(c.warpIds);if(!ls.length&&!ws.length)fail('INVALID_REQUEST','Select explicit layerIds or warpIds.');const evaluation=evaluated(),current=evaluation.state;for(const w of ws)if(!current.warps.some(x=>x.id===w))fail('NOT_FOUND','Warp does not exist.');const bound=new Set(current.bindings.filter(b=>ls.includes(b.layerId)).map(b=>b.warpId)),objects=new Set(evaluation.source.layers.filter(l=>ls.includes(l.id)).flatMap(l=>l.items)),links=new Set((evaluation.source.endpointLinks??[]).filter(link=>objects.has(link.a.curveId)||objects.has(link.b.curveId)).map(link=>link.id));return recording.tracks.filter(t=>ls.includes(t.targetId)||ws.includes(t.targetId)||t.channel==='warp'&&bound.has(t.targetId)||t.channel==='relationPosition'&&current.relationPositions[t.targetId]?.sourceLinkIds.some(id=>links.has(id)));};
 const pair=recording.mode==='endpoint-pair'?recording.endpointPair:undefined;
 const pairViews=()=>{if(!pair)return fail('ENDPOINT_PAIR_REQUIRED','Select an endpoint-pair Recording first.');return [ownedSnapshot(pair.startSnapshotId),ownedSnapshot(pair.endSnapshotId)] as const;};
 const pairIntermediate=!!pair&&!pairViews().some(view=>sameAngle(view.angle,recording.angle));
 const pairGeometry=()=>{const views=pairViews(),drawings=views.map(view=>resolveSnapshot(workspace,view.id,{angle:view.angle,useDraft:false,diagnostics:'preview'}).drawing) as [DrawingDocument,DrawingDocument],issues=endpointPairCompatibility(...drawings);if(issues.length)fail('ENDPOINT_BASIS_INCOMPATIBLE',issues.join(' '));return {views,drawings,authorities:endpointPairNodeAuthorities(drawings[0])};};
 const finishPairDraft=(save:boolean,selected?:string[])=>{if(!pair)return fail('ENDPOINT_PAIR_REQUIRED','Select an endpoint-pair Recording first.');if(!pair.draft)return;if(save&&!sameAngle(pair.draft.angle,recording.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','Return to the correction draft angle before saving it.');if(!selected){if(save)pair.responses=clone(pair.draft.responses);delete pair.draft;return;}const geometry=pairGeometry(),curves=geometry.drawings[0].curves.filter(curve=>geometry.drawings[0].layers.some(layer=>selected.includes(layer.id)&&layer.items.includes(curve.id))),nodeIds=new Set(curves.flatMap(curve=>curve.nodes.map(nodeId=>geometry.authorities.get(nodeId)??nodeId))),curveIds=new Set(curves.map(curve=>curve.id)),saved=clone(pair.responses??{nodes:{},handles:{}}),draft=clone(pair.draft.responses);for(const [kind,selectedIds] of [['nodes',nodeIds],['handles',curveIds]] as const)for(const key of new Set([...Object.keys(saved[kind]),...Object.keys(draft[kind])])){if(!selectedIds.has(key))continue;const from=save?draft:saved,to=save?saved:draft;if(!Object.hasOwn(from[kind],key))delete to[kind][key];else Object.defineProperty(to[kind],key,{value:clone(from[kind][key]),writable:true,enumerable:true,configurable:true});}pair.responses=saved;pair.draft={...pair.draft,responses:draft};if(JSON.stringify(saved)===JSON.stringify(draft))delete pair.draft;};
 if(pair){
  if(['createSnapshot','deleteSnapshot','deleteKey'].includes(op))fail('ENDPOINT_PAIR_KEYS_ONLY','Endpoint-pair mode has exactly two genuine basis snapshots. Edit corrections between them; keep arbitrary keys in the original Recording.');
  const always=['setAngle','selectSnapshot','setTolerance','createEndpointPairRecording','moveShapeNode','moveShapeHandle','transformShapeElements','correctShapeNode','correctShapeHandle','setControlResponse','resetControlResponse','saveSelected','discardSelected','updateSnapshot','updateEndpointCorrection','discardEndpointCorrection'];
  if(pairIntermediate&&!always.includes(op))fail('ENDPOINT_CORRECTION_ONLY','At a correction angle, edit controls or transform selected curves. Edit placement, Warp, material and layer structure at a basis endpoint.');
 }
 const controlTargets=(raw:unknown,geometry:ReturnType<typeof pairGeometry>):SnapshotControlTarget[]=>{if(!Array.isArray(raw)||!raw.length||raw.length>16384)fail('INVALID_REQUEST','Select 1…16384 control targets.');const seen=new Set<string>();return (raw as unknown[]).map(value=>{const target=object(value,['layerId','nodeId','curveId','end']),layerId=id(target.layerId,'layerId'),owner=geometry.drawings[0].layers.find(layer=>layer.id===layerId)??fail('MISSING_LAYER','Control target layer is missing.');let result:SnapshotControlTarget,key:string;if(target.nodeId!==undefined){if(target.curveId!==undefined||target.end!==undefined)fail('INVALID_REQUEST','A node target cannot also name a handle.');const nodeId=id(target.nodeId,'nodeId');if(!geometry.drawings[0].curves.some(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(nodeId)))fail('MISSING_ELEMENT','Node is not owned by this layer.');result={layerId,nodeId:geometry.authorities.get(nodeId)??nodeId};key=JSON.stringify(['node',result.nodeId]);}else{const curveId=id(target.curveId,'curveId');if(target.end!==0&&target.end!==1)fail('INVALID_REQUEST','Handle end must be 0 or 1.');if(!owner.items.includes(curveId)||!geometry.drawings[0].curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Handle curve is not owned by this layer.');result={layerId,curveId,end:target.end as 0|1};key=JSON.stringify(['handle',curveId,target.end]);}if(seen.has(key))fail('INVALID_REQUEST','Control targets must be unique after linked-node authority resolution.');seen.add(key);return result;});};
 /** A and V freeze one final frame, then share this inverse transaction. */
 const pairCorrectionFrame=()=>{
  const views=pairViews();if(!pairIntermediate)fail('ENDPOINT_CORRECTION_REQUIRES_INTERIOR','Inverse corrections belong strictly between the two saved basis endpoints. Edit the endpoint basis directly here.');
  const t=(recording.angle.x-views[0].angle.x)/(views[1].angle.x-views[0].angle.x);if(recording.angle.y!==views[0].angle.y||!(t>0&&t<1))fail('ENDPOINT_PAIR_ANGLE','Choose an angle strictly inside this pair’s yaw interval.');
  if(pair!.draft&&!sameAngle(pair!.draft.angle,recording.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','A correction draft exists at another angle. Save or discard it before editing a different angle.');
  return evaluated();
 };
 const applyPairTargets=(evaluation:ReturnType<typeof evaluated>,next:DrawingDocument)=>{
  const basis=evaluation.endpointPair!,current=evaluation.drawing,t=basis.progress;
  const index=(drawing:DrawingDocument)=>({nodes:new Map(drawing.nodes.map(node=>[node.id,node.position])),curves:new Map(drawing.curves.map(curve=>[curve.id,curve]))});
  const prior=index(current),wanted=index(next),start=index(basis.start.drawing),end=index(basis.end.drawing);
  const updates:{id:string;end?:0|1;axis:'x'|'y';value:number}[]=[];
  const solve=(targetKind:'Node'|'Handle',targetId:string,previous:Point2,target:Point2,first:Point2,last:Point2,handleEnd?:0|1)=>{
   for(const [coordinate,axis] of ['x','y'].entries()){
    if(Math.abs(target[coordinate]-previous[coordinate])<=64*Number.EPSILON*Math.max(1,Math.abs(target[coordinate]),Math.abs(previous[coordinate])))continue;
    const solved=invertEndpointPairCoordinate(first[coordinate],last[coordinate],target[coordinate]);
    if(!solved.available)return fail('ENDPOINT_AXIS_UNAVAILABLE',`${targetKind} ${targetId}${handleEnd===undefined?'':` end ${handleEnd}`} ${axis.toUpperCase()}: ${solved.reason} Edit that coordinate in a basis endpoint first.`);
    updates.push({id:targetId,end:handleEnd,axis:axis as 'x'|'y',value:solved.value});
   }
  };
  for(const node of next.nodes){
   const authority=basis.nodeAuthorities[node.id]??node.id;
   if(authority!==node.id){if(length(sub(node.position,wanted.nodes.get(authority)!))>1e-7)fail('ENDPOINT_CONSTRAINT_UNSOLVABLE',`Node ${node.id} conflicts with linked position authority ${authority}.`);continue;}
   solve('Node',authority,prior.nodes.get(authority)!,node.position,start.nodes.get(authority)!,end.nodes.get(authority)!);
  }
  const vector=(drawing:ReturnType<typeof index>,curveId:string,handleEnd:0|1)=>{const curve=drawing.curves.get(curveId)!;return sub(curve.handles[handleEnd],drawing.nodes.get(curve.nodes[handleEnd])!);};
  for(const curve of next.curves)for(const handleEnd of [0,1] as const)solve('Handle',curve.id,vector(prior,curve.id,handleEnd),vector(wanted,curve.id,handleEnd),vector(start,curve.id,handleEnd),vector(end,curve.id,handleEnd),handleEnd);
  if(!updates.length)return;
  // Build and replay the complete candidate before touching even the draft.
  const responses=clone(pair!.draft?.responses??pair!.responses??{nodes:{},handles:{}});
  for(const update of updates){const control=responseControl(responses,update.id,update.end),knots=(control[update.axis]??[]).filter(point=>Math.abs(point[0]-t)>1e-10);knots.push([t,update.value]);knots.sort((a,b)=>a[0]-b[0]);control[update.axis]=knots;}
  try{validateSnapshotEndpointResponses(responses);}catch(error){fail('INVALID_REQUEST',(error as Error).message);}
  const actual=index(interpolateEndpointPairGeometry(basis.start.drawing,basis.end.drawing,t,responses,{startWins:t<.5||t===.5&&basis.start.angle.x<basis.end.angle.x}).drawing);
  const verify=(label:string,position:Point2|undefined,target:Point2)=>{if(!position||length(sub(position,target))>1e-7)fail('ENDPOINT_CONSTRAINT_UNSOLVABLE',`${label}: this correction conflicts with a linked or smooth endpoint constraint. Edit the responsible basis control or its driver first.`);};
  for(const node of next.nodes)verify(`Node ${node.id}`,actual.nodes.get(node.id),node.position);
  for(const curve of next.curves)for(const handleEnd of [0,1] as const)verify(`Handle ${curve.id} end ${handleEnd}`,actual.curves.get(curve.id)?.handles[handleEnd],curve.handles[handleEnd]);
  pair!.draft={angle:clone(recording.angle),responses};
 };
 const applyPairCorrection=(kind:'node'|'handle')=>{
  const e=pairCorrectionFrame(),current=e.drawing,owner=current.layers.find(value=>value.id===layer(c.layerId).id)??fail('MISSING_LAYER','Resolved layer is missing.'),position=point(c.position);let next:DrawingDocument;
  if(kind==='node'){const nodeId=id(c.nodeId,'nodeId');if(!current.curves.some(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(nodeId)))fail('MISSING_ELEMENT','Node is not owned by this layer.');next=moveNode(current,nodeId,position,true);}
  else{const curveId=id(c.curveId,'curveId');if(!owner.items.includes(curveId)||!current.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Curve is not owned by this layer.');if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');next=moveHandle(current,{curveId,end:c.end as 0|1},position,true);}
  applyPairTargets(e,next);
 };
 const applyPairTransform=()=>{
  const curveIds=ids(c.curveIds),delta=placement(c.value),e=pairCorrectionFrame();
  for(const curveId of curveIds)if(!e.drawing.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Selected curve does not exist.');
  const transformed=transform(e.drawing,curveIds,p=>applyScenePlacement(delta,p),true,false),joins=new Map(e.drawing.joins.map(join=>[join.id,join])),links=new Map((e.drawing.endpointLinks??[]).map(link=>[link.id,link]));
  // Responses represent final controls only, so never silently drop a requested
  // ARC brush parameter change from the ordinary Drawing transform target.
  for(const join of transformed.joins){const prior=joins.get(join.id);if(join.mode==='ARC'&&prior?.mode==='ARC'&&Math.abs(join.radius!-prior.radius!)>64*Number.EPSILON*Math.max(1,Math.abs(join.radius!),Math.abs(prior.radius!)))fail('ENDPOINT_ARC_BASIS_REQUIRED',`ARC ${join.id} radius changes in this transform. Endpoint corrections store node and handle responses only; edit the ARC brush in a basis endpoint first.`);}
  for(const link of transformed.endpointLinks??[]){const prior=links.get(link.id);if((link.joinBrush?.kind==='ARC'||prior?.joinBrush?.kind==='ARC')&&JSON.stringify(link.joinBrush)!==JSON.stringify(prior?.joinBrush))fail('ENDPOINT_ARC_BASIS_REQUIRED',`ARC ${link.id} brush changes in this transform. Endpoint corrections store node and handle responses only; edit the ARC brush in a basis endpoint first.`);}
  applyPairTargets(e,projectSnapshotTransformTargets(e.drawing,transformed));
 };
 const finishSurfaceDraft=(save:boolean,selected?:string[])=>{
  if(!recording.angleGraph)fail('SURFACE_REQUIRED','Select a triangulated Recording first.');
  const pending=effectiveSnapshotSurfaceResponses(recording.angleGraph!).draft;
  if(pending?.basisAdjustment){
   if(selected&&pending.basisAdjustment.layerIds.some(id=>!selected?.includes(id)))fail('PARTIAL_BASIS_ADJUSTMENT','Select every layer in this coupled basis correction, or save/discard the complete correction.');
   selected=undefined;
  }
  recording.angleGraph=finishSnapshotPropertyDraft(recording.angleGraph!,save,selected);
  const effective=effectiveSnapshotSurfaceResponses(recording.angleGraph!),draft=effective.draft;if(!draft)return;
  if(save&&!sameBinding(draft.angle,recording.angle))fail('OBJECT_DRAFT_AT_OTHER_ANGLE','Return to the correction draft angle before saving it.');
  if(draft.basisAdjustment){
   const owners=draft.basisAdjustment.snapshotIds.map(id=>findSnapshot(id));
   if(owners.some(owner=>!owner.draft))fail('SURFACE_BASIS_DRAFT_MISSING','A companion 90° draft is missing. Restore the complete correction before saving or discarding it.');
   for(const owner of owners){const writable=snapshotForWrite(owner);if(save)writable.deformation=mergeSnapshotDeformation(writable.deformation,writable.draft!.deformation);delete writable.draft;}
   // The response and every companion basis are one authored transaction.
   selected=undefined;
  }
  if(!selected){recording.angleGraph={...recording.angleGraph!,...(save?{edgeResponses:effective.edgeResponses,triangleResponses:effective.triangleResponses,...recording.angleGraph!.responseExpressions||draft.responseExpressions?{responseExpressions:effective.responseExpressions}:{}}:{}),correctionFrames:save?recording.angleGraph!.correctionFrames!.map(frame=>frame===draft?{id:frame.id,angle:clone(frame.angle),status:'saved' as const}:frame):recording.angleGraph!.correctionFrames!.filter(frame=>frame!==draft)};return;}
  const e=evaluated(snapshot(),draft.angle),curves=e.drawing.curves.filter(curve=>e.drawing.layers.some(layer=>selected.includes(layer.id)&&layer.items.includes(curve.id))),curveIds=new Set(curves.map(curve=>curve.id)),nodeIds=new Set(curves.flatMap(curve=>curve.nodes.map(id=>e.angleSurface?.nodeAuthorities[id]??id)));
  const nextGraph={...recording.angleGraph!},nextFrame={...draft};
  for(const key of ['edgeResponses','triangleResponses','responseExpressions'] as const){
   const saved:Record<string,SnapshotEndpointResponses|SnapshotTriangleResponses|NonNullable<SnapshotAngleGraph['responseExpressions']>[string]>={...nextGraph[key]},pending:Record<string,SnapshotEndpointResponses|SnapshotTriangleResponses|NonNullable<SnapshotAngleGraph['responseExpressions']>[string]>={...draft[key]};
   for(const [simplexId,response] of Object.entries(pending)){
    const prior=saved[simplexId]??{nodes:{},handles:{}},savedResponse={nodes:{...prior.nodes},handles:{...prior.handles}},draftResponse={nodes:{...response.nodes},handles:{...response.handles}};
    for(const [kind,chosen] of [['nodes',nodeIds],['handles',curveIds]] as const)for(const target of new Set([...Object.keys(savedResponse[kind]),...Object.keys(draftResponse[kind])]))if(chosen.has(target)){const from=save?draftResponse:savedResponse,to=save?savedResponse:draftResponse;if(Object.hasOwn(from[kind],target))Object.defineProperty(to[kind],target,{value:from[kind][target],writable:true,enumerable:true,configurable:true});else delete to[kind][target];}
    if(save)Object.defineProperty(saved,simplexId,{value:savedResponse,writable:true,enumerable:true,configurable:true});
    if(JSON.stringify(savedResponse)===JSON.stringify(draftResponse))delete pending[simplexId];else Object.defineProperty(pending,simplexId,{value:draftResponse,writable:true,enumerable:true,configurable:true});
   }
   Object.assign(nextGraph,{[key]:save?saved:nextGraph[key]});if(Object.keys(pending).length)Object.assign(nextFrame,{[key]:pending});else delete nextFrame[key];
  }
  const remaining=!!nextFrame.edgeResponses||!!nextFrame.triangleResponses||!!nextFrame.responseExpressions||!!nextFrame.propertyResponses;
  nextGraph.correctionFrames=recording.angleGraph!.correctionFrames!.flatMap(frame=>frame!==draft?[frame]:remaining?[nextFrame]:save?[{id:frame.id,angle:clone(frame.angle),status:'saved' as const}]:[]);recording.angleGraph=nextGraph;
 };
 const finishLocalDraft=(save:boolean,target=snapshot(),selected=false)=>{
  if(snapshotSurfaceOwnsBasisDraft(recording.angleGraph,target.id))fail('SURFACE_BASIS_DRAFT_OWNED','Return to the intermediate correction angle and save or discard its coupled basis and responses together.');
  if(!sameBinding(boundAngle(target),recording.angle))fail('SNAPSHOT_ANGLE_MISMATCH','Navigate to the snapshot’s saved angle before updating it.');
  if(!target.draft)return;
  const writable=snapshotForWrite(target),draft=writable.draft!,all=draft.deformation;
  if(!selected){if(save)writable.deformation=mergeSnapshotDeformation(writable.deformation,all);delete writable.draft;return;}
  const layers=c.layerIds===undefined?[]:selectedLayers(c.layerIds,target).map(layer=>layer.id),warps=c.warpIds===undefined?[]:ids(c.warpIds,true);if(!layers.length&&!warps.length)fail('INVALID_REQUEST','Select explicit layerIds or warpIds.');
  const e=evaluated(target),selectedWarps=new Set([...warps,...e.state.bindings.filter(binding=>layers.includes(binding.layerId)).map(binding=>binding.warpId)]),curves=new Set(e.drawing.layers.filter(layer=>layers.includes(layer.id)).flatMap(layer=>layer.items)),links=new Set((e.drawing.endpointLinks??[]).filter(link=>curves.has(link.a.curveId)||curves.has(link.b.curveId)).map(link=>link.id));
  const take=emptySnapshotDeformationState(),left=clone(all);for(const layerId of layers)if(all.layers[layerId]){take.layers[layerId]=all.layers[layerId];delete left.layers[layerId];}
  if(all.layerDomains){const chosen=all.layerDomains.filter(domain=>domain.layerIds.some(id=>layers.includes(id)));if(chosen.some(domain=>domain.layerIds.some(id=>!layers.includes(id))))fail('PARTIAL_LAYER_DOMAIN','Select every layer in the shared domain before saving or discarding it.');const selectedDomains=new Set(chosen.map(domain=>domain.id));take.layerDomains=chosen;left.layerDomains=all.layerDomains.filter(domain=>!selectedDomains.has(domain.id));}
  take.warps=all.warps.filter(warp=>selectedWarps.has(warp.id));left.warps=all.warps.filter(warp=>!selectedWarps.has(warp.id));take.bindings=all.bindings.filter(binding=>layers.includes(binding.layerId));left.bindings=all.bindings.filter(binding=>!layers.includes(binding.layerId));
  for(const [key,relation] of Object.entries(all.relationPositions))if(relation.sourceLinkIds.some(id=>links.has(id))){take.relationPositions[key]=relation;delete left.relationPositions[key];}
  if(save)writable.deformation=mergeSnapshotDeformation(writable.deformation,take);
  if(!left.layerDomains?.length&&!left.warps.length&&!left.bindings.length&&!Object.keys(left.layers).length&&!Object.keys(left.relationPositions).length)delete writable.draft;else writable.draft={...draft,deformation:left};
 };
 /** Geometry commands freeze the same authenticated producer used by Drawing
  * gestures. Numeric/API nodes deliberately keep followStrength at zero. */
 const applyControlTarget=(e:ReturnType<typeof evaluated>)=>{try{
  if(graph&&!realVertex()&&(!e.angleSurface?.simplex||e.angleSurface.role==='outside'))fail('SURFACE_OUTSIDE_COVERAGE','This angle is outside saved snapshot coverage. Red projected geometry is read-only.');
  const current=e.drawing;let plan:DrawingControlEditPlan,wanted:DrawingDocument;
  if(op==='transformShapeElements'){
   const curveIds=ids(c.curveIds),delta=placement(c.value);
   for(const curveId of curveIds)if(!current.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Selected curve is not present in normal snapshot coverage.');
   plan=prepareDrawingControlEditPlan(current,{kind:'curves',curveIds,preserveRelations:true});
   wanted=applyDrawingControlEditPlan(plan,{kind:'map',map:point=>applyScenePlacement(delta,point),allowRelated:true,project:projectSnapshotTransformTargets});
  }else{
   const owner=current.layers.find(value=>value.id===id(c.layerId,'layerId'))??fail('MISSING_LAYER','Resolved layer is missing.'),position=point(c.position);
   if(op==='moveShapeNode'||op==='correctShapeNode'){
    const nodeId=id(c.nodeId,'nodeId');if(!current.curves.some(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(nodeId)))fail('MISSING_ELEMENT','Node is not owned by this layer.');
    plan=prepareDrawingControlEditPlan(current,{kind:'node',nodeId,followStrength:0,allowHidden:true});
   }else{
    const curveId=id(c.curveId,'curveId');if(!owner.items.includes(curveId)||!current.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Curve is not owned by this layer.');if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');
    plan=prepareDrawingControlEditPlan(current,{kind:'handle',endpoint:{curveId,end:c.end as 0|1},allowHidden:true});
   }
   wanted=applyDrawingControlEditPlan(plan,{kind:'point',position});
  }
   const input=options.inputWorkspace??clone(workspace),next=prepareSnapshotDrawingControlTarget(input,{recordingId:recording.id,snapshotId:e.snapshotId,angle:recording.angle,beforeDrawing:current,drawing:wanted,controlPlan:plan});
   if(options.completeWorkspace)options.completeWorkspace(next);else Object.assign(workspace,next);
  }catch(error){if(error&&typeof error==='object'&&'code' in error)fail(String(error.code),String('message' in error?error.message:error));throw error;}
 };
 const applySurfaceIntervalEdit=()=>{
  const e=evaluated(),surface=e.angleSurface;
  if(!surface?.simplex||surface.role==='outside')fail('PROPERTY_OUTSIDE_COVERAGE','Interval responses require a normally covered angle; red reference geometry is read-only.');
  const layerId=id(c.layerId,'layerId'),sourceTrackId=id(c.sourceTrackId,'sourceTrackId'),rangeId=id(c.rangeId,'rangeId');
  const material=e.drawing.displayIntervals?.find(track=>track.id===sourceTrackId);
  if(!material||!e.drawing.layers.find(layer=>layer.id===layerId)?.items.includes(material.anchor.id))fail('MISSING_INTERVAL','The interval is not present in this layer at the current covered angle.');
  if(!material!.ranges.some(range=>range.id===rangeId))fail('MISSING_INTERVAL','The interval range is absent at the current covered angle.');
  if(c.mode!==undefined||c.fullLoop!==undefined)fail('PROPERTY_BASIS_REQUIRED','Change interval mode or loop structure in a real snapshot; its start and end positions can have independent response constraints here.');
  if(c.start===undefined&&c.end===undefined)fail('INVALID_REQUEST','Provide an interval start or end position.');
  const basis=snapshotSimplexIntervalBasisValues(surface!.bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing})),e.drawing,sourceTrackId,rangeId,recording.angleGraph?.materialPartitions,recording.angleGraph?.materialPathLineages);
  const propertyOptions={omitZeroEdgeResponses:!!surface!.mirrorContext&&e.angle.x>0},native=createSnapshotPropertyResponseSampler(recording.angleGraph!,surface!.simplex!,propertyOptions),currentRange=material!.ranges.find(range=>range.id===rangeId)!;
  const edits=(['start','end'] as const).flatMap(end=>{if(c[end]===undefined)return [];const target={kind:'interval-endpoint' as const,layerId,sourceTrackId,rangeId,end};const mapped=snapshotMaterialPartitionAddress(recording.angleGraph?.materialPartitions,target),path=recording.angleGraph?.materialPathLineages?.some(lineage=>lineage.sourceTrackId===sourceTrackId),logical=mapped?.target??target,current=mapped||path?snapshotMaterialPartitionValue(recording.angleGraph?.materialPartitions,e.drawing,logical,recording.angleGraph?.materialPathLineages)!:currentRange[end],wanted=number(c[end],end,0,1);if((mapped||path)&&wanted===currentRange[end])return [];return [{target:logical,basisValues:basis[end],value:path?snapshotPathMaterialValue(recording.angleGraph?.materialPathLineages,e.drawing,target,wanted)!:mapped?snapshotMaterialPartitionParentValue(mapped,e.drawing,wanted):wanted,residual:current-native(logical,basis[end])}];});
  try{const result=prepareSnapshotPropertyTargetEdit(recording.angleGraph!,surface!.simplex!,edits,{...propertyOptions,angle:recording.angle,frameId:effectiveSnapshotSurfaceResponses(recording.angleGraph!).draft?.id??fresh()});if(result.changed)recording.angleGraph=result.graph;}catch(error){if(error instanceof SnapshotPropertyResponseError)fail(error.code,error.message);throw error;}
 };
 if(graph&&['renameKey','deleteKey'].includes(op))fail('SURFACE_LEGACY_TRACKS_READ_ONLY','Retained legacy channels are recovery data. Edit this Recording through its real snapshots or response surface.');
 if(graph&&!realVertex()&&!new Set<SnapshotCommand['op']>(['createEndpointPairRecording','setAngle','selectSnapshot','rebindSnapshotAngle','createSnapshot','updateSnapshot','deleteSnapshot','correctShapeNode','correctShapeHandle','moveShapeNode','moveShapeHandle','transformShapeElements','changeInterval','updateEndpointCorrection','discardEndpointCorrection','saveSelected','discardSelected','setTolerance']).has(op))fail('REAL_SNAPSHOT_REQUIRED','This command changes a real snapshot. Select its exact saved vertex first; correction frames only edit normal node and handle targets.');
 const currentWarp=(value:unknown,current=state())=>current.warps.find(w=>w.id===id(value,'warpId'))??fail('NOT_FOUND','Warp does not exist.');
 const structuralState=()=>{const s=snapshot(),value=state();s.deformation=clone(value);delete s.inheritedState;return s.deformation;};
 const newWarp=(bounds:WarpGrid['bounds'],parentId?:string)=>{const rows=c.rows===undefined?3:number(c.rows,'rows',1,16),columns=c.columns===undefined?3:number(c.columns,'columns',1,16);if(!Number.isInteger(rows)||!Number.isInteger(columns))fail('INVALID_REQUEST','Grid subdivisions must be integers.');const current=structuralState(),restGrid=createWarpGrid(bounds,rows,columns),warp={id:fresh(),name:c.name===undefined?`Warp ${current.warps.length+1}`:name(c.name),restGrid,grid:clone(restGrid),...(parentId?{parentId}:{})};current.warps.push(warp);created('warp',warp.id,true,true);if(graph)return warp;const track=ensureTrack('warp',warp.id);for(const sid of recording.snapshotIds){const view=findSnapshot(sid);if(track.keys.some(k=>sameAngle(k.angle,view.angle)))continue;const key={id:fresh(),angle:clone(view.angle),value:clone(restGrid)};(track as SceneTrack<WarpGrid>).keys.push(key);view.authored.push({trackId:track.id,keyId:key.id});created('key',key.id);}return warp;};
 switch(op){
  case 'setDepth':{
   if((c.curveId!==undefined)===(c.fillId!==undefined))fail('INVALID_REQUEST','Provide exactly one curveId or fillId.');
   const target=snapshot(),input=options.inputWorkspace??workspace;assertSnapshotTopologyVertex(input,recording.id,target.id,recording.angle);
   const beforeDrawing=evaluated().drawing,key=c.fillId!==undefined?'fillId':'curveId',objectId=id(c[key],key),object=(key==='fillId'?beforeDrawing.fills:beforeDrawing.curves).find(value=>value.id===objectId);
   if(!object)fail('NOT_FOUND',`${key==='fillId'?'Fill':'Curve'} is not present in the current Snapshot.`);
   const offset=number(c.offset,'offset');if(!Number.isSafeInteger(offset)||c.scope!==undefined&&c.scope!=='PARENT'&&c.scope!=='LAYER')fail('INVALID_REQUEST','Depth offset must be an integer and scope must be PARENT or LAYER.');
   const drawing=setDepthOffset(beforeDrawing,objectId,offset,c.scope as DepthScope|undefined),result=prepareSnapshotLocalDrawingEdit(input,{snapshotId:target.id,state:'active-draft',beforeDrawing,drawing});
   if(options.completeWorkspace)options.completeWorkspace(result.workspace);else Object.assign(workspace,result.workspace);
   effects.diagnostics=result.diagnostics;break;
  }
  case 'applyDrawingTopology':{
   const target=snapshot();let result:ReturnType<typeof prepareSnapshotDrawingTopologyEdit>;try{result=prepareSnapshotDrawingTopologyEdit(workspace,{recordingId:recording.id,snapshotId:target.id,angle:recording.angle,beforeDrawing:c.beforeDrawing as DrawingDocument,drawing:c.drawing as DrawingDocument});}catch(error){return fail(error&&typeof error==='object'&&'code' in error?String(error.code):'INVALID_REQUEST',error instanceof Error?error.message:String(error));}
   const priorIds=new Set(allSnapshotIds(workspace));workspace.library=result.workspace.library;workspace.snapshots=result.workspace.snapshots;workspace.recordings=result.workspace.recordings;
   for(const layer of (c.drawing as DrawingDocument).layers)if(!priorIds.has(layer.id))created('layer',layer.id);
   for(const kind of ['curves','nodes'] as const)for(const id of Object.keys(workspace.library[kind]))if(!priorIds.has(id))created(kind==='curves'?'curve':'node',id);
   const targetIds=new Set([...(c.drawing as DrawingDocument).curves,...(c.drawing as DrawingDocument).fills,...(c.drawing as DrawingDocument).offsets,...(c.drawing as DrawingDocument).layers].map(value=>value.id));effects.removedIds.push(...[...(c.beforeDrawing as DrawingDocument).curves,...(c.beforeDrawing as DrawingDocument).fills,...(c.beforeDrawing as DrawingDocument).offsets,...(c.beforeDrawing as DrawingDocument).layers].filter(value=>!targetIds.has(value.id)).map(value=>value.id));
   effects.diagnostics=result.diagnostics;break;
  }
  case 'createLocalLayer':case 'createLocalCurve':case 'excludeElements':case 'restoreElements':{
   const target=snapshot();try{assertSnapshotTopologyVertex(workspace,recording.id,target.id,recording.angle);}catch(error){return fail(error&&typeof error==='object'&&'code' in error?String(error.code):'INVALID_REQUEST',error instanceof Error?error.message:String(error));}
   const result=applySnapshotMembershipEdit(workspace,target.id,c as unknown as SnapshotMembershipCommand,fresh);
   if(result.createdLayerId)created('layer',result.createdLayerId,true,true);
   if(result.createdCurveId)created('curve',result.createdCurveId,true,true);for(const nodeId of result.createdNodeIds)created('node',nodeId);effects.removedIds.push(...result.removedIds);break;
  }
  case 'createEndpointPairRecording':{
   const start=ownedSnapshot(c.startSnapshotId),end=ownedSnapshot(c.endSnapshotId);if(start.id===end.id||start.angle.y!==end.angle.y||start.angle.x===end.angle.x)fail('UNSUPPORTED_ENDPOINT_PAIR','Choose two distinct saved endpoints with the same Y and different yaw X.');
   const evaluations=[start,end].map(view=>resolveSnapshot(workspace,view.id,{angle:view.angle,useDraft:false,diagnostics:'preview'})),issues=endpointPairCompatibility(evaluations[0].drawing,evaluations[1].drawing);if(issues.length)fail('ENDPOINT_BASIS_INCOMPATIBLE',issues.join(' '));
   if(evaluations.some(value=>value.diagnostics.some(issue=>['MISSING_SNAPSHOT','MISSING_LAYER','MISSING_ELEMENT','MISSING_RELATION','RELATION_CONFLICT','BRANCH_CONFLICT'].includes(issue.code))))fail('ENDPOINT_BASIS_INCOMPATIBLE','Repair missing or conflicting endpoint sources and relationships before creating the pair.');
   const copies=[start,end].map((view,index)=>{const copy=clone(view);copy.id=fresh();copy.deformation=clone(evaluations[index].state);copy.authored=[];delete copy.inheritedState;delete copy.draft;workspace.snapshots.push(copy);created('snapshot',copy.id);return copy;});
   const copy=emptySnapshotRecording(fresh(),c.name===undefined?`${recording.name} · endpoint pair`:name(c.name));copy.mode='endpoint-pair';copy.snapshotIds=copies.map(view=>view.id);copy.activeSnapshotId=copies[0].id;copy.angle=clone(copies[0].angle);copy.endpointPair={axis:'x',startSnapshotId:copies[0].id,endSnapshotId:copies[1].id};if(recording.tolerance!==undefined)copy.tolerance=recording.tolerance;workspace.recordings.push(copy);workspace.activeRecordingId=copy.id;created('recording',copy.id,true,true);break;
  }
  case 'setAngle':{const next=angle(c.angle);if(pair){const [start,end]=pairViews();if(next.y!==start.angle.y||next.x<Math.min(start.angle.x,end.angle.x)||next.x>Math.max(start.angle.x,end.angle.x))fail('ENDPOINT_PAIR_ANGLE','Endpoint-pair mode supports only its saved yaw interval and fixed Y.');}recording.angle=next;if(recording.snapshotIds.length)recording.activeSnapshotId=recording.snapshotIds.map(sid=>findSnapshot(sid)).sort((a,b)=>Math.hypot(boundAngle(a).x-recording.angle.x,boundAngle(a).y-recording.angle.y)-Math.hypot(boundAngle(b).x-recording.angle.x,boundAngle(b).y-recording.angle.y)||boundAngle(a).y-boundAngle(b).y||boundAngle(a).x-boundAngle(b).x||a.id.localeCompare(b.id))[0].id;break;}
  case 'selectSnapshot':{const s=ownedSnapshot(c.snapshotId);recording.activeSnapshotId=s.id;recording.angle=clone(boundAngle(s));break;}
  case 'setViewMirror':{
   if(!graph)fail('SURFACE_REQUIRED','View mirror belongs to a triangulated Recording.');
   validateSnapshotViewMirrorRelation(c.relation,{angleGraph:graph});const relation=c.relation as unknown as SnapshotViewMirrorRelation,target=ownedSnapshot(relation.targetSnapshotId);ownedSnapshot(relation.sourceSnapshotId);ownedSnapshot(relation.zeroSnapshotId);
   if(target.parentSnapshotId!==relation.sourceSnapshotId)fail('VIEW_MIRROR_PARENT','The positive view must have the negative view as its sole Snapshot parent.');
   recording.angleGraph={...graph!,viewMirror:clone(relation)};break;
  }
  case 'rebindSnapshotAngle':{if(!graph)fail('SURFACE_REQUIRED','Angle bindings belong to a triangulated Recording.');const target=ownedSnapshot(c.snapshotId),at=angle(c.angle),wasCurrent=sameBinding(boundAngle(target),recording.angle),mesh=rebindSnapshotVertex(graph!.mesh,target.id,at),result=reconcileSnapshotAngleGraphMesh(graph!,mesh,{id:fresh(),reason:'unhandled-rebind',message:`Responses retained while rebinding view ${target.name}.`});if(!result.ok)fail(result.diagnostics[0]?.code??'INVALID_GRAPH',result.diagnostics.map(issue=>issue.message).join(' '));else recording.angleGraph=result.graph;if(wasCurrent){recording.angle=clone(at);recording.activeSnapshotId=target.id;}break;}
  case 'createSnapshot':{const at=c.angle===undefined?clone(recording.angle):angle(c.angle);if(recording.snapshotIds.some(sid=>sameBinding(boundAngle(findSnapshot(sid)),at)))fail('SNAPSHOT_EXISTS','A snapshot already exists at this angle.');const previous=recording.activeSnapshotId?findSnapshot(recording.activeSnapshotId):undefined;const kind=c.kind===undefined?'view':c.kind;if(!['view','sculpt','assembly'].includes(kind as string))fail('INVALID_REQUEST','Snapshot kind must be view, sculpt, or assembly.');let view=emptyRecordingSnapshot(fresh(),c.name===undefined?`View ${recording.snapshotIds.length+1}`:name(c.name),kind as RecordingSnapshot['kind'],at);if(graph){if(locateSnapshotSimplex(graph.mesh,at)){try{const inserted=prepareSnapshotSurfaceInsertion(workspace,recording,view,fresh());view=inserted.view;recording.angleGraph=inserted.graph;}catch(error){if(error instanceof SnapshotSurfaceInsertionError)fail(error.code,error.message);throw error;}}else{const mesh=insertSnapshotVertex(graph.mesh,{snapshotId:view.id,angle:at}),result=reconcileSnapshotAngleGraphMesh(graph,mesh,{id:fresh(),reason:'mesh-change',message:'Responses retired while adding a new empty real view.'});if(!result.ok)fail(result.diagnostics[0]?.code??'INVALID_GRAPH',result.diagnostics.map(issue=>issue.message).join(' '));else recording.angleGraph=result.graph;}}else if(previous){view.layers=clone(previous.layers);view.relations=clone(previous.relations);view.inheritedState=clone(evaluated(previous,at).state);}workspace.snapshots.push(view);recording.snapshotIds.push(view.id);recording.activeSnapshotId=view.id;recording.angle=clone(at);created('snapshot',view.id,true,true);if(graph)seedExtremes(recording.id,view.id);break;}
  case 'updateEndpointCorrection':if(graph)finishSurfaceDraft(true);else finishPairDraft(true);break;
  case 'discardEndpointCorrection':if(graph)finishSurfaceDraft(false);else finishPairDraft(false);break;
  case 'updateSnapshot':{if(graph){if(!realVertex()){finishSurfaceDraft(true);break;}const target=c.snapshotId===undefined?snapshot():ownedSnapshot(c.snapshotId);if(c.name!==undefined)snapshotForWrite(target).name=name(c.name);finishLocalDraft(true,target);break;}if(pairIntermediate){finishPairDraft(true);break;}const target=c.snapshotId===undefined?snapshot():ownedSnapshot(c.snapshotId);if(c.name!==undefined)target.name=name(c.name);if(!sameAngle(target.angle,recording.angle))fail('SNAPSHOT_ANGLE_MISMATCH','Navigate to the snapshot’s saved angle before updating it.');commit(recording.tracks,target);break;}
  case 'deleteSnapshot':{
   const target=ownedSnapshot(c.snapshotId);if(graph?.viewMirror&&[graph.viewMirror.zeroSnapshotId,graph.viewMirror.sourceSnapshotId,graph.viewMirror.targetSnapshotId].includes(target.id))fail('SNAPSHOT_IN_USE','This snapshot is a live View mirror expression basis.');if(workspace.snapshots.some(s=>s.parentSnapshotId===target.id||s.layers.some(l=>l.kind==='reference'&&l.baseSnapshotId===target.id)))fail('SNAPSHOT_IN_USE','This snapshot is referenced by another snapshot.');
   if(graph){const mesh=removeSnapshotVertex(graph.mesh,target.id),result=reconcileSnapshotAngleGraphMesh(graph,mesh,{id:fresh(),reason:'deleted-view',message:`Responses retained from deleted view ${target.name}.`});if(!result.ok)fail(result.diagnostics[0]?.code??'INVALID_GRAPH',result.diagnostics.map(issue=>issue.message).join(' '));else recording.angleGraph=result.graph;workspace.snapshots=workspace.snapshots.filter(view=>view!==target);recording.snapshotIds=recording.snapshotIds.filter(id=>id!==target.id);if(recording.activeSnapshotId===target.id){recording.activeSnapshotId=recording.snapshotIds[0];if(recording.activeSnapshotId)recording.angle=clone(boundAngle(findSnapshot(recording.activeSnapshotId)));}effects.removedIds.push(target.id);break;}
   const removed=new Set(target.authored.map(ref=>ref.keyId)),affected=recording.tracks.filter(track=>track.keys.some(key=>removed.has(key.id))),survivors=recording.snapshotIds.filter(sid=>sid!==target.id).map(sid=>findSnapshot(sid));
   const prior=new Map(affected.length?survivors.map(view=>[view.id,resolveSnapshot(workspace,view.id,{useDraft:false,diagnostics:'preview'}).state]):[]);
   workspace.snapshots=workspace.snapshots.filter(s=>s!==target);recording.snapshotIds=recording.snapshotIds.filter(sid=>sid!==target.id);if(recording.activeSnapshotId===target.id){recording.activeSnapshotId=recording.snapshotIds[0];if(recording.activeSnapshotId)recording.angle=clone(findSnapshot(recording.activeSnapshotId).angle);}
   for(const track of affected)track.keys=track.keys.filter(key=>!removed.has(key.id)) as typeof track.keys;
   // A view captures inherited state without keys. Removing its support sample
   // may therefore need a sparse key to preserve the surviving saved pose.
   for(let pass=0;pass<=survivors.length;pass++){let changed=false;for(const view of survivors){if(!affected.length)continue;const next=resolveSnapshot(workspace,view.id,{useDraft:false,diagnostics:'preview'}).state;for(const track of affected){const beforeValue=channelValue(prior.get(view.id)!,track),afterValue=channelValue(next,track);if(beforeValue===undefined||JSON.stringify(beforeValue)===JSON.stringify(afterValue))continue;const old=track.keys.find(k=>sameAngle(k.angle,view.angle)),key={id:old?.id??fresh(),angle:clone(view.angle),value:clone(beforeValue)};(track as SceneTrack<unknown>).keys=old?track.keys.map(k=>k===old?key:k):[...track.keys,key];view.authored=view.authored.filter(ref=>ref.trackId!==track.id);view.authored.push({trackId:track.id,keyId:key.id});created('key',key.id,!old);changed=true;}}if(!changed)break;}
   effects.removedIds.push(target.id,...removed);break;
  }
  case 'pasteLayers':case 'moveLayers':case 'cloneLayers':{
   const target=snapshot(),source=findSnapshot(c.sourceSnapshotId),selected=c.layerIds===undefined?source.layers:selectedLayers(c.layerIds,source);if(!selected.length)fail('INVALID_REQUEST','Select at least one source layer.');
   if(op==='pasteLayers'){
    const result=prepareSnapshotReferencePaste(workspace,{targetSnapshotId:target.id,sourceSnapshotId:source.id,layerIds:selected.map(layer=>layer.id)},fresh);
    if(result.blockedCode)fail(result.blockedCode,result.diagnostics.at(-1)?.message??'Reference paste failed.');
    if(result.changed)target.layers=result.workspace.snapshots.find(snapshot=>snapshot.id===target.id)!.layers;
    for(const layer of result.created)created('layer',layer.id,true,effects.created.every(item=>item.kind!=='layer'));
    for(const layer of result.reused)created('layer',layer.id,false,effects.created.every(item=>item.kind!=='layer'));
    break;
   }
   if(op==='cloneLayers'){
    try{const result=prepareIndependentSnapshotLayers(workspace,source,selected.map(layer=>layer.id),fresh);workspace.library=result.library;workspace.snapshots.push(result.snapshot);effects.idMap=result.idMap;for(const layer of result.snapshot.layers){const slot={kind:'reference' as const,id:fresh(),name:layer.name,baseSnapshotId:result.snapshot.id,baseLayerId:layer.id};target.layers.push(slot);created('layer',slot.id,true,effects.created.every(item=>item.kind!=='layer'));}}
    catch(error){if(error instanceof SnapshotIndependentCopyError)fail(error.code,error.message);throw error;}break;
   }
   const resolved=resolveSnapshot(workspace,source.id,{useDraft:false});const plan=planArtworkLayerImport(resolved.drawing,selected.map(layer=>layer.id));if(plan.additionalLayerIds.length)fail('LAYER_DEPENDENCIES',`Also select dependent layers: ${plan.additionalLayerIds.join(', ')}.`);
   if(source.id===target.id)fail('SNAPSHOT_CYCLE','A snapshot cannot reference or move layers into itself.');
   if(op==='moveLayers'&&selected.every(l=>l.kind==='reference')){const sourceState=resolved.state;for(const l of selected){if(target.layers.some(x=>x.id===l.id))fail('LAYER_EXISTS','The target already contains this layer slot.');target.layers.push(clone(l));if(sourceState.layers[l.id])target.deformation.layers[l.id]=clone(sourceState.layers[l.id]);created('layer',l.id,false);}const selectedIds=new Set(selected.map(l=>l.id));for(const w of sourceState.warps)if(!target.deformation.warps.some(x=>x.id===w.id))target.deformation.warps.push(clone(w));target.deformation.bindings.push(...clone(sourceState.bindings.filter(b=>selectedIds.has(b.layerId))));source.layers=source.layers.filter(l=>!selectedIds.has(l.id));effects.removedIds.push(...selectedIds);
   }else for(const l of selected){const slot={kind:'reference' as const,id:fresh(),name:l.name,baseSnapshotId:source.id,baseLayerId:l.id};target.layers.push(slot);created('layer',slot.id,true,effects.created.every(e=>e.kind!=='layer'));}
   break;
  }
  case 'removeLayers':{const s=snapshot(),selected=new Set(selectedLayers(c.layerIds).map(l=>l.id));s.layers=s.layers.filter(l=>!selected.has(l.id));effects.removedIds.push(...selected);break;}
  case 'reorderLayers':{const s=snapshot(),order=ids(c.layerIds,true);if(order.length!==s.layers.length||order.some(value=>!s.layers.some(l=>l.id===value)))fail('INVALID_REQUEST','Provide every current layer ID exactly once.');s.layers=order.map(value=>layer(value,s));break;}
  case 'setLayerPlacement':{const l=layer(c.layerId),drawing=options.layerPlacementDrawing??evaluated().drawing;assertSnapshotObjectsUnlocked(drawing,drawing.layers.find(value=>value.id===l.id)?.items??[]);setDraft(ensureTrack('placement',l.id),placement(c.value));break;}
  case 'setShapeElementPlacement':{
   const e=evaluated(),curveIds=ids(c.curveIds),value=placement(c.value),placements={...e.elementPlacements};
   assertSnapshotObjectsUnlocked(e.drawing,curveIds);
   for(const curveId of curveIds){if(!e.drawing.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Selected curve does not exist.');placements[curveId]=value;}
   const conflicts=elementPlacementConflicts(e.preElementPlacementDrawing,placements);if(conflicts.length)fail('LINKED_ELEMENT_PLACEMENT',`Connected curves need the same stroke placement. Include these curves in the selection: ${conflicts.map(id=>e.drawing.curves.find(curve=>curve.id===id)?.name??id).join(', ')}.`);
   for(const curveId of curveIds){const owner=e.drawing.layers.find(layer=>layer.items.includes(curveId))!;setDraft(ensureTrack('placement',owner.id,curveId),value);}break;
  }
  case 'correctShapeNode':case 'correctShapeHandle':case 'moveShapeNode':case 'moveShapeHandle':case 'transformShapeElements':{
   if(graph&&!realVertex()){applyControlTarget(evaluated());break;}
   if(pairIntermediate&&op==='transformShapeElements'){applyPairTransform();break;}
   if(!graph&&(op==='correctShapeNode'||op==='correctShapeHandle'||pairIntermediate)){applyPairCorrection(op==='moveShapeNode'||op==='correctShapeNode'?'node':'handle');break;}
   const e=evaluated();
   const targetLayers=op==='transformShapeElements'?e.drawing.layers.filter(layer=>(c.curveIds as string[]).some(id=>layer.items.includes(id))).map(layer=>layer.id):[String(c.layerId)];
   if(graph||targetLayers.some(id=>layerUsesCage(e.state.layerDomains,id))){applyControlTarget(e);break;}
   const current=e.preElementPlacementDrawing,base=e.preShapeDrawing,relationNodes=new Set<string>();let next:DrawingDocument;
   if(op==='transformShapeElements'){
    const curveIds=ids(c.curveIds),delta=placement(c.value);for(const curveId of curveIds)if(!e.drawing.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Selected curve does not exist.');
    if(!graph&&!isScenePlacementSimilarity(delta))fail('INVALID_REQUEST','Set the absolute stroke placement to change its independent axes.');
    let world=transform(e.drawing,curveIds,p=>applyScenePlacement(delta,p),true,false);if(graph)world=projectSnapshotTransformTargets(e.drawing,world);else for(const curveId of curveIds)for(const end of [0,1] as const)world=projectSceneSmoothHandle(world,{curveId,end});next=clone(current);
    const inverse=(layerId:string,curveId:string,p:Point2):Point2=>{const matrix=trySnapshotControlInverse(e,layerId,curveId);if(!matrix)fail('SINGULAR_PLACEMENT','Restore or disable the affected layer domain or zero placement axis before transforming its elements.');return applyScenePlacementMatrix(matrix!,p);};
    for(const node of world.nodes){const prior=e.drawing.nodes.find(n=>n.id===node.id)!;if(length(sub(node.position,prior.position))<1e-12)continue;const owner=current.layers.find(l=>current.curves.some(curve=>l.items.includes(curve.id)&&curve.nodes.includes(node.id)))!;next.nodes.find(n=>n.id===node.id)!.position=inverse(owner.id,current.curves.find(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(node.id))!.id,node.position);}
    for(const curve of world.curves){const prior=e.drawing.curves.find(c=>c.id===curve.id)!,owner=current.layers.find(l=>l.items.includes(curve.id))!;for(const end of [0,1] as const)if(length(sub(curve.handles[end],prior.handles[end]))>=1e-12)next.curves.find(c=>c.id===curve.id)!.handles[end]=inverse(owner.id,curve.id,curve.handles[end]);}
   }else{
    const l=layer(c.layerId),owner=current.layers.find(x=>x.id===l.id)??fail('MISSING_LAYER','Resolved layer is missing.');let input=point(c.position);if(pair||graph){const curve=op==='moveShapeNode'||op==='correctShapeNode'?e.drawing.curves.find(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(String(c.nodeId))):e.drawing.curves.find(curve=>curve.id===c.curveId),inverse=trySnapshotControlInverse(e,l.id,curve?.id??'');if(!inverse)fail('SINGULAR_PLACEMENT','Restore or disable the affected layer domain or zero placement axis before editing its basis controls.');input=applyScenePlacementMatrix(inverse!,input);}const position=input;
    if(op==='moveShapeNode'||op==='correctShapeNode'){const nodeId=id(c.nodeId,'nodeId');if(!current.curves.some(curve=>owner.items.includes(curve.id)&&curve.nodes.includes(nodeId)))fail('MISSING_ELEMENT','Node is not owned by this layer.');next=moveNode(current,nodeId,position,true);}
    else{const curveId=id(c.curveId,'curveId');if(!owner.items.includes(curveId)||!current.curves.some(curve=>curve.id===curveId))fail('MISSING_ELEMENT','Curve is not owned by this layer.');if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');next=moveHandle(current,{curveId,end:c.end as 0|1},position,true);}
   }
   for(const moved of next.nodes){if(relationNodes.has(moved.id)||length(sub(moved.position,current.nodes.find(n=>n.id===moved.id)!.position))<1e-12)continue;const component=linkedNodeIds(current,moved.id),links=(current.endpointLinks??[]).filter(link=>component.has(nodeAt(current,link.a).id)&&component.has(nodeAt(current,link.b).id));if(!links.length)continue;component.forEach(id=>relationNodes.add(id));const sourceLinkIds=links.map(link=>link.id).sort(),prior=[...Object.entries(e.state.relationPositions),...recording.snapshotIds.flatMap(sid=>{const view=findSnapshot(sid);return [...Object.entries(view.deformation.relationPositions),...Object.entries(view.inheritedState?.relationPositions??{})];})].find(([,v])=>v.sourceLinkIds.some(id=>sourceLinkIds.includes(id))),targetId=prior?.[0]??fresh(),original=base.nodes.find(n=>n.id===moved.id)??fail('MISSING_ELEMENT','Linked node has no baseline.'),offset=sub(moved.position,original.position);
    if([...component].some(nodeId=>{const a=next.nodes.find(n=>n.id===nodeId),b=base.nodes.find(n=>n.id===nodeId);return !!a&&!!b&&length(sub(sub(a.position,b.position),offset))>1e-8;}))fail('LINKED_LOCAL_SPACE','Linked layers have incompatible local placements. Give the linked layers the same placement before transforming these elements.');
    const ownerIds=current.layers.filter(own=>current.curves.some(curve=>own.items.includes(curve.id)&&curve.nodes.some(id=>component.has(id)))).map(own=>own.id);if(graph){const view=snapshotForWrite(snapshot()),draft=view.draft??{angle:clone(view.angle),deformation:emptySnapshotDeformationState(),channels:[]};view.draft={...draft,deformation:{...draft.deformation,relationPositions:{...draft.deformation.relationPositions,[targetId]:{sourceLinkIds,offset}}}};}else for(const sid of recording.snapshotIds){const view=findSnapshot(sid);if(!ownerIds.every(owner=>view.layers.some(l=>l.id===owner)))continue;const existing=view.deformation.relationPositions[targetId]??view.inheritedState?.relationPositions[targetId];if(existing&&existing.sourceLinkIds.length===sourceLinkIds.length&&existing.sourceLinkIds.every(id=>sourceLinkIds.includes(id)))continue;snapshotForWrite(view).deformation.relationPositions[targetId]={sourceLinkIds,offset:existing?.offset??[0,0]};}setDraft(ensureTrack('relationPosition',targetId),offset);
   }
   for(const own of current.layers){const curveIds=new Set(own.items),curves=next.curves.filter(curve=>curveIds.has(curve.id)),nodeIds=new Set(curves.flatMap(curve=>curve.nodes)),shape:SceneShapeValue=clone(e.state.layers[own.id]?.shape??identitySceneShape());let changed=false;for(const node of next.nodes){if(!nodeIds.has(node.id)||relationNodes.has(node.id))continue;const prior=current.nodes.find(n=>n.id===node.id)!,original=base.nodes.find(n=>n.id===node.id);if(!original||length(sub(node.position,prior.position))<1e-12)continue;shape.nodes[node.id]=sub(node.position,original.position);changed=true;}
    for(const curve of curves){const original=base.curves.find(x=>x.id===curve.id),prior=curveById(current,curve.id);if(!original)continue;const offsets=clone(shape.handles[curve.id]??[[0,0],[0,0]]) as [Point2,Point2];let handleChanged=false;for(const end of [0,1] as const){const vector=sub(curve.handles[end],nodeAt(next,{curveId:curve.id,end}).position),before=sub(prior.handles[end],nodeAt(current,{curveId:curve.id,end}).position);if(length(sub(vector,before))<1e-12)continue;offsets[end]=sub(vector,sub(original.handles[end],nodeAt(base,{curveId:curve.id,end}).position));handleChanged=true;}if(handleChanged){shape.handles[curve.id]=offsets;changed=true;}}
    if(changed)setDraft(ensureTrack('shape',own.id),shape);
   }break;
  }
  case 'createWarp':case 'createChild':{const selected=selectedLayers(c.layerIds),e=evaluated(),current=e.state,parent=op==='createChild'?currentWarp(c.parentWarpId,current):undefined;if(parent&&selected.some(l=>current.bindings.find(b=>b.layerId===l.id)?.warpId!==parent.id))fail('NOT_DIRECT_PARENT','A child Warp can take only layers directly bound to its parent.');const objects=new Set(e.source.layers.filter(l=>selected.some(x=>x.id===l.id)).flatMap(l=>l.items)),curves=e.source.curves.filter(curve=>objects.has(curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes)),points=[...e.source.nodes.filter(n=>nodes.has(n.id)).map(n=>n.position),...curves.flatMap(curve=>curve.handles)],min:Point2=points.length?[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))]:[-1,-1],max:Point2=points.length?[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]:[1,1],pad=Math.max(max[0]-min[0],max[1]-min[1],.1)*.08,warp=newWarp({min:[min[0]-pad,min[1]-pad],max:[max[0]+pad,max[1]+pad]},parent?.id),s=snapshot().deformation;const selectedIds=new Set(selected.map(l=>l.id));s.bindings=s.bindings.filter(b=>!selectedIds.has(b.layerId));s.bindings.push(...selected.map(l=>({layerId:l.id,warpId:warp.id})));for(const sid of recording.snapshotIds){const view=findSnapshot(sid);if(view.id===snapshot().id)continue;const common=view.layers.filter(l=>selectedIds.has(l.id));if(!common.length)continue;const inherited=resolveSnapshot(workspace,view.id,{useDraft:false,diagnostics:'preview'}).state;if(parent&&!inherited.warps.some(w=>w.id===parent.id))continue;view.deformation=clone(inherited);delete view.inheritedState;if(!view.deformation.warps.some(w=>w.id===warp.id))view.deformation.warps.push(clone(warp));const commonIds=new Set(common.map(l=>l.id));view.deformation.bindings=view.deformation.bindings.filter(b=>!commonIds.has(b.layerId));view.deformation.bindings.push(...common.map(l=>({layerId:l.id,warpId:warp.id})));}break;}
  case 'wrapParent':{const current=state(),children=ids(c.warpIds).map(value=>currentWarp(value,current)),parentId=children[0].parentId;if(children.some(w=>w.parentId!==parentId))fail('PARENT_MISMATCH','Selected Warps must share the same immediate parent.');const points=children.flatMap(w=>[w.restGrid.bounds.min,w.restGrid.bounds.max,...w.grid.nodes.flatMap(n=>[n.position,n.handleU,n.handleV])]),warp=newWarp({min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]},parentId);for(const child of snapshot().deformation.warps)if(children.some(w=>w.id===child.id))child.parentId=warp.id;break;}
  case 'rebindLayers':{const selected=selectedLayers(c.layerIds).map(l=>l.id),target=c.warpId===null?undefined:currentWarp(c.warpId),s=structuralState();s.bindings=s.bindings.filter(b=>!selected.includes(b.layerId));if(target)s.bindings.push(...selected.map(layerId=>({layerId,warpId:target.id})));break;}
  case 'setWarp':{const original=currentWarp(c.warpId),s=structuralState(),warp=s.warps.find(w=>w.id===original.id)!;if(c.name===undefined&&c.parentId===undefined)fail('INVALID_REQUEST','Provide name or parentId.');if(c.name!==undefined)warp.name=name(c.name);if(c.parentId!==undefined){if(c.parentId===null)delete warp.parentId;else warp.parentId=currentWarp(c.parentId,s).id;}break;}
  case 'deleteWarp':{const original=currentWarp(c.warpId),s=structuralState();s.warps=s.warps.filter(w=>w.id!==original.id).map(w=>w.parentId===original.id?{...w,parentId:original.parentId}:w);s.bindings=s.bindings.flatMap(b=>b.warpId!==original.id?[b]:original.parentId?[{...b,warpId:original.parentId}]:[]);effects.removedIds.push(original.id);break;}
  case 'editWarpNodes':{const warp=currentWarp(c.warpId);let grid=clone(warp.grid);const follow=c.moveHandles===undefined?true:bool(c.moveHandles);if(!Array.isArray(c.edits)||!c.edits.length||c.edits.length>grid.nodes.length)fail('INVALID_REQUEST','Provide 1…node-count unique edits.');const seen=new Set<number>();for(const raw of c.edits as unknown[]){const edit=object(raw,['index','position','handleU','handleV','twist']),index=number(edit.index,'index',0,grid.nodes.length-1);if(!Number.isInteger(index)||seen.has(index))fail('INVALID_REQUEST','Node indices must be unique integers.');seen.add(index);if(!['position','handleU','handleV','twist'].some(key=>edit[key]!==undefined))fail('INVALID_REQUEST','Each edit needs a position or handle value.');if(edit.position!==undefined)grid=moveWarpNode(grid,index,point(edit.position),follow);for(const key of ['handleU','handleV','twist'] as const)if(edit[key]!==undefined)grid.nodes[index][key]=point(edit[key]);}validateWarpGrid(grid);setDraft(ensureTrack('warp',warp.id),grid);break;}
  case 'setObjectLocks':{
   if(graph?!realVertex():!sameBinding(boundAngle(snapshot()),recording.angle))fail('REAL_SNAPSHOT_REQUIRED','Select a real saved snapshot before changing its object locks.');
   const target=snapshot(),changed=snapshotWithObjectLocks(target,evaluated().drawing,Object.fromEntries(ids(c.objectIds).map(id=>[id,bool(c.locked)])));
   if(changed!==target)snapshotForWrite(target).objectLocks=changed.objectLocks;break;
  }
  case 'setVisibility':{const l=layer(c.layerId),objectId=c.objectId===undefined?undefined:id(c.objectId,'objectId');if(objectId&&!evaluated().drawing.layers.find(x=>x.id===l.id)?.items.includes(objectId))fail('MISSING_ELEMENT','Object is not owned by this layer.');setDraft(ensureTrack('visibility',l.id,objectId),c.visible===null?null:bool(c.visible));break;}
  case 'setLayerOrder':{const l=layer(c.layerId);setDraft(ensureTrack('depth',l.id),number(c.value,'value'));break;}
  case 'changeInterval':case 'setIntervalEnd':case 'setIntervalEnabled':{if(graph&&!realVertex()&&op==='changeInterval'){applySurfaceIntervalEdit();break;}const l=layer(c.layerId),e=evaluated(),trackId=id(c.sourceTrackId,'sourceTrackId'),materialSource=snapshotIntervalMaterialSource(e,trackId),base=materialSource.displayIntervals?.find(t=>t.id===trackId)??fail('MISSING_INTERVAL','The source interval does not exist.');if(!e.source.layers.find(x=>x.id===l.id)?.items.includes(base.anchor.id))fail('MISSING_INTERVAL','The interval is not owned by this layer.');const existing=recording.tracks.find(t=>t.channel==='interval'&&t.targetId===l.id&&t.sourceTrackId===trackId);if(e.diagnostics.some(d=>d.code==='SOURCE_MATERIAL'&&(d.channelId===trackId||d.channelId===existing?.id)))fail('SOURCE_MATERIAL','Restore or repair the source material mapping before editing this interval channel.');if(graph&&op==='changeInterval'&&(c.start!==undefined||c.end!==undefined)){if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');const edits=prepareSnapshotPartitionIntervalEdit(graph,e,{kind:'interval-endpoint',layerId:l.id,sourceTrackId:trackId,rangeId:id(c.rangeId,'rangeId'),end:'start'},{...(c.start===undefined?{}:{start:number(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:number(c.end,'end',0,1)}),...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.fullLoop===undefined?{}:{fullLoop:bool(c.fullLoop)})});if(edits){for(const edit of edits)setDraft(ensureTrack('interval',edit.layerId,undefined,edit.sourceTrackId),edit.value);break;}}const value:SceneIntervalValue=clone(e.state.layers[l.id]?.intervals?.[trackId]??{appearance:null,enabled:{}}),appearance=value.appearance??base,rangeId=id(c.rangeId,'rangeId');if(!appearance.ranges.some(r=>r.id===rangeId))fail('NOT_FOUND','Range does not exist.');if(op==='setIntervalEnabled')value.enabled[rangeId]=bool(c.enabled);else{const document={...materialSource,displayIntervals:[...(materialSource.displayIntervals??[]).filter(t=>t.id!==trackId),appearance]};let changed:DrawingDocument;if(op==='setIntervalEnd'){if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');const style=object(c.style,['taper','taperWidthScale','extension','interior']);if(!validInkEnds([style,{}]))fail('INVALID_REQUEST','Invalid terminal brush.');changed=setDisplayIntervalEnd(document,trackId,rangeId,c.end as 0|1,style as TerminusBrushStyle);}else{if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');const patch={...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.start===undefined?{}:{start:number(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:number(c.end,'end',0,1)}),...(c.fullLoop===undefined?{}:{fullLoop:bool(c.fullLoop)})};if(!Object.keys(patch).length)fail('INVALID_REQUEST','Provide an interval property.');changed=changeDisplayInterval(document,trackId,rangeId,patch);}value.appearance=clone(changed.displayIntervals!.find(t=>t.id===trackId)!);}setDraft(ensureTrack('interval',l.id,undefined,trackId),value);break;}
  case 'saveSelected':if(graph){if(realVertex())finishLocalDraft(true,snapshot(),true);else{if(c.warpIds!==undefined&&ids(c.warpIds,true).length)fail('SURFACE_CORRECTION_ONLY','Correction selection uses layers, not Warp keys.');finishSurfaceDraft(true,selectedLayers(c.layerIds).map(layer=>layer.id));}}else if(pairIntermediate){if(c.warpIds!==undefined&&ids(c.warpIds,true).length)fail('ENDPOINT_CORRECTION_ONLY','Correction selection uses layers, not Warp keys.');finishPairDraft(true,selectedLayers(c.layerIds).map(layer=>layer.id));}else commit(selectedTracks(),snapshot(),c.name===undefined?undefined:name(c.name));break;
  case 'discardSelected':if(graph){if(realVertex())finishLocalDraft(false,snapshot(),true);else{if(c.warpIds!==undefined&&ids(c.warpIds,true).length)fail('SURFACE_CORRECTION_ONLY','Correction selection uses layers, not Warp keys.');finishSurfaceDraft(false,selectedLayers(c.layerIds).map(layer=>layer.id));}}else if(pairIntermediate){if(c.warpIds!==undefined&&ids(c.warpIds,true).length)fail('ENDPOINT_CORRECTION_ONLY','Correction selection uses layers, not Warp keys.');finishPairDraft(false,selectedLayers(c.layerIds).map(layer=>layer.id));}else for(const track of selectedTracks())delete (options.trackForWrite?.(track.id)??track).draft;break;
  case 'renameKey':case 'deleteKey':{const track=recording.tracks.find(t=>t.id===id(c.trackId,'trackId'))??fail('NOT_FOUND','Track does not exist.'),key=track.keys.find(k=>k.id===id(c.keyId,'keyId'))??fail('NOT_FOUND','Key does not exist.');if(op==='renameKey')key.name=name(c.name);else{track.keys=track.keys.filter(k=>k!==key) as typeof track.keys;for(const s of workspace.snapshots)s.authored=s.authored.filter(ref=>ref.keyId!==key.id);effects.removedIds.push(key.id);}break;}
  case 'setControlResponse':case 'resetControlResponse':{
   const geometry=pairGeometry(),targets=controlTargets(c.targets,geometry);if(c.axis!=='x'&&c.axis!=='y')fail('INVALID_REQUEST','Response axis must be x or y.');const axis=c.axis as 'x'|'y';if(pair!.draft)fail('ENDPOINT_CORRECTION_DRAFT','Save or discard the current correction draft before editing saved response curves.');
   let points:Point2[]=[];if(op==='setControlResponse'){if(!Array.isArray(c.points)||c.points.length>256)fail('INVALID_REQUEST','Response points must contain at most 256 interior knots.');points=(c.points as unknown[]).map(value=>{if(!Array.isArray(value)||value.length!==2)fail('INVALID_REQUEST','Expected [progress,response].');return [number((value as unknown[])[0],'progress',0,1),number((value as unknown[])[1],'response',-Infinity,Infinity)] as Point2;});try{validateSnapshotControlResponse({[axis]:points});}catch(error){fail('INVALID_REQUEST',(error as Error).message);}}
   const responses=clone(pair!.responses??{nodes:{},handles:{}});for(const target of targets){const coordinate=axis==='x'?0:1;let control:SnapshotControlResponse;if('nodeId' in target){const endpoints=geometry.drawings.map(drawing=>drawing.nodes.find(node=>node.id===target.nodeId)!.position[coordinate]);if(op==='setControlResponse'&&points.length&&!invertEndpointPairCoordinate(endpoints[0],endpoints[1],endpoints[0]).available)fail('ENDPOINT_AXIS_UNAVAILABLE',`Node ${target.nodeId} ${axis.toUpperCase()} has no endpoint displacement. Edit its basis coordinate first.`);control=responseControl(responses,target.nodeId);}else{const endpoints=geometry.drawings.map(drawing=>{const curve=drawing.curves.find(curve=>curve.id===target.curveId)!;return sub(curve.handles[target.end],nodeAt(drawing,{curveId:curve.id,end:target.end}).position)[coordinate];});if(op==='setControlResponse'&&points.length&&!invertEndpointPairCoordinate(endpoints[0],endpoints[1],endpoints[0]).available)fail('ENDPOINT_AXIS_UNAVAILABLE',`Handle ${target.curveId} end ${target.end} ${axis.toUpperCase()} has no endpoint-vector displacement. Edit its basis handle first.`);control=responseControl(responses,target.curveId,target.end);}if(op==='resetControlResponse'||!points.length)delete control[axis];else control[axis]=clone(points);}
   for(const [id,response] of Object.entries(responses.nodes))if(!response.x?.length&&!response.y?.length)delete responses.nodes[id];for(const [id,response] of Object.entries(responses.handles))if(response.every(control=>!control.x?.length&&!control.y?.length))delete responses.handles[id];if(Object.keys(responses.nodes).length||Object.keys(responses.handles).length)pair!.responses=responses;else delete pair!.responses;break;
  }
  case 'setTolerance':recording.tolerance=number(c.pixels,'pixels',.1,20)/250;break;
 }
 if(membershipBefore){const reconciled=reconcileSnapshotMembershipResponses(workspace,membershipBefore);workspace.recordings=reconciled.workspace.recordings;if(reconciled.diagnostics.length)(effects.diagnostics??=[]).push(...reconciled.diagnostics);}
 return effects;
}


function channelValue(state:SnapshotDeformationState,track:SnapshotPoseTrack):unknown {
 const layer=state.layers[track.targetId];switch(track.channel){case 'placement':return track.elementId?layer?.elementPlacements?.[track.elementId]:layer?.placement;case 'shape':return layer?.shape;case 'visibility':return layer?.visibility?.[track.elementId??track.targetId];case 'interval':return layer?.intervals?.[track.sourceTrackId];case 'depth':return layer?.depth;case 'warp':return state.warps.find(w=>w.id===track.targetId)?.grid;case 'relationPosition':return state.relationPositions[track.targetId]?.offset;}
}

function defaultChannelValue(track:SnapshotPoseTrack):unknown {switch(track.channel){case 'placement':return identityScenePlacement();case 'shape':return identitySceneShape();case 'visibility':return null;case 'depth':return 0;case 'relationPosition':return [0,0];case 'interval':return {appearance:null,enabled:{}};case 'warp':return undefined;}}
