import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve,moveHandle} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {addDeformer,createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';
import RecordingWorkspace from '../ui/vectorRecording/RecordingWorkspace';

vi.mock('../app/store',async importOriginal=>{const m=await importOriginal<typeof import('../app/store')>();return {...m,useEditor:Object.assign((select?:(s:ReturnType<typeof m.useEditor.getState>)=>unknown)=>select?select(m.useEditor.getState()):m.useEditor.getState(),m.useEditor)};});

test('an existing source handle edit keeps the Recording canvas and angle controls mounted',()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();
 try{
  useWorkspaceMode.getState().setMode('drawing');let drawing=addLayer(emptyDrawing(),'Mouth'),layer=drawing.layers[0].id;
  drawing=createCurve(drawing,layer,[[0,0],[.1,.1],[.2,.1],[.3,0]],.008,'Mouth');
  const rig=addDeformer(createArtworkRig('$working',drawing),drawing,[layer]);
  useEditor.setState({project:{...createEmptyProject(),drawing,vectorRecording:{...emptyVectorRecording(),rigs:[rig]}},past:[],future:[]});
  const id=drawing.curves[0].id;useEditor.getState().beginEdit();useEditor.getState().setDrawing(moveHandle(drawing,{curveId:id,end:0},[.1,.11]));useEditor.getState().endEdit();
  useWorkspaceMode.getState().setMode('recording');const html=renderToStaticMarkup(createElement(RecordingWorkspace));
  expect(html).toContain('data-testid="vector-recording"');expect(html).toContain('data-testid="vr-canvas"');expect(html).toContain('Angle X');expect(html).not.toContain('data-testid="vr-accept-source"');
  expect(useEditor.getState().project.vectorRecording!.rigs[0].deformers).toBe(rig.deformers);
  expect(useEditor.getState().project.vectorRecording!.rigs[0].keys).toBe(rig.keys);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});
