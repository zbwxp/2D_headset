import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview,type SnapshotCommand} from '../../app/recordingSnapshotApi';
import {drawingControlEditStats} from '../../domain/drawing/controlEditPlan';
import {moveNode,moveHandle,transform} from '../../domain/drawing/commands';
import {applyMirrorEditing,mirrorWritesForCurves} from '../../domain/drawing/mirrorEditing';
import {projectSnapshotTransformTargets} from '../../domain/recordingSnapshot/transformTargets';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {drawingShapeWorkStats} from '../../domain/drawing/sparseShape';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {sceneShapeWorkStats} from '../../domain/recordingScene/shapes';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {prepareSnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {preparedControlChangesBetween} from '../../domain/recordingSnapshot/preparedControlChanges';
import {getSnapshotSimplexSamplingStats,resetSnapshotSimplexSamplingStats} from '../../domain/recordingSnapshot/simplexGeometry';

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

const nearControls=(actual:DrawingDocument,wanted:DrawingDocument)=>{
 const near=(a:Point2,b:Point2)=>a.forEach((value,axis)=>expect(value).toBeCloseTo(b[axis],10));
 expect(actual.nodes.map(node=>node.id)).toEqual(wanted.nodes.map(node=>node.id));expect(actual.curves.map(curve=>curve.id)).toEqual(wanted.curves.map(curve=>curve.id));
 for(const node of wanted.nodes)near(actual.nodes.find(value=>value.id===node.id)!.position,node.position);
 for(const curve of wanted.curves)for(const end of [0,1] as const)near(actual.curves.find(value=>value.id===curve.id)!.handles[end],curve.handles[end]);
};
function command(drawing:DrawingDocument,kind:'node'|'handle'|'V',axis:0|1=0):SnapshotCommand {
 if(kind==='V')return {op:'transformShapeElements',curveIds:['c0'],value:{...identityScenePlacement(),translation:axis===0?[.01,0]:[0,.01]}};
 const position=[...(kind==='node'?drawing.nodes.find(node=>node.id==='a0')!.position:drawing.curves.find(curve=>curve.id==='c0')!.handles[0])] as Point2;position[axis]+=.01;
 return kind==='node'?{op:'moveShapeNode',layerId:'l0',nodeId:'a0',position}:{op:'moveShapeHandle',layerId:'l0',curveId:'c0',end:0,position};
}
function target(drawing:DrawingDocument,operation:SnapshotCommand):DrawingDocument {
 if(operation.op==='moveShapeNode'||operation.op==='correctShapeNode')return moveNode(drawing,operation.nodeId,operation.position,true);
 if(operation.op==='moveShapeHandle'||operation.op==='correctShapeHandle')return moveHandle(drawing,{curveId:operation.curveId,end:operation.end},operation.position,true);
 if(operation.op==='transformShapeElements')return transform(drawing,operation.curveIds,([x,y])=>[x+operation.value.translation[0],y+operation.value.translation[1]],true,false);
 throw Error('Unexpected geometry command');
}

describe('completed command candidates retain Drawing control provenance',()=>{
 for(const [route,prepare] of [['native',prepareSnapshotPreview],['JSON',prepareSnapshotBatch]] as const)for(const angle of [90,60])for(const kind of ['node','handle','V'] as const)it.each([0,100,1000])(`${route} ${angle===90?'basis':'response'} ${kind} bounds numeric authoring with %i unrelated layers`,unrelated=>{
  const f=fixture(unrelated,angle,angle===90),baseline=evaluateRecordingSnapshot(f.workspace,'r',options),operation=command(baseline.drawing,kind),wanted=target(baseline.drawing,operation);freeze(f.project);
  const shapesBefore=sceneShapeWorkStats(),numericBefore=drawingShapeWorkStats(),authoringBefore=drawingControlEditStats();resetSnapshotSimplexSamplingStats();
  const result=prepare(f.project,{commands:[operation]}),proof=preparedControlChangesBetween(f.workspace,result.recordingSnapshots,'r');
  expect(result.preparedPlan.before).toBe(f.project);expect(result.preparedPlan.project.recordingSnapshots).toBe(result.recordingSnapshots);expect(proof).toBeDefined();
  const shapes=difference(shapesBefore,sceneShapeWorkStats()),numeric=difference(numericBefore,drawingShapeWorkStats()),authoring=difference(authoringBefore,drawingControlEditStats()),sampling=getSnapshotSimplexSamplingStats();
  expect(authoring.authoredCurves).toBe(1);expect(authoring.scopedAuthoring).toBe(1);expect(authoring.fullAuthoring).toBe(0);
  expect(shapes.fullApplications).toBe(0);expect(numeric.fullApplications).toBe(0);expect(numeric.nodeControls).toBeLessThanOrEqual(2);expect(numeric.handleControls).toBeLessThanOrEqual(2);
  expect(sampling.scalarEvaluations).toBeLessThanOrEqual(8);expect(sampling.fullSamples).toBe(0);
  const actual=evaluateRecordingSnapshot(result.recordingSnapshots,'r',options),cold=evaluateRecordingSnapshot(parseRecordingSnapshots(structuredClone(result.recordingSnapshots)),'r',{useDraft:true,diagnostics:'preview'});
  expect(geometry(actual.drawing)).toEqual(geometry(cold.drawing));nearControls(actual.drawing,wanted);expect(geometry(evaluateRecordingSnapshot(f.workspace,'r',options).drawing)).toEqual(geometry(baseline.drawing));
 });
 for(const kind of ['node','V'] as const)it.each([0,100,1000])(`keeps coupled-basis fallback ${kind} bounded with %i unrelated layers`,unrelated=>{
  const f=fixture(unrelated,60,false),baseline=evaluateRecordingSnapshot(f.workspace,'r',options),operation=command(baseline.drawing,kind,1),wanted=target(baseline.drawing,operation);freeze(f.project);
  const before=drawingShapeWorkStats(),result=prepareSnapshotBatch(f.project,{commands:[operation]}),counts=difference(before,drawingShapeWorkStats());
  expect(counts).toMatchObject({fullApplications:0,revisionApplications:1});expect(counts.nodeControls).toBeLessThanOrEqual(2);expect(counts.handleControls).toBeLessThanOrEqual(2);expect(preparedControlChangesBetween(f.workspace,result.recordingSnapshots,'r')).toBeDefined();
  nearControls(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,wanted);expect(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing).toEqual(evaluateRecordingSnapshot(structuredClone(result.recordingSnapshots),'r',{useDraft:true,diagnostics:'preview'}).drawing);
 });
 for(const angle of [0,60,90])for(const kind of ['node','handle'] as const)it(`shares correction alias ${kind} at the exact angle ${angle}`,()=>{
  const f=fixture(1,angle,false),baseline=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,move=command(baseline,kind),correct={...move,op:kind==='node'?'correctShapeNode':'correctShapeHandle'} as SnapshotCommand;freeze(f.project);
  const result=prepareSnapshotBatch(f.project,{commands:[correct]});nearControls(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,target(baseline,move));expect(preparedControlChangesBetween(f.workspace,result.recordingSnapshots,'r')).toBeDefined();
 });
 it('keeps sequential node, handle and transform inputs immutable and carries the complete ancestry',()=>{
  const f=fixture(3),before=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,first=command(before,'node'),expected1=target(before,first),second=command(expected1,'handle'),expected2=target(expected1,second),third=command(expected2,'V'),expected=target(expected2,third);freeze(f.workspace);
  const one=prepareSnapshotCommand(f.workspace,first),two=prepareSnapshotCommand(freeze(one.workspace),second),three=prepareSnapshotCommand(freeze(two.workspace),third),batch=prepareSnapshotBatch(f.project,{commands:[first,second,third]});
  expect(preparedControlChangesBetween(f.workspace,three.workspace,'r')).toBeDefined();expect(preparedControlChangesBetween(f.workspace,batch.recordingSnapshots,'r')).toBeDefined();
  nearControls(evaluateRecordingSnapshot(one.workspace,'r',options).drawing,expected1);nearControls(evaluateRecordingSnapshot(two.workspace,'r',options).drawing,expected2);nearControls(evaluateRecordingSnapshot(three.workspace,'r',options).drawing,expected);nearControls(evaluateRecordingSnapshot(batch.recordingSnapshots,'r',options).drawing,expected);
 });
 it('keeps structural batches atomic and never assigns scalar proof across new membership',()=>{
  const f=fixture(1),before=JSON.stringify(f.project),baseline=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,move=command(baseline,'node');freeze(f.project);
  const create:SnapshotCommand={op:'createLocalCurve',layerId:'l0',shape:[[0,3],[.2,3],[.7,3],[1,3]],ref:'added'},transform:SnapshotCommand={op:'transformShapeElements',curveIds:['$added'],value:{...identityScenePlacement(),translation:[.1,.2]}};
  const result=prepareSnapshotPreview(f.project,{commands:[move,create,transform]});expect(result.created.some(value=>value.ref==='added')).toBe(true);expect(preparedControlChangesBetween(f.workspace,result.recordingSnapshots,'r')).toBeUndefined();
  const actual=evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,cold=evaluateRecordingSnapshot(structuredClone(result.recordingSnapshots),'r',{useDraft:true,diagnostics:'preview'}).drawing;expect(actual).toEqual(cold);
  expect(()=>prepareSnapshotBatch(f.project,{commands:[move,create,transform,{op:'moveShapeNode',layerId:'l0',nodeId:'missing',position:[1,2]}]})).toThrow(/Node is not owned/);expect(JSON.stringify(f.project)).toBe(before);
 });
 it('preserves API hidden-point authoring, complete hidden containers and locked followers',()=>{
  for(const kind of ['node','handle'] as const){const f=fixture(1,90,false);f.workspace.library.curves.c0.visible=false;for(const view of f.views)view.deformation.layers.l0.visibility={c0:false};const before=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,operation=command(before,kind);freeze(f.project);const result=prepareSnapshotBatch(f.project,{commands:[operation]});nearControls(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,target(before,operation));}
  const f=fixture(1,90,false);f.workspace.library.curves.c0.visible=false;for(const view of f.views)view.deformation.layers.l0.visibility={c0:false};const before=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,operation=command(before,'V'),result=prepareSnapshotBatch(f.project,{commands:[operation]});nearControls(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,target(before,operation));
  const locked=fixture(1);locked.workspace.library.curves.c0.locked=true;const frozen=freeze(locked.project),baseline=evaluateRecordingSnapshot(locked.workspace,'r',options).drawing;expect(()=>prepareSnapshotBatch(frozen,{commands:[command(baseline,'node')]})).toThrow(/锁定|locked/);
 });
 for(const angle of [90,60])for(const relation of ['linked','mirror','linked-mirror'] as const)it(`matches canonical complete linked/SMOOTH/mirror V authoring at ${angle} (${relation})`,()=>{
  const f=fixture(3,angle,false);
  if(relation!=='mirror')for(const index of [0,2]){
   f.workspace.library.nodes[`a${index+1}`].position=[...f.workspace.library.nodes[`b${index}`].position];f.workspace.library.curves[`c${index+1}`].handles[0]=[index*2+1.3,1.4];
   for(const view of f.views)view.relations.endpointLinks={add:[...view.relations.endpointLinks?.add??[],{id:`link${index}`,a:{curveId:`c${index}`,end:1},b:{curveId:`c${index+1}`,end:0},joinBrush:{kind:'SMOOTH'}}]};
  }
  if(relation!=='linked')for(const view of f.views)view.relations.mirrorEditing={enabled:true,curvePairs:{add:[{id:'pair0',a:'c0',b:'c2',reverse:false},{id:'pair1',a:'c1',b:'c3',reverse:false}]}};
  const before=evaluateRecordingSnapshot(f.workspace,'r',options).drawing,value={...identityScenePlacement(),rotation:angle===90?3:0,translation:[.01,0] as Point2},curveIds=['c0'],raw=projectSnapshotTransformTargets(before,transform(before,curveIds,point=>applyScenePlacement(value,point),true,false)),wanted=applyMirrorEditing(before,raw,mirrorWritesForCurves(raw,curveIds));freeze(f.project);
  const result=prepareSnapshotBatch(f.project,{commands:[{op:'transformShapeElements',curveIds,value}]});nearControls(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing,wanted);expect(evaluateRecordingSnapshot(result.recordingSnapshots,'r',options).drawing).toEqual(evaluateRecordingSnapshot(structuredClone(result.recordingSnapshots),'r',{useDraft:true,diagnostics:'preview'}).drawing);
 });
 it('keeps no-op geometry and navigation on the exact immutable input',()=>{
  const f=fixture(1),drawing=evaluateRecordingSnapshot(f.workspace,'r',options).drawing;freeze(f.project);
  for(const prepare of [prepareSnapshotPreview,prepareSnapshotBatch]){const result=prepare(f.project,{commands:[{op:'setAngle',angle:{x:90,y:0}},{op:'moveShapeNode',layerId:'l0',nodeId:'a0',position:drawing.nodes.find(node=>node.id==='a0')!.position}]});expect(result.changed).toBe(false);expect(result.recordingSnapshots).toBe(f.workspace);}
 });
 it('preserves retained stroke placement and restores an exact zero axis without inventing control offsets',()=>{
  const f=fixture(2),zero={...identityScenePlacement(),scaleX:0,scaleY:1},first=prepareSnapshotPreview(f.project,{commands:[{op:'setShapeElementPlacement',curveIds:['c0'],value:zero}]}),collapsed=first.recordingSnapshots.snapshots[1].draft!.deformation.layers.l0;
  expect(collapsed.elementPlacements!.c0).toEqual(zero);expect(collapsed.shape).toEqual(f.views[1].draft!.deformation.layers.l0.shape);expect(preparedControlChangesBetween(f.workspace,first.recordingSnapshots,'r')).toBeUndefined();
  const restored=prepareSnapshotBatch(first.preparedPlan.project,{commands:[{op:'setShapeElementPlacement',curveIds:['c0'],value:identityScenePlacement()}]});nearControls(evaluateRecordingSnapshot(restored.recordingSnapshots,'r',options).drawing,evaluateRecordingSnapshot(f.workspace,'r',options).drawing);
 });
});
