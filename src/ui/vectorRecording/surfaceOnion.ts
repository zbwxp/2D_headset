import {shapeOf} from '../../domain/drawing/model';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {preparedRecordingContextForEvaluation,preparedRecordingOptionsForEvaluation} from '../../domain/recordingSnapshot/preparedRecordingContext';
import {markSceneOnionHighlights,type SceneOnionFrame} from './angleInspection';
import {sampleEndpointOnionAngles,type SceneOnionEndpoints} from './endpointOnion';

/** All ghosts request complete cubic controls from the same prepared Recorder
 * that produced the canvas. Required basis dependencies are shared; terminal
 * interval transport, ARC trimming and ink tessellation are not requested. */
export function interpolateSnapshotSurfaceOnion(recording:SnapshotRecording,current:SnapshotEvaluation,endpoints:SceneOnionEndpoints,step:5|10):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const surface=current.angleSurface,graph=surface?.responseGraph??recording.angleGraph;if(!graph||!surface)throw Error('A triangulated recording evaluation is required for this inspection.');
 const first=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.startSnapshotId),last=graph.mesh.vertices.find(vertex=>vertex.snapshotId===endpoints.endSnapshotId);
 if(!first||!last||first.id===last.id)throw Error('Choose two different real snapshot bindings.');
 const diagnostics=new Set<string>(),context=preparedRecordingContextForEvaluation(current),policy=preparedRecordingOptionsForEvaluation(current),angles=sampleEndpointOnionAngles(first.angle,last.angle,step);
 if(!context)throw Error('Onion sampling requires the Recording preparation context that produced this frame.');
 const results=context.sampleMany(recording.id,angles.map(({angle})=>({...policy,angle,products:'controls'})));
 const frames=results.map((result,index):SceneOnionFrame=>{
  for(const diagnostic of result.diagnostics)diagnostics.add(diagnostic.message);
  const drawing=result.drawing,centerlines=[...drawing.curves.map(curve=>({id:`curve:${curve.id}`,cubic:shapeOf(drawing,curve.id)})),...(result.angleSurface?.outsideCurves??[]).map(curve=>({id:`outside:${curve.curveId}`,cubic:curve.cubic,outside:true}))];
  return {angle:angles[index].angle,drawing,paintBatches:[],centerlines};
 });
 const axis=Math.abs(first.angle.x-last.angle.x)>=Math.abs(first.angle.y-last.angle.y)?'x':'y';
 return {frames:markSceneOnionHighlights(frames,{enabled:true,axis,step,min:Math.min(first.angle[axis],last.angle[axis]),max:Math.max(first.angle[axis],last.angle[axis]),opacity:1}),diagnostics:[...diagnostics]};
}
