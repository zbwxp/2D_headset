import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor,HISTORY_LIMIT} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {captureEditorHistoryContext,readHistoryViewport,recordingHistoryViewportKey,restoreHistoryViewport,writeHistoryViewport} from '../app/editorHistory';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {prepareSnapshotBatch} from '../app/recordingSnapshotApi';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {emptyDrawing} from '../domain/drawing/model';
import type {ReferenceImage} from '../domain/project/types';
import {useDrawing} from '../ui/drawing/session';
import {createRecordingReferenceState} from '../ui/vectorRecording/recordingReferenceState';
import type {SavedRecordingReference} from '../ui/vectorRecording/recordingReferenceStorage';

const prior=useEditor.getState(),mode=useWorkspaceMode.getState().mode,drawing=useDrawing.getState();
const photo:ReferenceImage={name:'Reference.png',dataUrl:'data:image/png;base64,AAAA',width:400,height:300,opacity:.5,visible:true,locked:false,offset:[0,0],scale:1,rotation:0};
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.setState({mode:'drawing'});const project=ensureRecordingSnapshots({...createEmptyProject(),drawing:emptyDrawing()});useEditor.setState({project,past:[],future:[],viewId:project.views[0].id});useDrawing.setState({zoom:1,pan:[0,0],selection:{ids:[]}});});
afterEach(()=>{useEditor.getState().endEdit();vi.runAllTimers();useEditor.setState(prior);useWorkspaceMode.setState({mode});useDrawing.setState(drawing);vi.useRealTimers();});
function sourceEdit(axis:number){const s=useEditor.getState();s.beginEdit();s.setDrawing({...s.project.drawing!,mirrorAxisX:axis});s.endEdit();return useEditor.getState().project;}

test('global Drawing → Recording Undo/Redo restores each transaction mode, snapshot and viewport without navigation entries',()=>{
 const before=useEditor.getState().project;
 useDrawing.getState().set({zoom:2,pan:[12,34]});const source=sourceEdit(.3);
 useWorkspaceMode.getState().setMode('recording');const key=recordingHistoryViewportKey(source),viewport={zoom:3,pan:[40,-20] as [number,number],bounds:{min:[-2,-1] as [number,number],max:[2,1] as [number,number]}};writeHistoryViewport(key,viewport);
 const plan=prepareSnapshotBatch(source,{commands:[{op:'createSnapshot',name:'Side',angle:{x:90,y:0}}]});useEditor.getState().commitRecordingSnapshots(plan.recordingSnapshots);const recorded=useEditor.getState().project;
 expect(recorded.drawing).toBe(source.drawing);expect(useEditor.getState().past).toHaveLength(2);
 useWorkspaceMode.getState().setMode('drawing');useDrawing.getState().set({zoom:5,pan:[99,99]});writeHistoryViewport(key,{...viewport,zoom:9,pan:[90,90]});
 useEditor.getState().undo();expect(useWorkspaceMode.getState().mode).toBe('recording');expect(useEditor.getState().project).toBe(source);expect(readHistoryViewport(key)).toEqual(viewport);expect(useEditor.getState().past).toHaveLength(1);
 useEditor.getState().undo();expect(useWorkspaceMode.getState().mode).toBe('drawing');expect(useEditor.getState().project).toBe(before);expect(useDrawing.getState()).toMatchObject({zoom:2,pan:[12,34]});expect(useEditor.getState().past).toHaveLength(0);
 useEditor.getState().redo();expect(useWorkspaceMode.getState().mode).toBe('drawing');expect(useEditor.getState().project).toBe(source);
 useEditor.getState().redo();expect(useWorkspaceMode.getState().mode).toBe('recording');expect(useEditor.getState().project).toBe(recorded);expect(recorded.recordingSnapshots!.recordings[0].activeSnapshotId).toBe(plan.snapshotId);expect(readHistoryViewport(key)).toEqual(viewport);expect(useEditor.getState().future).toHaveLength(0);
});

test('facade Undo crosses rooms and reports local-only history changes',()=>{
 const before=useEditor.getState().project;sourceEdit(.2);useWorkspaceMode.getState().setMode('recording');const api=createVectorEditingApi();
 expect(api.undo()).toMatchObject({ok:true,value:{changed:true,mode:'drawing'}});expect(useEditor.getState().project).toBe(before);
 expect(api.redo()).toMatchObject({ok:true,value:{changed:true}});
 let value=1;useEditor.getState().commitWorkspaceEdit({undo:()=>{value=0;},redo:()=>{value=1;}});
 expect(api.undo()).toMatchObject({ok:true,value:{changed:true}});expect(value).toBe(0);expect(api.redo()).toMatchObject({ok:true,value:{changed:true}});expect(value).toBe(1);
});

test('reference upload, unlock, one drag, scale, visibility and removal share global order and persist Undo',async()=>{
 useWorkspaceMode.getState().setMode('recording');let disk:SavedRecordingReference|null=null;
 const state=createRecordingReferenceState(undefined,{load:async()=>disk,save:async reference=>{disk=structuredClone({reference});}},effect=>useEditor.getState().commitWorkspaceEdit(effect));
 const project=useEditor.getState().project,projectJSON=JSON.stringify(project);
 await state.upload(new File(['data'],'Reference.png'),async()=>photo);expect(useEditor.getState().past).toHaveLength(1);expect(state.current()!.locked).toBe(true);
 state.change({...state.current()!,locked:false});const unlocked=state.current()!;
 for(let i=1;i<=20;i++)state.preview({...unlocked,offset:[i/10,-i/10]});expect(useEditor.getState().past).toHaveLength(2);
 const moved=state.getSnapshot().preview!.reference!;state.preview(null);state.change(moved);expect(useEditor.getState().past).toHaveLength(3);
 state.change({...state.current()!,scale:2});state.change({...state.current()!,visible:false});state.change(undefined);expect(useEditor.getState().past).toHaveLength(6);
 useWorkspaceMode.getState().setMode('drawing');useEditor.getState().undo();expect(useWorkspaceMode.getState().mode).toBe('recording');expect(state.current()).toMatchObject({scale:2,visible:false,offset:[2,-2]});
 useEditor.getState().undo();expect(state.current()!.visible).toBe(true);useEditor.getState().undo();expect(state.current()!.scale).toBe(1);useEditor.getState().undo();expect(state.current()!.offset).toEqual([0,0]);
 useEditor.getState().undo();expect(state.current()!.locked).toBe(true);useEditor.getState().undo();expect(state.current()).toBeUndefined();await state.whenSaved();expect(disk).toEqual({reference:undefined});
 for(let i=0;i<6;i++)useEditor.getState().redo();expect(state.current()).toBeUndefined();await state.whenSaved();expect(disk).toEqual({reference:undefined});
 expect(useEditor.getState().project).toBe(project);expect(JSON.stringify(project)).toBe(projectJSON);
});

test('cancel and unchanged reference previews leave history and Redo intact',()=>{
 const state=createRecordingReferenceState(photo,undefined,effect=>useEditor.getState().commitWorkspaceEdit(effect));sourceEdit(.4);useEditor.getState().undo();const s=useEditor.getState();
 state.preview({...photo,offset:[2,3]});state.preview(null);state.change({...photo,offset:[0,0]});expect(useEditor.getState().past).toBe(s.past);expect(useEditor.getState().future).toBe(s.future);
 const editor=useEditor.getState();editor.beginEdit();editor.endEdit();expect(useEditor.getState().past).toBe(s.past);expect(useEditor.getState().future).toBe(s.future);
 editor.beginEdit(true);editor.setDrawing({...editor.project.drawing!,mirrorAxisX:.8});editor.cancelEdit();expect(useEditor.getState().project).toBe(s.project);expect(useEditor.getState().past).toBe(s.past);expect(useEditor.getState().future).toBe(s.future);
});

test('a canceled/no-op transaction at the limit never drops the oldest edit',()=>{
 for(let i=0;i<HISTORY_LIMIT;i++)sourceEdit(i/100);const s=useEditor.getState();s.beginEdit();s.endEdit();expect(useEditor.getState().past).toBe(s.past);expect(useEditor.getState().historyPast).toBe(s.historyPast);
});

test('viewport-only transactions replay exact camera state without changing project/source/key data',()=>{
 useWorkspaceMode.getState().setMode('recording');const project=useEditor.getState().project,key=recordingHistoryViewportKey(project),before={zoom:1,pan:[0,0] as [number,number]},after={zoom:2,pan:[30,-40] as [number,number]};writeHistoryViewport(key,before);const context=captureEditorHistoryContext(project,useEditor.getState().viewId);writeHistoryViewport(key,after);useEditor.getState().commitWorkspaceEdit({undo:()=>restoreHistoryViewport(key,before),redo:()=>restoreHistoryViewport(key,after)},context);
 useEditor.getState().undo();expect(readHistoryViewport(key)).toEqual(before);useEditor.getState().redo();expect(readHistoryViewport(key)).toEqual(after);expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toHaveLength(1);
});
