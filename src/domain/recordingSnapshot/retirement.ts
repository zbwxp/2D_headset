import type {DrawingSnapshotState} from '../drawing/snapshots';
import type {RecordingScenes} from '../recordingScene/model';
import {recordingSceneSources} from '../recordingScene/sources';
import type {VectorRecording} from '../vectorRecording/model';
import {emptyRecordingSnapshotWorkspace,type RecordingSnapshotWorkspace} from './model';
import {upsertDrawingSource} from './sources';

export const RECORDING_RETIRED_MESSAGE='旧录制已停用，当前工程仅可查看和导出源画稿。请先导出原档，再选择“仅保留画稿、清空录制后开始”。Legacy recordings are retired. Export the original file, then choose “Keep artworks and clear recordings to start” before editing.';
type RecordingProject=DrawingSnapshotState&{recordingSnapshots?:RecordingSnapshotWorkspace;recordingScenes?:RecordingScenes;vectorRecording?:VectorRecording};
export function recordingRetirementStatus(project:RecordingProject){
 const snapshots=project.recordingSnapshots;
 const oldRecordings=[
  ...(snapshots?.recordings.filter(recording=>recording.mode!=='triangulated'||!!recording.legacy).map(recording=>({id:recording.id,name:recording.name,kind:'snapshot'}))??[]),
  ...(project.recordingScenes?.scenes.map(scene=>({id:scene.id,name:scene.name,kind:'scene'}))??[]),
  ...(project.vectorRecording?.rigs.map(rig=>({id:rig.id,name:project.drawingSnapshots?.items.find(item=>item.id===rig.artworkId)?.name??'旧画稿录制',kind:'vector'}))??[]),
 ];
 if(!oldRecordings.length)return undefined;
 const recordings=[...(snapshots?.recordings.map(recording=>({id:recording.id,name:recording.name,kind:'snapshot'}))??[]),...oldRecordings.filter(recording=>recording.kind!=='snapshot')];
 return {oldRecordings,recordings,recordingCount:recordings.length,newRecordingCount:snapshots?.recordings.filter(recording=>recording.mode==='triangulated'&&!recording.legacy).length??0,snapshotCount:snapshots?.snapshots.filter(snapshot=>!snapshot.source).length??0};
}
export function assertRecordingWorkspaceActive(workspace:RecordingSnapshotWorkspace):void{
 if(workspace.recordings.some(recording=>recording.mode!=='triangulated'||!!recording.legacy))throw Error(RECORDING_RETIRED_MESSAGE);
}
export function assertRecordingProjectActive(project:RecordingProject):void{
 if(recordingRetirementStatus(project))throw Error(RECORDING_RETIRED_MESSAGE);
}
/** A clean source workspace does not evaluate, convert, or archive recordings. */
export function sourceOnlyRecordingWorkspace(project:DrawingSnapshotState):RecordingSnapshotWorkspace{
 let workspace=emptyRecordingSnapshotWorkspace();
 for(const [artworkId,drawing] of Object.entries(recordingSceneSources(project)))workspace=upsertDrawingSource(workspace,artworkId,drawing,project.drawingSnapshots?.items.find(item=>item.id===artworkId)?.name??'Current drawing');
 return workspace;
}
/** Called only by the reviewed reset action; all recording relationships go together. */
export function clearRecordingRelationships<T extends RecordingProject>(project:T):T&{recordingSnapshots:RecordingSnapshotWorkspace}{
 const {recordingSnapshots:oldSnapshots,recordingScenes,vectorRecording,...sources}=project;
 void oldSnapshots;void recordingScenes;void vectorRecording;
 return {...sources,recordingSnapshots:sourceOnlyRecordingWorkspace(project)} as T&{recordingSnapshots:RecordingSnapshotWorkspace};
}
