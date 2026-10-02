import {readFileSync} from 'node:fs';
import {afterEach,expect,test,vi} from 'vitest';
import {loadRecordingExample,planRecordingExampleImport,RECORDING_EXAMPLE_NAME} from '../app/recordingExamples';
import {createEmptyProject} from '../app/emptyProject';
import {evaluateRecording} from '../app/vectorRecordingApi';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createArtworkRig,drawingSignature,emptyVectorRecording,evaluatePose,type VectorRecording} from '../domain/vectorRecording/model';

const raw=readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8');
const example=()=>parseLandmarks(raw);
const identifiers=(r:VectorRecording)=>r.rigs.flatMap(r=>[r.id,r.artworkId,...r.deformers.map(d=>d.id),...r.keys.map(k=>k.id)]);
afterEach(()=>vi.restoreAllMocks());

test('loader parses the frozen full project and rejects invalid input without touching the caller',async()=>{
 const p=await loadRecordingExample(async()=>raw);expect(p.drawing!.curves).toHaveLength(134);expect(p.vectorRecording!.rigs[0].deformers).toHaveLength(13);
 expect(p.drawingSnapshots!.items).toHaveLength(3);await expect(loadRecordingExample(async()=>'{}')).rejects.toThrow();
 expect(readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8')).toBe(raw);
});

test('imports independent saved front/side/source, remapping only rig ownership and all rig references',()=>{
 const p=example(),before=JSON.stringify(p),old=p.vectorRecording!.rigs[0],plan=planRecordingExampleImport({},p);
 expect(plan.steps).toHaveLength(3);expect(plan.preservedDraftId).toBeUndefined();expect(plan.state.drawingSnapshots!.activeId).toBe(plan.artworkId);
 expect(plan.state.drawingSnapshots!.items.map(a=>a.id)).toEqual([plan.frontArtworkId,plan.sideArtworkId,plan.artworkId]);
 expect(plan.state.drawingSnapshots!.items.at(-1)!.name).toBe(RECORDING_EXAMPLE_NAME);
 expect(plan.state.drawing).toEqual(p.drawing);expect(plan.state.drawing).not.toBe(p.drawing);
 for(const original of p.drawingSnapshots!.items){const copy=plan.state.drawingSnapshots!.items.find(a=>a.id===plan.idMaps.artworks[original.id])!;expect(copy.drawing).toEqual(original.drawing);expect(copy.drawing).not.toBe(original.drawing);}
 const r=plan.rig;expect(r.artworkId).toBe(plan.artworkId);expect(r.id).not.toBe(old.id);expect(r.sourceSignature).toBe(drawingSignature(plan.state.drawing!));expect(r.sourceIntervalFrames).toEqual(old.sourceIntervalFrames);expect(r.driver).toEqual(old.driver);expect(r.angle).toEqual(old.angle);expect(r.draft).toBeUndefined();
 for(const d of old.deformers){const copy=r.deformers.find(x=>x.id===plan.idMaps.deformers[d.id])!;expect(copy.grid).toEqual(d.grid);expect(copy.grid).not.toBe(d.grid);expect(copy.parentId).toBe(d.parentId?plan.idMaps.deformers[d.parentId]:undefined);}
 expect(r.bindings).toEqual(Object.fromEntries(Object.entries(old.bindings).map(([layer,id])=>[layer,plan.idMaps.deformers[id]])));
 for(const k of old.keys){const copy=r.keys.find(x=>x.id===plan.idMaps.keyforms[k.id])!;expect(copy.angle).toEqual(k.angle);expect(copy.visibility).toEqual(k.visibility);expect(copy.intervalOverrides).toEqual(k.intervalOverrides);expect(copy.grids).toEqual(Object.fromEntries(Object.entries(k.grids).map(([id,g])=>[plan.idMaps.deformers[id],g])));}
 expect(JSON.stringify(p)).toBe(before);
});

test('all 134 evaluated source cubics and interval coverage are identical after remapping at keys and interpolated angles',()=>{
 const p=example(),plan=planRecordingExampleImport({},p),imported={...createEmptyProject(),...plan.state,vectorRecording:{...p.vectorRecording!,rigs:[plan.rig]}};
 for(const x of [0,15,30,45,48,50,55,60,75,90]){
  const before=evaluateRecording(p,{angle:{x,y:0}}),after=evaluateRecording(imported,{angle:{x,y:0}});
  expect(after.drawing,`drawing at ${x}`).toEqual(before.drawing);expect(after.drawing.curves).toHaveLength(134);
  expect(after.routeDiagnostics).toEqual(before.routeDiagnostics);expect(after.intervalTransportErrors).toEqual(before.intervalTransportErrors);expect(after.maxError).toBe(before.maxError);
 }
},30000);

test('dirty existing source keeps its same-ID working copy without changing its checkpoint, settings or recording',()=>{
 const p=example(),saved=saveDrawingSnapshot({drawing:emptyDrawing()},'My artwork'),dirty={...saved.drawing!,mirrorAxisX:.2},rig=createArtworkRig(saved.drawingSnapshots!.activeId!,saved.drawing),existing={...emptyVectorRecording(),tolerance:.012,rigs:[rig]},state={...saved,drawing:dirty},json=JSON.stringify({state,existing}),plan=planRecordingExampleImport(state,p,existing);
 expect(plan.steps).toHaveLength(3);expect(plan.preservedDraftId).toBeUndefined();expect(plan.state.drawingSnapshots!.items).toHaveLength(4);expect(plan.state.drawingSnapshots!.items[0]).toEqual(saved.drawingSnapshots!.items[0]);
 expect(plan.state.drawingWorkingCopies![saved.drawingSnapshots!.activeId!]).toEqual(dirty);
 expect(JSON.stringify({state,existing})).toBe(json);expect(Object.keys(plan.state).sort()).toEqual(['drawing','drawingSnapshots','drawingWorkingCopies']);expect(plan).not.toHaveProperty('vectorRecording');
});

test('repeated imports create distinct artwork/rig/deformer/key IDs and unique names while leaving earlier copies unchanged',()=>{
 const p=example(),first=planRecordingExampleImport({},p),recording={...emptyVectorRecording(),rigs:[first.rig]},bytes=JSON.stringify(first),second=planRecordingExampleImport(first.state,p,recording),all=[...identifiers(recording),...identifiers({...recording,rigs:[second.rig]})];
 expect(new Set(all).size).toBe(all.length);expect(second.steps).toHaveLength(3);expect(second.state.drawingSnapshots!.items).toHaveLength(6);expect(second.state.drawingSnapshots!.items.at(-1)!.name).toBe(RECORDING_EXAMPLE_NAME+' · 2');
 expect(second.state.drawingSnapshots!.items.slice(0,3)).toEqual(first.state.drawingSnapshots!.items);expect(JSON.stringify(first)).toBe(bytes);
});

test('an authored draft and nonzero stored angle in the example survive import exactly',()=>{
 const p=example(),r=p.vectorRecording!.rigs[0];r.angle={x:30,y:0};r.draft=structuredClone(evaluatePose(r,r.angle,p.drawing));const d=r.deformers[0].id;r.draft.grids[d].nodes[0].position[0]+=.001;
 const plan=planRecordingExampleImport({},p);expect(plan.rig.angle).toEqual({x:30,y:0});expect(plan.rig.draft!.grids[plan.idMaps.deformers[d]]).toEqual(r.draft.grids[d]);expect(plan.rig.draft!.intervalOverrides).toEqual(r.draft.intervalOverrides);
});

test.each(['dirty','signature','binding','visibility','interval','frame','references'] as const)('invalid %s example is rejected before touching current work',kind=>{
 const p=example(),r=p.vectorRecording!.rigs[0],current=saveDrawingSnapshot({drawing:emptyDrawing()},'Keep'),before=JSON.stringify(current);
 if(kind==='dirty')p.drawing!.mirrorAxisX=99;
 if(kind==='signature')r.sourceSignature='stale';
 if(kind==='binding')r.bindings.missing=r.deformers[0].id;
 if(kind==='visibility')r.keys[0].visibility.missing=false;
 if(kind==='interval')r.keys[0].intervals.missing=false;
 if(kind==='frame')r.sourceIntervalFrames![Object.keys(r.sourceIntervalFrames!)[0]].signature='old';
 if(kind==='references')p.drawingSnapshots!.items[0].name='Missing';
 expect(()=>planRecordingExampleImport(current,p)).toThrow();expect(JSON.stringify(current)).toBe(before);
});

test('ID allocation handles one collision and refuses a broken allocator without any mutation',()=>{
 const p=example(),current=saveDrawingSnapshot({drawing:emptyDrawing()},'Keep'),before=JSON.stringify(current),existingId=current.drawingSnapshots!.activeId!,original=crypto.randomUUID.bind(crypto);let calls=0;
 const random=vi.spyOn(crypto,'randomUUID').mockImplementation(()=>++calls===1?existingId as ReturnType<typeof crypto.randomUUID>:original());
 const plan=planRecordingExampleImport(current,p);expect(new Set(plan.state.drawingSnapshots!.items.map(a=>a.id)).size).toBe(plan.state.drawingSnapshots!.items.length);
 random.mockImplementation(()=>existingId as ReturnType<typeof crypto.randomUUID>);expect(()=>planRecordingExampleImport(current,p)).toThrow(/无冲突/);expect(JSON.stringify(current)).toBe(before);
});

test('preflights route brush compilation for intermediate references before any import can be applied',()=>{
 const p=example(),front=p.drawingSnapshots!.items.find(a=>a.name==='正面参考·镜像')!;
 front.drawing.endpointLinks!.find(l=>l.throughDisplay)!.joinBrush={kind:'SMOOTH'};
 // Source JSON is structurally valid, but this chin uses noncollinear tangents
 // and requires its authored ARC. The store would reject the SMOOTH brush.
 expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();
 const state=saveDrawingSnapshot({drawing:emptyDrawing()},'Untouched'),before=JSON.stringify(state);
 expect(()=>planRecordingExampleImport(state,p)).toThrow(/平滑/);expect(JSON.stringify(state)).toBe(before);
});

test.each([false,true])('store import is one Undo and preserves a $working rig, including empty source=%s',noDrawing=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();try{
  useWorkspaceMode.getState().setMode('drawing');const source=emptyDrawing(),working=createArtworkRig('$working',source),recording={...emptyVectorRecording(),tolerance:.011,rigs:[working]};
  useEditor.setState({project:{...createEmptyProject(),drawing:noDrawing?undefined:source,vectorRecording:recording},past:[],future:[]});
  const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planRecordingExampleImport(before,example(),before.vectorRecording),s=useEditor.getState();
  expect(plan.preservedDraftId).toBeTruthy();s.beginEdit();for(const step of plan.steps)s.setDrawingSnapshotState(step);
  const current=useEditor.getState().project.vectorRecording!;s.setVectorRecording({...current,rigs:[...current.rigs,plan.rig]});s.endEdit();
  const after=useEditor.getState().project;expect(useEditor.getState().past).toHaveLength(1);expect(after.vectorRecording!.tolerance).toBe(.011);expect(after.vectorRecording!.rigs[0]).toEqual({...working,artworkId:plan.preservedDraftId});expect(after.drawingSnapshots!.activeId).toBe(plan.artworkId);
  const reloaded=parseLandmarks(JSON.stringify(after));expect(reloaded.vectorRecording).toEqual(after.vectorRecording);expect(reloaded.drawing).toEqual(after.drawing);expect(reloaded.drawingSnapshots).toEqual(after.drawingSnapshots);
  s.undo();expect(useEditor.getState().project).toBe(before);expect(JSON.stringify(before)).toBe(bytes);s.redo();expect(useEditor.getState().project).toBe(after);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});
