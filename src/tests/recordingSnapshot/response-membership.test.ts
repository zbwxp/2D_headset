import {describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {emptyDrawing,shapeOf,sub,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {applyCurveSplitIntent,type CurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {deleteLayer} from '../../domain/drawing/commands';
import {applySnapshotCommand,type SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {endpointPairNodeAuthorities} from '../../domain/recordingSnapshot/endpointPair';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace,type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {remapSnapshotSplitResponses} from '../../domain/recordingSnapshot/responseExpressionSplit';
import type {SnapshotResponseExpression} from '../../domain/recordingSnapshot/responseExpressions';
import {deriveSmoothComponents} from '../../domain/recordingSnapshot/smoothComponent';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';

const angles=[0,15,45,60,75,90];
const splitIntent:CurveSplitIntent={kind:'split-curve',curveId:'follower',sourceLayerId:'children-layer',sourceNodeIds:['z-joint','end'],t:.5,childCurveIds:['left','right'],seamNodeId:'seam',seamJoinId:'seam-join',intervals:[]};
const evaluate=(workspace:RecordingSnapshotWorkspace,x:number,useDraft=false)=>evaluateRecordingSnapshot(workspace,'r',{angle:{x,y:0},useDraft,diagnostics:'preview'});

/** The nonlinear two-basis split from response-projection-insertion, with
 * separately removable children. The 60-degree real view inherits B. */
function fixture(){
 const vertices=[{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}],mesh=createSnapshotTriangulation(vertices);
 const originalGraph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{[mesh.edges[0].id]:{nodes:{},handles:{driver:[{y:[[.4,.7]]},{}]}}},triangleResponses:{},correctionFrames:[{id:'saved-control-response',angle:{x:36,y:0},status:'saved'}]};
 const originals=vertices.map((vertex,index)=>({snapshotId:vertex.snapshotId,drawing:{...emptyDrawing(),
  nodes:[{id:'start',position:[-3,0]},{id:'a-joint',position:[0,0]},{id:'z-joint',position:[0,0]},{id:'end',position:[4,0]}],
  curves:[{id:'driver',name:'Driver',nodes:['start','a-joint'],handles:[[-2,1+index],index===0?[1,0]:[0,1]],visible:true,locked:false,width:.01},{id:'follower',name:'Follower',nodes:['z-joint','end'],handles:[index===0?[-2,0]:[0,-4],[3,1]],visible:true,locked:false,width:.01}],
  endpointLinks:[{id:'smooth',a:{curveId:'driver',end:1},b:{curveId:'follower',end:0},joinBrush:{kind:'SMOOTH'}}],
  layers:[{id:'driver-layer',name:'Driver layer',visible:true,locked:false,items:['driver']},{id:'children-layer',name:'Children layer',visible:true,locked:false,items:['follower']}],
 } as DrawingDocument}));
 const original=originals[0].drawing,authorities=endpointPairNodeAuthorities(original),curves=new Map(original.curves.map(curve=>[curve.id,curve]));
 const graph=remapSnapshotSplitResponses(originalGraph,splitIntent,{nonlinearDependencies:['smooth'],nodeAuthority:id=>authorities.get(id)??id,smoothComponents:()=>deriveSmoothComponents(original.endpointLinks!).map(component=>({component,nodeIds:component.members.map(({endpoint})=>authorities.get(curves.get(endpoint.curveId)!.nodes[endpoint.end])!)}))});
 const bases=originals.map(basis=>({...basis,drawing:applyCurveSplitIntent(basis.drawing,splitIntent,{propagate:true}).document})),w=emptyRecordingSnapshotWorkspace(),base=bases[0].drawing;
 w.library.nodes=Object.fromEntries(base.nodes.map(node=>[node.id,structuredClone(node)]));
 w.library.curves=Object.fromEntries(base.curves.map(curve=>[curve.id,structuredClone(curve)]));
 w.snapshots=bases.map(({snapshotId,drawing},index)=>{
  const view=emptyRecordingSnapshot(snapshotId,snapshotId,'view',vertices[index].angle);
  view.layers=drawing.layers.map(layer=>({kind:'original',...structuredClone(layer)}));
  view.relations={joins:{add:structuredClone(drawing.joins)},endpointLinks:{add:structuredClone(drawing.endpointLinks??[])}};
  if(index)for(const layer of drawing.layers){
   const members=drawing.curves.filter(curve=>layer.items.includes(curve.id)),nodes=new Set(members.flatMap(curve=>curve.nodes));
   view.deformation.layers[layer.id]={shape:{nodes:Object.fromEntries(drawing.nodes.filter(node=>nodes.has(node.id)).map(node=>[node.id,sub(node.position,base.nodes.find(other=>other.id===node.id)!.position)])),handles:Object.fromEntries(members.map(curve=>[curve.id,([0,1] as const).map(end=>{
    const rest=base.curves.find(other=>other.id===curve.id)!;
    return sub(sub(curve.handles[end],drawing.nodes.find(node=>node.id===curve.nodes[end])!.position),sub(rest.handles[end],base.nodes.find(node=>node.id===rest.nodes[end])!.position));
   }) as [Point2,Point2]]))}};
  }
  return view;
 });
 // A references live source membership, so both removeLayers and
 // excludeElements exercise the public batch path without deleting geometry.
 const source={...structuredClone(w.snapshots[0]),id:'source',name:'Source',kind:'drawing' as const,source:{artworkId:'art',originIds:{'children-layer':'children-layer',left:'left',right:'right'}}};
 w.snapshots[0].layers[1]={kind:'reference',id:'children-layer',name:'Children layer',baseSnapshotId:source.id,baseLayerId:'children-layer'};
 w.snapshots.unshift(source);
 const recording=emptySnapshotRecording('r');recording.mode='triangulated';recording.snapshotIds=['A','B'];recording.activeSnapshotId='A';recording.angleGraph=graph;w.recordings=[recording];w.activeRecordingId='r';
 applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0},name:'Real 60'});
 w.recordings[0].angleGraph=structuredClone(w.recordings[0].angleGraph!);
 const insertedId=w.recordings[0].activeSnapshotId!,next=w.recordings[0].angleGraph!,near=locateSnapshotSimplex(next.mesh,{x:15,y:0})!.simplexId,far=locateSnapshotSimplex(next.mesh,{x:75,y:0})!.simplexId;
 expect(w.snapshots.find(view=>view.id===insertedId)!.layers.every(layer=>layer.kind==='reference'&&layer.baseSnapshotId==='B')).toBe(true);
 // A safe X response and an unsafe Y dependency share the same surviving
 // handle and simplex. Native responses use only their own live targets.
 for(const edge of next.mesh.edges){
  const expression=(curveId:string,axis:0|1):SnapshotResponseExpression=>({version:1,fields:[{id:`membership:${edge.id}`,vertexIds:edge.vertexIds,edges:[{from:0,to:1,knots:[[.5,.65]]}],samples:[]}],terms:[],operations:[{kind:'linear',terms:[{fieldId:`membership:${edge.id}`,coordinate:0,weight:'residual',basis:[{coefficient:.03,basis:{snapshotId:'A',target:{kind:'handle',curveId,end:0},axis}}]}]}]});
  next.responseExpressions![edge.id].handles.driver=[{x:expression('driver',0),y:expression('left',1)},next.responseExpressions![edge.id].handles.driver[1]];
  next.edgeResponses[edge.id]={nodes:{},handles:{driver:[{x:[[.5,.6]],y:[[.5,.4]]},{}],left:[{y:[[.5,.55]]},{}]}};
 }
 next.correctionFrames!.push({id:'draft-control-response',angle:{x:15,y:0},status:'draft',edgeResponses:structuredClone(next.edgeResponses),responseExpressions:structuredClone(next.responseExpressions)});
 next.correctionFrames!.at(-1)!.edgeResponses![near].handles.driver[0].x=[[.5,.7]];
 applySnapshotCommand(w,{op:'selectSnapshot',snapshotId:'A'});
 return {w,near,far,insertedId};
}

function assertFiniteCoverage(w:RecordingSnapshotWorkspace){
 for(const useDraft of [false,true])for(const x of angles){
  const result=evaluate(w,x,useDraft),drawing=result.drawing;
  expect(drawing.curves.some(curve=>curve.id==='driver'),`driver at ${x}`).toBe(true);
  expect(drawing.layers.some(layer=>layer.id==='driver-layer'),`driver layer at ${x}`).toBe(true);
  for(const curve of drawing.curves)expect(shapeOf(drawing,curve.id).flat().every(Number.isFinite),`normal ${curve.id} at ${x}`).toBe(true);
  for(const preview of result.angleSurface!.outsideCurves){expect(preview.cubic.flat().every(Number.isFinite),`preview ${preview.curveId} at ${x}`).toBe(true);expect(preview.readonly).toBe(true);expect(preview.outside).toBe(true);}
  if(x<60){
   expect(drawing.curves.map(curve=>curve.id)).toEqual(['driver']);
   expect(result.angleSurface!.outsideCurves.map(curve=>curve.curveId).sort()).toEqual(['left','right']);
   for(const preview of result.angleSurface!.outsideCurves)expect(preview.evaluatedAngle).toEqual({x:60,y:0});
  }else expect(drawing.curves.map(curve=>curve.id).sort()).toEqual(['driver','left','right']);
 }
}

describe('local membership retires only newly unsupported scalar responses',()=>{
 it.each(['removeLayers','excludeElements','canvas'] as const)('%s keeps nonlinear split coverage evaluable and archives recoverable saved/draft laws',op=>{
  const {w,near,far,insertedId}=fixture(),project={...createEmptyProject(),recordingSnapshots:w},sourceJSON=JSON.stringify(w.snapshots.find(view=>view.id==='source')),libraryJSON=JSON.stringify(w.library),beforeJSON=JSON.stringify(w),beforeGraph=structuredClone(w.recordings[0].angleGraph!),oldB=structuredClone(resolveSnapshot(w,'B').drawing),oldReal60=structuredClone(resolveSnapshot(w,insertedId).drawing);
  const batch=(()=>{
   if(op==='canvas'){const beforeDrawing=resolveSnapshot(w,'A',{useDraft:true}).drawing,plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'local-drawing-topology',recordingId:'r',snapshotId:'A',angle:{x:0,y:0},beforeDrawing,drawing:deleteLayer(beforeDrawing,'children-layer')});return {changed:plan.changed,recordingSnapshots:plan.project.recordingSnapshots!,diagnostics:plan.diagnostics??[]};}
   const command:SnapshotCommand=op==='removeLayers'?{op,layerIds:['children-layer']}:{op,layerId:'children-layer',elementIds:['left','right']};return prepareSnapshotBatch(project,{commands:[command]});
  })(),after=batch.recordingSnapshots,graph=after.recordings[0].angleGraph!;
  expect(batch.changed).toBe(true);expect(JSON.stringify(w)).toBe(beforeJSON);
  expect(JSON.stringify(after.library)).toBe(libraryJSON);expect(JSON.stringify(after.snapshots.find(view=>view.id==='source'))).toBe(sourceJSON);
  expect(resolveSnapshot(after,'B').drawing).toEqual(oldB);expect(resolveSnapshot(after,insertedId).drawing).toEqual(oldReal60);
  const code=op==='canvas'?'POSE':'RESPONSE_SUPPORT_RETIRED';expect(batch.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code,message:expect.stringMatching(/driver\/0 Y.*live basis.*left\/0.*A/)}),expect.objectContaining({code,message:expect.stringMatching(/left\/0 Y.*A/)})]));
  expect(graph.mesh).toEqual(beforeGraph.mesh);expect(graph.orphanedResponses!.slice(0,-1)).toEqual(beforeGraph.orphanedResponses);
  const archive=graph.orphanedResponses!.at(-1)!;
  expect(archive.mesh).toEqual(beforeGraph.mesh);expect(archive.reason).toBe('mesh-change');
  for(const simplex of [near,far]){
   expect(graph.edgeResponses[simplex].handles.driver).toEqual(beforeGraph.edgeResponses[simplex].handles.driver);
   expect(graph.responseExpressions![simplex].handles.driver[0]).toEqual({x:beforeGraph.responseExpressions![simplex].handles.driver[0].x});
   expect(archive.responseExpressions![simplex].handles.driver[0]).toEqual({y:beforeGraph.responseExpressions![simplex].handles.driver[0].y});
  }
  expect(graph.edgeResponses[near].handles.left).toBeUndefined();expect(archive.edgeResponses[near].handles.left).toEqual(beforeGraph.edgeResponses[near].handles.left);
  expect(graph.edgeResponses[far].handles.left).toEqual(beforeGraph.edgeResponses[far].handles.left);expect(archive.edgeResponses[far]?.handles.left).toBeUndefined();
  const inherited=beforeGraph.responseExpressions![near].handles.left[0].x!;
  expect(inherited.operations!.length).toBeGreaterThan(0);expect(inherited.sourceBaseline).toBeDefined();
  expect(archive.responseExpressions![near].handles.left[0].x).toEqual(inherited);
  const originalDraft=beforeGraph.correctionFrames!.find(frame=>frame.status==='draft')!,draft=graph.correctionFrames!.find(frame=>frame.status==='draft')!,archivedDraft=archive.correctionFrames!.find(frame=>frame.id===originalDraft.id)!;
  expect(graph.correctionFrames!.find(frame=>frame.status==='saved')).toEqual(beforeGraph.correctionFrames!.find(frame=>frame.status==='saved'));
  expect({id:archivedDraft.id,angle:archivedDraft.angle,status:archivedDraft.status}).toEqual({id:originalDraft.id,angle:originalDraft.angle,status:originalDraft.status});
  for(const simplex of [near,far]){
   expect(draft.edgeResponses![simplex].handles.driver).toEqual(originalDraft.edgeResponses![simplex].handles.driver);
   expect(draft.responseExpressions![simplex].handles.driver[0]).toEqual({x:originalDraft.responseExpressions![simplex].handles.driver[0].x});
   expect(archivedDraft.responseExpressions![simplex].handles.driver[0]).toEqual({y:originalDraft.responseExpressions![simplex].handles.driver[0].y});
  }
  expect(draft.edgeResponses![near].handles.left).toBeUndefined();expect(archivedDraft.edgeResponses![near].handles.left).toEqual(originalDraft.edgeResponses![near].handles.left);
  expect(draft.edgeResponses![far].handles.left).toEqual(originalDraft.edgeResponses![far].handles.left);
  assertFiniteCoverage(after);
  const replay=parseRecordingSnapshots(JSON.parse(JSON.stringify(after)));
  expect(replay.recordings[0].angleGraph).toEqual(graph);assertFiniteCoverage(replay);
  const previewBefore=evaluate(replay,15).angleSurface!.outsideCurves.find(curve=>curve.curveId==='right')!.cubic;
  const liveSourceEdit=structuredClone(replay);liveSourceEdit.library.curves.right.handles[1][1]+=.125;
  const previewAfter=evaluate(liveSourceEdit,15).angleSurface!.outsideCurves.find(curve=>curve.curveId==='right')!.cubic;
  expect(previewAfter).toEqual(shapeOf(resolveSnapshot(liveSourceEdit,insertedId).drawing,'right'));
  expect(previewAfter).not.toEqual(previewBefore);
  assertFiniteCoverage(liveSourceEdit);
  // Restoring membership makes the live source available again. Archived
  // response laws stay recovery evidence unless explicitly restored by Undo.
  if(op==='excludeElements'){
   const restored=prepareSnapshotBatch({...project,recordingSnapshots:after},{commands:[{op:'restoreElements',layerId:'children-layer',elementIds:['left','right']}]}).recordingSnapshots;
   expect(resolveSnapshot(restored,'A').drawing.curves.map(curve=>curve.id).sort()).toEqual(['driver','left','right']);
   expect(restored.recordings[0].angleGraph!.orphanedResponses).toEqual(graph.orphanedResponses);
   for(const x of angles)expect(()=>evaluate(restored,x,true)).not.toThrow();
  }
  const prior=useEditor.getState(),priorMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
  try{
   useEditor.setState({project,past:[],future:[]});useWorkspaceMode.getState().setMode('recording');useEditor.getState().commitRecordingSnapshots(after);
   const committed=useEditor.getState().project;expect(committed.recordingSnapshots).toEqual(after);
   useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);expect(JSON.stringify(useEditor.getState().project.recordingSnapshots)).toBe(beforeJSON);
   useEditor.getState().redo();expect(useEditor.getState().project).toBe(committed);assertFiniteCoverage(useEditor.getState().project.recordingSnapshots!);
  }finally{vi.runAllTimers();useEditor.setState(prior,true);useWorkspaceMode.getState().setMode(priorMode);vi.unstubAllGlobals();vi.useRealTimers();}
 });
});
