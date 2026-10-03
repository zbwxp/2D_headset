import {describe,expect,it} from 'vitest';
import {parseDrawing,type DrawingDocument} from '../../domain/drawing/model';
import fullFace from '../../assets/hairless-symmetric-two-face-mirror.json';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph,validateSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

function fixture(curved=false){
 const w=emptyRecordingSnapshotWorkspace();w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 w.library.curves={line:{id:'line',name:'Line',nodes:['a','b'],handles:[[1/3,curved?.2:0],[2/3,curved?-.3:0]],width:.01,visible:true,locked:false}};
 w.snapshots=['front','side'].map((id,index)=>{const s=emptyRecordingSnapshot(id,id,'view',{x:index*90,y:0});s.layers=[{kind:'original',id:'layer',name:'Layer',visible:true,locked:false,items:['line']}];s.relations.displayIntervals={add:[{id:'interval',anchor:{id:'line',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.3,end:index?.9:.3}]}]};if(index&&curved)s.deformation.layers.layer={shape:{nodes:{b:[.7,.3]},handles:{line:[[0,.4],[0,.1]]}}};return s;});
 const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['front','side'];r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));w.recordings=[r];w.activeRecordingId=r.id;
 return w;
}
const evaluate=(w:RecordingSnapshotWorkspace,x:number)=>evaluateRecordingSnapshot(w,'recording',{angle:{x,y:0},useDraft:false,diagnostics:'preview'});
const range=(w:RecordingSnapshotWorkspace,x:number)=>evaluate(w,x).drawing.displayIntervals![0].ranges[0];
const geometry=(drawing:DrawingDocument)=>({nodes:drawing.nodes,curves:drawing.curves});
const insert=(w:RecordingSnapshotWorkspace,x:number)=>applySnapshotCommand(w,{op:'createSnapshot',angle:{x,y:0},name:`Real ${x}`});
const correction=(w:RecordingSnapshotWorkspace,x:number,end:number)=>{applySnapshotCommand(w,{op:'setAngle',angle:{x,y:0}});applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end});applySnapshotCommand(w,{op:'updateEndpointCorrection'});};

describe('exact retained material supports at real-view insertion',()=>{
 it('retains transported curved-basis material and independent property fields through repeated insertion and JSON reload',()=>{
  const w=fixture(true);correction(w,30,range(w,30).start);
  const angles=[0,1,15,29,30,31,44,45,59,60,61,75,89,90],before=angles.map(x=>evaluate(w,x).drawing),library=JSON.stringify(w.library),originalSnapshots=JSON.stringify(w.snapshots);
  insert(w,60);insert(w,15);
  expect(JSON.stringify(w.library)).toBe(library);expect(JSON.stringify(w.snapshots.slice(0,2))).toBe(originalSnapshots);expect(w.recordings[0].tracks).toEqual([]);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));expect(loaded).toEqual(w);
  for(let i=0;i<angles.length;i++){const after=evaluate(loaded,angles[i]).drawing;expect(after.nodes.map(n=>n.id)).toEqual(before[i].nodes.map(n=>n.id));for(const [j,node] of after.nodes.entries())for(const axis of [0,1])expect(node.position[axis]).toBeCloseTo(before[i].nodes[j].position[axis],11);for(const end of ['start','end'] as const)expect(after.displayIntervals![0].ranges[0][end]).toBeCloseTo(before[i].displayIntervals![0].ranges[0][end],11);}
  const graph=w.recordings[0].angleGraph!;expect(graph.materialBasisRecipes).toBeDefined();expect(JSON.stringify(graph.materialRecipes)).not.toMatch(/"drawing"|"nodes"|"handles"|"deformation"|"ranges"/);expect(w.snapshots.at(-1)).not.toHaveProperty('materialRecipe');
 });
 it('keeps the exact zero-length plateau, supports a new correction key, and leaves geometry and full-curve onion alone',()=>{
  const w=fixture();correction(w,30,.3);insert(w,60);const before=[0,15,30,45,60,90].map(x=>geometry(evaluate(w,x).drawing));
  for(const x of [0,1,15,29.99,30])expect(range(w,x).end).toBe(range(w,x).start);
  correction(w,45,.62);expect(range(w,45).end).toBeCloseTo(.62,13);expect([0,15,30,45,60,90].map(x=>geometry(evaluate(w,x).drawing))).toEqual(before);
  const current=evaluate(w,45),onion=interpolateSnapshotSurfaceOnion(w.recordings[0],current,{startSnapshotId:'front',endSnapshotId:'side'},5);expect(onion.frames.length).toBeGreaterThan(0);for(const frame of onion.frames)expect(frame.drawing?.curves).toHaveLength(1);
  expect(range(parseRecordingSnapshots(JSON.parse(JSON.stringify(w))),45).end).toBeCloseTo(.62,13);
 });
 it('retains an inherited property correction whose native scalar is outside the material range through another insertion',()=>{
  const w=fixture();correction(w,30,.3);insert(w,60);correction(w,45,.98);expect(range(w,45).end).toBeCloseTo(.98,13);
  const angles=[5,20,30,35,40,45,47,50,55,60,75,85],before=angles.map(x=>range(w,x).end);insert(w,45);
  for(let i=0;i<angles.length;i++)expect(range(w,angles[i]).end).toBeCloseTo(before[i],12);
 });
 it('keeps reversed negative-yaw zero support exact after a real negative60 insertion',()=>{
  const w=fixture(),r=w.recordings[0];w.snapshots[1].angle.x=-90;for(const [i,snapshot] of w.snapshots.entries())snapshot.relations.displayIntervals!.add![0].ranges[0]={id:'gap',mode:'HIDE',start:0,end:i?.6:0};r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));
  correction(w,-30,0);insert(w,-60);for(const x of [-.001,-1,-15,-29.99,-30]){expect(range(w,x).end).toBe(0);expect(range(w,x).start).toBe(0);}expect(range(w,-60).end).toBeCloseTo(.3,13);
 });
 it('keeps later real material edits authoritative and source material updates live',()=>{
  const old=fixture(),w=structuredClone(old);insert(w,60);
  old.snapshots[1].relations.displayIntervals!.add![0].ranges[0].end=.8;w.snapshots[1].relations.displayIntervals!.add![0].ranges[0].end=.8;
  for(const x of [15,45,60,75])expect(range(w,x).end).toBeCloseTo(range(old,x).end,13);
  applySnapshotCommand(w,{op:'setAngle',angle:{x:60,y:0}});applySnapshotCommand(w,{op:'changeInterval',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:.77});applySnapshotCommand(w,{op:'saveSelected',layerIds:['layer']});
  expect(range(w,60).end).toBeCloseTo(.77,13);expect(range(w,45).end).toBeGreaterThan(range(old,45).end);expect(range(w,0)).toEqual(range(old,0));expect(range(w,90)).toEqual(range(old,90));
 });
 it('retains triangular material kernels and shared-edge extension after inserting a real interior basis',()=>{
  const w=fixture(true),third=structuredClone(w.snapshots[1]);third.id='up';third.angle={x:0,y:90};third.deformation.layers.layer.shape!.nodes.b=[-.2,.8];third.relations.displayIntervals!.add![0].ranges[0].end=.55;w.snapshots.push(third);
  const r=w.recordings[0];r.snapshotIds.push('up');r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));const graph=r.angleGraph,triangle=graph.mesh.triangles[0],edge=graph.mesh.edges[0],target={kind:'interval-endpoint' as const,layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:'end' as const};
  graph.propertyResponses={edges:{[edge.id]:[{target,knots:[[.3,.1],[.7,.85]]}]},triangles:{[triangle.id]:[{target,samples:[{id:'material-middle',at:[.2,.3,.5],weights:[.1,.6,.3]}]}]}};
  const angles=[{x:10,y:10},{x:30,y:20},{x:45,y:25},{x:5,y:70},{x:60,y:0},{x:0,y:30},{x:45,y:45}],before=angles.map(angle=>evaluateRecordingSnapshot(w,r.id,{angle,useDraft:false}).drawing.displayIntervals![0].ranges[0]);
  applySnapshotCommand(w,{op:'createSnapshot',angle:{x:30,y:20}});
  for(let i=0;i<angles.length;i++){const actual=evaluateRecordingSnapshot(w,r.id,{angle:angles[i],useDraft:false}).drawing.displayIntervals![0].ranges[0];for(const end of ['start','end'] as const)expect(actual[end]).toBeCloseTo(before[i][end],11);}
 });
 it('never resurrects a deleted source curve or layer from retained material support',()=>{
  for(const kind of ['curve','layer']){const w=fixture();insert(w,60);if(kind==='curve'){delete w.library.curves.line;delete w.library.nodes.a;delete w.library.nodes.b;}else for(const snapshot of w.snapshots.slice(0,2))snapshot.layers=[];
   for(const x of [0,15,45,60,75,90]){const d=evaluate(w,x).drawing;expect(d.curves).toEqual([]);expect(d.displayIntervals??[]).toEqual([]);}
  }
 });
 it('preserves one-step project restoration and rejects missing/cyclic recipe dependencies atomically',()=>{
  const w=fixture(),project={...createEmptyProject(),recordingSnapshots:w},before=JSON.stringify(project);const planned=prepareSnapshotBatch(project,{commands:[{op:'createSnapshot',angle:{x:60,y:0}}]});expect(JSON.stringify(project)).toBe(before);expect(planned.recordingSnapshots.snapshots).toHaveLength(3);expect(project.recordingSnapshots.snapshots).toHaveLength(2);
  const graph=structuredClone(planned.recordingSnapshots.recordings[0].angleGraph!),recipe=Object.values(graph.materialBasisRecipes!)[0];recipe.terms[0].bases[0].snapshotId='missing';expect(()=>validateSnapshotAngleGraph(graph)).toThrow(/material.*(source|basis)/i);
  const cyclic=structuredClone(planned.recordingSnapshots.recordings[0].angleGraph!),[id,own]=Object.entries(cyclic.materialBasisRecipes!)[0];own.terms[0].bases[0].snapshotId=id;expect(()=>validateSnapshotAngleGraph(cyclic)).toThrow(/cyclic material/);
 });
 it('accepts the complete bundled face with live routes and whole-layer translation at true negative60',()=>{
  const d=parseDrawing(fullFace),w=emptyRecordingSnapshotWorkspace();for(const key of ['nodes','curves','fills','offsets'] as const)Object.assign(w.library[key],Object.fromEntries(d[key].map(value=>[value.id,value])));
  w.snapshots=['front','side'].map((id,index)=>{const s=emptyRecordingSnapshot(id,id,'view',{x:index*-90,y:0});s.layers=d.layers.map(layer=>({...layer,kind:'original'}));s.relations={joins:{add:d.joins},endpointLinks:{add:d.endpointLinks??[]},groups:{add:d.groups??[]},displayIntervals:{add:d.displayIntervals??[]}};if(index)for(const layer of d.layers)s.deformation.layers[layer.id]={placement:{translation:[.04,-.02],rotation:0,scale:1}};return s;});
  const r=emptySnapshotRecording('recording');r.mode='triangulated';r.snapshotIds=['front','side'];r.activeSnapshotId='front';r.angleGraph=createSnapshotAngleGraph(w.snapshots.map(s=>({snapshotId:s.id,angle:s.angle})));w.recordings=[r];w.activeRecordingId=r.id;
  const angles=[0,-15,-30,-45,-60,-75,-90],before=angles.map(x=>evaluate(w,x).drawing);insert(w,-60);expect(w.snapshots).toHaveLength(3);
  for(let i=0;i<angles.length;i++){const actual=evaluate(w,angles[i]);expect(actual.drawing.curves).toHaveLength(d.curves.length);expect(actual.drawing.layers).toHaveLength(d.layers.length);for(const [j,track] of actual.drawing.displayIntervals!.entries())for(const [k,range] of track.ranges.entries())for(const end of ['start','end'] as const)expect(range[end]).toBeCloseTo(before[i].displayIntervals![j].ranges[k][end],10);expect(actual.diagnostics.filter(issue=>issue.code==='SOURCE_MATERIAL')).toEqual([]);}
 },30000);
});
