import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import App from '../app/App';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {serializeProject} from '../app/autosave';
import {currentDrawingPresentation} from '../app/drawingSnapshotPresentation';
import {prepareSnapshotEdit,snapshotEditContext} from '../app/snapshotEditTransaction';
import {prepareSnapshotBatch} from '../app/recordingSnapshotApi';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {addLayer,createCurve,deleteCurves} from '../domain/drawing/commands';
import {createCurveSplitIntent,applyCurveSplitIntent} from '../domain/drawing/layerEditIntent';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {clearRecordingRelationships,recordingRetirementStatus,RECORDING_RETIRED_MESSAGE} from '../domain/recordingSnapshot/retirement';
import {emptySnapshotRecording,emptyRecordingSnapshot} from '../domain/recordingSnapshot/model';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {parseLandmarks} from '../domain/landmarks/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {SnapshotCommand} from '../domain/recordingSnapshot/commands';

vi.mock('../app/store',async original=>{const m=await original<typeof import('../app/store')>();return {...m,useEditor:Object.assign((select?:(s:ReturnType<typeof m.useEditor.getState>)=>unknown)=>select?select(m.useEditor.getState()):m.useEditor.getState(),m.useEditor)};});

const previous=useEditor.getState(),previousMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{useEditor.getState().endEdit();vi.runAllTimers();useEditor.setState(previous,true);useWorkspaceMode.getState().setMode(previousMode);vi.useRealTimers();});
function drawing(name='Face'):DrawingDocument{
 let d=addLayer(emptyDrawing(),name);d=createCurve(d,d.layers[0].id,[[-.5,0],[-.25,.4],[.25,.4],[.5,0]],.027,name,`${name}-curve`);
 d.curves[0].depthOffset=3;d.curves[0].inkVisible=false;d.layers[0].locked=true;d.mirrorAxisX=.2;
 return d;
}
function legacy(mixed=false):LandmarkProject{
 let project:LandmarkProject=ensureRecordingSnapshots({...createEmptyProject(),drawing:drawing()});
 if(mixed)project={...project,recordingSnapshots:prepareSnapshotBatch(project,{commands:[{op:'createTriangulatedRecording',name:'New recording retained'}]}).recordingSnapshots};
 const view=emptyRecordingSnapshot('old-view','Old angle'),recording=emptySnapshotRecording('old-recording','Old recording retained');recording.snapshotIds=[view.id];recording.activeSnapshotId=view.id;
 project.recordingSnapshots!.snapshots.push(view);project.recordingSnapshots!.recordings.push(recording);project.recordingSnapshots!.activeRecordingId=recording.id;
 return project;
}
function load(project:LandmarkProject,raw?:string){useEditor.setState({past:[],future:[],historyPast:[],historyFuture:[]});useEditor.getState().load(project,raw);useEditor.getState().endEdit();}

test('fresh initialization is source-only and creates only a unified Recording by explicit action',()=>{
 const source={...createEmptyProject(),drawing:drawing()},workspace=ensureRecordingSnapshots(source).recordingSnapshots;
 expect(workspace.recordings).toEqual([]);expect(workspace.snapshots.every(snapshot=>!!snapshot.source)).toBe(true);expect(workspace.legacyArchive).toBeUndefined();
 load(source);const empty=useEditor.getState().project,html=renderToStaticMarkup(createElement(App));expect(html).not.toContain('legacy-recording-review');
 const plan=prepareSnapshotBatch(empty,{commands:[{op:'createTriangulatedRecording'}]});expect(plan.recordingSnapshots.recordings).toHaveLength(1);expect(plan.recordingSnapshots.recordings[0].mode).toBe('triangulated');expect(plan.recordingSnapshots.recordings[0].angleGraph).toBeDefined();
 expect(empty.drawing).toEqual(source.drawing);
});

test('opening old JSON preserves exact export bytes and renders raw source read-only without evaluating it',()=>{
 const source=legacy(),raw='\n  '+JSON.stringify(source,null,2)+'\n',parsed=parseLandmarks(raw),before=JSON.stringify(parsed);
 load(parsed,raw);const opened=useEditor.getState().project,past=useEditor.getState().past.length,html=renderToStaticMarkup(createElement(App));
 expect(opened).toBe(parsed);expect(JSON.stringify(opened)).toBe(before);expect(serializeProject(opened)).toBe(raw);
 expect(html).toContain('legacy-recording-review');expect(html).toContain('legacy-source-preview');expect(html).toContain('Old recording retained');expect(html).toContain('legacy-export-original');expect(html).toContain('legacy-review-reset');expect(html).not.toContain('legacy-confirm-reset');expect(html).not.toContain('snapshot-create-endpoint-pair');expect(html).not.toContain('drawing-room');
 expect(currentDrawingPresentation(opened)).toEqual(opened.drawing);expect(useEditor.getState().past).toHaveLength(past);
 expect(()=>useEditor.getState().setDrawing({...opened.drawing!,mirrorAxisX:4})).toThrow(RECORDING_RETIRED_MESSAGE);expect(serializeProject(useEditor.getState().project)).toBe(raw);
});

test('reviewing mixed records retains everything; the explicit reset removes all relations, preserves attributes and is undoable',()=>{
 const source=legacy(true),raw=JSON.stringify(source,null,1);load(source,raw);const opened=useEditor.getState().project,status=recordingRetirementStatus(opened)!;
 expect(status.recordingCount).toBe(2);expect(status.newRecordingCount).toBe(1);
 const html=renderToStaticMarkup(createElement(App));expect(html).toContain('New recording retained');expect(html).toContain('Old recording retained');expect(html).toContain('新旧录制混合文件');expect(useEditor.getState().project).toBe(opened);
 // Until the explicit store action runs (including dismissal), the reviewed project stays intact.
 expect(serializeProject(opened)).toBe(raw);
 useEditor.getState().clearRecordingRelationships(opened);const clean=useEditor.getState().project;
 expect(recordingRetirementStatus(clean)).toBeUndefined();expect(clean.drawing).toBe(opened.drawing);expect(clean.drawingSnapshots).toBe(opened.drawingSnapshots);expect(clean.drawingWorkingCopies).toBe(opened.drawingWorkingCopies);
 expect(clean.recordingSnapshots!.recordings).toEqual([]);expect(clean.recordingSnapshots!.snapshots.every(snapshot=>!!snapshot.source)).toBe(true);expect(clean.recordingSnapshots!.legacyArchive).toBeUndefined();expect(clean.recordingScenes).toBeUndefined();expect(clean.vectorRecording).toBeUndefined();
 const exported=JSON.parse(serializeProject(clean));expect(exported.drawing).toEqual(opened.drawing);expect(exported.recordingSnapshots.recordings).toEqual([]);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(opened);expect(serializeProject(useEditor.getState().project)).toBe(raw);
 useEditor.getState().redo();expect(useEditor.getState().project).toBe(clean);
});

test('stale reset review cannot clear a subsequently opened file',()=>{
 load(legacy());const reviewed=useEditor.getState().project;load(legacy(true));const newer=useEditor.getState().project;
 expect(()=>useEditor.getState().clearRecordingRelationships(reviewed)).toThrow('工程已变更');expect(useEditor.getState().project).toBe(newer);
});

test('explicit reset retains inactive working copies and ordinary source attributes',()=>{
 let state=saveDrawingSnapshot({drawing:drawing('Front')},'Front');state=saveDrawingSnapshot({...state,drawing:drawing('Side')},'Side');
 const inactive=state.drawingSnapshots!.items.find(item=>item.id!==state.drawingSnapshots!.activeId)!,copy={...drawing('Front'),mirrorAxisX:17};
 const project={...legacy(),...state,drawingWorkingCopies:{[inactive.id]:copy}},clean=clearRecordingRelationships(project);
 expect(clean.drawing).toBe(project.drawing);expect(clean.drawingSnapshots).toBe(project.drawingSnapshots);expect(clean.drawingWorkingCopies).toBe(project.drawingWorkingCopies);
 const snapshot=drawingSnapshotForArtwork(clean.recordingSnapshots,inactive.id)!;expect(snapshot.source).toBeDefined();expect(clean.recordingSnapshots.library.curves[canonicalElementId(inactive.id,copy.curves[0].id)]).toMatchObject({width:.027,depthOffset:3,inkVisible:false});
});

test('fresh 0 and 90 source paste, then source add/split/delete stay editable without endpoint-pair identity constraints',()=>{
 const frontDrawing=drawing('Front');frontDrawing.layers=frontDrawing.layers.map(layer=>({...layer,locked:false}));let state=saveDrawingSnapshot({drawing:frontDrawing},'Front');
 const front=state.drawingSnapshots!.activeId!;state=saveDrawingSnapshot({...state,drawing:drawing('Side')},'Side');const side=state.drawingSnapshots!.activeId!;
 let project:LandmarkProject=clearRecordingRelationships({...legacy(),...state});
 const run=(commands:SnapshotCommand[])=>{project={...project,recordingSnapshots:prepareSnapshotBatch(project,{commands}).recordingSnapshots};};
 run([{op:'createTriangulatedRecording',name:'Fresh'}]);let workspace=project.recordingSnapshots!,recordingId=workspace.activeRecordingId!;
 run([{op:'pasteLayers',sourceSnapshotId:drawingSnapshotForArtwork(workspace,front)!.id},{op:'updateSnapshot'},{op:'setAngle',angle:{x:90,y:0}},{op:'createSnapshot',name:'Side 90'}]);
 workspace=project.recordingSnapshots!;run([{op:'pasteLayers',sourceSnapshotId:drawingSnapshotForArtwork(workspace,side)!.id},{op:'updateSnapshot'}]);
 expect(evaluateRecordingSnapshot(project.recordingSnapshots!,recordingId,{angle:{x:0,y:0}}).drawing.curves.length).toBeGreaterThan(0);expect(evaluateRecordingSnapshot(project.recordingSnapshots!,recordingId,{angle:{x:90,y:0}}).drawing.curves.length).toBeGreaterThan(0);
 const original=project.drawing!,unlocked={...original,layers:original.layers.map(layer=>({...layer,locked:false}))};project=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:unlocked}).project;
 const added=createCurve(project.drawing!,project.drawing!.layers[0].id,[[0,0],[.2,.1],[.4,.1],[.6,0]],.02,'Fresh reference','fresh-reference');project=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:added}).project;
 const intent=createCurveSplitIntent(project.drawing!,'fresh-reference',.4);project=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(project.drawing!,intent).document,intent}).project;
 expect(project.drawing!.curves.map(curve=>curve.id)).toEqual(expect.arrayContaining([...intent.childCurveIds]));
 project=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:deleteCurves(project.drawing!,[...intent.childCurveIds])}).project;
 expect(project.drawing!.curves.some(curve=>intent.childCurveIds.includes(curve.id))).toBe(false);expect(project.recordingSnapshots!.recordings.every(recording=>recording.mode==='triangulated')).toBe(true);expect(()=>evaluateRecordingSnapshot(project.recordingSnapshots!,recordingId,{angle:{x:90,y:0}})).not.toThrow();
});
