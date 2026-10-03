import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {moveHandle} from '../domain/drawing/commands';
import {restoreDrawingSnapshot} from '../domain/drawing/snapshots';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard,prepareSnapshotReferencePaste} from '../domain/recordingSnapshot/referenceClipboard';
import {captureDrawingLayerReferences,createLayerReferenceClipboardSession,layerClipboardProjectId,useLayerReferenceClipboard} from '../ui/drawing/layerReferenceClipboard';
import {drawingSnapshotPresentation} from '../ui/drawing/snapshotPresentation';

const initialEditor=useEditor.getState(),initialMode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(initialEditor,true);useWorkspaceMode.getState().setMode(initialMode);vi.useRealTimers();});
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,0],[.7,0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 const other=moveHandle(drawing,{curveId:'curve',end:0},[.3,.6]);
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing:other}]}});
 return {project,drawing,other};
}
test('Drawing take reference is read-only and maps repeated raw layer IDs to their artwork canonical identity',()=>{
 const {project}=fixture(),before=JSON.stringify(project),a=captureDrawingLayerReferences(project,'A',['layer']),b=captureDrawingLayerReferences(project,'B',['layer']);
 expect(a.intent).toBe('reference');expect(a.sources[0].layerIds).toEqual([canonicalElementId('A','layer')]);expect(b.sources[0].layerIds).toEqual([canonicalElementId('B','layer')]);expect(a.sources[0].snapshotId).not.toBe(b.sources[0].snapshotId);expect(JSON.stringify(project)).toBe(before);
});
test('session layer references survive source and mode changes and clear on project change without room effects',()=>{
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');
 const {project}=fixture();useEditor.setState({project,past:[],future:[]});
 const captured=captureDrawingLayerReferences(project,'A',['layer'],'reference',layerClipboardProjectId());useLayerReferenceClipboard.getState().capture(captured);
 useWorkspaceMode.getState().setMode('recording');expect(useLayerReferenceClipboard.getState().clipboard).toEqual(captured);
 useWorkspaceMode.getState().setMode('drawing');useEditor.getState().setDrawingSnapshotState(restoreDrawingSnapshot(project,'B'));
 expect(useLayerReferenceClipboard.getState().clipboard).toEqual(captured);expect(useEditor.getState().project.drawingSnapshots?.activeId).toBe('B');
 useEditor.setState({project:{...project,meta:{...project.meta,createdAt:project.meta.createdAt+1}}});expect(useLayerReferenceClipboard.getState().clipboard).toBeNull();
 useEditor.setState({project});expect(useLayerReferenceClipboard.getState().clipboard).toBeNull();
 vi.runAllTimers();
});
test('reopening the same project clears references despite an unchanged saved createdAt',()=>{
 vi.useFakeTimers();const {project}=fixture();useEditor.getState().load(project);
 const projectId=layerClipboardProjectId();useLayerReferenceClipboard.getState().capture(captureDrawingLayerReferences(useEditor.getState().project,'A',['layer'],'reference',projectId));
 expect(useLayerReferenceClipboard.getState().clipboard).not.toBeNull();useEditor.getState().load(project);
 expect(useEditor.getState().project.meta.createdAt).toBe(project.meta.createdAt);expect(layerClipboardProjectId()).not.toBe(projectId);expect(useLayerReferenceClipboard.getState().clipboard).toBeNull();
 vi.runAllTimers();
});
test('session capture copies addresses, distinguishes independent clone and rejects stale projects',()=>{
 const session=createLayerReferenceClipboardSession('A'),sources=[{snapshotId:'source',layerIds:['layer']}],clipboard=captureSnapshotLayerClipboard('A','duplicate',sources);
 session.getState().capture(clipboard);sources[0].layerIds.length=0;(clipboard.sources[0].layerIds as string[]).length=0;
 expect(session.getState().clipboard?.sources[0].layerIds).toEqual(['layer']);expect(session.getState().clipboard?.intent).toBe('duplicate');
 session.getState().bindProject('A');expect(session.getState().clipboard).not.toBeNull();session.getState().bindProject('B');expect(session.getState().clipboard).toBeNull();
 expect(()=>session.getState().capture(clipboard)).toThrow(/another project/);
});
test('Drawing presentation resolves pasted references live without baking canonical geometry into source documents',()=>{
 const {project,drawing}=fixture(),w=project.recordingSnapshots,a=drawingSnapshotForArtwork(w,'A')!,b=drawingSnapshotForArtwork(w,'B')!,before=JSON.stringify(project);
 const result=prepareSnapshotReferencePaste(w,{targetSnapshotId:a.id,sourceSnapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)},()=> 'reference-slot');expect(result.blockedCode).toBeUndefined();
 const view=drawingSnapshotPresentation(result.workspace,'A')!;
 expect(view.drawing.curves.map(curve=>curve.id)).toEqual(['curve',canonicalElementId('B','curve')]);expect(view.drawing.layers.map(layer=>layer.id)).toEqual(['layer',b.layers[0].id]);
 expect(view.layerOwners.get('layer')?.kind).toBe('source-original');expect(view.layerOwners.get(b.layers[0].id)?.kind).toBe('snapshot-local');expect(view.canonicalId('curve')).toBe(canonicalElementId('A','curve'));expect(view.canonicalId(canonicalElementId('B','curve'))).toBe(canonicalElementId('B','curve'));
 expect(JSON.stringify(project)).toBe(before);expect(project.drawing).toBe(drawing);
 const changed=moveHandle(project.drawingSnapshots!.items[1].drawing,{curveId:'curve',end:0},[.2,.9]);
 const live=syncRecordingSnapshotSources({...project,recordingSnapshots:result.workspace,drawingWorkingCopies:{B:changed}}),next=drawingSnapshotPresentation(live.recordingSnapshots,'A')!;
 expect(next.drawing.curves.find(curve=>curve.id===canonicalElementId('B','curve'))!.handles[0]).toEqual([.2,.9]);expect(next.drawing.curves.find(curve=>curve.id==='curve')!.handles).toEqual(drawing.curves[0].handles);
 expect(live.drawing).toBe(drawing);expect(Object.keys(live.recordingSnapshots.library.curves)).toHaveLength(2);
});
