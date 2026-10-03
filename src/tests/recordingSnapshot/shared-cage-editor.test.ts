import {afterEach,expect,test,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2,type Cubic} from '../../domain/drawing/model';
import {createCurve} from '../../domain/drawing/commands';
import {deformDrawing,drawingDeformProjection} from '../../domain/drawing/deform';
import {createLayerCageIntent} from '../../domain/drawing/layerDomainIntent';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../../domain/recordingSnapshot/referenceClipboard';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareDrawingLayerReferencePaste} from '../../ui/drawing/layerReferenceClipboard';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../../ui/drawing/snapshotPresentation';
import {resolveDrawingCage,beginDrawingCageGesture,updateDrawingCageGesture,drawingCageSelectionIssue} from '../../ui/drawing/cageEditorController';
import {snapshotCurveEditCommand} from '../../ui/vectorRecording/snapshotCurveEditCommand';
import DrawingRoom from '../../ui/drawing/DrawingRoom';
import SceneWarpCanvas from '../../ui/vectorRecording/SceneWarpCanvas';
import LayerDomainControls from '../../ui/drawing/LayerDomainControls';
import {useDrawing} from '../../ui/drawing/session';
import {resolveRecordingLayerDomainTarget} from '../../app/recordingLayerDomainEdit';
vi.mock('../../app/store',async original=>{const module=await original<typeof import('../../app/store')>();return {...module,useEditor:Object.assign((selector?:(state:ReturnType<typeof module.useEditor.getState>)=>unknown)=>selector?selector(module.useEditor.getState()):module.useEditor.getState(),module.useEditor)};});
vi.mock('../../ui/drawing/session',async original=>{const module=await original<typeof import('../../ui/drawing/session')>();return {...module,useDrawing:Object.assign((selector?:(state:ReturnType<typeof module.useDrawing.getState>)=>unknown)=>selector?selector(module.useDrawing.getState()):module.useDrawing.getState(),module.useDrawing)};});
const editor=useEditor.getState(),session=useDrawing.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useDrawing.setState(session,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const bid=(id:string)=>canonicalElementId('B',id),near=(a:Point2,b:Point2)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],8));
function fixture(){
 const original:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,1]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,.4],[.7,.8]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 let project=ensureRecordingSnapshots({...createEmptyProject(),drawing:original,drawingSnapshots:{version:1,activeId:'A',images:[],items:[{id:'A',name:'A',drawing:original},{id:'B',name:'B',drawing:original}]}});
 const b=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!,clip=captureSnapshotLayerClipboard('test','reference',[{snapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)}]);project=prepareDrawingLayerReferencePaste(project,clip,'test').project as typeof project;
 const view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');view.layers=[{kind:'reference',id:bid('layer'),name:'Layer',baseSnapshotId:b.id,baseLayerId:bid('layer')}];side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));project={...project,recordingSnapshots:{...project.recordingSnapshots,snapshots:[...project.recordingSnapshots.snapshots,view,side],recordings:[recording],activeRecordingId:recording.id}};
 return {project,original,selection:{ids:[bid('curve')],layer:bid('layer')},recordingId:recording.id,snapshotId:view.id,angle:{x:0,y:0}};
}
const recordPlan=(f:ReturnType<typeof fixture>,project=f.project,intent:Parameters<typeof createLayerCageIntent>[1]|ReturnType<typeof createLayerCageIntent>)=>prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'recording-layer-domain',recordingId:f.recordingId,snapshotId:f.snapshotId,angle:f.angle,intent:'domain' in intent?intent:createLayerCageIntent([bid('layer')],intent)});

test('one actual Drawing controller drives both owner adapters with fixed rest and stable operation ID',()=>{
 const f=fixture(),drawing=currentDrawingPresentation(f.project),cage=resolveDrawingCage(drawing,f.selection)!,gesture=beginDrawingCageGesture(cage,f.selection,{edge:1,handle:2},[1,.5],'shared-cage'),first=updateDrawingCageGesture(gesture,[1.2,.5]),second=updateDrawingCageGesture(gesture,[1.3,.5]);
 expect(first.intent!.operationId).toBe(second.intent!.operationId);expect(first.intent!.replace).toBeUndefined();expect(gesture.cage.bend).not.toEqual(second.cage.bend);expect(drawingCageSelectionIssue(drawing,{ids:f.selection.ids})).toMatch(/complete layers/);
 const sourceJson=JSON.stringify(f.project.recordingSnapshots!.library),drawPlan=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'layer-domain',intent:second.intent!}),recorded=recordPlan(f,f.project,second.intent!);
 const draw=drawingSnapshotPresentation(drawPlan.project.recordingSnapshots!,'A')!,record=evaluateRecordingSnapshot(recorded.project.recordingSnapshots!,f.recordingId);
 shapeOf(draw.drawing,bid('curve')).forEach((p,i)=>near(p,shapeOf(record.drawing,bid('curve'))[i]));expect(JSON.stringify(recorded.project.recordingSnapshots!.library)).toBe(sourceJson);expect(recorded.project.drawing).toBe(f.project.drawing);expect(f.project.recordingSnapshots!.snapshots.find(view=>view.id==='view')!.draft).toBeUndefined();expect(recorded.project.recordingSnapshots!.snapshots).toHaveLength(f.project.recordingSnapshots!.snapshots.length);expect(recorded.project.recordingSnapshots!.recordings[0].tracks).toEqual(f.project.recordingSnapshots!.recordings[0].tracks);
 const reopened=resolveDrawingCage(record.drawing,f.selection,{domains:record.state.layerDomains})!,next=updateDrawingCageGesture(beginDrawingCageGesture(reopened,f.selection,{corner:2},reopened.quad[2],'ignored'),[reopened.quad[2][0]+.15,reopened.quad[2][1]]);
 expect(next.intent!.operationId).toBe('shared-cage');expect(next.intent!.replace).toBe(true);expect(next.cage.rect).toEqual(cage.rect);
 const revised=recordPlan(f,recorded.project as typeof f.project,next.intent!);expect(evaluateRecordingSnapshot(revised.project.recordingSnapshots!,f.recordingId).state.layerDomains).toHaveLength(1);
 // The original Drawing adapter still deforms source geometry through its native kernel.
 const sourceSelection={ids:['curve'],layer:'layer'},sourceCage=resolveDrawingCage(f.original,sourceSelection)!,sourceUpdate=updateDrawingCageGesture(beginDrawingCageGesture(sourceCage,sourceSelection,{corner:2},sourceCage.quad[2]),[1.2,1.1]),sourcePlan=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'layer-domain',intent:sourceUpdate.intent!});
 expect(sourcePlan.project.drawing!.curves).toEqual(deformDrawing(f.original,['curve'],sourceCage.rect,sourceUpdate.cage.quad,false,sourceUpdate.cage.bend).document.curves);
});

test('Recorder cage gesture, A, Save, source growth, reopen, reset and Undo retain the live domain',()=>{
 vi.useFakeTimers();const f=fixture(),base=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recordingId),cage=resolveDrawingCage(base.drawing,f.selection)!,change=updateDrawingCageGesture(beginDrawingCageGesture(cage,f.selection,{edge:1,handle:0},[1,.3],'domain'),[1.25,.3]);
 useWorkspaceMode.getState().setMode('recording');useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(recordPlan(f,f.project,change.intent!));vi.runAllTimers();expect(useEditor.getState().past).toEqual([f.project]);
 const first=useEditor.getState().project,evaluation=evaluateRecordingSnapshot(first.recordingSnapshots!,f.recordingId),p=shapeOf(evaluation.drawing,bid('curve'))[1],wanted:Point2=[p[0]+.08,p[1]-.02],edit=prepareSnapshotBatch(first,{recordingId:f.recordingId,commands:[snapshotCurveEditCommand(evaluation,{kind:'handle',curveId:bid('curve'),end:0,position:wanted})]});useEditor.getState().commitRecordingSnapshots(edit.recordingSnapshots);
 const saved=prepareSnapshotBatch(useEditor.getState().project,{recordingId:f.recordingId,commands:[{op:'saveSelected',layerIds:[bid('layer')],warpIds:[]}]});useEditor.getState().commitRecordingSnapshots(saved.recordingSnapshots);vi.runAllTimers();const afterSave=useEditor.getState().project;
 const reload=parseRecordingSnapshots(JSON.parse(JSON.stringify(afterSave.recordingSnapshots))),after=evaluateRecordingSnapshot(reload,f.recordingId);near(shapeOf(after.drawing,bid('curve'))[1],wanted);expect(reload.snapshots.find(view=>view.id==='view')!.draft).toBeUndefined();expect(after.state.layerDomains![0].postShape!.handles[bid('curve')]).toBeDefined();
 const newShape:Cubic=[[0,.2],[.3,.25],[.7,.35],[1,.4]],grown=syncRecordingSnapshotSources({...afterSave,drawingWorkingCopies:{B:createCurve(f.original,'layer',newShape,.01,'New','new')}}),live=evaluateRecordingSnapshot(grown.recordingSnapshots!,f.recordingId),domain=live.state.layerDomains![0];
 expect(domain.kind).toBe('h-coons');if(domain.kind!=='h-coons')throw Error('missing cage');expect(domain.restRect).toEqual(cage.rect);expect(Object.keys(domain.postShape!.handles)).toEqual([bid('curve')]);const mapped=drawingDeformProjection(domain.restRect,domain.quad,domain.bend);near(shapeOf(live.drawing,bid('new'))[0],mapped.map(newShape[0]));
 const reset=createLayerCageIntent(domain.layerIds,{kind:'h-coons',restRect:domain.restRect,quad:domain.quad,bend:domain.bend,enabled:false},{operationId:domain.id,replace:true}),resetPlan=recordPlan(f,afterSave as typeof f.project,reset);useEditor.getState().commitPreparedSnapshotEdit(resetPlan);vi.runAllTimers();near(shapeOf(evaluateRecordingSnapshot(useEditor.getState().project.recordingSnapshots!,f.recordingId).drawing,bid('curve'))[1],f.original.curves[0].handles[0]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(afterSave);near(shapeOf(evaluateRecordingSnapshot(useEditor.getState().project.recordingSnapshots!,f.recordingId).drawing,bid('curve'))[1],wanted);
});

test('real target resolver rejects correction, stale angle, wrong scope and locks without creating keys or sources',()=>{
 const f=fixture(),before=JSON.stringify(f.project),drawing=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recordingId).drawing,cage=resolveDrawingCage(drawing,f.selection)!,intent=updateDrawingCageGesture(beginDrawingCageGesture(cage,f.selection,{corner:2},[1,1]),[1.1,1.1]).intent!;
 expect(()=>resolveRecordingLayerDomainTarget(f.project.recordingSnapshots,{recordingId:f.recordingId,snapshotId:f.snapshotId,angle:{x:45,y:0}})).toThrow(/Intermediate angles/);
 expect(()=>recordPlan(f,f.project,{...intent,scope:{kind:'layers',layerIds:['wrong-layer']}})).toThrow(/no longer exists/);
 const locked=structuredClone(f.project);locked.recordingSnapshots.library.curves[bid('curve')].locked=true;expect(()=>recordPlan(f,locked,intent)).toThrow(/Unlock/);expect(JSON.stringify(f.project)).toBe(before);
 expect(drawingCageSelectionIssue(drawing,{...f.selection,handle:{curveId:bid('curve'),end:0}})).toMatch(/complete layers/);
});

test('Drawing and Recording render the same cage overlay, controls and parameter resets',()=>{
 const f=fixture();useEditor.setState({project:f.project});useDrawing.setState({tool:'deform',selection:f.selection});const drawingMarkup=renderToStaticMarkup(createElement(DrawingRoom)),evaluation=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recordingId),noop=()=>{},cageEdit={drawing:evaluation.drawing,domains:[],targetKey:'basis',historyKey:f.project.recordingSnapshots,editable:true,maxError:0,onPreview:()=>true,onCommit:noop,onError:noop};
 const recordingMarkup=renderToStaticMarkup(createElement(SceneWarpCanvas,{source:evaluation.source,drawing:evaluation.drawing,targetKey:'basis',label:'Basis',onPreview:noop,onCommit:noop,zh:false,selection:f.selection,interaction:{tool:'deform',onToolChange:noop},cageEdit,showWarpTools:false}));
 for(const markup of [drawingMarkup,recordingMarkup]){expect(markup.match(/data-testid="drawing-deform-corner"/g)).toHaveLength(4);expect(markup.match(/data-testid="drawing-deform-bend-handle"/g)).toHaveLength(8);expect(markup.match(/data-testid="drawing-deform-bend-midpoint"/g)).toHaveLength(4);expect(markup).toContain('drawing-deform-error');}
 expect(recordingMarkup).toContain('vr-tool-deform');const disabled=renderToStaticMarkup(createElement(SceneWarpCanvas,{source:evaluation.source,drawing:evaluation.drawing,targetKey:'basis',label:'Basis',onPreview:noop,onCommit:noop,zh:false,cageEdit:{...cageEdit,editable:false,disabledReason:'Select a saved viewpoint'},showWarpTools:false}));expect(disabled).toMatch(/data-testid="vr-tool-deform"[^>]*disabled=""/);expect(disabled).toContain('recording-cage-disabled-reason');
 const controls=renderToStaticMarkup(createElement(LayerDomainControls,{domains:[{kind:'h-coons',id:'cage',layerIds:[bid('layer')],restRect:{min:[0,0],max:[1,1]},quad:[[0,0],[1,0],[1,1],[0,1]]}],layerName:()=> 'Layer',onEnabled:noop}));expect(controls).toContain('drawing-layer-domain-reset');
 for(const file of ['drawing/DrawingRoom.tsx','vectorRecording/SceneWarpCanvas.tsx']){const source=readFileSync(new URL(`../../ui/${file}`,import.meta.url),'utf8');expect(source).toContain('updateDrawingCageGesture');expect(source).toContain('<DeformCageOverlay');expect(source).toContain('<CageEditorControls');expect(source).not.toContain('moveDeformBoundary(');}
});
