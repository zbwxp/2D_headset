import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import RecordingWorkspace from '../ui/vectorRecording/RecordingWorkspace';
import {useDrawing} from '../ui/drawing/session';
import {useEditor} from '../app/store';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {emptyDrawing} from '../domain/drawing/model';
import {addLayer,createCurve,connect} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';

// Server rendering reads each store's initial snapshot; use its current test state.
vi.mock('../app/store',async importOriginal=>{const m=await importOriginal<typeof import('../app/store')>();return {...m,useEditor:Object.assign((selector?:(s:ReturnType<typeof m.useEditor.getState>)=>unknown)=>selector?selector(m.useEditor.getState()):m.useEditor.getState(),m.useEditor)};});
vi.mock('../ui/drawing/session',async importOriginal=>{const m=await importOriginal<typeof import('../ui/drawing/session')>();return {...m,useDrawing:Object.assign((selector?:(s:ReturnType<typeof m.useDrawing.getState>)=>unknown)=>selector?selector(m.useDrawing.getState()):m.useDrawing.getState(),m.useDrawing)};});

test('Recording fill visibility is a view preference and leaves source, rig, undo and ordinary export unchanged',()=>{
 const editor=useEditor.getState(),session=useDrawing.getState();
 try{
  let d=addLayer(emptyDrawing(),'Face');const layer=d.layers[0].id;
  for(const shape of [[[0,0],[.3,0],[.7,0],[1,0]],[[1,0],[.8,.4],[.7,.7],[.5,1]],[[.5,1],[.3,.7],[.1,.3],[0,0]]] as [[number,number],[number,number],[number,number],[number,number]][])d=createCurve(d,layer,shape);
  const ids=d.curves.map(c=>c.id);for(let i=0;i<3;i++)d=connect(d,{curveId:ids[i],end:1},{curveId:ids[(i+1)%3],end:0},'POSITION');d=createFill(d,ids,'white');
  const project={...createEmptyProject(),drawing:d,vectorRecording:{...emptyVectorRecording(),rigs:[createArtworkRig('$working',d)]}};
  useEditor.setState({project,past:[],future:[]});useDrawing.getState().set({showFills:true});
  const api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source write')},undo(){},redo(){}}),before=JSON.stringify(project),exported=api.preview({showFills:true});
  expect(renderToStaticMarkup(createElement(RecordingWorkspace))).toContain('data-testid="drawing-fill"');
  useDrawing.getState().set({showFills:false});
  const hidden=renderToStaticMarkup(createElement(RecordingWorkspace));expect(hidden).not.toContain('data-testid="drawing-fill"');expect(hidden).toContain('data-testid="vr-show-fills" aria-pressed="false"');
  expect(useEditor.getState().project).toBe(project);expect(JSON.stringify(project)).toBe(before);expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().future).toEqual([]);expect(api.preview({showFills:true})).toEqual(exported);
 }finally{useEditor.setState(editor,true);useDrawing.setState(session,true);}
});
