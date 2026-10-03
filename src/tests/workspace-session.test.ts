import {test,expect,vi,afterEach} from 'vitest';
import {createStore} from 'zustand';
import {connectWorkspaceSession,workspaceSessionKey} from '../app/workspaceSession';
import type {WorkspaceMode} from '../app/workspaceMode';
import {createDrawingSession} from '../ui/drawing/session';

const project=(id=1)=>({meta:{createdAt:id},views:[{id:'front'},{id:'side'}]});
const memory=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:vi.fn((k:string,v:string)=>{map.set(k,v);})};};
function setup(storage=memory(),id=1,initialMode:WorkspaceMode='drawing'){
 const editor=createStore(()=>({project:project(id),viewId:'front'}));
 const workspace=createStore<{mode:WorkspaceMode;setMode:(mode:WorkspaceMode)=>void}>(set=>({mode:initialMode,setMode:mode=>set({mode})}));
 const stores={drawing:createDrawingSession(),workspace};
 const connection=connectWorkspaceSession(editor,stores,storage);
 return {...stores,editor,storage,...connection};
}
afterEach(()=>vi.useRealTimers());
test('refresh restores current Drawing controls and viewport without editing the project',()=>{
 const a=setup(),projectBefore=a.editor.getState().project;
 a.drawing.getState().set({zoom:2.4,pan:[151,-44],tool:'direct',layerId:'face',selection:{ids:['jaw'],node:'tip'},closedLayers:['ear'],panelHeight:78,sidebar:false,fillVisibility:{face:false}});
 a.editor.setState({viewId:'side'});a.flush();
 expect(a.editor.getState().project).toBe(projectBefore);
 const b=setup(a.storage);
 for(const key of ['zoom','pan','tool','layerId','selection','closedLayers','panelHeight','sidebar','fillVisibility'] as const)expect(b.drawing.getState()[key]).toEqual(a.drawing.getState()[key]);
 expect(b.workspace.getState().mode).toBe('drawing');expect(b.drawing.getState().room).toBe(true);expect(b.editor.getState().viewId).toBe('side');
 const saved=JSON.parse(a.storage.getItem(workspaceSessionKey(1))!);
 expect(saved).toMatchObject({version:2,mode:'drawing'});expect(saved.drawing.set).toBeUndefined();expect(saved.project).toBeUndefined();expect(saved.assembly).toBeUndefined();expect(saved.recording).toBeUndefined();expect(saved.room).toBeUndefined();expect(JSON.stringify(saved).length).toBeLessThan(2500);
 a.dispose();b.dispose();
});
test('Recording mode reloads through the current mode store and retains Drawing viewport state',()=>{
 const a=setup();a.drawing.setState({zoom:3,pan:[12,34]});a.workspace.getState().setMode('recording');a.flush();
 const b=setup(a.storage);expect(b.workspace.getState().mode).toBe('recording');expect(b.drawing.getState()).toMatchObject({room:false,zoom:3,pan:[12,34]});
 b.workspace.getState().setMode('drawing');b.flush();const c=setup(a.storage);expect(c.workspace.getState().mode).toBe('drawing');expect(c.drawing.getState().room).toBe(true);
 a.dispose();b.dispose();c.dispose();
});
test('opening another project saves and restores its current workspace mode and viewport',()=>{
 const a=setup();a.drawing.setState({pan:[99,-12]});a.workspace.getState().setMode('recording');a.editor.setState({viewId:'side'});
 a.editor.setState({project:project(2),viewId:'front'});expect(a.drawing.getState().pan).toEqual([0,0]);
 a.workspace.getState().setMode('drawing');a.drawing.setState({pan:[2,3]});a.editor.setState({project:project(1)});
 expect(a.workspace.getState().mode).toBe('recording');expect(a.drawing.getState().pan).toEqual([99,-12]);expect(a.editor.getState().viewId).toBe('side');
 a.editor.setState({project:project(2)});expect(a.workspace.getState().mode).toBe('drawing');expect(a.drawing.getState().pan).toEqual([2,3]);a.dispose();
});
test.each(['assembly','modeling','recording','drawing'])('v1 %s sessions migrate without restoring retired viewport payloads',room=>{
 const storage=memory();storage.setItem(workspaceSessionKey(1),JSON.stringify({version:1,room,assembly:{zoom:55,rigPan:[5,6],viewOptions:{folded:true}},recording:{zoom:44,view:{yaw:32,pitch:14}},drawing:{zoom:4,pan:[8,9]}}));
 const a=setup(storage);expect(a.workspace.getState().mode).toBe(room==='recording'?'recording':'drawing');expect(a.drawing.getState()).toMatchObject({zoom:4,pan:[8,9]});
 a.flush();const saved=JSON.parse(storage.getItem(workspaceSessionKey(1))!);expect(saved.version).toBe(2);expect(saved.assembly).toBeUndefined();expect(saved.recording).toBeUndefined();a.dispose();
});
test('without a project session the current global workspace preference is kept',()=>{
 const a=setup(memory(),1,'recording');expect(a.workspace.getState().mode).toBe('recording');expect(a.drawing.getState().room).toBe(false);a.dispose();
});
test('invalid UI data and unavailable storage do not stop project loading',()=>{
 const storage=memory();storage.setItem(workspaceSessionKey(1),'broken');let a=setup(storage);expect(a.drawing.getState().room).toBe(true);a.dispose();
 storage.setItem(workspaceSessionKey(1),JSON.stringify({version:2,mode:'assembly',drawing:{zoom:-1,tool:'garbage',pan:[4,null],set:'bad',selection:{ids:[5]}}}));
 a=setup(storage);expect(a.workspace.getState().mode).toBe('drawing');expect(a.drawing.getState()).toMatchObject({zoom:1,tool:'select',pan:[0,0],selection:{ids:[]}});expect(typeof a.drawing.getState().set).toBe('function');a.dispose();
 const denied={getItem:()=>{throw new Error('denied');},setItem:vi.fn(()=>{throw new Error('full');})};a=setup(denied);a.drawing.setState({zoom:4});expect(()=>a.flush()).not.toThrow();expect(a.drawing.getState().zoom).toBe(4);a.dispose();
});
test('navigation writes are coalesced and flush catches the last movement immediately',()=>{
 vi.useFakeTimers();const a=setup();for(let i=0;i<120;i++)a.drawing.setState({pan:[i,5]});expect(a.storage.setItem).not.toHaveBeenCalled();
 a.flush();expect(a.storage.setItem).toHaveBeenCalledTimes(1);expect(JSON.parse(a.storage.getItem(workspaceSessionKey(1))!).drawing.pan).toEqual([119,5]);
 vi.advanceTimersByTime(500);expect(a.storage.setItem).toHaveBeenCalledTimes(1);a.dispose();
});
