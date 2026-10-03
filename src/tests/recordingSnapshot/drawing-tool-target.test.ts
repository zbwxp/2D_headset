import {afterEach,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {moveNode,moveHandle} from '../../domain/drawing/commands';
import {setMirrorEditingEnabled,changeMirrorCurvePair,removeMirrorCurvePair} from '../../domain/drawing/mirrorCommands';
import {emptyDrawing,type Point2,type DrawingDocument} from '../../domain/drawing/model';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {prepareIndependentSnapshotLayers} from '../../domain/recordingSnapshot/independentCopy';
import {pruneSnapshotMirrorMetadata,splitSnapshotMirrorMetadata} from '../../domain/recordingSnapshot/mirrorMetadata';
import {createCurveSplitIntent} from '../../domain/drawing/layerEditIntent';

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
function fixture(angle={x:0,y:0},linked=false){
 const w=emptyRecordingSnapshotWorkspace();
 w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]},c:{id:'c',position:linked?[1,1]:[3,2]},d:{id:'d',position:[4,3]}};
 w.library.curves={first:{id:'first',name:'First',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false},second:{id:'second',name:'Second',nodes:['c','d'],handles:[linked?[1.6,1.8]:[3.6,2.8],[3.7,2.6]],width:.01,visible:true,locked:false}};
 const views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),emptyRecordingSnapshot('up','Up','view',{x:0,y:90})];
 for(const [index,view] of views.entries()){
  view.layers=[{kind:'original',id:'left',name:'Left',visible:true,locked:false,items:['first']},{kind:'original',id:'right',name:'Right',visible:true,locked:false,items:['second']}];
  if(linked)view.relations.endpointLinks={add:[{id:'link',a:{curveId:'first',end:1},b:{curveId:'second',end:0},joinBrush:{kind:'SMOOTH'}}]};
  const k=index===1?1:index===2?-.6:0;
  view.deformation.layers={left:{shape:{nodes:{a:[2*k,3*k],b:[3*k,4*k]},handles:{first:[[.3*k,.4*k],[-.3*k,-.4*k]]}}},right:{shape:{nodes:{c:linked?[3*k,4*k]:[4*k,5*k],d:[5*k,6*k]},handles:{second:[[.6*k,.8*k],[-.4*k,-.3*k]]}}}};
 }
 const r=emptySnapshotRecording('surface');r.mode='triangulated';r.snapshotIds=views.map(view=>view.id);r.activeSnapshotId='front';r.angle=angle;r.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));r.tracks=[{id:'retained',channel:'shape',targetId:'left',keys:[{id:'key',angle:{x:0,y:0},value:{nodes:{},handles:{}}}]}];w.recordings=[r];w.snapshots=views;w.activeRecordingId=r.id;
 return {...createEmptyProject(),recordingSnapshots:w};
}
const controls=(drawing:DrawingDocument)=>[drawing.nodes,drawing.curves.map(curve=>({id:curve.id,nodes:curve.nodes,handles:curve.handles}))];
const near=(actual:DrawingDocument,wanted:DrawingDocument)=>{for(const node of wanted.nodes)for(const axis of [0,1] as const)expect(actual.nodes.find(value=>value.id===node.id)!.position[axis]).toBeCloseTo(node.position[axis],7);for(const curve of wanted.curves)for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(actual.curves.find(value=>value.id===curve.id)!.handles[end][axis]).toBeCloseTo(curve.handles[end][axis],7);};
for(const angle of [{x:0,y:0},{x:30,y:30}])it(`one arbitrary final Drawing target is atomic at ${angle.x},${angle.y}, preserving keys and source`,()=>{
 const project=fixture(angle,true),before=evaluateRecordingSnapshot(project.recordingSnapshots,'surface',{useDraft:true}),wanted=moveHandle(moveNode(before.drawing,'b',[2.5,3.5],true),{curveId:'first',end:1},[1.8,2.6],true);
 const saved=JSON.stringify(project),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'}});
 expect(JSON.stringify(project)).toBe(saved);near(evaluateRecordingSnapshot(plan.project.recordingSnapshots!,'surface',{useDraft:true}).drawing,wanted);expect(plan.project.recordingSnapshots!.library).toEqual(project.recordingSnapshots.library);expect(plan.project.recordingSnapshots!.recordings[0].tracks).toEqual(project.recordingSnapshots.recordings[0].tracks);
 if(angle.x)expect(plan.project.recordingSnapshots!.snapshots).toEqual(project.recordingSnapshots.snapshots);else expect(plan.project.recordingSnapshots!.snapshots.filter(value=>value.id!=='front')).toEqual(project.recordingSnapshots.snapshots.filter(value=>value.id!=='front'));
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(plan.project.recordingSnapshots)));near(evaluateRecordingSnapshot(loaded,'surface',{useDraft:true}).drawing,wanted);
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('recording');useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);const after=useEditor.getState().project;useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});
it('stale geometry, changed cursor and changed appearance fail before any write',()=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots,'surface',{useDraft:true}),edit={recordingId:'surface',snapshotId:before.snapshotId,angle:{x:0,y:0},beforeDrawing:before.drawing,drawing:moveNode(before.drawing,'a',[.3,.4]),intent:{kind:'geometry' as const}};
 const moved=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),edit).project;
 expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(moved,false),edit)).toThrow(/changed during/);
 expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{...edit,angle:{x:1e-9,y:0}})).toThrow(/cursor changed/);
 const changed={...edit.drawing,curves:edit.drawing.curves.map(curve=>({...curve,width:.04}))};expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{...edit,drawing:changed})).toThrow(/preserve topology/);
 expect(project.recordingSnapshots.snapshots[0].draft).toBeUndefined();
});
function mirrorFixture(){
 const drawing:DrawingDocument={...emptyDrawing(),mirrorAxisX:0,mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'first',b:'second',reverse:false}]},layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['first','second']}],nodes:[{id:'a',position:[-1,0]},{id:'b',position:[-2,1]},{id:'c',position:[1.2,.2]},{id:'d',position:[2.2,1.2]}],curves:[{id:'first',name:'First',nodes:['a','b'],handles:[[-1.2,.3],[-1.7,.8]],width:.01,visible:true,locked:false},{id:'second',name:'Second',nodes:['c','d'],handles:[[1.4,.5],[1.9,1]],width:.01,visible:true,locked:false}]};
 let w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing,'Source');const source=w.snapshots[0],view=emptyRecordingSnapshot('view');view.layers=[{kind:'reference',id:'slot',name:'Slot',baseSnapshotId:source.id,baseLayerId:source.layers[0].id}];const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['view'];r.activeSnapshotId='view';r.angleGraph=createSnapshotAngleGraph([{snapshotId:'view',angle:view.angle}]);w={...w,snapshots:[...w.snapshots,view],recordings:[r],activeRecordingId:r.id};return {project:{...createEmptyProject(),drawing,recordingSnapshots:w},drawing,source};
}
const mirrorEdit=(project:ReturnType<typeof mirrorFixture>['project'],change:(drawing:DrawingDocument)=>DrawingDocument)=>{const before=resolveSnapshot(project.recordingSnapshots,'view',{useDraft:true}).drawing;return prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing:before,drawing:change(before),intent:{kind:'mirror-metadata'}}).project as typeof project;};
it('mirror enabled/axis override is geometry-free, sparse, JSON durable and leaves inherited pairs live',()=>{
 const f=mirrorFixture(),before=resolveSnapshot(f.project.recordingSnapshots,'view').drawing,project=mirrorEdit(f.project,drawing=>({...setMirrorEditingEnabled(drawing,false),mirrorAxisX:2})),view=project.recordingSnapshots.snapshots.find(value=>value.id==='view')!;
 expect(view.relations.mirrorEditing).toEqual({enabled:false,axisX:2});expect(controls(resolveSnapshot(project.recordingSnapshots,'view').drawing)).toEqual(controls(before));expect(project.recordingSnapshots.recordings).toEqual(f.project.recordingSnapshots.recordings);expect(project.recordingSnapshots.library).toEqual(f.project.recordingSnapshots.library);expect(project.drawing).toBe(f.project.drawing);
 const nextSource={...f.drawing,mirrorEditing:{enabled:true,curvePairs:[{...f.drawing.mirrorEditing!.curvePairs[0],reverse:true}]}},changed=upsertDrawingSource(project.recordingSnapshots,'source',nextSource,'Source'),loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(changed))),effective=resolveSnapshot(loaded,'view').drawing;
 expect(effective.mirrorAxisX).toBe(2);expect(effective.mirrorEditing).toMatchObject({enabled:false,curvePairs:[{reverse:true}]});expect(loaded.snapshots.find(value=>value.id==='view')!.relations.mirrorEditing!.curvePairs).toBeUndefined();
});
it('local mirror pair updates/disable preserve stable IDs and source definitions, and copies remap IDs',()=>{
 const f=mirrorFixture(),pair=canonicalElementId('source','pair'),changed=mirrorEdit(f.project,drawing=>changeMirrorCurvePair(drawing,pair,{reverse:true})),view=changed.recordingSnapshots.snapshots.find(value=>value.id==='view')!;
 expect(view.relations.mirrorEditing?.curvePairs?.update).toEqual([{id:pair,a:canonicalElementId('source','first'),b:canonicalElementId('source','second'),reverse:true}]);expect(changed.recordingSnapshots.snapshots.find(value=>value.id===f.source.id)).toEqual(f.source);
 let serial=0;const copy=prepareIndependentSnapshotLayers(changed.recordingSnapshots,view,['slot'],()=>`new-${++serial}`),copied=resolveSnapshot({...changed.recordingSnapshots,library:copy.library,snapshots:[...changed.recordingSnapshots.snapshots,copy.snapshot]},copy.snapshot.id).drawing;
 expect(copied.mirrorEditing?.curvePairs).toEqual([{id:copy.idMap[pair],a:copy.idMap[canonicalElementId('source','first')],b:copy.idMap[canonicalElementId('source','second')],reverse:true}]);
 const disabled=mirrorEdit(changed,drawing=>removeMirrorCurvePair(drawing,pair));expect(disabled.recordingSnapshots.snapshots.find(value=>value.id==='view')!.relations.mirrorEditing!.curvePairs).toEqual({disable:[pair]});expect(resolveSnapshot(disabled.recordingSnapshots,'view').drawing.mirrorEditing?.curvePairs).toEqual([]);
});
it('mirror pruning and split replacement retain unrelated sparse preferences',()=>{
 const f=mirrorFixture(),before=resolveSnapshot(f.project.recordingSnapshots,'view').drawing,pair=before.mirrorEditing!.curvePairs[0],intent=createCurveSplitIntent(before,pair.a,.5),patch={enabled:false,curvePairs:{update:[pair]}};
 expect(pruneSnapshotMirrorMetadata(patch,new Set([pair.a]))).toEqual({enabled:false,curvePairs:{update:[]}});
 const replacements=[{oldPairId:pair.id,left:{...pair,id:'left',a:intent.childCurveIds[0]},right:{...pair,id:'right',a:intent.childCurveIds[1]}}];expect(splitSnapshotMirrorMetadata(patch,intent,replacements)).toEqual({enabled:false,curvePairs:{update:[replacements[0].left,replacements[0].right]}});
});
it('canonical A command follows inherited enabled mirror metadata through the common target helper',()=>{
 const f=mirrorFixture(),before=resolveSnapshot(f.project.recordingSnapshots,'view').drawing,node=canonicalElementId('source','a'),follower=canonicalElementId('source','c'),target:Point2=[-.6,.4];
 const result=prepareSnapshotBatch(f.project,{commands:[{op:'moveShapeNode',layerId:'slot',nodeId:node,position:target}]}),after=resolveSnapshot(result.recordingSnapshots,'view',{useDraft:true}).drawing;
 expect(after.nodes.find(value=>value.id===node)!.position).toEqual(target);const old=before.nodes.find(value=>value.id===follower)!.position;expect(after.nodes.find(value=>value.id===follower)!.position).toEqual([old[0]-.4,old[1]+.4]);
});
it('a late unavailable correction coordinate rejects the complete target without mutating the existing frame',()=>{
 const project=fixture({x:30,y:30});for(const view of project.recordingSnapshots.snapshots)view.deformation.layers.right.shape!.nodes.d[0]=0;
 const before=evaluateRecordingSnapshot(project.recordingSnapshots,'surface',{useDraft:true}),wanted=moveNode(moveNode(before.drawing,'a',[1,.4],true),'d',[9,4],true),saved=JSON.stringify(project);
 expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle:{x:30,y:30},beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'}})).toThrow(/Node d X/);expect(JSON.stringify(project)).toBe(saved);
});
it('shared-node arbitrary targets write one real residual and correction preferences never become nearby metadata',()=>{
 const project=fixture();project.recordingSnapshots.library.curves.second.nodes[0]='b';delete project.recordingSnapshots.library.nodes.c;
 const before=evaluateRecordingSnapshot(project.recordingSnapshots,'surface',{useDraft:true}),wanted=moveNode(before.drawing,'b',[1.4,2],true),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle:{x:0,y:0},beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'}});near(evaluateRecordingSnapshot(plan.project.recordingSnapshots!,'surface',{useDraft:true}).drawing,wanted);
 const correction=fixture({x:30,y:30}),evaluation=evaluateRecordingSnapshot(correction.recordingSnapshots,'surface',{useDraft:true}),preferences={...evaluation.drawing,mirrorAxisX:10,mirrorEditing:{enabled:false,curvePairs:[]}},target=moveNode(preferences,'a',[1,2],true),next=prepareSnapshotDrawingToolEdit(snapshotEditContext(correction,false),{recordingId:'surface',snapshotId:evaluation.snapshotId,angle:{x:30,y:30},beforeDrawing:preferences,drawing:target,intent:{kind:'geometry'},validation:'preview'});
 expect(next.project.recordingSnapshots!.snapshots).toBe(correction.recordingSnapshots.snapshots);near(evaluateRecordingSnapshot(next.project.recordingSnapshots!,'surface',{useDraft:true}).drawing,target);
 expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(correction,false),{recordingId:'surface',snapshotId:evaluation.snapshotId,angle:{x:30,y:30},beforeDrawing:evaluation.drawing,drawing:preferences,intent:{kind:'mirror-metadata'}})).toThrow(/real snapshot/);
});
