import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {emptyDrawing} from '../domain/drawing/model';
import type {ReferenceImage} from '../domain/project/types';
import {RECORDING_REFERENCE_IMAGE} from '../domain/recording/reference';
import type {RecordingReferenceStorage,SavedRecordingReference} from '../ui/vectorRecording/recordingReferenceStorage';
import Properties from '../ui/drawing/Properties';
import RecordingReferenceControls from '../ui/vectorRecording/RecordingReferenceControls';
import {createRecordingReferenceState,recordingReferenceSession} from '../ui/vectorRecording/recordingReferenceState';

const photo:ReferenceImage={name:'Sheet.png',dataUrl:'data:image/png;base64,AAAA',width:1200,height:900,opacity:.45,visible:true,locked:false,offset:[0,0],scale:1,rotation:0};
const file=new File(['photo'],'Sheet.png',{type:'image/png'});
function pending<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('Drawing and Recording render the same complete reference controls',()=>{
 const drawing={...emptyDrawing(),reference:photo},noop=()=>{};
 const drawingHtml=renderToStaticMarkup(createElement(Properties,{open:true,setOpen:noop,document:drawing,selection:{ids:[],reference:true},active:null,run:noop,choose:noop,tool:noop,transform:noop,upload:noop,moveReference:noop,preview:noop}));
 const recordingHtml=renderToStaticMarkup(createElement(RecordingReferenceControls,{state:createRecordingReferenceState(photo)}));
 for(const html of [drawingHtml,recordingHtml]){
  expect(html).toContain('data-testid="drawing-reference-controls"');
  for(const label of ['替换照片','平移图片','显示参考图','锁定参考图','图片透明度 %','图片缩放 %','旋转','参考图 X','参考图 Y','移除参考照片'])expect(html).toContain(label);
  expect(html.match(/class="reference-position-axis"/g)).toHaveLength(2);
 }
 expect(recordingHtml).not.toContain('镜像轴');expect(recordingHtml).not.toContain('曲线名称');
 expect(renderToStaticMarkup(createElement(RecordingReferenceControls,{state:createRecordingReferenceState()}))).toContain('载入参考照片');
});

test('reference previews cancel or commit without touching source, project history or keys',()=>{
 const prior=useEditor.getState(),source={...emptyDrawing(),reference:structuredClone(photo)},project={...createEmptyProject(),drawing:source};
 try{
  useEditor.setState({project,past:[],future:[]});const projectJson=JSON.stringify(project),past=useEditor.getState().past,future=useEditor.getState().future;
  const state=createRecordingReferenceState(source.reference),base=state.currentDocument();
  expect(state.current()).not.toBe(source.reference);expect(state.current()!.offset).not.toBe(source.reference.offset);
  state.preview({...state.current()!,offset:[3,-2],scale:2,rotation:45,opacity:.7});
  expect(state.getSnapshot().preview!.reference!.offset).toEqual([3,-2]);expect(state.currentDocument()).toBe(base);
  state.preview(null);expect(state.getSnapshot().preview).toBeNull();expect(state.currentDocument()).toBe(base);
  state.preview({...state.current()!,offset:[3,-2]});const completed=state.getSnapshot().preview!;
  state.preview(null);state.run(()=>completed);expect(state.current()!.offset).toEqual([3,-2]);
  expect(JSON.stringify(useEditor.getState().project)).toBe(projectJson);expect(useEditor.getState().past).toBe(past);expect(useEditor.getState().future).toBe(future);
  expect(source.reference.offset).toEqual([0,0]);
 }finally{useEditor.setState(prior,true);}
});

test('locking, hiding and removal leave move mode and reject locked image edits',async()=>{
 const state=createRecordingReferenceState(photo);
 state.setMoving(true);expect(state.getSnapshot().moving).toBe(true);
 state.change({...state.current()!,locked:true});expect(state.getSnapshot().moving).toBe(false);
 const locked=state.current();state.setMoving(true);state.preview({...locked!,offset:[1,2]});state.change({...locked!,rotation:20});state.change(undefined);
 expect(state.current()).toBe(locked);expect(state.getSnapshot().preview).toBeNull();expect(state.getSnapshot().moving).toBe(false);
 const reader=vi.fn(async()=>photo);await state.upload(file,reader);expect(reader).not.toHaveBeenCalled();
 state.change({...locked!,visible:false});expect(state.current()!.visible).toBe(false);
 state.change({...state.current()!,locked:false,visible:true});state.setMoving(true);state.change({...state.current()!,visible:false});expect(state.getSnapshot().moving).toBe(false);
 state.setMoving(true);expect(state.getSnapshot().moving).toBe(false);state.change(undefined);expect(state.current()).toBeUndefined();
 const html=renderToStaticMarkup(createElement(RecordingReferenceControls,{state:createRecordingReferenceState({...photo,locked:true})}));
 for(const label of ['图片透明度 %','图片缩放 %','旋转','参考图 X','参考图 Y'])expect(html.match(new RegExp('<input[^>]*aria-label="'+label+'"[^>]*>'))?.[0]).toContain('disabled');
 expect(html).toContain('解锁参考图');
});

test('latest image selection wins and a stale failure does not affect the new image',async()=>{
 const state=createRecordingReferenceState(),first=pending<ReferenceImage>(),second=pending<ReferenceImage>(),reader=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 const oldUpload=state.upload(file,reader),newUpload=state.upload(file,reader);
 expect(reader).toHaveBeenNthCalledWith(1,file,RECORDING_REFERENCE_IMAGE);expect(state.getSnapshot().busy).toBe(true);
 second.resolve({...photo,name:'New.png'});await newUpload;
 expect(state.current()!.name).toBe('New.png');expect(state.current()!.locked).toBe(true);expect(state.getSnapshot().busy).toBe(false);
 first.reject(new Error('stale error'));await oldUpload;expect(state.current()!.name).toBe('New.png');expect(state.getSnapshot().error).toBe('');
});

test('scene changes, unmounts, removal and locking invalidate pending uploads',async()=>{
 for(const interrupt of ['deactivate','remove','lock'] as const){
  const state=createRecordingReferenceState(photo),read=pending<ReferenceImage>(),upload=state.upload(file,()=>read.promise);
  if(interrupt==='deactivate'){state.deactivate();state.activate();}
  else state.change(interrupt==='remove'?undefined:{...state.current()!,locked:true});
  const current=state.current();read.resolve({...photo,name:'Late.png'});await upload;
  expect(state.current()).toBe(current);expect(state.getSnapshot().busy).toBe(false);
 }
});

test('returning to a scene restores its reference without reseeding from source edits',()=>{
 const a=recordingReferenceSession('reference-test/project/scene-a',photo),b=recordingReferenceSession('reference-test/project/scene-b',photo);
 a.change({...a.current()!,offset:[4,5],scale:3});a.preview({...a.current()!,offset:[6,7]});a.setMoving(true);a.deactivate();
 const returned=recordingReferenceSession('reference-test/project/scene-a',{...photo,name:'Changed source.png',offset:[8,9]});returned.activate();
 expect(returned).toBe(a);expect(returned.current()!.offset).toEqual([4,5]);expect(returned.current()!.name).toBe('Sheet.png');expect(returned.getSnapshot().preview).toBeNull();expect(returned.getSnapshot().moving).toBe(false);
 expect(b.current()!.offset).toEqual([0,0]);a.change(undefined);expect(recordingReferenceSession('reference-test/project/scene-a',photo).current()).toBeUndefined();
});

test('upload failures preserve the previous reference and can be retried',async()=>{
 const state=createRecordingReferenceState(photo),before=state.current();
 await state.upload(file,async()=>{throw Error('Cannot read this image');});
 expect(state.current()).toBe(before);expect(state.getSnapshot().busy).toBe(false);expect(state.getSnapshot().error).toBe('Cannot read this image');
 await state.upload(file,async()=>({...photo,name:'Retry.png'}));expect(state.current()!.name).toBe('Retry.png');expect(state.getSnapshot().error).toBe('');
});


test('a fresh workspace restores the committed local reference, including explicit removal',async()=>{
 let disk:SavedRecordingReference|null=null;
 const storage:RecordingReferenceStorage={load:async()=>structuredClone(disk),save:async reference=>{disk=structuredClone({reference});}};
 const first=createRecordingReferenceState(photo,storage);await first.restore();await first.whenSaved();
 first.change({...first.current()!,offset:[2,-3],rotation:34,scale:1.5});await first.whenSaved();
 first.preview({...first.current()!,offset:[7,8]});first.setMoving(true);
 const reloaded=createRecordingReferenceState({...photo,name:'Changed source.png'},storage);await reloaded.restore();
 expect(reloaded.current()!.offset).toEqual([2,-3]);expect(reloaded.current()!.rotation).toBe(34);expect(reloaded.current()!.name).toBe('Sheet.png');
 expect(reloaded.getSnapshot().preview).toBeNull();expect(reloaded.getSnapshot().moving).toBe(false);
 reloaded.change(undefined);await reloaded.whenSaved();const removed=createRecordingReferenceState(photo,storage);await removed.restore();expect(removed.current()).toBeUndefined();
});

test('late local-storage hydration never replaces newer edits or a new image selection',async()=>{
 for(const action of ['edit','upload','preview'] as const){
  const read=pending<SavedRecordingReference|null>(),storage:RecordingReferenceStorage={load:()=>read.promise,save:async()=>{}};
  const state=createRecordingReferenceState(photo,storage),restore=state.restore();
  if(action==='edit')state.change({...state.current()!,offset:[4,5]});
  else if(action==='preview')state.preview({...state.current()!,offset:[4,5]});
  else await state.upload(file,async()=>({...photo,name:'New.png'}));
  read.resolve({reference:{...photo,name:'Old disk.png',offset:[9,9]}});await restore;
  expect(state.current()!.name).toBe(action==='upload'?'New.png':'Sheet.png');
  if(action==='edit')expect(state.current()!.offset).toEqual([4,5]);
  if(action==='preview')expect(state.getSnapshot().preview!.reference!.offset).toEqual([4,5]);
 }
});

test('local writes are ordered so delayed upload saves cannot undo a later removal',async()=>{
 const firstSave=pending<void>(),saved:(ReferenceImage|undefined)[]=[],storage:RecordingReferenceStorage={load:async()=>({reference:photo}),save:vi.fn(async reference=>{saved.push(reference);if(saved.length===1)await firstSave.promise;})};
 const state=createRecordingReferenceState(photo,storage);await state.restore();
 state.change({...photo,offset:[1,2]});state.change(undefined);await Promise.resolve();
 expect(saved).toHaveLength(1);expect(state.getSnapshot().saving).toBe(true);
 firstSave.resolve();await state.whenSaved();expect(saved).toHaveLength(2);expect(saved[1]).toBeUndefined();expect(state.getSnapshot().saving).toBe(false);
});

test('local save failures stay visible and retry saves the current reference',async()=>{
 let fail=true;
 const storage:RecordingReferenceStorage={load:async()=>({reference:photo}),save:async()=>{if(fail)throw Error('Storage quota exceeded');}};
 const state=createRecordingReferenceState(photo,storage);await state.restore();state.change({...photo,opacity:.7});await state.whenSaved();
 expect(state.getSnapshot().persistenceError).toBe('Storage quota exceeded');expect(state.current()!.opacity).toBe(.7);
 const html=renderToStaticMarkup(createElement(RecordingReferenceControls,{state}));expect(html).toContain('Storage quota exceeded');expect(html).toContain('重试保存到本机');
 fail=false;await state.retrySave();expect(state.getSnapshot().persistenceError).toBe('');expect(state.getSnapshot().saving).toBe(false);
});

test('a local read failure preserves the seed and never masquerades as successful recovery',async()=>{
 const state=createRecordingReferenceState(photo,{load:async()=>{throw Error('Local database is blocked');},save:async()=>{}});await state.restore();
 expect(state.current()!.name).toBe('Sheet.png');expect(state.getSnapshot().persistenceError).toBe('Local database is blocked');expect(state.getSnapshot().hydrating).toBe(false);
});


test('retrying a failed restore reads the saved image without overwriting it with a seed',async()=>{
 let fail=true;const save=vi.fn(async()=>{}),saved={...photo,name:'Saved local reference.png'};
 const state=createRecordingReferenceState(photo,{load:async()=>{if(fail)throw Error('Database blocked');return {reference:saved};},save});
 await state.restore();expect(state.getSnapshot().persistenceFailure).toBe('restore');
 fail=false;await state.retryStorage();expect(state.current()!.name).toBe(saved.name);expect(save).not.toHaveBeenCalled();expect(state.getSnapshot().persistenceError).toBe('');
});
