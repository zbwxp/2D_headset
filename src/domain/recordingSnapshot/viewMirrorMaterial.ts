import type {DrawingDocument} from '../drawing/model';
import {retainSnapshotAffines} from './elementPlacement';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {InputCache} from '../geometry/cache';
import {createSnapshotMaterialPartitionBasis} from './materialSplit';
import type {Angle,SnapshotAngleGraph,SnapshotScalarPropertyTarget} from './model';
import {blendSnapshotPropertyValues,snapshotScalarPropertyTargetKey} from './propertyResponses';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {prepareSnapshotMirrorDrawing} from './snapshotMirror';
import {evaluateSnapshotSurfaceMaterial} from './surfaceMaterial';
import type {SnapshotSurfaceMirrorContext,SnapshotSurfaceMirrorMaterial} from './surfaceMirrorContext';
import type {SnapshotSimplexLocation} from './triangulation';
import {mirrorViewDrawingPresence} from './viewMirrorInput';
import type {ViewMirrorOptions} from './viewMirrorMath';

/** Material-only companion to the shared source geometry sampler. Source
 * material is evaluated once per angle, then its native supports are transported
 * to the positive final drawing. No field or sampled drawing is persisted. */
export function prepareSnapshotViewMirrorMaterial(graph:SnapshotAngleGraph,bases:readonly SnapshotSimplexBasis[],zero:DrawingDocument,options:(drawing:DrawingDocument)=>ViewMirrorOptions,sourceAt:(positive:Angle)=>{drawing:DrawingDocument;location:SnapshotSimplexLocation}):NonNullable<SnapshotSurfaceMirrorContext['material']> {
 const vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.angle])),frames=new InputCache<{drawing:DrawingDocument;diagnostics:string[]}>(96),canonical=options(zero),ids=new Set(zero.curves.map(curve=>curve.id));
 const reflect=prepareSnapshotMirrorDrawing({...canonical,curvePairs:canonical.curvePairs.filter(pair=>ids.has(pair.a)&&ids.has(pair.b)),axisX:0},zero),knownTracks=new Map((zero.displayIntervals??[]).map(track=>[track.id,new Set(track.ranges.map(range=>range.id))]));
 const targets=new Map((reflect(zero).drawing.displayIntervals??[]).map(track=>[track.id,new Set(track.ranges.map(range=>range.id))]));
 const at=(angle:Angle)=>{
  const key=JSON.stringify(angle),known=frames.get(key);if(known)return known;
  const source=sourceAt(angle),sampled=evaluateSnapshotSurfaceMaterial(graph,source.location,bases,source.drawing,{x:-angle.x,y:angle.y}),diagnostics=[...sampled.diagnostics];
  const tracks=(sampled.drawing.displayIntervals??[]).flatMap(track=>{
   const ranges=knownTracks.get(track.id);if(!ranges){diagnostics.push(`Material ${track.id} has no canonical zero mirror identity; its live mirror contribution is inactive.`);return [];}
   const retained=track.ranges.filter(range=>ranges.has(range.id));if(retained.length!==track.ranges.length)diagnostics.push(`Material ${track.id} contains a range with no canonical zero mirror identity; that live mirror contribution is inactive.`);
   return [{...track,ranges:retained}];
  });
  const input=retainSnapshotRouteMaterialInput(retainSnapshotAffines({...sampled.drawing,displayIntervals:tracks},[sampled.drawing]),sampled.drawing);
  const mirrored=mirrorViewDrawingPresence(input,zero,options(sampled.drawing),reflect);
  return frames.set(key,{drawing:mirrored.drawing,diagnostics:[...diagnostics,...mirrored.diagnostics.map(issue=>issue.message)]});
 };
 return (location,drawing):SnapshotSurfaceMirrorMaterial|undefined=>{
  const corners=location.vertexIds.map(id=>vertices.get(id)!),angle=corners.reduce((sum,corner,index)=>({x:sum.x+corner.x*location.geometricWeights[index],y:sum.y+corner.y*location.geometricWeights[index]}),{x:0,y:0});if(angle.x<=0||location.kind==='vertex')return;
  const frames=[at(angle),...corners.map(at)],diagnostics=[...new Set(frames.flatMap(frame=>frame.diagnostics))],read=createSnapshotMaterialPartitionBasis(graph.materialPartitions,frames.map((frame,index)=>({snapshotId:`mirror-material:${index}`,drawing:frame.drawing})),drawing,diagnostics,graph.materialPathLineages),values=new Map<string,{value:number;baseline:number}|undefined>();
  const available=(target:SnapshotScalarPropertyTarget)=>{
   const key=snapshotScalarPropertyTargetKey(target);if(values.has(key))return values.get(key);
   // The ordinary local path owns targets absent from canonical zero. Mirroring
   // must never manufacture a destination interval, range, layer or member.
   if(!targets.get(target.sourceTrackId)?.has(target.rangeId))return;
   try {const sampled=read(target).values,result={value:sampled[0],baseline:blendSnapshotPropertyValues(sampled.slice(1),location.geometricWeights)};values.set(key,result);return result;}
   catch(error){diagnostics.push(`Material ${target.sourceTrackId} range ${target.rangeId}: live mirror support is unavailable (${error instanceof Error?error.message:String(error)}). The native local material is retained.`);values.set(key,undefined);return;}
  };
  return {diagnostics,sample:(target,native)=>{const source=available(target);if(!source)return;const local=native-source.baseline,tolerance=128*Number.EPSILON*Math.max(1,Math.abs(native),Math.abs(source.baseline));return Math.abs(local)<=tolerance?source.value:source.value+local;}};
 };
}
