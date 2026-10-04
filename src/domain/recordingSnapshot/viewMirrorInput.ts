import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {finitePoint,type DrawingDocument} from '../drawing/model';
import type {MirrorCurvePair} from '../drawing/mirrorEditing';
import {retainSnapshotAffines} from './elementPlacement';
import {pruneSnapshotTopologyNodes} from './nodeForks';
import {validateSnapshotMirrorMetadata} from './mirrorMetadata';
import type {RecordingSnapshotWorkspace} from './model';
import {mirrorViewDrawing,ViewMirrorError,type ViewMirrorDiagnostic,type ViewMirrorOptions,type ViewMirrorResult} from './viewMirrorMath';

/** Resolve declarations before the ordinary visible-membership adapter removes
 * incomplete pairs. A missing counterpart must never turn into a self mirror. */
export function snapshotViewMirrorCurvePairs(workspace:RecordingSnapshotWorkspace,snapshotId:string,fallback:ViewMirrorOptions['curvePairs']=[]):ViewMirrorOptions['curvePairs'] {
 const done=new Map<string,{declared:boolean;pairs:Map<string,MirrorCurvePair>}>(),visiting=new Set<string>();
 const visit=(id:string):{declared:boolean;pairs:Map<string,MirrorCurvePair>}=>{
  const cached=done.get(id);if(cached)return cached;
  if(visiting.has(id))throw Error(`View mirror metadata cycle at ${id}.`);visiting.add(id);
  const snapshot=workspace.snapshots.find(snapshot=>snapshot.id===id);if(!snapshot)return {declared:false,pairs:new Map()};
  const local=snapshot.relations.mirrorEditing?.curvePairs,parents=new Set(snapshot.layers.flatMap(layer=>layer.kind==='reference'?[layer.baseSnapshotId]:[]));for(const sourceId of Object.values(snapshot.memberSources??{}))parents.add(sourceId);
  if(snapshot.parentSnapshotId&&(snapshot.parentLayers||snapshot.inputMirror))parents.add(snapshot.parentSnapshotId);
  const pairs=new Map<string,MirrorCurvePair>(),inherited=[...parents].map(visit);const declared=!!snapshot.source?.mirrorEditing||!!local||inherited.some(source=>source.declared);
  for(const pair of [...snapshot.source?.mirrorEditing?.curvePairs??[],...inherited.flatMap(source=>[...source.pairs.values()])]){
   const previous=pairs.get(pair.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(pair)&&!local?.update?.some(value=>value.id===pair.id)&&!local?.disable?.includes(pair.id))throw Error(`Inherited mirror pair ${pair.id} has conflicting definitions.`);pairs.set(pair.id,pair);
  }
  for(const id of local?.disable??[])pairs.delete(id);for(const pair of [...local?.add??[],...local?.update??[]])pairs.set(pair.id,pair);
  const result={declared,pairs};visiting.delete(id);done.set(id,result);return result;
 };
 const resolved=visit(snapshotId),pairs=resolved.declared?[...resolved.pairs.values()]:fallback;
 validateSnapshotMirrorMetadata({curvePairs:{add:[...pairs]}});return pairs;
}

/** Restrict only actual curve presence and its dependents. Retain material
 * adapters; use the existing route resolver and node-pruning law. No repair,
 * reanchoring, nearest-member choice, or original drawing edit occurs here. */
function restrictMirrorPresence(drawing:DrawingDocument,curveIds:ReadonlySet<string>):DrawingDocument {
 if(drawing.curves.every(curve=>curveIds.has(curve.id)))return drawing;
 const curves=drawing.curves.filter(curve=>curveIds.has(curve.id)),fills=drawing.fills.filter(fill=>fill.boundary.every(use=>curveIds.has(use.id))),offsets=drawing.offsets.filter(offset=>offset.source.every(use=>curveIds.has(use.id))),objects=new Set([...curves,...fills,...offsets].map(value=>value.id));
 const result:DrawingDocument={...drawing,curves,fills,offsets,layers:drawing.layers.map(layer=>({...layer,items:layer.items.filter(id=>objects.has(id))})),joins:drawing.joins.filter(join=>curveIds.has(join.a.curveId)&&curveIds.has(join.b.curveId)),endpointLinks:drawing.endpointLinks?.filter(link=>curveIds.has(link.a.curveId)&&curveIds.has(link.b.curveId)),groups:drawing.groups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})).filter(group=>group.curveIds.length)};
 const links=new Set(result.endpointLinks?.map(link=>link.id));
 result.displayIntervals=drawing.displayIntervals?.filter(track=>curveIds.has(track.anchor.id)&&(!track.displayRoute||track.displayRoute.seed.segments.every(use=>curveIds.has(use.id))&&track.displayRoute.throughLinkIds.every(id=>links.has(id))&&!resolveDisplayRoute(result,track.displayRoute,{deferEndpointPositions:true}).diagnostics.length));
 return pruneSnapshotTopologyNodes(retainSnapshotAffines(result,[drawing]));
}

/** Partial canonical coverage is a runtime presence decision, never a weaker
 * mirror kernel. Missing zero inputs omit that positive sample and leave the
 * native negative sample available to the ordinary read-only red fallback. */
export function mirrorViewDrawingPresence(current:DrawingDocument,zero:DrawingDocument,options:ViewMirrorOptions):ViewMirrorResult {
 validateSnapshotMirrorMetadata({curvePairs:{add:[...options.curvePairs]}});
 for(const node of current.nodes)if(!finitePoint(node.position))throw new ViewMirrorError([{code:'INVALID_REFERENCE',entityKind:'nodes',entityId:node.id,message:`Current node ${node.id} has non-finite controls.`}]);
 for(const curve of current.curves)if(curve.handles.some(point=>!finitePoint(point)))throw new ViewMirrorError([{code:'INVALID_REFERENCE',entityKind:'curves',entityId:curve.id,message:`Current curve ${curve.id} has non-finite controls.`}]);
 const zeroCurves=new Map(zero.curves.map(curve=>[curve.id,curve])),zeroNodes=new Set(zero.nodes.map(node=>node.id)),currentNodes=new Set(current.nodes.map(node=>node.id)),pairs=new Map(options.curvePairs.flatMap(pair=>[[pair.a,pair],[pair.b,pair]] as const)),diagnostics:ViewMirrorDiagnostic[]=[],eligible=new Set<string>();
 const validZero=(id:string)=>{const curve=zeroCurves.get(id);return !!curve&&curve.nodes.every(id=>zeroNodes.has(id));};
 for(const curve of current.curves){
  if(curve.nodes.some(id=>!currentNodes.has(id)))throw Error(`Current curve ${curve.id} has a missing endpoint; this is not a zero-baseline coverage omission.`);
  const pair=pairs.get(curve.id),target=pair?(pair.a===curve.id?pair.b:pair.a):curve.id,baseline=zeroCurves.get(curve.id);
  if(!validZero(curve.id)||!validZero(target)){const missing=[...new Set([curve.id,target])].flatMap(id=>{const baseline=zeroCurves.get(id);return baseline?baseline.nodes.filter(nodeId=>!zeroNodes.has(nodeId)).map(nodeId=>`node ${nodeId}`):[`curve ${id}`];});diagnostics.push({code:'MISSING_ZERO_ENTITY',entityKind:'curves',entityId:curve.id,message:`Curve ${curve.id} cannot mirror to canonical target ${target}: zero is missing ${missing.join(', ')}; its positive sample is absent.`});continue;}
  if(curve.nodes.some((id,end)=>baseline!.nodes[end]!==id)){diagnostics.push({code:'ZERO_TOPOLOGY_MISMATCH',entityKind:'curves',entityId:curve.id,message:`Curve ${curve.id} has different canonical zero endpoints; its positive sample for ${target} is absent.`});continue;}
  eligible.add(curve.id);
 }
 const availablePairs=options.curvePairs.filter(pair=>validZero(pair.a)&&validZero(pair.b)),zeroEligible=new Set(zero.curves.filter(curve=>validZero(curve.id)).map(curve=>curve.id));
 const filtered={...options,curvePairs:availablePairs,axisNodeIds:options.axisNodeIds?.filter(id=>zeroNodes.has(id)),unpairedGroups:options.unpairedGroups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>eligible.has(id))})).filter(group=>group.curveIds.length)};
 const result=mirrorViewDrawing(restrictMirrorPresence(current,eligible),restrictMirrorPresence(zero,zeroEligible),filtered);return {...result,diagnostics:[...diagnostics,...result.diagnostics]};
}
