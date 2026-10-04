import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareSnapshotPreview} from '../app/recordingSnapshotApi';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import type {ReferenceImage} from '../domain/project/types';
import type {WorkspaceHistoryEffect} from '../app/editorHistory';
import RecordingReferenceControls from '../ui/vectorRecording/RecordingReferenceControls';
import {createRecordingReferenceState} from '../ui/vectorRecording/recordingReferenceState';
import {decodeRecordingReferenceRecord,withRecordingReferenceFallback,type RecordingReferenceStorage,type SavedRecordingReference} from '../ui/vectorRecording/recordingReferenceStorage';
import {referenceAngleKey,referenceBindingAt,type ReferenceAngle} from '../ui/vectorRecording/recordingReferenceBindings';

const photo:ReferenceImage={name:'Sheet.png',dataUrl:'data:image/png;base64,AAAA',width:1200,height:900,opacity:.45,visible:true,locked:false,offset:[0,0],scale:1,rotation:0};
const front={x:0,y:0},side={x:90,y:0};
const alignment={offset:[2,-3] as [number,number],scale:2,rotation:34,opacity:.6};
const temporary={offset:[4,5] as [number,number],scale:3,rotation:-45,opacity:.8};
function localDisk(){
 let record:SavedRecordingReference|null=null;
 const storage:RecordingReferenceStorage={load:async()=>structuredClone(record),save:async(reference,metadata)=>{record=structuredClone({reference,...metadata});}};
 return {storage,read:()=>record};
}
function referenceHistory(){const entries:WorkspaceHistoryEffect[]=[];return {entries,commit:(entry:WorkspaceHistoryEffect)=>entries.push(entry)};}

test('an explicit binding restores all four alignment values only on exact angle entry',()=>{
 const history=referenceHistory(),state=createRecordingReferenceState(photo,undefined,history.commit);
 state.enterAngle(front);state.change({...photo,...alignment});state.bindCurrentAngle();
 const binding=structuredClone(state.getSnapshot().bindings),imageId=state.getSnapshot().imageId;
 state.change({...state.current()!,...temporary});state.enterAngle(front);
 expect(state.current()).toMatchObject(temporary);expect(state.getSnapshot().bindings).toEqual(binding);
 state.enterAngle({x:30,y:0});expect(state.current()).toMatchObject(temporary);
 state.enterAngle({x:Number.EPSILON,y:0});expect(state.current()).toMatchObject(temporary);
 state.enterAngle(front);expect(state.current()).toMatchObject(alignment);
 expect(state.getSnapshot().imageId).toBe(imageId);expect(history.entries).toHaveLength(3);
 state.enterAngle(front);expect(history.entries).toHaveLength(3);
 expect(referenceAngleKey({x:0.1+0.2,y:0})).not.toBe(referenceAngleKey({x:.3,y:0}));
});

test('binding and updating are allowed while locked without changing the image lock or visibility',()=>{
 const history=referenceHistory(),state=createRecordingReferenceState({...photo,locked:true,visible:false},undefined,history.commit);
 state.enterAngle({x:12.345,y:-4.56});state.bindCurrentAngle();
 expect(state.current()).toMatchObject({locked:true,visible:false});expect(history.entries).toHaveLength(1);
 const first=renderToStaticMarkup(createElement(RecordingReferenceControls,{state}));
 expect(first).toContain('更新当前视角绑定');expect(first).toContain('X 12.345° / Y -4.56°');
 expect(first.match(/<button[^>]*data-testid="recording-reference-bind-angle"[^>]*>/)?.[0]).not.toContain('disabled');
 state.bindCurrentAngle();expect(history.entries).toHaveLength(1);
 state.change({...state.current()!,locked:false});state.change({...state.current()!,...alignment});
 expect(renderToStaticMarkup(createElement(RecordingReferenceControls,{state}))).toContain('当前为临时调整');
 state.change({...state.current()!,locked:true});state.bindCurrentAngle();
 expect(state.current()).toMatchObject({locked:true,visible:false,...alignment});
 expect(referenceBindingAt(state.getSnapshot().bindings,state.getSnapshot().angle)).toMatchObject(alignment);
 state.enterAngle(side);state.enterAngle({x:12.345,y:-4.56});expect(state.current()).toMatchObject({locked:true,visible:false,...alignment});
});

test('one reference drag is one history entry and does not silently update its binding',()=>{
 const history=referenceHistory(),state=createRecordingReferenceState(photo,undefined,history.commit);
 state.enterAngle(front);state.bindCurrentAngle();const before=state.current()!;
 for(let i=1;i<=20;i++)state.preview({...before,offset:[i/10,-i/10]});
 expect(history.entries).toHaveLength(1);state.bindCurrentAngle();expect(history.entries).toHaveLength(1);
 const moved=state.getSnapshot().preview!.reference!;state.preview(null);state.change(moved);
 expect(history.entries).toHaveLength(2);expect(state.getSnapshot().bindings[0].offset).toEqual([0,0]);
 history.entries[1].undo();state.enterAngle(front);expect(state.current()!.offset).toEqual([0,0]);
 history.entries[1].redo();state.enterAngle(front);expect(state.current()!.offset).toEqual([2,-2]);
 expect(history.entries).toHaveLength(2);
});

test('refresh hydrates exact-angle defaults; unbound angles preserve the last local transform',async()=>{
 const disk=localDisk(),state=createRecordingReferenceState(photo,disk.storage);
 state.enterAngle(front);await state.restore();state.change({...state.current()!,...alignment});state.bindCurrentAngle();state.change({...state.current()!,...temporary});await state.whenSaved();
 const id=state.getSnapshot().imageId;
 const unbound=createRecordingReferenceState(undefined,disk.storage);unbound.enterAngle(side);await unbound.restore();
 expect(unbound.current()).toMatchObject(temporary);expect(unbound.getSnapshot().imageId).toBe(id);
 const reloaded=createRecordingReferenceState(undefined,disk.storage);reloaded.enterAngle(front);await reloaded.restore();await reloaded.whenSaved();
 expect(reloaded.current()).toMatchObject(alignment);expect(reloaded.getSnapshot().bindings).toHaveLength(1);expect(disk.read()!.reference).toMatchObject(alignment);
 state.change({...state.current()!,...temporary});state.deactivate();state.activate(front);expect(state.current()).toMatchObject(alignment);
});

test('recording sessions and replacement images cannot inherit another image binding, including identical uploads',async()=>{
 const diskA=localDisk(),diskB=localDisk(),history=referenceHistory(),a=createRecordingReferenceState(photo,diskA.storage,history.commit),b=createRecordingReferenceState(photo,diskB.storage);
 a.enterAngle(front);b.enterAngle(front);a.change({...photo,...alignment});a.bindCurrentAngle();await a.whenSaved();
 expect(b.getSnapshot().bindings).toEqual([]);expect(b.current()).toEqual(photo);expect(a.getSnapshot().imageId).not.toBe(b.getSnapshot().imageId);
 const oldId=a.getSnapshot().imageId,old=a.current()!;
 await a.upload(new File(['image'],'Sheet.png'),async()=>({...old,locked:false}));await a.whenSaved();
 expect(a.getSnapshot().imageId).not.toBe(oldId);expect(a.getSnapshot().bindings).toEqual([]);expect(diskA.read()!.bindings).toEqual([]);
 a.enterAngle(side);a.enterAngle(front);expect(a.current()).toMatchObject({...alignment,locked:true});
 history.entries.at(-1)!.undo();expect(a.getSnapshot().imageId).toBe(oldId);expect(a.getSnapshot().bindings).toHaveLength(1);
 history.entries.at(-1)!.redo();expect(a.getSnapshot().imageId).not.toBe(oldId);expect(a.getSnapshot().bindings).toEqual([]);
 a.change({...a.current()!,locked:false});a.change(undefined);await a.whenSaved();
 expect(diskA.read()).toEqual({reference:undefined,imageId:undefined,bindings:[]});
});

test('v1 references migrate without a binding, v2 validates bindings and fallback preserves metadata',async()=>{
 const old=decodeRecordingReferenceRecord({version:1,reference:photo});expect(old).toEqual({reference:photo});
 const binding={angle:front,...alignment},saved={reference:photo,imageId:'image-a',bindings:[binding]};
 expect(decodeRecordingReferenceRecord({version:2,...saved})).toEqual(saved);
 for(const patch of [{imageId:undefined},{bindings:[binding,binding]},{bindings:[{...binding,angle:{x:NaN,y:0}}]},{bindings:[{...binding,scale:0}]},{reference:undefined}])expect(()=>decodeRecordingReferenceRecord({version:2,...saved,...patch})).toThrow();
 const save=vi.fn(async()=>{}),fallback=withRecordingReferenceFallback({load:async()=>null,save},{load:async()=>saved,save:async()=>{}});
 expect(await fallback.load()).toBe(saved);await fallback.save(photo,{imageId:saved.imageId,bindings:saved.bindings});expect(save).toHaveBeenCalledExactlyOnceWith(photo,{imageId:saved.imageId,bindings:saved.bindings});
});

const prior=useEditor.getState(),priorMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{const initial=ensureRecordingSnapshots(createEmptyProject()),project={...initial,recordingSnapshots:prepareSnapshotPreview(initial,{commands:[{op:'createTriangulatedRecording',name:'Reference test'}]}).recordingSnapshots};useEditor.setState({project,past:[],future:[],historyPast:[],historyFuture:[],viewId:project.views[0].id});useWorkspaceMode.setState({mode:'recording'});});
afterEach(()=>{useEditor.getState().endEdit();useEditor.setState(prior);useWorkspaceMode.setState({mode:priorMode});});
function projectAngle(){return useEditor.getState().project.recordingSnapshots!.recordings[0].angle;}
function navigate(angle:ReferenceAngle){const s=useEditor.getState(),recordingId=s.project.recordingSnapshots!.recordings[0].id,plan=prepareSnapshotPreview(s.project,{recordingId,commands:[{op:'setAngle',angle}]});s.setRecordingSnapshots(plan.recordingSnapshots);}

test('global Undo/Redo restores a temporary alignment across angle and mode jumps before any automatic binding default',async()=>{
 const disk=localDisk(),state=createRecordingReferenceState(photo,disk.storage,effect=>useEditor.getState().commitWorkspaceEdit(effect));
 const project=useEditor.getState().project,source=JSON.stringify(project.drawingSnapshots),snapshotIds=project.recordingSnapshots!.snapshots.map(item=>item.id);
 state.enterAngle(projectAngle());await state.restore();state.change({...photo,...alignment});state.bindCurrentAngle();
 state.change({...state.current()!,...temporary});state.change({...state.current()!,scale:4}); // Undo must return to the temporary scale 3, not bound scale 2.
 navigate(side);state.enterAngle(projectAngle());state.deactivate();useWorkspaceMode.setState({mode:'drawing'});
 const count=useEditor.getState().past.length;useEditor.getState().undo();state.activate(projectAngle());state.enterAngle(projectAngle());
 expect(useWorkspaceMode.getState().mode).toBe('recording');expect(projectAngle()).toEqual(front);expect(state.current()).toMatchObject(temporary);expect(useEditor.getState().past).toHaveLength(count-1);
 useEditor.getState().redo();state.enterAngle(projectAngle());expect(state.current()).toMatchObject({...temporary,scale:4});
 state.bindCurrentAngle();const bound=state.getSnapshot().bindings[0];expect(bound.scale).toBe(4);
 useEditor.getState().undo();state.enterAngle(projectAngle());expect(state.current()!.scale).toBe(4);expect(state.getSnapshot().bindings[0]).toMatchObject(alignment);
 navigate(side);state.enterAngle(projectAngle());navigate(front);state.enterAngle(projectAngle());expect(state.current()).toMatchObject(alignment);
 useEditor.getState().redo();state.enterAngle(projectAngle());expect(state.current()!.scale).toBe(4);expect(state.getSnapshot().bindings[0].scale).toBe(4);
 await state.whenSaved();expect(disk.read()!.bindings![0].scale).toBe(4);
 expect(JSON.stringify(useEditor.getState().project.drawingSnapshots)).toBe(source);expect(useEditor.getState().project.recordingSnapshots!.snapshots.map(item=>item.id)).toEqual(snapshotIds);
 expect(JSON.stringify(useEditor.getState().project)).not.toContain('data:image');
});
