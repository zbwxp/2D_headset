import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {applyCurveSplitIntent,type CurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {interpolateSnapshotSimplexGeometry,type SnapshotSimplexBasis} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceValueSampler} from '../../domain/recordingSnapshot/surfaceTargets';
import {certifySnapshotSmoothResponseIdentity,createSnapshotResponseExpressionCapture,remapSnapshotSplitResponses} from '../../domain/recordingSnapshot/responseExpressionSplit';
import {createSnapshotResponseResidual,SnapshotResponseExpressionError} from '../../domain/recordingSnapshot/responseExpressions';

const shapes:Cubic[]=[[[0,0],[5,3],[7,-3],[12,0]],[[4,2],[-2,7],[15,8],[8,1]],[[-4,5],[8,10],[-1,-6],[15,-3]]];
const intent:CurveSplitIntent={kind:'split-curve',curveId:'parent',sourceLayerId:'layer',sourceNodeIds:['start','end'],t:.37,childCurveIds:['left','right'],seamNodeId:'seam',seamJoinId:'seam-join',intervals:[]};
const options={nonlinearDependencies:[]};
function document(shape:Cubic):DrawingDocument{return {...emptyDrawing(),nodes:[{id:'start',position:shape[0]},{id:'end',position:shape[3]}],curves:[{id:'parent',name:'Curve',nodes:['start','end'],handles:[shape[1],shape[2]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['parent']}]};}
function fixture(triangle=true):{graph:SnapshotAngleGraph;bases:SnapshotSimplexBasis[]}{
 const all=[{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},{snapshotId:'C',angle:{x:0,y:90}}],inputs=triangle?all:all.slice(0,2),mesh=createSnapshotTriangulation(inputs),graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 mesh.edges.forEach((edge,index)=>{graph.edgeResponses[edge.id]={nodes:{start:{x:[[.25,.7],[.6,-.2]],y:[[.4,.1+index*.1]]},end:{y:[[.3,.9]]},untouched:{x:[[.5,.3]]}},handles:{parent:[{x:[[.3,1.2]],y:[[.4,-.2]]},{x:[[.6,.1]],y:[[.7,1.3]]}],unrelated:[{x:[[.2,.8]]},{}]}};});
 if(triangle)graph.triangleResponses[mesh.triangles[0].id]={nodes:{start:{x:[{id:'node-x',at:[.2,.3,.5],weights:[.5,-.3,.8]}]}},handles:{parent:[{x:[{id:'left-x',at:[.3,.2,.5],weights:[1,-.4,.4]}]},{y:[{id:'right-y',at:[.4,.3,.3],weights:[-.2,.5,.7]}]}]}};
 return {graph,bases:inputs.map((input,index)=>({...input,drawing:document(shapes[index])}))};
}
const splitBases=(bases:SnapshotSimplexBasis[],plan=intent)=>bases.map(basis=>({...basis,drawing:applyCurveSplitIntent(basis.drawing,plan,{propagate:true}).document}));
function evaluate(graph:SnapshotAngleGraph,bases:SnapshotSimplexBasis[],angle:{x:number;y:number}){
 const location=locateSnapshotSimplex(graph.mesh,angle)!;
 const active=location.snapshotIds.map(snapshotId=>bases.find(basis=>basis.snapshotId===snapshotId)!);
 return interpolateSnapshotSimplexGeometry(active,location.geometricWeights,createSnapshotSurfaceValueSampler(graph,location,bases)).drawing;
}
function compareCurves(actual:DrawingDocument,expected:DrawingDocument,curveIds:readonly string[]){for(const curveId of curveIds){const a=shapeOf(actual,curveId),b=shapeOf(expected,curveId);a.forEach((point,index)=>point.forEach((value,axis)=>expect(value).toBeCloseTo(b[index][axis],9)));}}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

describe('Recorder graph response split transfer',()=>{
 it.each([false,true])('preserves the complete parent curve trajectory with independent native fields; triangle=%s',triangle=>{
  const {graph,bases}=fixture(triangle),before=JSON.stringify({graph,bases}),children=splitBases(bases),next=remapSnapshotSplitResponses(freeze(graph),intent,options);
  const angles=[{x:0,y:0},{x:22.5,y:0},{x:36,y:0},{x:54,y:0},{x:89,y:0},{x:90,y:0},...(triangle?[{x:0,y:30},{x:15,y:20},{x:27,y:18},{x:36,y:27},{x:20,y:65},{x:0,y:90}]:[])];
  for(const angle of angles){const expected=applyCurveSplitIntent(evaluate(graph,bases,angle),intent,{propagate:true}).document;compareCurves(evaluate(next,children,angle),expected,intent.childCurveIds);}
  expect(JSON.stringify({graph,bases})).toBe(before);expect(next.mesh).toBe(graph.mesh);
  for(const edge of graph.mesh.edges){expect(next.edgeResponses[edge.id].nodes).toBe(graph.edgeResponses[edge.id].nodes);expect(next.edgeResponses[edge.id].handles.unrelated).toBe(graph.edgeResponses[edge.id].handles.unrelated);expect(next.edgeResponses[edge.id].handles.parent).toBeUndefined();}
  for(const responses of Object.values(next.responseExpressions??{}))expect(responses.handles.parent).toBeUndefined();
 });

 it('preserves saved and draft trajectories separately, including draft edge influence in adjacent triangles',()=>{
  const {graph,bases}=fixture(),edge=graph.mesh.edges.find(edge=>edge.vertexIds.every(id=>graph.mesh.vertices.find(vertex=>vertex.id===id)!.angle.y===0))!;
  graph.correctionFrames=[{id:'draft',status:'draft',angle:{x:30,y:0},edgeResponses:{[edge.id]:{nodes:{start:{x:[[.3,-1.2]],y:[[.4,.9]]},end:{y:[[.5,.2]]}},handles:{parent:[{x:[[.4,-.6]],y:[[.3,1.2]]},{x:[[.7,1.5]]}]}}}}];
  const before=JSON.stringify(graph),children=splitBases(bases),next=remapSnapshotSplitResponses(freeze(graph),intent,options),triangle=graph.mesh.triangles[0];
  expect(next.correctionFrames?.[0].responseExpressions?.[triangle.id]).toBeDefined();
  for(const useDraft of [false,true])for(const angle of [{x:30,y:0},{x:25,y:25},{x:4,y:80}]){
   const old=useDraft?graph:{...graph,correctionFrames:[]},after=useDraft?next:{...next,correctionFrames:[]};
   compareCurves(evaluate(after,children,angle),applyCurveSplitIntent(evaluate(old,bases,angle),intent,{propagate:true}).document,intent.childCurveIds);
  }
  expect(JSON.stringify(graph)).toBe(before);expect(next.correctionFrames?.[0].id).toBe('draft');expect(next.correctionFrames?.[0].status).toBe('draft');
 });

 it('retains an explicitly cleared native draft as an empty expression override instead of resurrecting saved motion',()=>{
  const {graph,bases}=fixture(false),edge=graph.mesh.edges[0];
  graph.edgeResponses[edge.id]={nodes:{},handles:{parent:[{x:[[.5,1.5]]},{}]}};
  graph.correctionFrames=[{id:'clear',status:'draft',angle:{x:45,y:0},edgeResponses:{[edge.id]:{nodes:{},handles:{}}}}];
  const next=remapSnapshotSplitResponses(graph,intent,options),children=splitBases(bases);
  expect(next.responseExpressions?.[edge.id].handles.left).toBeDefined();
  expect(next.correctionFrames?.[0].responseExpressions?.[edge.id]).toEqual({nodes:{},handles:{}});
  for(const angle of [{x:25,y:0},{x:45,y:0},{x:70,y:0}])compareCurves(evaluate(next,children,angle),applyCurveSplitIntent(evaluate(graph,bases,angle),intent,{propagate:true}).document,intent.childCurveIds);
 });

 it('combines inherited expressions with new native corrections and globally substitutes retired sibling dependencies on repeated splits',()=>{
  const {graph,bases}=fixture(),first=remapSnapshotSplitResponses(graph,intent,options),firstBases=splitBases(bases),edge=graph.mesh.edges[0];
  first.edgeResponses[edge.id]={...first.edgeResponses[edge.id],handles:{...first.edgeResponses[edge.id].handles,left:[{x:[[.35,.8]]},{}]}};
  const second:CurveSplitIntent={...intent,curveId:'left',sourceNodeIds:['start','seam'],t:.43,childCurveIds:['left-left','left-right'],seamNodeId:'second-seam',seamJoinId:'second-join'};
  const next=remapSnapshotSplitResponses(freeze(first),second,options),nextBases=splitBases(firstBases,second);
  for(const angle of [{x:15,y:0},{x:40,y:0},{x:20,y:25},{x:35,y:40}])compareCurves(evaluate(next,nextBases,angle),applyCurveSplitIntent(evaluate(first,firstBases,angle),second,{propagate:true}).document,['left-left','left-right','right']);
  for(const responses of Object.values(next.responseExpressions??{}))for(const response of [...Object.values(responses.nodes),...Object.values(responses.handles).flat()])for(const expression of Object.values(response))for(const term of expression.terms)for(const {basis} of term.basis)expect(basis.target.kind!=='handle'||!['parent','left'].includes(basis.target.curveId)).toBe(true);
 });

 it('keeps response meaning live after endpoint source edits and retains unrelated properties and recovery archives',()=>{
  const {graph,bases}=fixture(),archive={id:'archive',reason:'mesh-change' as const,message:'prior frame',mesh:graph.mesh,edgeResponses:{},triangleResponses:{}};
  graph.orphanedResponses=[archive];graph.propertyResponses={edges:{},triangles:{}};
  const next=remapSnapshotSplitResponses(graph,intent,options),changed=bases.map((basis,index)=>({...basis,drawing:document(shapes[index].map(([x,y],control)=>[x+(control+1)*(index+1),y-(control-2)*2]) as Cubic)})),children=splitBases(changed);
  for(const angle of [{x:35,y:0},{x:20,y:30}])compareCurves(evaluate(next,children,angle),applyCurveSplitIntent(evaluate(graph,changed,angle),intent,{propagate:true}).document,intent.childCurveIds);
  expect(next.orphanedResponses).toBe(graph.orphanedResponses);expect(next.orphanedResponses?.[0]).toBe(archive);expect(next.propertyResponses).toBe(graph.propertyResponses);
 });

 it('diagnoses nonlinear dependencies and dormant new-ID response collisions without mutating source state',()=>{
  const {graph}=fixture(),before=JSON.stringify(graph);
  expect(()=>remapSnapshotSplitResponses(freeze(graph),intent,{nonlinearDependencies:['smooth-driver']})).toThrow(SnapshotResponseExpressionError);expect(JSON.stringify(graph)).toBe(before);
  const collision=structuredClone(graph);collision.edgeResponses[graph.mesh.edges[0].id].handles.left=[{x:[[.5,.8]]},{}];
  const collisionBefore=JSON.stringify(collision);expect(()=>remapSnapshotSplitResponses(freeze(collision),intent,options)).toThrow(/already exists/);expect(JSON.stringify(collision)).toBe(collisionBefore);
 });
});

describe('algebraic SMOOTH identity certificate',()=>{
 const vector=(drawing:DrawingDocument,end:Endpoint):Point2=>{const curve=drawing.curves.find(curve=>curve.id===end.curveId)!,node=drawing.nodes.find(node=>node.id===curve.nodes[end.end])!;return [curve.handles[end.end][0]-node.position[0],curve.handles[end.end][1]-node.position[1]];};
 const prove=(graph:SnapshotAngleGraph,bases:SnapshotSimplexBasis[],a:Endpoint,b:Endpoint)=>certifySnapshotSmoothResponseIdentity(bases.map(basis=>({a:vector(basis.drawing,a),b:vector(basis.drawing,b)})),Object.values(graph.responseExpressions??{}).map(responses=>({a:responses.handles[a.curveId]?.[a.end]??{},b:responses.handles[b.curveId]?.[b.end]??{}})));

 it('certifies the new de Casteljau seam from coefficients and real bases without sampling an angle',()=>{
  const {graph,bases}=fixture(),next=remapSnapshotSplitResponses(graph,intent,options),children=splitBases(bases);
  const result=prove(next,children,{curveId:'left',end:1},{curveId:'right',end:0});
  expect(result.available).toBe(true);if(result.available)expect(result.ratio).toBeCloseTo(intent.t/(1-intent.t),13);
 });

 it('certifies both propagated seams after another split',()=>{
  const {graph,bases}=fixture(),first=remapSnapshotSplitResponses(graph,intent,options),firstBases=splitBases(bases);
  const second:CurveSplitIntent={...intent,curveId:'left',sourceNodeIds:['start','seam'],t:.43,childCurveIds:['left-left','left-right'],seamNodeId:'second-seam',seamJoinId:'second-join'};
  const next=remapSnapshotSplitResponses(first,second,options),children=splitBases(firstBases,second);
  const joins=children[0].drawing.joins.filter(join=>join.mode==='SMOOTH');expect(joins).toHaveLength(2);
  for(const join of joins)expect(prove(next,children,join.a,join.b).available).toBe(true);
 });

 it('rejects an independent correction or a changed real-basis direction instead of inferring a nonlinear identity',()=>{
  const {graph,bases}=fixture(),next=remapSnapshotSplitResponses(graph,intent,options),children=splitBases(bases),a:Endpoint={curveId:'left',end:1},b:Endpoint={curveId:'right',end:0};
  const changed=structuredClone(children);changed[0].drawing.curves.find(curve=>curve.id==='left')!.handles[1][1]+=.001;
  expect(prove(next,changed,a,b).available).toBe(false);
  const edge=graph.mesh.edges[0];next.edgeResponses[edge.id]={...next.edgeResponses[edge.id],handles:{...next.edgeResponses[edge.id].handles,left:[{},{x:[[.5,.8]]}]}};
  const location=locateSnapshotSimplex(graph.mesh,{x:20,y:30})!,capture=createSnapshotResponseExpressionCapture(graph.mesh,next,'proof-independent');
  const response=(endpoint:Endpoint)=>({x:capture(location,{kind:'handle',...endpoint},0),y:capture(location,{kind:'handle',...endpoint},1)});
  expect(certifySnapshotSmoothResponseIdentity(children.map(basis=>({a:vector(basis.drawing,a),b:vector(basis.drawing,b)})),[{a:response(a),b:response(b)}]).available).toBe(false);
 });

 it('has no absolute tolerance that turns tiny incompatible vectors into a valid identity',()=>{
  expect(certifySnapshotSmoothResponseIdentity([{a:[1e-100,2e-100],b:[-1e-100,-3e-100]}],[]).available).toBe(false);
  expect(certifySnapshotSmoothResponseIdentity([{a:[0,0],b:[0,0]}],[])).toEqual({available:true,ratio:1});
  expect(certifySnapshotSmoothResponseIdentity([],[]).available).toBe(false);
 });

 it('certifies the bundled face SMOOTH controls using actual H-P subtraction evidence',()=>{
  const drawing=parseDrawing(JSON.parse(readFileSync(new URL('../../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8')));
  const relations=[...drawing.joins.filter(join=>join.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')];
  const magnitude=(endpoint:Endpoint):Point2=>{const curve=drawing.curves.find(curve=>curve.id===endpoint.curveId)!,node=drawing.nodes.find(node=>node.id===curve.nodes[endpoint.end])!;return [Math.abs(curve.handles[endpoint.end][0])+Math.abs(node.position[0]),Math.abs(curve.handles[endpoint.end][1])+Math.abs(node.position[1])];};
  const regression=relations.find(relation=>relation.id==='84cf909e-be46-400f-a7ce-a2b16c9f3c26')!;
  expect(regression).toBeDefined();
  const a=vector(drawing,regression.a),b=vector(drawing,regression.b),ratio=-a[1]/b[1];
  expect(Math.abs(a[0]+ratio*b[0])/Math.max(Math.abs(a[0]),Math.abs(ratio*b[0]))).toBeGreaterThan(256*Number.EPSILON);
  expect(relations).toHaveLength(52);
  for(const relation of relations){
   const pair={a:vector(drawing,relation.a),b:vector(drawing,relation.b),aSubtractionScale:magnitude(relation.a),bSubtractionScale:magnitude(relation.b)};
   const result=certifySnapshotSmoothResponseIdentity([pair,pair],[]);
   expect(result.available,`${relation.id}: ${result.available?'':result.reason}`).toBe(true);
  }
 });

 it('keeps source arithmetic bounds separate from tiny-vector geometry and symbolic response coefficients',()=>{
  expect(certifySnapshotSmoothResponseIdentity([{a:[1e-100,2e-100],b:[-1e-100,-3e-100],aSubtractionScale:[1e-100,2e-100],bSubtractionScale:[1e-100,3e-100]}],[]).available).toBe(false);
  expect(certifySnapshotSmoothResponseIdentity([{a:[1,.2],b:[-1,-.20001],aSubtractionScale:[2,2],bSubtractionScale:[2,2]}],[]).available).toBe(false);
  const expression=createSnapshotResponseResidual({id:'independent',vertexIds:['a','b'],edges:[{from:0,to:1,knots:[[.5,.8]]}],samples:[]},['A','B'].map(snapshotId=>[{coefficient:1,basis:{snapshotId,target:{kind:'node',nodeId:'n'},axis:0}}]));
  const result=certifySnapshotSmoothResponseIdentity([{a:[1,0],b:[-1,0],aSubtractionScale:[1e15,1e15],bSubtractionScale:[1e15,1e15]}],[{a:{x:expression},b:{}}]);
  expect(result.available).toBe(false);if(!result.available)expect(result.reason).toContain('response simplex');
 });

 it('rejects invalid subtraction evidence and a ratio that cannot be resolved above that arithmetic bound',()=>{
  for(const aSubtractionScale of [[-1,1],[Infinity,1],[NaN,1]] as Point2[])expect(certifySnapshotSmoothResponseIdentity([{a:[1,0],b:[-1,0],aSubtractionScale}],[]).available).toBe(false);
  expect(certifySnapshotSmoothResponseIdentity([{a:[1e-20,0],b:[-1e-20,0],aSubtractionScale:[1,1],bSubtractionScale:[1,1]}],[]).available).toBe(false);
 });
});
