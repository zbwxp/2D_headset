import {existsSync,readFileSync} from 'node:fs';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {drawingSnapshotPresentation} from '../../app/drawingSnapshotPresentation';
import {afterEach,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {createVectorEditingApi} from '../../app/vectorEditingApi';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareDrawingSnapshotEdit,commitDrawingSnapshotEdit,prepareDrawingSnapshotObjectLocks} from '../../app/drawingSnapshotEdit';
import {currentDrawingPresentation} from '../../app/drawingSnapshotPresentation';
import {emptyDrawing,editable,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {curveChange,layerChange,createCurve,moveNode,moveHandle} from '../../domain/drawing/commands';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../../domain/recordingSnapshot/referenceClipboard';
import {prepareDrawingLayerReferencePaste} from '../../ui/drawing/layerReferenceClipboard';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareIndependentSnapshotLayers} from '../../domain/recordingSnapshot/independentCopy';
import {prepareSnapshotCurveSplit,finishSnapshotCurveSplit,splitSnapshotLocalCurve} from '../../domain/recordingSnapshot/topologyEdits';
import {removeDeletedSourceReferences} from '../../domain/recordingSnapshot/sourceDeletion';
import {penCandidate} from '../../ui/drawing/penController';
import {neutralBend} from '../../domain/deformation/coons';
import {evaluatedMaterialProgram} from '../../domain/drawing/evaluatedDeformation';
const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const bid=(id:string)=>canonicalElementId('B',id);
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'o',position:[0,1]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,.1],[.7,.1]],visible:true,locked:false,width:.01},{id:'loop',name:'Loop',nodes:['o','o'],handles:[[.3,1.4],[-.3,1.4]],visible:true,locked:false,width:.01}],fills:[{id:'fill',name:'Fill',boundary:[{id:'loop',reverse:false}],color:'black',visible:true,locked:false}],offsets:[{id:'offset',name:'Offset',source:[{id:'curve',reverse:false}],distance:.1,start:0,end:1,taper:0,width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve','loop','fill','offset']}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing}]}});
 const b=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!;
 const clip=captureSnapshotLayerClipboard('test','reference',[{snapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)}]);
 return {project:prepareDrawingLayerReferencePaste(project,clip,'test').project,drawing,clip};
}
const lock=(project:ReturnType<typeof fixture>['project'],locked:boolean)=>prepareDrawingSnapshotEdit(project,curveChange(currentDrawingPresentation(project),bid('curve'),{locked})).project;
function install(project:ReturnType<typeof fixture>['project']){vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project,past:[],future:[]});}
it('Drawing curve lock is local, source immutable, JSON durable and one Undo',()=>{
 const {project}=fixture();install(project);commitDrawingSnapshotEdit(useEditor.getState(),curveChange(currentDrawingPresentation(project),bid('curve'),{locked:true}));vi.runAllTimers();
 const after=useEditor.getState().project,snapshot=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!;
 expect(snapshot.objectLocks).toEqual({[bid('curve')]:true});expect(after.drawing).toBe(project.drawing);expect(after.drawingSnapshots).toEqual(project.drawingSnapshots);expect(after.drawingWorkingCopies).toEqual(project.drawingWorkingCopies);expect(after.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
 expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'B')).toEqual(drawingSnapshotForArtwork(project.recordingSnapshots!,'B'));expect(editable(currentDrawingPresentation(after),bid('curve'))).toBe(false);
 const reload={...after,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(after.recordingSnapshots)))};expect(currentDrawingPresentation(reload).curves.find(c=>c.id===bid('curve'))!.locked).toBe(true);
 expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});
it('parent current effective lock inherits, local false overrides, same-ID paste does not reset it',()=>{
 const f=fixture(),parentLocked=syncRecordingSnapshotSources({...f.project,drawingWorkingCopies:{B:curveChange(f.drawing,'curve',{locked:true})}});
 expect(currentDrawingPresentation(parentLocked).curves.find(c=>c.id===bid('curve'))!.locked).toBe(true);
 const unlocked=lock(parentLocked,false),snapshot=drawingSnapshotForArtwork(unlocked.recordingSnapshots!,'A')!;expect(snapshot.objectLocks).toEqual({[bid('curve')]:false});expect(currentDrawingPresentation(unlocked).curves.find(c=>c.id===bid('curve'))!.locked).toBe(false);
 const pasted=prepareDrawingLayerReferencePaste(unlocked,f.clip,'test');expect(pasted.changed).toBe(false);expect(pasted.project).toBe(unlocked);
 const child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:snapshot.id,baseLayerId:bid('layer')}];const workspace={...unlocked.recordingSnapshots!,snapshots:[...unlocked.recordingSnapshots!.snapshots,child]};
 expect(resolveSnapshot(workspace,child.id).drawing.curves[0].locked).toBe(false);
 const relocked=lock({...unlocked,recordingSnapshots:workspace},true);expect(resolveSnapshot(relocked.recordingSnapshots!,child.id).drawing.curves[0].locked).toBe(true);
 const sourceChanged=syncRecordingSnapshotSources({...unlocked,drawingWorkingCopies:{B:moveNode(curveChange(f.drawing,'curve',{locked:false}),'a',[.1,.2])}});expect(currentDrawingPresentation(sourceChanged).curves.find(c=>c.id===bid('curve'))!.locked).toBe(false);expect(currentDrawingPresentation(sourceChanged).nodes.find(n=>n.id===bid('a'))!.position).toEqual([.1,.2]);
});
it('layer lock changes all current objects, keeps neutral layer and permits fresh P',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),after=prepareDrawingSnapshotEdit(f.project,layerChange(view,bid('layer'),{locked:true})).project,d=currentDrawingPresentation(after);
 expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.objectLocks).toEqual(Object.fromEntries(['curve','loop','fill','offset'].map(id=>[bid(id),true])));expect(d.layers.find(l=>l.id===bid('layer'))!.locked).toBe(false);expect(d.curves.find(c=>c.id==='curve')!.locked).toBe(false);
 expect(()=>moveNode(d,bid('a'),[.1,.2])).toThrow(/锁定/);expect(()=>moveHandle(d,{curveId:bid('curve'),end:0},[.2,.4])).toThrow(/锁定/);
 expect(()=>penCandidate(d,{position:[1,0],out:[0,0],last:bid('curve')},[1.5,.2],[1.5,.2],{layerId:bid('layer'),unit:200,width:.01,join:'POSITION',taperScale:6})).toThrow(/锁定/);
 const added=createCurve(d,bid('layer'),[[0,-1],[.3,-1],[.7,-1],[1,-1]],.01,'Fresh','fresh'),saved=prepareDrawingSnapshotEdit(after,added).project;
 expect(currentDrawingPresentation(saved).curves.find(c=>c.id==='fresh')!.locked).toBe(false);expect(saved.recordingSnapshots!.library).toMatchObject(after.recordingSnapshots!.library);
});
it('Drawing JSON API routes source and reference locks through one transaction; locked move fails atomically',()=>{
 const f=fixture();install(f.project);const api=createVectorEditingApi();
 expect(api.execute({commands:[{op:'setObjectState',objectIds:[bid('curve')],locked:true},{op:'moveNode',nodeId:bid('a'),position:[.2,.3]}]})).toMatchObject({ok:false});expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);
 expect(api.execute({commands:[{op:'setObjectState',objectIds:['curve',bid('curve')],locked:true},{op:'setLayer',layerId:bid('layer'),locked:false}]})).toMatchObject({ok:true});vi.runAllTimers();
 const after=useEditor.getState().project;expect(after.drawing!.curves.find(c=>c.id==='curve')!.locked).toBe(true);expect(currentDrawingPresentation(after).curves.find(c=>c.id===bid('curve'))!.locked).toBe(false);expect(after.recordingSnapshots!.library.curves[bid('curve')]).toEqual(f.project.recordingSnapshots!.library.curves[bid('curve')]);expect(useEditor.getState().past).toEqual([f.project]);
});
function recordingFixture(){const f=fixture(),workspace=structuredClone(f.project.recordingSnapshots!),source=drawingSnapshotForArtwork(workspace,'B')!,view=emptyRecordingSnapshot('view'),recording=emptySnapshotRecording('recording');view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:bid('layer')}];recording.snapshotIds=[view.id];recording.activeSnapshotId=view.id;workspace.snapshots.push(view);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;return {...f,source,view,recording,project:{...f.project,recordingSnapshots:workspace}};}
it('Recording JSON lock is discrete metadata, blocks shared Drawing controls, and unlocks without tracks',()=>{
 const f=recordingFixture(),locked=prepareSnapshotBatch(f.project,{commands:[{op:'setObjectLocks',objectIds:[bid('curve'),bid('fill')],locked:true}]}).recordingSnapshots;
 for(const command of [{op:'setLayerPlacement',layerId:'slot',value:{translation:[.1,0],rotation:0,scale:1}},{op:'setShapeElementPlacement',curveIds:[bid('curve')],value:{translation:[.1,0],rotation:0,scale:1}}])expect(()=>prepareSnapshotBatch({...f.project,recordingSnapshots:locked},{commands:[command]})).toThrow(/锁定/);
 expect(locked.recordings).toEqual(f.project.recordingSnapshots.recordings);expect(locked.library).toEqual(f.project.recordingSnapshots.library);expect(locked.snapshots.find(s=>s.id==='view')!.draft).toBeUndefined();
 expect(()=>prepareSnapshotBatch({...f.project,recordingSnapshots:locked},{commands:[{op:'moveShapeNode',layerId:'slot',nodeId:bid('a'),position:[.2,.3]}]})).toThrow(/锁定/);
 const unlocked=prepareSnapshotBatch({...f.project,recordingSnapshots:locked},{commands:[{op:'setObjectLocks',objectIds:[bid('curve')],locked:false},{op:'moveShapeNode',layerId:'slot',nodeId:bid('a'),position:[.2,.3]}]}).recordingSnapshots;expect(resolveSnapshot(unlocked,'view').drawing.curves.find(c=>c.id===bid('curve'))!.locked).toBe(false);
});
it('local false remaps through source and local splits and source deletion prunes it',()=>{
 const f=recordingFixture(),workspace=structuredClone(f.project.recordingSnapshots);workspace.library.curves[bid('curve')].locked=true;workspace.snapshots.find(s=>s.id==='view')!.objectLocks={[bid('curve')]:false};
 const localBasis=structuredClone(workspace);localBasis.snapshots.find(s=>s.id==='view')!.layers[0]={...localBasis.snapshots.find(s=>s.id==='view')!.layers[0],membership:{excludeElementIds:[bid('offset')]}} as typeof f.view.layers[0];const basis=resolveSnapshot(localBasis,'view').drawing;let serial=0;const localIntent=createCurveSplitIntent(basis,bid('curve'),.4,{allocateId:()=>`local-${++serial}`}),local=splitSnapshotLocalCurve(localBasis,'view',localIntent).workspace;
 expect(local.snapshots.find(s=>s.id==='view')!.objectLocks).toEqual(Object.fromEntries(localIntent.childCurveIds.map(id=>[id,false])));expect(resolveSnapshot(local,'view').drawing.curves.filter(c=>localIntent.childCurveIds.includes(c.id)).every(c=>!c.locked)).toBe(true);
 // The source may split while its child has a local lock, with the parent unlocked.
 workspace.library.curves[bid('curve')].locked=false;workspace.snapshots.find(s=>s.id==='view')!.objectLocks={[bid('curve')]:true};const raw=createCurveSplitIntent(f.drawing,'curve',.4,{allocateId:()=>`parent-${++serial}`}),intent=mapCurveSplitIntent(raw,bid),plan=prepareSnapshotCurveSplit(workspace,f.source.id,intent),next=upsertDrawingSource(workspace,'B',applyCurveSplitIntent(f.drawing,raw).document,'B',{splitRetiredIds:new Set([intent.curveId])}),split=finishSnapshotCurveSplit(plan,next);
 expect(split.snapshots.find(s=>s.id==='view')!.objectLocks).toEqual(Object.fromEntries(intent.childCurveIds.map(id=>[id,true])));expect(resolveSnapshot(split,'view').drawing.curves.filter(c=>intent.childCurveIds.includes(c.id)).every(c=>c.locked)).toBe(true);
 const deleted=structuredClone(workspace);delete deleted.library.curves[bid('curve')];const clean=removeDeletedSourceReferences(workspace,deleted,f.source.id,new Set([bid('curve')]));expect(clean.snapshots.find(s=>s.id==='view')!.objectLocks).toBeUndefined();
});
it('independent copy preserves effective locks with fresh IDs and no source dependency',()=>{
 const f=recordingFixture(),workspace=structuredClone(f.project.recordingSnapshots);workspace.library.curves[bid('curve')].locked=true;workspace.snapshots.find(s=>s.id==='view')!.objectLocks={[bid('curve')]:false,[bid('loop')]:true};let serial=0;
 const copy=prepareIndependentSnapshotLayers(workspace,workspace.snapshots.find(s=>s.id==='view')!,['slot'],()=>`copy-${++serial}`),saved=parseRecordingSnapshots({...workspace,library:copy.library,snapshots:[...workspace.snapshots,copy.snapshot]}),drawing=resolveSnapshot(saved,copy.snapshot.id).drawing;
 expect(drawing.curves.find(c=>c.id===copy.idMap[bid('curve')])!.locked).toBe(false);expect(drawing.curves.find(c=>c.id===copy.idMap[bid('loop')])!.locked).toBe(true);expect(copy.snapshot.layers.every(l=>l.kind==='original')).toBe(true);
});
it('locking a child preserves nonlinear material programs and all rendered control positions',()=>{
 const f=recordingFixture(),w=f.project.recordingSnapshots,source=w.snapshots.find(s=>s.id===f.source.id)!,bend=neutralBend();bend.handles[1][0][0]=1.1;source.deformation.layerDomains=[{kind:'h-coons',id:'cage',layerIds:[bid('layer')],restRect:{min:[-1,-1],max:[2,2]},quad:[[-1,-1],[2.2,-1],[2,2.1],[-1,2]],bend}];
 const before=resolveSnapshot(w,'view'),program=evaluatedMaterialProgram(before.drawing,bid('curve')),after=prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'object-locks',snapshotId:'view',changes:{[bid('curve')]:true}}).project.recordingSnapshots!,result=resolveSnapshot(after,'view');expect(program?.length).toBeGreaterThan(0);expect(evaluatedMaterialProgram(result.drawing,bid('curve'))).toEqual(program);for(const curve of before.drawing.curves)expect(shapeOf(result.drawing,curve.id)).toEqual(shapeOf(before.drawing,curve.id));
});
it('invalid lock values and non-object IDs cannot enter a transaction or JSON',()=>{
 const f=recordingFixture();expect(()=>prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'object-locks',snapshotId:'view',changes:{[bid('a')]:true}})).toThrow(/missing snapshot object/);
 const invalid=structuredClone(f.project.recordingSnapshots);invalid.snapshots.find(s=>s.id==='view')!.objectLocks={[bid('curve')]:0 as unknown as boolean};expect(()=>parseRecordingSnapshots(invalid)).toThrow(/object locks/);
});

it('explicit API and layer assignments retain false and already-locked members as local overrides',()=>{
 const f=fixture();install(f.project);const api=createVectorEditingApi();expect(api.execute({commands:[{op:'setObjectState',objectIds:[bid('curve')],locked:false}]})).toMatchObject({ok:true});vi.runAllTimers();const after=useEditor.getState().project;expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.objectLocks).toEqual({[bid('curve')]:false});
 const live=syncRecordingSnapshotSources({...after,drawingWorkingCopies:{B:curveChange(f.drawing,'curve',{locked:true})}});expect(currentDrawingPresentation(live).curves.find(c=>c.id===bid('curve'))!.locked).toBe(false);
 const target=prepareDrawingSnapshotObjectLocks(live,[bid('curve'),bid('loop')],true).project;expect(drawingSnapshotForArtwork(target.recordingSnapshots!,'A')!.objectLocks).toEqual({[bid('curve')]:true,[bid('loop')]:true});
});
it('Recording AI lock has one source-safe Undo and Redo in Recording mode',()=>{
 const f=recordingFixture();install(f.project);useWorkspaceMode.getState().setMode('recording');const api=createVectorEditingApi();expect(api.snapshot({commands:[{op:'setObjectLocks',objectIds:[bid('curve')],locked:true}]})).toMatchObject({ok:true});vi.runAllTimers();const after=useEditor.getState().project;expect(after.drawing).toBe(f.project.drawing);expect(useEditor.getState().past).toEqual([f.project]);expect(api.undo()).toMatchObject({ok:true});expect(useEditor.getState().project).toBe(f.project);expect(api.redo()).toMatchObject({ok:true});expect(useEditor.getState().project).toBe(after);
});

const browserFixture=process.env.SNAPSHOT_LOCK_FIXTURE;
it.skipIf(!browserFixture||!existsSync(browserFixture))('real browser save locks a reference layer without changing any of its five owned sources',()=>{
 const project=parseLandmarks(readFileSync(browserFixture!,'utf8')),view=drawingSnapshotPresentation(project.recordingSnapshots!,project.drawingSnapshots!.activeId!)!,layerId=[...view.layerOwners].find(([,owner])=>owner.kind==='snapshot-local')![0],items=view.drawing.layers.find(layer=>layer.id===layerId)!.items;
 const originals=project.recordingSnapshots!.snapshots.filter(snapshot=>snapshot.source),sources=JSON.stringify(originals.map(snapshot=>[snapshot.id,snapshot.source,snapshot.layers.filter(layer=>layer.kind==='original')]));expect(project.drawingSnapshots!.items).toHaveLength(5);
 const after=prepareDrawingSnapshotObjectLocks(project,items,true).project;expect(after.drawing).toBe(project.drawing);expect(after.drawingSnapshots).toEqual(project.drawingSnapshots);expect(after.drawingWorkingCopies).toEqual(project.drawingWorkingCopies);expect(after.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);expect(JSON.stringify(after.recordingSnapshots!.snapshots.filter(snapshot=>snapshot.source).map(snapshot=>[snapshot.id,snapshot.source,snapshot.layers.filter(layer=>layer.kind==='original')]))).toBe(sources);
 const drawing=currentDrawingPresentation({...after,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(after.recordingSnapshots)))});for(const id of items){const item=[...drawing.curves,...drawing.fills,...drawing.offsets].find(item=>item.id===id)!;expect(item.locked).toBe(true);}for(const curve of view.drawing.curves)expect(shapeOf(drawing,curve.id)).toEqual(shapeOf(view.drawing,curve.id));
});
