import {create} from 'zustand';
import {useEditor} from '../../app/store';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {captureDrawingLayerClipboard,captureSnapshotLayerClipboard,type SnapshotReferenceClipboard} from '../../domain/recordingSnapshot/referenceClipboard';

interface LayerReferenceClipboardSession {
 projectId:string;
 clipboard:SnapshotReferenceClipboard|null;
 bindProject:(projectId:string)=>void;
 capture:(clipboard:SnapshotReferenceClipboard)=>void;
 clear:()=>void;
}

/** Layer references are session state, shared by both rooms. They deliberately
 * outlive a mounted room or a selected snapshot, but never a project switch. */
export const createLayerReferenceClipboardSession=(projectId:string)=>create<LayerReferenceClipboardSession>((set,get)=>({
 projectId,clipboard:null,
 bindProject:projectId=>{if(projectId!==get().projectId)set({projectId,clipboard:null});},
 capture:clipboard=>{
  if(clipboard.projectId!==get().projectId)throw Error('Clipboard belongs to another project.');
  set({clipboard:captureSnapshotLayerClipboard(clipboard.projectId,clipboard.intent,clipboard.sources)});
 },
 clear:()=>set({clipboard:null}),
}));

export const layerClipboardProjectId=(state=useEditor.getState()):string=>JSON.stringify([state.project.meta.createdAt,state.projectSessionId]);
export const useLayerClipboardProjectId=()=>useEditor(layerClipboardProjectId);
export const useLayerReferenceClipboard=createLayerReferenceClipboardSession(layerClipboardProjectId());
// Observe the project itself rather than room lifecycle effects. This also
// clears A's clipboard after A → B → A while neither room is mounted.
useEditor.subscribe((state,previous)=>{
 const projectId=layerClipboardProjectId(state);if(projectId!==layerClipboardProjectId(previous))useLayerReferenceClipboard.getState().bindProject(projectId);
});

/** Preparing a Drawing address is read-only, including before its first V2
 * migration. The deterministic source IDs match the later shared transaction. */
export function captureDrawingLayerReferences(project:LandmarkProject,artworkId:string,layerIds:readonly string[],intent:SnapshotReferenceClipboard['intent']='reference',projectId=String(project.meta.createdAt)):SnapshotReferenceClipboard {
 const {recordingSnapshots}=ensureRecordingSnapshots(project);
 return captureDrawingLayerClipboard(recordingSnapshots,projectId,artworkId,layerIds,intent);
}
