import {emptyDrawing,shapeOf} from '../../domain/drawing/model';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {prepareSnapshotCoverage} from '../../domain/recordingSnapshot/snapshotCoverage';
import {createSnapshotSurfaceResponseSampler} from '../../domain/recordingSnapshot/surfaceTargets';
import {markSceneOnionHighlights,type SceneOnionFrame} from './angleInspection';
import {sampleEndpointOnionAngles,type SceneOnionEndpoints} from './endpointOnion';

/** Resolve bases once in the main canvas, then reuse only complete cubic control
 * sampling for every ghost. No snapshot/track resolution, material transport,
 * ARC trimming or ink tessellation happens inside this sweep. */
export function interpolateSnapshotSurfaceOnion(recording:SnapshotRecording,current:SnapshotEvaluation,endpoints:SceneOnionEndpoints,step:5|10):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const graph=recording.angleGraph,surface=current.angleSurface;if(!graph||!surface)throw Error('A triangulated recording evaluation is required for this inspection.');
 const first=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.startSnapshotId),last=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.endSnapshotId);
 if(!first||!last||first.id===last.id)throw Error('Choose two different real snapshot bindings.');
 const prepared=prepareSnapshotCoverage(graph.mesh,surface.allBases.map(base=>({snapshotId:base.snapshotId,drawing:base.drawing,angle:graph.mesh.vertices.find(vertex=>vertex.snapshotId===base.snapshotId)!.angle}))),diagnostics=new Set<string>();
 const samplers=new Map<string,ReturnType<typeof createSnapshotSurfaceResponseSampler>>();
 const frames=sampleEndpointOnionAngles(first.angle,last.angle,step).map(({angle}):SceneOnionFrame=>{
  const sampled=prepared.evaluate(angle,location=>{const key=JSON.stringify([location.simplexId,location.vertexIds]);let sampler=samplers.get(key);if(!sampler){sampler=createSnapshotSurfaceResponseSampler(graph,location);samplers.set(key,sampler);}return sampler;});
  for(const message of sampled.diagnostics)diagnostics.add(message);
  const drawing=sampled.normal?.drawing??emptyDrawing(),centerlines=[...drawing.curves.map(curve=>({id:`curve:${curve.id}`,cubic:shapeOf(drawing,curve.id)})),...sampled.outsideCurves.map(curve=>({id:`outside:${curve.curveId}`,cubic:curve.cubic,outside:true}))];
  return {angle,drawing,paintBatches:[],centerlines};
 });
 const axis=Math.abs(first.angle.x-last.angle.x)>=Math.abs(first.angle.y-last.angle.y)?'x':'y';
 return {frames:markSceneOnionHighlights(frames,{enabled:true,axis,step,min:Math.min(first.angle[axis],last.angle[axis]),max:Math.max(first.angle[axis],last.angle[axis]),opacity:1}),diagnostics:[...diagnostics]};
}
