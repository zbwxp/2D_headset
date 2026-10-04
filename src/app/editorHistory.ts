import type {LandmarkProject} from '../domain/landmarks/model';
import type {Point2} from '../domain/drawing/model';
import {useDrawing} from '../ui/drawing/session';
import {useWorkspaceMode,type WorkspaceMode} from './workspaceMode';

export interface HistoryViewport {zoom:number;pan:Point2;bounds?:{min:Point2;max:Point2}}
/** Runtime-only viewport cache. Never part of a project, source or recording key. */
const viewports=new Map<string,HistoryViewport>();
const viewportListeners=new Map<string,Set<(value:HistoryViewport)=>void>>();
export function recordingHistoryViewportKey(project:LandmarkProject){
 const workspace=project.recordingSnapshots;
 const recordingId=workspace?.activeRecordingId??workspace?.recordings[0]?.id??project.recordingScenes?.activeSceneId??project.recordingScenes?.scenes[0]?.id??project.drawingSnapshots?.activeId??'$working';
 return `${project.meta.createdAt}/recording/${recordingId}`;
}
export const readHistoryViewport=(key:string)=>viewports.get(key);
export function writeHistoryViewport(key:string,value:HistoryViewport){viewports.set(key,value);}
export function restoreHistoryViewport(key:string,value:HistoryViewport){viewports.set(key,value);for(const listener of viewportListeners.get(key)??[])listener(value);}
export function subscribeHistoryViewport(key:string,listener:(value:HistoryViewport)=>void){
 const listeners=viewportListeners.get(key)??new Set();listeners.add(listener);viewportListeners.set(key,listeners);
 return ()=>{listeners.delete(listener);if(!listeners.size)viewportListeners.delete(key);};
}
export interface EditorHistoryContext {
 mode:WorkspaceMode;viewId:string;
 drawing:Pick<ReturnType<typeof useDrawing.getState>,'zoom'|'pan'|'selection'|'layerId'|'tool'>;
 recordingViewport?:{key:string;value:HistoryViewport};
}
export interface WorkspaceHistoryEffect {kind?:'reference'|'viewport';undo:()=>void;redo:()=>void}
export interface EditorHistoryEntry {
 before:LandmarkProject;after:LandmarkProject;
 beforeContext:EditorHistoryContext;afterContext:EditorHistoryContext;
 effect?:WorkspaceHistoryEffect;
}
export function captureEditorHistoryContext(project:LandmarkProject,viewId:string):EditorHistoryContext{
 const {zoom,pan,selection,layerId,tool}=useDrawing.getState(),mode=useWorkspaceMode.getState().mode;
 const key=recordingHistoryViewportKey(project),viewport=readHistoryViewport(key);
 return {mode,viewId,drawing:{zoom,pan:[...pan],selection,layerId,tool},...(mode==='recording'&&viewport?{recordingViewport:{key,value:viewport}}:{})};
}
/** Called only after installing the transaction's project. Navigation must not
 * create another transaction, and a newly mounted Recording canvas reads cache. */
export function restoreEditorHistoryContext(context:EditorHistoryContext){
 if(context.recordingViewport)restoreHistoryViewport(context.recordingViewport.key,context.recordingViewport.value);
 if(useWorkspaceMode.getState().mode!==context.mode)useWorkspaceMode.getState().setMode(context.mode);
 useDrawing.getState().set({...context.drawing,room:context.mode==='drawing'});
}


export function editorHistoryTarget(entry:EditorHistoryEntry|null|undefined,direction:'undo'|'redo',zh:boolean):string{
 if(!entry)return '';
 const context=direction==='undo'?entry.beforeContext:entry.afterContext,project=direction==='undo'?entry.before:entry.after;
 const action=entry.effect?.kind==='reference'?(zh?'背景参考图':'Background reference'):entry.effect?.kind==='viewport'?(zh?'视口':'Viewport'):'';
 if(context.mode==='drawing')return [zh?'绘制':'Drawing',project.drawingSnapshots?.items.find(item=>item.id===project.drawingSnapshots?.activeId)?.name,action].filter(Boolean).join(' · ');
 const workspace=project.recordingSnapshots,recording=workspace?.recordings.find(value=>value.id===workspace.activeRecordingId)??workspace?.recordings[0],snapshot=workspace?.snapshots.find(value=>value.id===recording?.activeSnapshotId);
 return [zh?'录制':'Recording',recording?.name,snapshot?.name,recording?`X ${recording.angle.x}° / Y ${recording.angle.y}°`:undefined,action].filter(Boolean).join(' · ');
}
