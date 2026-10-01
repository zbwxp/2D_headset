import {describe,it,expect,vi} from 'vitest';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {createEmptyProject} from '../../app/emptyProject';
import {emptyDrawing} from '../../domain/drawing/model';
import {saveDrawingSnapshot} from '../../domain/drawing/snapshots';
import {createArtworkRig,emptyVectorRecording,drawingSignature,acceptArtworkSource,addDeformer} from '../../domain/vectorRecording/model';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {serializeProject} from '../../app/autosave';
const source=()=>({...emptyDrawing(),layers:[{id:'l',name:'Layer',items:['c'],visible:true,locked:false}],nodes:[{id:'n0',position:[0,0] as [number,number]},{id:'n1',position:[1,1] as [number,number]}],curves:[{id:'c',name:'Curve',nodes:['n0','n1'] as [string,string],handles:[[.3,.3],[.7,.7]] as [[number,number],[number,number]],visible:true,locked:false,width:.01}]});
describe('workspace lifecycle boundaries',()=>{
 it('first save rekeys the working rig without stranding keyforms; source update needs review',()=>{
  const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
  try{useWorkspaceMode.getState().setMode('drawing');const drawing=source(),r=addDeformer(createArtworkRig('$working',drawing),drawing,['l']);useEditor.setState({project:{...createEmptyProject(),drawing,vectorRecording:{...emptyVectorRecording(),rigs:[r]}},past:[],future:[]});
   const state=saveDrawingSnapshot(useEditor.getState().project,'Front');useEditor.getState().setDrawingSnapshotState(state);
   const saved=useEditor.getState().project.vectorRecording!.rigs[0];expect(saved.artworkId).toBe(state.drawingSnapshots!.activeId);expect(saved.id).toBe(r.id);expect(saved.keys).toEqual(r.keys);
   const next={...drawing,curves:drawing.curves.map(c=>({...c,name:'Changed'}))};useEditor.getState().setDrawing(next);expect(saved.sourceSignature).not.toBe(drawingSignature(next));const reviewed=acceptArtworkSource(saved,next);expect(reviewed.sourceSignature).toBe(drawingSignature(next));expect(reviewed.keys).toEqual(saved.keys);
  }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.unstubAllGlobals();vi.useRealTimers();}
 });
 it('source-changing undo is blocked in Recording; keyform undo remains allowed',()=>{
  const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
  try{useWorkspaceMode.getState().setMode('drawing');const drawing=source();useEditor.setState({project:{...createEmptyProject(),drawing},past:[],future:[]});const s=useEditor.getState();s.beginEdit();s.setDrawing({...drawing,mirrorAxisX:.2});s.endEdit();useWorkspaceMode.getState().setMode('recording');const p=useEditor.getState().project;s.undo();expect(useEditor.getState().project).toBe(p);expect(()=>s.setDrawingSnapshotState({drawing})).toThrow();
   s.commitVectorRecording({...emptyVectorRecording(),rigs:[createArtworkRig('$working',p.drawing)]});expect(useEditor.getState().project.vectorRecording).toBeDefined();s.undo();expect(useEditor.getState().project.vectorRecording).toBeUndefined();expect(useEditor.getState().project.drawing).toBe(p.drawing);
  }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.unstubAllGlobals();vi.useRealTimers();}
 });
 it('malformed retired workspaces are archived without blocking canonical source loading',()=>{
  const drawing=source(),legacy={poseRecording:{broken:'raw old poses'},assembly:{broken:'raw old assembly'}};const loaded=parseLandmarks(JSON.stringify({...createEmptyProject(),drawing,...legacy}));expect(loaded.drawing).toEqual(drawing);expect(loaded.poseRecording).toBeUndefined();expect(loaded.assembly).toBeUndefined();expect(loaded.legacyWorkspaces?.poseRecording).toEqual(legacy.poseRecording);expect(loaded.legacyWorkspaces?.assembly).toEqual(legacy.assembly);const reloaded=parseLandmarks(serializeProject(loaded));expect(reloaded.legacyWorkspaces).toEqual(loaded.legacyWorkspaces);
 });
});
