import {describe,expect,it} from 'vitest';
import {add,sub,length,emptyDrawing,shapeOf,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {applyCurveSplitIntent,type CurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {moveNode} from '../../domain/drawing/commands';
import {endpointPairNodeAuthorities} from '../../domain/recordingSnapshot/endpointPair';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {interpolateSnapshotSimplexGeometry,type SnapshotSimplexBasis} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceValueSampler,prepareSnapshotSurfaceTargetEdit} from '../../domain/recordingSnapshot/surfaceTargets';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {remapSnapshotSplitResponses} from '../../domain/recordingSnapshot/responseExpressionSplit';
import {snapshotResponseExpressionTerms,prepareSnapshotResponseExpression,validateSnapshotResponseExpression,snapshotResponseExpressionLimits,type SnapshotResponseExpression} from '../../domain/recordingSnapshot/responseExpressions';
import {validateSnapshotResponseExpressionRegistry,createSnapshotResponseBasisResolver,createSnapshotResponseFieldWeightMapper} from '../../domain/recordingSnapshot/responseExpressionRegistry';
import {deriveSmoothComponents,projectSmoothComponent,projectSmoothComponentCorrection,type SmoothComponentInput} from '../../domain/recordingSnapshot/smoothComponent';

const intent:CurveSplitIntent={kind:'split-curve',curveId:'follower',sourceLayerId:'layer',sourceNodeIds:['z-joint','end'],t:.5,childCurveIds:['left','right'],seamNodeId:'seam',seamJoinId:'seam-join',intervals:[]};
const driver:Endpoint={curveId:'driver',end:1},follower:Endpoint={curveId:'follower',end:0};
function fixture(native=false,tiny=false):{graph:SnapshotAngleGraph;bases:SnapshotSimplexBasis[]}{
 const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
 const bases=[0,1].map(index=>{
  const joint:Point2=tiny?[0,0]:[index*2,index],end:Point2=[4+index*3,1+index*2],scale=tiny?1e-16:1;
  const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'start',position:[-3+index,index]},{id:'a-joint',position:joint},{id:'z-joint',position:[...joint]},{id:'end',position:end}],
   curves:[{id:'driver',name:'Driver',nodes:['start','a-joint'],handles:[[-2+index,.5+index],add(joint,index?[0,scale]:[scale,0])],visible:true,locked:false,width:.01},{id:'follower',name:'Follower',nodes:['z-joint','end'],handles:[add(joint,index?[0,-4]:[-2,0]),add(end,[-1,.4])],visible:true,locked:false,width:.01}],
   endpointLinks:[{id:'smooth',a:driver,b:follower,joinBrush:{kind:'SMOOTH'}}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['driver','follower']}]};
  return {snapshotId:index?'B':'A',drawing};
 });
 if(native)graph.edgeResponses[mesh.edges[0].id]={nodes:{'a-joint':{x:[[.3,.8]],y:[[.7,-.2]]},'z-joint':{x:[[.4,-3]],y:[[.6,4]]},end:{y:[[.45,.7]]}},handles:{driver:[{x:[[.3,.1]]},{x:[[.25,.7]],y:[[.65,.2]]}],follower:[{x:[[.4,.1]],y:[[.6,1.3]]},{x:[[.7,-.2]],y:[[.2,.9]]}]}};
 return {graph,bases};
}
function components(drawing:DrawingDocument){
 const authorities=endpointPairNodeAuthorities(drawing),curves=new Map(drawing.curves.map(curve=>[curve.id,curve]));
 return deriveSmoothComponents([...drawing.joins.filter(join=>join.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')]).map(component=>({component,nodeIds:component.members.map(({endpoint})=>authorities.get(curves.get(endpoint.curveId)!.nodes[endpoint.end])!)}));
}
function remap(graph:SnapshotAngleGraph,bases:SnapshotSimplexBasis[],plan=intent){
 const original=bases[0].drawing,authorities=endpointPairNodeAuthorities(original);
 return remapSnapshotSplitResponses(graph,plan,{nonlinearDependencies:['smooth'],smoothComponents:()=>components(original),nodeAuthority:nodeId=>authorities.get(nodeId)??nodeId});
}
const split=(drawing:DrawingDocument,plan=intent)=>applyCurveSplitIntent(drawing,plan,{propagate:true}).document;
const splitBases=(bases:SnapshotSimplexBasis[],plan=intent)=>bases.map(basis=>({...basis,drawing:split(basis.drawing,plan)}));
function sample(graph:SnapshotAngleGraph,bases:SnapshotSimplexBasis[],x:number,y=0){
 const location=locateSnapshotSimplex(graph.mesh,{x,y})!,active=location.snapshotIds.map(id=>bases.find(basis=>basis.snapshotId===id)!);
 return interpolateSnapshotSimplexGeometry(active,location.geometricWeights,createSnapshotSurfaceValueSampler(graph,location,bases));
}
function compare(actual:DrawingDocument,expected:DrawingDocument,precision=10){
 expect(actual.nodes.map(node=>node.id).sort()).toEqual(expected.nodes.map(node=>node.id).sort());
 for(const node of expected.nodes)node.position.forEach((value,axis)=>expect(actual.nodes.find(other=>other.id===node.id)!.position[axis],`node ${node.id}/${axis}`).toBeCloseTo(value,precision));
 expect(actual.curves.map(curve=>curve.id).sort()).toEqual(expected.curves.map(curve=>curve.id).sort());
 for(const curve of expected.curves){const actualShape=shapeOf(actual,curve.id),expectedShape=shapeOf(expected,curve.id);expectedShape.forEach((point,index)=>point.forEach((value,axis)=>expect(actualShape[index][axis],`${curve.id}/${index}/${axis}`).toBeCloseTo(value,precision)));}
}
function input(drawing:DrawingDocument,endpoint:Endpoint):SmoothComponentInput {
 const curve=drawing.curves.find(curve=>curve.id===endpoint.curveId)!,node=drawing.nodes.find(node=>node.id===curve.nodes[endpoint.end])!.position;
 return {node,vector:sub(curve.handles[endpoint.end],node)};
}

describe('Recorder original SMOOTH projection split composition',()=>{
 it('places the minimal nonlinear seam at the projected-then-split coordinate',()=>{
  const {graph,bases}=fixture();
  for(const [index,basis] of bases.entries()){
   for(const id of ['a-joint','z-joint'])basis.drawing.nodes.find(node=>node.id===id)!.position=[0,0];
   basis.drawing.nodes.find(node=>node.id==='end')!.position=[4,0];
   basis.drawing.curves.find(curve=>curve.id==='driver')!.handles[1]=index?[0,1]:[1,0];
   basis.drawing.curves.find(curve=>curve.id==='follower')!.handles=[index?[0,-4]:[-2,0],[3,1]];
  }
  const children=splitBases(bases),next=remap(graph,bases),seam=(drawing:DrawingDocument)=>drawing.nodes.find(node=>node.id==='seam')!.position,actual=seam(sample(next,children,45).drawing),wrong=seam(sample(graph,children,45).drawing);
  expect(actual[0]).toBeCloseTo(1.0320729387184288,14);expect(actual[1]).toBeCloseTo(-.21792706128157107,14);
  expect(wrong).toEqual([1.25,-.375]);seam(split(sample(graph,bases,45).drawing)).forEach((value,axis)=>expect(value).toBeCloseTo(actual[axis],14));
 });

 it('projects the complete nonlinear component before splitting its dependent curve',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),before=sample(graph,bases,45).drawing,expected=split(before),actual=sample(next,children,45).drawing;
  const vector=(input(before,follower) as {vector:Point2}).vector;
  expect(vector[0]).toBeCloseTo(-Math.sqrt(2.5),13);expect(vector[1]).toBeCloseTo(-Math.sqrt(2.5),13);
  compare(actual,expected);
  const wrong=sample({...graph,responseExpressions:{}},children,45).drawing;
  expect(length(sub(actual.nodes.find(node=>node.id==='seam')!.position,wrong.nodes.find(node=>node.id==='seam')!.position))).toBeGreaterThan(.1);
  for(const angle of [0,1,12,27,44,45,63,89,90])compare(sample(next,children,angle).drawing,split(sample(graph,bases,angle).drawing));
 });

 it('retains independent X/Y native fields and original linked-node authority',()=>{
  const {graph,bases}=fixture(true),before=JSON.stringify({graph,bases}),next=remap(graph,bases),children=splitBases(bases);
  for(const angle of [0,9,22.5,27,36,45,54,58.5,63,81,90])compare(sample(next,children,angle).drawing,split(sample(graph,bases,angle).drawing));
  expect(JSON.stringify({graph,bases})).toBe(before);
  let projections=0;
  for(const response of Object.values(next.responseExpressions!))for(const control of [...Object.values(response.nodes),...Object.values(response.handles).flat()])for(const expression of Object.values(control) as SnapshotResponseExpression[]){
   projections+=expression.operations?.filter(operation=>operation.kind==='smooth').length??0;
   for(const term of snapshotResponseExpressionTerms(expression))for(const {basis} of term.basis)if(basis.target.kind==='node')expect(basis.target.nodeId).not.toBe('z-joint');
  }
  expect(projections).toBeGreaterThan(0);
 });

 it('preserves nonlinear triangle and edge fields through saved/draft split composition and JSON',()=>{
  const {bases}=fixture(),third=structuredClone(bases[0].drawing),joint:Point2=[-1,3],end:Point2=[2,6];
  third.nodes.find(node=>node.id==='start')!.position=[-5,3];for(const id of ['a-joint','z-joint'])third.nodes.find(node=>node.id===id)!.position=[...joint];third.nodes.find(node=>node.id==='end')!.position=end;
  third.curves.find(curve=>curve.id==='driver')!.handles=[[-4,3.5],add(joint,[-1,2])];third.curves.find(curve=>curve.id==='follower')!.handles=[add(joint,[1.5,-3]),add(end,[-.3,.7])];bases.push({snapshotId:'C',drawing:third});
  const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},{snapshotId:'C',angle:{x:0,y:90}}]),triangle=mesh.triangles[0],edge=mesh.edges.find(edge=>edge.vertexIds.every(id=>mesh.vertices.find(vertex=>vertex.id===id)!.angle.y===0))!,graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}};
  graph.edgeResponses[edge.id]={nodes:{'a-joint':{x:[[.4,.7]]}},handles:{driver:[{},{x:[[.3,-.2]]}],follower:[{y:[[.6,1.2]]},{}]}};
  graph.triangleResponses[triangle.id]={nodes:{'a-joint':{x:[{id:'joint-x',at:[.2,.3,.5],weights:[.6,-.1,.5]}],y:[{id:'joint-y',at:[.4,.4,.2],weights:[.1,.2,.7]}]}},handles:{driver:[{},{x:[{id:'driver-x',at:[.3,.2,.5],weights:[.7,-.2,.5]}],y:[{id:'driver-y',at:[.2,.5,.3],weights:[.1,.2,.7]}]}],follower:[{x:[{id:'follower-x',at:[.3,.2,.5],weights:[1.1,-.4,.3]}],y:[{id:'follower-y',at:[.2,.5,.3],weights:[-.3,.7,.6]}]},{}]}};
  graph.correctionFrames=[{id:'triangle-draft',status:'draft',angle:{x:27,y:18},edgeResponses:{[edge.id]:{nodes:{'a-joint':{y:[[.5,.8]]}},handles:{driver:[{},{x:[[.3,.6]]}],follower:[{y:[[.6,.2]]},{}]}}},triangleResponses:{[triangle.id]:{nodes:{'a-joint':{x:[{id:'draft-node',at:[.5,.3,.2],weights:[-.1,.6,.5]}]}},handles:{driver:[{},{y:[{id:'draft-driver',at:[.5,.3,.2],weights:[.4,-.2,.8]}]}],follower:[{x:[{id:'draft-follower-x',at:[.5,.3,.2],weights:[.7,.1,.2]}],y:[{id:'draft-follower-y',at:[.2,.3,.5],weights:[.1,.8,.1]}]},{}]}}}}];
  const before=JSON.stringify({graph,bases}),next=remap(graph,bases),children=splitBases(bases),loaded=JSON.parse(JSON.stringify(next)) as SnapshotAngleGraph,angles:Point2[]=[[0,0],[90,0],[0,90],[15,0],[45,0],[75,0],[0,35],[0,75],[60,30],[30,60],[10,10],[27,18],[18,45],[40,25]];
  expect(()=>validateSnapshotResponseExpressionRegistry(loaded.responseExpressions,loaded.mesh)).not.toThrow();expect(()=>validateSnapshotResponseExpressionRegistry(loaded.correctionFrames![0].responseExpressions,loaded.mesh)).not.toThrow();
  for(const useDraft of [false,true]){
   const original=useDraft?graph:{...graph,correctionFrames:[]},mapped=useDraft?next:{...next,correctionFrames:[]},reloaded=useDraft?loaded:{...loaded,correctionFrames:[]};
   for(const [x,y] of angles){const expected=split(sample(original,bases,x,y).drawing);compare(sample(mapped,children,x,y).drawing,expected,9);compare(sample(reloaded,children,x,y).drawing,expected,9);}
  }
  const saved=sample({...next,correctionFrames:[]},children,27,18).drawing,draft=sample(next,children,27,18).drawing;
  expect(length(sub(saved.nodes.find(node=>node.id==='seam')!.position,draft.nodes.find(node=>node.id==='seam')!.position))).toBeGreaterThan(.01);expect(JSON.stringify({graph,bases})).toBe(before);
 });

 it('keeps H-P leaves live after source vectors and common endpoint positions change',()=>{
  const {graph,bases}=fixture(true),next=remap(graph,bases),registry=JSON.stringify(next.responseExpressions),changed=structuredClone(bases);
  for(const [index,basis] of changed.entries()){
   const shift:Point2=[5*(index+1),-3*(index+1)];
   for(const node of basis.drawing.nodes)node.position=add(node.position,shift);
   for(const curve of basis.drawing.curves)curve.handles=curve.handles.map(handle=>add(handle,shift)) as [Point2,Point2];
   const joint=basis.drawing.nodes.find(node=>node.id==='a-joint')!.position,driverVector:Point2=index?[.6,1.8]:[1.7,.2],extent=index?3:2;
   basis.drawing.curves.find(curve=>curve.id==='driver')!.handles[1]=add(joint,driverVector);
   basis.drawing.curves.find(curve=>curve.id==='follower')!.handles[0]=add(joint,[-driverVector[0]*extent,-driverVector[1]*extent]);
  }
  for(const angle of [7,31,45,71,87])compare(sample(next,splitBases(changed),angle).drawing,split(sample(graph,changed,angle).drawing));
  expect(JSON.stringify(next.responseExpressions)).toBe(registry);
 });

 it('round-trips the bounded projection registry through JSON and rejects malformed contracts',()=>{
  const {graph,bases}=fixture(true),next=remap(graph,bases),loaded=JSON.parse(JSON.stringify(next)) as SnapshotAngleGraph;
  expect(()=>validateSnapshotResponseExpressionRegistry(loaded.responseExpressions,loaded.mesh)).not.toThrow();
  for(const angle of [15,45,75])compare(sample(loaded,splitBases(bases),angle).drawing,split(sample(graph,bases,angle).drawing));
  const malformed=structuredClone(loaded.responseExpressions!),expression=Object.values(malformed)[0].handles.left[0].x!;
  expression.smoothContracts![0].targets[0].scale=0;
  expect(()=>validateSnapshotResponseExpressionRegistry(malformed,loaded.mesh)).toThrow(/scale/);
 });

 it('rejects self/forward references and unknown operations before evaluating a cyclic program',()=>{
  const base={version:1,fields:[],terms:[]};
  for(const reference of [0,1])expect(()=>validateSnapshotResponseExpression({...base,operations:[{kind:'sum',inputs:[{coefficient:1,operation:reference}]}]})).toThrow(/strictly backward/);
  expect(()=>validateSnapshotResponseExpression({...base,operations:[{kind:'sum',inputs:[{coefficient:1,operation:1}]},{kind:'sum',inputs:[{coefficient:1,operation:0}]}]})).toThrow(/strictly backward/);
  expect(()=>validateSnapshotResponseExpression({...base,operations:[{kind:'unknown-operation'}]})).toThrow(/Unknown response operation/);
 });

 it('rejects nonfinite scales and malformed anchor weights',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),expression=Object.values(next.responseExpressions!)[0].handles.left[0].x!;
  for(const scale of [Infinity,-Infinity,NaN]){
   const malformed=structuredClone(expression);malformed.smoothContracts![0].targets[0].scale=scale;
   expect(()=>validateSnapshotResponseExpression(malformed)).toThrow(/scale/);
  }
  for(const values of [[1],[1,1],[NaN,0]]){
   const malformed=structuredClone(expression),anchor=malformed.operations!.find(operation=>operation.kind==='at')!;
   if(anchor.kind!=='at')throw Error('Missing live corner anchor.');anchor.weights=[{...anchor.weights[0],values}];
   expect(()=>validateSnapshotResponseExpression(malformed)).toThrow(/Anchor coordinates/);
  }
 });

 it('rejects operation and input counts outside the bounded program limits',()=>{
  const base={version:1,fields:[],terms:[]};
  expect(()=>validateSnapshotResponseExpression({...base,operations:Array.from({length:snapshotResponseExpressionLimits.operations+1},()=>({kind:'linear',terms:[]}))})).toThrow(/bounded.*limit/);
  const references=Array.from({length:snapshotResponseExpressionLimits.operationInputs+1},()=>({coefficient:1,operation:0}));
  expect(()=>validateSnapshotResponseExpression({...base,operations:[{kind:'linear',terms:[]},{kind:'sum',inputs:references}]})).toThrow(/bounded.*limit/);
  const half=references.slice(0,Math.floor(snapshotResponseExpressionLimits.operationInputs/2)+1);
  expect(()=>validateSnapshotResponseExpression({...base,operations:[{kind:'linear',terms:[]},{kind:'sum',inputs:half},{kind:'sum',inputs:half}]})).toThrow(/bounded work limit/);
 });

 it('preserves repeated splits of an owned component and its propagated seam',()=>{
  const {graph,bases}=fixture(true),first=remap(graph,bases),children=splitBases(bases),second:CurveSplitIntent={...intent,curveId:'left',sourceNodeIds:['z-joint','seam'],t:.37,childCurveIds:['left-left','left-right'],seamNodeId:'second-seam',seamJoinId:'second-join'};
  const next=remap(first,children,second),grandchildren=splitBases(children,second);
  for(const angle of [0,13,27,45,63,81,90])compare(sample(next,grandchildren,angle).drawing,split(split(sample(graph,bases,angle).drawing),second));
  expect(()=>validateSnapshotResponseExpressionRegistry(JSON.parse(JSON.stringify(next.responseExpressions)),next.mesh)).not.toThrow();
  for(const responses of Object.values(next.responseExpressions!))for(const control of [...Object.values(responses.nodes),...Object.values(responses.handles).flat()])for(const expression of Object.values(control))for(const term of snapshotResponseExpressionTerms(expression))for(const {basis} of term.basis)if(basis.target.kind==='handle')expect(['follower','left']).not.toContain(basis.target.curveId);
 });

 it('composes new native corrections before another split of an owned child',()=>{
  const {graph,bases}=fixture(),first=remap(graph,bases),children=splitBases(bases),edge=graph.mesh.edges[0],second:CurveSplitIntent={...intent,curveId:'left',sourceNodeIds:['z-joint','seam'],t:.37,childCurveIds:['left-left','left-right'],seamNodeId:'second-seam',seamJoinId:'second-join'};
  first.edgeResponses[edge.id]={nodes:{},handles:{left:[{x:[[.5,.65]],y:[[.5,.35]]},{}],driver:[{},{y:[[.4,.55]]}]}};
  const next=remap(first,children,second),grandchildren=splitBases(children,second);
  for(const angle of [0,11,27,36,45,63,81,90])compare(sample(next,grandchildren,angle).drawing,split(sample(first,children,angle).drawing,second));
 });

 it('preserves the original tiny-driver branch rather than normalizing a child driver',()=>{
  const {graph,bases}=fixture(false,true),next=remap(graph,bases),children=splitBases(bases);
  for(const angle of [1,23,45,67,89]){
   const original=sample(graph,bases,angle);expect(original.diagnostics.join(' ')).toContain('zero-length driver');
   compare(sample(next,children,angle).drawing,split(original.drawing),13);
  }
 });

 it('retains the original resolvable driver threshold when splitting shrinks its child below that threshold',()=>{
  const {graph,bases}=fixture(),plan:CurveSplitIntent={...intent,curveId:'driver',sourceNodeIds:['start','a-joint'],t:.9,childCurveIds:['driver-left','driver-right'],seamNodeId:'driver-seam',seamJoinId:'driver-seam-join'};
  for(const [index,basis] of bases.entries()){
   for(const id of ['a-joint','z-joint'])basis.drawing.nodes.find(node=>node.id===id)!.position=[0,0];
   basis.drawing.curves.find(curve=>curve.id==='driver')!.handles[1]=index?[0,1e-13]:[1e-13,0];
   basis.drawing.curves.find(curve=>curve.id==='follower')!.handles[0]=index?[0,-4]:[-2,0];
  }
  const next=remap(graph,bases,plan),children=splitBases(bases,plan),original=sample(graph,bases,45),actual=sample(next,children,45),wrong=sample(graph,children,45);
  expect(original.diagnostics.join(' ')).not.toContain('zero-length driver');expect(wrong.diagnostics.join(' ')).toContain('zero-length driver');
  expect(length((input(original.drawing,driver) as {vector:Point2}).vector)).toBeGreaterThan(64*Number.EPSILON);
  expect(length((input(children[0].drawing,{curveId:'driver-right',end:1}) as {vector:Point2}).vector)).toBeLessThan(64*Number.EPSILON);
  expect(length(sub(actual.drawing.curves.find(curve=>curve.id==='follower')!.handles[0],wrong.drawing.curves.find(curve=>curve.id==='follower')!.handles[0]))).toBeGreaterThan(.1);
  for(const angle of [0,1,15,30,45,60,75,89,90])compare(sample(next,children,angle).drawing,split(sample(graph,bases,angle).drawing,plan));
 });

 it('preserves independent real seam edits and applies the anchored component law to inner-handle freedom',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),changed=structuredClone(children),nodeDelta:Point2=[1.25,-.75],leftDelta:Point2=[.2,.35],rightDelta:Point2=[-.1,.4];
  const edited=changed[0].drawing;
  edited.nodes.find(node=>node.id==='seam')!.position=add(edited.nodes.find(node=>node.id==='seam')!.position,nodeDelta);
  edited.curves.find(curve=>curve.id==='left')!.handles[1]=add(edited.curves.find(curve=>curve.id==='left')!.handles[1],add(nodeDelta,leftDelta));
  edited.curves.find(curve=>curve.id==='right')!.handles[0]=add(edited.curves.find(curve=>curve.id==='right')!.handles[0],add(nodeDelta,rightDelta));
  const ends:Endpoint[]=[{curveId:'left',end:1},{curveId:'right',end:0}],component=components(edited).find(({component})=>component.members.some(({endpoint})=>endpoint.curveId==='left'&&endpoint.end===1))!.component;
  const cornerInputs=ends.map(endpoint=>input(edited,endpoint)),cornerProjection=projectSmoothComponent(component,cornerInputs);
  for(const angle of [0,.000001,9,31,45,73,89.999999,90]){
   const expected=structuredClone(sample(next,children,angle).drawing),weight=1-angle/90,scaled=(delta:Point2):Point2=>[delta[0]*weight,delta[1]*weight];
   const node=expected.nodes.find(node=>node.id==='seam')!;node.position=add(node.position,scaled(nodeDelta));
   const raw=ends.map((endpoint,index)=>{const control=input(sample(next,children,angle).drawing,endpoint) as {node:Point2;vector:Point2};return {node:add(control.node,scaled(nodeDelta)),vector:add(control.vector,scaled(index?rightDelta:leftDelta))};}),projection=projectSmoothComponent(component,raw);
   for(const [index,endpoint] of ends.entries()){
    const corner=cornerInputs[index] as {vector:Point2},correction=sub(cornerProjection.controls[index].vector,corner.vector),vector=sub(projection.controls[index].vector,scaled(correction));
    expected.curves.find(curve=>curve.id===endpoint.curveId)!.handles[endpoint.end]=add(node.position,vector);
   }
   const actual=sample(next,changed,angle).drawing;compare(actual,expected);
   if(angle===0||angle===90)compare(actual,changed[angle===0?0:1].drawing,13);
   if(angle===45)for(const endpoint of ends)expect(length(sub((input(actual,endpoint) as {vector:Point2}).vector,(input(sample(next,children,45).drawing,endpoint) as {vector:Point2}).vector))).toBeGreaterThan(.01);
   if(angle===.000001||angle===89.999999)for(const endpoint of ends){const index=angle<45?0:1;expect(length(sub(actual.curves.find(curve=>curve.id===endpoint.curveId)!.handles[endpoint.end],changed[index].drawing.curves.find(curve=>curve.id===endpoint.curveId)!.handles[endpoint.end]))).toBeLessThan(1e-5);}
  }
 });

 it('preserves another split after independent real seam and inner-handle edits',()=>{
  const {graph,bases}=fixture(),first=remap(graph,bases),children=splitBases(bases),changed=structuredClone(children),second:CurveSplitIntent={...intent,curveId:'left',sourceNodeIds:['z-joint','seam'],t:.37,childCurveIds:['left-left','left-right'],seamNodeId:'second-seam',seamJoinId:'second-join'};
  for(const [index,basis] of changed.entries()){
   const seam=basis.drawing.nodes.find(node=>node.id==='seam')!,shift:Point2=index?[-.3,.2]:[1.25,-.75];seam.position=add(seam.position,shift);
   for(const [member,endpoint] of [{curveId:'left',end:1 as const},{curveId:'right',end:0 as const}].entries()){
    const curve=basis.drawing.curves.find(curve=>curve.id===endpoint.curveId)!,delta:Point2=member?[-.1*(index+1),.4]:[.2,.35*(index+1)];curve.handles[endpoint.end]=add(curve.handles[endpoint.end],add(shift,delta));
   }
  }
  const next=remap(first,changed,second),grandchildren=splitBases(changed,second);
  for(const angle of [0,.000001,11,27,45,63,81,89.999999,90])compare(sample(next,grandchildren,angle).drawing,split(sample(first,changed,angle).drawing,second));
  for(const [angle,index] of [[0,0],[90,1]] as const)compare(sample(next,grandchildren,angle).drawing,grandchildren[index].drawing,13);
 });

 it('keeps the seam smooth when real inner lengths change independently but remain aligned at each basis',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),changed=structuredClone(children);
  const ends:Endpoint[]=[{curveId:'left',end:1},{curveId:'right',end:0}],normalizedCross=(drawing:DrawingDocument)=>{const [a,b]=ends.map(endpoint=>(input(drawing,endpoint) as {vector:Point2}).vector);return Math.abs(a[0]*b[1]-a[1]*b[0])/(length(a)*length(b));};
  for(const [index,basis] of changed.entries())for(const [member,endpoint] of ends.entries()){
   const curve=basis.drawing.curves.find(curve=>curve.id===endpoint.curveId)!,control=input(basis.drawing,endpoint) as {node:Point2;vector:Point2},scale=[[1.7,.6],[.8,1.9]][index][member];
   curve.handles[endpoint.end]=add(control.node,[control.vector[0]*scale,control.vector[1]*scale]);
  }
  for(const basis of changed)expect(normalizedCross(basis.drawing)).toBeLessThan(1e-12);
  for(const angle of [15,30,45,60,75])expect.soft(normalizedCross(sample(next,changed,angle).drawing),`seam normalized cross at ${angle} degrees`).toBeLessThan(1e-12);
 });

 it('anchors projected residuals at live real vertices after outer edits break the old direction ratio',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),changed=structuredClone(children),location=locateSnapshotSimplex(graph.mesh,{x:45,y:0})!,mapper=createSnapshotResponseFieldWeightMapper(graph.mesh,location);
  const left=changed[0].drawing.curves.find(curve=>curve.id==='left')!;left.handles[0]=add(left.handles[0],[.4,.7]);
  const right=changed[1].drawing.curves.find(curve=>curve.id==='right')!;right.handles[1]=add(right.handles[1],[-.3,.2]);
  const a=input(changed[0].drawing,driver) as {vector:Point2},b=input(changed[0].drawing,{curveId:'left',end:0}) as {vector:Point2};expect(Math.abs(a.vector[0]*b.vector[1]-a.vector[1]*b.vector[0])).toBeGreaterThan(.1);
  for(const response of Object.values(next.responseExpressions!))for(const control of [...Object.values(response.nodes),...Object.values(response.handles).flat()])for(const expression of Object.values(control) as SnapshotResponseExpression[]){
   const evaluate=prepareSnapshotResponseExpression(expression);
   for(const weights of [[1,0],[0,1]])expect(evaluate({basisScalar:createSnapshotResponseBasisResolver(changed),geometricWeights:field=>mapper(field,weights)})).toBeCloseTo(0,13);
  }
  for(const [angle,index] of [[.000001,0],[89.999999,1]] as const){
   const near=sample(next,changed,angle).drawing;
   for(const curve of changed[index].drawing.curves){const actual=shapeOf(near,curve.id),expected=shapeOf(changed[index].drawing,curve.id);actual.forEach((point,control)=>expect(length(sub(point,expected[control]))).toBeLessThan(1e-5));}
  }
 });

 it('treats a new native correction equal to geometric lambda as exactly zero',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),before=sample(next,children,45).drawing,edge=graph.mesh.edges[0];
  next.edgeResponses[edge.id]={nodes:{},handles:{left:[{x:[[.5,.5],[.75,.9]],y:[[.5,.5],[.75,.1]]},{}]}};
  expect(sample(next,children,45).drawing).toEqual(before);
  expect(sample(next,children,67.5).drawing).not.toEqual(sample({...next,edgeResponses:{}},children,67.5).drawing);
 });

 it('uses the same original-scale law continuously for tiny native corrections',()=>{
  const {graph,bases}=fixture(),next=remap(graph,bases),children=splitBases(bases),baseline=sample(next,children,45).drawing,edge=graph.mesh.edges[0],component=components(bases[0].drawing)[0].component,targets:Endpoint[]=[driver,{curveId:'left',end:0}];
  const baselineInputs=targets.map(endpoint=>input(baseline,endpoint)),baseVector=(baselineInputs[1] as {vector:Point2}).vector,a=input(children[0].drawing,targets[1]) as {vector:Point2},b=input(children[1].drawing,targets[1]) as {vector:Point2};
  let prior=Infinity;
  for(const epsilon of [1e-3,1e-5,1e-7,1e-9,1e-11,1e-13,0]){
   const corrected=structuredClone(baselineInputs) as {node:Point2;vector:Point2}[];
   corrected[1].vector=[baseVector[0]+(b.vector[0]-a.vector[0])*epsilon,baseVector[1]-(b.vector[1]-a.vector[1])*epsilon];
   const expected=projectSmoothComponentCorrection(component,baselineInputs,corrected,[1,.5]);
   const changed:SnapshotAngleGraph={...next,edgeResponses:{[edge.id]:{nodes:{},handles:{left:[{x:[[.5,.5+epsilon]],y:[[.5,.5-epsilon]]},{}]}}}},actual=sample(changed,children,45).drawing;
   for(const [index,endpoint] of targets.entries()){const curve=actual.curves.find(curve=>curve.id===endpoint.curveId)!;curve.handles[endpoint.end].forEach((value,axis)=>expect(value).toBeCloseTo(expected.controls[index].handle[axis],12));}
   const distance=length(sub(actual.curves.find(curve=>curve.id==='left')!.handles[0],baseline.curves.find(curve=>curve.id==='left')!.handles[0]));expect(distance).toBeLessThanOrEqual(prior);prior=distance;
   if(epsilon===0)expect(actual).toEqual(baseline);
  }
 });

 it.each([false,true])('inverts and replays owned nonlinear node/handle edits through draft, saved overlay and JSON; source lengths changed=%s',sourceLengthsChanged=>{
  const {graph,bases}=fixture(),owned=remap(graph,bases),children=splitBases(bases),seamEnds:Endpoint[]=[{curveId:'left',end:1},{curveId:'right',end:0}];
  if(sourceLengthsChanged)for(const [index,basis] of children.entries())for(const [member,endpoint] of seamEnds.entries()){
   const curve=basis.drawing.curves.find(curve=>curve.id===endpoint.curveId)!,control=input(basis.drawing,endpoint) as {node:Point2;vector:Point2},scale=[[1.7,.6],[.8,1.9]][index][member];
   curve.handles[endpoint.end]=add(control.node,[control.vector[0]*scale,control.vector[1]*scale]);
  }
  const current=sample(owned,children,45).drawing,seam=current.nodes.find(node=>node.id==='seam')!,wanted=moveNode(current,'seam',add(seam.position,[.15,0]),true),raw=seamEnds.map(endpoint=>input(wanted,endpoint)) as {node:Point2;vector:Point2}[],component=components(wanted).find(({component})=>component.members.some(({endpoint})=>endpoint.curveId==='left'&&endpoint.end===1))!.component;
  // The unchanged fixture has equal inner X vectors at its real bases. Keep
  // those X coordinates and edit both available Y coordinates in one direction.
  const slope=(raw[0].vector[1]+.12)/raw[0].vector[0],projected=projectSmoothComponent(component,raw.map(control=>({...control,vector:[control.vector[0],control.vector[0]*slope]})));
  for(const [index,endpoint] of seamEnds.entries())wanted.curves.find(curve=>curve.id===endpoint.curveId)!.handles[endpoint.end]=projected.controls[index].handle;
  const location=locateSnapshotSimplex(graph.mesh,{x:45,y:0})!,before=JSON.stringify({owned,children});
  const result=prepareSnapshotSurfaceTargetEdit(owned,location,location.snapshotIds.map(snapshotId=>children.find(basis=>basis.snapshotId===snapshotId)!),current,wanted,{angle:{x:45,y:0},frameId:'inverse-draft',allBases:children});
  expect(result.changed).toBe(true);expect(result.graph.correctionFrames).toHaveLength(1);expect(result.graph.correctionFrames![0].status).toBe('draft');
  compare(sample(result.graph,children,45).drawing,wanted,8);expect(JSON.stringify({owned,children})).toBe(before);expect(result.graph.responseExpressions).toBe(owned.responseExpressions);
  const frame=result.graph.correctionFrames![0],saved:SnapshotAngleGraph={...result.graph,edgeResponses:{...result.graph.edgeResponses,...frame.edgeResponses},triangleResponses:{...result.graph.triangleResponses,...frame.triangleResponses},responseExpressions:{...result.graph.responseExpressions,...frame.responseExpressions},correctionFrames:result.graph.correctionFrames!.map(value=>({...value,status:'saved'}))};
  compare(sample(saved,children,45).drawing,wanted,8);
  const reloaded=JSON.parse(JSON.stringify(saved)) as SnapshotAngleGraph;expect(()=>validateSnapshotResponseExpressionRegistry(reloaded.responseExpressions,reloaded.mesh)).not.toThrow();
  for(const angle of [0,11,27,45,63,81,90])compare(sample(reloaded,children,angle).drawing,sample(saved,children,angle).drawing);
  compare(sample(reloaded,children,45).drawing,wanted,8);expect(reloaded.correctionFrames![0].status).toBe('saved');
 });
});
