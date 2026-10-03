import {describe,it,expect} from 'vitest';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {rebindSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {snapshotAuthoredKeyCount} from '../../domain/recordingSnapshot/tracks';

function fixture(){
 const w=emptyRecordingSnapshotWorkspace();w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};w.library.curves={c:{id:'c',name:'Line',nodes:['a','b'],handles:[[.2,.1],[.8,.1]],visible:true,locked:false,width:.01}};
 const views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),emptyRecordingSnapshot('up','Up','view',{x:0,y:90})];
 views.forEach((view,index)=>{view.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['c']}];view.deformation.layers.layer={placement:{translation:index===1?[2,0]:index===2?[0,2]:[0,0],rotation:0,scale:1}};});
 const r=emptySnapshotRecording('r');r.mode='triangulated';r.snapshotIds=views.map(v=>v.id);r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));w.snapshots=views;w.recordings=[r];w.activeRecordingId=r.id;return {w,r,views};
}
describe('triangulated recording runtime',()=>{
 it('uses the same final-control surface on edges and inside the triangle',()=>{
  const {w}=fixture(),middle=evaluateRecordingSnapshot(w,'r',{angle:{x:45,y:0}}),inside=evaluateRecordingSnapshot(w,'r',{angle:{x:30,y:30}});
  expect(middle.angleSurface?.role).toBe('correction');expect(middle.drawing.nodes[0].position).toEqual([1,0]);
  expect(inside.drawing.nodes[0].position[0]).toBeCloseTo(2/3,14);expect(inside.drawing.nodes[0].position[1]).toBeCloseTo(2/3,14);
 });
 it('keeps a snapshot pose fixed when only its Recorder angle binding changes',()=>{
  const {w,r}=fixture();const before=evaluateRecordingSnapshot(w,'r',{angle:{x:90,y:0}}).drawing;
  r.angleGraph!.mesh=rebindSnapshotVertex(r.angleGraph!.mesh,'side',{x:80,y:0});
  const after=evaluateRecordingSnapshot(w,'r',{angle:{x:80,y:0}});expect(after.drawing).toEqual(before);expect(w.snapshots[1].angle).toEqual({x:90,y:0});expect(after.angleSurface?.role).toBe('basis');
 });
 it('invalidates only response evaluation after a cached edge response changes',()=>{
  const {w,r}=fixture(),at={angle:{x:45,y:0},useDraft:true,immutableInputs:true} as const;
  const first=evaluateRecordingSnapshot(w,'r',at),simplex=first.angleSurface!.simplex!,edge=r.angleGraph!.mesh.edges.find(e=>e.id===simplex.simplexId)!,firstSnapshot=r.angleGraph!.mesh.vertices.find(v=>v.id===edge.vertexIds[0])!.snapshotId;
  r.angleGraph={...r.angleGraph!,edgeResponses:{[edge.id]:{nodes:{a:{x:[[.5,firstSnapshot==='front'?.25:.75]]}},handles:{}}}};
  const changed=evaluateRecordingSnapshot(w,'r',at);expect(changed.drawing.nodes[0].position[0]).toBeCloseTo(.5,14);expect(changed.drawing).not.toBe(first.drawing);
 });
 it('returns red fallback geometry separately outside the actual covered region',()=>{
  const {w}=fixture(),before=JSON.stringify(w),result=evaluateRecordingSnapshot(w,'r',{angle:{x:90,y:90}});
  expect(result.angleSurface?.role).toBe('outside');expect(result.drawing.curves).toHaveLength(0);expect(result.angleSurface!.outsideCurves).toHaveLength(1);expect(result.angleSurface!.outsideCurves[0].evaluatedAngle).toEqual({x:45,y:45});expect(JSON.stringify(w)).toBe(before);
 });
 it('retains vertex geometry, partial membership, and live source updates through reload',()=>{
  const {w}=fixture();w.snapshots[2].layers[0]={kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:[]};
  let result=evaluateRecordingSnapshot(w,'r',{angle:{x:30,y:30}});expect(result.drawing.curves).toHaveLength(0);expect(result.angleSurface!.outsideCurves).toHaveLength(1);
  w.library.nodes.a={...w.library.nodes.a,position:[.2,0]};const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));result=evaluateRecordingSnapshot(reloaded,'r',{angle:{x:0,y:0}});expect(result.drawing.nodes[0].position).toEqual([.2,0]);
 });
 it('changes membership exactly at vertices and edges without a positive or negative epsilon halo',()=>{
  const {w,r,views}=fixture();views[1].angle={x:1,y:0};views[2].angle={x:0,y:1};
  r.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
  w.library.curves.edge={...w.library.curves.c,id:'edge'};w.library.curves.vertex={...w.library.curves.c,id:'vertex'};
  views[0].layers[0]={kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['c','edge','vertex']};
  views[1].layers[0]={kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['c','edge']};
  const before=JSON.stringify(w);
  const vertex=evaluateRecordingSnapshot(w,'r',{angle:{x:0,y:0}}),nearVertex=evaluateRecordingSnapshot(w,'r',{angle:{x:Number.MIN_VALUE,y:0}});
  expect(vertex.angleSurface!.simplex!.kind).toBe('vertex');expect(vertex.drawing.curves.map(curve=>curve.id)).toEqual(['c','edge','vertex']);
  expect(nearVertex.angleSurface!.simplex!.kind).toBe('edge');expect(nearVertex.drawing.curves.map(curve=>curve.id)).toEqual(['c','edge']);
  const edge=evaluateRecordingSnapshot(w,'r',{angle:{x:.25,y:0}}),inside=evaluateRecordingSnapshot(w,'r',{angle:{x:.25,y:Number.MIN_VALUE}}),outside=evaluateRecordingSnapshot(w,'r',{angle:{x:.25,y:-Number.MIN_VALUE}});
  expect(edge.angleSurface!.simplex!.kind).toBe('edge');expect(edge.drawing.curves.map(curve=>curve.id)).toEqual(['c','edge']);
  expect(inside.angleSurface!.simplex!.kind).toBe('triangle');expect(inside.drawing.curves.map(curve=>curve.id)).toEqual(['c']);
  expect(outside.angleSurface!.role).toBe('outside');expect(outside.drawing.curves).toEqual([]);
  expect(snapshotAuthoredKeyCount(r)).toBe(0);expect(JSON.stringify(w)).toBe(before);
 });
 it('does not bridge matching endpoint IDs across an empty real middle snapshot',()=>{
  const {w,r,views}=fixture();views[2].angle={x:45,y:0};views[2].layers=[];
  r.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
  const before=JSON.stringify(w);
  for(const x of [0,90])expect(evaluateRecordingSnapshot(w,'r',{angle:{x,y:0}}).drawing.curves.map(curve=>curve.id)).toEqual(['c']);
  for(const x of [22.5,45,67.5]){
   const result=evaluateRecordingSnapshot(w,'r',{angle:{x,y:0}});
   expect(result.angleSurface!.simplex!.snapshotIds).toContain('up');expect(result.drawing.curves).toEqual([]);
  }
  expect(JSON.stringify(w)).toBe(before);
 });
});
