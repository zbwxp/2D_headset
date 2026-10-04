import {emptyDrawing,shapeOf} from '../../domain/drawing/model';
import {snapshotSurfaceBasesAtAngle,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {prepareSnapshotCoverage} from '../../domain/recordingSnapshot/snapshotCoverage';
import {createSnapshotSurfaceValueSampler} from '../../domain/recordingSnapshot/surfaceTargets';
import {markSceneOnionHighlights,type SceneOnionFrame} from './angleInspection';
import {sampleEndpointOnionAngles,type SceneOnionEndpoints} from './endpointOnion';

/** Resolve bases once in the main canvas, then reuse only complete cubic control
 * sampling for every ghost. No snapshot/track resolution, material transport,
 * ARC trimming or ink tessellation happens inside this sweep. */
export function interpolateSnapshotSurfaceOnion(recording:SnapshotRecording,current:SnapshotEvaluation,endpoints:SceneOnionEndpoints,step:5|10):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const surface=current.angleSurface,graph=surface?.responseGraph??recording.angleGraph;if(!graph||!surface)throw Error('A triangulated recording evaluation is required for this inspection.');
 const first=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.startSnapshotId),last=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.endSnapshotId);
 if(!first||!last||first.id===last.id)throw Error('Choose two different real snapshot bindings.');
 const diagnostics=new Set<string>(),preparations=new Map<SnapshotEvaluation[],ReturnType<typeof prepareSnapshotCoverage>>();
 const samplers=new Map<string,ReturnType<typeof createSnapshotSurfaceValueSampler>>();
 const frames=sampleEndpointOnionAngles(first.angle,last.angle,step).map(({angle}):SceneOnionFrame=>{
  const bases=snapshotSurfaceBasesAtAngle(surface,angle);let prepared=preparations.get(bases);if(!prepared){prepared=prepareSnapshotCoverage(graph.mesh,bases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:graph.mesh.vertices.find(vertex=>vertex.snapshotId===base.snapshotId)!.angle})));preparations.set(bases,prepared);}
  const sampled=prepared.evaluate(angle,location=>{const key=JSON.stringify([angle.x>0?'positive':'negative',location.simplexId,location.vertexIds]);let sampler=samplers.get(key);if(!sampler){sampler=createSnapshotSurfaceValueSampler(graph,location,bases,surface.mirrorContext);samplers.set(key,sampler);}return sampler;});
  for(const message of sampled.diagnostics)diagnostics.add(message);
  const drawing=sampled.normal?.drawing??emptyDrawing(),centerlines=[...drawing.curves.map(curve=>({id:`curve:${curve.id}`,cubic:shapeOf(drawing,curve.id)})),...sampled.outsideCurves.map(curve=>({id:`outside:${curve.curveId}`,cubic:curve.cubic,outside:true}))];
  return {angle,drawing,paintBatches:[],centerlines};
 });
 const axis=Math.abs(first.angle.x-last.angle.x)>=Math.abs(first.angle.y-last.angle.y)?'x':'y';
 return {frames:markSceneOnionHighlights(frames,{enabled:true,axis,step,min:Math.min(first.angle[axis],last.angle[axis]),max:Math.max(first.angle[axis],last.angle[axis]),opacity:1}),diagnostics:[...diagnostics]};
}
