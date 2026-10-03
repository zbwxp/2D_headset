import {applyLayerDomainPostShape} from './layerCageEvaluation';
import {dominantSnapshotBasis} from './simplexSupport';
import {applySnapshotVisibilityState,evaluateSnapshotVisibilityRecipe,snapshotVisibilityRecipeDependencies} from './visibilityRestriction';
import {displayField,displayPath} from '../drawing/displayIntervals';
import {derivedUses} from '../drawing/roundedJoin';
import {applyLayerDomains} from './layerDomainEvaluation';
import {hasEvaluatedDeformation,evaluatedDeformationDiagnostics,evaluatedMaterialSource,projectEvaluatedGeometry} from '../drawing/evaluatedDeformation';
import {snapshotMaterialPartitionValue} from './materialSplit';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../drawing/affineDrawing';
import {layerDomainMatrices} from './layerDomains';
import {applyAffine2D,affine2DMaxScale,identityAffine2D} from '../geometry/affine2d';
import {intervalPinch} from '../drawing/intervalPinch';
import {snapshotRouteMaterialSource,markSnapshotRouteMaterialInput} from './routeMaterialSource';
import {transportEndpointPairMaterial} from './endpointPairMaterial';
import {applyIntervalEnableFlags} from '../vectorRecording/intervals';
import {applySnapshotMaterialRecipe,evaluateSnapshotMaterialRecipe,snapshotMaterialRecipeDependencies} from './materialRestriction';
import {placeSnapshotElements,retainSnapshotAffines} from './elementPlacement';
import {mirrorSnapshotDrawing,SnapshotMirrorError} from './snapshotMirror';
import {resolveSnapshotLocalMembership} from './localMembership';
import {prepareSnapshotCoverage,type SnapshotCoverageCurvePreview} from './snapshotCoverage';
import {transportSnapshotSimplexMaterial} from './simplexMaterial';
import {blendSnapshotPropertyValues,createSnapshotPropertyResponseSampler,snapshotPropertyResponsesCacheKey} from './propertyResponses';
import {createSnapshotSurfaceValueSampler} from './surfaceTargets';
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
import {sameAngle} from '../vectorRecording/interpolation';
import {applySnapshotNodeAliases} from './nodeAliases';
import {applySnapshotCurveAppearance} from './curveAppearance';
import {endpointPairCompatibility,endpointPairNodeAuthorities,interpolateEndpointPairDrawing,validateSnapshotEndpointPair} from './endpointPair';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotDiagnostic,type SnapshotElementProvenance,type SnapshotRelationCollection,type SnapshotRelationPatch,type Angle,type WarpGrid,type SnapshotPoseTrack,type SnapshotRecording,type SnapshotEndpointResponses} from './model';

export interface SnapshotEvaluationOptions extends SceneEvaluationOptions {snapshotId?:string;/** Trusted store/render callers only: all library, snapshot, key, and draft objects must be immutable. */immutableInputs?:boolean}
export interface SnapshotEvaluation {
 snapshotId:string;source:DrawingDocument;baseDrawing:DrawingDocument;drawing:DrawingDocument;preShapeDrawing:DrawingDocument;prePlacementDrawing:DrawingDocument;preElementPlacementDrawing:DrawingDocument;
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
export interface SnapshotAngleSurfaceEvaluation {
 role:'basis'|'correction'|'outside';coordinateSpace:'final';
 simplex?:SnapshotSimplexLocation;bases:SnapshotEvaluation[];allBases:SnapshotEvaluation[];
 nodeAuthorities:Record<string,string>;outsideCurves:SnapshotCoverageCurvePreview[];
}
export interface SnapshotEndpointPairBasis {start:SnapshotEvaluation;end:SnapshotEvaluation;startSnapshotId:string;endSnapshotId:string}
export interface SnapshotEndpointPairEvaluation extends SnapshotEndpointPairBasis {
 axis:'x';progress:number;role:'start'|'end'|'correction';coordinateSpace:'final';nodeAuthorities:Record<string,string>;
 responses?:SnapshotEndpointResponses;
}
interface SnapshotInput {drawing:DrawingDocument;provenance:SnapshotEvaluation['provenance'];appliedTrackIds:Set<string>}
interface EvaluationCache {
 fingerprint:string;parents:InputCache<SnapshotEvaluation>;frames:InputCache<SnapshotEvaluation>;
 inputs:InputCache<{input:SnapshotInput;diagnostics:SnapshotDiagnostic[]}>;
 originals:InputCache<DrawingDocument|undefined>;
 baseStages:WeakMap<DrawingDocument,InputCache<SceneEvaluation>>;
}
/** Content guards also catch importer/test mutations in place. The archive is
 * deliberately excluded: only live originals and reachable saved state matter. */
const evaluationCaches=new WeakMap<RecordingSnapshotWorkspace['library'],EvaluationCache>();
const canonicalStageDrawings=new WeakMap<DrawingDocument,DrawingDocument>();
const immutableIdentities=new WeakMap<object,number>();let nextImmutableIdentity=1;const immutableIdentity=(value:object|undefined)=>{if(!value)return 0;let id=immutableIdentities.get(value);if(id===undefined){id=nextImmutableIdentity++;immutableIdentities.set(value,id);}return id;};
const immutableTrackStrings=new WeakMap<SnapshotRecording['tracks'],Map<boolean,string>>();
const resultIdentities=new WeakMap<SnapshotEvaluation,number>();let nextResultIdentity=1;
const resultIdentity=(result:SnapshotEvaluation)=>{let id=resultIdentities.get(result);if(id===undefined){id=nextResultIdentity++;resultIdentities.set(result,id);}return id;};
function evaluationCache(workspace:RecordingSnapshotWorkspace,immutable=false):EvaluationCache {
 const known=evaluationCaches.get(workspace.library);if(immutable&&known)return known;const fingerprint=JSON.stringify(workspace.library);if(known?.fingerprint===fingerprint)return known;
 const cache:EvaluationCache={fingerprint,parents:new InputCache(24),frames:new InputCache(32),inputs:new InputCache(24),originals:new InputCache(16),baseStages:new WeakMap()};evaluationCaches.set(workspace.library,cache);return cache;
}
function cachedOriginal(workspace:RecordingSnapshotWorkspace,id:string):DrawingDocument|undefined {
 const cache=evaluationCaches.get(workspace.library),snapshot=workspace.snapshots.find(s=>s.id===id);if(!cache||!snapshot)return materializeOriginalSnapshot(workspace,id);
 const key=JSON.stringify(snapshot),known=cache.originals.get(key);if(known)return known;return cache.originals.set(key,materializeOriginalSnapshot(workspace,id));
}
const evaluationOptionsKey=(options:SnapshotEvaluationOptions)=>JSON.stringify([options.angle,options.useDraft!==false,options.stopAtWarpId??null,!!options.omitPlacements,!!options.omitShapes,options.tolerance??1/250,options.fitSamples??64,options.diagnostics??'full',options.validationSamples??1024]);
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
 if(!snapshot.inputMirror||snapshot.parentSnapshotId!==parent.snapshotId)return parent;
 const mirror=snapshot.inputMirror,curves=new Set(parent.drawing.curves.map(curve=>curve.id)),nodes=new Set(parent.drawing.nodes.map(node=>node.id));
 const sources=new Set(Object.values(parent.provenance).map(value=>value.sourceSnapshotId));
 const diagnostics:SnapshotDiagnostic[]=[],pairs=[...mirror.curvePairs],used=new Set(pairs.flatMap(pair=>[pair.a,pair.b]));
 const axisNodes=new Set(mirror.axisNodeIds??[]);
 for(const source of workspace.snapshots.filter(value=>sources.has(value.id)&&value.source)){
  const metadata=source.source!;
  if(metadata.mirrorAxisX!==undefined&&metadata.mirrorAxisX!==mirror.axisX)diagnostics.push({code:'INPUT_MIRROR',snapshotId:snapshot.id,message:`Source ${source.name} uses mirror axis ${metadata.mirrorAxisX}; this snapshot keeps its explicitly selected axis ${mirror.axisX}.`});
  for(const pair of metadata.mirrorEditing?.curvePairs??[]){if(!curves.has(pair.a)&&!curves.has(pair.b))continue;if(!used.has(pair.a)&&!used.has(pair.b)){pairs.push(pair);used.add(pair.a);used.add(pair.b);}}
  for(const id of metadata.mirrorEditing?.axisNodeIds??[])axisNodes.add(id);
 }
 const activePairs=pairs.filter(pair=>{const a=curves.has(pair.a),b=curves.has(pair.b);if(a!==b)diagnostics.push({code:'INPUT_MIRROR',snapshotId:snapshot.id,elementId:a?pair.a:pair.b,message:`Mirror pair ${pair.id} is incomplete in this parent; its available curve keeps its canonical identity.`});return a&&b;});
 const options={axisX:mirror.axisX,curvePairs:activePairs,axisNodeIds:[...axisNodes].filter(id=>nodes.has(id))},key=JSON.stringify([snapshot.id,options,diagnostics]);
 const cache=mirroredParentInputs.get(parent)??new InputCache<SnapshotEvaluation>(8),known=cache.get(key);if(known)return known;
 try{
  const reflected=mirrorSnapshotDrawing(parent.drawing,options),correspondence=reflected.correspondence;
  const idMap:Record<string,string>={...correspondence.nodes,...Object.fromEntries(Object.entries(correspondence.curves).map(([id,value])=>[id,value.id])),...correspondence.fills,...correspondence.offsets,...correspondence.layers},map=(id:string)=>idMap[id]??id;
  const composedMaps=new Map<Record<string,string>,Record<string,string>>();
  const compose=(previous:Record<string,string>|undefined)=>{if(!previous)return idMap;let result=composedMaps.get(previous);if(!result){result=Object.fromEntries(Object.entries(previous).map(([sourceId,currentId])=>[sourceId,map(currentId)]));composedMaps.set(previous,result);}return result;};
  const provenance=Object.fromEntries(Object.entries(parent.provenance).map(([id,value])=>{const mapped=map(id);return [mapped,{...value,elementId:mapped,materialContext:{elementId:value.materialContext?.elementId??value.elementId,idMap:compose(value.materialContext?.idMap)}}];}));
  const result={...parent,drawing:reflected.drawing,provenance,diagnostics:[...parent.diagnostics,...diagnostics,...reflected.diagnostics.map(issue=>({code:'INPUT_MIRROR' as const,snapshotId:snapshot.id,elementId:issue.entityId,message:issue.message}))]};
  mirroredParentInputs.set(parent,cache);return cache.set(key,result);
 }catch(cause){throw new SnapshotResolutionError({code:'INPUT_MIRROR',snapshotId:snapshot.id,message:cause instanceof SnapshotMirrorError?`${cause.code}: ${cause.message}`:cause instanceof Error?cause.message:String(cause)});}
}
function inputForSnapshot(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,parents:Map<string,SnapshotEvaluation>,diagnostics:SnapshotDiagnostic[]):{drawing:DrawingDocument;provenance:SnapshotEvaluation['provenance'];appliedTrackIds:Set<string>} {
 const drawing=emptyDrawing(),provenance:SnapshotEvaluation['provenance']={},appliedTrackIds=new Set<string>();
 const objects=new Map<string,unknown>(),nodeMap=new Map<string,DrawingDocument['nodes'][number]>(),inherited=emptyRelations();
 const selectedByParent=new Map<string,Set<string>>();
 for(const layer of snapshot.layers){
  let source:DrawingDocument|undefined,sourceLayer:DrawingLayer|undefined,parent:SnapshotEvaluation|undefined;
  let localIds=new Set<string>();
  if(layer.kind==='original'){
   sourceLayer=layer;const curves=layer.items.map(id=>workspace.library.curves[id]).filter(Boolean),nodes=[...new Set(curves.flatMap(c=>c.nodes))].map(id=>workspace.library.nodes[id]).filter(Boolean);
   source={version:3,layers:[layer],nodes,curves,fills:layer.items.map(id=>workspace.library.fills[id]).filter(Boolean),offsets:layer.items.map(id=>workspace.library.offsets[id]).filter(Boolean),joins:[]};
  }else{
   parent=parents.get(layer.baseSnapshotId);source=parent?.drawing;sourceLayer=source?.layers.find(l=>l.id===layer.baseLayerId);
   if(!source)diagnostics.push({code:'MISSING_SNAPSHOT',snapshotId:snapshot.id,layerId:layer.id,message:`Base snapshot ${layer.baseSnapshotId} is missing; its reference is retained.`});
   else if(!sourceLayer)diagnostics.push({code:'MISSING_LAYER',snapshotId:snapshot.id,layerId:layer.id,message:`Base layer ${layer.baseLayerId} is missing; its reference is retained.`});
   parent?.appliedTrackIds.forEach(id=>appliedTrackIds.add(id));
   const membership=resolveSnapshotLocalMembership(sourceLayer?.items??[],layer.membership);localIds=new Set(membership.localElementIds);
   const localCurves=membership.localElementIds.flatMap(id=>Object.hasOwn(workspace.library.curves,id)?[workspace.library.curves[id]]:[]),localNodes=new Set(localCurves.flatMap(curve=>curve.nodes));
   const inherited=source??emptyDrawing(),existingNodes=new Set(inherited.nodes.map(node=>node.id));
   source={...inherited,curves:[...inherited.curves,...localCurves],nodes:[...inherited.nodes,...[...localNodes].filter(id=>!existingNodes.has(id)&&Object.hasOwn(workspace.library.nodes,id)).map(id=>workspace.library.nodes[id])],fills:[...inherited.fills,...membership.localElementIds.flatMap(id=>Object.hasOwn(workspace.library.fills,id)?[workspace.library.fills[id]]:[])],offsets:[...inherited.offsets,...membership.localElementIds.flatMap(id=>Object.hasOwn(workspace.library.offsets,id)?[workspace.library.offsets[id]]:[])]};
   sourceLayer={id:layer.id,name:layer.name,visible:true,locked:false,items:membership.elementIds};
  }
  const items=new Set(sourceLayer.items),curves=source.curves.filter(c=>items.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
  const layerItems:string[]=[];
  for(const entity of [...curves,...source.fills.filter(f=>items.has(f.id)),...source.offsets.filter(o=>items.has(o.id))]){
   if(objects.has(entity.id))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,layerId:layer.id,elementId:entity.id,message:`Canonical element ${entity.id} reaches this snapshot through more than one layer branch. Choose one parent state explicitly.`});
   objects.set(entity.id,entity);layerItems.push(entity.id);
   const prior=localIds.has(entity.id)?undefined:parent?.provenance[entity.id];provenance[entity.id]={elementId:entity.id,sourceSnapshotId:prior?.sourceSnapshotId??snapshot.id,path:[...(prior?.path??[]),snapshot.id],...(prior?.materialContext?{materialContext:prior.materialContext}:{})};
   if(localIds.has(entity.id))diagnostics.push({code:'LOCAL_ORIGINAL',snapshotId:snapshot.id,layerId:layer.id,elementId:entity.id,message:`Local original ${entity.id} has no parent counterpart; it belongs only to this snapshot's membership.`});
  }
  for(const id of sourceLayer.items)if(!objects.has(id))diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,layerId:layer.id,elementId:id,message:`Canonical element ${id} is missing; its reference is retained.`});
  drawing.layers.push({id:layer.id,name:layer.name,visible:true,locked:false,items:sourceLayer.items.filter(id=>layerItems.includes(id))});
  drawing.curves.push(...structuredClone(curves));drawing.fills.push(...structuredClone(source.fills.filter(f=>items.has(f.id))));drawing.offsets.push(...structuredClone(source.offsets.filter(o=>items.has(o.id))));
  for(const node of source.nodes.filter(n=>nodes.has(n.id))){const prior=nodeMap.get(node.id);if(prior&&!same(prior,node))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,elementId:node.id,message:`Shared node ${node.id} has different parent states.`});nodeMap.set(node.id,structuredClone(node));const p=parent?.provenance[node.id];provenance[node.id]={elementId:node.id,sourceSnapshotId:p?.sourceSnapshotId??snapshot.id,path:[...(p?.path??[]),snapshot.id],...(p?.materialContext?{materialContext:p.materialContext}:{})};}
  if(layer.kind==='reference'&&parent){const set=selectedByParent.get(layer.baseSnapshotId)??new Set<string>();curves.filter(c=>!localIds.has(c.id)).forEach(c=>set.add(c.id));selectedByParent.set(layer.baseSnapshotId,set);}
 }
 drawing.nodes=[...nodeMap.values()];
 for(const [id,curves] of selectedByParent){const relations=relationSubset(parents.get(id)!.drawing,curves);for(const name of relationNames)(inherited[name] as {id:string}[]).push(...relations[name]);}
 for(const name of relationNames){const distinct=new Map<string,{id:string}>();for(const relation of inherited[name]){const prior=distinct.get(relation.id);if(prior&&!same(prior,relation)&&!snapshot.relations[name]?.update?.some(r=>r.id===relation.id)&&!snapshot.relations[name]?.disable?.includes(relation.id))throw new SnapshotResolutionError({code:'RELATION_CONFLICT',snapshotId:snapshot.id,elementId:relation.id,message:`Parent snapshots disagree on relation ${relation.id}; choose an explicit update or disable.`});distinct.set(relation.id,relation);}let patch=snapshot.relations[name] as SnapshotRelationPatch<{id:string}>|undefined;if(name==='displayIntervals'&&patch){const issues={...snapshot.inheritedState?.intervalMaterialIssues,...snapshot.deformation.intervalMaterialIssues},active=(value:{id:string})=>{const issue=issues[value.id];if(!issue)return true;const original=cachedOriginal(workspace,issue.sourceSnapshotId);return !!original&&drawingSignature(original)===issue.sourceSignature;};patch={...patch,...(patch.add?{add:patch.add.filter(active)}:{}),...(patch.update?{update:patch.update.filter(active)}:{})};}(drawing[name] as {id:string}[])=applyPatch([...distinct.values()],patch,diagnostics,snapshot.id);}
 // Keep dependent paint objects only when their explicit curves are available.
 const curveIds=new Set(drawing.curves.map(c=>c.id)),removed=new Set<string>();
 drawing.fills=drawing.fills.filter(f=>{const ok=f.boundary.every(u=>curveIds.has(u.id));if(!ok)removed.add(f.id);return ok;});drawing.offsets=drawing.offsets.filter(o=>{const ok=o.source.every(u=>curveIds.has(u.id));if(!ok)removed.add(o.id);return ok;});
 for(const id of removed)diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,elementId:id,message:`Paint element ${id} has a missing curve dependency and is inactive.`});
 for(const layer of drawing.layers)layer.items=layer.items.filter(id=>!removed.has(id));
 const input=retainSnapshotAffines(drawing,[...parents.values()].map(parent=>parent.drawing));
 return {drawing:markSnapshotRouteMaterialInput(validRelationships(applySnapshotNodeAliases(input,snapshot.nodeAliases,diagnostics,snapshot.id),diagnostics,snapshot.id)),provenance,appliedTrackIds};
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
 const plain={...drawing,curves:drawing.curves.map(c=>c.depthOffset?{...c,depthOffset:0,localPaintOrder:true}:c)},base=depthPaintBatches(plain),positions=new Map<string,number>(),slots=new Map<string,number>();
 for(const batch of base){positions.set(batch.owner??batch.item.id,batch.position);if(!batch.owner)for(const use of batch.item.stroke?.segments??[])positions.set(use.id,batch.position);}
 const originalLayer=(snapshotId:string,layerId:string):string|undefined=>{const owner=workspace.snapshots.find(s=>s.id===snapshotId),layer=owner?.layers.find(l=>l.id===layerId);return layer?.kind==='reference'?originalLayer(layer.baseSnapshotId,layer.baseLayerId):layer?.id;};
 let cursor=0;for(const layer of drawing.layers){const original=originalLayer(snapshot.id,layer.id);if(original)slots.set(original,cursor);slots.set(layer.id,cursor);for(const item of paintItems(drawing,layer.id))cursor+=item.stroke?item.stroke.segments.length:1;cursor++;}
 const sources=new Map<string,DrawingDocument|undefined>();
 const result=base.map(batch=>{if(!batch.owner)return batch;const p=provenance[batch.owner];if(!p)return batch;if(!sources.has(p.sourceSnapshotId))sources.set(p.sourceSnapshotId,cachedOriginal(workspace,p.sourceSnapshotId));const source=sources.get(p.sourceSnapshotId),curve=source?.curves.find(c=>c.id===(p.materialContext?.elementId??p.elementId));if(!source||!curve?.depthOffset)return batch;const context=depthContext(source,curve.id);if(!context.effective)return batch;const mapped=(id:string)=>p.materialContext?.idMap[id]??id,targets=context.target.ids.map(id=>positions.get(mapped(id))).filter((n):n is number=>n!==undefined),fallback=p.materialContext&&!Object.hasOwn(p.materialContext.idMap,context.target.id)?batch.position:slots.get(mapped(context.target.id))??batch.position;return {...batch,position:targets.length?(curve.depthOffset>0?Math.min(...targets)-.5:Math.max(...targets)+.5):fallback};});
 const order=new Map(base.map((batch,index)=>[batch.owner??batch.item.id,index]));return result.sort((a,b)=>a.position-b.position||order.get(a.owner??a.item.id)!-order.get(b.owner??b.item.id)!);
}
function evaluateOwn(snapshot:RecordingSnapshot,source:DrawingDocument,state:SnapshotDeformationState,options:SnapshotEvaluationOptions,diagnostics:SnapshotDiagnostic[],cache?:EvaluationCache):Omit<SnapshotEvaluation,'snapshotId'|'source'|'baseDrawing'|'provenance'|'appliedTrackIds'|'placementsByLayer'|'layerProvenance'|'authoredTracks'> {
 source=applySnapshotCurveAppearance(source,state);
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
 let base=stages?.get(stageKey);if(!base){base=evaluateScene({...scene,shapeTracks:[]},id=>id===sourceId?geometrySource:undefined,{...options,omitShapes:true,omitPlacements:true});stages?.set(stageKey,base);}
 const stageDiagnostics=base.diagnostics.filter(d=>d.code!=='ROUTE'),deformed={drawing:base.drawing,diagnostics:base.fitDiagnostics,diagnosticStage:base.diagnosticStage,intervalTransportErrors:base.intervalTransportErrors,maxError:base.maxError,warningCurveIds:base.warningCurveIds,conflictingNodeIds:base.conflictingNodeIds};
 const shaped=options.omitShapes?deformed:applySceneShapes(deformed,scene,angle,true,base.provenance,stageDiagnostics);
 const routes=new Set<string>();for(const track of shaped.drawing.displayIntervals??[])if(track.displayRoute){const key=JSON.stringify(track.displayRoute);if(routes.has(key))continue;routes.add(key);for(const diagnostic of createDisplayRouteField(shaped.drawing,track.displayRoute).diagnostics){const p=base.provenance[track.id];stageDiagnostics.push({code:'ROUTE',instanceId:p?.instanceId,trackId:p?.sourceId,message:diagnostic.message});}}
 const evaluated:SceneEvaluation={...base,angle:{...angle},drawing:shaped.drawing,preShapeDrawing:base.drawing,prePlacementDrawing:shaped.drawing,diagnostics:stageDiagnostics,fitDiagnostics:shaped.diagnostics as SceneEvaluation['fitDiagnostics'],warningCurveIds:shaped.warningCurveIds,intervalTransportErrors:shaped.intervalTransportErrors,maxError:shaped.maxError};
 const prefix=instanceObjectId(instanceId,''),raw=(id:string)=>id.startsWith(prefix)?id.slice(prefix.length):id;
 const canonical=(drawing:DrawingDocument)=>{let result=canonicalStageDrawings.get(drawing);if(!result){result=remapDrawingIdentities(drawing,raw);canonicalStageDrawings.set(drawing,result);}return result;};
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
 return {drawing,preShapeDrawing,prePlacementDrawing,preElementPlacementDrawing,elementPlacements,angle:evaluated.angle,state,diagnostics,warpGrids:evaluated.warpGrids,placements,paintBatches:depthPaintBatches(drawing),fitDiagnostics,warningCurveIds:[...new Set([...fitDiagnostics.filter(d=>d.warning).map(d=>d.sourceCurveId),...domainFits.filter(d=>d.exceedsTolerance).flatMap(d=>d.owners)])],intervalTransportErrors:evaluated.intervalTransportErrors.map(e=>({...e,trackId:raw(e.trackId),sourceCurveIds:e.sourceCurveIds.map(raw)})),maxError:Math.max(fitDiagnostics.reduce((m,d)=>Math.max(m,d.maxError),0),...domainFits.map(d=>d.maxError)),diagnosticStage:evaluated.diagnosticStage,conflictingNodeIds:evaluated.conflictingNodeIds.map(raw)};
}
function evaluateLegacySnapshot(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,snapshotId:string,options:SnapshotEvaluationOptions):SnapshotEvaluation {
 const scene=recording.legacy!.scene;
 const evaluated=evaluateScene(scene,artworkId=>{const source=workspace.snapshots.find(s=>s.kind==='drawing'&&s.source?.artworkId===artworkId);if(!source)return undefined;const drawing=materializeOriginalSnapshot(workspace,source.id);if(!drawing)return undefined;const order=new Map(Object.keys(source.source!.originIds).map((id,index)=>[id,index]));for(const key of ['nodes','curves','fills','offsets'] as const)drawing[key].sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));return remapDrawingIdentities(drawing,id=>source.source!.originIds[id]??id);},{...options,angle:options.angle??recording.angle});
 const provenance:SnapshotEvaluation['provenance']={};for(const [id,p] of Object.entries(evaluated.provenance)){const source=workspace.snapshots.find(s=>s.source?.artworkId===p.artworkId),canonical=source&&Object.entries(source.source!.originIds).find(([,raw])=>raw===p.sourceId)?.[0];provenance[id]={elementId:canonical??p.sourceId,sourceSnapshotId:source?.id??p.artworkId,path:[source?.id??p.artworkId,snapshotId]};}
 const diagnostics:SnapshotDiagnostic[]=[{code:'LEGACY_READ_ONLY',snapshotId,message:recording.legacy!.reason},...evaluated.diagnostics.map(d=>({code:'POSE' as const,snapshotId,layerId:d.sourceLayerId,elementId:d.sourceObjectId,channelId:d.trackId,message:d.message}))];
 return {snapshotId,source:evaluated.source,baseDrawing:evaluated.source,drawing:evaluated.drawing,preShapeDrawing:evaluated.preShapeDrawing,prePlacementDrawing:evaluated.prePlacementDrawing,preElementPlacementDrawing:evaluated.drawing,elementPlacements:{},angle:evaluated.angle,state:emptySnapshotDeformationState(),provenance,diagnostics,warpGrids:evaluated.warpGrids,placements:evaluated.placements,placementsByLayer:evaluated.placements,paintBatches:evaluated.paintBatches,fitDiagnostics:evaluated.fitDiagnostics,warningCurveIds:evaluated.warningCurveIds,intervalTransportErrors:evaluated.intervalTransportErrors,maxError:evaluated.maxError,diagnosticStage:evaluated.diagnosticStage,conflictingNodeIds:evaluated.conflictingNodeIds,appliedTrackIds:[],layerProvenance:{},authoredTracks:recording.tracks};
}
/** Returned evaluated documents are immutable runtime values, shared by the
 * bounded cache until their live source, saved state, tracks, or options change. */
export function resolveSnapshot(workspace:RecordingSnapshotWorkspace,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const fallback=recordingForSnapshot(workspace,snapshotId);if(fallback?.legacy)return evaluateLegacySnapshot(workspace,fallback,snapshotId,options);
 validateSnapshotGraph(workspace);const persistent=evaluationCache(workspace,options.immutableInputs),local=new Map<string,SnapshotEvaluation>(),visiting=new Set<string>(),snapshotStrings=new Map<string,string>(),trackStrings=new Map<SnapshotRecording,Map<boolean,string>>();
 const resolve=(id:string,root=false,visibilitySource=false):SnapshotEvaluation=>{
  const localKey=JSON.stringify([id,visibilitySource]),cached=!root&&local.get(localKey);if(cached)return cached;
  const snapshot=workspace.snapshots.find(s=>s.id===id);if(!snapshot)throw new SnapshotResolutionError({code:'MISSING_SNAPSHOT',snapshotId:id,message:`Snapshot ${id} is missing.`});
  if(visiting.has(id))throw new SnapshotResolutionError({code:'SNAPSHOT_CYCLE',snapshotId:id,message:`Snapshot ${id} contains a parent cycle.`});visiting.add(id);
  const recording=recordingForSnapshot(workspace,id),materialRecipe=recording?.angleGraph?.materialBasisRecipes?.[id],visibilityRecipe=recording?.angleGraph?.visibilityBasisRecipes?.[id];
  const materialBases=materialRecipe?snapshotMaterialRecipeDependencies(materialRecipe).map(source=>resolve(source)):[];
  const visibilityBases=visibilityRecipe?snapshotVisibilityRecipeDependencies(visibilityRecipe).map(source=>resolve(source,false,true)):[];
  const parents=new Map<string,SnapshotEvaluation>();for(const layer of snapshot.layers)if(layer.kind==='reference'&&workspace.snapshots.some(s=>s.id===layer.baseSnapshotId)&&!parents.has(layer.baseSnapshotId))parents.set(layer.baseSnapshotId,resolve(layer.baseSnapshotId));
  if(snapshot.parentSnapshotId&&(snapshot.parentLayers||snapshot.inputMirror)){const parent=parents.get(snapshot.parentSnapshotId)??resolve(snapshot.parentSnapshotId);parents.set(snapshot.parentSnapshotId,prepareSnapshotParentInput(workspace,snapshot,parent));}
  const angle=root&&options.angle?options.angle:snapshot.angle,binding=recording?.angleGraph?.mesh.vertices.find(vertex=>vertex.snapshotId===id)?.angle,localOptions:SnapshotEvaluationOptions=root?{...options,angle}:{angle,useDraft:visibilitySource&&options.useDraft!==false&&!!binding&&recording!.angle.x===binding.x&&recording!.angle.y===binding.y,diagnostics:options.diagnostics,tolerance:options.tolerance};
  let snapshotString=snapshotStrings.get(id);if(snapshotString===undefined){snapshotString=options.immutableInputs?String(immutableIdentity(snapshot)):JSON.stringify(snapshot);snapshotStrings.set(id,snapshotString);}const drafts=localOptions.useDraft!==false;let trackString=recording&&trackStrings.get(recording)?.get(drafts);if(recording&&trackString===undefined){if(options.immutableInputs){const memo=immutableTrackStrings.get(recording.tracks)??new Map<boolean,string>();trackString=memo.get(drafts);if(trackString===undefined){trackString=JSON.stringify(recording.tracks.map(track=>[track.id,track.channel,track.targetId,track.elementId,track.channel==='interval'?track.sourceTrackId:undefined,track.interpolation,immutableIdentity(track.keys),drafts?immutableIdentity(track.draft):0,track.channel==='interval'?immutableIdentity(track.materialIssue):0]));memo.set(drafts,trackString);immutableTrackStrings.set(recording.tracks,memo);}}else trackString=JSON.stringify(drafts?recording.tracks:recording.tracks.map(({draft,...track})=>track));const strings=trackStrings.get(recording)??new Map<boolean,string>();strings.set(drafts,trackString);trackStrings.set(recording,strings);}
  const parentIds=[...parents].map(([id,value])=>[id,resultIdentity(value)]),frameKey=JSON.stringify([snapshotString,trackString??'',parentIds,materialRecipe??null,visibilityRecipe??null,visibilityBases.map(resultIdentity),recording?.angleGraph?.materialPartitions??null,recording?.angleGraph?.materialPathLineages??null,materialBases.map(resultIdentity),evaluationOptionsKey(localOptions)]),frames=root?persistent.frames:persistent.parents,existing=frames.get(frameKey);
  if(existing){visiting.delete(id);local.set(localKey,existing);return root&&existing.authoredTracks!==recording?.tracks?{...existing,authoredTracks:recording?.tracks??[]}:existing;}
  const inputKey=JSON.stringify(options.immutableInputs?[id,immutableIdentity(snapshot.layers),immutableIdentity(snapshot.relations),immutableIdentity(snapshot.nodeAliases),immutableIdentity(snapshot.inheritedState?.intervalMaterialIssues),immutableIdentity(snapshot.deformation.intervalMaterialIssues),parentIds]:[id,snapshot.layers,snapshot.relations,snapshot.nodeAliases,snapshot.inheritedState?.intervalMaterialIssues,snapshot.deformation.intervalMaterialIssues,parentIds]);
  let cachedInput=persistent.inputs.get(inputKey);if(!cachedInput){const diagnostics:SnapshotDiagnostic[]=[...parents.values()].flatMap(p=>p.diagnostics),input=inputForSnapshot(workspace,snapshot,parents,diagnostics);cachedInput=persistent.inputs.set(inputKey,{input,diagnostics});}
  const input=cachedInput.input,diagnostics=[...cachedInput.diagnostics],state=evaluateSnapshotState(snapshot,recording,input.drawing,angle,localOptions.useDraft!==false,input.appliedTrackIds,{diagnostics,signature:sourceId=>{const original=cachedOriginal(workspace,sourceId);return original?drawingSignature(original):undefined;}});
  const appliedTrackIds=new Set(input.appliedTrackIds);for(const track of recording?.tracks??[])if(snapshot.layers.some(l=>l.id===track.targetId)||state.warps.some(w=>w.id===track.targetId)||state.relationPositions[track.targetId])appliedTrackIds.add(track.id);
  const inheritedMaterial=materialRecipe?applySnapshotMaterialRecipe(materialRecipe,snapshot.angle,materialBases,input.drawing,undefined,recording?.angleGraph?.materialPartitions,recording?.angleGraph?.materialPathLineages):undefined,materialInput=inheritedMaterial?.drawing??input.drawing,materialSource=visibilityRecipe?evaluateSnapshotVisibilityRecipe(visibilityRecipe,visibilityBases,materialInput,snapshot.angle):materialInput;
  if(inheritedMaterial)diagnostics.push(...inheritedMaterial.diagnostics.map(message=>({code:'SOURCE_MATERIAL' as const,snapshotId:id,message})));
  const own=evaluateOwn(snapshot,materialSource,state,localOptions,diagnostics,persistent);
  if(materialRecipe){const edited=new Set(Object.values(state.layers).flatMap(layer=>Object.keys(layer.intervals??{})));const material=applySnapshotMaterialRecipe(materialRecipe,snapshot.angle,materialBases,own.drawing,edited,recording?.angleGraph?.materialPartitions,recording?.angleGraph?.materialPathLineages);own.drawing=material.drawing;diagnostics.push(...material.diagnostics.map(message=>({code:'SOURCE_MATERIAL' as const,snapshotId:id,message})));}
  const result:SnapshotEvaluation={snapshotId:id,source:materialSource,baseDrawing:materialSource,provenance:input.provenance,appliedTrackIds:[...appliedTrackIds],...own,placementsByLayer:own.placements,layerProvenance:Object.fromEntries(snapshot.layers.map(l=>[l.id,{layerId:l.id,baseSnapshotId:l.kind==='reference'?l.baseSnapshotId:id,sourceLayerId:l.kind==='reference'?l.baseLayerId:l.id}])),authoredTracks:recording?.tracks??[]};result.paintBatches=snapshotPaintBatches(workspace,snapshot,result.drawing,result.provenance);visiting.delete(id);local.set(localKey,result);return frames.set(frameKey,result);
 };return resolve(snapshotId,true);
}
/** Endpoint pipelines remain live, including source edits and only the current
 * endpoint's unsaved draft. resolveSnapshot itself intentionally stays a raw
 * saved-view evaluator, so parent references cannot recurse through the pair. */
export function resolveEndpointPairBasis(workspace:RecordingSnapshotWorkspace,recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEndpointPairBasis {
 const recording=workspace.recordings.find(r=>r.id===recordingId),pair=recording?.endpointPair;if(!recording||recording.mode!=='endpoint-pair'||!pair)throw Error('Recording is not an endpoint pair.');validateSnapshotEndpointPair(pair);
 const first=workspace.snapshots.find(s=>s.id===pair.startSnapshotId),last=workspace.snapshots.find(s=>s.id===pair.endSnapshotId);if(!first||!last)throw Error('Endpoint pair references a missing basis snapshot.');
 if(!recording.snapshotIds.includes(first.id)||!recording.snapshotIds.includes(last.id)||!Number.isFinite(first.angle.x)||!Number.isFinite(last.angle.x)||Math.abs(first.angle.x-last.angle.x)<1e-8||Math.abs(first.angle.y-last.angle.y)>1e-8)throw Error('Endpoint pair needs distinct yaw angles at the same pitch.');
 const raw=(snapshot:RecordingSnapshot)=>resolveSnapshot(workspace,snapshot.id,{...options,snapshotId:snapshot.id,angle:snapshot.angle,useDraft:options.useDraft!==false&&sameAngle(recording.angle,snapshot.angle),tolerance:options.tolerance??recording.tolerance});
 return {start:raw(first),end:raw(last),startSnapshotId:first.id,endSnapshotId:last.id};
}
function evaluateEndpointPair(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,options:SnapshotEvaluationOptions):SnapshotEvaluation {
 const pair=recording.endpointPair!,basis=resolveEndpointPairBasis(workspace,recording.id,options),requested=options.angle??recording.angle;
 if(![requested.x,requested.y].every(Number.isFinite))throw Error('Endpoint pair angle must be finite.');
 if(Math.abs(requested.y-basis.start.angle.y)>1e-8)throw Error('Endpoint pair supports one yaw axis at its saved pitch; 2D pitch interpolation is not enabled.');
 const progress=Math.max(0,Math.min(1,(requested.x-basis.start.angle.x)/(basis.end.angle.x-basis.start.angle.x))),responses=options.useDraft!==false&&pair.draft?pair.draft.responses:pair.responses;
 const compatibility=endpointPairCompatibility(basis.start.drawing,basis.end.drawing);if(compatibility.length)throw Error(compatibility.join('\n'));
 const startWins=progress<.5||progress===.5&&basis.start.angle.x<basis.end.angle.x,selected=startWins?basis.start:basis.end;
 const cache=evaluationCache(workspace,options.immutableInputs),key=JSON.stringify(['endpoint-pair',recording.id,resultIdentity(basis.start),resultIdentity(basis.end),responses??null,requested,evaluationOptionsKey(options)]),known=cache.frames.get(key);if(known)return known;
 const sampled=interpolateEndpointPairDrawing(basis.start.drawing,basis.end.drawing,progress,responses,{startWins});
 const endpointPair:SnapshotEndpointPairEvaluation={...basis,axis:'x',progress,role:progress===0?'start':progress===1?'end':'correction',coordinateSpace:'final',nodeAuthorities:Object.fromEntries(endpointPairNodeAuthorities(basis.start.drawing)),responses};
 const diagnostics=[...basis.start.diagnostics,...basis.end.diagnostics,...sampled.diagnostics.map(message=>({code:'POSE' as const,message}))];
 if(progress===0||progress===1){const exact=progress===0?basis.start:basis.end;return cache.frames.set(key,{...exact,angle:{...requested},endpointPair,diagnostics});}
 const snapshot=workspace.snapshots.find(s=>s.id===selected.snapshotId)!;
 const result:SnapshotEvaluation={...selected,angle:{...requested},drawing:sampled.drawing,preShapeDrawing:sampled.drawing,prePlacementDrawing:sampled.drawing,preElementPlacementDrawing:sampled.drawing,elementPlacements:{},diagnostics,endpointPair,
  // Endpoint fits are evidence about their endpoints only, never invented
  // intermediate fit measurements. The final controls require no refitting.
  fitDiagnostics:[],warningCurveIds:[],maxError:Math.max(basis.start.maxError,basis.end.maxError),conflictingNodeIds:[...new Set([...basis.start.conflictingNodeIds,...basis.end.conflictingNodeIds])],intervalTransportErrors:[...basis.start.intervalTransportErrors,...basis.end.intervalTransportErrors]};
 result.paintBatches=snapshotPaintBatches(workspace,snapshot,result.drawing,result.provenance);return cache.frames.set(key,result);
}
const surfacePreparationCaches=new WeakMap<RecordingSnapshotWorkspace['library'],InputCache<ReturnType<typeof prepareSnapshotCoverage>>>();
/** Real snapshot poses are resolved at their own saved compatibility state.
 * Their Recorder coordinates only locate/mix poses; rebinding an angle never
 * feeds the new coordinate back into a snapshot's legacy deformation tracks. */
function evaluateTriangulatedRecording(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,options:SnapshotEvaluationOptions):SnapshotEvaluation {
 const graph=recording.angleGraph;if(!graph)throw Error('Triangulated recording has no angle graph.');
 const requested=options.angle??recording.angle;
 if(![requested.x,requested.y].every(value=>Number.isFinite(value)&&value>=-90&&value<=90))throw Error('Recording angle must be finite and within −90…90.');
 const bases=graph.mesh.vertices.map(vertex=>{
  const snapshot=workspace.snapshots.find(s=>s.id===vertex.snapshotId);if(!snapshot)throw Error(`Missing real snapshot ${vertex.snapshotId}.`);
  return resolveSnapshot(workspace,snapshot.id,{...options,snapshotId:snapshot.id,angle:snapshot.angle,useDraft:options.useDraft!==false&&recording.angle.x===vertex.angle.x&&recording.angle.y===vertex.angle.y,tolerance:options.tolerance??recording.tolerance});
 });
 if(!bases.length)throw Error('Recording has no real snapshot. Create one to begin editing.');
 const angleFor=(snapshotId:string)=>graph.mesh.vertices.find(vertex=>vertex.snapshotId===snapshotId)!.angle;
 const baseRefs=bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:angleFor(base.snapshotId)})),meshKey=options.immutableInputs?immutableIdentity(graph.mesh):graph.mesh;
 const basisKey=JSON.stringify([meshKey,bases.map(resultIdentity)]);let preparedCache=surfacePreparationCaches.get(workspace.library);if(!preparedCache){preparedCache=new InputCache(12);surfacePreparationCaches.set(workspace.library,preparedCache);}
 let prepared=preparedCache.get(basisKey);if(!prepared){prepared=prepareSnapshotCoverage(graph.mesh,baseRefs);preparedCache.set(basisKey,prepared);}
 const effectiveGraph=options.useDraft===false&&graph.correctionFrames?.some(frame=>frame.status==='draft')?{...graph,correctionFrames:graph.correctionFrames.filter(frame=>frame.status!=='draft')}:graph;
 const cache=evaluationCache(workspace,options.immutableInputs),key=JSON.stringify(['angle-surface',recording.id,basisKey,options.immutableInputs?[immutableIdentity(graph.edgeResponses),immutableIdentity(graph.triangleResponses),immutableIdentity(graph.responseExpressions),options.useDraft!==false?immutableIdentity(graph.correctionFrames):0]:[graph.edgeResponses,graph.triangleResponses,graph.responseExpressions,options.useDraft!==false?graph.correctionFrames:null],snapshotPropertyResponsesCacheKey(effectiveGraph),graph.materialRecipes??null,graph.visibilityRecipes??null,graph.materialPartitions??null,graph.materialPathLineages??null,requested,evaluationOptionsKey(options)]),known=cache.frames.get(key);if(known)return known;
 const responseSamplers=new Map<string,ReturnType<typeof createSnapshotSurfaceValueSampler>>();
 const sampled=prepared.evaluate(requested,location=>{const locationKey=JSON.stringify([location.simplexId,location.vertexIds]);let sampler=responseSamplers.get(locationKey);if(!sampler){sampler=createSnapshotSurfaceValueSampler(effectiveGraph,location,baseRefs);responseSamplers.set(locationKey,sampler);}return sampler;});
 const normal=sampled.normal,active=normal?.simplex.snapshotIds.map(id=>bases.find(base=>base.snapshotId===id)!)??[];
 const selected=active.length?active[dominantSnapshotBasis(active.map(base=>({snapshotId:base.snapshotId,angle:angleFor(base.snapshotId)})),normal!.simplex.geometricWeights)]:bases.find(base=>base.snapshotId===recording.activeSnapshotId)??bases[0];
 const role:SnapshotAngleSurfaceEvaluation['role']=!normal?'outside':normal.simplex.kind==='vertex'?'basis':'correction';
 const surface:SnapshotAngleSurfaceEvaluation={role,coordinateSpace:'final',...(normal?{simplex:normal.simplex}:{}),bases:active,allBases:bases,nodeAuthorities:Object.fromEntries(normal?.nodeAuthorities??[]),outsideCurves:sampled.outsideCurves};
 const diagnostics:SnapshotDiagnostic[]=[...active.flatMap(base=>base.diagnostics),...sampled.diagnostics.map(message=>({code:'POSE' as const,message}))];
 if(role==='basis'){
  const recipe=graph.visibilityBasisRecipes?.[selected.snapshotId];
  const drawing=recipe?applySnapshotVisibilityState(evaluateSnapshotVisibilityRecipe(recipe,bases,selected.drawing,requested),selected.state):selected.drawing;
  const result={...selected,drawing,angle:{...requested},angleSurface:surface,diagnostics};
  if(recipe)result.paintBatches=snapshotPaintBatches(workspace,workspace.snapshots.find(s=>s.id===selected.snapshotId)!,drawing,result.provenance);
  return cache.frames.set(key,result);
 }
 let drawing=normal?.drawing??emptyDrawing();
 if(normal){
  const materialBases=active.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing})),recipe=graph.materialRecipes?.[normal.simplex.simplexId];
  const retained=recipe?evaluateSnapshotMaterialRecipe(recipe,baseRefs,drawing,requested,graph.materialPartitions,graph.materialPathLineages):undefined;
  const native=createSnapshotPropertyResponseSampler(effectiveGraph,normal.simplex),inherited=(target:Parameters<typeof native>[0])=>retained?snapshotMaterialPartitionValue(graph.materialPartitions,retained.drawing,target,graph.materialPathLineages):undefined;
  const material=transportSnapshotSimplexMaterial(materialBases,retained?.drawing??drawing,normal.simplex.geometricWeights,{partitions:graph.materialPartitions,pathLineages:graph.materialPathLineages,inherited,response:(target,values,weights)=>{const old=inherited(target),value=native(target,values,weights);return old===undefined?value:old+(value-blendSnapshotPropertyValues(values,weights));},pinch:(trackId,rangeId)=>{const range=retained?.drawing.displayIntervals?.find(track=>track.id===trackId)?.ranges.find(range=>range.id===rangeId);return range?intervalPinch(range):undefined;}});
  const visibility=graph.visibilityRecipes?.[normal.simplex.simplexId];
  drawing=visibility?evaluateSnapshotVisibilityRecipe(visibility,bases,material.drawing,requested):material.drawing;
  diagnostics.push(...[...material.diagnostics,...retained?.diagnostics??[]].map(message=>({code:'SOURCE_MATERIAL' as const,message})));
 }
 const snapshot=workspace.snapshots.find(s=>s.id===selected.snapshotId)!;
 const result:SnapshotEvaluation={...selected,angle:{...requested},drawing,preShapeDrawing:drawing,prePlacementDrawing:drawing,preElementPlacementDrawing:drawing,elementPlacements:{},angleSurface:surface,diagnostics,fitDiagnostics:[],warningCurveIds:[],maxError:Math.max(...active.map(base=>base.maxError),0),conflictingNodeIds:[],intervalTransportErrors:active.flatMap(base=>base.intervalTransportErrors)};
 result.paintBatches=snapshotPaintBatches(workspace,snapshot,drawing,result.provenance);return cache.frames.set(key,result);
}
export function evaluateRecordingSnapshot(workspace:RecordingSnapshotWorkspace,recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const recording=workspace.recordings.find(r=>r.id===recordingId);if(!recording){if(workspace.snapshots.some(s=>s.id===recordingId))return resolveSnapshot(workspace,recordingId,options);throw Error('Missing recording');}
 if(recording.mode==='endpoint-pair')return evaluateEndpointPair(workspace,recording,options);
 if(recording.mode==='triangulated')return evaluateTriangulatedRecording(workspace,recording,options);
 const at=options.angle??recording.angle,ordered=recording.snapshotIds.map(id=>workspace.snapshots.find(s=>s.id===id)).filter((s):s is RecordingSnapshot=>!!s).sort((a,b)=>Math.hypot(a.angle.x-at.x,a.angle.y-at.y)-Math.hypot(b.angle.x-at.x,b.angle.y-at.y)||a.angle.y-b.angle.y||a.angle.x-b.angle.x||a.id.localeCompare(b.id));
 const snapshotId=options.snapshotId??ordered[0]?.id;if(!snapshotId)throw Error('Recording has no view snapshot');
 if(recording.legacy)return evaluateLegacySnapshot(workspace,recording,snapshotId,{...options,tolerance:options.tolerance??recording.tolerance});
 const result=resolveSnapshot(workspace,snapshotId,{...options,angle:options.angle??recording.angle,tolerance:options.tolerance??recording.tolerance});
 return result;
}
