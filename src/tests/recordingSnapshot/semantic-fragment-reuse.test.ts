import {describe,expect,it} from 'vitest';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareRecordingContext} from '../../domain/recordingSnapshot/preparedRecordingContext';
import {snapshotPropertyResponsesCacheKey} from '../../domain/recordingSnapshot/propertyResponses';
import {RecordingSemanticFragments,getRecordingSemanticFragmentStats,recordingSemanticFragment} from '../../domain/recordingSnapshot/semanticFragments';

const at=(x:number)=>({x,y:0});
const options={immutableInputs:true,diagnostics:'preview'} as const;
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace();workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]}};workspace.library.curves={curve:{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.25,0],[.75,1]],width:.01,visible:true,locked:false}};
 const zero=emptyRecordingSnapshot('zero','Zero'),side=emptyRecordingSnapshot('side','Side','view',at(90));
 for(const [index,snapshot] of [zero,side].entries()){
  snapshot.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}];
  snapshot.relations.displayIntervals={add:[{id:'interval',anchor:{id:'curve',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.2,end:index?.8:.2}]}]};
 }
 side.deformation.layers.layer={shape:{nodes:{a:[1,0]},handles:{}}};
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=['zero','side'];recording.activeSnapshotId='zero';recording.angle=at(45);recording.angleGraph=createSnapshotAngleGraph([zero,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 const graph=recording.angleGraph,edge=graph.mesh.edges[0].id;
 graph.edgeResponses={[edge]:{nodes:{a:{x:[[.5,.3]]}},handles:{}}};graph.responseExpressions={};
 graph.propertyResponses={edges:{[edge]:[{target:{kind:'interval-endpoint',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:'end'},knots:[[.5,.4]]}]},triangles:{}};
 graph.materialRecipes={};graph.visibilityRecipes={};graph.materialPartitions=[];graph.materialPathLineages=[];
 graph.correctionFrames=[{id:'draft',angle:at(45),status:'draft',edgeResponses:{[edge]:{nodes:{a:{x:[[.5,.7]]}},handles:{}}},propertyResponses:{edges:{[edge]:[{target:{kind:'interval-endpoint',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:'end'},knots:[[.5,.6]]}]},triangles:{}}}];
 workspace.snapshots=[zero,side];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;return {workspace,recording,graph,edge};
}
const geometry=(value:SnapshotEvaluation)=>({nodes:value.drawing.nodes,curves:value.drawing.curves});
const node=(value:SnapshotEvaluation)=>value.drawing.nodes.find(node=>node.id==='a')!.position[0];
const interval=(value:SnapshotEvaluation)=>value.drawing.displayIntervals![0].ranges[0].end;
const product=(value:SnapshotEvaluation)=>({drawing:value.drawing,diagnostics:value.diagnostics,paint:value.paintBatches,outside:value.angleSurface?.outsideCurves});
const withGraph=(f:ReturnType<typeof fixture>,graph:SnapshotAngleGraph)=>({...f.workspace,recordings:[{...f.recording,angleGraph:graph}]});

describe('bounded immutable semantic fragments',()=>{
 it('interns exact values across detached objects, bounds strong storage, and never recycles a token',()=>{
  const cache=new RecordingSemanticFragments(2,100),a={value:1},key=cache.key(a);
  expect(cache.key(a)).toBe(key);expect(cache.key(JSON.parse(JSON.stringify(a)))).toBe(key);
  expect(cache.stats()).toMatchObject({serializations:2,identityHits:1,valueHits:1,entries:1});
  const b=cache.key({value:2}),c=cache.key({value:3});expect(new Set([key,b,c]).size).toBe(3);expect(cache.stats().entries).toBe(2);
  expect(cache.key(a)).toBe(key);const reloaded=cache.key({value:1});expect([b,c]).not.toContain(reloaded);
  const before=cache.stats(),large={value:'x'.repeat(101)},largeKey=cache.key(large);expect(cache.key(large)).toBe(largeKey);
  expect(cache.stats().entries).toBe(before.entries);expect(cache.stats().characters).toBe(before.characters);expect(cache.stats().characters).toBeLessThanOrEqual(100);
 });
 it('never applies weak identity memoization to an external value',()=>{
  const value={response:[.25,.4]};recordingSemanticFragment(value,true);value.response[1]=.8;
  expect(recordingSemanticFragment(value,false)).toBe(value);expect(JSON.stringify(recordingSemanticFragment(value,false))).toBe('{"response":[0.25,0.8]}');
 });
 it('serializes each immutable fragment once across cold/warm geometry, display, saved/live, and quality requests',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=getRecordingSemanticFragmentStats();
  context.sample('recording');const cold=getRecordingSemanticFragmentStats();
  const fragments=[f.graph.mesh,f.graph.edgeResponses,f.graph.triangleResponses,f.graph.responseExpressions,f.graph.propertyResponses,f.graph.materialRecipes,f.graph.visibilityRecipes,f.graph.materialPartitions,f.graph.materialPathLineages,f.graph.correctionFrames![0].edgeResponses,f.graph.correctionFrames![0].propertyResponses];
  expect(cold.serializations-before.serializations).toBe(new Set(fragments).size);
  for(const x of [15,30,45,60,75])for(const useDraft of [false,true])for(const products of ['controls','display'] as const)context.sample('recording',{angle:at(x),useDraft,products});
  const full=context.sample('recording',{diagnostics:'full'}),fullCounters={...context.counters},preview=context.sample('recording');
  expect(preview.drawing).toEqual(full.drawing);expect(context.counters.ownGeometry).toBe(fullCounters.ownGeometry);
  expect(getRecordingSemanticFragmentStats().serializations).toBe(cold.serializations);expect(getRecordingSemanticFragmentStats().identityHits).toBeGreaterThan(cold.identityHits);
 });
 it('retains complete products for value-equal cloned graph wrappers and only prepares changed response fragments',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),saved=context.sample('recording',{useDraft:false});
  const equivalent=freeze(withGraph(f,structuredClone(f.graph))),fork=context.fork(equivalent),after=fork.sample('recording');
  expect(after.drawing).toBe(before.drawing);expect(after.paintBatches).toBe(before.paintBatches);expect(after).not.toBe(before);
  expect(fork.counters).toMatchObject({surfaceSample:0,material:0,paint:0,ownGeometry:0});
  const changedGraph={...f.graph,edgeResponses:{[f.edge]:{nodes:{a:{x:[[.5,.9] as [number,number]]}},handles:{}}}},changed=context.fork(freeze(withGraph(f,changedGraph))),counts=getRecordingSemanticFragmentStats(),actual=changed.sample('recording',{useDraft:false});
  expect(getRecordingSemanticFragmentStats().serializations-counts.serializations).toBe(1);expect(node(actual)).not.toBe(node(saved));expect(node(changed.sample('recording'))).toBe(node(before));
  expect(product(actual)).toEqual(product(evaluateRecordingSnapshot(structuredClone(changed.workspace),'recording',{diagnostics:'preview',useDraft:false})));
 });
 it('keeps property drafts separate from saved properties and invalidates their angle/status metadata',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),live=context.sample('recording'),saved=context.sample('recording',{useDraft:false});expect(interval(live)).not.toBe(interval(saved));
  const changedProperties={...f.graph.propertyResponses!,edges:{[f.edge]:[{...f.graph.propertyResponses!.edges[f.edge][0],knots:[[.5,.9] as [number,number]]}]}},changed=context.fork(freeze(withGraph(f,{...f.graph,propertyResponses:changedProperties}))),counts=getRecordingSemanticFragmentStats(),actual=changed.sample('recording',{useDraft:false});
  expect(getRecordingSemanticFragmentStats().serializations-counts.serializations).toBe(1);expect(interval(actual)).not.toBe(interval(saved));expect(geometry(actual)).toEqual(geometry(saved));expect(interval(changed.sample('recording'))).toBe(interval(live));
  for(const frame of [{...f.graph.correctionFrames![0],angle:at(30)},{...f.graph.correctionFrames![0],status:'saved' as const}]){
   const next=freeze(withGraph(f,{...f.graph,correctionFrames:[frame]})),fork=context.fork(next),value=fork.sample('recording');
   expect(fork.counters.material).toBe(1);expect(product(value)).toEqual(product(evaluateRecordingSnapshot(structuredClone(next),'recording',{diagnostics:'preview'})));
  }
 });
 it('keeps defensive mutable edits visible and reloads JSON without runtime fragment state',()=>{
  const f=fixture(),bytes=JSON.stringify(f.workspace),context=prepareRecordingContext(f.workspace,options),live=context.sample('recording'),saved=context.sample('recording',{useDraft:false});
  expect(JSON.stringify(f.workspace)).toBe(bytes);const reloaded=parseRecordingSnapshots(JSON.parse(bytes));
  for(const [useDraft,expected] of [[true,live],[false,saved]] as const)expect(product(evaluateRecordingSnapshot(reloaded,'recording',{diagnostics:'preview',useDraft}))).toEqual(product(expected));
  const graph=reloaded.recordings[0].angleGraph!,propertyBefore=snapshotPropertyResponsesCacheKey(graph),initial=evaluateRecordingSnapshot(reloaded,'recording',{diagnostics:'preview'});
  graph.correctionFrames![0].edgeResponses![f.edge].nodes.a.x![0]=[.5,.2];graph.correctionFrames![0].propertyResponses!.edges[f.edge][0].knots[0]=[.5,.1];
  const changed=evaluateRecordingSnapshot(reloaded,'recording',{diagnostics:'preview'});expect(node(changed)).not.toBe(node(initial));expect(interval(changed)).not.toBe(interval(initial));expect(snapshotPropertyResponsesCacheKey(graph)).not.toBe(propertyBefore);
  expect(product(changed)).toEqual(product(evaluateRecordingSnapshot(structuredClone(reloaded),'recording',{diagnostics:'preview'})));
 });
});
