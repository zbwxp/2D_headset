import {snapshotDrawing,type DrawingSnapshotState} from '../drawing/snapshots';
import type {DrawingDocument} from '../drawing/model';

/** The active working drawing wins over its saved checkpoint. All instances
 * resolve the same live asset; a scene never owns a private geometry snapshot. */
export function recordingSceneSources(project:DrawingSnapshotState):Record<string,DrawingDocument>{
 const library=project.drawingSnapshots;
 const sources=new Map<string,DrawingDocument>(library?.items.map(item=>[item.id,snapshotDrawing(library,item.id)])??[]);
 for(const [id,drawing] of Object.entries(project.drawingWorkingCopies??{}))if(library?.items.some(a=>a.id===id))sources.set(id,drawing);
 if(project.drawing)sources.set(library?.activeId??'$working',project.drawing);
 return Object.fromEntries(sources);
}
export function resolveRecordingSceneSource(project:DrawingSnapshotState,artworkId:string):DrawingDocument|undefined{
 const sources=recordingSceneSources(project);
 return Object.hasOwn(sources,artworkId)?sources[artworkId]:undefined;
}
