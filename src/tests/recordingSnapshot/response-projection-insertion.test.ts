import {describe,expect,it,vi} from 'vitest';
import {add,emptyDrawing,shapeOf,sub,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {moveHandle,moveNode} from '../../domain/drawing/commands';
import {applyCurveSplitIntent,type CurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace,type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {endpointPairNodeAuthorities} from '../../domain/recordingSnapshot/endpointPair';
import {deriveSmoothComponents} from '../../domain/recordingSnapshot/smoothComponent';
import {remapSnapshotSplitResponses} from '../../domain/recordingSnapshot/responseExpressionSplit';
import {interpolateSnapshotSimplexGeometry,type SnapshotSimplexBasis} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceValueSampler} from '../../domain/recordingSnapshot/surfaceTargets';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {applySnapshotCommand,type SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';

const splitIntent:CurveSplitIntent={kind:'split-curve',curveId:'follower',sourceLayerId:'layer',sourceNodeIds:['z-joint','end'],t:.5,childCurveIds:['left','right'],seamNodeId:'seam',seamJoinId:'seam-join',intervals:[]};
const angles=[0,15,30,45,59.999,60,60.001,75,90];
const split=(drawing:DrawingDocument)=>applyCurveSplitIntent(drawing,splitIntent,{propagate:true}).document;
const evaluate=(workspace:RecordingSnapshotWorkspace,x:number,useDraft=false)=>evaluateRecordingSnapshot(workspace,'r',{angle:{x,y:0},useDraft}).drawing;
function compare(actual:DrawingDocument,expected:DrawingDocument,precision=10){
 expect(actual.nodes.map(node=>node.id).sort()).toEqual(expected.nodes.map(node=>node.id).sort());
 for(const node of expected.nodes)for(const axis of [0,1] as const)expect(actual.nodes.find(other=>other.id===node.id)!.position[axis],`${node.id}/${axis}`).toBeCloseTo(node.position[axis],precision);
 expect(actual.curves.map(curve=>curve.id).sort()).toEqual(expected.curves.map(curve=>curve.id).sort());
 for(const curve of expected.curves){const got=shapeOf(actual,curve.id),want=shapeOf(expected,curve.id);for(let point=0;point<4;point++)for(const axis of [0,1] as const)expect(got[point][axis],`${curve.id}/${point}/${axis}`).toBeCloseTo(want[point][axis],precision);}
}
function fixture(splitFirst=true,triangle=false){
 const vertices=[{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},...(triangle?[{snapshotId:'C',angle:{x:0,y:90}}]:[])],mesh=createSnapshotTriangulation(vertices),boundary=mesh.edges.find(edge=>edge.vertexIds.every(id=>mesh.vertices.find(vertex=>vertex.id===id)!.angle.y===0))!;
 const originalGraph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{},correctionFrames:[{id:'saved-control-response',angle:{x:36,y:0},status:'saved'}]};
 // A saved native response on the other end of the driver makes this more than
 // a no-response insertion, without changing the minimal nonlinear seam.
 originalGraph.edgeResponses[boundary.id]={nodes:{},handles:{driver:[{y:[[.4,.7]]},{}]}};
 const originalBases:SnapshotSimplexBasis[]=vertices.map(({snapshotId},index)=>({snapshotId,drawing:{...emptyDrawing(),
  nodes:[{id:'start',position:[-3,0]},{id:'a-joint',position:[0,0]},{id:'z-joint',position:[0,0]},{id:'end',position:[4,0]}],
  curves:[{id:'driver',name:'Driver',nodes:['start','a-joint'],handles:[[-2,1+index],index===0?[1,0]:index===1?[0,1]:[-1,.5]],visible:true,locked:false,width:.01},{id:'follower',name:'Follower',nodes:['z-joint','end'],handles:[index===0?[-2,0]:index===1?[0,-4]:[2,-1],[3,1]],visible:true,locked:false,width:.01}],
  endpointLinks:[{id:'smooth',a:{curveId:'driver',end:1},b:{curveId:'follower',end:0},joinBrush:{kind:'SMOOTH'}}],
  layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['driver','follower']}],
 }}));
 const original=originalBases[0].drawing,authorities=endpointPairNodeAuthorities(original),curves=new Map(original.curves.map(curve=>[curve.id,curve]));
 const graph=splitFirst?remapSnapshotSplitResponses(originalGraph,splitIntent,{nonlinearDependencies:['smooth'],nodeAuthority:id=>authorities.get(id)??id,smoothComponents:()=>deriveSmoothComponents(original.endpointLinks!).map(component=>({component,nodeIds:component.members.map(({endpoint})=>authorities.get(curves.get(endpoint.curveId)!.nodes[endpoint.end])!)}))}):originalGraph;
 const bases=originalBases.map(basis=>({...basis,drawing:splitFirst?split(basis.drawing):basis.drawing})),w=emptyRecordingSnapshotWorkspace(),base=bases[0].drawing;
 w.library.nodes=Object.fromEntries(base.nodes.map(node=>[node.id,structuredClone(node)]));w.library.curves=Object.fromEntries(base.curves.map(curve=>[curve.id,structuredClone(curve)]));
 w.snapshots=bases.map(({snapshotId,drawing},index)=>{
  const view=emptyRecordingSnapshot(snapshotId,snapshotId,'view',vertices[index].angle);
  view.layers=drawing.layers.map(layer=>({kind:'original',...structuredClone(layer)}));view.relations={joins:{add:structuredClone(drawing.joins)},endpointLinks:{add:structuredClone(drawing.endpointLinks??[])}};
  if(index)view.deformation.layers.layer={shape:{nodes:Object.fromEntries(drawing.nodes.map(node=>[node.id,sub(node.position,base.nodes.find(other=>other.id===node.id)!.position)])),handles:Object.fromEntries(drawing.curves.map(curve=>[curve.id,([0,1] as const).map(end=>{
   const rest=base.curves.find(other=>other.id===curve.id)!;
   return sub(sub(curve.handles[end],drawing.nodes.find(node=>node.id===curve.nodes[end])!.position),sub(rest.handles[end],base.nodes.find(node=>node.id===rest.nodes[end])!.position));
  }) as [Point2,Point2]]))}};
  return view;
 });
 const recording=emptySnapshotRecording('r');recording.mode='triangulated';recording.snapshotIds=vertices.map(vertex=>vertex.snapshotId);recording.activeSnapshotId='A';recording.angleGraph=graph;w.recordings=[recording];w.activeRecordingId='r';
 const originalAt=(x:number,y=0)=>{const location=locateSnapshotSimplex(mesh,{x,y})!;return interpolateSnapshotSimplexGeometry(location.snapshotIds.map(id=>originalBases.find(basis=>basis.snapshotId===id)!),location.geometricWeights,createSnapshotSurfaceValueSampler(originalGraph,location,originalBases)).drawing;};
 return {w,originalAt};
}
function assertSmooth(drawing:DrawingDocument){
 for(const [a,b] of [[{curveId:'driver',end:1},{curveId:'left',end:0}],[{curveId:'left',end:1},{curveId:'right',end:0}]] as const){
  const vector=(endpoint:typeof a|typeof b)=>{const curve=drawing.curves.find(curve=>curve.id===endpoint.curveId)!;return sub(curve.handles[endpoint.end],drawing.nodes.find(node=>node.id===curve.nodes[endpoint.end])!.position);},u=vector(a),v=vector(b),denominator=Math.hypot(...u)*Math.hypot(...v);
  expect(Math.abs(u[0]*v[1]-u[1]*v[0])/denominator).toBeLessThan(1e-10);expect(u[0]*v[0]+u[1]*v[1]).toBeLessThan(0);
 }
}

describe('nonlinear SMOOTH real-view insertion through the workspace',()=>{
 it.each([true,false])('preserves the frozen full surface and real authorities (split first: %s)',splitFirst=>{
  const {w,originalAt}=fixture(splitFirst),before=angles.map(x=>structuredClone(evaluate(w,x))),library=JSON.stringify(w.library),oldViews=JSON.stringify(w.snapshots),records=structuredClone(w.recordings[0].angleGraph!.correctionFrames);
  for(let index=0;index<angles.length;index++)compare(before[index],splitFirst?split(originalAt(angles[index])):originalAt(angles[index]));
  if(splitFirst){const seam=before[3].nodes.find(node=>node.id==='seam')!.position;expect(seam[0]).toBeCloseTo(1.0320729387184288,13);expect(seam[1]).toBeCloseTo(-.21792706128157107,13);}
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0},name:'Real 60'});
  const inserted=w.snapshots.at(-1)!;
  expect(w.recordings[0].snapshotIds).toHaveLength(3);expect(w.recordings[0].tracks).toEqual([]);expect(inserted.layers[0].kind).toBe('reference');expect(inserted.deformation.layers.layer.shape).toBeDefined();
  expect(JSON.stringify(w.library)).toBe(library);expect(JSON.stringify(w.snapshots.slice(0,2))).toBe(oldViews);expect(w.recordings[0].angleGraph!.correctionFrames).toEqual(records);
  compare(resolveSnapshot(w,inserted.id,{useDraft:false}).drawing,before[5]);
  const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));
  for(let index=0;index<angles.length;index++){compare(evaluate(w,angles[index]),before[index]);compare(evaluate(reloaded,angles[index]),before[index]);}
 });

 it('restricts a nonlinear split triangle while retaining its boundary native response',()=>{
  const {w,originalAt}=fixture(true,true),points=[{x:30,y:20},{x:29.999,y:20},{x:30.001,y:20},{x:10,y:25},{x:30,y:40},{x:55,y:20},{x:15,y:0},{x:45,y:0},{x:75,y:0},{x:0,y:45},{x:45,y:45}];
  const at=(workspace:RecordingSnapshotWorkspace,angle:{x:number;y:number})=>evaluateRecordingSnapshot(workspace,'r',{angle,useDraft:false}).drawing;
  for(const point of points)compare(at(w,point),split(originalAt(point.x,point.y)));
  // Author a native boundary correction on the inherited nonlinear seam itself,
  // so insertion must cancel the retained edge field in its new baseline.
  applySnapshotCommand(w,{op:'setAngle',angle:{x:45,y:0}});const seam=evaluate(w,45).nodes.find(node=>node.id==='seam')!;
  applySnapshotCommand(w,{op:'moveShapeNode',layerId:'layer',nodeId:'seam',position:add(seam.position,[.025,-.015])});applySnapshotCommand(w,{op:'updateEndpointCorrection'});
  const before=points.map(point=>structuredClone(at(w,point))),boundary=Object.entries(w.recordings[0].angleGraph!.edgeResponses)[0],native=structuredClone(boundary[1]),library=JSON.stringify(w.library),oldViews=JSON.stringify(w.snapshots),records=structuredClone(w.recordings[0].angleGraph!.correctionFrames);
  expect(native.nodes.seam.x).toBeDefined();expect(native.nodes.seam.y).toBeDefined();
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:30,y:20},name:'Interior 30 / 20'});
  expect(w.recordings[0].angleGraph!.mesh.edges.some(edge=>edge.id===boundary[0])).toBe(true);expect(w.recordings[0].angleGraph!.edgeResponses[boundary[0]]).toEqual(native);
  expect(JSON.stringify(w.library)).toBe(library);expect(JSON.stringify(w.snapshots.slice(0,3))).toBe(oldViews);expect(w.recordings[0].angleGraph!.correctionFrames).toEqual(records);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));for(let index=0;index<points.length;index++){compare(at(w,points[index]),before[index]);compare(at(loaded,points[index]),before[index]);}
 });

 it('keeps the new real basis editable and correction inverse replayable through save, reload, Undo and Redo',()=>{
  const previous=useEditor.getState(),previousMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
  try{
   const {w}=fixture(),originalEndpoints=[evaluate(w,0),evaluate(w,90)],sourceLibrary=JSON.stringify(w.library),oldViews=JSON.stringify(w.snapshots),oldRecords=structuredClone(w.recordings[0].angleGraph!.correctionFrames),project={...createEmptyProject(),recordingSnapshots:w};
   useEditor.setState({project,past:[],future:[]});useWorkspaceMode.getState().setMode('recording');
   const current=()=>useEditor.getState().project.recordingSnapshots!;
   const commit=(commands:SnapshotCommand[])=>{const next=structuredClone(current());for(const command of commands)applySnapshotCommand(next,command);useEditor.getState().commitRecordingSnapshots(next);};
   commit([{op:'createSnapshot',angle:{x:60,y:0},name:'Real 60'}]);const insertedProject=useEditor.getState().project,insertedId=current().snapshots.at(-1)!.id,realBefore=evaluate(current(),60),seam=realBefore.nodes.find(node=>node.id==='seam')!,wantedReal=moveNode(realBefore,seam.id,add(seam.position,[.08,.05]),true);
   expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(insertedProject);
   commit([{op:'moveShapeNode',layerId:'layer',nodeId:seam.id,position:add(seam.position,[.08,.05])}]);
   expect(current().snapshots.find(view=>view.id===insertedId)!.draft).toBeDefined();compare(evaluate(current(),60,true),wantedReal);compare(evaluate(current(),60),realBefore);
   commit([{op:'updateSnapshot'}]);expect(current().snapshots.find(view=>view.id===insertedId)!.draft).toBeUndefined();compare(evaluate(current(),60),wantedReal);assertSmooth(evaluate(current(),60));
   const realSeam=wantedReal.nodes.find(node=>node.id==='seam')!.position,realInner=wantedReal.curves.find(curve=>curve.id==='left')!.handles[1],realHandlePosition=add(realSeam,sub(realInner,realSeam).map(value=>value*1.2) as Point2),wantedRealAfterHandle=moveHandle(wantedReal,{curveId:'left',end:1},realHandlePosition,true);
   commit([{op:'moveShapeHandle',layerId:'layer',curveId:'left',end:1,position:realHandlePosition}]);
   compare(evaluate(current(),60,true),wantedRealAfterHandle);compare(evaluate(current(),60),wantedReal);assertSmooth(evaluate(current(),60,true));
   const realHandleDraftProject=useEditor.getState().project;commit([{op:'updateSnapshot'}]);const realHandleSavedProject=useEditor.getState().project;
   compare(evaluate(current(),60),wantedRealAfterHandle);expect(current().snapshots.find(view=>view.id===insertedId)!.draft).toBeUndefined();
   useEditor.getState().undo();expect(useEditor.getState().project).toBe(realHandleDraftProject);compare(evaluate(current(),60,true),wantedRealAfterHandle);compare(evaluate(current(),60),wantedReal);useEditor.getState().redo();expect(useEditor.getState().project).toBe(realHandleSavedProject);
   for(const x of [59.999999,60.000001]){compare(evaluate(current(),x),wantedRealAfterHandle,5);assertSmooth(evaluate(current(),x));}
   commit([{op:'setAngle',angle:{x:45,y:0}}]);const beforeCorrection=useEditor.getState().project,uncorrected=evaluate(current(),45),correctionSeam=uncorrected.nodes.find(node=>node.id==='seam')!,movedCorrection=moveNode(uncorrected,correctionSeam.id,add(correctionSeam.position,[.025,-.015]),true),basisBefore=JSON.stringify(current().snapshots);
   const correctionNode=movedCorrection.nodes.find(node=>node.id==='seam')!.position,correctionInner=movedCorrection.curves.find(curve=>curve.id==='right')!.handles[0],correctionHandlePosition=add(correctionNode,sub(correctionInner,correctionNode).map(value=>value*1.1) as Point2),wantedCorrection=moveHandle(movedCorrection,{curveId:'right',end:0},correctionHandlePosition,true);
   commit([{op:'moveShapeNode',layerId:'layer',nodeId:correctionSeam.id,position:add(correctionSeam.position,[.025,-.015])},{op:'moveShapeHandle',layerId:'layer',curveId:'right',end:0,position:correctionHandlePosition}]);
   expect(current().recordings[0].angleGraph!.correctionFrames!.at(-1)!.status).toBe('draft');compare(evaluate(current(),45,true),wantedCorrection);compare(evaluate(current(),45),uncorrected);
   const draftProject=useEditor.getState().project;useEditor.getState().undo();expect(useEditor.getState().project).toBe(beforeCorrection);compare(evaluate(current(),45),uncorrected);useEditor.getState().redo();expect(useEditor.getState().project).toBe(draftProject);compare(evaluate(current(),45,true),wantedCorrection);
   commit([{op:'updateEndpointCorrection'}]);const savedProject=useEditor.getState().project;
   expect(current().recordings[0].angleGraph!.correctionFrames!.at(-1)!.status).toBe('saved');expect(current().recordings[0].angleGraph!.correctionFrames!.slice(0,oldRecords!.length)).toEqual(oldRecords);compare(evaluate(current(),45),wantedCorrection);assertSmooth(evaluate(current(),45));
   expect(JSON.stringify(current().snapshots)).toBe(basisBefore);expect(JSON.stringify(current().snapshots.slice(0,2))).toBe(oldViews);expect(JSON.stringify(current().library)).toBe(sourceLibrary);
   const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(current())));for(const x of angles)compare(evaluate(reloaded,x),evaluate(current(),x));compare(evaluate(reloaded,60),wantedRealAfterHandle);for(const [index,x] of [0,90].entries())compare(evaluate(reloaded,x),originalEndpoints[index]);
   for(const x of [44.999999,45.000001])compare(evaluate(reloaded,x),wantedCorrection,5);
   useEditor.getState().undo();expect(useEditor.getState().project).toBe(draftProject);compare(evaluate(current(),45,true),wantedCorrection);compare(evaluate(current(),45),uncorrected);useEditor.getState().redo();expect(useEditor.getState().project).toBe(savedProject);compare(evaluate(current(),45),wantedCorrection);
   const beforeSecondInsertion=angles.map(x=>structuredClone(evaluate(current(),x))),viewsBeforeSecond=JSON.stringify(current().snapshots),recordsBeforeSecond=structuredClone(current().recordings[0].angleGraph!.correctionFrames);
   commit([{op:'createSnapshot',angle:{x:30,y:0},name:'Real 30 after edits'}]);const secondProject=useEditor.getState().project,secondReload=parseRecordingSnapshots(JSON.parse(JSON.stringify(current())));
   expect(current().recordings[0].snapshotIds).toHaveLength(4);expect(JSON.stringify(current().snapshots.slice(0,3))).toBe(viewsBeforeSecond);expect(JSON.stringify(current().library)).toBe(sourceLibrary);expect(current().recordings[0].angleGraph!.correctionFrames).toEqual(recordsBeforeSecond);
   for(let index=0;index<angles.length;index++){compare(evaluate(current(),angles[index]),beforeSecondInsertion[index]);compare(evaluate(secondReload,angles[index]),beforeSecondInsertion[index]);}
   useEditor.getState().undo();expect(useEditor.getState().project).toBe(savedProject);useEditor.getState().redo();expect(useEditor.getState().project).toBe(secondProject);

  }finally{vi.runAllTimers();useEditor.setState(previous,true);useWorkspaceMode.getState().setMode(previousMode);vi.unstubAllGlobals();vi.useRealTimers();}
 });
});
