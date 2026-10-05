import {create} from 'zustand';
import {useEditor} from '../../app/store';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {captureDrawingLayerClipboard,captureSnapshotLayerClipboard,planSnapshotClipboardPaste,prepareSnapshotReferencePaste,type SnapshotReferenceClipboard} from '../../domain/recordingSnapshot/referenceClipboard';
import {drawingSnapshotPresentation} from './snapshotPresentation';
import {composePreparedSnapshotEdits,prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';

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
 const view=drawingSnapshotPresentation(recordingSnapshots,artworkId);
 if(view){const ids=layerIds.map(id=>{const owner=view.layerOwners.get(id);if(!owner)throw Error(`Drawing layer ${id} is no longer available.`);return owner.layerId;});return captureSnapshotLayerClipboard(projectId,intent,[{snapshotId:view.snapshotId,layerIds:ids}]);}
 return captureDrawingLayerClipboard(recordingSnapshots,projectId,artworkId,layerIds,intent);
}

/** Explicit-target paste never switches Recording selection or creates an
 * additional parent. Geometry and IDs stay owned by their captured snapshot. */
export function prepareDrawingLayerReferencePaste(project:LandmarkProject,clipboard:SnapshotReferenceClipboard,projectId:string){
 const {recordingSnapshots}=ensureRecordingSnapshots(project),artworkId=project.drawingSnapshots?.activeId??'$working',view=drawingSnapshotPresentation(recordingSnapshots,artworkId);
 if(!view)throw Error('The current Drawing snapshot is unavailable.');
 if(clipboard.intent!=='reference')throw Error('This clipboard requests an independent duplicate. Capture a layer reference to paste it into Drawing.');
 const planned=planSnapshotClipboardPaste(recordingSnapshots,clipboard,projectId,view.snapshotId);let workspace=recordingSnapshots;const layerIds:string[]=[];
 for(const command of planned.commands){const result=prepareSnapshotReferencePaste(workspace,{targetSnapshotId:view.snapshotId,sourceSnapshotId:command.sourceSnapshotId,layerIds:command.layerIds});if(result.blockedCode)throw Error(result.diagnostics.at(-1)?.message??result.blockedCode);workspace=result.workspace;layerIds.push(...result.created.map(layer=>layer.id),...result.reused.map(layer=>layer.id));}
 // Validate identity mapping as well as the generic graph before committing.
 drawingSnapshotPresentation(workspace,artworkId);
 if(workspace===project.recordingSnapshots)return {...composePreparedSnapshotEdits(project,[]),workspace,layerIds};
 const plan=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'snapshot-state',workspace});return {...plan,workspace:plan.project.recordingSnapshots!,layerIds};
}
