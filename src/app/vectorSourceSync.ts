import type {LandmarkProject} from '../domain/landmarks/model';
import {parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {drawingSignature,sourceArtworkId} from '../domain/vectorRecording/model';
import {synchronizeCompatibleSource} from '../domain/vectorRecording/sourceCompatibility';
import legacyExampleSource from '../assets/recording-source-baseline.json';

// Only an exact accepted-source hash can authorize legacy material migration.
// Imported examples keep their source IDs; this never replaces edited Drawing.
const bundledBaseline=parseDrawing(legacyExampleSource);
export function recordingSourceBaselines(project:Pick<LandmarkProject,'drawing'|'drawingSnapshots'>):DrawingDocument[]{
 return [...(project.drawing?[project.drawing]:[]),...(project.drawingSnapshots?.items.map(item=>item.drawing)??[])];
}
export async function loadKnownRecordingSourceBaselines():Promise<DrawingDocument[]>{return [bundledBaseline];}

/** Commit source coordinates and their material-key migration in the same
 * project/history entry. Grid domains, keys, bindings and draft intent survive.
 * Structural and unprovable legacy changes retain the existing review policy. */
export function syncVectorRecordingSources(project:LandmarkProject,baselines:readonly DrawingDocument[]=[]):LandmarkProject{
 const recording=project.vectorRecording;if(!recording)return project;
 const candidates=[bundledBaseline,...baselines,...recordingSourceBaselines(project)],bySignature=new Map(candidates.map(d=>[drawingSignature(d),d]));
 const active=sourceArtworkId(project.drawingSnapshots?.activeId);
 const rigs=recording.rigs.map(rig=>{
  const source=rig.artworkId===active?project.drawing:project.drawingSnapshots?.items.find(item=>item.id===rig.artworkId)?.drawing;
  if(!source||rig.sourceSignature===drawingSignature(source))return rig;
  const before=rig.sourceSignature&&bySignature.get(rig.sourceSignature);
  return before?synchronizeCompatibleSource(rig,before,source)??rig:rig;
 });
 return rigs.every((rig,i)=>rig===recording.rigs[i])?project:{...project,vectorRecording:{...recording,rigs}};
}
