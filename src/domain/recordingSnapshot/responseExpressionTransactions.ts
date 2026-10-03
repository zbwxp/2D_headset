import {deriveSmoothComponents} from './smoothComponent';
import {createSnapshotResponseBasisResolver} from './responseExpressionRegistry';
import {unprovenSnapshotSmoothResponses} from './responseExpressionSmooth';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import {endpointPairNodeAuthorities} from './endpointPair';
import {resolveSnapshot} from './evaluation';
import {remapSnapshotSplitResponses} from './responseExpressionSplit';
import {interpolateSnapshotSimplexGeometry} from './simplexGeometry';
import {validateRecordingSnapshots} from './validation';
import type {RecordingSnapshotWorkspace,SnapshotAngleGraph,SnapshotExpressionControlResponse,SnapshotExpressionResponses,SnapshotResponseExpressionRegistry} from './model';
import {snapshotResponseExpressionTerms,type SnapshotResponseExpression,type SnapshotResponseBasisReference} from './responseExpressions';

/** Final step of the existing frozen-source topology transaction. Only the
 * algebra is persisted; old evaluated poses are ephemeral basis evidence. */
export function transferSnapshotSplitResponses(before:RecordingSnapshotWorkspace,candidate:RecordingSnapshotWorkspace,intent:CurveSplitIntent):RecordingSnapshotWorkspace {
 const recordings=candidate.recordings.map(recording=>{
  const prior=before.recordings.find(value=>value.id===recording.id),graph=prior?.mode==='triangulated'?prior.angleGraph:undefined;
  if(!graph||!recording.angleGraph)return recording;
  const bases=graph.mesh.vertices.map(vertex=>({snapshotId:vertex.snapshotId,drawing:resolveSnapshot(before,vertex.snapshotId,{useDraft:false,diagnostics:'preview'}).drawing,angle:vertex.angle}));
  if(!bases.some(basis=>basis.drawing.curves.some(curve=>curve.id===intent.curveId)))return recording;
  // A preexisting SMOOTH relation applies nonlinear length/direction projection
  // after interpolation. Capture its full original component when needed.
  const smooth=[...new Map(bases.flatMap(basis=>[...basis.drawing.joins.filter(join=>join.mode==='SMOOTH'),...(basis.drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')]).map(relation=>[relation.id,relation])).values()],ends=new Set([JSON.stringify([intent.curveId,0]),JSON.stringify([intent.curveId,1])]),related=new Set<string>();
  for(let changed=true;changed;){changed=false;for(const relation of smooth){const a=JSON.stringify([relation.a.curveId,relation.a.end]),b=JSON.stringify([relation.b.curveId,relation.b.end]);if((ends.has(a)||ends.has(b))&&!related.has(relation.id)){related.add(relation.id);ends.add(a);ends.add(b);changed=true;}}}
  const proofBases=[...bases,...graph.mesh.vertices.map(vertex=>({snapshotId:vertex.snapshotId,drawing:resolveSnapshot(before,vertex.snapshotId,{useDraft:true,angle:before.snapshots.find(snapshot=>snapshot.id===vertex.snapshotId)!.angle,diagnostics:'preview'}).drawing,angle:vertex.angle}))],dependencies=smooth.filter(relation=>related.has(relation.id));
  const nonlinearDependencies=unprovenSnapshotSmoothResponses(graph,proofBases,dependencies,`split-proof:${intent.curveId}`);
  for(const frame of graph.correctionFrames??[])if(frame.status==='draft'){
   const effective:SnapshotAngleGraph={...graph,edgeResponses:{...graph.edgeResponses,...frame.edgeResponses},triangleResponses:{...graph.triangleResponses,...frame.triangleResponses},responseExpressions:{...graph.responseExpressions,...frame.responseExpressions}};
   nonlinearDependencies.push(...unprovenSnapshotSmoothResponses(effective,proofBases,dependencies,`split-proof:${intent.curveId}:draft:${frame.id}`).map(message=>`Draft ${frame.id}, ${message}`));
  }
  const authorities=new Map<string,Map<string,string>>();
  const next=remapSnapshotSplitResponses(graph,intent,{nonlinearDependencies,...nonlinearDependencies.length?{smoothComponents:(location:import('./triangulation').SnapshotSimplexLocation)=>{const active=location.snapshotIds.map(id=>bases.find(basis=>basis.snapshotId===id)!),drawing=interpolateSnapshotSimplexGeometry(active,location.geometricWeights).drawing,curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),nodeAuthority=endpointPairNodeAuthorities(drawing),relations=[...drawing.joins.filter(join=>join.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')];return deriveSmoothComponents(relations).filter(component=>component.members.some(({endpoint})=>endpoint.curveId===intent.curveId)).map(component=>({component,nodeIds:component.members.map(({endpoint})=>{const node=curves.get(endpoint.curveId)!.nodes[endpoint.end];return nodeAuthority.get(node)??node;})}));}}:{},nodeAuthority:(nodeId,location)=>{
   let map=authorities.get(location.simplexId);if(!map){const active=location.snapshotIds.map(id=>bases.find(basis=>basis.snapshotId===id)!);map=endpointPairNodeAuthorities(interpolateSnapshotSimplexGeometry(active,location.geometricWeights).drawing);authorities.set(location.simplexId,map);}return map.get(nodeId)??nodeId;
  }});
  return {...recording,angleGraph:{...next,...recording.angleGraph.materialPartitions?{materialPartitions:recording.angleGraph.materialPartitions}:{},...recording.angleGraph.materialPathLineages?{materialPathLineages:recording.angleGraph.materialPathLineages}:{}}};
 });
 const result={...candidate,recordings};validateRecordingSnapshots(result);return result;
}

function filterRegistry(registry:SnapshotResponseExpressionRegistry|undefined,workspace:RecordingSnapshotWorkspace,hasBasis:(basis:SnapshotResponseBasisReference)=>boolean):{kept:SnapshotResponseExpressionRegistry;retired:SnapshotResponseExpressionRegistry} {
 const kept:SnapshotResponseExpressionRegistry={},retired:SnapshotResponseExpressionRegistry={};
 const targetAlive=(kind:'nodes'|'handles',id:string)=>Object.hasOwn(kind==='nodes'?workspace.library.nodes:workspace.library.curves,id);
 const valid=(expression:SnapshotResponseExpression)=>(expression.smoothContracts??[]).every(contract=>contract.targets.every(({endpoint})=>targetAlive('handles',endpoint.curveId)))&&snapshotResponseExpressionTerms(expression).every(term=>term.basis.every(({basis})=>targetAlive(basis.target.kind==='node'?'nodes':'handles',basis.target.kind==='node'?basis.target.nodeId:basis.target.curveId)&&hasBasis(basis)));
 for(const [simplexId,responses] of Object.entries(registry??{})){
  const active:SnapshotExpressionResponses={nodes:{},handles:{}},archive:SnapshotExpressionResponses={nodes:{},handles:{}};
  const filter=(control:SnapshotExpressionControlResponse,alive:boolean)=>{const yes:SnapshotExpressionControlResponse={},no:SnapshotExpressionControlResponse={};for(const axis of ['x','y'] as const){const expression=control[axis];if(expression)(alive&&valid(expression)?yes:no)[axis]=expression;}return [yes,no] as const;};
  for(const [id,control] of Object.entries(responses.nodes)){const [yes,no]=filter(control,targetAlive('nodes',id));if(Object.keys(yes).length)Object.defineProperty(active.nodes,id,{value:yes,enumerable:true});if(Object.keys(no).length)Object.defineProperty(archive.nodes,id,{value:no,enumerable:true});}
  for(const [id,pair] of Object.entries(responses.handles)){const results=pair.map(control=>filter(control,targetAlive('handles',id))),yes=[results[0][0],results[1][0]] as const,no=[results[0][1],results[1][1]] as const;if(yes.some(control=>Object.keys(control).length))Object.defineProperty(active.handles,id,{value:yes,enumerable:true});if(no.some(control=>Object.keys(control).length))Object.defineProperty(archive.handles,id,{value:no,enumerable:true});}
  if(Object.keys(active.nodes).length||Object.keys(active.handles).length)Object.defineProperty(kept,simplexId,{value:active,enumerable:true});
  if(Object.keys(archive.nodes).length||Object.keys(archive.handles).length)Object.defineProperty(retired,simplexId,{value:archive,enumerable:true});
 }
 return {kept,retired};
}
/** Source deletion never reconstructs a removed control from retained fields.
 * Explicitly archive each dependent expression while preserving unrelated ones. */
export function pruneSnapshotResponseDependencies(workspace:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace {
 let changed=false;
 const recordings=workspace.recordings.map(recording=>{
  const graph=recording.angleGraph;if(!graph||!graph.responseExpressions&&!graph.correctionFrames?.some(frame=>frame.responseExpressions))return recording;
  const basis=createSnapshotResponseBasisResolver(graph.mesh.vertices.map(vertex=>({snapshotId:vertex.snapshotId,drawing:resolveSnapshot(workspace,vertex.snapshotId,{useDraft:false,diagnostics:'preview'}).drawing}))),hasBasis=(reference:SnapshotResponseBasisReference)=>basis(reference)!==undefined;
  const saved=filterRegistry(graph.responseExpressions,workspace,hasBasis),frames=(graph.correctionFrames??[]).map(frame=>({frame,...filterRegistry(frame.responseExpressions,workspace,hasBasis)}));
  if(!Object.keys(saved.retired).length&&!frames.some(value=>Object.keys(value.retired).length))return recording;
  changed=true;const archives=graph.orphanedResponses??[],stem=`deleted-response-source:${recording.id}`;let id=stem,index=1;while(archives.some(archive=>archive.id===id))id=`${stem}:${index++}`;
  const next:SnapshotAngleGraph={...graph,...graph.responseExpressions?{responseExpressions:saved.kept}:{},...graph.correctionFrames?{correctionFrames:frames.map(value=>value.frame.responseExpressions?{...value.frame,responseExpressions:value.kept}:value.frame)}:{},orphanedResponses:[...archives,{id,reason:'mesh-change',message:'Inherited scalar responses were archived because their canonical target or live basis control was deleted.',mesh:structuredClone(graph.mesh),edgeResponses:{},triangleResponses:{},...Object.keys(saved.retired).length?{responseExpressions:saved.retired}:{},correctionFrames:frames.filter(value=>Object.keys(value.retired).length).map(value=>({id:value.frame.id,angle:value.frame.angle,status:value.frame.status,responseExpressions:value.retired}))}]};
  return {...recording,angleGraph:next};
 });
 return changed?{...workspace,recordings}:workspace;
}
