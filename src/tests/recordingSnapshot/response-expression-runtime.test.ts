import {describe,expect,it} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {moveNode} from '../../domain/drawing/commands';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording,type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph,validateSnapshotAngleGraph,reconcileSnapshotAngleGraphMesh} from '../../domain/recordingSnapshot/angleGraph';
import {createSnapshotTriangulation,locateSnapshotSimplex,insertSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import {createSnapshotResponseResidual,restrictSnapshotResponseExpression,type SnapshotResponseExpression,type SnapshotResponseExpressionField} from '../../domain/recordingSnapshot/responseExpressions';
import {createSnapshotSurfaceValueSampler,prepareSnapshotSurfaceTargetEdit} from '../../domain/recordingSnapshot/surfaceTargets';
import {interpolateSnapshotSimplexGeometry} from '../../domain/recordingSnapshot/simplexGeometry';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

function fixture(){
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),edge=mesh.edges[0];
 const graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}},location=locateSnapshotSimplex(mesh,{x:45,y:0})!;
 const field:SnapshotResponseExpressionField={id:'original',vertexIds:edge.vertexIds,edges:[{from:0,to:1,knots:[[.5,0]]}],samples:[]};
 const expr=createSnapshotResponseResidual(field,edge.vertexIds.map(id=>[{coefficient:1,basis:{snapshotId:mesh.vertices.find(v=>v.id===id)!.snapshotId,target:{kind:'node',nodeId:'b'},axis:0}}]));
 graph.responseExpressions={[edge.id]:{nodes:{a:{x:expr}},handles:{}}};
 const drawing=(b:number):DrawingDocument=>({...emptyDrawing(),nodes:[{id:'a',position:[4,0]},{id:'b',position:[b,0]}],curves:[{id:'c',name:'Curve',nodes:['a','b'],handles:[[5,1],[b-1,1]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]});
 const bases=[{snapshotId:'A',drawing:drawing(0)},{snapshotId:'B',drawing:drawing(8)}];
 const sample=(g=graph,l=location,bs=bases)=>interpolateSnapshotSimplexGeometry(l.snapshotIds.map(id=>bs.find(b=>b.snapshotId===id)!),l.geometricWeights,createSnapshotSurfaceValueSampler(g,l,bs)).drawing;
 return {graph,mesh,edge,location,field,expr,bases,sample};
}
function workspace(){
 const f=fixture(),w=emptyRecordingSnapshotWorkspace();w.library.nodes=Object.fromEntries(f.bases[0].drawing.nodes.map(n=>[n.id,n]));w.library.curves=Object.fromEntries(f.bases[0].drawing.curves.map(c=>[c.id,c]));
 w.snapshots=['A','B'].map((id,index)=>{const s=emptyRecordingSnapshot(id,id,'view',{x:index*90,y:0});s.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['c']}];if(index)s.deformation.layers.layer={shape:{nodes:{b:[8,0]},handles:{}}};return s;});
 const r=emptySnapshotRecording('r');r.mode='triangulated';r.snapshotIds=['A','B'];r.activeSnapshotId='A';r.angleGraph=f.graph;w.recordings=[r];w.activeRecordingId='r';return {w,r,...f};
}
describe('Recorder live scalar expression integration',()=>{
 it('moves equal active node coordinates through a live inherited value residual',()=>{
  const f=fixture();expect(f.sample().nodes.find(n=>n.id==='a')!.position[0]).toBe(0);
  const changed=structuredClone(f.bases);changed[1].drawing.nodes.find(n=>n.id==='b')!.position[0]=12;
  expect(f.sample(f.graph,f.location,changed).nodes.find(n=>n.id==='a')!.position[0]).toBe(-2);
  for(const x of [0,90]){const l=locateSnapshotSimplex(f.mesh,{x,y:0})!;expect(f.sample(f.graph,l).nodes.find(n=>n.id==='a')!.position[0]).toBe(4);}
 });
 it('adds native correction to inherited residual and inverse replay preserves inherited provenance',()=>{
  const f=fixture();f.bases[1].drawing.nodes.find(n=>n.id==='a')!.position[0]=10;
  f.graph.edgeResponses[f.edge.id]={nodes:{a:{x:[[.5,.75]]}},handles:{}};
  const current=f.sample(),before=JSON.stringify(f.graph.responseExpressions);expect(current.nodes.find(n=>n.id==='a')!.position[0]).toBe(4.5);
  const wanted=moveNode(current,'a',[7,0],true),next=prepareSnapshotSurfaceTargetEdit(f.graph,f.location,f.bases,current,wanted,{angle:{x:45,y:0},frameId:'draft',allBases:f.bases});
  expect(f.sample(next.graph).nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(7,12);expect(JSON.stringify(next.graph.responseExpressions)).toBe(before);
  expect(f.sample({...next.graph,correctionFrames:[]}).nodes.find(n=>n.id==='a')!.position[0]).toBe(4.5);
 });
 it('runtime, full-curve onion, persistence and cache use the same scalar value path',()=>{
  const {w,r}=workspace(),at={angle:{x:45,y:0},immutableInputs:true} as const,current=evaluateRecordingSnapshot(w,'r',at);
  expect(current.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBe(0);
  const frames=interpolateSnapshotSurfaceOnion(r,current,{startSnapshotId:'A',endSnapshotId:'B'},5).frames,ghost=frames.find(frame=>frame.angle.x===45)!;
  expect(shapeOf(ghost.drawing!,'c')).toEqual(shapeOf(current.drawing,'c'));
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));expect(evaluateRecordingSnapshot(loaded,'r',at).drawing.nodes).toEqual(current.drawing.nodes);
  r.angleGraph={...r.angleGraph!,responseExpressions:{}};expect(evaluateRecordingSnapshot(w,'r',at).drawing.nodes.find(n=>n.id==='a')!.position[0]).toBe(4);
 });
 it('rejects unknown expression payload fields and missing live basis dependencies',()=>{
  const f=fixture();validateSnapshotAngleGraph(f.graph);const injected=structuredClone(f.graph) as any;injected.responseExpressions[f.edge.id].nodes.a.x.geometry={nodes:[]};expect(()=>validateSnapshotAngleGraph(injected)).toThrow();
  const missing=structuredClone(f.graph);missing.responseExpressions![f.edge.id].nodes.a.x!.terms[0].basis[0].basis.snapshotId='deleted';expect(()=>validateSnapshotAngleGraph(missing)).toThrow(/missing real basis/);
 });
});

describe('real view response restriction',()=>{
 it('creates a real 60 degree view without changing the existing corrected edge trajectory',async()=>{
  const {applySnapshotCommand}=await import('../../domain/recordingSnapshot/commands');
  const {w,r}=workspace(),angles=[0,5,15,30,45,59,60,61,75,89,90],before=angles.map(x=>evaluateRecordingSnapshot(w,'r',{angle:{x,y:0},useDraft:false}).drawing),library=JSON.stringify(w.library);
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0},name:'Real 60'});
  expect(r.snapshotIds).toHaveLength(3);expect(r.tracks).toEqual([]);expect(JSON.stringify(w.library)).toBe(library);expect(w.snapshots.at(-1)!.layers[0].kind).toBe('reference');
  for(let index=0;index<angles.length;index++){const actual=evaluateRecordingSnapshot(w,'r',{angle:{x:angles[index],y:0},useDraft:false}).drawing;for(const node of before[index].nodes)expect(actual.nodes.find(value=>value.id===node.id)!.position[0]).toBeCloseTo(node.position[0],10);for(const curve of before[index].curves)for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(actual.curves.find(value=>value.id===curve.id)!.handles[end][axis]).toBeCloseTo(curve.handles[end][axis],10);}
  const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));expect(evaluateRecordingSnapshot(reloaded,'r',{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBeCloseTo(before[4].nodes[0].position[0],10);
 });
 it('retains original triangle fields after insertion and cancels the remaining native edge extension exactly',async()=>{
  const {applySnapshotCommand}=await import('../../domain/recordingSnapshot/commands');
  const {w,r}=workspace(),third=structuredClone(w.snapshots[1]);third.id='C';third.angle={x:0,y:90};third.deformation.layers.layer.shape!.nodes.b=[-5,6];w.snapshots.push(third);r.snapshotIds.push('C');r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
  const graph=r.angleGraph,triangle=graph.mesh.triangles[0],edge=graph.mesh.edges[0];graph.edgeResponses[edge.id]={nodes:{a:{x:[[.3,-.2],[.7,1.4]]}},handles:{c:[{x:[[.4,.8]]},{}]}};graph.triangleResponses[triangle.id]={nodes:{b:{x:[{id:'p',at:[.2,.3,.5],weights:[.5,-.2,.7]}]}},handles:{}};
  const angles=[{x:10,y:10},{x:20,y:20},{x:30,y:20},{x:10,y:60},{x:60,y:5},{x:45,y:45},{x:0,y:45},{x:45,y:0}],before=angles.map(angle=>shapeOf(evaluateRecordingSnapshot(w,'r',{angle,useDraft:false}).drawing,'c'));
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:30,y:20}});
  expect(r.angleGraph!.mesh.triangles.some(value=>value.id===triangle.id)).toBe(false);
  expect(Object.values(r.angleGraph!.responseExpressions!).some(responses=>Object.values(responses.nodes).some(control=>(Object.values(control) as SnapshotResponseExpression[]).some(expression=>expression.fields.some(field=>field.vertexIds.every(id=>triangle.vertexIds.includes(id))))))).toBe(true);
  for(let i=0;i<angles.length;i++){const after=shapeOf(evaluateRecordingSnapshot(w,'r',{angle:angles[i],useDraft:false}).drawing,'c');for(let point=0;point<4;point++)for(let axis=0;axis<2;axis++)expect(after[point][axis]).toBeCloseTo(before[i][point][axis],9);}
 });
});

describe('expression dependency lifecycle',()=>{
 it('archives expressions when a live canonical basis control is deleted',async()=>{
  const {pruneSnapshotResponseDependencies}=await import('../../domain/recordingSnapshot/responseExpressionTransactions');
  const {w,r,edge}=workspace(),before=JSON.stringify(r.angleGraph!.responseExpressions);delete w.library.nodes.b;delete w.library.curves.c;
  const pruned=pruneSnapshotResponseDependencies(w),graph=pruned.recordings[0].angleGraph!;
  expect(graph.responseExpressions).toEqual({});expect(JSON.stringify(graph.orphanedResponses!.at(-1)!.responseExpressions)).toBe(before);expect(w.recordings[0].angleGraph!.responseExpressions![edge.id].nodes.a.x).toBeDefined();
 });
 it('prunes a missing real-basis member while the canonical source still exists',async()=>{
  const {pruneSnapshotResponseDependencies}=await import('../../domain/recordingSnapshot/responseExpressionTransactions');const {w}=workspace();w.snapshots[1].layers=[];expect(w.library.curves.c).toBeDefined();const next=pruneSnapshotResponseDependencies(w);expect(next.recordings[0].angleGraph!.responseExpressions).toEqual({});expect(next.recordings[0].angleGraph!.orphanedResponses!.at(-1)!.message).toMatch(/basis control was deleted/);
 });
 it('archives inherited fields whose original real support was deleted even if their active simplex remains',()=>{
  const f=fixture(),mesh=insertSnapshotVertex(f.mesh,{snapshotId:'C',angle:{x:60,y:0}}),owner=mesh.edges.find(edge=>edge.vertexIds.includes(mesh.vertices.find(v=>v.snapshotId==='B')!.id))!;
  const graph={...f.graph,mesh,responseExpressions:{[owner.id]:{nodes:{a:{x:f.expr}},handles:{}}}},removed={...mesh,vertices:mesh.vertices.filter(v=>v.snapshotId!=='A'),edges:mesh.edges.filter(edge=>edge.id===owner.id)};
  const result=reconcileSnapshotAngleGraphMesh(graph,removed,{id:'archive',reason:'deleted-view',message:'Deleted A'});expect(result.ok).toBe(true);if(result.ok){expect(result.graph.responseExpressions).toEqual({});expect(result.graph.orphanedResponses!.at(-1)!.responseExpressions![owner.id].nodes.a.x).toEqual(f.expr);}
 });
 it('saves and discards expression draft overlays through the existing correction transaction',async()=>{
  const {applySnapshotCommand}=await import('../../domain/recordingSnapshot/commands');
  const {w,r,edge}=workspace();r.angle={x:45,y:0};const original=r.angleGraph!.responseExpressions!;
  r.angleGraph!.correctionFrames=[{id:'draft',angle:r.angle,status:'draft',responseExpressions:{[edge.id]:{nodes:{},handles:{}}}}];
  expect(evaluateRecordingSnapshot(w,'r').drawing.nodes[0].position[0]).toBe(4);
  applySnapshotCommand(w,{op:'discardEndpointCorrection'});expect(r.angleGraph!.responseExpressions).toBe(original);expect(evaluateRecordingSnapshot(w,'r').drawing.nodes[0].position[0]).toBe(0);
  r.angleGraph!.correctionFrames=[{id:'draft2',angle:r.angle,status:'draft',responseExpressions:{[edge.id]:{nodes:{},handles:{}}}}];applySnapshotCommand(w,{op:'updateEndpointCorrection'});
  expect(r.angleGraph!.correctionFrames).toMatchObject([{status:'saved'}]);expect(evaluateRecordingSnapshot(w,'r',{useDraft:false}).drawing.nodes[0].position[0]).toBe(4);
 });
});

it('preserves the real source split → real 60 → second insertion → child correction chain',async()=>{
 const {createEmptyProject}=await import('../../app/emptyProject'),{prepareSnapshotEdit,snapshotEditContext}=await import('../../app/snapshotEditTransaction'),{createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent}=await import('../../domain/drawing/layerEditIntent'),{ensureRecordingSnapshots}=await import('../../domain/recordingSnapshot/migration'),{canonicalElementId,drawingSnapshotForArtwork}=await import('../../domain/recordingSnapshot/sources'),{applySnapshotCommand}=await import('../../domain/recordingSnapshot/commands');
 const original=fixture().bases[0].drawing,project=ensureRecordingSnapshots({...createEmptyProject(),drawing:original}),w=project.recordingSnapshots,source=drawingSnapshotForArtwork(w,'$working')!,id=(value:string)=>canonicalElementId('$working',value),front=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
 front.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:id('layer')}];side.layers=structuredClone(front.layers);side.deformation.layers.slot={shape:{nodes:{[id('a')]:[3,2],[id('b')]:[8,-1]},handles:{[id('c')]:[[1,2],[-2,1]]}}};
 const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['front','side'];r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph([front,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));const edge=r.angleGraph.mesh.edges[0];r.angleGraph.edgeResponses[edge.id]={nodes:{[id('a')]:{x:[[.3,.8]],y:[[.5,-.2]]}},handles:{[id('c')]:[{x:[[.7,.2]]},{y:[[.4,1.3]]}]}};w.snapshots.push(front,side);w.recordings=[r];w.activeRecordingId=r.id;
 let n=0;const intent=createCurveSplitIntent(original,'c',.37,{allocateId:()=>`split-${++n}`}),canonical=mapCurveSplitIntent(intent,id),split=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(original,intent).document,intent}).project.recordingSnapshots!;
 const angles=[0,15,30,45,59,60,61,75,90],before=angles.map(x=>evaluateRecordingSnapshot(split,'recording',{angle:{x,y:0},useDraft:false}).drawing),library=JSON.stringify(split.library);
 applySnapshotCommand(split,{op:'createSnapshot',angle:{x:60,y:0}});applySnapshotCommand(split,{op:'createSnapshot',angle:{x:30,y:0}});
 expect(JSON.stringify(split.library)).toBe(library);
 for(let i=0;i<angles.length;i++){const drawing=evaluateRecordingSnapshot(split,'recording',{angle:{x:angles[i],y:0},useDraft:false}).drawing;for(const curveId of canonical.childCurveIds){const actual=shapeOf(drawing,curveId),wanted=shapeOf(before[i],curveId);for(let p=0;p<4;p++)for(let axis=0;axis<2;axis++)expect(actual[p][axis]).toBeCloseTo(wanted[p][axis],9);}}
 applySnapshotCommand(split,{op:'setAngle',angle:{x:45,y:0}});const current=evaluateRecordingSnapshot(split,'recording'),seam=current.drawing.nodes.find(node=>node.id===canonical.seamNodeId)!;
 applySnapshotCommand(split,{op:'moveShapeNode',layerId:'slot',nodeId:seam.id,position:[seam.position[0]+.1,seam.position[1]+.1]});applySnapshotCommand(split,{op:'updateEndpointCorrection'});
 const replay=evaluateRecordingSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(split))),'recording');expect(replay.drawing.nodes.find(node=>node.id===seam.id)!.position[0]).toBeCloseTo(seam.position[0]+.1,9);
});

it('rejects a nonlinear draft overlay even when the saved SMOOTH surface is linear',async()=>{
 const {transferSnapshotSplitResponses}=await import('../../domain/recordingSnapshot/responseExpressionTransactions');const {w,r,edge}=workspace();delete r.angleGraph!.responseExpressions;
 w.library.nodes.e={id:'e',position:[10,0]};w.library.curves.d={...w.library.curves.c,id:'d',nodes:['b','e'],handles:[[1,-1],[9,1]]};
 for(const snapshot of w.snapshots){if(snapshot.layers[0].kind==='original')snapshot.layers[0].items.push('d');snapshot.relations.joins={add:[{id:'smooth',mode:'SMOOTH',a:{curveId:'c',end:1},b:{curveId:'d',end:0}}]};}
 w.snapshots[1].deformation.layers.layer.shape!.handles={c:[[0,0],[-1,0]],d:[[1,0],[0,0]]};
 r.angleGraph!.correctionFrames=[{id:'nonlinear-draft',angle:{x:45,y:0},status:'draft',edgeResponses:{[edge.id]:{nodes:{},handles:{c:[{},{x:[[.5,.2]]}]}}}}];
 const before=JSON.stringify(w),intent={kind:'split-curve' as const,curveId:'c',sourceLayerId:'layer',sourceNodeIds:['a','b'] as const,t:.37,childCurveIds:['left','right'] as const,seamNodeId:'seam',seamJoinId:'seam-join',intervals:[]};
 expect(()=>transferSnapshotSplitResponses(w,w,intent)).toThrow(/Draft nonlinear-draft.*SMOOTH/);expect(JSON.stringify(w)).toBe(before);
});
