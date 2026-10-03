import {emptyDrawing,layerFor,type DrawingDocument,type DrawingLayer,type Point2,type Cubic} from '../drawing/model';
import {depthContext,depthPaintBatches,type PaintBatch} from '../drawing/depth';
import {registerEvaluatedAffine,type EvaluatedAffine} from '../drawing/evaluatedAffine';
import {scaleEvaluatedDisplayRouteBrush} from '../drawing/displayRouteBrush';
import {createDisplayRouteField,resolveDisplayRoute} from '../drawing/displayRoutes';
import {paintItems} from '../drawing/strokes';
import {InputCache} from '../geometry/cache';
import {applySceneShapes} from '../recordingScene/shapes';
import {drawingSignature} from '../vectorRecording/model';
import {emptyRecordingScene,identityScenePlacement,identitySceneShape,instanceObjectId,type ScenePlacementValue,type SceneShapeValue} from '../recordingScene/model';
import {evaluateScene,type SceneEvaluation,type SceneEvaluationOptions} from '../recordingScene/evaluation';
import {applyScenePlacement,scenePlacementScales,scenePlacementMaxScale,isScenePlacementSimilarity} from '../recordingScene/tracks';
import {materializeOriginalSnapshot,remapDrawingIdentities} from './sources';
import {evaluateSnapshotState,recordingForSnapshot} from './tracks';
import {validateSnapshotGraph} from './validation';
import {sameAngle} from '../vectorRecording/interpolation';
import {endpointPairCompatibility,endpointPairNodeAuthorities,interpolateEndpointPairDrawing,validateSnapshotEndpointPair} from './endpointPair';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotDiagnostic,type SnapshotElementProvenance,type SnapshotRelationCollection,type SnapshotRelationPatch,type Angle,type WarpGrid,type SnapshotPoseTrack,type SnapshotRecording,type SnapshotEndpointResponses} from './model';

export interface SnapshotEvaluationOptions extends SceneEvaluationOptions {snapshotId?:string;/** Trusted store/render callers only: all library, snapshot, key, and draft objects must be immutable. */immutableInputs?:boolean}
export interface SnapshotEvaluation {
 snapshotId:string;source:DrawingDocument;baseDrawing:DrawingDocument;drawing:DrawingDocument;preShapeDrawing:DrawingDocument;prePlacementDrawing:DrawingDocument;
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
 result.displayIntervals=drawing.displayIntervals?.filter(t=>{if(!curves.has(t.anchor.id)){diagnostics.push({code:'MISSING_ELEMENT',snapshotId,elementId:t.id,message:`Display interval ${t.id} has no anchor in this snapshot.`});return false;}if(t.displayRoute){const route=resolveDisplayRoute(result,t.displayRoute);if(route.diagnostics.length){diagnostics.push({code:'ROUTE',snapshotId,elementId:t.id,message:`Display route ${t.id} is incomplete in this snapshot; its saved relationship remains available.`});return false;}}return true;});return result;
}
function inputForSnapshot(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,parents:Map<string,SnapshotEvaluation>,diagnostics:SnapshotDiagnostic[]):{drawing:DrawingDocument;provenance:SnapshotEvaluation['provenance'];appliedTrackIds:Set<string>} {
 const drawing=emptyDrawing(),provenance:SnapshotEvaluation['provenance']={},appliedTrackIds=new Set<string>();
 const objects=new Map<string,unknown>(),nodeMap=new Map<string,DrawingDocument['nodes'][number]>(),inherited=emptyRelations();
 const selectedByParent=new Map<string,Set<string>>();
 for(const layer of snapshot.layers){
  let source:DrawingDocument|undefined,sourceLayer:DrawingLayer|undefined,parent:SnapshotEvaluation|undefined;
  if(layer.kind==='original'){
   sourceLayer=layer;const curves=layer.items.map(id=>workspace.library.curves[id]).filter(Boolean),nodes=[...new Set(curves.flatMap(c=>c.nodes))].map(id=>workspace.library.nodes[id]).filter(Boolean);
   source={version:3,layers:[layer],nodes,curves,fills:layer.items.map(id=>workspace.library.fills[id]).filter(Boolean),offsets:layer.items.map(id=>workspace.library.offsets[id]).filter(Boolean),joins:[]};
  }else{
   parent=parents.get(layer.baseSnapshotId);source=parent?.drawing;sourceLayer=source?.layers.find(l=>l.id===layer.baseLayerId);
   if(!source){diagnostics.push({code:'MISSING_SNAPSHOT',snapshotId:snapshot.id,layerId:layer.id,message:`Base snapshot ${layer.baseSnapshotId} is missing; its reference is retained.`});continue;}
   if(!sourceLayer){diagnostics.push({code:'MISSING_LAYER',snapshotId:snapshot.id,layerId:layer.id,message:`Base layer ${layer.baseLayerId} is missing; its reference is retained.`});continue;}
   parent!.appliedTrackIds.forEach(id=>appliedTrackIds.add(id));
  }
  const items=new Set(sourceLayer.items),curves=source.curves.filter(c=>items.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
  const layerItems:string[]=[];
  for(const entity of [...curves,...source.fills.filter(f=>items.has(f.id)),...source.offsets.filter(o=>items.has(o.id))]){
   if(objects.has(entity.id))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,layerId:layer.id,elementId:entity.id,message:`Canonical element ${entity.id} reaches this snapshot through more than one layer branch. Choose one parent state explicitly.`});
   objects.set(entity.id,entity);layerItems.push(entity.id);
   const prior=parent?.provenance[entity.id];provenance[entity.id]={elementId:entity.id,sourceSnapshotId:prior?.sourceSnapshotId??snapshot.id,path:[...(prior?.path??[]),snapshot.id]};
  }
  for(const id of sourceLayer.items)if(!objects.has(id))diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,layerId:layer.id,elementId:id,message:`Canonical element ${id} is missing; its reference is retained.`});
  drawing.layers.push({id:layer.id,name:layer.name,visible:true,locked:false,items:sourceLayer.items.filter(id=>layerItems.includes(id))});
  drawing.curves.push(...structuredClone(curves));drawing.fills.push(...structuredClone(source.fills.filter(f=>items.has(f.id))));drawing.offsets.push(...structuredClone(source.offsets.filter(o=>items.has(o.id))));
  for(const node of source.nodes.filter(n=>nodes.has(n.id))){const prior=nodeMap.get(node.id);if(prior&&!same(prior,node))throw new SnapshotResolutionError({code:'BRANCH_CONFLICT',snapshotId:snapshot.id,elementId:node.id,message:`Shared node ${node.id} has different parent states.`});nodeMap.set(node.id,structuredClone(node));const p=parent?.provenance[node.id];provenance[node.id]={elementId:node.id,sourceSnapshotId:p?.sourceSnapshotId??snapshot.id,path:[...(p?.path??[]),snapshot.id]};}
  if(layer.kind==='reference'){const set=selectedByParent.get(layer.baseSnapshotId)??new Set<string>();curves.forEach(c=>set.add(c.id));selectedByParent.set(layer.baseSnapshotId,set);}
 }
 drawing.nodes=[...nodeMap.values()];
 for(const [id,curves] of selectedByParent){const relations=relationSubset(parents.get(id)!.drawing,curves);for(const name of relationNames)(inherited[name] as {id:string}[]).push(...relations[name]);}
 for(const name of relationNames){const distinct=new Map<string,{id:string}>();for(const relation of inherited[name]){const prior=distinct.get(relation.id);if(prior&&!same(prior,relation)&&!snapshot.relations[name]?.update?.some(r=>r.id===relation.id)&&!snapshot.relations[name]?.disable?.includes(relation.id))throw new SnapshotResolutionError({code:'RELATION_CONFLICT',snapshotId:snapshot.id,elementId:relation.id,message:`Parent snapshots disagree on relation ${relation.id}; choose an explicit update or disable.`});distinct.set(relation.id,relation);}let patch=snapshot.relations[name] as SnapshotRelationPatch<{id:string}>|undefined;if(name==='displayIntervals'&&patch){const issues={...snapshot.inheritedState?.intervalMaterialIssues,...snapshot.deformation.intervalMaterialIssues},active=(value:{id:string})=>{const issue=issues[value.id];if(!issue)return true;const original=cachedOriginal(workspace,issue.sourceSnapshotId);return !!original&&drawingSignature(original)===issue.sourceSignature;};patch={...patch,...(patch.add?{add:patch.add.filter(active)}:{}),...(patch.update?{update:patch.update.filter(active)}:{})};}(drawing[name] as {id:string}[])=applyPatch([...distinct.values()],patch,diagnostics,snapshot.id);}
 // Keep dependent paint objects only when their explicit curves are available.
 const curveIds=new Set(drawing.curves.map(c=>c.id)),removed=new Set<string>();
 drawing.fills=drawing.fills.filter(f=>{const ok=f.boundary.every(u=>curveIds.has(u.id));if(!ok)removed.add(f.id);return ok;});drawing.offsets=drawing.offsets.filter(o=>{const ok=o.source.every(u=>curveIds.has(u.id));if(!ok)removed.add(o.id);return ok;});
 for(const id of removed)diagnostics.push({code:'MISSING_ELEMENT',snapshotId:snapshot.id,elementId:id,message:`Paint element ${id} has a missing curve dependency and is inactive.`});
 for(const layer of drawing.layers)layer.items=layer.items.filter(id=>!removed.has(id));
 return {drawing:validRelationships(drawing,diagnostics,snapshot.id),provenance,appliedTrackIds};
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
 const identity=identityScenePlacement(),owners=new Map(before.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const)));
 for(const curve of before.curves)for(const id of curve.nodes)owners.set(id,owners.get(curve.id)!);
 const value=(id:string)=>placements[owners.get(id)!]??identity,active=(v:ScenePlacementValue)=>scenePlacementScales(v).some(s=>s!==1)||v.rotation!==0||v.translation.some(n=>n!==0);
 if(!Object.values(placements).some(active))return before;
 const drawing:DrawingDocument={...before,nodes:before.nodes.map(n=>active(value(n.id))?{...n,position:applyScenePlacement(value(n.id),n.position)}:n),curves:before.curves.map(c=>active(value(c.id))?{...c,handles:c.handles.map(p=>applyScenePlacement(value(c.id),p)) as [Point2,Point2]}:c),offsets:before.offsets.map(o=>o.translation&&active(value(o.id))?{...o,translation:applyScenePlacement({...value(o.id),translation:[0,0]},o.translation)}:o),joins:before.joins.map(j=>j.radius!==undefined&&active(value(j.a.curveId))&&isScenePlacementSimilarity(value(j.a.curveId))?{...j,radius:j.radius*scenePlacementMaxScale(value(j.a.curveId))}:j),endpointLinks:before.endpointLinks?.map(l=>l.joinBrush?.kind==='ARC'&&active(value(l.a.curveId))&&isScenePlacementSimilarity(value(l.a.curveId))?{...l,joinBrush:scaleEvaluatedDisplayRouteBrush(l.joinBrush,scenePlacementMaxScale(value(l.a.curveId)))}:l)};
 const affines=new Map<string,EvaluatedAffine>();for(const [id,p] of Object.entries(placements))if(!isScenePlacementSimilarity(p))affines.set(id,{point:point=>applyScenePlacement(p,point),maxScale:scenePlacementMaxScale(p)});
 if(affines.size)registerEvaluatedAffine(drawing,before,id=>affines.get(owners.get(id)!));return drawing;
}
/** Element offsets resolve against their source siblings before assembly ordering. */
function snapshotPaintBatches(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,drawing:DrawingDocument,provenance:SnapshotEvaluation['provenance']):PaintBatch[]{
 const plain={...drawing,curves:drawing.curves.map(c=>c.depthOffset?{...c,depthOffset:0,localPaintOrder:true}:c)},base=depthPaintBatches(plain),positions=new Map<string,number>(),slots=new Map<string,number>();
 for(const batch of base){positions.set(batch.owner??batch.item.id,batch.position);if(!batch.owner)for(const use of batch.item.stroke?.segments??[])positions.set(use.id,batch.position);}
 const originalLayer=(snapshotId:string,layerId:string):string|undefined=>{const owner=workspace.snapshots.find(s=>s.id===snapshotId),layer=owner?.layers.find(l=>l.id===layerId);return layer?.kind==='reference'?originalLayer(layer.baseSnapshotId,layer.baseLayerId):layer?.id;};
 let cursor=0;for(const layer of drawing.layers){const original=originalLayer(snapshot.id,layer.id);if(original)slots.set(original,cursor);for(const item of paintItems(drawing,layer.id))cursor+=item.stroke?item.stroke.segments.length:1;cursor++;}
 const sources=new Map<string,DrawingDocument|undefined>();
 const result=base.map(batch=>{if(!batch.owner)return batch;const p=provenance[batch.owner];if(!p)return batch;if(!sources.has(p.sourceSnapshotId))sources.set(p.sourceSnapshotId,cachedOriginal(workspace,p.sourceSnapshotId));const source=sources.get(p.sourceSnapshotId),curve=source?.curves.find(c=>c.id===p.elementId);if(!source||!curve?.depthOffset)return batch;const context=depthContext(source,curve.id);if(!context.effective)return batch;const targets=context.target.ids.map(id=>positions.get(id)).filter((n):n is number=>n!==undefined);return {...batch,position:targets.length?(curve.depthOffset>0?Math.min(...targets)-.5:Math.max(...targets)+.5):(slots.get(context.target.id)??batch.position)};});
 const order=new Map(base.map((batch,index)=>[batch.owner??batch.item.id,index]));return result.sort((a,b)=>a.position-b.position||order.get(a.owner??a.item.id)!-order.get(b.owner??b.item.id)!);
}
function evaluateOwn(snapshot:RecordingSnapshot,source:DrawingDocument,state:SnapshotDeformationState,options:SnapshotEvaluationOptions,diagnostics:SnapshotDiagnostic[],cache?:EvaluationCache):Omit<SnapshotEvaluation,'snapshotId'|'source'|'baseDrawing'|'provenance'|'appliedTrackIds'|'placementsByLayer'|'layerProvenance'|'authoredTracks'> {
 const angle=options.angle??snapshot.angle;if(![angle.x,angle.y].every(n=>Number.isFinite(n)&&n>=-90&&n<=90))throw Error('Snapshot angle must be finite and between -90 and 90.');const scene=emptyRecordingScene('snapshot-evaluation'),instanceId='snapshot-evaluation',sourceId='snapshot-source';
 scene.angle={...angle};scene.instances=[{id:instanceId,artworkId:sourceId,name:snapshot.name}];
 scene.warps=state.warps.map(w=>({id:w.id,name:w.name,parentId:w.parentId,restGrid:w.restGrid,keys:[{id:`current:${w.id}`,angle,value:w.grid}]}));
 scene.bindings=state.bindings.map(b=>({instanceId,sourceLayerId:b.layerId,warpId:b.warpId}));
 for(const [layerId,value] of Object.entries(state.layers)){
  for(const [id,visible] of Object.entries(value.visibility??{}))scene.visibilityTracks.push({id:`visibility:${layerId}:${id}`,target:{instanceId,sourceLayerId:layerId,...(id===layerId?{}:{sourceObjectId:id})},keys:[{id:'current',angle,value:visible}]});
  for(const [id,interval] of Object.entries(value.intervals??{}))scene.intervalTracks.push({id:`interval:${id}`,instanceId,sourceTrackId:id,keys:[{id:'current',angle,value:interval}]});
  if(value.depth!==undefined)scene.depthTracks!.push({id:`depth:${layerId}`,target:{instanceId,sourceLayerId:layerId},keys:[{id:'current',angle,value:value.depth}]});
 }
 const shape=shapeState(source,state,diagnostics,snapshot.id);if(Object.keys(shape.nodes).length||Object.keys(shape.handles).length)scene.shapeTracks=[{id:'snapshot-shape',instanceId,keys:[{id:'current',angle,value:shape}]}];
 // Shape/placement edits do not change the source+Warp stage. Cache that stage
 // separately, retaining the existing shape constraints and material transport.
 let stages=cache?.baseStages.get(source);if(cache&&!stages){stages=new InputCache(16);cache.baseStages.set(source,stages);}
 const values=(tracks:typeof scene.visibilityTracks|typeof scene.intervalTracks|typeof scene.depthTracks)=>tracks?.map(({keys,...track})=>({...track,value:keys[0]?.value}));
 const stageKey=JSON.stringify([scene.warps.map(({keys,...warp})=>({...warp,value:keys[0]?.value})),scene.bindings,values(scene.visibilityTracks),values(scene.intervalTracks),values(scene.depthTracks),evaluationOptionsKey({...options,angle:{x:0,y:0},useDraft:false,omitShapes:true,omitPlacements:true})]);
 let base=stages?.get(stageKey);if(!base){base=evaluateScene({...scene,shapeTracks:[]},id=>id===sourceId?source:undefined,{...options,omitShapes:true,omitPlacements:true});stages?.set(stageKey,base);}
 const stageDiagnostics=base.diagnostics.filter(d=>d.code!=='ROUTE'),deformed={drawing:base.drawing,diagnostics:base.fitDiagnostics,diagnosticStage:base.diagnosticStage,intervalTransportErrors:base.intervalTransportErrors,maxError:base.maxError,warningCurveIds:base.warningCurveIds,conflictingNodeIds:base.conflictingNodeIds};
 const shaped=options.omitShapes?deformed:applySceneShapes(deformed,scene,angle,true,base.provenance,stageDiagnostics);
 const routes=new Set<string>();for(const track of shaped.drawing.displayIntervals??[])if(track.displayRoute){const key=JSON.stringify(track.displayRoute);if(routes.has(key))continue;routes.add(key);for(const diagnostic of createDisplayRouteField(shaped.drawing,track.displayRoute).diagnostics){const p=base.provenance[track.id];stageDiagnostics.push({code:'ROUTE',instanceId:p?.instanceId,trackId:p?.sourceId,message:diagnostic.message});}}
 const evaluated:SceneEvaluation={...base,angle:{...angle},drawing:shaped.drawing,preShapeDrawing:base.drawing,prePlacementDrawing:shaped.drawing,diagnostics:stageDiagnostics,fitDiagnostics:shaped.diagnostics as SceneEvaluation['fitDiagnostics'],warningCurveIds:shaped.warningCurveIds,intervalTransportErrors:shaped.intervalTransportErrors,maxError:shaped.maxError};
 const prefix=instanceObjectId(instanceId,''),raw=(id:string)=>id.startsWith(prefix)?id.slice(prefix.length):id;
 const canonical=(drawing:DrawingDocument)=>{let result=canonicalStageDrawings.get(drawing);if(!result){result=remapDrawingIdentities(drawing,raw);canonicalStageDrawings.set(drawing,result);}return result;};
 const preShapeDrawing=canonical(evaluated.preShapeDrawing),prePlacementDrawing=canonical(evaluated.prePlacementDrawing),unplaced=canonical(evaluated.drawing);
 const placements=Object.fromEntries(snapshot.layers.map(l=>[l.id,state.layers[l.id]?.placement??identityScenePlacement()]));
 const drawing=options.omitPlacements?unplaced:placeLayers(unplaced,placements);
 const placedNodes=new Map(drawing.nodes.map(n=>[n.id,n.position])),placedCurves=new Map(drawing.curves.map(c=>[c.id,c]));for(const link of drawing.endpointLinks??[]){const a=placedNodes.get(placedCurves.get(link.a.curveId)?.nodes[link.a.end]??''),b=placedNodes.get(placedCurves.get(link.b.curveId)?.nodes[link.b.end]??'');if(a&&b&&Math.hypot(a[0]-b[0],a[1]-b[1])>1e-8)diagnostics.push({code:'RELATION_CONFLICT',snapshotId:snapshot.id,elementId:link.id,message:'Layer placement separates linked endpoints. Connected layers need coherent placement values.'});}
 for(const diagnostic of evaluated.diagnostics)diagnostics.push({code:diagnostic.code==='ROUTE'?'ROUTE':'POSE',snapshotId:snapshot.id,layerId:diagnostic.sourceLayerId,elementId:diagnostic.sourceObjectId,channelId:diagnostic.trackId,message:diagnostic.message});
 const fitDiagnostics=evaluated.fitDiagnostics.map(d=>{const sourceCurveId=raw(d.sourceCurveId),placement=placements[layerFor(source,sourceCurveId)?.id??'']??identityScenePlacement();if(options.omitPlacements)return {...d,sourceCurveId};const maximum=scenePlacementMaxScale(placement),maxError=d.maxError*maximum,endpointMismatchError=d.endpointMismatchError*maximum,exceedsTolerance=maxError>d.tolerance,endpointConflict=d.endpointConflict||endpointMismatchError>1e-8,cubic=d.cubic.map(p=>applyScenePlacement(placement,p)) as Cubic;return {...d,sourceCurveId,cubic,peakExpected:applyScenePlacement(placement,d.peakExpected),peakActual:applyScenePlacement(placement,d.peakActual),maxError,endpointMismatchError,exceedsTolerance,endpointConflict,warning:exceedsTolerance||endpointConflict||d.nonFinite||!!d.appearanceWarning};});
 return {drawing,preShapeDrawing,prePlacementDrawing,angle:evaluated.angle,state,diagnostics,warpGrids:evaluated.warpGrids,placements,paintBatches:depthPaintBatches(drawing),fitDiagnostics,warningCurveIds:fitDiagnostics.filter(d=>d.warning).map(d=>d.sourceCurveId),intervalTransportErrors:evaluated.intervalTransportErrors.map(e=>({...e,trackId:raw(e.trackId),sourceCurveIds:e.sourceCurveIds.map(raw)})),maxError:fitDiagnostics.reduce((m,d)=>Math.max(m,d.maxError),0),diagnosticStage:evaluated.diagnosticStage,conflictingNodeIds:evaluated.conflictingNodeIds.map(raw)};
}
function evaluateLegacySnapshot(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,snapshotId:string,options:SnapshotEvaluationOptions):SnapshotEvaluation {
 const scene=recording.legacy!.scene;
 const evaluated=evaluateScene(scene,artworkId=>{const source=workspace.snapshots.find(s=>s.kind==='drawing'&&s.source?.artworkId===artworkId);if(!source)return undefined;const drawing=materializeOriginalSnapshot(workspace,source.id);if(!drawing)return undefined;const order=new Map(Object.keys(source.source!.originIds).map((id,index)=>[id,index]));for(const key of ['nodes','curves','fills','offsets'] as const)drawing[key].sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));return remapDrawingIdentities(drawing,id=>source.source!.originIds[id]??id);},{...options,angle:options.angle??recording.angle});
 const provenance:SnapshotEvaluation['provenance']={};for(const [id,p] of Object.entries(evaluated.provenance)){const source=workspace.snapshots.find(s=>s.source?.artworkId===p.artworkId),canonical=source&&Object.entries(source.source!.originIds).find(([,raw])=>raw===p.sourceId)?.[0];provenance[id]={elementId:canonical??p.sourceId,sourceSnapshotId:source?.id??p.artworkId,path:[source?.id??p.artworkId,snapshotId]};}
 const diagnostics:SnapshotDiagnostic[]=[{code:'LEGACY_READ_ONLY',snapshotId,message:recording.legacy!.reason},...evaluated.diagnostics.map(d=>({code:'POSE' as const,snapshotId,layerId:d.sourceLayerId,elementId:d.sourceObjectId,channelId:d.trackId,message:d.message}))];
 return {snapshotId,source:evaluated.source,baseDrawing:evaluated.source,drawing:evaluated.drawing,preShapeDrawing:evaluated.preShapeDrawing,prePlacementDrawing:evaluated.prePlacementDrawing,angle:evaluated.angle,state:emptySnapshotDeformationState(),provenance,diagnostics,warpGrids:evaluated.warpGrids,placements:evaluated.placements,placementsByLayer:evaluated.placements,paintBatches:evaluated.paintBatches,fitDiagnostics:evaluated.fitDiagnostics,warningCurveIds:evaluated.warningCurveIds,intervalTransportErrors:evaluated.intervalTransportErrors,maxError:evaluated.maxError,diagnosticStage:evaluated.diagnosticStage,conflictingNodeIds:evaluated.conflictingNodeIds,appliedTrackIds:[],layerProvenance:{},authoredTracks:recording.tracks};
}
/** Returned evaluated documents are immutable runtime values, shared by the
 * bounded cache until their live source, saved state, tracks, or options change. */
export function resolveSnapshot(workspace:RecordingSnapshotWorkspace,snapshotId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const fallback=recordingForSnapshot(workspace,snapshotId);if(fallback?.legacy)return evaluateLegacySnapshot(workspace,fallback,snapshotId,options);
 validateSnapshotGraph(workspace);const persistent=evaluationCache(workspace,options.immutableInputs),local=new Map<string,SnapshotEvaluation>(),visiting=new Set<string>(),snapshotStrings=new Map<string,string>(),trackStrings=new Map<SnapshotRecording,Map<boolean,string>>();
 const resolve=(id:string,root=false):SnapshotEvaluation=>{
  const cached=!root&&local.get(id);if(cached)return cached;
  const snapshot=workspace.snapshots.find(s=>s.id===id);if(!snapshot)throw new SnapshotResolutionError({code:'MISSING_SNAPSHOT',snapshotId:id,message:`Snapshot ${id} is missing.`});
  if(visiting.has(id))throw new SnapshotResolutionError({code:'SNAPSHOT_CYCLE',snapshotId:id,message:`Snapshot ${id} contains a parent cycle.`});visiting.add(id);
  const parents=new Map<string,SnapshotEvaluation>();for(const layer of snapshot.layers)if(layer.kind==='reference'&&workspace.snapshots.some(s=>s.id===layer.baseSnapshotId)&&!parents.has(layer.baseSnapshotId))parents.set(layer.baseSnapshotId,resolve(layer.baseSnapshotId));
  const recording=recordingForSnapshot(workspace,id),angle=root&&options.angle?options.angle:snapshot.angle,localOptions:SnapshotEvaluationOptions=root?{...options,angle}:{angle,useDraft:false,diagnostics:options.diagnostics,tolerance:options.tolerance};
  let snapshotString=snapshotStrings.get(id);if(snapshotString===undefined){snapshotString=options.immutableInputs?String(immutableIdentity(snapshot)):JSON.stringify(snapshot);snapshotStrings.set(id,snapshotString);}const drafts=localOptions.useDraft!==false;let trackString=recording&&trackStrings.get(recording)?.get(drafts);if(recording&&trackString===undefined){if(options.immutableInputs){const memo=immutableTrackStrings.get(recording.tracks)??new Map<boolean,string>();trackString=memo.get(drafts);if(trackString===undefined){trackString=JSON.stringify(recording.tracks.map(track=>[track.id,track.channel,track.targetId,track.elementId,track.channel==='interval'?track.sourceTrackId:undefined,track.interpolation,immutableIdentity(track.keys),drafts?immutableIdentity(track.draft):0,track.channel==='interval'?immutableIdentity(track.materialIssue):0]));memo.set(drafts,trackString);immutableTrackStrings.set(recording.tracks,memo);}}else trackString=JSON.stringify(drafts?recording.tracks:recording.tracks.map(({draft,...track})=>track));const strings=trackStrings.get(recording)??new Map<boolean,string>();strings.set(drafts,trackString);trackStrings.set(recording,strings);}
  const weightAssets=recording?.interpolationWeights,weightViews=new Set(weightAssets?.flatMap(asset=>[asset.startSnapshotId,asset.endSnapshotId])??[]),weightKey=weightAssets?.length?[options.immutableInputs?immutableIdentity(weightAssets):weightAssets,workspace.snapshots.filter(view=>weightViews.has(view.id)).map(view=>[view.id,view.angle])]:null;
  const parentIds=[...parents].map(([id,value])=>[id,resultIdentity(value)]),frameKey=JSON.stringify([snapshotString,trackString??'',weightKey,parentIds,evaluationOptionsKey(localOptions)]),frames=root?persistent.frames:persistent.parents,existing=frames.get(frameKey);
  if(existing){visiting.delete(id);local.set(id,existing);return root&&existing.authoredTracks!==recording?.tracks?{...existing,authoredTracks:recording?.tracks??[]}:existing;}
  const inputKey=JSON.stringify(options.immutableInputs?[id,immutableIdentity(snapshot.layers),immutableIdentity(snapshot.relations),immutableIdentity(snapshot.inheritedState?.intervalMaterialIssues),immutableIdentity(snapshot.deformation.intervalMaterialIssues),parentIds]:[id,snapshot.layers,snapshot.relations,snapshot.inheritedState?.intervalMaterialIssues,snapshot.deformation.intervalMaterialIssues,parentIds]);
  let cachedInput=persistent.inputs.get(inputKey);if(!cachedInput){const diagnostics:SnapshotDiagnostic[]=[...parents.values()].flatMap(p=>p.diagnostics),input=inputForSnapshot(workspace,snapshot,parents,diagnostics);cachedInput=persistent.inputs.set(inputKey,{input,diagnostics});}
  const input=cachedInput.input,diagnostics=[...cachedInput.diagnostics],state=evaluateSnapshotState(snapshot,recording,input.drawing,angle,root?options.useDraft!==false:false,input.appliedTrackIds,{diagnostics,signature:sourceId=>{const original=cachedOriginal(workspace,sourceId);return original?drawingSignature(original):undefined;}},workspace.snapshots);
  const appliedTrackIds=new Set(input.appliedTrackIds);for(const track of recording?.tracks??[])if(snapshot.layers.some(l=>l.id===track.targetId)||state.warps.some(w=>w.id===track.targetId)||state.relationPositions[track.targetId])appliedTrackIds.add(track.id);
  const own=evaluateOwn(snapshot,input.drawing,state,localOptions,diagnostics,persistent);
  const result:SnapshotEvaluation={snapshotId:id,source:input.drawing,baseDrawing:input.drawing,provenance:input.provenance,appliedTrackIds:[...appliedTrackIds],...own,placementsByLayer:own.placements,layerProvenance:Object.fromEntries(snapshot.layers.map(l=>[l.id,{layerId:l.id,baseSnapshotId:l.kind==='reference'?l.baseSnapshotId:id,sourceLayerId:l.kind==='reference'?l.baseLayerId:l.id}])),authoredTracks:recording?.tracks??[]};result.paintBatches=snapshotPaintBatches(workspace,snapshot,result.drawing,result.provenance);visiting.delete(id);local.set(id,result);return frames.set(frameKey,result);
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
 const result:SnapshotEvaluation={...selected,angle:{...requested},drawing:sampled.drawing,preShapeDrawing:sampled.drawing,prePlacementDrawing:sampled.drawing,diagnostics,endpointPair,
  // Endpoint fits are evidence about their endpoints only, never invented
  // intermediate fit measurements. The final controls require no refitting.
  fitDiagnostics:[],warningCurveIds:[],maxError:Math.max(basis.start.maxError,basis.end.maxError),conflictingNodeIds:[...new Set([...basis.start.conflictingNodeIds,...basis.end.conflictingNodeIds])],intervalTransportErrors:[...basis.start.intervalTransportErrors,...basis.end.intervalTransportErrors]};
 result.paintBatches=snapshotPaintBatches(workspace,snapshot,result.drawing,result.provenance);return cache.frames.set(key,result);
}
export function evaluateRecordingSnapshot(workspace:RecordingSnapshotWorkspace,recordingId:string,options:SnapshotEvaluationOptions={}):SnapshotEvaluation {
 const recording=workspace.recordings.find(r=>r.id===recordingId);if(!recording){if(workspace.snapshots.some(s=>s.id===recordingId))return resolveSnapshot(workspace,recordingId,options);throw Error('Missing recording');}
 if(recording.mode==='endpoint-pair')return evaluateEndpointPair(workspace,recording,options);
 const at=options.angle??recording.angle,ordered=recording.snapshotIds.map(id=>workspace.snapshots.find(s=>s.id===id)).filter((s):s is RecordingSnapshot=>!!s).sort((a,b)=>Math.hypot(a.angle.x-at.x,a.angle.y-at.y)-Math.hypot(b.angle.x-at.x,b.angle.y-at.y)||a.angle.y-b.angle.y||a.angle.x-b.angle.x||a.id.localeCompare(b.id));
 const snapshotId=options.snapshotId??ordered[0]?.id;if(!snapshotId)throw Error('Recording has no view snapshot');
 if(recording.legacy)return evaluateLegacySnapshot(workspace,recording,snapshotId,{...options,tolerance:options.tolerance??recording.tolerance});
 const result=resolveSnapshot(workspace,snapshotId,{...options,angle:options.angle??recording.angle,tolerance:options.tolerance??recording.tolerance});
 return result;
}
