import {describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareDrawingSnapshotEdit} from '../app/drawingSnapshotEdit';
import * as drawingEdits from '../app/drawingSnapshotEdit';
import {markFinalizedGeometry} from '../domain/drawing/geometryEdit';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../app/drawingSnapshotPresentation';
import {createVectorEditingApi,type VectorCommand,type VectorResult} from '../app/vectorEditingApi';
import {MirrorBatchIntent} from '../app/vectorMirrorEditingApi';
import {transportDeformedIntervals} from '../domain/drawing/deform';
import {type SnapshotEditPlan} from '../app/snapshotEditTransaction';
import {drawingControlEditProof,drawingControlEditStats} from '../domain/drawing/controlEditPlan';
import {moveHandle,moveNode,transform} from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {drawingShapeWorkStats} from '../domain/drawing/sparseShape';
import {sceneShapeWorkStats} from '../domain/recordingScene/shapes';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {snapshotControlTargetWriteStats} from '../domain/recordingSnapshot/controlTargetWriter';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import * as persistence from '../domain/recordingSnapshot/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';

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
 return {project,workspace,owner,other};
}
function harness(initial:LandmarkProject){
 let project=initial,past:LandmarkProject[]=[],future:LandmarkProject[]=[],accepted:SnapshotEditPlan|undefined;
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'drawing',commitDrawing(drawing){past.push(project);project={...project,drawing};future=[];},commitSnapshotEditPlan(plan){accepted=plan;past.push(project);project=plan.project;future=[];},undo(){const previous=past.pop();if(previous){future.unshift(project);project=previous;}},redo(){const next=future.shift();if(next){past.push(project);project=next;}}});
 return {api,state:()=>({project,past,future,accepted})};
}
const value=<T>(result:VectorResult<T>):T=>{expect(result.ok,result.ok?'':JSON.stringify(result.error)).toBe(true);if(!result.ok)throw Error(result.error.message);return result.value;};
const difference=<T extends Record<string,number>>(before:T,after:T):T=>Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value-before[key]])) as T;
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function nearControls(actual:DrawingDocument,wanted:DrawingDocument){expect(actual.nodes.map(node=>node.id)).toEqual(wanted.nodes.map(node=>node.id));expect(actual.curves.map(curve=>[curve.id,curve.nodes])).toEqual(wanted.curves.map(curve=>[curve.id,curve.nodes]));for(const curve of wanted.curves)expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(value=>expect.closeTo(value,9)));}
function target(before:DrawingDocument,tool:'moveNode'|'moveHandle'|'transformCurves'){
 const curveId=bid('c0'),nodeId=bid('a0'),p=tool==='moveNode'?before.nodes.find(node=>node.id===nodeId)!.position:before.curves.find(curve=>curve.id===curveId)!.handles[0],position:Point2=[p[0]+.03,p[1]-.02];
 const command:VectorCommand=tool==='moveNode'?{op:tool,nodeId,position}:tool==='moveHandle'?{op:tool,curveId,end:0,position}:{op:tool,curveIds:[curveId],matrix:[1,0,0,1,.03,-.02]};
 const wanted=tool==='moveNode'?moveNode(before,nodeId,position):tool==='moveHandle'?moveHandle(before,{curveId,end:0},position):transform(before,[curveId],([x,y])=>[x+.03,y-.02]);return {command,wanted};
}

describe('Vector API local control producers',()=>{
 for(const tool of ['moveNode','moveHandle','transformCurves'] as const)it.each([0,100,1000])(`bounds native ${tool} authoring and capture with %i unrelated curves`,unrelated=>{
  const f=fixture(unrelated),before=currentDrawingPresentation(f.project),{command,wanted}=target(before,tool),saved=JSON.stringify(f.project),h=harness(f.project),author=drawingControlEditStats(),shape=sceneShapeWorkStats(),numeric=drawingShapeWorkStats(),writes=snapshotControlTargetWriteStats();freeze(f.project);
  value(h.api.execute({commands:[command]}));
  expect(difference(author,drawingControlEditStats())).toMatchObject({scopedAuthoring:1,fullAuthoring:0,authoredCurves:1});
  expect(difference(shape,sceneShapeWorkStats())).toMatchObject({fullApplications:0,revisionApplications:2,materialPlans:0,fitShifts:2});
  const geometry=difference(numeric,drawingShapeWorkStats());expect(geometry).toMatchObject({fullApplications:0,revisionApplications:2});expect(geometry.nodeControls).toBeLessThanOrEqual(4);expect(geometry.handleControls).toBeLessThanOrEqual(4);
  expect(difference(writes,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0,layerMaps:1,layerStates:1,shapes:1,relationMaps:0});
  const result=h.state().project;expect(JSON.stringify(f.project)).toBe(saved);expect(result.drawing).toBe(f.project.drawing);expect(result.recordingSnapshots!.library).toBe(f.workspace.library);expect(drawingSnapshotForArtwork(result.recordingSnapshots!,'B')).toBe(f.other);expect(h.state().past).toEqual([f.project]);
  if(unrelated)expect(drawingSnapshotForArtwork(result.recordingSnapshots!,'A')!.deformation.layers[bid('l1')]).toBe(f.owner.deformation.layers[bid('l1')]);
  const actual=drawingSnapshotPresentation(result.recordingSnapshots!,'A')!,cold=resolveSnapshot(structuredClone(result.recordingSnapshots!),f.owner.id,{useDraft:false,diagnostics:'preview'});nearControls(actual.drawing,wanted);nearControls(actual.evaluation.drawing,cold.drawing);
  value(h.api.undo());expect(h.state().project).toBe(f.project);value(h.api.redo());expect(h.state().project).toBe(result);
 });

 it('validates every local request and rolls a later malformed command back atomically',()=>{
  const f=fixture(),h=harness(f.project),before=currentDrawingPresentation(f.project),{command}=target(before,'moveNode'),revision=h.api.inspect().revision;
  const invalid=[{op:'moveNode',nodeId:bid('a0'),position:[NaN,0]},{op:'moveNode',nodeId:bid('a0'),position:[0,0],trust:true},{op:'moveHandle',curveId:bid('c0'),end:2,position:[0,0]},{op:'transformCurves',curveIds:[bid('c0'),bid('c0')],matrix:[1,0,0,1,0,0]},{op:'transformCurves',curveIds:[bid('c0')],matrix:[0,0,0,1,0,0]},{op:'transformCurves',curveIds:[bid('c0')],matrix:[1,0,0,1,0,0],allowRelated:'yes'}];
  for(const bad of invalid){expect(h.api.execute({commands:[command,bad as VectorCommand]})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST',commandIndex:1}});expect(h.state().project).toBe(f.project);expect(h.state().past).toEqual([]);expect(h.api.inspect().revision).toBe(revision);}
  expect(h.api.execute({commands:[{op:'transformCurves',curveIds:[bid('c0'),'missing'],matrix:[1,0,0,1,.1,0]}]})).toMatchObject({ok:false,error:{code:'NOT_FOUND',commandIndex:0}});
  value(h.api.execute({commands:[command],dryRun:true}));expect(h.state().project).toBe(f.project);expect(h.state().past).toEqual([]);
 });

 it('retains canonical material capture when transported intervals change outside scalar controls',()=>{
  const f=fixture(2);f.owner.relations.displayIntervals={add:[{id:'local-track',anchor:{id:bid('c0'),reverse:false},scope:'CURVE',ranges:[{id:'local-range',start:.2,end:.8,mode:'SHOW'}]}]};
  const before=currentDrawingPresentation(f.project),{command,wanted:raw}=target(before,'moveHandle'),wanted=transportDeformedIntervals(structuredClone(before),raw),canonical=currentDrawingPresentation(prepareDrawingSnapshotEdit(structuredClone(f.project),markFinalizedGeometry(parseDrawing(wanted))).project),h=harness(f.project),work=sceneShapeWorkStats(),writes=snapshotControlTargetWriteStats();
  expect(wanted.displayIntervals).not.toEqual(before.displayIntervals);const prepare=vi.spyOn(drawingEdits,'prepareDrawingSnapshotEdit');try{value(h.api.execute({commands:[command]}));const [,submitted,intent]=prepare.mock.calls[0];expect(drawingControlEditProof(before,submitted,intent?.kind==='geometry-authoring'?intent.controlPlan:undefined)).toBeUndefined();}finally{prepare.mockRestore();}
  const result=currentDrawingPresentation(h.state().project);nearControls(result,wanted);expect(result.displayIntervals).toEqual(canonical.displayIntervals);expect(result.displayIntervals![0]).toMatchObject({id:'local-track',ranges:[{id:'local-range'}]});
  expect(difference(work,sceneShapeWorkStats()).fullApplications).toBeGreaterThan(0);expect(difference(writes,snapshotControlTargetWriteStats())).toMatchObject({sharedCaptures:1,detachedCaptures:0});expect(h.state().project.drawing).toBe(f.project.drawing);
 });

 it('keeps cumulative mirror targets, relative handle ordering and no-op configuration epochs',()=>{
  const source=drawing(2);source.mirrorEditing={enabled:true,curvePairs:[{id:'pair',a:'c0',b:'c1',reverse:false}]};
  const project=ensureRecordingSnapshots({...createEmptyProject(),drawing:source,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing:source}]}}),before=currentDrawingPresentation(project),h=harness(project),commands:VectorCommand[]=[{op:'moveNode',nodeId:'a0',position:[.1,.2]},{op:'moveNode',nodeId:'a1',position:[2.3,.1]},{op:'moveHandle',curveId:'c0',end:0,position:[.3,.6]},{op:'setMirrorEditing',enabled:true},{op:'moveHandle',curveId:'c1',end:0,position:[2.7,.4]},{op:'moveNode',nodeId:'a0',position:[.4,.3]}];
  const mirror=new MirrorBatchIntent();let expected=before;
  for(const command of commands){const previous=expected;if(command.op==='moveNode')expected=moveNode(previous,command.nodeId,command.position);else if(command.op==='moveHandle')expected=moveHandle(previous,{curveId:command.curveId,end:command.end},command.position);mirror.capture(expected,command);expected=parseDrawing(mirror.apply(previous,expected));}
  value(h.api.execute({commands}));nearControls(currentDrawingPresentation(h.state().project),expected);expect(h.state().past).toEqual([project]);expect(h.state().project.drawing!.mirrorEditing).toEqual(source.mirrorEditing);
  const accepted=h.state().project;value(h.api.undo());expect(h.state().project).toBe(project);value(h.api.redo());expect(h.state().project).toBe(accepted);
 });

 it('preserves mirror lock failure atomically after an earlier valid command',()=>{
  const source=drawing(2);source.mirrorEditing={enabled:true,curvePairs:[{id:'pair',a:'c0',b:'c1',reverse:false}]};source.curves[1].locked=true;
  const project=ensureRecordingSnapshots({...createEmptyProject(),drawing:source}),h=harness(project),saved=JSON.stringify(project);
  expect(h.api.execute({commands:[{op:'renameCurve',curveId:'c0',name:'Temporary'},{op:'moveHandle',curveId:'c0',end:0,position:[.3,.6]}]})).toMatchObject({ok:false,error:{code:'MIRROR_LOCKED',commandIndex:1}});expect(h.state().project).toBe(project);expect(h.state().past).toEqual([]);expect(JSON.stringify(project)).toBe(saved);
 });

 it('keeps ordinary source transform runs in one synchronization and commits a mixed local batch once',()=>{
  const f=fixture(),h=harness(f.project),parse=vi.spyOn(persistence,'parseRecordingSnapshots');
  try{value(h.api.execute({commands:[{op:'transformCurves',curveIds:['c0'],matrix:[1,0,0,1,.03,0]},{op:'transformCurves',curveIds:['c0'],matrix:[1,0,0,1,0,.02]}]}));expect(parse).toHaveBeenCalledTimes(1);}finally{parse.mockRestore();}
  expect(h.state().past).toEqual([f.project]);const next=h.state().project,before=currentDrawingPresentation(next),wanted=transform(before,['c0',bid('c0')],([x,y])=>[x+.02,y+.01]);
  value(h.api.execute({commands:[{op:'transformCurves',curveIds:['c0',bid('c0')],matrix:[1,0,0,1,.02,.01]}]}));nearControls(currentDrawingPresentation(h.state().project),wanted);expect(h.state().past).toEqual([f.project,next]);expect(h.state().project.drawing!.curves.map(curve=>curve.id)).toEqual(['c0']);
 });
});
