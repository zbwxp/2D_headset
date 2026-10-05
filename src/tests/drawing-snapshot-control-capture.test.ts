import {describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareDrawingCageControlPreviewPlan,prepareDrawingLayerDomainEdit,prepareDrawingSnapshotEdit} from '../app/drawingSnapshotEdit';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../app/drawingSnapshotPresentation';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan} from '../domain/drawing/controlEditPlan';
import {createCurve,moveHandle,transform,widthChange} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {createLayerCageIntent} from '../domain/drawing/layerDomainIntent';
import {drawingShapeWorkStats} from '../domain/drawing/sparseShape';
import {sceneShapeWorkStats} from '../domain/recordingScene/shapes';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {snapshotControlTargetWriteStats} from '../domain/recordingSnapshot/controlTargetWriter';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {useEditor} from '../app/store';

const bid=(id:string)=>canonicalElementId('B',id);
function drawing(count=1):DrawingDocument {
 const result=emptyDrawing();result.layers=[];
 for(let i=0;i<count;i++){
  result.nodes.push({id:`a${i}`,position:[i*2,0]},{id:`b${i}`,position:[i*2+1,1]});
  result.curves.push({id:`c${i}`,name:`Curve ${i}`,nodes:[`a${i}`,`b${i}`],handles:[[i*2+.2,.3],[i*2+.7,.6]],width:.01,visible:true,locked:false});
  result.layers.push({id:`l${i}`,name:`Layer ${i}`,items:[`c${i}`],visible:true,locked:false});
 }
 return result;
}
function fixture(unrelated=0){
 const source=drawing(),reference=drawing(unrelated+1),project=ensureRecordingSnapshots({...createEmptyProject(),drawing:source,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing:source},{id:'B',name:'B',drawing:reference}]}}),workspace=project.recordingSnapshots,owner=drawingSnapshotForArtwork(workspace,'A')!,other=drawingSnapshotForArtwork(workspace,'B')!;
 owner.layers.push(...other.layers.map(layer=>({kind:'reference' as const,id:layer.id,name:layer.name,baseSnapshotId:other.id,baseLayerId:layer.id})));
 for(let i=0;i<=unrelated;i++)owner.deformation.layers[bid(`l${i}`)]={placement:{...identityScenePlacement(),scaleX:1.3,scaleY:.8},shape:{nodes:{[bid(`a${i}`)]:[.02,.03]},handles:{[bid(`c${i}`)]:[[.01,0],[0,.02]]}}};
 expect(workspace.recordings).toEqual([]);
 return {project,workspace,owner,other};
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const difference=<T extends Record<string,number>>(before:T,after:T):T=>Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value-before[key]])) as T;
const controls=(value:DrawingDocument)=>[value.nodes,value.curves.map(curve=>[curve.id,curve.handles])];
function nearControls(actual:DrawingDocument,wanted:DrawingDocument){for(const curve of wanted.curves)expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(value=>expect.closeTo(value,9)));}
function target(before:DrawingDocument,tool:'node'|'handle'|'curves'){
 const controlPlan=prepareDrawingControlEditPlan(before,tool==='node'?{kind:'node',nodeId:bid('a0')}:tool==='handle'?{kind:'handle',endpoint:{curveId:bid('c0'),end:0}}:{kind:'curves',curveIds:[bid('c0')],preserveRelations:true}),point=tool==='node'?before.nodes.find(node=>node.id===bid('a0'))!.position:before.curves.find(curve=>curve.id===bid('c0'))!.handles[0];
 return {controlPlan,wanted:applyDrawingControlEditPlan(controlPlan,tool==='curves'?{kind:'map',map:([x,y])=>[x+.03,y-.02]}:{kind:'point',position:[point[0]+.03,point[1]-.02]})};
}

describe('Drawing snapshot owner control capture',()=>{
 for(const tool of ['node','handle','curves'] as const)it.each([0,100,1000])(`bounds native reference ${tool} capture and replay with %i unrelated curves`,unrelated=>{
  const f=fixture(unrelated),before=currentDrawingPresentation(f.project),{controlPlan,wanted}=target(before,tool),saved=JSON.stringify(f.project),shapeBefore=sceneShapeWorkStats(),numericBefore=drawingShapeWorkStats(),writesBefore=snapshotControlTargetWriteStats();freeze(f.project);
  const clone=vi.spyOn(globalThis,'structuredClone');let plan:ReturnType<typeof prepareDrawingSnapshotEdit>;
  try{plan=prepareDrawingSnapshotEdit(f.project,wanted,{kind:'geometry-authoring',controlPlan});expect(clone.mock.calls.some(([value])=>value===f.owner.deformation)).toBe(false);}finally{clone.mockRestore();}
  expect(difference(shapeBefore,sceneShapeWorkStats())).toMatchObject({fullApplications:0,revisionApplications:1,materialPlans:0,fitShifts:1});
  const numeric=difference(numericBefore,drawingShapeWorkStats());expect(numeric).toMatchObject({fullApplications:0,revisionApplications:1});expect(numeric.nodeControls).toBeLessThanOrEqual(2);expect(numeric.handleControls).toBeLessThanOrEqual(2);
  const writes=difference(writesBefore,snapshotControlTargetWriteStats());expect(writes).toMatchObject({sharedCaptures:1,detachedCaptures:0,layerMaps:1,layerStates:1,shapes:1,relationMaps:0});expect(writes.copiedSlots).toBeLessThanOrEqual(unrelated+10);
  expect(JSON.stringify(f.project)).toBe(saved);expect(plan!.sourceDrawing).toBeUndefined();expect(plan!.project.drawing).toBe(f.project.drawing);expect(plan!.project.recordingSnapshots!.library).toBe(f.workspace.library);expect(drawingSnapshotForArtwork(plan!.project.recordingSnapshots!,'B')).toBe(f.other);
  const local=drawingSnapshotForArtwork(plan!.project.recordingSnapshots!,'A')!;if(unrelated)expect(local.deformation.layers[bid('l1')]).toBe(f.owner.deformation.layers[bid('l1')]);
  const actual=drawingSnapshotPresentation(plan!.project.recordingSnapshots!,'A')!,cold=resolveSnapshot(structuredClone(plan!.project.recordingSnapshots!),f.owner.id,{useDraft:false,diagnostics:'preview'});expect(controls(actual.evaluation.drawing)).toEqual(controls(cold.drawing));nearControls(actual.drawing,wanted);
 });

 it('keeps unproven reference targets on canonical replay through the shared writer',()=>{
  const f=fixture(2),before=currentDrawingPresentation(f.project),{controlPlan,wanted}=target(before,'node'),stats=sceneShapeWorkStats(),writes=snapshotControlTargetWriteStats();
  const plan=prepareDrawingSnapshotEdit(f.project,structuredClone(wanted),{kind:'geometry-authoring',controlPlan});
  expect(difference(stats,sceneShapeWorkStats())).toMatchObject({fullApplications:1,revisionApplications:0});expect(difference(writes,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0});nearControls(currentDrawingPresentation(plan.project),wanted);
 });

 it('keeps retained cage controls on canonical replay and commits the accepted preview without recapture',()=>{
  const f=fixture(),created=prepareDrawingLayerDomainEdit(f.project,createLayerCageIntent([bid('l0')],{kind:'h-coons',restRect:{min:[-.2,-.2],max:[1.5,1.2]},quad:[[-.2,-.2],[1.4,-.1],[1.3,1.2],[-.1,1]]})),before=currentDrawingPresentation(created.project),{controlPlan,wanted}=target(before,'handle'),saved=JSON.stringify(created.project),stats=sceneShapeWorkStats(),writes=snapshotControlTargetWriteStats();
  const plan=prepareDrawingCageControlPreviewPlan(created.project,before,wanted,{kind:'geometry-authoring',controlPlan})!;
  expect(plan).toBeDefined();expect(difference(stats,sceneShapeWorkStats()).revisionApplications).toBe(0);expect(difference(writes,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0});
  expect(JSON.stringify(created.project)).toBe(saved);expect(plan.before).toBe(created.project);expect(plan.project.drawing).toBe(created.project.drawing);nearControls(plan.drawing,wanted);
  const retained=drawingSnapshotForArtwork(plan.project.recordingSnapshots!,'A')!.deformation.layerDomains!;expect(retained).toHaveLength(1);expect(retained[0]).toMatchObject({...drawingSnapshotForArtwork(created.project.recordingSnapshots!,'A')!.deformation.layerDomains![0],postShape:{handles:{[bid('c0')]:expect.any(Array)}}});
  const prior=useEditor.getState(),acceptedWrites=snapshotControlTargetWriteStats(),acceptedStats=sceneShapeWorkStats();
  try{useEditor.setState({project:created.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().project).toBe(plan.project);expect(useEditor.getState().past).toEqual([created.project]);expect(snapshotControlTargetWriteStats()).toEqual(acceptedWrites);expect(sceneShapeWorkStats()).toEqual(acceptedStats);nearControls(currentDrawingPresentation(useEditor.getState().project),plan.drawing);useEditor.getState().undo();expect(useEditor.getState().project).toBe(created.project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(prior,true);}
 });

 it('does not accept a control proof for changed appearance or topology',()=>{
  const f=fixture(),before=currentDrawingPresentation(f.project),{controlPlan,wanted}=target(before,'handle');
  const appearance=widthChange(wanted,[bid('c0')],.05),plan=prepareDrawingSnapshotEdit(f.project,appearance,{kind:'geometry-authoring',controlPlan});
  expect(currentDrawingPresentation(plan.project).curves.find(curve=>curve.id===bid('c0'))!.width).toBe(.05);nearControls(currentDrawingPresentation(plan.project),appearance);expect(plan.project.drawing).toBe(f.project.drawing);
  const invalid={...wanted,curves:wanted.curves.map(curve=>curve.id===bid('c0')?{...curve,nodes:['missing',curve.nodes[1]] as [string,string]}:curve)};
  expect(()=>prepareDrawingSnapshotEdit(f.project,invalid,{kind:'geometry-authoring',controlPlan})).toThrow();
 });

 it('composes source synchronization and shared local capture atomically with one Undo',()=>{
  const f=fixture(1),before=currentDrawingPresentation(f.project),wanted=transform(before,['c0',bid('c0')],([x,y])=>[x+.15,y+.2]),saved=JSON.stringify(f.project),writes=snapshotControlTargetWriteStats(),plan=prepareDrawingSnapshotEdit(f.project,wanted);
  expect(difference(writes,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0});expect(JSON.stringify(f.project)).toBe(saved);nearControls(currentDrawingPresentation(plan.project),wanted);expect(plan.sourceDrawing!.curves.map(curve=>curve.id)).toEqual(['c0']);expect(plan.localWorkspace).toBe(plan.project.recordingSnapshots);
  const prior=useEditor.getState();try{useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([f.project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(prior,true);}
 });

 it('captures a reference residual beside newly synchronized source topology',()=>{
  const f=fixture(),before=currentDrawingPresentation(f.project),added=createCurve(before,'l0',[[0,2],[.3,2],[.7,2],[1,2]],.02,'New','new-source'),wanted=moveHandle(added,{curveId:bid('c0'),end:0},[.4,.7]),plan=prepareDrawingSnapshotEdit(f.project,wanted);
  expect(plan.project.drawing!.curves.map(curve=>curve.id)).toEqual(['c0','new-source']);nearControls(currentDrawingPresentation(plan.project),wanted);expect(drawingSnapshotForArtwork(plan.project.recordingSnapshots!,'B')).toEqual(f.other);
 });
});
