import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {serializeProject} from '../app/autosave';
import {evaluateRecording,prepareRecordingBatch,recordingOverview} from '../app/vectorRecordingApi';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {moveHandle,createCurve} from '../domain/drawing/commands';
import {parseDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotMatches} from '../domain/drawing/snapshots';
import {acceptArtworkSource,currentPose,type ArtworkRig} from '../domain/vectorRecording/model';
import type {LandmarkProject} from '../domain/landmarks/model';

const raw=readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8');
const originalEditor=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
const rigOf=(p:LandmarkProject):ArtworkRig=>p.vectorRecording!.rigs.find(r=>r.artworkId===p.drawingSnapshots!.activeId)!;
const mouthId=(d:DrawingDocument)=>d.curves.find(c=>d.layers.find(l=>l.name==='嘴部')!.items.includes(c.id))!.id;
function loaded(){useEditor.getState().load(parseLandmarks(raw));useEditor.setState({past:[],future:[]});return useEditor.getState().project;}
function editMouth(dy=.01){const s=useEditor.getState(),d=s.project.drawing!,id=mouthId(d),handle=d.curves.find(c=>c.id===id)!.handles[0];s.beginEdit();try{s.setDrawing(moveHandle(d,{curveId:id,end:0},[handle[0],handle[1]+dy]));}finally{s.endEdit();}return useEditor.getState().project;}
function updateCurrent(){const s=useEditor.getState(),p=s.project,active=p.drawingSnapshots!.items.find(x=>x.id===p.drawingSnapshots!.activeId)!;s.beginEdit();try{s.setDrawingSnapshotState(saveDrawingSnapshot({drawing:p.drawing,drawingSnapshots:p.drawingSnapshots},active.name,active.id));}finally{s.endEdit();}return useEditor.getState().project;}
const ready=(p:LandmarkProject)=>expect(recordingOverview(p)).toMatchObject({exists:true,sourceReviewRequired:false});
const unchangedRigArt=(a:ArtworkRig,b:ArtworkRig)=>{expect(a.id).toBe(b.id);expect(a.artworkId).toBe(b.artworkId);expect(a.deformers).toEqual(b.deformers);expect(a.bindings).toEqual(b.bindings);expect(a.keys).toEqual(b.keys);expect(a.draft).toEqual(b.draft);};
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(originalEditor,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});

test('actual mouth edit → update current artwork → Recording X90 updates source without replacing its rig',()=>{
 const before=loaded(),oldRig=rigOf(before),id=mouthId(before.drawing!),baseline=evaluateRecording(before,{angle:{x:90,y:0}}),edited=editMouth();
 ready(edited);expect(snapshotMatches(edited.drawing!,edited.drawingSnapshots!,oldRig.artworkId)).toBe(false);
 const saved=updateCurrent();expect(saved.drawingSnapshots!.activeId).toBe(oldRig.artworkId);expect(snapshotMatches(saved.drawing!,saved.drawingSnapshots!,oldRig.artworkId)).toBe(true);unchangedRigArt(rigOf(saved),oldRig);ready(saved);
 useWorkspaceMode.getState().setMode('recording');const batch=prepareRecordingBatch(saved,{commands:[{op:'setAngle',angle:{x:90,y:0}}]});
 // Same setter used after a validated Recording batch; no new rig or keyform.
 useEditor.getState().setVectorRecording(batch.next);const posed=useEditor.getState().project,out=evaluateRecording(posed);
 expect(rigOf(posed).angle).toEqual({x:90,y:0});expect(shapeOf(out.drawing,id)).not.toEqual(shapeOf(baseline.drawing,id));expect(posed.drawing).toBe(saved.drawing);expect(posed.drawingSnapshots).toBe(saved.drawingSnapshots);unchangedRigArt(rigOf(posed),oldRig);
});

test('one source-edit Undo/Redo restores both geometry and source compatibility metadata',()=>{
 const before=loaded(),oldRig=rigOf(before),after=editMouth();expect(useEditor.getState().past).toHaveLength(1);ready(after);unchangedRigArt(rigOf(after),oldRig);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);ready(useEditor.getState().project);
 useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);ready(useEditor.getState().project);unchangedRigArt(rigOf(useEditor.getState().project),oldRig);
});

test('updated actual source and automatic compatibility survive project save/reload',()=>{
 const before=loaded(),oldRig=rigOf(before);editMouth();const saved=updateCurrent(),json=serializeProject(saved),reloaded=parseLandmarks(json);
 useEditor.getState().load(reloaded);const after=useEditor.getState().project;ready(after);unchangedRigArt(rigOf(after),oldRig);expect(after.drawing).toEqual(saved.drawing);expect(snapshotMatches(after.drawing!,after.drawingSnapshots!,oldRig.artworkId)).toBe(true);expect(()=>evaluateRecording(after,{angle:{x:90,y:0}})).not.toThrow();
});

test('same-topology source synchronization preserves an existing unsaved pose draft exactly',()=>{
 const initial=loaded(),oldRig=rigOf(initial),draft=structuredClone(currentPose(oldRig,initial.drawing)),deformer=oldRig.deformers[0];draft.grids[deformer.id].nodes[0].position[0]+=.002;
 const recording={...initial.vectorRecording!,rigs:initial.vectorRecording!.rigs.map(r=>r.id===oldRig.id?{...r,draft}:r)};useEditor.getState().setVectorRecording(recording);const before=rigOf(useEditor.getState().project),after=editMouth();ready(after);unchangedRigArt(rigOf(after),before);expect(rigOf(updateCurrent()).draft).toEqual(draft);
 expect(()=>prepareRecordingBatch(useEditor.getState().project,{commands:[{op:'setAngle',angle:{x:90,y:0}}]})).toThrow(/Save or explicitly discard/);
});

test('adding source topology keeps the existing review policy without discarding keyforms',()=>{
 const before=loaded(),oldRig=rigOf(before),d=before.drawing!,layer=d.layers.find(l=>l.name==='嘴部')!.id,next=createCurve(d,layer,[[0,-.7],[.01,-.7],[.02,-.7],[.03,-.7]],.008,'Added topology','source-sync-added');
 useEditor.getState().beginEdit();useEditor.getState().setDrawing(next);useEditor.getState().endEdit();const after=updateCurrent();expect(recordingOverview(after)).toMatchObject({sourceReviewRequired:true});unchangedRigArt(rigOf(after),oldRig);expect(()=>evaluateRecording(after,{angle:{x:90,y:0}})).toThrow(/Source artwork changed/);
});

/** Reproduce an older saved file after its accepted source snapshot was
 * overwritten. Its full hash still identifies the bundled example baseline. */
function legacyStale(){
 const project=parseLandmarks(raw),before=project.drawing!,id=mouthId(before),p=before.curves.find(c=>c.id===id)!.handles[0];
 const drawing=finalizeGeometryEdit(before,moveHandle(before,{curveId:id,end:0},[p[0],p[1]+.01])),current=project.drawingSnapshots!.items.find(a=>a.id===project.drawingSnapshots!.activeId)!;
 return {...project,...saveDrawingSnapshot({drawing,drawingSnapshots:project.drawingSnapshots},current.name,current.id)};
}

test('old stale example save/reload recovers from the exact bundled baseline without replacing edited source or keys',()=>{
 const stale=parseLandmarks(serializeProject(legacyStale())),oldRig=rigOf(stale),source=stale.drawing,library=stale.drawingSnapshots;
 useEditor.getState().load(stale);const after=useEditor.getState().project;ready(after);expect(after.drawing).toEqual(source);expect(after.drawingSnapshots).toEqual(library);unchangedRigArt(rigOf(after),oldRig);expect(after.vectorRecording).toEqual(stale.vectorRecording);const scene=after.recordingScenes!.scenes.find(s=>s.legacy?.rigId===oldRig.id)!;expect(scene.instances[0].sourceStructureSignature).toBeTruthy();expect(scene.instances[0].sourceSignature).not.toBe(oldRig.sourceSignature);
 const reloaded=parseLandmarks(serializeProject(after));ready(reloaded);expect(()=>evaluateRecording(reloaded,{angle:{x:90,y:0}})).not.toThrow();
});

test('direct Recording inspection and preview derive legacy recovery without mutating their input project',()=>{
 const stale=legacyStale(),before=JSON.stringify(stale),oldRig=rigOf(stale),source=stale.drawing,library=stale.drawingSnapshots;
 expect(recordingOverview(stale,{angle:{x:90,y:0}})).toMatchObject({exists:true,sourceReviewRequired:false,poseEvaluationError:null});
 const preview=evaluateRecording(stale,{angle:{x:90,y:0}});expect(preview.angle).toEqual({x:90,y:0});expect(preview.drawing.curves).toHaveLength(source!.curves.length);
 const prepared=prepareRecordingBatch(stale,{commands:[{op:'setAngle',angle:{x:90,y:0}}],dryRun:true}),nextRig=prepared.next.rigs.find(r=>r.id===oldRig.id)!;expect(nextRig.angle).toEqual({x:90,y:0});unchangedRigArt(nextRig,oldRig);
 expect(JSON.stringify(stale)).toBe(before);expect(stale.drawing).toBe(source);expect(stale.drawingSnapshots).toBe(library);expect(rigOf(stale)).toBe(oldRig);
});

test('the recovery baseline is exactly the parsed source of the bundled yaw example',()=>{
 const baseline=parseDrawing(JSON.parse(readFileSync(new URL('../assets/recording-source-baseline.json',import.meta.url),'utf8')));
 expect(baseline).toEqual(parseLandmarks(raw).drawing);
});

test('unknown legacy hashes retain the current explicit-review policy rather than guessing from interval frames',async()=>{
 const stale=legacyStale(),old=rigOf(stale);old.sourceSignature='unknown-accepted-source';delete old.sourceStructureSignature;
 useEditor.setState({project:stale,past:[],future:[]});expect(await useEditor.getState().recoverVectorRecordingSource(async()=>[parseLandmarks(raw).drawing!])).toBe(false);
 expect(useEditor.getState().project).toBe(stale);expect(recordingOverview(stale)).toMatchObject({sourceReviewRequired:true});expect(useEditor.getState().past).toHaveLength(0);
 const accepted=prepareRecordingBatch(stale,{commands:[{op:'acceptSource'}]});useEditor.getState().setVectorRecording(accepted.next);ready(useEditor.getState().project);unchangedRigArt(rigOf(useEditor.getState().project),old);
});

test('late recovery never overwrites a project changed while its baseline was loading',async()=>{
 // A non-bundled accepted source requires the injected loader. The source
 // topology matches, but its unique old geometry has a distinct complete hash.
 const original=parseLandmarks(raw),source=original.drawing!,id=mouthId(source),handle=source.curves.find(c=>c.id===id)!.handles[0],baseline=finalizeGeometryEdit(source,moveHandle(source,{curveId:id,end:0},[handle[0],handle[1]+.02]));
 const baseRig=acceptArtworkSource(rigOf(original),baseline),changed=finalizeGeometryEdit(baseline,moveHandle(baseline,{curveId:id,end:0},[handle[0],handle[1]+.03])),current=original.drawingSnapshots!.items.find(a=>a.id===original.drawingSnapshots!.activeId)!,saved=saveDrawingSnapshot({drawing:changed,drawingSnapshots:original.drawingSnapshots},current.name,current.id),stale={...original,...saved,vectorRecording:{...original.vectorRecording!,rigs:[baseRig]}};
 useEditor.setState({project:stale,past:[],future:[]});let resolve!:(drawings:DrawingDocument[])=>void;
 const load=vi.fn(()=>new Promise<DrawingDocument[]>(yes=>{resolve=yes;})),pending=useEditor.getState().recoverVectorRecordingSource(load);expect(load).toHaveBeenCalledOnce();
 const newer={...stale,meta:{...stale.meta,name:stale.meta.name+' changed while loading'}};useEditor.setState({project:newer});resolve([baseline]);
 expect(await pending).toBe(false);expect(useEditor.getState().project).toBe(newer);expect(recordingOverview(newer)).toMatchObject({sourceReviewRequired:true});
});

test('legacy structural changes retain the current review policy even with an exact old source',()=>{
 const stale=legacyStale(),d=stale.drawing!,layer=d.layers.find(l=>l.name==='嘴部')!.id,drawing=createCurve(d,layer,[[0,-.7],[.01,-.7],[.02,-.7],[.03,-.7]],.008,'Legacy added topology','legacy-source-added'),item=stale.drawingSnapshots!.items.find(a=>a.id===stale.drawingSnapshots!.activeId)!;
 const changed={...stale,...saveDrawingSnapshot({drawing,drawingSnapshots:stale.drawingSnapshots},item.name,item.id)};
 useEditor.getState().load(changed);const after=useEditor.getState().project;expect(recordingOverview(after)).toMatchObject({sourceReviewRequired:true});unchangedRigArt(rigOf(after),rigOf(stale));
});
