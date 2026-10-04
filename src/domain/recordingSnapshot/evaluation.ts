import type {PreparedRecordingChanges} from './workspaceChanges';
import type {DrawingControlEditPlan} from '../drawing/controlEditPlan';
import {registerPreparedControlChanges,preparedControlChangesBetween} from './preparedControlChanges';
import {withDrawingReadScope} from '../drawing/readContext';
export type {PreparedRecordingChanges} from './workspaceChanges';
import {indexPreparedSnapshotDependencies,preparedSnapshotDependencyRevision,snapshotSurfaceDemand,type PreparedSnapshotDependencyIndex} from './preparedSnapshotDependencies';
import {locateSnapshotSimplex} from './triangulation';
import {mirrorViewDrawingPresence,snapshotViewMirrorCurvePairs} from './viewMirrorInput';
import {recordingViewMirrorRelation} from './viewMirrorRelation';
import {prepareSnapshotViewMirrorSurface} from './viewMirrorSurface';
import type {SnapshotSurfaceMirrorContext} from './surfaceMirrorContext';
import {viewMirrorUnpairedCurveGroups,type ViewMirrorOptions} from './viewMirrorMath';
import {displayedSnapshotStrokeFrameCenter} from './strokeTransformFrame';
import {assertRecordingWorkspaceActive,RECORDING_RETIRED_MESSAGE} from './retirement';
import {applySnapshotAuthoredMaterial} from './authoredMaterial';
import {prepareCageEvaluationDependencies} from './cageEvaluationDependencies';
import {extendSnapshotInheritedTopology} from './inheritedTopologyMaterial';
import {snapshotDepthAppearanceProvenance,remapSnapshotDepthContext} from './depthAppearance';
import {applySnapshotPaintAppearance} from './paintAppearance';
import {applySnapshotMirrorMetadata} from './mirrorMetadata';
import {applySnapshotObjectLocks} from './objectLocks';
import {applyLayerDomainPostShape} from './layerCageEvaluation';
import {dominantSnapshotBasis} from './simplexSupport';
import {applySnapshotVisibilityState,evaluateSnapshotVisibilityRecipe,snapshotVisibilityRecipeDependencies} from './visibilityRestriction';
import {displayField,displayPath} from '../drawing/displayIntervals';
import {derivedUses} from '../drawing/roundedJoin';
import {applyLayerDomains} from './layerDomainEvaluation';
import {hasEvaluatedDeformation,evaluatedDeformationDiagnostics,evaluatedMaterialSource,projectEvaluatedGeometry} from '../drawing/evaluatedDeformation';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../drawing/affineDrawing';
import {layerDomainMatrices} from './layerDomains';
import {applyAffine2D,affine2DMaxScale,identityAffine2D} from '../geometry/affine2d';
import {snapshotRouteMaterialSource,markSnapshotRouteMaterialInput} from './routeMaterialSource';
import {transportEndpointPairMaterial} from './endpointPairMaterial';
import {applyIntervalEnableFlags} from '../vectorRecording/intervals';
import {applySnapshotMaterialRecipe,snapshotMaterialRecipeDependencies,snapshotMaterialRecipeHasMirror} from './materialRestriction';
import {applySnapshotInheritedFitParameters} from './responseFitParameterInheritance';
import {placeSnapshotElements,retainSnapshotAffines} from './elementPlacement';
import {mirrorSnapshotDrawing,SnapshotMirrorError} from './snapshotMirror';
import {resolveSnapshotLocalMembership} from './localMembership';
import {prepareSnapshotCoverageStructure,type PreparedSnapshotCoverageStructure,type SnapshotCoverageEvaluation,type SnapshotCoverageCurvePreview} from './snapshotCoverage';
import {evaluateSnapshotSurfaceMaterial} from './surfaceMaterial';
import {snapshotPropertyResponsesCacheKey} from './propertyResponses';
import {createSnapshotSurfaceValueSampler,effectiveSnapshotSurfaceResponses,prepareSnapshotSurfaceTargetEditWithReplay,SnapshotSurfaceTargetEditError,snapshotSurfaceOwnsBasisDraft,type SnapshotSurfaceTargetEditResult} from './surfaceTargets';
import type {SnapshotSimplexLocation} from './triangulation';
import {emptyDrawing,layerFor,shapeOf,type DrawingDocument,type DrawingLayer,type Point2,type Cubic} from '../drawing/model';
import {depthContext,depthPaintBatches,type PaintBatch} from '../drawing/depth';
import {registerEvaluatedAffine,evaluatedAffine,evaluatedAffineSource,type EvaluatedAffine} from '../drawing/evaluatedAffine';
import {createDisplayRouteField,resolveDisplayRoute} from '../drawing/displayRoutes';
import {paintItems,strokes,strokePaths} from '../drawing/strokes';
import {InputCache} from '../geometry/cache';
import {applySceneShapes} from '../recordingScene/shapes';
import {drawingSignature} from '../vectorRecording/model';
import {emptyRecordingScene,identityScenePlacement,identitySceneShape,instanceObjectId,type ScenePlacementValue,type SceneShapeValue} from '../recordingScene/model';
import {evaluateScene,type SceneEvaluation,type SceneEvaluationOptions} from '../recordingScene/evaluation';
import {applyScenePlacement,placementMatrix,scenePlacementMaxScale} from '../recordingScene/tracks';
import {materializeOriginalSnapshot,remapDrawingIdentities} from './sources';
import {evaluateSnapshotState,recordingForSnapshot} from './tracks';
import {validateSnapshotGraph} from './validation';
import {applySnapshotNodeAliases} from './nodeAliases';
import {materializeSnapshotForkInputs,applySnapshotNodeForks,pruneSnapshotTopologyNodes} from './nodeForks';
import {applySnapshotCurveAppearance} from './curveAppearance';
import {type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotDiagnostic,type SnapshotElementProvenance,type SnapshotRelationCollection,type SnapshotRelationPatch,type Angle,type WarpGrid,type SnapshotPoseTrack,type SnapshotRecording,type SnapshotEndpointResponses,type SnapshotAngleGraph} from './model';

export interface SnapshotEvaluationOptions extends SceneEvaluationOptions {snapshotId?:string;/** Recorder preview may include only its currently authored zero/source draft in mirror expressions. */liveBasisDrafts?:boolean;/** Trusted store/render callers only: all library, snapshot, key, and draft objects must be immutable. */immutableInputs?:boolean;/** Full curves retain authoritative domain material, but omit terminal cuts and paint. */products?:'controls'|'display'}
export interface SnapshotEvaluation {
 snapshotId:string;topologyInputDrawing:DrawingDocument;source:DrawingDocument;baseDrawing:DrawingDocument;drawing:DrawingDocument;preShapeDrawing:DrawingDocument;prePlacementDrawing:DrawingDocument;preElementPlacementDrawing:DrawingDocument;
 elementPlacements:Record<string,ScenePlacementValue>;
 angle:Angle;state:SnapshotDeformationState;provenance:Record<string,SnapshotElementProvenance>;
 diagnostics:SnapshotDiagnostic[];warpGrids:Record<string,WarpGrid>;placements:Record<string,ScenePlacementValue>;
 paintBatches:PaintBatch[];fitDiagnostics:SceneEvaluation['fitDiagnostics'];warningCurveIds:string[];
 intervalTransportErrors:SceneEvaluation['intervalTransportErrors'];maxError:number;
 diagnosticStage:'preview'|'full';conflictingNodeIds:string[];
 /** Evaluation bookkeeping prevents one inherited angle channel applying twice. */
 appliedTrackIds:string[];
 placementsByLayer:Record<string,ScenePlacementValue>;
 layerProvenance:Record<string,{layerId:string;baseSnapshotId:string;sourceLayerId:string}>;
 authoredTracks:SnapshotPoseTrack[];
 /** Final-space controls, with the exact endpoint evaluations reused by onion
  * display. These runtime values never enter the serialized recording. */
 endpointPair?:SnapshotEndpointPairEvaluation;
 angleSurface?:SnapshotAngleSurfaceEvaluation;
}
/** Preserve lazy terminal products when deriving an input/control value. */
function copySnapshotEvaluation(value:SnapshotEvaluation,changes:Partial<SnapshotEvaluation>):SnapshotEvaluation {
 return Object.defineProperties({}, {...Object.getOwnPropertyDescriptors(value),...Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,{value,enumerable:true,writable:true,configurable:true}]))}) as SnapshotEvaluation;
}
export interface SnapshotAngleSurfaceEvaluation {
 role:'basis'|'correction'|'outside';coordinateSpace:'final';
 simplex?:SnapshotSimplexLocation;bases:SnapshotEvaluation[];allBases:SnapshotEvaluation[];
 /** Actual control/material/reflection closure at this sampled angle. */requiredBases?:SnapshotEvaluation[];
 /** Side-qualified virtual poses share the same genuine geometric vertices. */positiveBases?:SnapshotEvaluation[];
 /** Prepared live negative response surface, shared by editing and onions. */mirrorContext?:SnapshotSurfaceMirrorContext;
 /** Matches the draft visibility used for the resolved controls. */responseGraph?:NonNullable<SnapshotRecording['angleGraph']>;
 nodeAuthorities:Record<string,string>;outsideCurves:SnapshotCoverageCurvePreview[];
}
export interface SnapshotEndpointPairBasis {start:SnapshotEvaluation;end:SnapshotEvaluation;startSnapshotId:string;endSnapshotId:string}
export interface SnapshotEndpointPairEvaluation extends SnapshotEndpointPairBasis {
 axis:'x';progress:number;role:'start'|'end'|'correction';coordinateSpace:'final';nodeAuthorities:Record<string,string>;
 responses?:SnapshotEndpointResponses;
}
type SnapshotInputParent=Pick<SnapshotEvaluation,'snapshotId'|'drawing'|'provenance'|'appliedTrackIds'>;
interface SnapshotInput {drawing:DrawingDocument;topologyInputDrawing:DrawingDocument;provenance:SnapshotEvaluation['provenance'];appliedTrackIds:Set<string>}
interface EvaluationCache {
 fingerprint:string;
 inputs:InputCache<{input:SnapshotInput;diagnostics:SnapshotDiagnostic[]}>;
 originals:InputCache<DrawingDocument|undefined>;prepared:InputCache<SnapshotEvaluation>;
 baseStages:WeakMap<DrawingDocument,InputCache<SceneEvaluation>>;
}
/** Content guards also catch importer/test mutations in place. The archive is
 * deliberately excluded: only live originals and reachable saved state matter. */
const evaluationCaches=new WeakMap<RecordingSnapshotWorkspace['library'],EvaluationCache>();
const canonicalStageDrawings=new WeakMap<DrawingDocument,DrawingDocument>();
const immutableIdentities=new WeakMap<object,number>();let nextImmutableIdentity=1;const immutableIdentity=(value:object|undefined)=>{if(!value)return 0;let id=immutableIdentities.get(value);if(id===undefined){id=nextImmutableIdentity++;immutableIdentities.set(value,id);}return id;};
const savedSnapshotIdentities=new WeakMap<RecordingSnapshot,RecordingSnapshot>();
/** A trusted transaction may retain saved evaluation identity only when its
 * copy changes draft state alone. Saved edits/imports never inherit this token. */
export function retainSnapshotSavedEvaluationIdentity(copy:RecordingSnapshot,source:RecordingSnapshot):void {
 savedSnapshotIdentities.set(copy,savedSnapshotIdentities.get(source)??source);
}
const resultIdentities=new WeakMap<SnapshotEvaluation,number>();let nextResultIdentity=1;
const resultIdentity=(result:SnapshotEvaluation)=>{let id=resultIdentities.get(result);if(id===undefined){id=nextResultIdentity++;resultIdentities.set(result,id);}return id;};
function evaluationCache(workspace:RecordingSnapshotWorkspace,immutable=false):EvaluationCache {
 const known=evaluationCaches.get(workspace.library);if(immutable&&known)return known;const fingerprint=JSON.stringify(workspace.library);if(known?.fingerprint===fingerprint)return known;
 const cache:EvaluationCache={fingerprint,inputs:new InputCache(24),originals:new InputCache(16),baseStages:new WeakMap(),prepared:new InputCache(2048)};evaluationCaches.set(workspace.library,cache);return cache;
}
function cachedOriginal(workspace:RecordingSnapshotWorkspace,id:string):DrawingDocument|undefined {
 const cache=evaluationCaches.get(workspace.library),snapshot=workspace.snapshots.find(s=>s.id===id);if(!cache||!snapshot)return materializeOriginalSnapshot(workspace,id);
 const key=JSON.stringify(snapshot),known=cache.originals.get(key);if(known)return known;return cache.originals.set(key,materializeOriginalSnapshot(workspace,id));
}
const evaluationOptionsKey=(options:SnapshotEvaluationOptions)=>JSON.stringify([options.angle,options.useDraft!==false,!!options.liveBasisDrafts,options.stopAtWarpId??null,!!options.omitPlacements,!!options.omitShapes,options.tolerance??1/250,options.fitSamples??64,options.diagnostics??'full',options.validationSamples??1024,options.products??'display']);
export class SnapshotResolutionError extends Error {
 constructor(public diagnostic:SnapshotDiagnostic){super(diagnostic.message);this.name='SnapshotResolutionError';}
}
const relationNames=['joins','endpointLinks','groups','displayIntervals'] as const;
const emptyRelations=():SnapshotRelationCollection=>({joins:[],endpointLinks:[],groups:[],displayIntervals:[]});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function applyPatch<T extends {id:string}>(values:T[],patch:SnapshotRelationPatch<T>|undefined,diagnostics:SnapshotDiagnostic[],snapshotId:string):T[]{
 const result=new Map(values.map(value=>[value.id,structuredClone(value)]));
 for(const value of patch?.add??[]){if(result.has(value.id)&&!same(result.get(value.id),value))throw new SnapshotResolutionError({code:'RELATION_CONFLICT',snapshotId,elementId:value.id,message:`Relation ${value.id} already exists with different state; use an explicit update.`});result.set(value.id,structuredClone(value));}
 for(const value of patch?.update??[]){if(!result.has(value.id))diagnostics.push({code:'MISSING_RELATION',snapshotId,elementId:value.id,message:`Updated relation ${value.id} has no inherited original; the explicit update is retained.`});result.set(value.id,structuredClone(value));}
 for(const id of patch?.disable??[])result.delete(id);
 return [...result.values()];
}
function relationSubset(drawing:DrawingDocument,curves:Set<string>):SnapshotRelationCollection {
 return {joins:drawing.joins.filter(j=>curves.has(j.a.curveId)&&curves.has(j.b.curveId)),endpointLinks:(drawing.endpointLinks??[]).filter(j=>curves.has(j.a.curveId)&&curves.has(j.b.curveId)),groups:(drawing.groups??[]).filter(g=>g.curveIds.some(id=>curves.has(id))).map(g=>({...g,curveIds:g.curveIds.filter(id=>curves.has(id))})),displayIntervals:(drawing.displayIntervals??[]).filter(t=>curves.has(t.anchor.id))};
}
function validRelationships(drawing:DrawingDocument,diagnostics:SnapshotDiagnostic[],snapshotId:string):DrawingDocument {
 const curves=new Set(drawing.curves.map(c=>c.id));
 const activePair=(r:{id:string;a:{curveId:string};b:{curveId:string}})=>{const active=curves.has(r.a.curveId)&&curves.has(r.b.curveId);if(!active)diagnostics.push({code:'MISSING_ELEMENT',snapshotId,elementId:r.id,message:`Relation ${r.id} references an element outside this snapshot and is inactive.`});return active;};
 const result={...drawing,joins:drawing.joins.filter(activePair),endpointLinks:drawing.endpointLinks?.filter(activePair),groups:drawing.groups?.map(g=>({...g,curveIds:g.curveIds.filter(id=>curves.has(id))})).filter(g=>g.curveIds.length)};
 result.displayIntervals=drawing.displayIntervals?.filter(t=>{if(!curves.has(t.anchor.id)){diagnostics.push({code:'MISSING_ELEMENT',snapshotId,elementId:t.id,message:`Display interval ${t.id} has no anchor in this snapshot.`});return false;}if(t.displayRoute){const route=resolveDisplayRoute(result,t.displayRoute,{deferEndpointPositions:true});if(route.diagnostics.length){diagnostics.push({code:'ROUTE',snapshotId,elementId:t.id,message:`Display route ${t.id} is incomplete in this snapshot; its saved relationship remains available.`});return false;}}return true;});return result;
}
/** Parent-domain reflection is cached by the immutable evaluated parent and
 * exact semantic mapping. It precedes child membership and local deformation. */
const mirroredParentInputs=new WeakMap<SnapshotEvaluation,InputCache<SnapshotEvaluation>>();
export function prepareSnapshotParentInput(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,parent:SnapshotEvaluation):SnapshotEvaluation {
 const recording=recordingForSnapshot(workspace,snapshot.id),relation=recording&&recordingViewMirrorRelation(workspace,recording);
 if(relation?.targetSnapshotId===snapshot.id&&parent.snapshotId===relation.sourceSnapshotId){const zero=resolveSnapshot(workspace,relation.zeroSnapshotId,{useDraft:false,diagnostics:'preview'});return prepareViewMirrorInput(parent,zero,snapshot.id,snapshotViewMirrorOptions(workspace,recording!,zero,parent));}
 if(!snapshot.inputMirror||snapshot.parentSnapshotId!==parent.snapshotId)return parent;
 const mirror=snapshot.inputMirror,curves=new Set(parent.drawing.curves.map(curve=>curve.id)),nodes=new Set(parent.drawing.nodes.map(node=>node.id));
 const sources=new Set(Object.values(parent.provenance).map(value=>value.sourceSnapshotId));
 const diagnostics:SnapshotDiagnostic[]=recording?.angleGraph&&!relation?[{code:'INPUT_MIRROR',snapshotId:snapshot.id,message:'No local 0° basis is bound for this legacy mirror; its saved absolute input mirror remains in use.'}]:[],pairs=[...mirror.curvePairs],used=new Set(pairs.flatMap(pair=>[pair.a,pair.b]));
 const axisNodes=new Set(mirror.axisNodeIds??[]);
 for(const source of workspace.snapshots.filter(value=>sources.has(value.id)&&value.source)){
  const metadata=source.source!;
  if(metadata.mirrorAxisX!==undefined&&metadata.mirrorAxisX!==mirror.axisX)diagnostics.push({code:'INPUT_MIRROR',snapshotId:snapshot.id,message:`Source ${source.name} uses mirror axis ${metadata.mirrorAxisX}; this snapshot keeps its explicitly selected axis ${mirror.axisX}.`});
  for(const pair of metadata.mirrorEditing?.curvePairs??[]){if(!curves.has(pair.a)&&!curves.has(pair.b))continue;if(!used.has(pair.a)&&!used.has(pair.b)){pairs.push(pair);used.add(pair.a);used.add(pair.b);}}
  for(const id of metadata.mirrorEditing?.axisNodeIds??[])axisNodes.add(id);
 }
 const activePairs=pairs.filter(pair=>{const a=curves.has(pair.a),b=curves.has(pair.b);if(a!==b)diagnostics.push({code:'INPUT_MIRROR',snapshotId:snapshot.id,elementId:a?pair.a:pair.b,message:`Mirror pair ${pair.id} is incomplete in this parent; its available curve keeps its canonical identity.`});return a&&b;});
 const options={...mirror,axisX:mirror.axisX,curvePairs:activePairs,axisNodeIds:[...axisNodes].filter(id=>nodes.has(id))},key=JSON.stringify([snapshot.id,options,diagnostics]);
 const cache=mirroredParentInputs.get(parent)??new InputCache<SnapshotEvaluation>(8),known=cache.get(key);if(known)return known;
 try{
  const reflected=mirrorSnapshotDrawing(parent.drawing,options);
  const provenance=mirroredSnapshotProvenance(parent,reflected.correspondence);
  const result=copySnapshotEvaluation(parent,{drawing:reflected.drawing,provenance,diagnostics:[...parent.diagnostics,...diagnostics,...reflected.diagnostics.map(issue=>({code:'INPUT_MIRROR' as const,snapshotId:snapshot.id,elementId:issue.entityId,message:issue.message}))]});
  mirroredParentInputs.set(parent,cache);return cache.set(key,result);
 }catch(cause){throw new SnapshotResolutionError({code:'INPUT_MIRROR',snapshotId:snapshot.id,message:cause instanceof SnapshotMirrorError?`${cause.code}: ${cause.message}`:cause instanceof Error?cause.message:String(cause)});}
}
function mirroredSnapshotProvenance(parent:SnapshotEvaluation,correspondence:ReturnType<typeof mirrorSnapshotDrawing>['correspondence']):SnapshotEvaluation['provenance'] {
 const idMap:Record<string,string>={...correspondence.nodes,...Object.fromEntries(Object.entries(correspondence.curves).map(([id,value])=>[id,value.id])),...correspondence.fills,...correspondence.offsets,...correspondence.layers},map=(id:string)=>idMap[id]??id;
 const composedMaps=new Map<Record<string,string>,Record<string,string>>();
 const compose=(previous:Record<string,string>|undefined)=>{if(!previous)return idMap;let result=composedMaps.get(previous);if(!result){result=Object.fromEntries(Object.entries(previous).map(([sourceId,currentId])=>[sourceId,map(currentId)]));composedMaps.set(previous,result);}return result;};
 const provenance=Object.fromEntries(Object.entries(parent.provenance).map(([id,value])=>{const mapped=map(id);return [mapped,{...value,elementId:mapped,...(value.depthContext?{depthContext:remapSnapshotDepthContext(value.depthContext,map)}:{}),materialContext:{elementId:value.materialContext?.elementId??value.elementId,idMap:compose(value.materialContext?.idMap)}}];}));
 return provenance;
}
const viewMirrorInputs=new WeakMap<SnapshotEvaluation,InputCache<SnapshotEvaluation>>();
/** Zero is an extra expression input. The reflected input precedes child local
 * membership, shapes, and placements, so positive overrides apply once. */
function prepareViewMirrorInput(parent:SnapshotEvaluation,zero:SnapshotEvaluation,targetId:string,options:ViewMirrorOptions):SnapshotEvaluation {
 const cache=viewMirrorInputs.get(parent)??new InputCache<SnapshotEvaluation>(12),key=JSON.stringify([resultIdentity(zero),targetId,options]),known=cache.get(key);if(known)return known;
 try{
  const reflected=mirrorViewDrawingPresence(parent.drawing,zero.drawing,options),drawing=reflected.drawing;
  const result=copySnapshotEvaluation(parent,{drawing,provenance:mirroredSnapshotProvenance(parent,reflected.correspondence),diagnostics:[...parent.diagnostics,...zero.diagnostics,...reflected.diagnostics.map(issue=>({code:'INPUT_MIRROR' as const,snapshotId:targetId,message:issue.message}))]});
  viewMirrorInputs.set(parent,cache);return cache.set(key,result);
 }catch(cause){throw new SnapshotResolutionError({code:'INPUT_MIRROR',snapshotId:targetId,message:cause instanceof Error?cause.message:String(cause)});}
}
export function snapshotViewMirrorOptions(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,zero:SnapshotEvaluation,current=zero):ViewMirrorOptions {
 const relation=recordingViewMirrorRelation(workspace,recording)!,target=workspace.snapshots.find(snapshot=>snapshot.id===relation.targetSnapshotId)!;
 const metadata=zero.drawing.mirrorEditing;
 // The current zero's canonical pairs stay live across source topology edits.
 const curvePairs=snapshotViewMirrorCurvePairs(workspace,zero.snapshotId,target.inputMirror?.curvePairs),currentIds=new Set(current.drawing.curves.map(curve=>curve.id));
 const unpairedGroups=(relation.unpairedReference??'zero-stroke-frame')==='zero-stroke-frame'?viewMirrorUnpairedCurveGroups(zero.drawing,curvePairs).flatMap(ids=>{
  const curveIds=ids.filter(id=>currentIds.has(id));if(!curveIds.length)return [];
  const reference=displayedSnapshotStrokeFrameCenter(zero,ids);if(!reference)throw new SnapshotResolutionError({code:'INPUT_MIRROR',snapshotId:target.id,message:`The local zero V-frame for ${ids.join(', ')} is unavailable.`});
  return [{curveIds,reference}];
 }):undefined;
 return {curvePairs,axisNodeIds:metadata?.axisNodeIds??target.inputMirror?.axisNodeIds,splitMaterials:target.inputMirror?.splitMaterials,...(unpairedGroups?{unpairedGroups}:{})};
}
/** Select complete cached controls before interpolation; zero authoring itself
 * always selects the authored (negative) side. */
export function snapshotSurfaceBasesAtAngle(surface:SnapshotAngleSurfaceEvaluation,angle:Angle):SnapshotEvaluation[]{return angle.x>0&&surface.positiveBases?surface.positiveBases:surface.allBases;}
/** Inverse consumers use the sampled closure; full inspection remains explicit. */
export function snapshotSurfaceRequiredBases(surface:SnapshotAngleSurfaceEvaluation,angle:Angle):SnapshotEvaluation[]{return surface.requiredBases??snapshotSurfaceBasesAtAngle(surface,angle);}
function inputForSnapshot(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,parents:Map<string,SnapshotInputParent>,diagnostics:SnapshotDiagnostic[]):SnapshotInput {
 const drawing=emptyDrawing(),provenance:SnapshotEvaluation['provenance']={},appliedTrackIds=new Set<string>();
 const objects=new Map<string,unknown>(),nodeMap=new Map<string,DrawingDocument['nodes'][number]>(),inherited=emptyRelations();
 const selectedByParent=new Map<string,Set<string>>(),selectedObjectsByParent=new Map<string,Set<string>>();
 for(const layer of snapshot.layers){
  let source:DrawingDocument|undefined,sourceLayer:DrawingLayer|undefined,parent:SnapshotInputParent|undefined;
  let localIds=new Set<string>();
  if(layer.kind==='original'){
   sourceLayer={...layer,items:resolveSnapshotLocalMembership(layer.items,layer.membership).elementIds};const curves=sourceLayer.items.map(id=>workspace.library.curves[id]).filter(Boolean),nodes=[...new Set(curves.flatMap(c=>c.nodes))].map(id=>workspace.library.nodes[id]).filter(Boolean);
   source={version:3,layers:[sourceLayer],nodes,curves,fills:sourceLayer.items.map(id=>workspace.library.fills[id]).filter(Boolean),offsets:sourceLayer.items.map(id=>workspace.library.offsets[id]).filter(Boolean),joins:[]};
  }else{
   parent=parents.get(layer.baseSnapshotId);source=parent?.drawing;sourceLayer=source?.layers.find(l=>l.id===layer.baseLayerId);
   if(!source)diagnostics.push({code:'MISSING_SNAPSHOT',snapshotId:snapshot.id,layerId:layer.id,message:`Base snapshot ${layer.baseSnapshotId} is missing; its reference is retained.`});
   else if(!sourceLayer)diagnostics.push({code:'MISSING_LAYER',snapshotId:snapshot.id,layerId:layer.id,message:`Base layer ${layer.baseLayerId} is missing; its reference is retained.`});
   parent?.appliedTrackIds.forEach(id=>appliedTrackIds.add(id));
   const membership=resolveSnapshotLocalMembership(sourceLayer?.items??[],layer.membership);localIds=new Set(membership.localElementIds);
   const localCurves=membership.localElementIds.flatMap(id=>!snapshot.memberSources?.[id]&&Object.hasOwn(workspace.library.curves,id)?[workspace.library.curves[id]]:[]),localNodes=new Set(localCurves.flatMap(curve=>curve.nodes));
   const inherited=source??emptyDrawing(),existingNodes=new Set(inherited.nodes.map(node=>node.id));
   source={...inherited,curves:[...inherited.curves,...localCurves],nodes:[...inherited.nodes,...[...localNodes].filter(id=>!existingNodes.has(id)&&Object.hasOwn(workspace.library.nodes,id)).map(id=>workspace.library.nodes[id])],fills:[...inherited.fills,...membership.localElementIds.flatMap(id=>!snapshot.memberSources?.[id]&&Object.hasOwn(workspace.library.fills,id)?[workspace.library.fills[id]]:[])],offsets:[...inherited.offsets,...membership.localElementIds.flatMap(id=>!snapshot.memberSources?.[id]&&Object.hasOwn(workspace.library.offsets,id)?[workspace.library.offsets[id]]:[])]};
   sourceLayer={id:layer.id,name:layer.name,visible:true,locked:false,items:membership.elementIds};
  }
  // Moved inherited members remain live in their actual parent, even when
  // this layer references another parent or locally owns its other members.
  const remoteIds=new Set(sourceLayer.items.filter(id=>snapshot.memberSources?.[id]));
  if(remoteIds.size){
   const remoteCurves:DrawingDocument['curves']=[],remoteFills:DrawingDocument['fills']=[],remoteOffsets:DrawingDocument['offsets']=[],remoteNodes=new Map<string,DrawingDocument['nodes'][number]>();
   for(const id of remoteIds){const parent=parents.get(snapshot.memberSources![id]);if(!parent){diagnostics.push({code:'MISSING_SNAPSHOT',snapshotId:snapshot.id,elementId:id,message:`Moved member ${id} has an unavailable parent.`});continue;}
    const curve=parent.drawing.curves.find(value=>value.id===id),fill=parent.drawing.fills.find(value=>value.id===id),offset=parent.drawing.offsets.find(value=>value.id===id);
    if(curve){remoteCurves.push(curve);for(const nodeId of curve.nodes){const node=parent.drawing.nodes.find(value=>value.id===nodeId);if(node)remoteNodes.set(nodeId,node);}const selected=selectedByParent.get(parent.snapshotId)??new Set<string>();selected.add(id);selectedByParent.set(parent.snapshotId,selected);}
    if(fill)remoteFills.push(fill);if(offset)remoteOffsets.push(offset);parent.appliedTrackIds.forEach(id=>appliedTrackIds.add(id));
   }
   source={...source,curves:[...source.curves.filter(value=>!remoteIds.has(value.id)),...remoteCurves],fills:[...source.fills.filter(value=>!remoteIds.has(value.id)),...remoteFills],offsets:[...source.offsets.filter(value=>!remoteIds.has(value.id)),...remoteOffsets],nodes:[...source.nodes.filter(node=>!remoteNodes.has(node.id)),...remoteNodes.values()]};
   for(const id of remoteIds)localIds.delete(id);
  }
  const items=new Set(sourceLayer.items),curves=source.curves.filter(c=>items.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
  const layerItems:string[]=[];
  for(const entity of [...curves,...source.fills.filter(f=>items.has(f.id)),...source.offsets.filter(o=>items.has(o.id))]){
   if(objects.has(entity.id))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,layerId:layer.id,elementId:entity.id,message:`Canonical element ${entity.id} reaches this snapshot through more than one layer branch. Choose one parent state explicitly.`});
   objects.set(entity.id,entity);layerItems.push(entity.id);
   const memberParent=snapshot.memberSources?.[entity.id]?parents.get(snapshot.memberSources[entity.id]):parent,prior=localIds.has(entity.id)?undefined:memberParent?.provenance[entity.id];if(memberParent&&!localIds.has(entity.id)){const selected=selectedObjectsByParent.get(memberParent.snapshotId)??new Set<string>();selected.add(entity.id);selectedObjectsByParent.set(memberParent.snapshotId,selected);}provenance[entity.id]={...prior,elementId:entity.id,sourceSnapshotId:prior?.sourceSnapshotId??snapshot.id,path:[...(prior?.path??[]),snapshot.id],...(prior?.materialContext?{materialContext:prior.materialContext}:{})};
   if(localIds.has(entity.id))diagnostics.push({code:'LOCAL_ORIGINAL',snapshotId:snapshot.id,layerId:layer.id,elementId:entity.id,message:`Local original ${entity.id} has no parent counterpart; it belongs only to this snapshot's membership.`});
  }
  for(const id of sourceLayer.items)if(!objects.has(id))diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,layerId:layer.id,elementId:id,message:`Canonical element ${id} is missing; its reference is retained.`});
  drawing.layers.push({id:layer.id,name:layer.name,visible:true,locked:false,items:sourceLayer.items.filter(id=>layerItems.includes(id))});
  drawing.curves.push(...structuredClone(curves));drawing.fills.push(...structuredClone(source.fills.filter(f=>items.has(f.id))));drawing.offsets.push(...structuredClone(source.offsets.filter(o=>items.has(o.id))));
  for(const node of source.nodes.filter(n=>nodes.has(n.id))){const prior=nodeMap.get(node.id);if(prior&&!same(prior,node))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,elementId:node.id,message:`Shared node ${node.id} has different parent states.`});nodeMap.set(node.id,structuredClone(node));const member=curves.find(curve=>curve.nodes.includes(node.id)&&snapshot.memberSources?.[curve.id]),memberParent=member?parents.get(snapshot.memberSources![member.id]):parent,p=memberParent?.provenance[node.id];provenance[node.id]={...p,elementId:node.id,sourceSnapshotId:p?.sourceSnapshotId??snapshot.id,path:[...(p?.path??[]),snapshot.id],...(p?.materialContext?{materialContext:p.materialContext}:{})};}
  if(layer.kind==='reference'&&parent){const set=selectedByParent.get(layer.baseSnapshotId)??new Set<string>();curves.filter(c=>!localIds.has(c.id)&&(!snapshot.memberSources?.[c.id]||snapshot.memberSources[c.id]===layer.baseSnapshotId)).forEach(c=>set.add(c.id));selectedByParent.set(layer.baseSnapshotId,set);}
 }
 drawing.nodes=[...nodeMap.values()];
 for(const [id,curves] of selectedByParent){const relations=relationSubset(parents.get(id)!.drawing,curves);for(const name of relationNames)(inherited[name] as {id:string}[]).push(...relations[name]);}
 for(const name of relationNames){const distinct=new Map<string,{id:string}>();for(const relation of inherited[name]){const prior=distinct.get(relation.id);if(prior&&!same(prior,relation)&&!snapshot.relations[name]?.update?.some(r=>r.id===relation.id)&&!snapshot.relations[name]?.disable?.includes(relation.id))throw new SnapshotResolutionError({code:'RELATION_CONFLICT',snapshotId:snapshot.id,elementId:relation.id,message:`Parent snapshots disagree on relation ${relation.id}; choose an explicit update or disable.`});distinct.set(relation.id,relation);}let patch=snapshot.relations[name] as SnapshotRelationPatch<{id:string}>|undefined;if(name==='displayIntervals'&&patch){const issues={...snapshot.inheritedState?.intervalMaterialIssues,...snapshot.deformation.intervalMaterialIssues},active=(value:{id:string})=>{const issue=issues[value.id];if(!issue)return true;const original=cachedOriginal(workspace,issue.sourceSnapshotId);return !!original&&drawingSignature(original)===issue.sourceSignature;};patch={...patch,...(patch.add?{add:patch.add.filter(active)}:{}),...(patch.update?{update:patch.update.filter(active)}:{})};}(drawing[name] as {id:string}[])=applyPatch([...distinct.values()],patch,diagnostics,snapshot.id);}
 // Keep dependent paint objects only when their explicit curves are available.
 const curveIds=new Set(drawing.curves.map(c=>c.id)),removed=new Set<string>();
 drawing.fills=drawing.fills.filter(f=>{const ok=f.boundary.every(u=>curveIds.has(u.id));if(!ok)removed.add(f.id);return ok;});drawing.offsets=drawing.offsets.filter(o=>{const ok=o.source.every(u=>curveIds.has(u.id));if(!ok)removed.add(o.id);return ok;});
 for(const id of removed)diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,elementId:id,message:`Paint element ${id} has a missing curve dependency and is inactive.`});
 for(const layer of drawing.layers)layer.items=layer.items.filter(id=>!removed.has(id));
 const metadata=applySnapshotMirrorMetadata(drawing,snapshot,[...selectedByParent.keys()].map(id=>parents.get(id)!.drawing));
 const runtimeSources=[...selectedObjectsByParent].map(([id,items])=>{const source=parents.get(id)!.drawing,curves=source.curves.filter(curve=>items.has(curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes));return retainSnapshotAffines({...source,curves,nodes:source.nodes.filter(node=>nodes.has(node.id)),fills:source.fills.filter(fill=>items.has(fill.id)),offsets:source.offsets.filter(offset=>items.has(offset.id))},[source]);});
 let input=applySnapshotObjectLocks(retainSnapshotAffines(metadata,runtimeSources),snapshot.objectLocks);
 const forkOrigins=snapshot.nodeForks?[...[...parents.values()].map(parent=>parent.drawing),{...emptyDrawing(),curves:Object.values(workspace.library.curves),nodes:Object.values(workspace.library.nodes)}]:[];
 input=materializeSnapshotForkInputs(input,snapshot.nodeForks,forkOrigins);
 for(const layer of snapshot.layers)if(layer.kind==='reference'){const parent=parents.get(layer.baseSnapshotId);if(parent)input=extendSnapshotInheritedTopology(input,parent.drawing,layer.id,layer.baseLayerId,new Set((layer.membership?.addElementIds??[]).filter(id=>!snapshot.memberSources?.[id])),new Set(Object.keys(snapshot.memberSources??{})));}
 for(const id of Object.keys(snapshot.nodeForks??{}))provenance[id]={elementId:id,sourceSnapshotId:snapshot.id,path:[snapshot.id]};
 const materialSourceForLayer=(layerId:string,curveId:string)=>{const layer=snapshot.layers.find(value=>value.id===layerId),parentId=snapshot.memberSources?.[curveId]??(layer?.kind==='reference'?layer.baseSnapshotId:undefined);return parentId?parents.get(parentId)?.drawing:undefined;};
 const forked=applySnapshotNodeForks(input,snapshot.nodeForks,diagnostics,snapshot.id,forkOrigins,materialSourceForLayer),aliased=applySnapshotNodeAliases(forked,snapshot.nodeAliases,diagnostics,snapshot.id,materialSourceForLayer),topology=snapshot.nodeForks?pruneSnapshotTopologyNodes(aliased):aliased;
 return {drawing:markSnapshotRouteMaterialInput(validRelationships(topology,diagnostics,snapshot.id)),topologyInputDrawing:input,provenance,appliedTrackIds};
}
function shapeState(source:DrawingDocument,state:SnapshotDeformationState,diagnostics:SnapshotDiagnostic[],snapshotId:string):SceneShapeValue {
 const result=identitySceneShape(),nodeLayers=new Map(source.curves.flatMap(c=>c.nodes.map(id=>[id,layerFor(source,c.id)?.id] as const)));
 for(const [layerId,value] of Object.entries(state.layers))if(value.shape){for(const [id,delta] of Object.entries(value.shape.nodes))if(nodeLayers.get(id)===layerId)result.nodes[id]=delta;for(const [id,delta] of Object.entries(value.shape.handles))if(layerFor(source,id)?.id===layerId)result.handles[id]=delta;}
 for(const [target,value] of Object.entries(state.relationPositions)){
  const links=(source.endpointLinks??[]).filter(l=>value.sourceLinkIds.includes(l.id));if(links.length!==value.sourceLinkIds.length)diagnostics.push({code:'MISSING_RELATION',snapshotId,elementId:target,message:'A linked position target is missing one of its explicit endpoint links.'});
  const nodes=new Set(links.flatMap(l=>[l.a,l.b].map(e=>source.curves.find(c=>c.id===e.curveId)?.nodes[e.end]).filter((id):id is string=>!!id)));
  for(const id of nodes)result.nodes[id]=value.offset;
 }
 return result;
}
function placeLayers(before:DrawingDocument,placements:Record<string,ScenePlacementValue>):DrawingDocument {
 const owners=drawingLayerObjectOwners(before);return placeDrawingAffines(before,Object.fromEntries(Object.entries(placements).map(([id,value])=>[id,placementMatrix(value)])),id=>owners.get(id));
}
/** Element offsets resolve against their source siblings before assembly ordering. */
function snapshotPaintBatches(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,drawing:DrawingDocument,provenance:SnapshotEvaluation['provenance']):PaintBatch[]{
 return withDrawingReadScope(()=>snapshotPaintBatchesInScope(workspace,snapshot,drawing,provenance));
}
function snapshotPaintBatchesInScope(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,drawing:DrawingDocument,provenance:SnapshotEvaluation['provenance']):PaintBatch[]{
 const plain={...drawing,curves:drawing.curves.map(c=>c.depthOffset?{...c,depthOffset:0,localPaintOrder:true}:c)},base=depthPaintBatches(plain),positions=new Map<string,number>(),slots=new Map<string,number>();
 for(const batch of base){positions.set(batch.owner??batch.item.id,batch.position);if(!batch.owner)for(const use of batch.item.stroke?.segments??[])positions.set(use.id,batch.position);}
 const originalLayer=(snapshotId:string,layerId:string):string|undefined=>{const owner=workspace.snapshots.find(s=>s.id===snapshotId),layer=owner?.layers.find(l=>l.id===layerId);return layer?.kind==='reference'?originalLayer(layer.baseSnapshotId,layer.baseLayerId):layer?.id;};
 let cursor=0;for(const layer of drawing.layers){const original=originalLayer(snapshot.id,layer.id);if(original)slots.set(original,cursor);slots.set(layer.id,cursor);for(const item of paintItems(drawing,layer.id))cursor+=item.stroke?item.stroke.segments.length:1;cursor++;}
 const sources=new Map<string,DrawingDocument|undefined>();
 const result=base.map(batch=>{if(!batch.owner)return batch;const p=provenance[batch.owner];if(!p)return batch;if(p.depthContext){const context=p.depthContext;if(!context.offset||!context.effective)return batch;const targets=context.targetIds.map(id=>positions.get(id)).filter((value):value is number=>value!==undefined);return {...batch,position:targets.length?(context.offset>0?Math.min(...targets)-.5:Math.max(...targets)+.5):slots.get(context.targetId)??batch.position};}if(!sources.has(p.sourceSnapshotId))sources.set(p.sourceSnapshotId,cachedOriginal(workspace,p.sourceSnapshotId));const source=sources.get(p.sourceSnapshotId),curve=source?.curves.find(c=>c.id===(p.materialContext?.elementId??p.elementId));if(!source||!curve?.depthOffset)return batch;const context=depthContext(source,curve.id);if(!context.effective)return batch;const mapped=(id:string)=>p.materialContext?.idMap[id]??id,targets=context.target.ids.map(id=>positions.get(mapped(id))).filter((n):n is number=>n!==undefined),fallback=p.materialContext&&!Object.hasOwn(p.materialContext.idMap,context.target.id)?batch.position:slots.get(mapped(context.target.id))??batch.position;return {...batch,position:targets.length?(curve.depthOffset>0?Math.min(...targets)-.5:Math.max(...targets)+.5):fallback};});
 const order=new Map(base.map((batch,index)=>[batch.owner??batch.item.id,index]));return result.sort((a,b)=>a.position-b.position||order.get(a.owner??a.item.id)!-order.get(b.owner??b.item.id)!);
}
function evaluateOwn(snapshot:RecordingSnapshot,source:DrawingDocument,state:SnapshotDeformationState,options:SnapshotEvaluationOptions,diagnostics:SnapshotDiagnostic[],cache?:EvaluationCache):Omit<SnapshotEvaluation,'snapshotId'|'topologyInputDrawing'|'source'|'baseDrawing'|'provenance'|'appliedTrackIds'|'placementsByLayer'|'layerProvenance'|'authoredTracks'> {
 source=applySnapshotPaintAppearance(applySnapshotCurveAppearance(source,state),state);
 const deferred=new Map((source.displayIntervals??[]).flatMap(track=>{const material=snapshotRouteMaterialSource(source,track);return material===source?[]:[[track.id,material] as const];})),geometrySource=deferred.size?{...source,displayIntervals:source.displayIntervals?.filter(track=>!deferred.has(track.id))}:source;
 const angle=options.angle??snapshot.angle;if(![angle.x,angle.y].every(n=>Number.isFinite(n)&&n>=-90&&n<=90))throw Error('Snapshot angle must be finite and between -90 and 90.');const scene=emptyRecordingScene('snapshot-evaluation'),instanceId='snapshot-evaluation',sourceId='snapshot-source';
 scene.angle={...angle};scene.instances=[{id:instanceId,artworkId:sourceId,name:snapshot.name}];
 scene.warps=state.warps.map(w=>({id:w.id,name:w.name,parentId:w.parentId,restGrid:w.restGrid,keys:[{id:`current:${w.id}`,angle,value:w.grid}]}));
 scene.bindings=state.bindings.map(b=>({instanceId,sourceLayerId:b.layerId,warpId:b.warpId}));
 for(const [layerId,value] of Object.entries(state.layers)){
  for(const [id,visible] of Object.entries(value.visibility??{}))scene.visibilityTracks.push({id:`visibility:${layerId}:${id}`,target:{instanceId,sourceLayerId:layerId,...(id===layerId?{}:{sourceObjectId:id})},keys:[{id:'current',angle,value:visible}]});
  for(const [id,interval] of Object.entries(value.intervals??{}))if(!deferred.has(id))scene.intervalTracks.push({id:`interval:${id}`,instanceId,sourceTrackId:id,keys:[{id:'current',angle,value:interval}]});
  if(value.depth!==undefined)scene.depthTracks!.push({id:`depth:${layerId}`,target:{instanceId,sourceLayerId:layerId},keys:[{id:'current',angle,value:value.depth}]});
 }
 const shape=shapeState(source,state,diagnostics,snapshot.id);if(Object.keys(shape.nodes).length||Object.keys(shape.handles).length)scene.shapeTracks=[{id:'snapshot-shape',instanceId,keys:[{id:'current',angle,value:shape}]}];
 // Shape/placement edits do not change the source+Warp stage. Cache that stage
 // separately, retaining the existing shape constraints and material transport.
 let stages=cache?.baseStages.get(source);if(cache&&!stages){stages=new InputCache(16);cache.baseStages.set(source,stages);}
 const values=(tracks:typeof scene.visibilityTracks|typeof scene.intervalTracks|typeof scene.depthTracks)=>tracks?.map(({keys,...track})=>({...track,value:keys[0]?.value}));
 const stageKey=JSON.stringify([scene.warps.map(({keys,...warp})=>({...warp,value:keys[0]?.value})),scene.bindings,values(scene.visibilityTracks),values(scene.intervalTracks),values(scene.depthTracks),evaluationOptionsKey({...options,angle:{x:0,y:0},useDraft:false,omitShapes:true,omitPlacements:true})]);
 let base=stages?.get(stageKey);if(!base){base=evaluateScene({...scene,shapeTracks:[]},id=>id===sourceId?geometrySource:undefined,{...options,omitShapes:true,omitPlacements:true,omitPaint:true});stages?.set(stageKey,base);}
 const stageDiagnostics=base.diagnostics.filter(d=>d.code!=='ROUTE'),deformed={drawing:base.drawing,diagnostics:base.fitDiagnostics,diagnosticStage:base.diagnosticStage,intervalTransportErrors:base.intervalTransportErrors,maxError:base.maxError,warningCurveIds:base.warningCurveIds,conflictingNodeIds:base.conflictingNodeIds};
 const shaped=options.omitShapes?deformed:applySceneShapes(deformed,scene,angle,true,base.provenance,stageDiagnostics);
 const routes=new Set<string>();for(const track of shaped.drawing.displayIntervals??[])if(track.displayRoute){const key=JSON.stringify(track.displayRoute);if(routes.has(key))continue;routes.add(key);for(const diagnostic of createDisplayRouteField(shaped.drawing,track.displayRoute).diagnostics){const p=base.provenance[track.id];stageDiagnostics.push({code:'ROUTE',instanceId:p?.instanceId,trackId:p?.sourceId,message:diagnostic.message});}}
 const evaluated:SceneEvaluation={...base,angle:{...angle},drawing:shaped.drawing,preShapeDrawing:base.drawing,prePlacementDrawing:shaped.drawing,diagnostics:stageDiagnostics,fitDiagnostics:shaped.diagnostics as SceneEvaluation['fitDiagnostics'],warningCurveIds:shaped.warningCurveIds,intervalTransportErrors:shaped.intervalTransportErrors,maxError:shaped.maxError};
 const prefix=instanceObjectId(instanceId,''),raw=(id:string)=>id.startsWith(prefix)?id.slice(prefix.length):id;
 const canonical=(drawing:DrawingDocument)=>{let result=canonicalStageDrawings.get(drawing);if(!result){result=remapDrawingIdentities(drawing,raw);if(source.mirrorEditing!==undefined||source.mirrorAxisX!==undefined)result=retainSnapshotAffines({...result,...(source.mirrorAxisX!==undefined?{mirrorAxisX:source.mirrorAxisX}:{}),...(source.mirrorEditing?{mirrorEditing:source.mirrorEditing}:{})},[result]);canonicalStageDrawings.set(drawing,result);}return result;};
 const preShapeDrawing=canonical(evaluated.preShapeDrawing);let preElementPlacementDrawing=canonical(evaluated.prePlacementDrawing),unplaced=canonical(evaluated.drawing);
 // Namespacing and the identity scene stage copy arrays. If downstream geometry
 // is unchanged, its inherited ARC material projection remains the same.
 if(evaluatedAffineSource(source)||hasEvaluatedDeformation(source)){const nodes=new Map(source.nodes.map(node=>[node.id,node])),curves=new Map(source.curves.map(curve=>[curve.id,curve]));const sameGeometry=(drawing:DrawingDocument)=>drawing.nodes.length===source.nodes.length&&drawing.curves.length===source.curves.length&&drawing.nodes.every(node=>same(node.position,nodes.get(node.id)?.position))&&drawing.curves.every(curve=>same(curve.handles,curves.get(curve.id)?.handles));
  if(hasEvaluatedDeformation(source)){
   if(!sameGeometry(preShapeDrawing))throw Error('A new Warp after an inherited retained cage needs an explicit derived-geometry program. Edit the owning cage input or disable the inherited cage first.');
   retainSnapshotAffines(preShapeDrawing,[source]);
   if(!options.omitShapes&&(Object.keys(shape.nodes).length||Object.keys(shape.handles).length)){preElementPlacementDrawing=applyLayerDomainPostShape(preShapeDrawing,shape,new Set(source.curves.map(curve=>curve.id)));unplaced=preElementPlacementDrawing;}
  }
  for(const drawing of new Set([preShapeDrawing,preElementPlacementDrawing,unplaced]))if(sameGeometry(drawing))retainSnapshotAffines(drawing,[source]);}
 const placements=Object.fromEntries(snapshot.layers.map(l=>[l.id,state.layers[l.id]?.placement??identityScenePlacement()]));
 const elementPlacements=Object.assign({},...Object.values(state.layers).map(layer=>layer.elementPlacements??{})) as Record<string,ScenePlacementValue>,prePlacementDrawing=options.omitPlacements?unplaced:placeSnapshotElements(unplaced,elementPlacements);
 const domainMatrices=layerDomainMatrices(state.layerDomains,snapshot.layers.map(layer=>layer.id));
 let drawing=options.omitPlacements?unplaced:placeLayers(prePlacementDrawing,placements);
 if(!options.omitPlacements)drawing=applyLayerDomains(drawing,state.layerDomains,{tolerance:options.tolerance??1/250,onFailure:(domain,error)=>diagnostics.push({code:'LAYER_DOMAIN',snapshotId:snapshot.id,channelId:domain.id,message:`Layer domain ${domain.id} cannot evaluate its live members: ${(error as Error).message} Its input is shown so the authored domain can be repaired or disabled.`})});
 if(deferred.size){
  const tracks=(source.displayIntervals??[]).filter(track=>deferred.has(track.id)).map(track=>{const value=state.layers[layerFor(source,track.anchor.id)!.id]?.intervals?.[track.id];return applyIntervalEnableFlags([value?.appearance??track],value?.enabled??{})[0];});
  const target=retainSnapshotAffines({...drawing,displayIntervals:[...drawing.displayIntervals??[],...tracks]},[drawing]),transported:typeof tracks=[];
  for(const track of tracks){const messages:string[]=[];try{
   transported.push(transportEndpointPairMaterial(deferred.get(track.id)!,track,target,messages));
   for(const message of messages)diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,elementId:track.id,message});
  }catch(error){
   // Retain the authored relationship in source/state, but never reinterpret
   // its material-frame percentages as final-frame cuts after a failed map.
   diagnostics.push({code:'SOURCE_MATERIAL',snapshotId:snapshot.id,elementId:track.id,message:(error as Error).message});
  }}
  drawing=retainSnapshotAffines({...target,displayIntervals:[...drawing.displayIntervals??[],...transported]},[target]);
 }

 if(hasEvaluatedDeformation(drawing)){
  const material=evaluatedMaterialSource(drawing),shapes=material.curves.map(curve=>shapeOf(material,curve.id));
  projectEvaluatedGeometry(drawing,{shapes,pieces:shapes.map((shape,i)=>({shape,owners:[material.curves[i].id]}))});
  for(const layer of drawing.layers)for(const stroke of strokes(drawing,layer.id))for(const path of strokePaths(stroke))derivedUses(drawing,path.segments,path.closed);
  for(const track of drawing.displayIntervals??[])displayField(drawing,displayPath(drawing,track.anchor.id));
 }
 const domainFits=evaluatedDeformationDiagnostics(drawing);for(const fit of domainFits)if(fit.exceedsTolerance)diagnostics.push({code:'POSE',snapshotId:snapshot.id,elementId:fit.owners[0],message:`Retained domain sampled fit error ${fit.maxError} exceeds ${fit.tolerance}${fit.joinId?` on ARC ${fit.joinId}`:''}.`});
 const placedNodes=new Map(drawing.nodes.map(n=>[n.id,n.position])),placedCurves=new Map(drawing.curves.map(c=>[c.id,c]));for(const link of drawing.endpointLinks??[]){const a=placedNodes.get(placedCurves.get(link.a.curveId)?.nodes[link.a.end]??''),b=placedNodes.get(placedCurves.get(link.b.curveId)?.nodes[link.b.end]??'');if(a&&b&&Math.hypot(a[0]-b[0],a[1]-b[1])>1e-8)diagnostics.push({code:'RELATION_CONFLICT',snapshotId:snapshot.id,elementId:link.id,message:'Layer placement separates linked endpoints. Connected layers need coherent placement values.'});}
 for(const diagnostic of evaluated.diagnostics)diagnostics.push({code:diagnostic.code==='ROUTE'?'ROUTE':'POSE',snapshotId:snapshot.id,layerId:diagnostic.sourceLayerId,elementId:diagnostic.sourceObjectId,channelId:diagnostic.trackId,message:diagnostic.message});
 const fitDiagnostics=evaluated.fitDiagnostics.map(d=>{const sourceCurveId=raw(d.sourceCurveId),placement=placements[layerFor(source,sourceCurveId)?.id??'']??identityScenePlacement();if(options.omitPlacements)return {...d,sourceCurveId};const element=elementPlacements[sourceCurveId]??identityScenePlacement(),domain=domainMatrices[layerFor(source,sourceCurveId)?.id??'']??identityAffine2D(),map=(p:Point2)=>applyAffine2D(domain,applyScenePlacement(placement,applyScenePlacement(element,p))),maximum=affine2DMaxScale(domain)*scenePlacementMaxScale(placement)*scenePlacementMaxScale(element),maxError=d.maxError*maximum,endpointMismatchError=d.endpointMismatchError*maximum,exceedsTolerance=maxError>d.tolerance,endpointConflict=d.endpointConflict||endpointMismatchError>1e-8,cubic=d.cubic.map(map) as Cubic;return {...d,sourceCurveId,cubic,peakExpected:map(d.peakExpected),peakActual:map(d.peakActual),maxError,endpointMismatchError,exceedsTolerance,endpointConflict,warning:exceedsTolerance||endpointConflict||d.nonFinite||!!d.appearanceWarning};});
 return {drawing,preShapeDrawing,prePlacementDrawing,preElementPlacementDrawing,elementPlacements,angle:evaluated.angle,state,diagnostics,warpGrids:evaluated.warpGrids,placements,paintBatches:[],fitDiagnostics,warningCurveIds:[...new Set([...fitDiagnostics.filter(d=>d.warning).map(d=>d.sourceCurveId),...domainFits.filter(d=>d.exceedsTolerance).flatMap(d=>d.owners)])],intervalTransportErrors:evaluated.intervalTransportErrors.map(e=>({...e,trackId:raw(e.trackId),sourceCurveIds:e.sourceCurveIds.map(raw)})),maxError:Math.max(fitDiagnostics.reduce((m,d)=>Math.max(m,d.maxError),0),...domainFits.map(d=>d.maxError)),diagnosticStage:evaluated.diagnosticStage,conflictingNodeIds:evaluated.conflictingNodeIds.map(raw)};
}
/** Returned evaluated documents are immutable runtime values, shared by the
 * bounded cache until their live source, saved state, tracks, or options change. */
function resolveSnapshotInContext(context:RecordingContext,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const workspace=context.workspace,persistent=context.cache,visiting=new Set<string>();
 const resolve=(id:string,root=false,visibilitySource=false):SnapshotEvaluation=>{
  const plan=context.plan(id,options,root,visibilitySource),localKey=plan.key,cached=context.snapshotValues.get(localKey)??persistent.prepared.get(localKey);if(cached){context.snapshotValues.set(localKey,cached);return plan.recording&&cached.authoredTracks!==plan.recording.tracks?copySnapshotEvaluation(cached,{authoredTracks:plan.recording?.tracks??[]}):cached;}
  const snapshot=context.index.snapshots.get(id);if(!snapshot)throw new SnapshotResolutionError({code:'MISSING_SNAPSHOT',snapshotId:id,message:`Snapshot ${id} is missing.`});
  if(visiting.has(id))throw new SnapshotResolutionError({code:'SNAPSHOT_CYCLE',snapshotId:id,message:`Snapshot ${id} contains a parent cycle.`});visiting.add(id);
  const recording=context.index.recordingForSnapshot.get(id),viewMirror=recording&&recordingViewMirrorRelation(workspace,recording),materialRecipe=recording?.angleGraph?.materialBasisRecipes?.[id],visibilityRecipe=recording?.angleGraph?.visibilityBasisRecipes?.[id];
  const materialGraph=recording?.angleGraph,liveMaterial=options.liveBasisDrafts??options.useDraft!==false,effectiveMaterialGraph=materialGraph&&!liveMaterial?{...materialGraph,correctionFrames:materialGraph.correctionFrames?.filter(frame=>frame.status!=='draft')}:materialGraph;
  const materialBases=materialRecipe?snapshotMaterialRecipeDependencies(materialRecipe,materialGraph?.mesh,effectiveMaterialGraph,snapshot.angle).map(source=>resolve(source,false,liveMaterial)):[];
  const mirrorTerm=materialRecipe?.terms.find(term=>term.weight==='view-mirror'),materialZero=mirrorTerm&&materialBases.find(base=>base.snapshotId===mirrorTerm.zeroSnapshotId),materialMirrorOptions=materialZero?snapshotViewMirrorOptions(workspace,recording!,materialZero):undefined;
  const materialMirror=materialZero?prepareSnapshotViewMirrorSurface(effectiveMaterialGraph!,materialBases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:materialGraph!.mesh.vertices.find(vertex=>vertex.snapshotId===base.snapshotId)!.angle})),materialZero.drawing,current=>snapshotViewMirrorOptions(workspace,recording!,materialZero,copySnapshotEvaluation(materialZero,{drawing:current}))):undefined;
  const visibilityBases=visibilityRecipe?snapshotVisibilityRecipeDependencies(visibilityRecipe).map(source=>resolve(source,false,true)):[];
  const parents=new Map<string,SnapshotEvaluation>();for(const layer of snapshot.layers)if(layer.kind==='reference'&&context.index.snapshots.has(layer.baseSnapshotId)&&!parents.has(layer.baseSnapshotId))parents.set(layer.baseSnapshotId,resolve(layer.baseSnapshotId));
  for(const sourceId of Object.values(snapshot.memberSources??{}))if(context.index.snapshots.has(sourceId)&&!parents.has(sourceId))parents.set(sourceId,resolve(sourceId));
  if(viewMirror?.targetSnapshotId===id){
   const live=options.liveBasisDrafts??options.useDraft!==false,parent=resolve(viewMirror.sourceSnapshotId,false,live),zero=resolve(viewMirror.zeroSnapshotId,false,live);
   parents.set(viewMirror.sourceSnapshotId,prepareViewMirrorInput(parent,zero,id,snapshotViewMirrorOptions(workspace,recording!,zero,parent)));
  }else if(snapshot.parentSnapshotId&&(snapshot.parentLayers||snapshot.inputMirror)){const parent=parents.get(snapshot.parentSnapshotId)??resolve(snapshot.parentSnapshotId);parents.set(snapshot.parentSnapshotId,prepareSnapshotParentInput(workspace,snapshot,parent));}
  const localOptions=plan.options,angle=localOptions.angle!;
  const parentIds=[...parents].map(([id,value])=>[id,resultIdentity(value)]);
  const inputKey=JSON.stringify(options.immutableInputs?[id,immutableIdentity(snapshot.layers),immutableIdentity(snapshot.memberSources),immutableIdentity(snapshot.relations),immutableIdentity(snapshot.nodeAliases),immutableIdentity(snapshot.nodeForks),immutableIdentity(snapshot.objectLocks),immutableIdentity(snapshot.source),immutableIdentity(snapshot.inheritedState?.intervalMaterialIssues),immutableIdentity(snapshot.deformation.intervalMaterialIssues),parentIds,plan.originalDependencies]:[id,snapshot.layers,snapshot.memberSources,snapshot.relations,snapshot.nodeAliases,snapshot.nodeForks,snapshot.objectLocks,snapshot.source,snapshot.inheritedState?.intervalMaterialIssues,snapshot.deformation.intervalMaterialIssues,parentIds,plan.originalDependencies]);
  let cachedInput=persistent.inputs.get(inputKey);if(!cachedInput){context.count('snapshotInput',id);const diagnostics:SnapshotDiagnostic[]=[...parents.values()].flatMap(p=>p.diagnostics),input=inputForSnapshot(workspace,snapshot,parents,diagnostics);cachedInput=persistent.inputs.set(inputKey,{input,diagnostics});}
  context.count('snapshotState',id);const input=cachedInput.input,diagnostics=[...cachedInput.diagnostics],state=evaluateSnapshotState(snapshot,recording,input.drawing,angle,localOptions.useDraft!==false,input.appliedTrackIds,{diagnostics,signature:sourceId=>{const original=cachedOriginal(workspace,sourceId);return original?drawingSignature(original):undefined;}});
  const appliedTrackIds=new Set(input.appliedTrackIds);for(const track of recording?.tracks??[])if(snapshot.layers.some(l=>l.id===track.targetId)||state.warps.some(w=>w.id===track.targetId)||state.relationPositions[track.targetId])appliedTrackIds.add(track.id);
  const inheritedMaterial=materialRecipe?applySnapshotMaterialRecipe(materialRecipe,snapshot.angle,materialBases,input.drawing,undefined,recording?.angleGraph?.materialPartitions,recording?.angleGraph?.materialPathLineages,materialMirror):undefined,materialInput=inheritedMaterial?.drawing??input.drawing,materialSource=visibilityRecipe?evaluateSnapshotVisibilityRecipe(visibilityRecipe,visibilityBases,materialInput,snapshot.angle):materialInput;
  if(inheritedMaterial)diagnostics.push(...inheritedMaterial.diagnostics.map(message=>({code:'SOURCE_MATERIAL' as const,snapshotId:id,message})));
  context.count('ownGeometry',id);const dependencyInput=prepareCageEvaluationDependencies(snapshot,materialSource,state,parents),own=evaluateOwn(snapshot,dependencyInput.source,dependencyInput.state,localOptions,diagnostics,persistent);
  for(const stage of ['drawing','preShapeDrawing','prePlacementDrawing','preElementPlacementDrawing'] as const)own[stage]=dependencyInput.restrict(own[stage]);
  own.state=state;
  if(dependencyInput.source!==materialSource){const curves=new Set(materialSource.curves.map(curve=>curve.id));own.fitDiagnostics=own.fitDiagnostics.filter(fit=>curves.has(fit.sourceCurveId));own.warningCurveIds=own.warningCurveIds.filter(id=>curves.has(id));}
  if(materialRecipe){own.drawing=applySnapshotInheritedFitParameters(recording!.angleGraph!,id,snapshot.angle,materialBases,own.drawing);own.drawing=applySnapshotAuthoredMaterial(state,materialSource,own.drawing);const edited=new Set(Object.values(state.layers).flatMap(layer=>Object.keys(layer.intervals??{})));const material=applySnapshotMaterialRecipe(materialRecipe,snapshot.angle,materialBases,own.drawing,edited,recording?.angleGraph?.materialPartitions,recording?.angleGraph?.materialPathLineages,materialMirror);own.drawing=material.drawing;diagnostics.push(...material.diagnostics.map(message=>({code:'SOURCE_MATERIAL' as const,snapshotId:id,message})));}
  const result:SnapshotEvaluation={snapshotId:id,topologyInputDrawing:input.topologyInputDrawing,source:materialSource,baseDrawing:materialSource,provenance:snapshotDepthAppearanceProvenance(own.drawing,state,input.provenance),appliedTrackIds:[...appliedTrackIds],...own,placementsByLayer:own.placements,layerProvenance:Object.fromEntries(snapshot.layers.map(l=>[l.id,{layerId:l.id,baseSnapshotId:l.kind==='reference'?l.baseSnapshotId:id,sourceLayerId:l.kind==='reference'?l.baseLayerId:l.id}])),authoredTracks:recording?.tracks??[]};let paint:PaintBatch[]|undefined;Object.defineProperty(result,'paintBatches',{enumerable:true,configurable:true,get:()=>{if(!paint){context.count('paint',id);paint=snapshotPaintBatches(workspace,snapshot,result.drawing,result.provenance);}return paint;}});visiting.delete(id);context.snapshotValues.set(localKey,result);persistent.prepared.set(localKey,result);if(recording?.angleGraph?.mesh.vertices.some(vertex=>vertex.snapshotId===id))context.count('basis',id);return result;
 };return resolve(snapshotId,true);
}
/** Retained as an explicit error boundary for callers of the retired pair API. */
export function resolveEndpointPairBasis(_workspace:RecordingSnapshotWorkspace,_recordingId:string,_options:SnapshotEvaluationOptions={}):SnapshotEndpointPairBasis {
 throw Error(RECORDING_RETIRED_MESSAGE);
}
const structurePreparationCaches=new InputCache<PreparedSnapshotCoverageStructure>(256);
const controlGeometryProducts=new InputCache<SnapshotCoverageEvaluation>(2048);
/** Same complete semantic key as the pinned product map; bridges equivalent
 * immutable replay/commit wrappers without retaining discarded contexts. */
const completeSurfaceProducts=new InputCache<SnapshotEvaluation>(512);
const membershipPreparationCaches=new InputCache<SnapshotInputParent>(1024);
const mirrorSurfacePreparationCaches=new WeakMap<RecordingSnapshotWorkspace['library'],InputCache<SnapshotSurfaceMirrorContext>>();
/** The controls at a real Recorder vertex are exactly this resolved basis.
 * Keep its saved compatibility angle, current draft and mirror/material parents
 * identical for runtime sampling and control-target replay. Surface visibility
 * recipes change only visibility flags after these controls are resolved. */
function resolveRecordingSnapshotBasisInContext(context:RecordingContext,recording:SnapshotRecording,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const workspace=context.workspace;
 const vertex=recording.angleGraph?.mesh.vertices.find(value=>value.snapshotId===snapshotId),snapshot=workspace.snapshots.find(value=>value.id===snapshotId);
 if(!vertex||!snapshot)throw Error(`Missing real snapshot ${snapshotId}.`);
 return resolveSnapshotInContext(context,snapshot.id,{...options,snapshotId:snapshot.id,angle:snapshot.angle,liveBasisDrafts:options.useDraft!==false,useDraft:options.useDraft!==false&&(snapshotSurfaceOwnsBasisDraft(recording.angleGraph,snapshotId)||recording.angle.x===vertex.angle.x&&recording.angle.y===vertex.angle.y),tolerance:options.tolerance??recording.tolerance});
}
function evaluateTriangulatedRecording(context:RecordingContext,recording:SnapshotRecording,options:SnapshotEvaluationOptions):SnapshotEvaluation {
 const workspace=context.workspace,graph=recording.angleGraph;if(!graph)throw Error('Triangulated recording has no angle graph.');
 const requested=options.angle??recording.angle,controls=options.products==='controls';
 if(![requested.x,requested.y].every(value=>Number.isFinite(value)&&value>=-90&&value<=90))throw Error('Recording angle must be finite and within −90…90.');
 if(!graph.mesh.vertices.length)throw Error('Recording has no real snapshot. Create one to begin editing.');
 const effectiveGraph=context.effectiveGraph(recording,options.useDraft!==false),mirror=recordingViewMirrorRelation(workspace,recording),positive=!!mirror&&requested.x>0,prepared=context.coverage(recording,positive),locations=prepared.locations(requested),demand=snapshotSurfaceDemand(effectiveGraph,locations,mirror?.zeroSnapshotId,!controls),vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.snapshotId,vertex]));
 const fallback=recording.activeSnapshotId??graph.mesh.vertices[0].snapshotId;if(!locateSnapshotSimplex(graph.mesh,requested))demand.add(fallback);
 // A real vertex's visibility recipe may reference other saved controls.
 for(const location of locations)if(location.kind==='vertex'){const recipe=graph.visibilityBasisRecipes?.[location.snapshotIds[0]];if(recipe&&!controls)for(const id of snapshotVisibilityRecipeDependencies(recipe))demand.add(id);}
 if(positive&&mirror)demand.add(mirror.zeroSnapshotId);
 const angleFor=(id:string)=>vertices.get(id)!.angle;
 const basisOptions=(id:string):SnapshotEvaluationOptions=>{const vertex=vertices.get(id)!,snapshot=context.index.snapshots.get(id)!;return {...options,snapshotId:id,angle:snapshot.angle,liveBasisDrafts:options.useDraft!==false,useDraft:options.useDraft!==false&&(snapshotSurfaceOwnsBasisDraft(graph,id)||recording.angle.x===vertex.angle.x&&recording.angle.y===vertex.angle.y),tolerance:options.tolerance??recording.tolerance};};
 const basisKey=[...demand].map(id=>[id,context.plan(id,basisOptions(id),true).valueKey]);
 const responseFrames=options.useDraft===false?[]:(graph.correctionFrames??[]).filter(frame=>frame.edgeResponses||frame.triangleResponses||frame.responseExpressions).map(frame=>[frame.id,frame.status,frame.edgeResponses,frame.triangleResponses,frame.responseExpressions]),responseKey=[graph.edgeResponses,graph.triangleResponses,graph.responseExpressions,responseFrames];
 const geometryDemand=snapshotSurfaceDemand(effectiveGraph,locations,mirror?.zeroSnapshotId,false);if(positive&&mirror)geometryDemand.add(mirror.zeroSnapshotId);
 const geometryPolicy=evaluationOptionsKey({...options,angle:requested,useDraft:false,liveBasisDrafts:false,diagnostics:'preview',validationSamples:undefined,products:'controls'});
 const geometryKey=semanticKey(['control-geometry',graph.mesh,[...geometryDemand].map(id=>[id,context.plan(id,basisOptions(id),true).valueKey]),responseKey,requested,geometryPolicy]);
 const lineageKey=semanticKey(['control-lineage',recording.id,graph.mesh,prepared,requested,geometryPolicy]);
 const surfaceKey=(quality=options.diagnostics)=>semanticKey(['angle-surface',recording.id,graph.mesh,basisKey,responseKey,controls?null:[snapshotPropertyResponsesCacheKey(effectiveGraph),graph.materialRecipes,graph.visibilityRecipes,graph.materialPartitions,graph.materialPathLineages],requested,evaluationOptionsKey({...options,angle:requested,diagnostics:quality})]);
 const key=surfaceKey(),known=context.surfaceValues.get(key);if(known)return known;

 const native=new Map<string,SnapshotEvaluation>(),reflected=new Map<string,SnapshotEvaluation>();
 const base=(id:string,positiveSide=positive):SnapshotEvaluation=>{
  let value=native.get(id);if(!value){value=context.resolveBasis(recording.id,id,options);native.set(id,value);}
  if(!positiveSide||!mirror||angleFor(id).x!==0)return value;
  let result=reflected.get(id);if(!result){const zero=base(mirror.zeroSnapshotId,false);result=prepareViewMirrorInput(value,zero,id,snapshotViewMirrorOptions(workspace,recording,zero,value));reflected.set(id,result);}return result;
 };
 const refs=[...demand].map(id=>({snapshotId:id,drawing:base(id).drawing,angle:angleFor(id)}));
 const makeMirror=(ids:readonly string[])=>{
  if(!mirror)return undefined;const zero=base(mirror.zeroSnapshotId,false),sources=ids.map(id=>base(id,false)),mirrorKey=semanticKey(['mirror',recording.id,graph.mesh,sources.map(resultIdentity),responseKey,snapshotPropertyResponsesCacheKey(effectiveGraph),graph.materialRecipes,graph.materialPartitions,graph.materialPathLineages]);
  let cache=mirrorSurfacePreparationCaches.get(workspace.library);if(!cache){cache=new InputCache(64);mirrorSurfacePreparationCaches.set(workspace.library,cache);}let value=cache.get(mirrorKey);if(!value){value=prepareSnapshotViewMirrorSurface(effectiveGraph,sources.map(source=>({snapshotId:source.snapshotId,drawing:source.drawing,angle:angleFor(source.snapshotId)})),zero.drawing,current=>snapshotViewMirrorOptions(workspace,recording,zero,copySnapshotEvaluation(zero,{drawing:current})));cache.set(mirrorKey,value);}return value;
 };
 const mirrorContext=positive?makeMirror([...demand]):undefined,prior=completeSurfaceProducts.get(key)??context.inheritedSurface(key)??(options.diagnostics==='preview'?(completeSurfaceProducts.get(surfaceKey('full'))??context.inheritedSurface(surfaceKey('full'))):undefined);
 let sampled=context.geometryValues.get(geometryKey)??controlGeometryProducts.get(geometryKey);
 if(!sampled&&prior)sampled={requestedAngle:requested,normal:prior.angleSurface?.simplex?{drawing:prior.drawing,simplex:prior.angleSurface.simplex,diagnostics:[],nodeAuthorities:new Map(Object.entries(prior.angleSurface.nodeAuthorities))}:undefined,outsideCurves:prior.angleSurface?.outsideCurves??[],diagnostics:prior.diagnostics.filter(issue=>issue.code==='POSE').map(issue=>issue.message)};
 if(!sampled){context.count('surfaceSample');const geometryRefs=[...geometryDemand].map(id=>({snapshotId:id,drawing:base(id).drawing,angle:angleFor(id)})),lineage=context.inheritedGeometry(lineageKey,recording.id);sampled=prepared.evaluate(requested,id=>({snapshotId:id,drawing:base(id).drawing,angle:angleFor(id)}),location=>createSnapshotSurfaceValueSampler(effectiveGraph,location,geometryRefs,mirrorContext,{immutableInputs:true,onPrepare:()=>context.count('responseProgram')}),{immutableInputs:true,onGeometryPrepare:()=>context.count('simplexProgram'),...lineage});controlGeometryProducts.set(geometryKey,sampled);context.geometryValues.set(geometryKey,sampled);}else if(!prior)context.geometryValues.set(geometryKey,sampled);
 context.geometryLineages.set(lineageKey,sampled);

 const normal=sampled.normal,active=normal?.simplex.snapshotIds.map(id=>base(id))??[],selected=active.length?active[dominantSnapshotBasis(active.map(value=>({snapshotId:value.snapshotId,angle:angleFor(value.snapshotId)})),normal!.simplex.geometricWeights)]:base(fallback);
 const role:SnapshotAngleSurfaceEvaluation['role']=!normal?'outside':normal.simplex.kind==='vertex'?'basis':'correction';
 let allBases:SnapshotEvaluation[]|undefined,positiveBases:SnapshotEvaluation[]|undefined,inspectionMirror:SnapshotSurfaceMirrorContext|undefined;
 const surface:SnapshotAngleSurfaceEvaluation={role,coordinateSpace:'final',...(normal?{simplex:normal.simplex}:{}),bases:active,
  get allBases(){return allBases??=graph.mesh.vertices.map(vertex=>base(vertex.snapshotId,false));},
  get positiveBases(){return mirror?(positiveBases??=graph.mesh.vertices.map(vertex=>base(vertex.snapshotId,true))):undefined;},
  get mirrorContext(){
   if(!mirror)return undefined;
   const forLocations=(locations:SnapshotSimplexLocation[])=>{const ids=snapshotSurfaceDemand(effectiveGraph,locations,mirror.zeroSnapshotId,true);ids.add(mirror.zeroSnapshotId);return makeMirror(graph.mesh.vertices.filter(vertex=>ids.has(vertex.snapshotId)).map(vertex=>vertex.snapshotId));};
   return inspectionMirror??={sample:(location,weights)=>{const at=location.vertexIds.reduce((sum,id,index)=>{const vertex=graph.mesh.vertices.find(vertex=>vertex.id===id)!;return sum+vertex.angle.x*weights[index];},0);if(at<=0)return undefined;return forLocations([{...location,geometricWeights:[...weights]}])?.sample(location,weights);},material:(location,drawing)=>{const locations='angle' in location?[location.angle,...location.corners].flatMap(angle=>{const at=locateSnapshotSimplex(graph.mesh,angle);return at?[at]:[];}):[location];return forLocations(locations)?.material?.(location,drawing);}};
  },
  requiredBases:refs.map(value=>base(value.snapshotId)),
  responseGraph:effectiveGraph,nodeAuthorities:Object.fromEntries(normal?.nodeAuthorities??[]),outsideCurves:sampled.outsideCurves};
 const diagnostics:SnapshotDiagnostic[]=prior?[...prior.diagnostics]:[...active.flatMap(value=>value.diagnostics),...sampled.diagnostics.map(message=>({code:'POSE' as const,message}))];
 if(role==='basis'){
  const recipe=controls?undefined:graph.visibilityBasisRecipes?.[selected.snapshotId],bases=refs.map(value=>base(value.snapshotId));
  const drawing=prior?.drawing??(recipe?applySnapshotVisibilityState(evaluateSnapshotVisibilityRecipe(recipe,bases,selected.drawing,requested),selected.state):selected.drawing);
  const result=copySnapshotEvaluation(selected,{drawing,angle:{...requested},angleSurface:surface,diagnostics,paintBatches:[]});
  if(prior)result.paintBatches=prior.paintBatches;else if(controls)result.paintBatches=[];else if(recipe||native.get(selected.snapshotId)!==selected){context.count('paint');result.paintBatches=snapshotPaintBatches(workspace,context.index.snapshots.get(selected.snapshotId)!,drawing,result.provenance);}else result.paintBatches=selected.paintBatches;
  context.surfaceValues.set(key,result);completeSurfaceProducts.set(key,result);return result;
 }
 let drawing=prior?.drawing??normal?.drawing??emptyDrawing();
 if(normal&&!controls&&!prior){
  context.count('material');const material=evaluateSnapshotSurfaceMaterial(effectiveGraph,normal.simplex,refs,drawing,requested,mirrorContext),visibility=graph.visibilityRecipes?.[normal.simplex.simplexId];
  drawing=visibility?evaluateSnapshotVisibilityRecipe(visibility,refs.map(value=>base(value.snapshotId)),material.drawing,requested):material.drawing;
  diagnostics.push(...material.diagnostics.map(message=>({code:'SOURCE_MATERIAL' as const,message})));
 }
 const snapshot=context.index.snapshots.get(selected.snapshotId)!;
 const result=copySnapshotEvaluation(selected,{paintBatches:[],diagnosticStage:(active.length?active:[selected]).every(value=>value.diagnosticStage==='full')?'full':'preview',angle:{...requested},drawing,preShapeDrawing:drawing,prePlacementDrawing:drawing,preElementPlacementDrawing:drawing,elementPlacements:{},angleSurface:surface,diagnostics,fitDiagnostics:[],warningCurveIds:[],maxError:Math.max(...active.map(value=>value.maxError),0),conflictingNodeIds:[],intervalTransportErrors:active.flatMap(value=>value.intervalTransportErrors)});
 if(prior)result.paintBatches=prior.paintBatches;else if(controls)result.paintBatches=[];else{context.count('paint');result.paintBatches=snapshotPaintBatches(workspace,snapshot,drawing,result.provenance);}context.surfaceValues.set(key,result);completeSurfaceProducts.set(key,result);return result;
}
export interface PreparedRecordingCounters {
 validation:number;dependencyIndex:number;membershipSignature:number;membershipStructure:number;snapshotInput:number;snapshotState:number;ownGeometry:number;basis:number;coverageStructure:number;surfaceSample:number;material:number;paint:number;responseProgram:number;simplexProgram:number;
 bySnapshot:Record<string,Partial<Record<'snapshotInput'|'snapshotState'|'ownGeometry'|'basis'|'paint',number>>>;
}
export interface PreparedSnapshotSurfaceTargetEditOptions {
 angle:Angle;frameId:string;
 controlPlan?:DrawingControlEditPlan;
 /** Coupled basis corrections solve protected angles in their existing draft. */
 preserveDraftOwner?:boolean;
}
export interface PreparedRecordingContext {
 readonly workspace:RecordingSnapshotWorkspace;readonly counters:PreparedRecordingCounters;
 resolveSnapshot(snapshotId:string,options?:SnapshotEvaluationOptions):SnapshotEvaluation;
 resolveBasis(recordingId:string,snapshotId:string,options?:SnapshotEvaluationOptions):SnapshotEvaluation;
 sample(recordingId:string,options?:SnapshotEvaluationOptions):SnapshotEvaluation;
 sampleMany(recordingId:string,requests:readonly SnapshotEvaluationOptions[]):SnapshotEvaluation[];
 /** Solve and verify through this context's canonical complete control product. */
 prepareSurfaceTargetEdit(recordingId:string,current:SnapshotEvaluation,wanted:DrawingDocument,options:PreparedSnapshotSurfaceTargetEditOptions):SnapshotSurfaceTargetEditResult;
 /** The immutable before context itself is the gesture's pinned baseline. */
 beginGesture():PreparedRecordingContext;
 fork(workspace:RecordingSnapshotWorkspace,changes?:PreparedRecordingChanges):PreparedRecordingContext;
}
type SnapshotPlan={key:string;valueKey:string;options:SnapshotEvaluationOptions;recording?:SnapshotRecording;originalDependencies:readonly string[]};
const semanticKeys=new Map<string,string>();let nextSemanticKey=1;
const semanticKey=(value:unknown):string=>{const text=JSON.stringify(value);let key=semanticKeys.get(text);if(!key){key=String(nextSemanticKey++);if(semanticKeys.size>=32768)semanticKeys.delete(semanticKeys.keys().next().value!);semanticKeys.set(text,key);}return key;};
interface SharedStructuralProducts {memberships:Map<string,{key:string;input:SnapshotInputParent}>;coverage:Map<string,PreparedSnapshotCoverageStructure>}
const structuralProductCaches=new WeakMap<RecordingSnapshotWorkspace['library'],InputCache<SharedStructuralProducts>>();
const dependencyPlanCaches=new WeakMap<RecordingSnapshotWorkspace['library'],InputCache<PreparedSnapshotDependencyIndex>>();
const contextEvaluations=new WeakMap<SnapshotEvaluation,PreparedRecordingContext>();
const evaluationRequests=new WeakMap<SnapshotEvaluation,SnapshotEvaluationOptions>();
export const preparedRecordingOptionsForEvaluation=(evaluation:SnapshotEvaluation):SnapshotEvaluationOptions|undefined=>{const options=evaluationRequests.get(evaluation);return options?{...options,...(options.angle?{angle:{...options.angle}}:{})}:undefined;};
export const preparedRecordingContextForEvaluation=(evaluation:SnapshotEvaluation):PreparedRecordingContext|undefined=>contextEvaluations.get(evaluation);
const recordingContexts=new WeakMap<RecordingSnapshotWorkspace,{immutable?:{context:RecordingContext;revision:string};mutable?:{context:RecordingContext;fingerprint:string}}>();
const immutableWorkspaceRevision=(workspace:RecordingSnapshotWorkspace):string=>semanticKey([immutableIdentity(workspace.library),workspace.snapshots.map(snapshot=>[snapshot.id,immutableIdentity(snapshot),immutableIdentity(snapshot.draft),immutableIdentity(snapshot.deformation)]),workspace.recordings.map(recording=>[recording.id,recording.angle.x,recording.angle.y,recording.tolerance,recording.activeSnapshotId,immutableIdentity(recording.angleGraph),immutableIdentity(recording.tracks),immutableIdentity(recording.snapshotIds)])]);
const emptyCounters=():PreparedRecordingCounters=>({validation:0,dependencyIndex:0,membershipSignature:0,membershipStructure:0,snapshotInput:0,snapshotState:0,ownGeometry:0,basis:0,coverageStructure:0,surfaceSample:0,material:0,paint:0,responseProgram:0,simplexProgram:0,bySnapshot:{}});

const evaluationStageTotals=Object.fromEntries(Object.keys(emptyCounters()).filter(key=>key!=='bySnapshot').map(key=>[key,0])) as Omit<PreparedRecordingCounters,'bySnapshot'>;
/** Cumulative actual stage executions across all candidate contexts. */
export const getRecordingEvaluationStageTotals=()=>({...evaluationStageTotals});

/** An immutable, validated dependency revision. Values are pinned here rather
 * than in the small display-frame LRU. A fork can borrow any unaffected value
 * from its frozen parent while keeping its own products and sample scratch. */
class RecordingContext implements PreparedRecordingContext {
 readonly counters=emptyCounters();readonly index:PreparedSnapshotDependencyIndex;readonly cache:EvaluationCache;readonly dependencyRevision:string;
 readonly snapshotValues=new Map<string,SnapshotEvaluation>();readonly surfaceValues=new Map<string,SnapshotEvaluation>();readonly geometryValues=new Map<string,SnapshotCoverageEvaluation>();readonly geometryLineages=new Map<string,SnapshotCoverageEvaluation>();
 private effectiveGraphs=new Map<string,NonNullable<SnapshotRecording['angleGraph']>>();private coverageValues=new Map<string,PreparedSnapshotCoverageStructure>();private originalKeys=new Map<string,string>();private plans=new Map<string,SnapshotPlan>();private planning=new Set<string>();private memberships=new Map<string,{key:string;input:SnapshotInputParent}>();
 constructor(readonly workspace:RecordingSnapshotWorkspace,readonly defaults:SnapshotEvaluationOptions,readonly before?:RecordingContext){
  this.defaults={immutableInputs:defaults.immutableInputs};
  this.workspace=defaults.immutableInputs?workspace:structuredClone(workspace);workspace=this.workspace;
  assertRecordingWorkspaceActive(workspace);this.dependencyRevision=preparedSnapshotDependencyRevision(workspace,immutableIdentity);
  let plans=dependencyPlanCaches.get(workspace.library);if(!plans){plans=new InputCache(64);dependencyPlanCaches.set(workspace.library,plans);}
  const reusable=defaults.immutableInputs?(before?.dependencyRevision===this.dependencyRevision?before.index:plans.get(this.dependencyRevision)):undefined;
  if(reusable)this.index=indexPreparedSnapshotDependencies(workspace,reusable);
  else{validateSnapshotGraph(workspace);this.count('validation');this.index=indexPreparedSnapshotDependencies(workspace);this.count('dependencyIndex');}
  if(defaults.immutableInputs)plans.set(this.dependencyRevision,this.index);
  if(defaults.immutableInputs){
   const structureKey=semanticKey([workspace.snapshots.map(snapshot=>[snapshot.id,snapshot.parentSnapshotId,immutableIdentity(snapshot.layers),immutableIdentity(snapshot.memberSources),immutableIdentity(snapshot.nodeAliases),immutableIdentity(snapshot.nodeForks),immutableIdentity(snapshot.relations),immutableIdentity(snapshot.objectLocks),immutableIdentity(snapshot.source),immutableIdentity(snapshot.inputMirror)]),workspace.recordings.map(recording=>[recording.id,recording.snapshotIds,immutableIdentity(recording.angleGraph?.mesh),recordingViewMirrorRelation(workspace,recording)])]);
   let structures=structuralProductCaches.get(workspace.library);if(!structures){structures=new InputCache(64);structuralProductCaches.set(workspace.library,structures);}let shared=structures.get(structureKey);
   if(!shared){shared={memberships:this.memberships,coverage:this.coverageValues};structures.set(structureKey,shared);}else{this.memberships=shared.memberships;this.coverageValues=shared.coverage;}
  }
  this.cache=evaluationCache(workspace,defaults.immutableInputs);
 }
 count(stage:Exclude<keyof PreparedRecordingCounters,'bySnapshot'>,snapshotId?:string):void {
  this.counters[stage]++;evaluationStageTotals[stage]++;
  if(snapshotId&&['snapshotInput','snapshotState','ownGeometry','basis','paint'].includes(stage)){const values=this.counters.bySnapshot[snapshotId]??={};const name=stage as keyof typeof values;values[name]=(values[name]??0)+1;}
 }
 plan(id:string,requested:SnapshotEvaluationOptions,root=false,visibilitySource=false):SnapshotPlan {
  const snapshot=this.index.snapshots.get(id);if(!snapshot)throw new SnapshotResolutionError({code:'MISSING_SNAPSHOT',snapshotId:id,message:`Snapshot ${id} is missing.`});
  const recording=this.index.recordingForSnapshot.get(id),graph=recording?.angleGraph,live=requested.liveBasisDrafts??requested.useDraft!==false,binding=graph?.mesh.vertices.find(vertex=>vertex.snapshotId===id)?.angle;
  const options:SnapshotEvaluationOptions=root?{...requested,angle:requested.angle??snapshot.angle,liveBasisDrafts:live,products:'display'}:{angle:snapshot.angle,useDraft:live&&(snapshotSurfaceOwnsBasisDraft(graph,id)||visibilitySource&&!!binding&&recording!.angle.x===binding.x&&recording!.angle.y===binding.y),liveBasisDrafts:live,diagnostics:requested.diagnostics,tolerance:requested.tolerance,immutableInputs:requested.immutableInputs,products:'display'};
  if(!snapshot.draft&&(recording?.mode==='triangulated'||!recording?.tracks.some(track=>track.draft)))options.useDraft=false;
  const localKey=JSON.stringify([id,evaluationOptionsKey(options)]),known=this.plans.get(localKey);if(known)return known;
  if(this.planning.has(localKey))throw new SnapshotResolutionError({code:'SNAPSHOT_CYCLE',snapshotId:id,message:`Snapshot ${id} contains a dependency cycle.`});this.planning.add(localKey);
  const token=(value:unknown)=>requested.immutableInputs&&value!==null&&typeof value==='object'?immutableIdentity(value as object):value;
  const material=graph?.materialBasisRecipes?.[id],visibility=graph?.visibilityBasisRecipes?.[id],mirror=recording&&recordingViewMirrorRelation(this.workspace,recording),effectiveGraph=graph&&!live?{...graph,correctionFrames:graph.correctionFrames?.filter(frame=>frame.status!=='draft')}:graph;
  const dependencies=new Map<string,string>();const add=(source:string,visible=false)=>{const key=JSON.stringify([source,visible]);if(!dependencies.has(key))dependencies.set(key,this.plan(source,requested,false,visible).key);};
  if(material)for(const source of snapshotMaterialRecipeDependencies(material,graph?.mesh,effectiveGraph,snapshot.angle))add(source,live);
  if(visibility)for(const source of snapshotVisibilityRecipeDependencies(visibility))add(source,true);
  for(const layer of snapshot.layers)if(layer.kind==='reference'&&this.index.snapshots.has(layer.baseSnapshotId))add(layer.baseSnapshotId);
  for(const source of Object.values(snapshot.memberSources??{}))if(this.index.snapshots.has(source))add(source);
  if(mirror?.targetSnapshotId===id){add(mirror.sourceSnapshotId,live);add(mirror.zeroSnapshotId,live);}
  else if(snapshot.parentSnapshotId&&(snapshot.parentLayers||snapshot.inputMirror))add(snapshot.parentSnapshotId);
  const drafts=options.useDraft!==false,own=[snapshot.id,snapshot.name,snapshot.kind,snapshot.angle,token(snapshot.layers),token(snapshot.memberSources),token(snapshot.relations),token(snapshot.nodeAliases),token(snapshot.nodeForks),token(snapshot.objectLocks),token(snapshot.source),token(snapshot.deformation),token(snapshot.inheritedState),token(snapshot.authored),snapshot.parentSnapshotId,token(snapshot.parentLayers),token(snapshot.inputMirror),drafts?token(snapshot.draft):null];
  const originalIds=new Set(snapshot.layers.flatMap(layer=>[...(layer.kind==='original'?layer.items:[]),...layer.membership?.addElementIds??[]]).filter(id=>!snapshot.memberSources?.[id]));
  for(const fork of Object.values(snapshot.nodeForks??{}))originalIds.add((fork.source??fork).curveId);
  const libraryInputs=[...originalIds].map(id=>{const curve=this.workspace.library.curves[id];return [id,token(curve),...(curve?.nodes??[]).map(id=>token(this.workspace.library.nodes[id])),token(this.workspace.library.fills[id]),token(this.workspace.library.offsets[id])];});
  const tracks=recording?.mode==='triangulated'?null:recording?.tracks.map(track=>{const {draft,...saved}=track;return drafts?token(track):requested.immutableInputs?[track.id,track.channel,track.targetId,track.elementId,token(track.keys),track.interpolation,track.channel==='interval'?token(track.materialIssue):null]:saved;});
  const recipeKeys=[token(material),token(visibility),material?token(graph?.mesh):null,material?token(graph?.responseExpressions):null,material?token(graph?.materialPartitions):null,material?token(graph?.materialPathLineages):null,snapshotMaterialRecipeHasMirror(material)?[token(graph?.edgeResponses),token(graph?.triangleResponses),token(graph?.responseExpressions),live?token(graph?.correctionFrames):null,token(graph?.materialRecipes),effectiveGraph&&snapshotPropertyResponsesCacheKey(effectiveGraph)]:null,mirror?.targetSnapshotId===id?mirror:null];
  const materialIssues=[...Object.values(snapshot.inheritedState?.intervalMaterialIssues??{}),...Object.values(snapshot.deformation.intervalMaterialIssues??{}),...(drafts?Object.values(snapshot.draft?.deformation.intervalMaterialIssues??{}):[]),...(recording?.mode!=='triangulated'?recording?.tracks.flatMap(track=>track.channel==='interval'&&track.materialIssue?[track.materialIssue]:[])??[]:[])],originalDependencies=[...new Set(materialIssues.map(issue=>issue.sourceSnapshotId))].map(source=>this.originalDependencyKey(source));
  const key=semanticKey([own,libraryInputs,tracks,recipeKeys,originalDependencies,[...dependencies.values()],evaluationOptionsKey({...options,liveBasisDrafts:false})]),plan:SnapshotPlan={key,valueKey:key,options,recording,originalDependencies};this.planning.delete(localKey);this.plans.set(localKey,plan);
  for(let parent=this.before;parent;parent=parent.before){const value=parent.snapshotValues.get(plan.key);if(value){this.snapshotValues.set(plan.key,value);break;}}
  // Full validation uses the identical fitted controls. It can satisfy a later
  // preview request without discarding its stronger, truthfully labelled report.
  // The converse never applies, and all fit/tolerance/space options still match.
  if(options.diagnostics==='preview'&&!this.snapshotValues.has(plan.key)&&!this.cache.prepared.get(plan.key)){
   const full=this.plan(id,{...requested,diagnostics:'full'},root,visibilitySource),value=this.snapshotValues.get(full.key)??this.cache.prepared.get(full.key);
   if(value){plan.valueKey=full.valueKey;this.snapshotValues.set(plan.key,value);}
  }
  return plan;
 }
 /** Suspended interval channels inspect original material signatures without
  * numerically resolving that source. They can reach outside layer ancestry. */
 originalDependencyKey(id:string):string {
  const known=this.originalKeys.get(id);if(known)return known;const snapshot=this.index.snapshots.get(id),token=(value:object|undefined)=>this.defaults.immutableInputs?immutableIdentity(value):value;
  const ids=snapshot?.layers.flatMap(layer=>layer.kind==='original'?layer.items:[])??[],library=this.workspace.library;
  const key=semanticKey(['original-material',id,token(snapshot?.layers),token(snapshot?.relations),token(snapshot?.source),ids.map(id=>{const curve=library.curves[id];return [id,token(curve),...curve?.nodes.map(id=>token(library.nodes[id]))??[],token(library.fills[id]),token(library.offsets[id])];})]);this.originalKeys.set(id,key);return key;
 }
 effectiveGraph(recording:SnapshotRecording,live:boolean):NonNullable<SnapshotRecording['angleGraph']> {const key=JSON.stringify([recording.id,live]);let graph=this.effectiveGraphs.get(key);if(!graph){const source=recording.angleGraph!;graph=live||!source.correctionFrames?.some(frame=>frame.status==='draft')?source:{...source,correctionFrames:source.correctionFrames?.filter(frame=>frame.status!=='draft')};this.effectiveGraphs.set(key,graph);}return graph;}
 /** Coordinate-free structural projection using the same membership/alias/fork
  * assembly as numeric evaluation. No response, cage or coordinate fit runs. */
 membership(id:string):{key:string;input:SnapshotInputParent} {
  const known=this.memberships.get(id);if(known)return known;this.count('membershipSignature');
  const snapshot=this.index.snapshots.get(id);if(!snapshot)throw Error(`Missing snapshot ${id}.`);
  const recording=this.index.recordingForSnapshot.get(id),mirror=recording&&recordingViewMirrorRelation(this.workspace,recording),parentIds=new Set(snapshot.layers.flatMap(layer=>layer.kind==='reference'?[layer.baseSnapshotId]:[]));
  for(const source of Object.values(snapshot.memberSources??{}))parentIds.add(source);
  if(snapshot.parentSnapshotId&&(snapshot.parentLayers||snapshot.inputMirror))parentIds.add(snapshot.parentSnapshotId);
  if(mirror?.targetSnapshotId===id){parentIds.add(mirror.sourceSnapshotId);parentIds.add(mirror.zeroSnapshotId);}
  const parents=new Map([...parentIds].filter(id=>this.index.snapshots.has(id)).map(id=>[id,this.membership(id)])),library=this.workspace.library;
  const ids=new Set(snapshot.layers.flatMap(layer=>[...(layer.kind==='original'?layer.items:[]),...layer.membership?.addElementIds??[]]));for(const fork of Object.values(snapshot.nodeForks??{}))ids.add((fork.source??fork).curveId);
  const key=semanticKey(['membership',id,snapshot.layers,snapshot.memberSources,snapshot.nodeAliases,snapshot.nodeForks,snapshot.relations,snapshot.objectLocks,snapshot.source,snapshot.inputMirror,mirror,[...parents].map(([id,value])=>[id,value.key]),[...ids].map(id=>[id,library.curves[id]?.nodes,library.curves[id]?.nodes.map(id=>!!library.nodes[id]),library.fills[id]?.boundary,library.offsets[id]?.source])]);
  const cached=membershipPreparationCaches.get(key);if(cached){const result={key,input:cached};this.memberships.set(id,result);return result;}
  this.count('membershipStructure');
  const neutral=(drawing:DrawingDocument):DrawingDocument=>({...drawing,nodes:drawing.nodes.map(node=>({...node,position:[0,0]})),curves:drawing.curves.map(curve=>({...curve,handles:[[0,0],[0,0]]}))});
  const inputs=new Map([...parents].map(([id,value])=>[id,value.input]));
  if(mirror?.targetSnapshotId===id){const parent=inputs.get(mirror.sourceSnapshotId)!,zero=inputs.get(mirror.zeroSnapshotId)!;const curvePairs=snapshotViewMirrorCurvePairs(this.workspace,mirror.zeroSnapshotId,snapshot.inputMirror?.curvePairs??[]),options={curvePairs,unpairedGroups:viewMirrorUnpairedCurveGroups(zero.drawing,curvePairs).map(curveIds=>({curveIds,reference:[0,0] as Point2}))};inputs.set(parent.snapshotId,{...parent,drawing:neutral(mirrorViewDrawingPresence(parent.drawing,zero.drawing,options).drawing)});}
  else if(snapshot.inputMirror&&snapshot.parentSnapshotId){const parent=inputs.get(snapshot.parentSnapshotId);if(parent)inputs.set(parent.snapshotId,{...parent,drawing:neutral(mirrorSnapshotDrawing(parent.drawing,snapshot.inputMirror).drawing)});}
  const structuralWorkspace={...this.workspace,library:{...library,nodes:Object.fromEntries(Object.entries(library.nodes).map(([id,node])=>[id,{...node,position:[0,0] as Point2}])),curves:Object.fromEntries(Object.entries(library.curves).map(([id,curve])=>[id,{...curve,handles:[[0,0],[0,0]] as [Point2,Point2]}]))}},value=inputForSnapshot(structuralWorkspace,snapshot,inputs,[]),input:SnapshotInputParent={snapshotId:id,drawing:neutral(value.drawing),provenance:value.provenance,appliedTrackIds:[...value.appliedTrackIds]},result={key,input};membershipPreparationCaches.set(key,input);this.memberships.set(id,result);return result;
 }
 coverage(recording:SnapshotRecording,positive:boolean):PreparedSnapshotCoverageStructure {
  const localKey=JSON.stringify([recording.id,positive]),known=this.coverageValues.get(localKey);if(known)return known;
  const graph=recording.angleGraph!,mirror=recordingViewMirrorRelation(this.workspace,recording),zero=mirror?this.membership(mirror.zeroSnapshotId).input:undefined;
  const members=graph.mesh.vertices.map(vertex=>{const value=this.membership(vertex.snapshotId);let drawing=value.input.drawing;if(positive&&zero&&vertex.angle.x===0)drawing=mirrorViewDrawingPresence(drawing,zero.drawing,(()=>{const curvePairs=snapshotViewMirrorCurvePairs(this.workspace,mirror!.zeroSnapshotId);return {curvePairs,unpairedGroups:viewMirrorUnpairedCurveGroups(zero.drawing,curvePairs).map(curveIds=>({curveIds,reference:[0,0] as Point2}))};})()).drawing;return {snapshotId:vertex.snapshotId,drawing,angle:vertex.angle};});
  const key=semanticKey(['coverage',graph.mesh,members.map(value=>[value.snapshotId,value.drawing.curves.map(curve=>[curve.id,curve.nodes])])]);let structure=structurePreparationCaches.get(key);if(!structure){structure=prepareSnapshotCoverageStructure(graph.mesh,members);structurePreparationCaches.set(key,structure);this.count('coverageStructure');}this.coverageValues.set(localKey,structure);return structure;
 }
 resolveSnapshot(snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {return withDrawingReadScope(()=>resolveSnapshotInContext(this,snapshotId,{...this.defaults,...options}));}
 resolveBasis(recordingId:string,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {return withDrawingReadScope(()=>{const recording=this.index.recordings.get(recordingId);if(!recording)throw Error('Missing recording');return resolveRecordingSnapshotBasisInContext(this,recording,snapshotId,{...this.defaults,...options});});}
 sample(recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
  return withDrawingReadScope(()=>this.sampleInScope(recordingId,options));
 }
 private sampleInScope(recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
  const recording=this.index.recordings.get(recordingId);if(!recording){if(this.index.snapshots.has(recordingId))return this.resolveSnapshot(recordingId,options);throw Error('Missing recording');}
  const request={...this.defaults,...options},result=evaluateTriangulatedRecording(this,recording,request);contextEvaluations.set(result,this);evaluationRequests.set(result,{...request,angle:{...result.angle}});return result;
 }
 inheritedSurface(key:string):SnapshotEvaluation|undefined {for(let context=this.before;context;context=context.before){const value=context.surfaceValues.get(key);if(value)return value;}return undefined;}
 inheritedGeometry(key:string,recordingId:string):{previous:SnapshotCoverageEvaluation;changes:NonNullable<ReturnType<typeof preparedControlChangesBetween>>}|undefined {
  if(!this.defaults.immutableInputs)return;
  for(let context=this.before;context;context=context.before){
   const previous=context.geometryLineages.get(key);if(!previous)continue;
   const changes=preparedControlChangesBetween(context.workspace,this.workspace,recordingId);if(changes)return {previous,changes};
  }
 }
 sampleMany(recordingId:string,requests:readonly SnapshotEvaluationOptions[]):SnapshotEvaluation[]{return withDrawingReadScope(()=>requests.map(options=>this.sample(recordingId,options)));}
 prepareSurfaceTargetEdit(recordingId:string,current:SnapshotEvaluation,wanted:DrawingDocument,options:PreparedSnapshotSurfaceTargetEditOptions):SnapshotSurfaceTargetEditResult {return withDrawingReadScope(()=>{
  const recording=this.index.recordings.get(recordingId),sourceGraph=recording?.angleGraph,surface=current.angleSurface;
  if(!recording||!sourceGraph)throw Error('Missing triangulated recording');
  if(!surface?.simplex||surface.role==='outside')throw new SnapshotSurfaceTargetEditError('SURFACE_OUTSIDE_COVERAGE','This angle is outside saved snapshot coverage. The projected red preview is read-only; return inside coverage to correct controls.');
  const owner=options.preserveDraftOwner?effectiveSnapshotSurfaceResponses(sourceGraph).draft:undefined;
  const graph=owner?{...sourceGraph,correctionFrames:sourceGraph.correctionFrames!.map(frame=>frame===owner?{...frame,angle:{...options.angle}}:frame)}:sourceGraph;
  let replayGraph:SnapshotAngleGraph|undefined;
  const result=prepareSnapshotSurfaceTargetEditWithReplay(graph,surface.simplex,surface.bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:sourceGraph.mesh.vertices.find(vertex=>vertex.snapshotId===base.snapshotId)!.angle})),current.drawing,wanted,{immutableInputs:this.defaults.immutableInputs,angle:options.angle,frameId:options.frameId,allBases:snapshotSurfaceRequiredBases(surface,options.angle),mirror:surface.mirrorContext,controlPlan:options.controlPlan},(candidate,responseControls)=>{
   // Only draft ownership is restored. Keep all accumulated protection outputs
   // in the candidate so later constraints cannot erase earlier corrections.
   replayGraph=owner?{...candidate,correctionFrames:candidate.correctionFrames!.map(frame=>frame.status==='draft'?{...frame,angle:{...owner.angle},basisAdjustment:owner.basisAdjustment}:frame)}:candidate;
   const workspace={...this.workspace,recordings:this.workspace.recordings.map(value=>value===recording?{...value,angleGraph:replayGraph}:value)};
   if(this.defaults.immutableInputs)registerPreparedControlChanges(this.workspace,workspace,recordingId,{structureUnchanged:true,basisControls:new Map(),responseControls});
   return this.fork(workspace).sample(recordingId,{...evaluationRequests.get(current),angle:options.angle,useDraft:true,products:'controls'}).drawing;
  });
  return result.changed?{...result,graph:replayGraph!}:{graph:sourceGraph,changed:false};
 });}
 beginGesture():PreparedRecordingContext{return this;}
 fork(workspace:RecordingSnapshotWorkspace,_changes?:PreparedRecordingChanges):PreparedRecordingContext {
  if(workspace===this.workspace)return this;const known=recordingContexts.get(workspace)??{};if(known.immutable&&this.defaults.immutableInputs&&known.immutable.revision===immutableWorkspaceRevision(workspace))return known.immutable.context;
  const context=new RecordingContext(workspace,this.defaults,this);if(this.defaults.immutableInputs)known.immutable={context,revision:immutableWorkspaceRevision(workspace)};else known.mutable={context,fingerprint:JSON.stringify(workspace)};recordingContexts.set(workspace,known);return context;
 }
}
/** Mutable/import boundaries remain content guarded. Immutable store callers
 * opt in explicitly; changing objects in place after that opt-in is unsupported. */
function recordingContext(workspace:RecordingSnapshotWorkspace,options:SnapshotEvaluationOptions={}):RecordingContext {
 const known=recordingContexts.get(workspace)??{},fingerprint=options.immutableInputs?undefined:JSON.stringify(workspace);
 if(options.immutableInputs&&known.immutable?.revision===immutableWorkspaceRevision(workspace))return known.immutable.context;
 if(!options.immutableInputs&&known.mutable&&known.mutable.fingerprint===fingerprint)return known.mutable.context;
 const context=new RecordingContext(workspace,options);if(options.immutableInputs)known.immutable={context,revision:immutableWorkspaceRevision(workspace)};else known.mutable={context,fingerprint:fingerprint!};recordingContexts.set(workspace,known);return context;
}

const contextPolicies=new WeakMap<RecordingContext,Map<string,PreparedRecordingContext>>();
/** Request defaults belong to this handle, not to the shared dependency session.
 * Public wrappers always pass their own options and cannot inherit a prior
 * caller's draft, truncation or quality policy. */
function contextWithOptions(context:RecordingContext,options:SnapshotEvaluationOptions):PreparedRecordingContext {
 const key=evaluationOptionsKey(options),policies=contextPolicies.get(context)??new Map<string,PreparedRecordingContext>(),known=policies.get(key);if(known)return known;
 const defaults={...options,...(options.angle?{angle:{...options.angle}}:{})};
 const handle:PreparedRecordingContext={workspace:context.workspace,counters:context.counters,
  resolveSnapshot:(id,request)=>context.resolveSnapshot(id,{...defaults,...request}),
  resolveBasis:(recording,id,request)=>context.resolveBasis(recording,id,{...defaults,...request}),
  sample:(recording,request)=>context.sample(recording,{...defaults,...request}),
  sampleMany:(recording,requests)=>context.sampleMany(recording,requests.map(request=>({...defaults,...request}))),
  prepareSurfaceTargetEdit:(recording,current,wanted,request)=>context.prepareSurfaceTargetEdit(recording,current,wanted,request),
  beginGesture:()=>handle,fork:(workspace,changes)=>contextWithOptions(context.fork(workspace,changes) as RecordingContext,defaults)};
 policies.set(key,handle);contextPolicies.set(context,policies);return handle;
}
export function prepareRecordingContext(workspace:RecordingSnapshotWorkspace,options:SnapshotEvaluationOptions={}):PreparedRecordingContext {
 return contextWithOptions(recordingContext(workspace,options),options);
}

/** Compatibility adapter: gestures fork the same domain evaluation kernel. */
export function evaluateSnapshotControlTargetPreview(before:RecordingSnapshotWorkspace,workspace:RecordingSnapshotWorkspace,recordingId:string,_baseline:SnapshotEvaluation):SnapshotEvaluation {
 return prepareRecordingContext(before,{immutableInputs:true,diagnostics:'preview'}).fork(workspace).sample(recordingId,{useDraft:true,diagnostics:'preview'});
}
export function resolveSnapshot(workspace:RecordingSnapshotWorkspace,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 return recordingContext(workspace,options).resolveSnapshot(snapshotId,options);
}
export function resolveRecordingSnapshotBasis(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const context=recordingContext(workspace,options),effective=context.index.recordings.get(recording.id);
 if(effective===recording||!options.immutableInputs&&same(effective,recording))return context.resolveBasis(recording.id,snapshotId,options);
 const fork=context.fork({...workspace,recordings:workspace.recordings.map(value=>value.id===recording.id?recording:value)}) as RecordingContext;return fork.resolveBasis(recording.id,snapshotId,options);
}
export function evaluateRecordingSnapshot(workspace:RecordingSnapshotWorkspace,recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 return recordingContext(workspace,options).sample(recordingId,options);
}
