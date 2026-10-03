import {describe,expect,it} from 'vitest';
import type {SnapshotAngleGraph,SnapshotScalarPropertyTarget} from '../../domain/recordingSnapshot/model';
import {createSnapshotTriangulation,locateSnapshotSimplex,type SnapshotSimplexLocation} from '../../domain/recordingSnapshot/triangulation';
import {createSnapshotPropertyResponseSampler,effectiveSnapshotPropertyResponses,finishSnapshotPropertyDraft,prepareSnapshotPropertyTargetEdit,snapshotPropertyResponsesCacheKey,snapshotScalarPropertyTargetKey,SnapshotPropertyResponseError,solveSnapshotPropertyResponseWeights,validateSnapshotPropertyResponses} from '../../domain/recordingSnapshot/propertyResponses';
import {createSnapshotSurfaceResponseSampler} from '../../domain/recordingSnapshot/surfaceTargets';

const start:SnapshotScalarPropertyTarget={kind:'interval-endpoint',layerId:'layer',sourceTrackId:'track',rangeId:'range',end:'start'};
const end:SnapshotScalarPropertyTarget={...start,end:'end'};
const other:SnapshotScalarPropertyTarget={...end,layerId:'other'};
const a30={x:30,y:0};
function graph(triangle=false):SnapshotAngleGraph {
 const inputs=[{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}];
 if(triangle)inputs.push({snapshotId:'C',angle:{x:0,y:90}});
 return {version:1,mesh:createSnapshotTriangulation(inputs),edgeResponses:{},triangleResponses:{}};
}
const location=(g:SnapshotAngleGraph,angle=a30)=>locateSnapshotSimplex(g.mesh,angle)!;
const sample=(g:SnapshotAngleGraph,target:SnapshotScalarPropertyTarget,values:readonly number[],angle=a30,useDraft=true)=>createSnapshotPropertyResponseSampler(g,location(g,angle),{useDraft})(target,values);
const edit=(g:SnapshotAngleGraph,target:SnapshotScalarPropertyTarget,values:readonly number[],value:number,angle=a30,frameId='draft')=>prepareSnapshotPropertyTargetEdit(g,location(g,angle),[{target,basisValues:values,value}],{angle,frameId});
function frozen<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))frozen(child);}return value;}
function code(run:()=>unknown){try{run();throw Error('Expected failure');}catch(error){expect(error).toBeInstanceOf(SnapshotPropertyResponseError);return (error as SnapshotPropertyResponseError).code;}}

describe('typed scalar property responses',()=>{
 it('keeps coincident material endpoints exactly closed through 30 degrees and opens linearly to 90',()=>{
  const g=graph(),before=JSON.stringify(g),result=edit(frozen(g),end,[.17,.731],.17),next=result.graph;
  expect(result.changed).toBe(true);expect(JSON.stringify(g)).toBe(before);expect(next.mesh).toBe(g.mesh);
  expect(next.edgeResponses).toBe(g.edgeResponses);expect(next.triangleResponses).toBe(g.triangleResponses);expect(next.mesh.vertices).toHaveLength(2);
  for(const x of [0,1,10,20,29.99,30]){
   const point={x,y:0},l=location(next,point),values=l.kind==='vertex'?[.17]:[.17,.731];
   expect(createSnapshotPropertyResponseSampler(next,l)(end,values)).toBe(.17);
  }
  for(const x of [30.1,45,60,89.99])expect(sample(next,end,[.17,.731],{x,y:0})).toBeCloseTo(.17+(x-30)/60*(.731-.17),14);
  expect(sample(next,end,[.731],{x:90,y:0})).toBe(.731);
  expect(sample(next,start,[.17,.17])).toBe(.17);
  const l=location(next);expect(createSnapshotSurfaceResponseSampler(next,l)({kind:'node',nodeId:'n'},0,[0,90],l.geometricWeights)).toEqual(l.geometricWeights);
  expect(next.correctionFrames![0].propertyResponses!.edges[l.simplexId][0].knots).toEqual([[1/3,0]]);
  expect(JSON.stringify(next.correctionFrames)).not.toMatch(/deformation|snapshotId|enabled/);
 });
 it('samples actual non-normalized material values, distinguishes every typed address, and permits equal endpoints',()=>{
  const g=edit(graph(),end,[12,42],12).graph;
  expect(sample(g,end,[12,42])).toBe(12);expect(sample(g,start,[12,42])).toBe(22);
  expect(sample(g,{...end,sourceTrackId:'different'},[12,42])).toBe(22);
  expect(sample(g,{...end,rangeId:'different'},[12,42])).toBe(22);expect(sample(g,other,[12,42])).toBe(22);
  expect(edit(g,start,[12,12],12).changed).toBe(false);
  expect(snapshotScalarPropertyTargetKey(end)).not.toBe(snapshotScalarPropertyTargetKey(start));
 });
 it('preserves geometry drafts and unrelated property constraints in an atomic edit',()=>{
  const g=graph(),l=location(g);g.correctionFrames=[{id:'geometry-draft',angle:a30,status:'draft',edgeResponses:{[l.simplexId]:{nodes:{a:{x:[[.5,.7]]}},handles:{}}}}];
  const first=edit(g,other,[0,100],70).graph,frame=first.correctionFrames![0];
  const next=edit(frozen(first),end,[.17,.731],.17).graph;
  expect(next.correctionFrames).toHaveLength(1);expect(next.correctionFrames![0].id).toBe('geometry-draft');
  expect(next.correctionFrames![0].edgeResponses).toBe(frame.edgeResponses);expect(sample(next,other,[0,100])).toBeCloseTo(70,12);
  expect(next.propertyResponses).toBeUndefined();expect(sample(next,end,[.17,.731],a30,false)).toBeCloseTo(.357,14);
 });
 it('rejects an entire edit when one target is unavailable or invalid',()=>{
  const g=frozen(graph()),before=JSON.stringify(g),l=location(g);
  expect(code(()=>prepareSnapshotPropertyTargetEdit(g,l,[{target:end,basisValues:[0,1],value:0},{target:start,basisValues:[2,2],value:3}],{angle:a30,frameId:'draft'}))).toBe('PROPERTY_AXIS_UNAVAILABLE');
  expect(code(()=>prepareSnapshotPropertyTargetEdit(g,l,[{target:end,basisValues:[0,1],value:0},{target:start,basisValues:[2,3],value:NaN}],{angle:a30,frameId:'draft'}))).toBe('PROPERTY_INVALID_TARGET');
  expect(code(()=>prepareSnapshotPropertyTargetEdit(g,l,[{target:end,basisValues:[0,1],value:0},{target:end,basisValues:[0,1],value:1}],{angle:a30,frameId:'draft'}))).toBe('PROPERTY_INVALID_TARGET');
  expect(JSON.stringify(g)).toBe(before);expect(g.correctionFrames).toBeUndefined();
 });
 it('keeps vertex attributes, outside coverage, and another draft angle out of response editing',()=>{
  const g=graph();expect(code(()=>edit(g,end,[0],1,{x:0,y:0}))).toBe('PROPERTY_REQUIRES_INTERIOR');
  expect(code(()=>prepareSnapshotPropertyTargetEdit(g,location(g),[{target:end,basisValues:[0,1],value:0}],{angle:{x:20,y:10},frameId:'draft'}))).toBe('PROPERTY_OUTSIDE_COVERAGE');
  const next=edit(g,end,[0,1],0).graph;expect(code(()=>edit(next,end,[0,1],0,{x:45,y:0}))).toBe('OBJECT_DRAFT_AT_OTHER_ANGLE');
 });
 it('uses persisted edge orientation when callers reverse their basis order',()=>{
  const g=graph(),l=location(g),reversed:SnapshotSimplexLocation={...l,vertexIds:[...l.vertexIds].reverse(),snapshotIds:[...l.snapshotIds].reverse(),geometricWeights:[...l.geometricWeights].reverse()};
  const next=prepareSnapshotPropertyTargetEdit(g,reversed,[{target:end,basisValues:[.731,.17],value:.17}],{angle:a30,frameId:'draft'}).graph;
  expect(createSnapshotPropertyResponseSampler(next,reversed)(end,[.731,.17])).toBe(.17);
  expect(sample(next,end,[.17,.731])).toBe(.17);expect(next.correctionFrames![0].propertyResponses!.edges[l.simplexId][0].knots).toEqual([[1/3,0]]);
 });
 it('supports signed triangular scalar inverse independently of original geometric membership',()=>{
  const g=graph(true),angle={x:18,y:27},l=location(g,angle),original=[...l.geometricWeights],permutation=[2,0,1];
  const reversed:SnapshotSimplexLocation={...l,vertexIds:permutation.map(i=>l.vertexIds[i]),snapshotIds:permutation.map(i=>l.snapshotIds[i]),geometricWeights:permutation.map(i=>l.geometricWeights[i])};
  const values=[10,20,40],ordered=permutation.map(i=>values[i]);
  const next=prepareSnapshotPropertyTargetEdit(g,reversed,[{target:end,basisValues:ordered,value:80}],{angle,frameId:'draft'}).graph;
  expect(createSnapshotPropertyResponseSampler(next,reversed)(end,ordered)).toBeCloseTo(80,12);expect(createSnapshotPropertyResponseSampler(next,l)(end,values)).toBeCloseTo(80,12);
  expect(l.geometricWeights).toEqual(original);expect(next.mesh).toBe(g.mesh);
  const constraint=next.correctionFrames![0].propertyResponses!.triangles[l.simplexId][0].samples[0];expect(constraint.weights.some(value=>value<0)).toBe(true);
 });
 it('shares one edge field with both incident triangles and preserves the boundary exactly',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}},{snapshotId:'C',angle:{x:0,y:90}},{snapshotId:'D',angle:{x:90,y:90}}]),shared=mesh.edges.find(edge=>mesh.triangles.filter(face=>face.edgeIds.includes(edge.id)).length===2)!;
  const g:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{},propertyResponses:{edges:{[shared.id]:[{target:end,knots:[[.5,0]]}]},triangles:{}}};
  for(const face of mesh.triangles){
   const l:SnapshotSimplexLocation={kind:'triangle',simplexId:face.id,vertexIds:[...face.vertexIds],snapshotIds:face.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId),geometricWeights:[1/3,1/3,1/3]};
   const values=face.vertexIds.map(id=>id===shared.vertexIds[0]?12:id===shared.vertexIds[1]?42:100),boundary=face.vertexIds.map(id=>shared.vertexIds.includes(id)?.5:0),sampler=createSnapshotPropertyResponseSampler(g,l);
   expect(sampler(end,values,boundary)).toBe(12);
   const near=boundary.map(value=>value===0?1e-9:value*(1-1e-9));expect(sampler(end,values,near)).toBeCloseTo(12,6);
  }
 });
 it('retains prior knots and samples while replacing the current constraint atomically',()=>{
  const first=edit(graph(),end,[0,1],0).graph,saved=finishSnapshotPropertyDraft(first,true);saved.correctionFrames=[];
  const next=edit(saved,end,[0,1],.8,{x:60,y:0},'second').graph,second=edit(next,end,[0,1],.9,{x:60,y:0},'ignored').graph;
  const knots=effectiveSnapshotPropertyResponses(second).edges[location(second).simplexId][0].knots;
  expect(knots.map(knot=>knot[0])).toEqual([1/3,2/3]);expect(knots[0][1]).toBe(0);expect(knots[1][1]).toBeCloseTo(.9,14);
  const tg=graph(true),angle={x:18,y:27},t1=edit(tg,end,[0,1,2],3,angle).graph,t2=edit(t1,end,[0,1,2],4,angle).graph;
  const a=t1.correctionFrames![0].propertyResponses!.triangles[location(t1,angle).simplexId][0].samples,b=t2.correctionFrames![0].propertyResponses!.triangles[location(t2,angle).simplexId][0].samples;
  expect(b).toHaveLength(1);expect(b[0].id).toBe(a[0].id);expect(b[0].weights).not.toEqual(a[0].weights);
 });
 it('prepares an owned sampler and exposes saved/draft cache dependencies',()=>{
  const g=edit(graph(),end,[0,1],0).graph,sampler=createSnapshotPropertyResponseSampler(g,location(g)),before=snapshotPropertyResponsesCacheKey(g),savedKey=snapshotPropertyResponsesCacheKey(g,{useDraft:false});
  const knots=g.correctionFrames![0].propertyResponses!.edges[location(g).simplexId][0].knots;knots[0]=[1/3,.7];
  expect(sampler(end,[0,1])).toBe(0);expect(sample(g,end,[0,1])).toBe(.7);
  expect(snapshotPropertyResponsesCacheKey(g)).not.toBe(before);expect(snapshotPropertyResponsesCacheKey(g,{useDraft:false})).toBe(savedKey);
 });
 it('saves and discards selected layers while preserving all other draft maps',()=>{
  const g=edit(edit(graph(),end,[0,1],0).graph,other,[0,1],.8).graph,l=location(g);
  g.correctionFrames![0].edgeResponses={[l.simplexId]:{nodes:{a:{x:[[.5,.4]]}},handles:{}}};
  const saved=finishSnapshotPropertyDraft(frozen(g),true,['layer']);
  expect(sample(saved,end,[0,1],a30,false)).toBe(0);expect(sample(saved,other,[0,1],a30,false)).toBeCloseTo(1/3,14);expect(sample(saved,other,[0,1])).toBeCloseTo(.8,14);
  expect(saved.correctionFrames![0].edgeResponses).toBe(g.correctionFrames![0].edgeResponses);
  const discarded=finishSnapshotPropertyDraft(saved,false,['other']);
  expect(discarded.correctionFrames![0].propertyResponses).toBeUndefined();expect(discarded.correctionFrames![0].status).toBe('draft');
  expect(sample(discarded,end,[0,1])).toBe(0);expect(sample(discarded,other,[0,1])).toBeCloseTo(1/3,14);
 });
 it('saves deletion of selected targets without deleting unrelated saved targets',()=>{
  const g=graph(),l=location(g);g.propertyResponses={edges:{[l.simplexId]:[{target:end,knots:[[.3,.2]]},{target:other,knots:[[.4,.9]]}]},triangles:{}};
  g.correctionFrames=[{id:'draft',angle:a30,status:'draft',propertyResponses:{edges:{[l.simplexId]:[{target:other,knots:[[.4,.9]]}]},triangles:{}}}];
  const result=finishSnapshotPropertyDraft(g,true,['layer']);expect(result.propertyResponses!.edges[l.simplexId]).toEqual([{target:other,knots:[[.4,.9]]}]);expect(result.correctionFrames![0].propertyResponses).toBeUndefined();
 });
 it('returns finite conditioned inverses without inventing epsilon denominators',()=>{
  expect(solveSnapshotPropertyResponseWeights([2/3,1/3],[.17,.731],.17)).toMatchObject({available:true,weights:[1,0,0]});
  expect(solveSnapshotPropertyResponseWeights([.5,.5],[2,2],3).available).toBe(false);
  expect(solveSnapshotPropertyResponseWeights([.5,.5],[1,1+Number.EPSILON],2).available).toBe(false);
  expect(solveSnapshotPropertyResponseWeights([.5,.5],[2,2],2).available).toBe(true);
  expect(solveSnapshotPropertyResponseWeights([.5,.5],[2,Infinity],2).available).toBe(false);
 });
});

describe('property response persisted validation',()=>{
 it('accepts signed responses and strict interval addresses while rejecting malformed or unsupported data',()=>{
  const g=graph(true),edgeId=g.mesh.edges[0].id,triangleId=g.mesh.triangles[0].id;
  const valid={edges:{[edgeId]:[{target:end,knots:[[.3,-4],[.8,2]]}]},triangles:{[triangleId]:[{target:start,samples:[{id:'sample',at:[.2,.3,.5],weights:[-2,1,2]}]}]}};
  expect(()=>validateSnapshotPropertyResponses(valid,g.mesh)).not.toThrow();
  const invalid=[
   {...valid,unexpected:true}, {...valid,edges:{missing:[]}}, {...valid,triangles:{missing:[]}},
   {...valid,edges:{[edgeId]:[{target:{...end,enabled:true},knots:[]}]}},
   {...valid,edges:{[edgeId]:[{target:{...end,kind:'display'},knots:[]}]}},
   {...valid,edges:{[edgeId]:[{target:end,knots:[[.3,NaN]]}]}},
   {...valid,edges:{[edgeId]:[{target:end,knots:[[0,0]]}]}},
   {...valid,edges:{[edgeId]:[{target:end,knots:[[.3,0],[.3,1]]}]}},
   {...valid,edges:{[edgeId]:[{target:end,knots:[]},{target:end,knots:[]}]}},
   {...valid,triangles:{[triangleId]:[{target:start,samples:[{id:'s',at:[0,.5,.5],weights:[0,.5,.5]}]}]}},
   {...valid,triangles:{[triangleId]:[{target:start,samples:[{id:'s',at:[.2,.3,.5],weights:[Infinity,0,0]}]}]}},
   {...valid,triangles:{[triangleId]:[{target:start,samples:[{id:'s',at:[.2,.3,.5],weights:[.2,.3,.5],value:1}]}]}},
  ];
  for(const value of invalid)expect(()=>validateSnapshotPropertyResponses(value,g.mesh)).toThrow();
 });
});
