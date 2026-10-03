import {describe,expect,it} from 'vitest';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording,type RecordingSnapshotWorkspace,type SnapshotInterpolationWeight} from '../../domain/recordingSnapshot/model';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {snapshotAuthoredKeyCount} from '../../domain/recordingSnapshot/tracks';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {createWarpGrid} from '../../domain/vectorWarp/model';
import {evaluateSnapshotWeightCurve,resolveSnapshotInterpolationWeight,snapshotInterpolationWeight,snapshotTrackProgressMapper,snapshotWeightNodeOwners,validateSnapshotInterpolationWeight} from '../../domain/recordingSnapshot/weights';
import type {Point2} from '../../domain/drawing/model';

const at=(x:number)=>({x,y:0});
const slow:Point2[]=[[0,0],[.5,.2],[1,1]],linear:Point2[]=[[0,0],[1,1]];
const weight=(curveId?:string,points=slow):SnapshotInterpolationWeight=>({id:curveId??'layer-weight',target:{layerId:'layer',...(curveId?{curveId}:{})},startSnapshotId:'front',endSnapshotId:'side',points:structuredClone(points)});
const placement=(x:number)=>({...identityScenePlacement(),translation:[x,0] as Point2});
function fixture():RecordingSnapshotWorkspace {
 const w=emptyRecordingSnapshotWorkspace(),source=emptyRecordingSnapshot('source','Source','drawing'),front=emptyRecordingSnapshot('front','Front'),side=emptyRecordingSnapshot('side','Side','view',at(90));
 w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]},c:{id:'c',position:[2,0]}};
 w.library.curves={one:{id:'one',name:'One',nodes:['a','b'],handles:[[.3,0],[.7,0]],visible:true,locked:false,width:.01},two:{id:'two',name:'Two',nodes:['b','c'],handles:[[1.3,0],[1.7,0]],visible:true,locked:false,width:.01}};
 source.layers=[{kind:'original',id:'source-layer',name:'Layer',visible:true,locked:false,items:['one','two']}];
 front.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:'source',baseLayerId:'source-layer'}];side.layers=structuredClone(front.layers);
 const recording=emptySnapshotRecording('recording');recording.snapshotIds=['front','side'];recording.activeSnapshotId='front';recording.tracks=[{id:'placement',channel:'placement',targetId:'layer',keys:[{id:'end-placement',angle:at(90),value:placement(10)}]},{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'end-shape',angle:at(90),value:{nodes:{a:[0,10],b:[0,10],c:[0,10]},handles:{one:[[0,10],[0,10]],two:[[0,10],[0,10]]}}}]}];
 w.snapshots=[source,front,side];w.recordings=[recording];w.activeRecordingId=recording.id;return w;
}
const evaluate=(w:RecordingSnapshotWorkspace,x:number,immutableInputs=false)=>evaluateRecordingSnapshot(w,'recording',{snapshotId:'front',angle:at(x),useDraft:false,diagnostics:'preview',immutableInputs});

describe('snapshot interpolation weight assets',()=>{
 it('is identity by default and fixes endpoints for every monotone response',()=>{
  for(const points of [undefined,linear,slow,[[0,0],[.01,.8],[.8,.8],[1,1]] as Point2[]]){
   expect(evaluateSnapshotWeightCurve(points,-2)).toBe(0);expect(evaluateSnapshotWeightCurve(points,3)).toBe(1);
   let previous=0;for(let i=0;i<=500;i++){const t=i/500,value=evaluateSnapshotWeightCurve(points,t);expect(value).toBeGreaterThanOrEqual(previous-1e-12);expect(value).toBeLessThanOrEqual(1);previous=value;}
  }
  for(const t of [0,.1,.3,.5,.9,1])expect(evaluateSnapshotWeightCurve(undefined,t)).toBe(t);
  expect(evaluateSnapshotWeightCurve(slow,.5)).toBe(.2);
 });
 it('rejects ambiguous, non-normalized or non-monotone authoring data',()=>{
  expect(()=>validateSnapshotInterpolationWeight(weight())).not.toThrow();
  for(const points of [[[0,0],[.5,.8],[.6,.7],[1,1]],[[0,0],[.5,.3],[.5,.8],[1,1]],[[0,.1],[1,1]],[[0,0],[1,Infinity]]] as Point2[][])expect(()=>validateSnapshotInterpolationWeight(weight(undefined,points))).toThrow();
  expect(()=>validateSnapshotInterpolationWeight({...weight(),endSnapshotId:'front'})).toThrow();
 });
 it('uses curve override before layer fallback and reverses physical progress coherently',()=>{
  const r=fixture().recordings[0];r.interpolationWeights=[weight(),weight('one',linear)];
  expect(snapshotInterpolationWeight(r,'front','side','layer',.5,'one')).toBe(.5);expect(snapshotInterpolationWeight(r,'front','side','layer',.5,'two')).toBe(.2);
  expect(resolveSnapshotInterpolationWeight(r,'side','front','layer','two').reversed).toBe(true);
  for(const t of [.1,.25,.6,.9])expect(snapshotInterpolationWeight(r,'side','front','layer',1-t)).toBeCloseTo(1-snapshotInterpolationWeight(r,'front','side','layer',t));
  expect(snapshotInterpolationWeight(r,'front','side','other-layer',.3)).toBe(.3);
 });
 it('retimes real layer placement and direct shape while leaving sparse keys and originals untouched',()=>{
  const w=fixture(),r=w.recordings[0],plain=evaluate(w,45);expect(plain.state.layers.layer.placement?.translation[0]).toBe(5);
  r.interpolationWeights=[weight()];const before=JSON.stringify(w),count=snapshotAuthoredKeyCount(r),result=evaluate(w,45);
  expect(result.state.layers.layer.placement?.translation[0]).toBeCloseTo(2);expect(result.state.layers.layer.shape?.nodes.a[1]).toBeCloseTo(2);expect(result.drawing.nodes.find(n=>n.id==='a')?.position).toEqual([2,2]);
  expect(evaluate(w,0).state.layers.layer.placement?.translation[0]).toBe(0);expect(evaluate(w,90).state.layers.layer.placement?.translation[0]).toBe(10);expect(snapshotAuthoredKeyCount(r)).toBe(count);expect(JSON.stringify(w)).toBe(before);
 });
 it('keeps every authored intermediate key exact and uses the restricted response inside each bracket',()=>{
  const w=fixture(),r=w.recordings[0],track=r.tracks[0];if(track.channel!=='placement')throw Error('fixture');track.keys.unshift({id:'middle',angle:at(45),value:placement(8)});r.interpolationWeights=[weight()];
  expect(evaluate(w,45).state.layers.layer.placement?.translation[0]).toBe(8);
  const quarter=evaluateSnapshotWeightCurve(slow,.25)/evaluateSnapshotWeightCurve(slow,.5);expect(evaluate(w,22.5).state.layers.layer.placement?.translation[0]).toBeCloseTo(quarter*8);
  const later=(evaluateSnapshotWeightCurve(slow,.75)-.2)/.8;expect(evaluate(w,67.5).state.layers.layer.placement?.translation[0]).toBeCloseTo(8+later*2);
  expect(track.keys.map(key=>key.id)).toEqual(['middle','end-placement']);
 });
 it('uses local linear timing for a flat response subsegment and leaves unrelated angle segments alone',()=>{
  const w=fixture(),r=w.recordings[0],track=r.tracks[0];if(track.channel!=='placement')throw Error('fixture');track.keys=[{id:'a',angle:at(22.5),value:placement(1)},{id:'b',angle:at(67.5),value:placement(3)}];r.interpolationWeights=[weight(undefined,[[0,0],[.25,.5],[.75,.5],[1,1]])];
  expect(evaluate(w,45).state.layers.layer.placement?.translation[0]).toBe(2);
  const map=snapshotTrackProgressMapper(r,w.snapshots,'layer')!;expect(map(at(-90),at(0),.4)).toBe(.4);expect(map({x:0,y:10},{x:90,y:10},.4)).toBe(.4);
 });
 it('retimes curve handle and exclusive-node deltas without splitting a shared endpoint',()=>{
  const w=fixture(),r=w.recordings[0];r.interpolationWeights=[weight(),weight('one',linear)];const before=JSON.stringify(r.tracks),result=evaluate(w,45),shape=result.state.layers.layer.shape!;
  expect(shape.nodes.a[1]).toBe(5);expect(shape.nodes.b[1]).toBeCloseTo(2);expect(shape.nodes.c[1]).toBeCloseTo(2);expect(shape.handles.one[0][1]).toBe(5);expect(shape.handles.two[0][1]).toBeCloseTo(2);
  expect(result.drawing.curves[0].nodes[1]).toBe(result.drawing.curves[1].nodes[0]);expect(result.drawing.nodes.filter(n=>n.id==='b')).toHaveLength(1);expect(result.state.layers.layer.placement?.translation[0]).toBeCloseTo(2);evaluate(w,90);expect(JSON.stringify(r.tracks)).toBe(before);
 });
 it('keeps a linked relation on one stable layer authority even with conflicting curve responses',()=>{
  const w=fixture(),r=w.recordings[0];w.library.nodes.d={id:'d',position:[1,0]};w.library.curves.two.nodes[0]='d';w.snapshots[0].relations.endpointLinks={add:[{id:'link',a:{curveId:'one',end:1},b:{curveId:'two',end:0}}]};
  for(const view of w.snapshots.slice(1))view.deformation.relationPositions.junction={sourceLinkIds:['link'],offset:[0,0]};
  r.tracks.push({id:'relation',targetId:'junction',channel:'relationPosition',keys:[{id:'relation-end',angle:at(90),value:[0,10]}]});r.interpolationWeights=[weight(),weight('one',linear)];
  const result=evaluate(w,45),b=result.drawing.nodes.find(n=>n.id==='b')!,d=result.drawing.nodes.find(n=>n.id==='d')!;expect(b.position).toEqual(d.position);expect(result.state.relationPositions.junction.offset[1]).toBeCloseTo(2);
  const owners=snapshotWeightNodeOwners(result.source);expect(owners.get('b')).toEqual({layerId:'layer'});expect(owners.get('d')).toEqual({layerId:'layer'});
 });
 it('invalidates mutable and immutable pose caches when only a response asset changes',()=>{
  const w=fixture(),r=w.recordings[0];r.interpolationWeights=[weight()];const first=evaluate(w,45,true);expect(evaluate(w,45,true)).toBe(first);
  const next={...w,recordings:[{...r,interpolationWeights:[weight(undefined,linear)]}]};const changed=evaluate(next,45,true);expect(changed).not.toBe(first);expect(changed.state.layers.layer.placement?.translation[0]).toBe(5);expect(changed.preShapeDrawing).toBe(first.preShapeDrawing);
  const mutable=fixture();mutable.recordings[0].interpolationWeights=[weight()];expect(evaluate(mutable,45).state.layers.layer.placement?.translation[0]).toBeCloseTo(2);mutable.recordings[0].interpolationWeights![0].points=linear;expect(evaluate(mutable,45).state.layers.layer.placement?.translation[0]).toBe(5);
 });
 it('keeps linked layer placements on one response authority despite conflicting layer assets',()=>{
  const w=fixture(),r=w.recordings[0];w.library.nodes.d={id:'d',position:[1,0]};w.library.curves.two.nodes[0]='d';w.snapshots[0].relations.endpointLinks={add:[{id:'link',a:{curveId:'one',end:1},b:{curveId:'two',end:0}}]};
  const original=w.snapshots[0].layers[0];if(original.kind!=='original')throw Error('fixture');original.items=['one'];w.snapshots[0].layers.push({...original,id:'second-source',items:['two']});
  for(const view of w.snapshots.slice(1))view.layers.push({kind:'reference',id:'second-layer',name:'Second',baseSnapshotId:'source',baseLayerId:'second-source'});
  r.tracks=r.tracks.filter(track=>track.channel==='placement');r.tracks.push({id:'second-placement',channel:'placement',targetId:'second-layer',keys:[{id:'second-end',angle:at(90),value:placement(10)}]});r.interpolationWeights=[weight(),{...weight(undefined,linear),id:'second-weight',target:{layerId:'second-layer'}}];
  const result=evaluate(w,45);expect(result.state.layers.layer.placement?.translation[0]).toBeCloseTo(2);expect(result.state.layers['second-layer'].placement?.translation[0]).toBeCloseTo(2);expect(result.drawing.nodes.find(n=>n.id==='b')?.position).toEqual(result.drawing.nodes.find(n=>n.id==='d')?.position);expect(result.diagnostics.some(diagnostic=>diagnostic.message.includes('placement separates'))).toBe(false);expect(result.diagnostics.some(diagnostic=>diagnostic.message.includes('Second uses Layer as its placement response authority'))).toBe(true);
 });
 it('weights a single-layer Warp while preserving a shared Warp as one domain',()=>{
  const w=fixture(),r=w.recordings[0],rest=createWarpGrid({min:[-1,-1],max:[3,1]},1,1),grid=structuredClone(rest);for(const node of grid.nodes)for(const field of ['position','handleU','handleV'] as const)node[field][1]+=1;
  for(const view of w.snapshots.slice(1)){view.deformation.warps=[{id:'warp',name:'Warp',restGrid:rest,grid:rest}];view.deformation.bindings=[{layerId:'layer',warpId:'warp'}];}
  r.tracks=[{id:'warp-track',channel:'warp',targetId:'warp',keys:[{id:'end',angle:at(90),value:grid}]}];r.interpolationWeights=[weight()];expect(evaluate(w,45).state.warps[0].grid.nodes[0].position[1]).toBeCloseTo(rest.nodes[0].position[1]+.2);
  for(const view of w.snapshots.slice(1))view.deformation.bindings.push({layerId:'another-layer',warpId:'warp'});expect(evaluate(w,45).state.warps[0].grid.nodes[0].position[1]).toBeCloseTo(rest.nodes[0].position[1]+.5);
 });
});
