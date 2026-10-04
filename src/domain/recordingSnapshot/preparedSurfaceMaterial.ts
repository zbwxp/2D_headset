import type {DrawingDocument} from '../drawing/model';
import {displayPath} from '../drawing/displayIntervals';
import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {evaluatedAffine} from '../drawing/evaluatedAffine';
import {hasEvaluatedDeformation} from '../drawing/evaluatedDeformation';
import {drawingMaterialPathDependencies,withDrawingReadScope} from '../drawing/readContext';
import type {Angle,SnapshotAngleGraph} from './model';
import {snapshotSimplexDrawingRevision,type SnapshotScalarTarget,type SnapshotSimplexBasis,type SnapshotSimplexRevisionChanges} from './simplexGeometry';
import {countSnapshotSimplexMaterialWork,transportSnapshotSimplexMaterial,type SnapshotSimplexMaterialResult,type SnapshotSimplexMaterialOptions} from './simplexMaterial';
import type {SnapshotSimplexLocation} from './triangulation';
import type {SnapshotSurfaceMirrorContext} from './surfaceMirrorContext';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';

export interface SnapshotSurfaceMaterialResult {drawing:DrawingDocument;diagnostics:string[];/** Valid native routes and unchanged complete structural/source proof. */paintLayoutUnchanged?:true}
export interface SnapshotSurfaceMaterialEvaluationOptions {
 /** Immutable native evaluations opt in once; mutable drawing clones never do. */
 retainLineage?:boolean;
 previous?:SnapshotSurfaceMaterialResult;
 /** Complete controls-only transaction, never a UI selection or coarse hint. */
 changes?:SnapshotSimplexRevisionChanges;
}
export interface SnapshotSurfaceMaterialInputs {
 graph:SnapshotAngleGraph;location:SnapshotSimplexLocation;bases:readonly SnapshotSimplexBasis[];input:DrawingDocument;angle:Angle;mirror?:SnapshotSurfaceMirrorContext;
}
interface RoutePorts {pairs:readonly (readonly [number,number])[]}
interface DocumentPlan {
 trackIndices:ReadonlyMap<string,number>;
 nodeSlots:ReadonlyMap<string,number>;
 curveSlots:ReadonlyMap<string,number>;
 nodeCurves:ReadonlyMap<string,readonly string[]>;
 curveTracks:ReadonlyMap<string,ReadonlySet<number>>;
 curveRoutes:ReadonlyMap<string,ReadonlySet<number>>;
 routes:readonly RoutePorts[];
}
interface PreparedMaterial {
 inputs:SnapshotSurfaceMaterialInputs;
 stamp:readonly unknown[];
 plans:readonly DocumentPlan[];
 layerIds:ReadonlyMap<string,string>;
 trackDiagnostics:string[][];
 options:SnapshotSimplexMaterialOptions;
}
const prepared=new WeakMap<SnapshotSurfaceMaterialResult,PreparedMaterial>();
const add=<T>(map:Map<string,Set<T>>,id:string,value:T)=>{let values=map.get(id);if(!values){values=new Set();map.set(id,values);}values.add(value);};
const native=(drawing:DrawingDocument)=>!hasEvaluatedDeformation(drawing)&&!drawing.curves.some(curve=>evaluatedAffine(drawing,curve.id));
const stamp=(graph:SnapshotAngleGraph):readonly unknown[]=>[
 graph.mesh,graph.propertyResponses,graph.materialRecipes,graph.materialBasisRecipes,graph.materialPartitions,graph.materialPathLineages,
 graph.visibilityRecipes,graph.visibilityBasisRecipes,graph.viewMirror,
 ...(graph.correctionFrames??[]).filter(frame=>frame.status==='draft'&&frame.propertyResponses).flatMap(frame=>[frame.id,frame.angle.x,frame.angle.y,frame.propertyResponses]),
];
const supported=({graph,location,bases,mirror}:SnapshotSurfaceMaterialInputs)=>location.kind!=='vertex'&&!mirror&&!graph.materialRecipes?.[location.simplexId]&&!graph.materialPartitions?.length&&!graph.materialPathLineages?.length&&!graph.visibilityRecipes?.[location.simplexId]&&!bases.some(basis=>graph.materialBasisRecipes?.[basis.snapshotId]||graph.visibilityBasisRecipes?.[basis.snapshotId]);
function prepareDocument(drawing:DrawingDocument,output:DrawingDocument):DocumentPlan|undefined {
 if(!native(drawing))return undefined;
 const tracks=drawing.displayIntervals??[],trackIndices=new Map(tracks.map((track,index)=>[track.id,index]));
 if(trackIndices.size!==tracks.length)return undefined;
 const nodes=new Map(drawing.nodes.map((node,index)=>[node.id,index])),curves=new Map(drawing.curves.map(curve=>[curve.id,curve]));
 if(nodes.size!==drawing.nodes.length||curves.size!==drawing.curves.length)return undefined;
 const nodeCurves=new Map<string,string[]>(),curveTracks=new Map<string,Set<number>>(),curveRoutes=new Map<string,Set<number>>(),routes:RoutePorts[]=[];
 for(const curve of drawing.curves)for(const id of curve.nodes)nodeCurves.set(id,[...nodeCurves.get(id)??[],curve.id]);
 // Every valid route participates in global route precedence. Its topology is
 // frozen; only its explicit port positions can invalidate it in this phase.
 // Invalid baseline routes cannot establish a complete retained path proof.
 for(const track of tracks){
  if(!track.displayRoute)continue;
  const resolved=resolveDisplayRoute(drawing,track.displayRoute);if(resolved.diagnostics.length)return undefined;
  const pairs:(readonly [number,number])[]=[],routeIndex=routes.length;
  for(const id of track.displayRoute.throughLinkIds){
   const link=drawing.endpointLinks?.find(value=>value.id===id);if(!link)return undefined;
   const a=curves.get(link.a.curveId),b=curves.get(link.b.curveId),ai=a&&nodes.get(a.nodes[link.a.end]),bi=b&&nodes.get(b.nodes[link.b.end]);
   if(ai===undefined||bi===undefined)return undefined;
   pairs.push([ai,bi]);add(curveRoutes,link.a.curveId,routeIndex);add(curveRoutes,link.b.curveId,routeIndex);
  }
  routes.push({pairs});
 }
 for(const [index,selected] of (output.displayIntervals??[]).entries()){
  const source=tracks[trackIndices.get(selected.id)!];if(!source)return undefined;
  const path=displayPath(drawing,source.anchor.id);if(!path)return undefined;
  const closure=drawingMaterialPathDependencies(drawing,path.segments.map(use=>use.id));if(!closure)return undefined;
  for(const id of closure.dependencies.curveIds)add(curveTracks,id,index);
 }
 return {trackIndices,nodeSlots:nodes,curveSlots:new Map(drawing.curves.map((curve,index)=>[curve.id,index])),nodeCurves,curveTracks,curveRoutes,routes};
}
function dirtySourceCurves(plan:DocumentPlan,targets:readonly SnapshotScalarTarget[],before:DrawingDocument,current:DrawingDocument):Set<string>|undefined {
 const result=new Set<string>(),samePoint=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 for(const target of targets){
  if(target.kind==='handle'){
   const index=plan.curveSlots.get(target.curveId);if(index===undefined)continue;
   const prior=before.curves[index],curve=current.curves[index];if(prior?.id!==target.curveId||curve?.id!==target.curveId||evaluatedAffine(current,target.curveId))return undefined;
   if(!samePoint(prior.handles[target.end],curve.handles[target.end]))result.add(target.curveId);
  }else{
   const index=plan.nodeSlots.get(target.nodeId);if(index===undefined)continue;
   const prior=before.nodes[index],node=current.nodes[index];if(prior?.id!==target.nodeId||node?.id!==target.nodeId)return undefined;
   for(const id of plan.nodeCurves.get(target.nodeId)??[]){if(evaluatedAffine(current,id))return undefined;if(!samePoint(prior.position,node.position))result.add(id);}
  }
 }
 return result;
}
function validDirtyRoutes(drawing:DrawingDocument,plan:DocumentPlan,dirty:ReadonlySet<string>):boolean {
 const affected=new Set<number>();for(const id of dirty)for(const index of plan.curveRoutes.get(id)??[])affected.add(index);
 for(const index of affected)for(const [a,b] of plan.routes[index].pairs){const p=drawing.nodes[a]?.position,q=drawing.nodes[b]?.position;if(!p||!q||Math.hypot(p[0]-q[0],p[1]-q[1])>1e-7)return false;}
 return true;
}
/** Compile one reverse consumer index from frozen native input and source
 * support. It deliberately contains no alternate material transport math. */
export function retainPreparedSnapshotSurfaceMaterial(result:SnapshotSurfaceMaterialResult,material:SnapshotSimplexMaterialResult,inputs:SnapshotSurfaceMaterialInputs,options:SnapshotSimplexMaterialOptions):void {
 if(!supported(inputs)||inputs.bases.length<2)return;
 const plans=withDrawingReadScope(()=>[inputs.input,...inputs.bases.map(basis=>basis.drawing)].map(drawing=>prepareDocument(drawing,inputs.input)));
 if(plans.some(plan=>!plan))return;
 const layerIds=new Map<string,string>();for(const track of inputs.input.displayIntervals??[]){const layer=inputs.input.layers.find(layer=>layer.items.includes(track.anchor.id));if(layer)layerIds.set(track.id,layer.id);}
 prepared.set(result,{inputs,stamp:stamp(inputs.graph),plans:plans as DocumentPlan[],layerIds,trackDiagnostics:material.trackDiagnostics??[],options});countSnapshotSimplexMaterialWork('dependencyPlans');
}
/** The opaque previous normal-drawing token proves actual final curve changes.
 * Basis controls are an independent source dependency: source material can move
 * even when its weighted final controls cancel. No scene diff is performed. */
export function revisePreparedSnapshotSurfaceMaterial(inputs:SnapshotSurfaceMaterialInputs,revision:SnapshotSurfaceMaterialEvaluationOptions):SnapshotSurfaceMaterialResult|undefined {
 const previous=revision.previous,changes=revision.changes,plan=previous&&prepared.get(previous),geometry=snapshotSimplexDrawingRevision(inputs.input);
 if(!previous||!plan||!changes?.structureUnchanged||!geometry||geometry.previous!==plan.inputs.input||!supported(inputs))return undefined;
 const before=plan.inputs,currentStamp=stamp(inputs.graph);
 if(currentStamp.length!==plan.stamp.length||currentStamp.some((value,index)=>value!==plan.stamp[index])||inputs.angle.x!==before.angle.x||inputs.angle.y!==before.angle.y||inputs.location.kind!==before.location.kind||inputs.location.simplexId!==before.location.simplexId||inputs.location.geometricWeights.some((value,index)=>value!==before.location.geometricWeights[index])||inputs.bases.length!==before.bases.length)return undefined;
 const sourceDirty:Set<string>[]=[];
 for(const [index,basis] of inputs.bases.entries()){
  const prior=before.bases[index],targets=changes.basisControls.get(basis.snapshotId);
  if(basis.snapshotId!==prior.snapshotId||basis.angle?.x!==prior.angle?.x||basis.angle?.y!==prior.angle?.y||basis.drawing!==prior.drawing&&!targets||hasEvaluatedDeformation(basis.drawing))return undefined;
  const dirty=dirtySourceCurves(plan.plans[index+1],targets??[],prior.drawing,basis.drawing);if(!dirty)return undefined;sourceDirty.push(dirty);
 }
 const dirty=[new Set(geometry.dirtyCurveIds),...sourceDirty],drawings=[inputs.input,...inputs.bases.map(basis=>basis.drawing)],indices=new Set<number>();
 for(const [index,ids] of dirty.entries()){
  if(hasEvaluatedDeformation(drawings[index])||[...ids].some(id=>evaluatedAffine(drawings[index],id))||!validDirtyRoutes(drawings[index],plan.plans[index],ids))return undefined;
  for(const id of ids)for(const track of plan.plans[index].curveTracks.get(id)??[])indices.add(track);
 }
 const drawing=retainSnapshotRouteMaterialInput({...inputs.input},inputs.input),material=transportSnapshotSimplexMaterial(inputs.bases,drawing,inputs.location.geometricWeights,{...plan.options,reuse:{intervals:previous.drawing.displayIntervals??[],dirtyTrackIndices:[...indices].sort((a,b)=>a-b),trackDiagnostics:plan.trackDiagnostics,basisTrackIndices:plan.plans.slice(1).map(plan=>plan.trackIndices),layerIds:plan.layerIds}});
 const result:SnapshotSurfaceMaterialResult={drawing:material.drawing,diagnostics:material.diagnostics,paintLayoutUnchanged:true};
 prepared.set(result,{...plan,inputs,trackDiagnostics:material.trackDiagnostics??[]});countSnapshotSimplexMaterialWork('revisionSamples');return result;
}
