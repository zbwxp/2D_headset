import {test,expect,vi,afterEach} from 'vitest';
import {createStore} from 'zustand';
import {connectWorkspaceSession,workspaceSessionKey} from '../../app/workspaceSession';
import {createDrawingSession} from '../../ui/drawing/session';
import {createDrawingSession as createAssemblySession} from '../../ui/assemblyDrawing/session';
import {useRecording} from '../../ui/recording/session';

const project=(id=1)=>({meta:{createdAt:id},views:[{id:'front'},{id:'side'}],drawing:{curves:[{}]},assembly:{}});
const memory=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:vi.fn((k:string,v:string)=>{map.set(k,v);})};};
function setup(storage=memory(),id=1){
 const editor=createStore(()=>({project:project(id),viewId:'front'}));
 const stores={drawing:createDrawingSession(),assembly:createAssemblySession(),recording:createStore(()=>useRecording.getInitialState())};
 const connection=connectWorkspaceSession(editor,stores,storage);
 return {...stores,editor,storage,...connection};
}
afterEach(()=>vi.useRealTimers());
test('refresh restores room, absolute rig/viewport registration, lock, tool and layout without editing the project',()=>{
 const a=setup(),projectBefore=a.editor.getState().project;
 a.drawing.setState({room:false});a.assembly.getState().set({room:true,zoom:2.4,pan:[151,-44],rigPan:[34,78],rigViewLocked:true,tool:'direct',layerId:'face',selection:{ids:['jaw'],node:'tip'},closedLayers:['ear'],panelHeight:78,sidebar:false,viewOptions:{...a.assembly.getState().viewOptions,folded:true,locatorId:'chin',trajectoryRequested:true,trajectoryPitch:-20}});
 a.editor.setState({viewId:'side'});a.flush();
 expect(a.editor.getState().project).toBe(projectBefore);
 const b=setup(a.storage);
 for(const key of ['zoom','pan','rigPan','rigViewLocked','tool','layerId','selection','closedLayers','panelHeight','sidebar','viewOptions'] as const)expect(b.assembly.getState()[key]).toEqual(a.assembly.getState()[key]);
 expect(b.assembly.getState().room).toBe(true);expect(b.drawing.getState().room).toBe(false);expect(b.editor.getState().viewId).toBe('side');
 b.assembly.getState().set({pan:[161,-24]});expect(b.assembly.getState().rigPan).toEqual([44,98]);
 const saved=JSON.parse(a.storage.getItem(workspaceSessionKey(1))!);
 expect(saved.assembly.set).toBeUndefined();expect(saved.project).toBeUndefined();expect(JSON.stringify(saved).length).toBeLessThan(2500);
 a.dispose();b.dispose();
});
test('modeling stays selected even in a project with authored drawing; drawing and recording keep independent viewports',()=>{
 const a=setup();a.drawing.setState({room:false,zoom:3,pan:[12,34]});a.recording.setState({room:true,view:{yaw:31,pitch:-12},pan:[-50,16],zoom:1.3});a.flush();
 const b=setup(a.storage);expect(b.recording.getState()).toMatchObject({room:true,view:{yaw:31,pitch:-12},pan:[-50,16],zoom:1.3});
 expect(b.drawing.getState()).toMatchObject({room:false,zoom:3,pan:[12,34]});
 b.recording.setState({room:false});b.flush();const c=setup(a.storage);expect(c.drawing.getState().room).toBe(false);expect(c.assembly.getState().room).toBe(false);expect(c.recording.getState().room).toBe(false);
 a.dispose();b.dispose();c.dispose();
});
test('opening another project saves the previous workspace and restores its own state when returning',()=>{
 const a=setup();a.drawing.setState({room:false});a.assembly.setState({room:true,pan:[99,-12],rigPan:[5,6],rigViewLocked:true});a.editor.setState({viewId:'side'});
 a.editor.setState({project:project(2),viewId:'front'});
 expect(a.drawing.getState().room).toBe(true);expect(a.assembly.getState()).toMatchObject({pan:[0,0],rigPan:[0,0],rigViewLocked:false});
 a.drawing.setState({pan:[2,3]});a.editor.setState({project:project(1)});
 expect(a.assembly.getState()).toMatchObject({room:true,pan:[99,-12],rigPan:[5,6],rigViewLocked:true});expect(a.editor.getState().viewId).toBe('side');
 a.editor.setState({project:project(2)});expect(a.drawing.getState().pan).toEqual([2,3]);a.dispose();
});
test('invalid UI data and unavailable storage do not stop project loading',()=>{
 const storage=memory();storage.setItem(workspaceSessionKey(1),'broken');let a=setup(storage);expect(a.drawing.getState().room).toBe(true);a.dispose();
 storage.setItem(workspaceSessionKey(1),JSON.stringify({version:1,room:'assembly',assembly:{zoom:-1,tool:'garbage',pan:[4,null],set:'bad',selection:{ids:[5]},viewOptions:{trajectoryMode:'bad'}},drawing:{zoom:4}}));
 a=setup(storage);expect(a.assembly.getState()).toMatchObject({zoom:1,tool:'select',pan:[0,0],selection:{ids:[]}});expect(typeof a.assembly.getState().set).toBe('function');expect(a.drawing.getState().zoom).toBe(4);a.dispose();
 const denied={getItem:()=>{throw new Error('denied');},setItem:vi.fn(()=>{throw new Error('full');})};a=setup(denied);a.assembly.setState({rigViewLocked:true});expect(()=>a.flush()).not.toThrow();expect(a.assembly.getState().rigViewLocked).toBe(true);a.dispose();
});
test('navigation writes are coalesced and flush catches the last movement immediately',()=>{
 vi.useFakeTimers();const a=setup();for(let i=0;i<120;i++)a.assembly.setState({pan:[i,5]});expect(a.storage.setItem).not.toHaveBeenCalled();
 a.flush();expect(a.storage.setItem).toHaveBeenCalledTimes(1);expect(JSON.parse(a.storage.getItem(workspaceSessionKey(1))!).assembly.pan).toEqual([119,5]);
 vi.advanceTimersByTime(500);expect(a.storage.setItem).toHaveBeenCalledTimes(1);a.dispose();
});
