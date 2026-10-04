import {expect,test} from 'vitest';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording,type SnapshotExpressionResponses} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph,reconcileSnapshotAngleGraphMesh,validateSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {createSnapshotTriangulation} from '../../domain/recordingSnapshot/triangulation';
import {validateSnapshotResponseExpressionRegistry,snapshotResponseExpressionRegistryValidForMesh} from '../../domain/recordingSnapshot/responseExpressionRegistry';
import {pruneSnapshotResponseDependencies} from '../../domain/recordingSnapshot/responseExpressionTransactions';
import {captureSnapshotResponseMembership,reconcileSnapshotMembershipResponses} from '../../domain/recordingSnapshot/membershipResponses';
import {
 createSnapshotResponseConstant as constant,createSnapshotResponseBasisValue as basisValue,
 createSnapshotResponseFitParameter as fitValue,createSnapshotResponseMaterialParameter,
 withSnapshotResponseSourceBaseline,type SnapshotResponseExpressionField,
} from '../../domain/recordingSnapshot/responseExpressions';

const basis=(snapshotId='B')=>basisValue({snapshotId,target:{kind:'handle',curveId:'source',end:0},axis:0});
const fit=(snapshotId='B')=>fitValue({snapshotId,parts:[{curveId:'source',parameterRange:[0,1]}],t:.37});
const material=(field:SnapshotResponseExpressionField)=>createSnapshotResponseMaterialParameter(
 [[0,0],[.3,1],[.7,-1],[1,0]].map(point=>[constant(point[0]),constant(point[1])]),
 field.vertexIds.map(()=>constant(.37)),field,{parts:[{curveId:'source',parameterRange:[0,1]}],t:.37},
);
function fixture(){
 const w=emptyRecordingSnapshotWorkspace();
 for(const [id,position] of [['a',[0,0]],['b',[1,0]],['c',[0,1]],['d',[1,1]]] as const)w.library.nodes[id]={id,position:[...position]};
 w.library.curves.keep={id:'keep',name:'Keep',nodes:['a','b'],handles:[[.3,.1],[.7,.1]],visible:true,locked:false,width:.01};
 w.library.curves.source={...w.library.curves.keep,id:'source',name:'Source',nodes:['c','d'],handles:[[.3,1.1],[.7,1.1]]};
 w.snapshots=['A','B'].map((id,index)=>{const snapshot=emptyRecordingSnapshot(id,id,'view',{x:90*index,y:0});snapshot.layers=[{kind:'original',id:'layer',name:'Layer',items:['keep','source'],visible:true,locked:false}];return snapshot;});
 const recording=emptySnapshotRecording('r');recording.mode='triangulated';recording.snapshotIds=['A','B'];recording.activeSnapshotId='A';recording.angleGraph=createSnapshotAngleGraph(w.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.recordings=[recording];w.activeRecordingId='r';
 const graph=recording.angleGraph,edge=graph.mesh.edges[0],field:SnapshotResponseExpressionField={id:'field',vertexIds:edge.vertexIds,edges:[],samples:[]};
 const responses:SnapshotExpressionResponses={nodes:{a:{x:basis(),y:constant(7)},b:{x:fit()}},handles:{keep:[{x:material(field)},{y:withSnapshotResponseSourceBaseline(constant(3),fit())}]}};
 graph.responseExpressions={[edge.id]:responses};graph.correctionFrames=[{id:'draft',angle:{x:45,y:0},status:'draft',responseExpressions:{[edge.id]:{nodes:{a:{x:basis(),y:constant(11)}},handles:{}}}}];
 return {w,graph,edge,field,responses};
}

test('registry validates explicit basis and fitted-parameter snapshot references in both programs',()=>{
 const {graph,edge}=fixture();
 for(const expression of [basis('missing'),fit('missing'),withSnapshotResponseSourceBaseline(constant(1),basis('missing')),withSnapshotResponseSourceBaseline(constant(1),fit('missing'))]){
  const responses={nodes:{a:{x:expression}},handles:{}};
  expect(()=>validateSnapshotResponseExpressionRegistry({[edge.id]:responses},graph.mesh)).toThrow(/missing real basis snapshot/);
  expect(snapshotResponseExpressionRegistryValidForMesh(responses,graph.mesh)).toBe(false);
 }
 expect(()=>validateSnapshotResponseExpressionRegistry(graph.responseExpressions,graph.mesh)).not.toThrow();
 expect(snapshotResponseExpressionRegistryValidForMesh({nodes:{a:{x:constant(1)}},handles:{}},graph.mesh)).toBe(true);
});

test('mesh retirement archives new scalar leaves even when their active edge survives',()=>{
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},{snapshotId:'C',angle:{x:0,y:90}}]);
 const graph=createSnapshotAngleGraph(mesh.vertices.map(vertex=>({snapshotId:vertex.snapshotId,angle:vertex.angle}))),nextMesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),edge=nextMesh.edges[0];
 graph.responseExpressions={[edge.id]:{nodes:{a:{x:withSnapshotResponseSourceBaseline(constant(0),fit('C')),y:basis('C')}},handles:{}}};
 const before=JSON.stringify(graph.responseExpressions),result=reconcileSnapshotAngleGraphMesh(graph,nextMesh,{id:'remove-C',reason:'mesh-change',message:'Removed C'});
 expect(result.ok).toBe(true);if(!result.ok)return;
 expect(result.graph.responseExpressions).toEqual({});expect(JSON.stringify(result.graph.orphanedResponses!.at(-1)!.responseExpressions)).toBe(before);expect(()=>validateSnapshotAngleGraph(result.graph)).not.toThrow();
});

test('source deletion archives basis, fit and material-domain dependencies and keeps constants',()=>{
 const {w,graph,edge,responses}=fixture(),before=JSON.stringify(graph.responseExpressions);delete w.library.curves.source;delete w.library.nodes.c;delete w.library.nodes.d;
 const result=pruneSnapshotResponseDependencies(w),next=result.recordings[0].angleGraph!,archive=next.orphanedResponses!.at(-1)!;
 expect(next.responseExpressions).toEqual({[edge.id]:{nodes:{a:{y:constant(7)}},handles:{}}});
 expect(archive.responseExpressions).toEqual({[edge.id]:{nodes:{a:{x:responses.nodes.a.x},b:responses.nodes.b},handles:responses.handles}});
 expect(next.correctionFrames![0].responseExpressions).toEqual({[edge.id]:{nodes:{a:{y:constant(11)}},handles:{}}});expect(archive.correctionFrames![0].responseExpressions![edge.id].nodes.a.x).toEqual(responses.nodes.a.x);
 expect(JSON.stringify(graph.responseExpressions)).toBe(before);expect(pruneSnapshotResponseDependencies(result)).toBe(result);expect(()=>validateSnapshotAngleGraph(next)).not.toThrow();
});

test('fit dependency pruning checks its real view even while the canonical source survives elsewhere',()=>{
 const {w,edge}=fixture(),layer=w.snapshots[1].layers[0];if(layer.kind==='original')layer.items=['keep'];
 const graph=pruneSnapshotResponseDependencies(w).recordings[0].angleGraph!;
 expect(w.library.curves.source).toBeDefined();expect(graph.responseExpressions![edge.id].nodes.b).toBeUndefined();expect(graph.responseExpressions![edge.id].handles.keep[1]).toEqual({});
});

test('membership loss archives new live leaves and material domains in their original support',()=>{
 const {w,edge,graph}=fixture(),before=captureSnapshotResponseMembership(w),layer=w.snapshots[1].layers[0];if(layer.kind==='original')layer.items=['keep'];
 const result=reconcileSnapshotMembershipResponses(w,before),next=result.workspace.recordings[0].angleGraph!;
 expect(next.responseExpressions).toEqual({[edge.id]:{nodes:{a:{y:constant(7)}},handles:{}}});
 expect(result.diagnostics).toHaveLength(5);expect(result.diagnostics.some(value=>value.message.includes('live fitted-parameter curve source'))).toBe(true);expect(result.diagnostics.some(value=>value.message.includes('live material-parameter curve source'))).toBe(true);
 expect(graph.responseExpressions![edge.id].nodes.b.x).toBeDefined();expect(w.library.curves.source).toBeDefined();expect(()=>validateSnapshotAngleGraph(next)).not.toThrow();
});
