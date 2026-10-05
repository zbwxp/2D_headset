import {describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {snapshotEditContext} from '../../app/snapshotEditTransaction';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {drawingShapeWorkStats} from '../../domain/drawing/sparseShape';
import {sceneShapeWorkStats} from '../../domain/recordingScene/shapes';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {captureSnapshotControlTargets} from '../../domain/recordingSnapshot/controlTargets';
import {snapshotControlTargetWriteStats} from '../../domain/recordingSnapshot/controlTargetWriter';
import {prepareSnapshotDrawingControlTarget} from '../../domain/recordingSnapshot/drawingControlTargetEdit';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {preparedControlChangesBetween} from '../../domain/recordingSnapshot/preparedControlChanges';
import {createWarpGrid} from '../../domain/vectorWarp/model';

function fixture(unrelated=3,angle=90,draft=true){
 const workspace=emptyRecordingSnapshotWorkspace(),views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',{x:90,y:0})];
 for(let i=0;i<=unrelated;i++){
  const a=`a${i}`,b=`b${i}`,c=`c${i}`,l=`l${i}`;
  workspace.library.nodes[a]={id:a,position:[i*2,0]};workspace.library.nodes[b]={id:b,position:[i*2+1,1]};
  workspace.library.curves[c]={id:c,name:c,nodes:[a,b],handles:[[i*2+.2,.3],[i*2+.7,.6]],width:.01,visible:true,locked:false};
  for(const [j,view] of views.entries()){
   view.layers.push({kind:'original',id:l,name:l,visible:true,locked:false,items:[c]});
   view.deformation.layers[l]={shape:{nodes:{[a]:[j*.5,0],[b]:[j*.5,0]},handles:{[c]:[[j*.1,0],[-j*.1,0]]}},visibility:{[c]:true},placement:{translation:[0,0],rotation:0,scale:1}};
  }
 }
 if(draft)for(const view of views)view.draft={angle:{...view.angle},channels:[],deformation:structuredClone(view.deformation)};
 const recording=emptySnapshotRecording('r');recording.mode='triangulated';recording.snapshotIds=['front','side'];recording.activeSnapshotId=angle===90?'side':'front';recording.angle={x:angle,y:0};recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots=views;workspace.recordings=[recording];workspace.activeRecordingId='r';
 return {project:{...createEmptyProject(),recordingSnapshots:workspace},workspace,recording,views};
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const options={useDraft:true,immutableInputs:true,diagnostics:'preview' as const};
const geometry=(drawing:DrawingDocument)=>[drawing.nodes,drawing.curves.map(curve=>[curve.id,curve.handles])];
const difference=<T extends Record<string,number>>(before:T,after:T):T=>Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value-before[key]])) as T;
function target(drawing:DrawingDocument,tool:'A'|'V'|'handle'='A',index=0){
 const nodeId=`a${index}`,curveId=`c${index}`,plan=prepareDrawingControlEditPlan(drawing,tool==='A'?{kind:'node',nodeId}:tool==='V'?{kind:'curves',curveIds:[curveId]}:{kind:'handle',endpoint:{curveId,end:0}}),point=tool==='handle'?drawing.curves.find(curve=>curve.id===curveId)!.handles[0]:drawing.nodes.find(node=>node.id===nodeId)!.position;
 const wanted=applyDrawingControlEditPlan(plan,tool==='V'?{kind:'map',map:([x,y])=>[x,y+.01]}:{kind:'point',position:[point[0],point[1]+.01]});return {plan,wanted};
}
function nearControls(actual:DrawingDocument,wanted:DrawingDocument){
 const near=(a:Point2,b:Point2)=>a.forEach((value,axis)=>expect(value).toBeCloseTo(b[axis],10));
 for(const node of wanted.nodes)near(actual.nodes.find(value=>value.id===node.id)!.position,node.position);
 for(const curve of wanted.curves)for(const end of [0,1] as const)near(actual.curves.find(value=>value.id===curve.id)!.handles[end],curve.handles[end]);
}

describe('immutable shared control capture',()=>{
 it.each(['A','V','handle'] as const)('detaches only written nested controls for %s and preserves unrelated frozen state',tool=>{
  const f=fixture(),own=f.views[1].draft!.deformation,grid=createWarpGrid({min:[-1,-1],max:[2,2]},1,1);
  own.warps=[{id:'unused-warp',name:'Unused',restGrid:grid,grid}];
  own.layerDomains=[{id:'other-domain',kind:'affine',layerIds:['l2'],matrix:[1,0,0,1,.2,.1],postShape:{nodes:{a2:[.01,.02]},handles:{c2:[[.03,0],[0,.04]]}}}];
  const baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing,tool),serialized=JSON.stringify(f.workspace);freeze(f.workspace);freeze(wanted);
  const before=snapshotControlTargetWriteStats(),shared=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan,{immutableInputs:true}),counts=difference(before,snapshotControlTargetWriteStats()),detached=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan);
  expect(shared).toEqual(detached);expect(JSON.stringify(f.workspace)).toBe(serialized);expect(shared).not.toBe(own);expect(shared.layers).not.toBe(own.layers);
  expect(shared.layers.l0).not.toBe(own.layers.l0);expect(shared.layers.l0.shape).not.toBe(own.layers.l0.shape);expect(shared.layers.l0.shape!.nodes).not.toBe(own.layers.l0.shape!.nodes);expect(shared.layers.l0.shape!.handles).not.toBe(own.layers.l0.shape!.handles);
  for(const id of ['l1','l2','l3'])expect(shared.layers[id]).toBe(own.layers[id]);expect(shared.warps).toBe(own.warps);expect(shared.bindings).toBe(own.bindings);expect(shared.layerDomains).toBe(own.layerDomains);expect(shared.relationPositions).toBe(own.relationPositions);
  expect(shared.layers.l0.placement).toBe(own.layers.l0.placement);expect(shared.layers.l0.visibility).toBe(own.layers.l0.visibility);
  if(tool==='handle'){expect(shared.layers.l0.shape!.handles.c0).not.toBe(own.layers.l0.shape!.handles.c0);expect(shared.layers.l0.shape!.handles.c0[0]).not.toBe(own.layers.l0.shape!.handles.c0[0]);expect(shared.layers.l0.shape!.handles.c0[1]).toBe(own.layers.l0.shape!.handles.c0[1]);}
  expect(counts).toMatchObject({sharedCaptures:1,detachedCaptures:0,layerMaps:1,layerStates:1,shapes:1,relationMaps:0});
  expect(detached.layers.l1).not.toBe(own.layers.l1);expect(detached.warps).not.toBe(own.warps);expect(detached.layerDomains).not.toBe(own.layerDomains);
 });
 it('copies only the written output domain and leaves its frozen program unchanged',()=>{
  const f=fixture(),own=f.views[1].draft!.deformation;
  own.layerDomains=[{id:'edited-domain',kind:'affine',layerIds:['l0'],matrix:[1,0,0,1,.2,.1],postShape:{nodes:{},handles:{c0:[[.01,.02],[.03,.04]]}}},{id:'other-domain',kind:'affine',layerIds:['l1'],matrix:[1,0,0,1,0,0]}];
  const baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing,'handle'),serialized=JSON.stringify(f.workspace);freeze(f.workspace);
  const shared=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan,{immutableInputs:true}),detached=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan);
  expect(shared).toEqual(detached);expect(JSON.stringify(f.workspace)).toBe(serialized);expect(shared.layers).toBe(own.layers);expect(shared.layerDomains).not.toBe(own.layerDomains);expect(shared.layerDomains![0]).not.toBe(own.layerDomains[0]);expect(shared.layerDomains![0].postShape!.handles.c0).not.toBe(own.layerDomains[0].postShape!.handles.c0);expect(shared.layerDomains![1]).toBe(own.layerDomains[1]);
  const edit={recordingId:'r',snapshotId:baseline.snapshotId,angle:f.recording.angle,beforeDrawing:baseline.drawing,drawing:wanted,controlPlan:plan},next=prepareSnapshotDrawingControlTarget(f.workspace,edit);
  expect(preparedControlChangesBetween(f.workspace,next,'r')).toBeUndefined();nearControls(evaluateRecordingSnapshot(next,'r',options).drawing,wanted);
 });
 it('detaches linked authority maps, node deletions and adjacent handle pairs',()=>{
  const f=fixture(),own=f.views[1].draft!.deformation,link={id:'link',a:{curveId:'c0',end:0 as const},b:{curveId:'c1',end:0 as const}};
  f.workspace.library.nodes.a1.position=[...f.workspace.library.nodes.a0.position];for(const view of f.views)view.relations.endpointLinks={add:[link]};own.relationPositions={authority:{sourceLinkIds:['link'],offset:[.02,.03]}};
  const baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing),serialized=JSON.stringify(f.workspace);freeze(f.workspace);
  const shared=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan,{immutableInputs:true}),detached=captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan);
  expect(shared).toEqual(detached);expect(JSON.stringify(f.workspace)).toBe(serialized);expect(shared.relationPositions).not.toBe(own.relationPositions);expect(shared.relationPositions.authority).not.toBe(own.relationPositions.authority);expect(shared.relationPositions.authority.sourceLinkIds).not.toBe(own.relationPositions.authority.sourceLinkIds);expect(shared.layers.l2).toBe(own.layers.l2);
  for(const i of [0,1]){expect(shared.layers[`l${i}`].shape!.nodes[`a${i}`]).toBeUndefined();expect(shared.layers[`l${i}`].shape!.handles[`c${i}`]).not.toBe(own.layers[`l${i}`].shape!.handles[`c${i}`]);}
  const next=prepareSnapshotDrawingControlTarget(f.workspace,{recordingId:'r',snapshotId:baseline.snapshotId,angle:f.recording.angle,beforeDrawing:baseline.drawing,drawing:wanted,controlPlan:plan});nearControls(evaluateRecordingSnapshot(next,'r',options).drawing,wanted);
 });
 it('does no copy for a no-op and does not mutate frozen state on a rejected target',()=>{
  const f=fixture(),own=f.views[1].draft!.deformation;own.layers.l0.placement!.scaleX=0;
  const baseline=evaluateRecordingSnapshot(f.workspace,'r',options),counts=snapshotControlTargetWriteStats(),serialized=JSON.stringify(f.workspace);freeze(f.workspace);
  expect(captureSnapshotControlTargets(baseline,baseline.drawing,own,()=> 'fresh',undefined,{immutableInputs:true})).toBe(own);expect(snapshotControlTargetWriteStats()).toEqual(counts);
  const plan=prepareDrawingControlEditPlan(baseline.drawing,{kind:'node',nodeId:'a0'}),wanted=applyDrawingControlEditPlan(plan,{kind:'point',position:[.2,.1]});
  expect(()=>captureSnapshotControlTargets(baseline,wanted,own,()=> 'fresh',plan,{immutableInputs:true})).toThrow(/local placement/);expect(JSON.stringify(f.workspace)).toBe(serialized);
 });
});

describe('real-basis capture lineage before candidate replay',()=>{
 for(const angle of [0,90])for(const draft of [false,true])it(`replays a complete native change at ${angle} with existing draft=${draft}`,()=>{
  const f=fixture(4,angle,draft),baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing),before=sceneShapeWorkStats();freeze(f.workspace);
  const next=prepareSnapshotDrawingControlTarget(f.workspace,{recordingId:'r',snapshotId:baseline.snapshotId,angle:f.recording.angle,beforeDrawing:baseline.drawing,drawing:wanted,controlPlan:plan});
  expect(difference(before,sceneShapeWorkStats())).toMatchObject({fullApplications:0,revisionApplications:1,fitShifts:1});expect(preparedControlChangesBetween(f.workspace,next,'r')!.basisControls.get(baseline.snapshotId)).toEqual(plan.controls);
  const actual=evaluateRecordingSnapshot(next,'r',options),cold=evaluateRecordingSnapshot(structuredClone(next),'r',{useDraft:true,diagnostics:'preview'});expect(geometry(actual.drawing)).toEqual(geometry(cold.drawing));nearControls(actual.drawing,wanted);
 });
 for(const angle of [90,60])for(const tool of ['A','V'] as const)it.each([0,100,1000])(`bounds ${angle===90?'real basis':'basis fallback'} ${tool} replay with %i unrelated layers`,unrelated=>{
  const f=fixture(unrelated,angle,angle===90),baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing,tool),serialized=JSON.stringify(f.workspace),beforeShapes=sceneShapeWorkStats(),beforeNumeric=drawingShapeWorkStats(),beforeWrites=snapshotControlTargetWriteStats();freeze(f.workspace);
  const clone=vi.spyOn(globalThis,'structuredClone');
  let next:typeof f.workspace;
  try{next=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'r',snapshotId:baseline.snapshotId,angle:f.recording.angle,beforeDrawing:baseline.drawing,drawing:wanted,intent:{kind:'geometry',controlPlan:plan},validation:'preview'}).project.recordingSnapshots!;
   if(angle===90)expect(clone.mock.calls.some(([value])=>value===f.views[1].draft!.deformation)).toBe(false);
  }finally{clone.mockRestore();}
  const shapes=difference(beforeShapes,sceneShapeWorkStats()),numeric=difference(beforeNumeric,drawingShapeWorkStats()),writes=difference(beforeWrites,snapshotControlTargetWriteStats());
  expect(shapes).toMatchObject({fullApplications:0,revisionApplications:1,materialPlans:0,fitShifts:1});expect(numeric).toMatchObject({fullApplications:0,revisionApplications:1});expect(numeric.nodeControls).toBeLessThanOrEqual(2);expect(numeric.handleControls).toBeLessThanOrEqual(2);
  if(angle===90){expect(writes).toMatchObject({sharedCaptures:1,detachedCaptures:0,layerMaps:1,layerStates:1,shapes:1,relationMaps:0});expect(writes.copiedSlots).toBeLessThanOrEqual(unrelated+10);if(unrelated)expect(next!.snapshots[1].draft!.deformation.layers.l1).toBe(f.views[1].draft!.deformation.layers.l1);}
  expect(JSON.stringify(f.workspace)).toBe(serialized);const actual=evaluateRecordingSnapshot(next!,'r',options),cold=evaluateRecordingSnapshot(structuredClone(next!),'r',{useDraft:true,diagnostics:'preview'});expect(geometry(actual.drawing)).toEqual(geometry(cold.drawing));nearControls(actual.drawing,wanted);
 });
 it('shares immutable capture on repeated coupled basis drafts without changing the original frame',()=>{
  const f=fixture(8,60,false),original=evaluateRecordingSnapshot(f.workspace,'r',options),seedPlan=prepareDrawingControlEditPlan(original.drawing,{kind:'curves',curveIds:['c1']}),seed=applyDrawingControlEditPlan(seedPlan,{kind:'map',map:([x,y])=>[x,y+.01]});
  let workspace=prepareSnapshotDrawingControlTarget(f.workspace,{recordingId:'r',snapshotId:original.snapshotId,angle:f.recording.angle,beforeDrawing:original.drawing,drawing:seed,controlPlan:seedPlan});
  for(const index of [0,2,3]){
   const before=evaluateRecordingSnapshot(workspace,'r',options),{plan,wanted}=target(before.drawing,'V',index),serialized=JSON.stringify(workspace),stats=snapshotControlTargetWriteStats();freeze(workspace);
   const next=prepareSnapshotDrawingControlTarget(workspace,{recordingId:'r',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:wanted,controlPlan:plan}),prior=workspace.snapshots[1].draft?.deformation,own=next.snapshots[1].draft!.deformation;
   expect(difference(stats,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0,layerMaps:1,layerStates:1,shapes:1});expect(JSON.stringify(workspace)).toBe(serialized);
   if(prior){expect(own.warps).toBe(prior.warps);expect(own.relationPositions).toBe(prior.relationPositions);expect(own.layers.l1).toBe(prior.layers.l1);expect(own.layers[`l${index}`].shape).not.toBe(prior.layers[`l${index}`]?.shape);}
   const actual=evaluateRecordingSnapshot(next,'r',options),cold=evaluateRecordingSnapshot(structuredClone(next),'r',{useDraft:true,diagnostics:'preview'});expect(geometry(actual.drawing)).toEqual(geometry(cold.drawing));nearControls(actual.drawing,wanted);workspace=next;
  }
  expect(geometry(evaluateRecordingSnapshot(f.workspace,'r',options).drawing)).toEqual(geometry(original.drawing));
 });
 it('retains full replay for unproven controls and rejects stale commits',()=>{
  const f=fixture(),baseline=evaluateRecordingSnapshot(f.workspace,'r',options),{plan,wanted}=target(baseline.drawing),before=sceneShapeWorkStats(),edit={recordingId:'r',snapshotId:baseline.snapshotId,angle:f.recording.angle,beforeDrawing:baseline.drawing,drawing:structuredClone(wanted)};
  const next=prepareSnapshotDrawingControlTarget(f.workspace,edit);expect(difference(before,sceneShapeWorkStats())).toMatchObject({fullApplications:1,revisionApplications:0});expect(preparedControlChangesBetween(f.workspace,next,'r')).toBeUndefined();
  expect(()=>prepareSnapshotDrawingControlTarget(next,{...edit,drawing:wanted,controlPlan:plan})).toThrow(/snapshot changed/);nearControls(evaluateRecordingSnapshot(next,'r',options).drawing,wanted);expect(geometry(evaluateRecordingSnapshot(f.workspace,'r',options).drawing)).toEqual(geometry(baseline.drawing));
 });
});
