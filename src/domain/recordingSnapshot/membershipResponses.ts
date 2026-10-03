import type {DrawingDocument} from '../drawing/model';
import {resolveSnapshot} from './evaluation';
import {snapshotResponseExpressionTerms,type SnapshotResponseExpression} from './responseExpressions';
import type {RecordingSnapshotWorkspace,SnapshotAngleGraph,SnapshotCorrectionFrame,SnapshotEndpointResponses,SnapshotExpressionResponses,SnapshotOrphanedResponses,SnapshotResponseExpressionRegistry,SnapshotTriangleResponses} from './model';

type Target={kind:'node';nodeId:string}|{kind:'handle';curveId:string;end:0|1};
type Membership=ReadonlyMap<string,{nodes:ReadonlySet<string>;curves:ReadonlySet<string>}>;
type Diagnostic={code:string;message:string};
type ResponseMap=SnapshotEndpointResponses|SnapshotTriangleResponses|SnapshotExpressionResponses;
const address=(target:Target)=>target.kind==='node'?`node ${target.nodeId}`:`handle ${target.curveId}/${target.end}`;
const contains=(membership:Membership,snapshotId:string,target:Target)=>target.kind==='node'?membership.get(snapshotId)?.nodes.has(target.nodeId)===true:membership.get(snapshotId)?.curves.has(target.curveId)===true;
const members=(drawing:DrawingDocument)=>({nodes:new Set(drawing.nodes.map(node=>node.id)),curves:new Set(drawing.curves.map(curve=>curve.id))});
const hasResponses=(value:Pick<SnapshotAngleGraph,'edgeResponses'|'triangleResponses'|'responseExpressions'>|SnapshotCorrectionFrame)=>[value.edgeResponses,value.triangleResponses,value.responseExpressions].some(registry=>Object.keys(registry??{}).length);

/** Capture membership before a structural command mutates its detached workspace.
 * Geometry and responses are never sampled or stored by reconciliation. */
export function captureSnapshotResponseMembership(workspace:RecordingSnapshotWorkspace):Membership {
 const snapshots=new Set(workspace.recordings.filter(({angleGraph:graph})=>graph&&(hasResponses(graph)||graph.correctionFrames?.some(hasResponses))).flatMap(recording=>recording.angleGraph!.mesh.vertices.map(vertex=>vertex.snapshotId)));
 return new Map([...snapshots].map(snapshotId=>[snapshotId,members(resolveSnapshot(workspace,snapshotId,{useDraft:false,diagnostics:'preview'}).drawing)]));
}

/** A local membership edit changes coverage, not canonical source ownership.
 * Retire only scalar entries that have just lost their own target or live leaf
 * support; every retained entry keeps its exact original law and identity. */
export function reconcileSnapshotMembershipResponses(workspace:RecordingSnapshotWorkspace,before:Membership):{workspace:RecordingSnapshotWorkspace;diagnostics:Diagnostic[]} {
 if(!before.size)return {workspace,diagnostics:[]};
 const after=captureSnapshotResponseMembership(workspace),diagnostics:Diagnostic[]=[];
 let changed=false;
 const recordings=workspace.recordings.map(recording=>{
  const graph=recording.angleGraph;if(!graph)return recording;
  const snapshotByVertex=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.snapshotId])),supports=new Map([...graph.mesh.edges,...graph.mesh.triangles].map(simplex=>[simplex.id,simplex.vertexIds.map(id=>snapshotByVertex.get(id)!)]));
  const lost=(snapshotId:string,target:Target)=>contains(before,snapshotId,target)&&!contains(after,snapshotId,target);
  const reason=(simplexId:string,target:Target,expression?:SnapshotResponseExpression):string|undefined=>{
   const unsupported=supports.get(simplexId)?.find(snapshotId=>lost(snapshotId,target));
   if(unsupported)return `${address(target)} is no longer a member of real view ${unsupported}`;
   if(expression){
    for(const term of snapshotResponseExpressionTerms(expression))for(const {basis} of term.basis)if(lost(basis.snapshotId,basis.target))return `live basis ${address(basis.target)} is no longer a member of real view ${basis.snapshotId}`;
    for(const contract of expression.smoothContracts??[])for(const {endpoint} of contract.targets)if(!Object.hasOwn(workspace.library.curves,endpoint.curveId)&&[...before.values()].some(value=>value.curves.has(endpoint.curveId)))return `SMOOTH target ${endpoint.curveId}/${endpoint.end} was deleted`;
   }
  };
  const filter=<T extends ResponseMap>(value:T,simplexId:string,derived:boolean,frameId?:string):{kept:T;retired:T;changed:boolean}=>{
   let modified=false;
   const kept:SnapshotExpressionResponses={nodes:{},handles:{}},retired:SnapshotExpressionResponses={nodes:{},handles:{}};
   const control=(value:object,target:Target)=>{
    const yes:Record<string,unknown>={},no:Record<string,unknown>={};
    for(const [axis,response] of Object.entries(value)){
     const missing=reason(simplexId,target,derived?response as SnapshotResponseExpression:undefined);
     if(!missing){yes[axis]=response;continue;}
     modified=true;no[axis]=response;diagnostics.push({code:'RESPONSE_SUPPORT_RETIRED',message:`Recording ${recording.name}, simplex ${simplexId}, ${address(target)} ${axis.toUpperCase()}${frameId?`, correction ${frameId}`:''}: response archived because ${missing}.`});
    }
    return [Object.keys(no).length?yes:value,no] as const;
   };
   for(const [id,response] of Object.entries(value.nodes)){
    const [yes,no]=control(response,{kind:'node',nodeId:id});if(Object.keys(yes).length||!Object.keys(response).length)Object.defineProperty(kept.nodes,id,{value:yes,enumerable:true});if(Object.keys(no).length)Object.defineProperty(retired.nodes,id,{value:no,enumerable:true});
   }
   for(const [id,pair] of Object.entries(value.handles)){
    const controls=pair as readonly object[],result=controls.map((value,end)=>control(value,{kind:'handle',curveId:id,end:end as 0|1})),yes=[result[0][0],result[1][0]],no=[result[0][1],result[1][1]];
    if(yes.some(value=>Object.keys(value).length)||controls.every(value=>!Object.keys(value).length))Object.defineProperty(kept.handles,id,{value:result.every((entry,index)=>entry[0]===pair[index])?pair:yes,enumerable:true});
    if(no.some(value=>Object.keys(value).length))Object.defineProperty(retired.handles,id,{value:no,enumerable:true});
   }
   return {kept:modified?kept as T:value,retired:retired as T,changed:modified};
  };
  const map=<T extends ResponseMap>(values:Record<string,T>|undefined,derived=false,frameId?:string)=>{
   const kept:Record<string,T>={},retired:Record<string,T>={};let changed=false;
   for(const [simplex,value] of Object.entries(values??{})){const result=filter(value,simplex,derived,frameId);Object.defineProperty(kept,simplex,{value:result.kept,enumerable:true});if(result.changed){changed=true;Object.defineProperty(retired,simplex,{value:result.retired,enumerable:true});}}
   return {kept:changed?kept:values,retired,changed};
  };
  const maps=(value:Pick<SnapshotAngleGraph,'edgeResponses'|'triangleResponses'|'responseExpressions'>|SnapshotCorrectionFrame,frameId?:string)=>({edges:map(value.edgeResponses,false,frameId),triangles:map(value.triangleResponses,false,frameId),expressions:map(value.responseExpressions,true,frameId)});
  const saved=maps(graph),frames=(graph.correctionFrames??[]).map(frame=>({frame,result:maps(frame,frame.id)})),modified=(result:ReturnType<typeof maps>)=>result.edges.changed||result.triangles.changed||result.expressions.changed;
  if(!modified(saved)&&!frames.some(value=>modified(value.result)))return recording;
  changed=true;
  const archiveMaps=(result:ReturnType<typeof maps>)=>({edgeResponses:result.edges.retired,triangleResponses:result.triangles.retired,...result.expressions.changed?{responseExpressions:result.expressions.retired as SnapshotResponseExpressionRegistry}:{}});
  const activeMaps=(result:ReturnType<typeof maps>)=>({...result.edges.kept?{edgeResponses:result.edges.kept}:{},...result.triangles.kept?{triangleResponses:result.triangles.kept}:{},...result.expressions.kept?{responseExpressions:result.expressions.kept as SnapshotResponseExpressionRegistry}:{}});
  const archives=graph.orphanedResponses??[],stem=`membership-response-support:${recording.id}`;let id=stem,index=1;while(archives.some(archive=>archive.id===id))id=`${stem}:${index++}`;
  const archive:SnapshotOrphanedResponses={id,reason:'mesh-change',message:'Local membership changed. Only responses whose target or live basis lost support were archived; canonical source geometry remains live.',mesh:structuredClone(graph.mesh),...archiveMaps(saved),...frames.some(value=>modified(value.result))?{correctionFrames:frames.filter(value=>modified(value.result)).map(({frame,result})=>({id:frame.id,angle:frame.angle,status:frame.status,...archiveMaps(result)}))}:{}};
  const next:SnapshotAngleGraph={...graph,...activeMaps(saved),...graph.correctionFrames?{correctionFrames:frames.map(({frame,result})=>modified(result)?{...frame,...activeMaps(result)}:frame)}:{},orphanedResponses:[...archives,archive]};
  return {...recording,angleGraph:next};
 });
 return {workspace:changed?{...workspace,recordings}:workspace,diagnostics};
}
