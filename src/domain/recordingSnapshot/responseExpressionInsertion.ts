import {unprovenSnapshotSmoothResponses} from './responseExpressionSmooth';
import {sub,type DrawingDocument} from '../drawing/model';
import {evaluateRecordingSnapshot,resolveSnapshot} from './evaluation';
import {reconcileSnapshotAngleGraphMesh,validateSnapshotAngleGraph} from './angleGraph';
import {insertSnapshotVertex,locateSnapshotSimplex,type SnapshotSimplexLocation} from './triangulation';
import {createSnapshotResponseFieldWeightMapper} from './responseExpressionRegistry';
import {createSnapshotResponseExpressionCapture} from './responseExpressionSplit';
import {combineSnapshotResponseExpressions,restrictSnapshotResponseExpression,type SnapshotResponseExpressionField} from './responseExpressions';
import type {RecordingSnapshotWorkspace,RecordingSnapshot,SnapshotAngleGraph,SnapshotRecording,SnapshotExpressionControlResponse,SnapshotExpressionResponses} from './model';

export class SnapshotSurfaceInsertionError extends Error {
 readonly code='SURFACE_INSERTION_REQUIRES_TRANSFER';
 constructor(message:string){super(message);this.name='SnapshotSurfaceInsertionError';}
}
const fail=(message:string):never=>{throw new SnapshotSurfaceInsertionError(message);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const axes=['x','y'] as const;
const shapeFree=(drawing:DrawingDocument)=>({...drawing,nodes:drawing.nodes.map(node=>({...node,position:[0,0]})),curves:drawing.curves.map(curve=>({...curve,handles:[[0,0],[0,0]]})),reference:undefined,mirrorEditing:undefined});

/** Capture a genuine new real view as ordinary references + local residuals.
 * The canonical library and every old real pose stay intact. */
function captureRealView(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,view:RecordingSnapshot):{view:RecordingSnapshot;drawing:DrawingDocument;location:SnapshotSimplexLocation} {
 const evaluated=evaluateRecordingSnapshot(workspace,recording.id,{angle:view.angle,useDraft:false,diagnostics:'preview'}),surface=evaluated.angleSurface;
 if(!surface?.simplex||surface.role!=='correction')return fail('A real-view insertion requires an interior point of existing coverage.');
 if(surface.bases.some(base=>!same(shapeFree(base.drawing),shapeFree(surface.bases[0].drawing))))fail('This real-view insertion needs an explicit transfer for differing membership, appearance, or material between its real bases. The original surface is unchanged.');
 if(evaluated.drawing.displayIntervals?.length)fail('This real-view insertion needs an exact material-coordinate transfer for its display intervals. The original surface is unchanged.');
 const smooth=[...evaluated.drawing.joins.filter(join=>join.mode==='SMOOTH'),...(evaluated.drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')];
 if(smooth.length){
  const graph=recording.angleGraph!,nextMesh=insertSnapshotVertex(graph.mesh,{snapshotId:view.id,angle:view.angle}),retained=new Set([...nextMesh.edges,...nextMesh.triangles].map(simplex=>simplex.id));
  const vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex]));
  const locations:SnapshotSimplexLocation[]=[...graph.mesh.edges,...graph.mesh.triangles].filter(simplex=>!retained.has(simplex.id)).map(simplex=>({kind:simplex.vertexIds.length===2?'edge':'triangle',simplexId:simplex.id,vertexIds:[...simplex.vertexIds],snapshotIds:simplex.vertexIds.map(id=>vertices.get(id)!.snapshotId),geometricWeights:simplex.vertexIds.map(()=>1/simplex.vertexIds.length)}));
  const failures=unprovenSnapshotSmoothResponses(graph,surface.allBases,smooth,'smooth-insertion-proof',locations);if(failures.length)fail(`This real-view insertion cannot exactly transfer SMOOTH dependencies: ${failures.join('; ')}. The original surface is unchanged.`);
 }
 const parent=surface.bases.find(base=>base.snapshotId===evaluated.snapshotId)??surface.bases[0],next:RecordingSnapshot={...view,deformation:structuredClone(view.deformation),layers:evaluated.drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:parent.snapshotId,baseLayerId:layer.id}))};
 const temporary={...workspace,snapshots:[...workspace.snapshots,next]},baseline=resolveSnapshot(temporary,next.id,{useDraft:false,diagnostics:'preview'}).drawing;
 for(const layer of evaluated.drawing.layers){const curves=evaluated.drawing.curves.filter(curve=>layer.items.includes(curve.id)),nodeIds=new Set(curves.flatMap(curve=>curve.nodes)),nodes:Record<string,[number,number]>={},handles:Record<string,[[number,number],[number,number]]>={};
  for(const node of evaluated.drawing.nodes)if(nodeIds.has(node.id)){const original=baseline.nodes.find(value=>value.id===node.id);if(!original)fail(`New real view lost node ${node.id}.`);nodes[node.id]=sub(node.position,original!.position);}
  for(const curve of curves){const original=baseline.curves.find(value=>value.id===curve.id);if(!original)fail(`New real view lost curve ${curve.id}.`);handles[curve.id]=([0,1] as const).map(end=>sub(sub(curve.handles[end],evaluated.drawing.nodes.find(node=>node.id===curve.nodes[end])!.position),sub(original!.handles[end],baseline.nodes.find(node=>node.id===original!.nodes[end])!.position))) as [[number,number],[number,number]];}
  next.deformation.layers[layer.id]={shape:{nodes,handles}};
 }
 const replay=resolveSnapshot({...workspace,snapshots:[...workspace.snapshots,next]},next.id,{useDraft:false,diagnostics:'preview'}).drawing;
 for(const node of evaluated.drawing.nodes){const actual=replay.nodes.find(value=>value.id===node.id);if(!actual||actual.position.some((value,axis)=>Math.abs(value-node.position[axis])>1e-10*Math.max(1,Math.abs(value))))fail(`New real view cannot exactly replay node ${node.id}.`);}
 for(const curve of evaluated.drawing.curves){const actual=replay.curves.find(value=>value.id===curve.id);if(!actual||actual.handles.some((point,end)=>point.some((value,axis)=>Math.abs(value-curve.handles[end][axis])>1e-10*Math.max(1,Math.abs(value)))))fail(`New real view cannot exactly replay handle ${curve.id}.`);}
 return {view:next,drawing:evaluated.drawing,location:surface.simplex};
}

/** Restrict independent old fields and subtract their values at new real
 * corners. Existing edge channels stay native; their new triangular extension
 * is canceled algebraically so it is never counted twice. */
export function prepareSnapshotSurfaceInsertion(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording,view:RecordingSnapshot,archiveId:string):{view:RecordingSnapshot;graph:SnapshotAngleGraph} {
 const graph=recording.angleGraph;if(!graph)fail('A triangulated Recording is required.');
 if(graph!.correctionFrames?.some(frame=>frame.status==='draft')||graph!.mesh.vertices.some(vertex=>workspace.snapshots.find(snapshot=>snapshot.id===vertex.snapshotId)?.draft))fail('Save or discard the current correction and real-view drafts before inserting a real view. The original surface is unchanged.');
 if(Object.keys(graph!.propertyResponses?.edges??{}).length||Object.keys(graph!.propertyResponses?.triangles??{}).length)fail('Real-view insertion needs an exact transfer for existing property responses. The original surface is unchanged.');
 const captured=captureRealView(workspace,recording,view),mesh=insertSnapshotVertex(graph!.mesh,{snapshotId:view.id,angle:view.angle}),reconciled=reconcileSnapshotAngleGraphMesh(graph!,mesh,{id:archiveId,reason:'mesh-change',message:'Original scalar fields retained as recovery evidence after exact real-view restriction.'});
 if(!reconciled.ok)fail(reconciled.diagnostics.map(issue=>issue.message).join(' '));
 const next=(reconciled as {ok:true;graph:SnapshotAngleGraph}).graph,capture=createSnapshotResponseExpressionCapture(graph!.mesh,graph!,'real-view-insertion'),native=createSnapshotResponseExpressionCapture(mesh,{edgeResponses:next.edgeResponses,triangleResponses:next.triangleResponses},`real-view-insertion-native:${view.id}`),vertices=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex]));
 const existing=new Set([...graph!.mesh.edges,...graph!.mesh.triangles].map(simplex=>simplex.id)),registry={...next.responseExpressions};
 for(const simplex of [...mesh.edges,...mesh.triangles]){
  if(existing.has(simplex.id))continue;
  const count=simplex.vertexIds.length,center=simplex.vertexIds.map(id=>vertices.get(id)!.angle).reduce((sum,at)=>({x:sum.x+at.x/count,y:sum.y+at.y/count}),{x:0,y:0}),old=locateSnapshotSimplex(graph!.mesh,center);
  if(!old||old.kind==='vertex')fail('A child simplex could not be mapped into its original response support.');
  const location:SnapshotSimplexLocation={kind:count===2?'edge':'triangle',simplexId:simplex.id,vertexIds:[...simplex.vertexIds],snapshotIds:simplex.vertexIds.map(id=>vertices.get(id)!.snapshotId),geometricWeights:simplex.vertexIds.map(()=>1/count)};
  const map=createSnapshotResponseFieldWeightMapper(mesh,location),support:SnapshotResponseExpressionField={id:JSON.stringify(['real-view-restriction',view.id,simplex.id]),vertexIds:[...simplex.vertexIds],edges:[],samples:[]};
  const responses:SnapshotExpressionResponses={nodes:{},handles:{}};
  const transfer=(target:Parameters<ReturnType<typeof createSnapshotResponseExpressionCapture>>[1]):SnapshotExpressionControlResponse=>{
   const control:SnapshotExpressionControlResponse={};
   for(const axis of [0,1] as const){const source=capture(old!,target,axis),restricted=restrictSnapshotResponseExpression(source,support,(field,index)=>map(field,location.vertexIds.map((_,i)=>i===index?1:0))),inherited=combineSnapshotResponseExpressions([{coefficient:1,expression:restricted},{coefficient:-1,expression:native(location,target,axis)}]);if(inherited.terms.length)control[axes[axis]]=inherited;}
   return control;
  };
  for(const node of captured.drawing.nodes){const control=transfer({kind:'node',nodeId:node.id});if(Object.keys(control).length)Object.defineProperty(responses.nodes,node.id,{value:control,enumerable:true});}
  for(const curve of captured.drawing.curves){const pair=[transfer({kind:'handle',curveId:curve.id,end:0}),transfer({kind:'handle',curveId:curve.id,end:1})] as const;if(pair.some(control=>Object.keys(control).length))Object.defineProperty(responses.handles,curve.id,{value:pair,enumerable:true});}
  if(Object.keys(responses.nodes).length||Object.keys(responses.handles).length)Object.defineProperty(registry,simplex.id,{value:responses,enumerable:true});
 }
 const result:SnapshotAngleGraph={...next,...Object.keys(registry).length?{responseExpressions:registry}:{},...graph!.correctionFrames?{correctionFrames:graph!.correctionFrames.map(frame=>({id:frame.id,angle:frame.angle,status:frame.status}))}:{}};
 validateSnapshotAngleGraph(result);return {view:captured.view,graph:result};
}
