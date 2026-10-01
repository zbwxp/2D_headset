import {expect,test,vi} from 'vitest';
import {prepareArtworkAction,artworkOverview,ArtworkApiError} from '../app/vectorArtworkApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {createArtworkRig} from '../domain/vectorRecording/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';

function project():LandmarkProject{let drawing=addLayer(emptyDrawing(),'Face');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.1,.1],[.4,.1],[.5,0]],.01,'Line','line');return {...createEmptyProject(),drawing};}
function saved(){const p=project(),s=prepareArtworkAction(p,{op:'save',name:'Front'});return {...p,...s.state};}
const code=(fn:()=>unknown,expected:string)=>{try{fn();throw Error('Expected failure');}catch(e){expect(e).toBeInstanceOf(ArtworkApiError);expect((e as ArtworkApiError).code).toBe(expected);}};

test('save always creates a fresh artwork unless an explicit stable ID is provided',()=>{
 const p=project(),original=structuredClone(p),first=prepareArtworkAction(p,{op:'save',name:'Front'}),a={...p,...first.state},second=prepareArtworkAction(a,{op:'save',name:'Front'});
 expect(first.result.created).toBe(true);expect(second.result.artworkId).not.toBe(first.result.artworkId);expect(second.state.drawingSnapshots!.items).toHaveLength(2);expect(p).toEqual(original);
 const id=first.result.artworkId,rig=createArtworkRig(id,p.drawing),withRig={...a,vectorRecording:{version:1 as const,rigs:[rig],tolerance:.004}},replace=prepareArtworkAction(withRig,{op:'save',artworkId:id,name:'Front updated'});
 expect(replace.result.created).toBe(false);expect(replace.result.artworkId).toBe(id);expect(replace.state.drawingSnapshots!.items).toHaveLength(1);expect(withRig.vectorRecording.rigs[0]).toBe(rig);
});

test('rename only changes the label and never captures dirty working geometry',()=>{
 const p=saved(),id=p.drawingSnapshots!.activeId!,originalSaved=p.drawingSnapshots!.items[0].drawing,working={...p.drawing!,curves:p.drawing!.curves.map(c=>({...c,name:'Unsaved edit'}))},dirty={...p,drawing:working};
 const r=prepareArtworkAction(dirty,{op:'rename',artworkId:id,name:'Portrait'});expect(r.state.drawing).toBe(working);expect(r.state.drawingSnapshots!.items[0].drawing).toBe(originalSaved);expect(r.state.drawingSnapshots!.items[0].id).toBe(id);expect(artworkOverview({...dirty,...r.state}).dirty).toBe(true);
});

test('restore defaults to preserving dirty working source and requires explicit discard permission',()=>{
 const p=saved(),id=p.drawingSnapshots!.activeId!,dirty={...p,drawing:{...p.drawing!,mirrorAxisX:.8}},before=structuredClone(dirty);
 code(()=>prepareArtworkAction(dirty,{op:'restore',artworkId:id}),'UNSAVED_SOURCE');expect(dirty).toEqual(before);
 const r=prepareArtworkAction(dirty,{op:'restore',artworkId:id,discardUnsaved:true});expect(r.state.drawing?.mirrorAxisX).toBeUndefined();expect(r.result.workingSourcePreserved).toBe(false);expect(dirty).toEqual(before);
});

test('deletion preserves working source and refuses to orphan any recording rig',()=>{
 const p=saved(),id=p.drawingSnapshots!.activeId!,rig=createArtworkRig(id,p.drawing),bound={...p,vectorRecording:{version:1 as const,rigs:[rig],tolerance:.004}};
 code(()=>prepareArtworkAction(bound,{op:'delete',artworkId:id}),'ARTWORK_HAS_RIG');expect(bound.drawingSnapshots!.items).toHaveLength(1);
 const r=prepareArtworkAction(p,{op:'delete',artworkId:id});expect(r.state.drawing).toBe(p.drawing);expect(r.state.drawingSnapshots!.activeId).toBeUndefined();expect(r.state.drawingSnapshots!.items).toEqual([]);expect(p.drawingSnapshots!.items).toHaveLength(1);
});

test('single-operation validation rejects unknown IDs, extra fields, bad names and operation arrays',()=>{
 const p=saved(),id=p.drawingSnapshots!.activeId!;
 code(()=>prepareArtworkAction(p,{op:'save',artworkId:'missing',name:'New'}),'NOT_FOUND');
 code(()=>prepareArtworkAction(p,{op:'rename',artworkId:id,name:' '}),'INVALID_REQUEST');
 code(()=>prepareArtworkAction(p,{op:'delete',artworkId:id,discardUnsaved:true}),'INVALID_REQUEST');
 code(()=>prepareArtworkAction(p,{op:'restore',artworkId:id,discardUnsaved:'yes'}),'INVALID_REQUEST');
 code(()=>prepareArtworkAction(p,[{op:'save',name:'A'},{op:'save',name:'B'}]),'INVALID_REQUEST');
 code(()=>prepareArtworkAction(p,{op:'replaceProject',project:{}}),'UNKNOWN_COMMAND');
});

test('inspection returns metadata only and reports saved identity, dirty state and rig ownership',()=>{
 const p=saved(),id=p.drawingSnapshots!.activeId!,r=artworkOverview({...p,vectorRecording:{version:1,rigs:[createArtworkRig(id,p.drawing)],tolerance:.004}});
 expect(r.activeId).toBe(id);expect(r.dirty).toBe(false);expect(r.items[0]).toMatchObject({id,name:'Front',layerCount:1,curveCount:1,active:true,hasReference:false});expect(r.items[0].rigIds).toHaveLength(1);expect(r.items[0]).not.toHaveProperty('drawing');expect(r.items[0]).not.toHaveProperty('reference');
});

test('artwork IDs are opaque and are never trimmed or confused with their labels',()=>{
 const p=saved(),id=' front ',library={...p.drawingSnapshots!,activeId:id,items:p.drawingSnapshots!.items.map(x=>({...x,id}))},input={...p,drawingSnapshots:library};
 const r=prepareArtworkAction(input,{op:'rename',artworkId:id,name:'  A label  '});expect(r.result.artworkId).toBe(id);expect(r.result.name).toBe('A label');expect(r.state.drawingSnapshots!.activeId).toBe(id);
 code(()=>prepareArtworkAction(input,{op:'rename',artworkId:'front',name:'Wrong ID'}),'NOT_FOUND');
});

test('artwork facade uses one root undo transaction, first-save rig mapping and Recording/stale gates',()=>{
 const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const p=project(),rig=createArtworkRig('$working',p.drawing),initial={...p,vectorRecording:{version:1 as const,rigs:[rig],tolerance:.004}};useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:initial,past:[],future:[]});const api=createVectorEditingApi(),revision=api.inspect().revision;
  const dry=api.artwork({op:'save',name:'Front',dryRun:true,expectedRevision:revision});expect(dry.ok).toBe(true);expect(useEditor.getState().project).toBe(initial);expect(useEditor.getState().past).toEqual([]);expect(api.inspect().revision).toBe(revision);
  const result=api.artwork({op:'save',name:'Front',expectedRevision:revision});expect(result.ok).toBe(true);if(!result.ok)throw Error(result.error.message);const id=result.value.artworkId,after=useEditor.getState().project;
  expect(after.drawingSnapshots!.activeId).toBe(id);expect(after.vectorRecording!.rigs[0]).toEqual({...rig,artworkId:id});expect(useEditor.getState().past).toHaveLength(1);
  expect(api.artwork({op:'rename',artworkId:id,name:'Stale',expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
  expect(api.artwork({op:'delete',artworkId:id})).toMatchObject({ok:false,error:{code:'ARTWORK_HAS_RIG'}});expect(useEditor.getState().project).toBe(after);
  useWorkspaceMode.getState().setMode('recording');expect(api.artwork({op:'rename',artworkId:id,name:'Forbidden'})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(api.inspectArtworks().ok).toBe(true);expect(api.undo()).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});
  useWorkspaceMode.getState().setMode('drawing');expect(api.undo().ok).toBe(true);expect(useEditor.getState().project).toEqual(initial);expect(api.redo().ok).toBe(true);expect(useEditor.getState().project).toEqual(after);
  expect(api.artwork({op:'rename',artworkId:id,name:'Portrait'}).ok).toBe(true);expect(useEditor.getState().project.vectorRecording).toBe(after.vectorRecording);expect(useEditor.getState().project.drawingSnapshots!.items[0].id).toBe(id);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.unstubAllGlobals();vi.useRealTimers();}
});

test('artwork deletion remains normally undoable and a custom host cannot bypass unavailable commits',()=>{
 const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const p=saved(),id=p.drawingSnapshots!.activeId!;useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:p,past:[],future:[]});const api=createVectorEditingApi();expect(api.artwork({op:'delete',artworkId:id}).ok).toBe(true);expect(useEditor.getState().project.drawing).toBe(p.drawing);expect(useEditor.getState().past).toHaveLength(1);api.undo();expect(useEditor.getState().project).toEqual(p);
  const custom=createVectorEditingApi({getState:()=>({project:p,past:[],future:[]}),getMode:()=> 'drawing',commitDrawing(){throw Error('Wrong transaction');},undo(){},redo(){}});expect(custom.artwork({op:'save',name:'Copy'})).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(custom.artwork({op:'save',name:'Copy',dryRun:true}).ok).toBe(true);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.unstubAllGlobals();vi.useRealTimers();}
});
