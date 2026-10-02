import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {loadThreePieceExample,planRecordingExampleImport,THREE_PIECE_EXAMPLE_NAME} from '../app/recordingExamples';
import {createEmptyProject} from '../app/emptyProject';
import {evaluateRecording} from '../app/vectorRecordingApi';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {addLayer,createCurve,moveHandle} from '../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotMatches} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addDeformer,createArtworkRig,drawingSignature,emptyVectorRecording,type ArtworkRig} from '../domain/vectorRecording/model';

const raw=readFileSync(new URL('../assets/three-piece-starting-example.json',import.meta.url),'utf8');
const example=()=>parseLandmarks(raw);
const planImport=(state:Parameters<typeof planRecordingExampleImport>[0],recording?:Parameters<typeof planRecordingExampleImport>[2])=>
 planRecordingExampleImport(state,example(),recording,{name:THREE_PIECE_EXAMPLE_NAME});
const rigIds=(r:ArtworkRig)=>[r.id,r.artworkId,...r.deformers.map(d=>d.id),...r.keys.map(k=>k.id)];

function simpleSource(name:string):DrawingDocument{
 const layered=addLayer(emptyDrawing(),name);
 return createCurve(layered,layered.layers[0].id,[[0,0],[.2,.1],[.7,.1],[1,0]],.008,name);
}

/** Use the same public store transaction as the example menu. In particular,
 * append to the recording AFTER the snapshot setters migrate $working. */
function applyImport(plan:ReturnType<typeof planImport>){
 const editor=useEditor.getState();
 editor.beginEdit();
 try{
  for(const step of plan.steps)editor.setDrawingSnapshotState(step);
  const current=useEditor.getState().project.vectorRecording??emptyVectorRecording();
  editor.setVectorRecording({...current,rigs:[...current.rigs,plan.rig]});
 }finally{editor.endEdit();}
 return useEditor.getState().project;
}

test('the starter loads as three saved artworks with independent original references',async()=>{
 const p=await loadThreePieceExample(async()=>raw),library=p.drawingSnapshots!;
 expect(library.items).toHaveLength(3);
 expect(snapshotMatches(p.drawing!,library,library.activeId!)).toBe(true);
 expect(library.items.find(a=>a.id===library.activeId)!.name).toBe(THREE_PIECE_EXAMPLE_NAME);
 for(const [name,file] of [['正面参考·镜像','hairless-symmetric-two-face-mirror.json'],['右侧90°参考','right90-reference.json']]){
  const saved=library.items.find(a=>a.name===name)!;
  expect(saved.id).not.toBe(library.activeId);
  expect(saved.drawing).toEqual(JSON.parse(readFileSync(new URL('../assets/'+file,import.meta.url),'utf8')));
 }
 await expect(loadThreePieceExample(async()=>'{}')).rejects.toThrow();
 expect(readFileSync(new URL('../assets/three-piece-starting-example.json',import.meta.url),'utf8')).toBe(raw);
});

test('three source pieces use exactly two independent warps and the existing five anchor keys',()=>{
 const p=example(),drawing=p.drawing!,rig=p.vectorRecording!.rigs[0];
 expect(p.vectorRecording!.rigs).toHaveLength(1);
 expect(drawing.curves).toHaveLength(129);
 expect(rig.artworkId).toBe(p.drawingSnapshots!.activeId);
 expect(rig.sourceSignature).toBe(drawingSignature(drawing));
 expect(rig.deformers).toHaveLength(2);
 expect(rig.deformers.every(d=>!d.parentId)).toBe(true);
 const left=drawing.layers.find(l=>l.name==='面部·左片')!,right=drawing.layers.find(l=>l.name==='面部·右片')!,red=drawing.layers.find(l=>l.name==='侧面前轮廓·独立红片')!;
 expect(Object.keys(rig.bindings).sort()).toEqual([left.id,right.id,red.id].sort());
 expect(rig.bindings[left.id]).toBe(rig.bindings[right.id]);
 expect(rig.bindings[red.id]).not.toBe(rig.bindings[left.id]);
 expect(rig.deformers.find(d=>d.id===rig.bindings[left.id])!.grid).toMatchObject({rows:3,columns:6});
 expect(rig.deformers.find(d=>d.id===rig.bindings[red.id])!.grid).toMatchObject({rows:1,columns:1});
 expect(rig.keys.map(k=>[k.angle.x,k.angle.y]).sort()).toEqual([[0,0],[-90,0],[90,0],[0,-90],[0,90]].sort());
 expect(rig.angle).toEqual({x:90,y:0});
 expect(rig.draft).toBeUndefined();
});

test('only the saved 90-degree key translates the shared face warp, without reshaping either grid',()=>{
 const p=example(),rig=p.vectorRecording!.rigs[0],faceLayer=p.drawing!.layers.find(l=>l.name==='面部·左片')!,faceId=rig.bindings[faceLayer.id];
 const neutral=rig.keys.find(k=>k.angle.x===0&&k.angle.y===0)!;
 for(const key of rig.keys){
  const translated=key.angle.x===90&&key.angle.y===0;
  expect(key.visibility).toEqual(neutral.visibility);
  expect(key.intervals).toEqual(neutral.intervals);
  expect(key.intervalOverrides).toEqual(neutral.intervalOverrides);
  for(const deformer of rig.deformers){
   const rest=deformer.grid,posed=key.grids[deformer.id];
   if(!translated||deformer.id!==faceId){expect(posed).toEqual(rest);continue;}
   const delta=posed.nodes[0].position.map((v,axis)=>v-rest.nodes[0].position[axis]);
   expect(delta[0]).toBeGreaterThan(0);
   expect(delta[1]).toBe(0);
   expect(posed.bounds).toEqual(rest.bounds);
   expect([posed.rows,posed.columns]).toEqual([rest.rows,rest.columns]);
   for(let index=0;index<rest.nodes.length;index++){
    for(const field of ['position','handleU','handleV'] as const){
     for(const axis of [0,1])expect(posed.nodes[index][field][axis]-rest.nodes[index][field][axis]).toBeCloseTo(delta[axis],12);
    }
    expect(posed.nodes[index].twist).toEqual(rest.nodes[index].twist);
   }
  }
 }
});

test('independent imports retain the starter poses and original source IDs at 0, 45 and 90 degrees',()=>{
 const p=example(),before=JSON.stringify(p),first=planImport({});
 const imported={...createEmptyProject(),...first.state,vectorRecording:{...p.vectorRecording!,rigs:[first.rig]}};
 expect(first.state.drawing).toEqual(p.drawing);
 expect(first.state.drawing).not.toBe(p.drawing);
 expect(first.state.drawingSnapshots!.items.at(-1)!.name).toBe(THREE_PIECE_EXAMPLE_NAME);
 for(const x of [0,45,90]){
  const original=evaluateRecording(p,{angle:{x,y:0}}),copy=evaluateRecording(imported,{angle:{x,y:0}});
  expect(copy.drawing).toEqual(original.drawing);
  expect(copy.routeDiagnostics).toEqual(original.routeDiagnostics);
  expect(copy.intervalTransportErrors).toEqual(original.intervalTransportErrors);
 }
 const second=planImport(first.state,imported.vectorRecording),allIds=[...rigIds(first.rig),...rigIds(second.rig)];
 expect(new Set(allIds).size).toBe(allIds.length);
 expect(second.state.drawingSnapshots!.items.slice(0,3)).toEqual(first.state.drawingSnapshots!.items);
 expect(second.state.drawingSnapshots!.items.at(-1)!.name).toBe(THREE_PIECE_EXAMPLE_NAME+' · 2');
 expect(JSON.stringify(p)).toBe(before);
},30000);

test('import preserves dirty source, both existing rigs and authored keys, settings, and one Undo/Redo',()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 vi.useFakeTimers();
 try{
  useWorkspaceMode.getState().setMode('drawing');
  const firstSource=simpleSource('Existing A'),first=saveDrawingSnapshot({drawing:firstSource},'Existing A');
  const firstRig=createArtworkRig(first.drawingSnapshots!.activeId!,firstSource);
  const secondSource=simpleSource('Existing B'),saved=saveDrawingSnapshot({...first,drawing:secondSource,drawingSnapshots:{...first.drawingSnapshots!,activeId:undefined}},'Existing B');
  const currentRig=addDeformer(createArtworkRig(saved.drawingSnapshots!.activeId!,secondSource),secondSource,[secondSource.layers[0].id]);
  const key=currentRig.keys.find(k=>k.angle.x===90&&k.angle.y===0)!;
  key.name='My authored key';key.visibility[secondSource.curves[0].id]=false;
  key.grids[currentRig.deformers[0].id]=structuredClone(key.grids[currentRig.deformers[0].id]);
  key.grids[currentRig.deformers[0].id].nodes[0].position[0]+=.017;
  const dirty=moveHandle(secondSource,{curveId:secondSource.curves[0].id,end:0},[.2,.37]);
  const recording={...emptyVectorRecording(),tolerance:.012,rigs:[firstRig,currentRig]};
  const project={...createEmptyProject(),...saved,drawing:dirty,vectorRecording:recording};
  project.meta.name='Keep my project name';
  useEditor.setState({project,past:[],future:[]});
  const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planImport(before,before.vectorRecording);
  expect(plan.steps).toHaveLength(3);
  expect(plan.preservedDraftId).toBeUndefined();
  expect(JSON.stringify(before)).toBe(bytes);
  const after=applyImport(plan);
  expect(after.drawingSnapshots!.items).toHaveLength(5);
  expect(after.drawingSnapshots!.items.slice(0,2)).toEqual(saved.drawingSnapshots!.items);
  expect(after.drawingWorkingCopies?.[saved.drawingSnapshots!.activeId!]).toEqual(dirty);
  expect(after.vectorRecording!.rigs.slice(0,2)).toEqual(recording.rigs);
  expect(after.vectorRecording!.rigs[2]).toEqual(plan.rig);
  expect(after.vectorRecording!.tolerance).toBe(.012);
  const unrelated=({drawing,drawingSnapshots,drawingWorkingCopies,vectorRecording,...rest}:typeof before)=>rest;
  expect(unrelated(after)).toEqual(unrelated(before));
  expect(useEditor.getState().past).toHaveLength(1);
  const reloaded=parseLandmarks(JSON.stringify(after));
  expect(reloaded.vectorRecording).toEqual(after.vectorRecording);
  expect(reloaded.drawingSnapshots).toEqual(after.drawingSnapshots);
  expect(reloaded.drawingWorkingCopies).toEqual(after.drawingWorkingCopies);
  useEditor.getState().undo();
  expect(useEditor.getState().project).toBe(before);
  expect(JSON.stringify(before)).toBe(bytes);
  useEditor.getState().redo();
  expect(useEditor.getState().project).toBe(after);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});

test.each([false,true])('starter preserves an existing $working rig and empty source=%s in one Undo',noDrawing=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 vi.useFakeTimers();
 try{
  useWorkspaceMode.getState().setMode('drawing');
  const source=emptyDrawing(),working=createArtworkRig('$working',source);
  useEditor.setState({project:{...createEmptyProject(),drawing:noDrawing?undefined:source,vectorRecording:{...emptyVectorRecording(),rigs:[working]}},past:[],future:[]});
  const before=useEditor.getState().project,plan=planImport(before,before.vectorRecording),after=applyImport(plan);
  expect(plan.preservedDraftId).toBeTruthy();
  expect(after.vectorRecording!.rigs[0]).toEqual({...working,artworkId:plan.preservedDraftId});
  expect(after.drawingSnapshots!.activeId).toBe(plan.artworkId);
  expect(useEditor.getState().past).toHaveLength(1);
  useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});
