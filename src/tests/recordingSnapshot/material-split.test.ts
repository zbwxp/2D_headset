import {deleteCurves} from '../../domain/drawing/commands';
import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {applyCurveSplitIntent,createCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {snapshotMaterialPartitionValue} from '../../domain/recordingSnapshot/materialSplit';
const cid=(id:string)=>canonicalElementId('$working',id);
const sample=(w:RecordingSnapshotWorkspace,x:number,useDraft=false)=>evaluateRecordingSnapshot(w,'recording',{angle:{x,y:0},useDraft,diagnostics:'preview'}).drawing;
function fixture(curved=false,reverse=false){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[1/3,curved?.3:0],[2/3,curved?-.2:0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}],displayIntervals:[{id:'material',scope:'CURVE',anchor:{id:'curve',reverse},ranges:[{id:'range',mode:'HIDE',start:0,end:0}]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing}),w=project.recordingSnapshots,source=drawingSnapshotForArtwork(w,'$working')!,front=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
 front.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];side.layers=structuredClone(front.layers);
 const appearance=structuredClone(resolveSnapshot({...w,snapshots:[...w.snapshots,front]},front.id,{diagnostics:'preview'}).source.displayIntervals![0]);appearance.ranges[0].end=.8;
 side.deformation.layers.slot={intervals:{[cid('material')]:{appearance,enabled:{}}},...(curved?{shape:{nodes:{[cid('b')]:[.5,.3]},handles:{[cid('curve')]:[[.1,.2],[-.1,.4]]}}}:{})};
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[front.id,side.id];recording.activeSnapshotId=front.id;recording.angleGraph=createSnapshotAngleGraph([front,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));const edge=recording.angleGraph.mesh.edges[0];recording.angleGraph.propertyResponses={edges:{[edge.id]:[{target:{kind:'interval-endpoint',layerId:'slot',sourceTrackId:cid('material'),rangeId:cid('range'),end:'end'},knots:[[1/3,0]]}]},triangles:{}};
 w.snapshots.push(front,side);w.recordings=[recording];w.activeRecordingId=recording.id;
 let next=0;const intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:()=>`split-${++next}`});return {project,w,drawing,intent,canonical:mapCurveSplitIntent(intent,cid)};
}
const split=(f:ReturnType<typeof fixture>)=>prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project;
function expectMaterial(before:DrawingDocument,after:DrawingDocument,intent:ReturnType<typeof fixture>['canonical'],precision=9){const wanted=applyCurveSplitIntent(before,intent,{propagate:true}).document;for(const track of wanted.displayIntervals??[]){const actual=after.displayIntervals?.find(value=>value.id===track.id);expect(actual).toBeDefined();for(const range of track.ranges)for(const end of ['start','end'] as const)expect(actual!.ranges.find(value=>value.id===range.id)![end]).toBeCloseTo(range[end],precision);}}

describe('parent source split preserves logical interval response fields',()=>{
 it('retains the 0collapsed / 30zero / 90gap field and every correction/child identity through JSON and Undo restoration',()=>{
  const f=fixture(),angles=[0,1,15,29.99,30,31,45,59,60,61,75,89,90],before=angles.map(x=>sample(f.w,x)),saved=JSON.stringify(f.w),responses=structuredClone(f.w.recordings[0].angleGraph!.propertyResponses),after=split(f).recordingSnapshots!;
  expect(JSON.stringify(f.w)).toBe(saved);expect(after.recordings[0].angleGraph!.propertyResponses).toEqual(responses);expect(after.recordings[0].angleGraph!.materialPartitions).toHaveLength(1);expect(after.recordings[0].angleGraph!.mesh).toEqual(f.w.recordings[0].angleGraph!.mesh);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(after)));for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(loaded,angles[i]),f.canonical);
  for(const x of [0,15,30])for(const track of sample(loaded,x).displayIntervals??[])expect(track.ranges[0].start).toBe(track.ranges[0].end);
  for(const id of f.canonical.childCurveIds)for(const snapshot of ['front','side'])expect(resolveSnapshot(loaded,snapshot).drawing.curves.some(curve=>curve.id===id)).toBe(true);
  expect(f.project.recordingSnapshots).toBe(f.w);expect(f.w.library.curves[cid('curve')]).toBeDefined();
 });
 it.each([false,true])('keeps curved live material transport, reversed=%s, before clipping each child',reverse=>{
  const f=fixture(true,reverse),angles=[0,15,30,45,60,75,90],before=angles.map(x=>sample(f.w,x)),after=split(f).recordingSnapshots!;
  for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(after,angles[i]),f.canonical,10);
 });
 it('retains an existing path-scoped property field when its source curve is split',()=>{
  const f=fixture(true);delete f.drawing.displayIntervals![0].scope;for(const snapshot of f.w.snapshots){for(const track of snapshot.relations.displayIntervals?.add??[])delete track.scope;for(const layer of Object.values(snapshot.deformation.layers))for(const value of Object.values(layer.intervals??{}))if(value.appearance)delete value.appearance.scope;}let next=0;f.intent=createCurveSplitIntent(f.drawing,'curve',.4,{allocateId:()=>`path-${++next}`});f.canonical=mapCurveSplitIntent(f.intent,cid);
  const angles=[15,30,45,60,75,90],before=angles.map(x=>sample(f.w,x)),after=split(f).recordingSnapshots!;for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(after,angles[i]),f.canonical,9);
 });
 it('keeps local nonuniform placement while preserving the property trajectory',()=>{
  const f=fixture(true),side=f.w.snapshots.find(snapshot=>snapshot.id==='side')!;side.deformation.layers.slot.placement={translation:[.2,-.1],rotation:.3,scale:1,scaleX:1.3,scaleY:.7};
  const angles=[15,30,45,60,75,90],before=angles.map(x=>sample(f.w,x)),after=split(f).recordingSnapshots!;expect(after.snapshots.find(snapshot=>snapshot.id==='side')!.deformation.layers.slot.placement).toEqual(side.deformation.layers.slot.placement);for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(after,angles[i]),f.canonical,9);
 });
 it('preserves material when the source is split after a real60 insertion already retained its fields',()=>{
  const f=fixture(true);applySnapshotCommand(f.w,{op:'createSnapshot',angle:{x:60,y:0}});const angles=[15,30,45,60,75],before=angles.map(x=>sample(f.w,x));const after=split(f).recordingSnapshots!;for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(after,angles[i]),f.canonical,9);expect(after.recordings[0].angleGraph!.materialBasisRecipes).toBeDefined();
 });
 it('retains exact logical fields through a second parent source split with the same descendant IDs',()=>{
  const f=fixture(true),first=split(f),w=first.recordingSnapshots!,angles=[15,30,45,60,75],before=angles.map(x=>sample(w,x));let next=0;const intent=createCurveSplitIntent(first.drawing!,f.intent.childCurveIds[0],.6,{allocateId:()=>`second-${++next}`}),canonical=mapCurveSplitIntent(intent,cid),second=prepareSnapshotEdit(snapshotEditContext(first,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(first.drawing!,intent).document,intent}).project.recordingSnapshots!;
  expect(second.recordings[0].angleGraph!.materialPartitions![0].parts).toHaveLength(3);for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(second,angles[i]),canonical,9);
 });
 it.each([false,true])('retains a live independently edited child measurement when that child is split again, reversed=%s',reverse=>{
  const f=fixture(true,reverse),first=split(f),changed=structuredClone(first.drawing!);changed.curves.find(curve=>curve.id===f.intent.childCurveIds[0])!.handles[0][1]+=.157;
  const edited=prepareSnapshotEdit(snapshotEditContext(first,true),{kind:'original-geometry',drawing:changed}).project,w=edited.recordingSnapshots!,angles=[0,1,15,29.99,30,30.01,45,60,75,89,90],before=angles.map(x=>sample(w,x)),saved=JSON.stringify(edited),responses=structuredClone(w.recordings[0].angleGraph!.propertyResponses);
  let next=0;const intent=createCurveSplitIntent(edited.drawing!,f.intent.childCurveIds[0],.613,{allocateId:()=>`edited-child-${++next}`}),canonical=mapCurveSplitIntent(intent,cid),second=prepareSnapshotEdit(snapshotEditContext(edited,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(edited.drawing!,intent).document,intent}).project.recordingSnapshots!,loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(second)));
  expect(JSON.stringify(edited)).toBe(saved);expect(loaded.recordings[0].angleGraph!.propertyResponses).toEqual(responses);expect(loaded.recordings[0].angleGraph!.materialPartitions![0].parts).toHaveLength(3);
  for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(loaded,angles[i]),canonical,10);
  for(const angle of [0,15,30])for(const track of sample(loaded,angle).displayIntervals??[])expect(track.ranges[0].start).toBe(track.ranges[0].end);
 });
 it('preserves a property draft and saved field independently through the source split',()=>{
  const f=fixture(true),g=f.w.recordings[0].angleGraph!,edge=g.mesh.edges[0],target=g.propertyResponses!.edges[edge.id][0].target;g.correctionFrames=[{id:'property-draft',angle:{x:60,y:0},status:'draft',propertyResponses:{edges:{[edge.id]:[{target,knots:[[1/3,0],[2/3,.8]]}]},triangles:{}}}];
  const angles=[15,30,45,60,75],saved=angles.map(x=>sample(f.w,x)),draft=angles.map(x=>sample(f.w,x,true)),before=JSON.stringify(g.correctionFrames),after=split(f).recordingSnapshots!;
  expect(JSON.stringify(after.recordings[0].angleGraph!.correctionFrames)).toBe(before);for(let i=0;i<angles.length;i++){expectMaterial(saved[i],sample(after,angles[i]),f.canonical,9);expectMaterial(draft[i],sample(after,angles[i],true),f.canonical,9);}
 });
 it('keeps original triangular property support and later shared-edge evaluations',()=>{
  const f=fixture(true),third=structuredClone(f.w.snapshots.find(s=>s.id==='side')!);third.id='up';third.angle={x:0,y:90};third.deformation.layers.slot.shape!.nodes[cid('b')]=[-.2,.4];f.w.snapshots.push(third);const r=f.w.recordings[0];r.snapshotIds.push(third.id);r.angleGraph=createSnapshotAngleGraph(r.snapshotIds.map(id=>{const s=f.w.snapshots.find(s=>s.id===id)!;return {snapshotId:id,angle:s.angle};}));const g=r.angleGraph,triangle=g.mesh.triangles[0],target={kind:'interval-endpoint' as const,layerId:'slot',sourceTrackId:cid('material'),rangeId:cid('range'),end:'end' as const};g.propertyResponses={edges:{[g.mesh.edges[0].id]:[{target,knots:[[.4,.15]]}]},triangles:{[triangle.id]:[{target,samples:[{id:'inside',at:[.2,.3,.5],weights:[.4,.1,.5]}]}]}};
  const angles=[{x:10,y:10},{x:30,y:20},{x:50,y:10},{x:0,y:45},{x:45,y:45}],before=angles.map(angle=>evaluateRecordingSnapshot(f.w,'recording',{angle,useDraft:false}).drawing),after=split(f).recordingSnapshots!;expect(after.recordings[0].angleGraph!.propertyResponses).toEqual(g.propertyResponses);for(let i=0;i<angles.length;i++)expectMaterial(before[i],evaluateRecordingSnapshot(after,'recording',{angle:angles[i],useDraft:false}).drawing,f.canonical,9);
 });
 it('archives a logical field when a source child is deleted and never reinterprets it on the surviving piece',()=>{
  const f=fixture(),first=split(f),before=JSON.stringify(first),changed=deleteCurves(first.drawing!,[f.intent.childCurveIds[1]]),next=upsertDrawingSource(first.recordingSnapshots!,'$working',changed),g=next.recordings[0].angleGraph!;
  expect(JSON.stringify(first)).toBe(before);expect(g.materialPartitions).toEqual([]);expect(Object.values(g.propertyResponses!.edges).flat()).toEqual([]);expect(g.orphanedResponses!.at(-1)!.materialPartitions).toHaveLength(1);expect(Object.values(g.orphanedResponses!.at(-1)!.propertyResponses!.edges).flat()).toHaveLength(1);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(next)));for(const x of [0,30,45,60,90])expect(sample(loaded,x).curves.some(curve=>curve.id===f.canonical.childCurveIds[1])).toBe(false);
 });
 it('keeps child source geometry live in the logical material domain without retained curve snapshots',()=>{
  const f=fixture(true),first=split(f),before=sample(first.recordingSnapshots!,45),changed=structuredClone(first.drawing!);changed.curves.find(curve=>curve.id===f.intent.childCurveIds[0])!.handles[0][1]+=.15;
  const next=upsertDrawingSource(first.recordingSnapshots!,'$working',changed),after=sample(next,45);expect(after.curves).not.toEqual(before.curves);expect(after.displayIntervals).not.toEqual(before.displayIntervals);expect(JSON.stringify(next.recordings[0].angleGraph!.materialPartitions)).not.toMatch(/"nodes"|"handles"|"position"|"drawing"/);for(const track of sample(next,15).displayIntervals??[])expect(track.ranges[0].start).toBe(track.ranges[0].end);
 });
 it('keeps a collapsed nonzero material address on both exact child restrictions',()=>{
  const f=fixture();f.drawing.displayIntervals![0].ranges[0]={id:'range',mode:'HIDE',start:.7,end:.7};const splitDrawing=applyCurveSplitIntent(f.drawing,f.intent).document;
  expect(splitDrawing.displayIntervals![0].ranges[0].start).toBe(1);expect(splitDrawing.displayIntervals![0].ranges[0].end).toBe(1);expect(splitDrawing.displayIntervals![1].ranges[0].start).toBeCloseTo(.5,14);expect(splitDrawing.displayIntervals![1].ranges[0].start).toBe(splitDrawing.displayIntervals![1].ranges[0].end);
 });
 it('restricts the original endpoint brushes with the response and permits later insertion when a taper crosses the seam',()=>{
  const f=fixture();f.drawing.displayIntervals![0].ranges[0].inkEnds=[{taper:.04},{taper:.08}];for(const snapshot of f.w.snapshots){for(const track of snapshot.relations.displayIntervals?.add??[])for(const range of track.ranges)range.inkEnds=[{taper:.04},{taper:.08}];for(const layer of Object.values(snapshot.deformation.layers))for(const value of Object.values(layer.intervals??{}))if(value.appearance)for(const range of value.appearance.ranges)range.inkEnds=[{taper:.04},{taper:.08}];}
  const angles=[15,30,45,60,75,90],before=angles.map(x=>sample(f.w,x)),after=split(f).recordingSnapshots!;for(let i=0;i<angles.length;i++){const expected=applyCurveSplitIntent(before[i],f.canonical,{propagate:true}).document,actual=sample(after,angles[i]);for(const track of expected.displayIntervals??[])expect(actual.displayIntervals!.find(value=>value.id===track.id)!.ranges[0].inkEnds).toEqual(track.ranges[0].inkEnds);}
  applySnapshotCommand(after,{op:'createSnapshot',angle:{x:60,y:0}});for(let i=0;i<angles.length;i++)expectMaterial(before[i],sample(after,angles[i]),f.canonical,10);
 });
 it('does not author a new response when a clamped child endpoint is set to its existing exact zero',()=>{
  const f=fixture(),w=split(f).recordingSnapshots!,right=f.canonical.intervals[0];applySnapshotCommand(w,{op:'setAngle',angle:{x:30,y:0}});const graph=JSON.stringify(w.recordings[0].angleGraph);applySnapshotCommand(w,{op:'changeInterval',layerId:'slot',sourceTrackId:right.rightTrackId,rangeId:right.ranges[0].rightRangeId,end:0});expect(JSON.stringify(w.recordings[0].angleGraph)).toBe(graph);
  applySnapshotCommand(w,{op:'setAngle',angle:{x:0,y:0}});const snapshot=JSON.stringify(w.snapshots.find(snapshot=>snapshot.id==='front'));applySnapshotCommand(w,{op:'changeInterval',layerId:'slot',sourceTrackId:right.rightTrackId,rangeId:right.ranges[0].rightRangeId,end:0});expect(JSON.stringify(w.snapshots.find(snapshot=>snapshot.id==='front'))).toBe(snapshot);
 });
 it('uses the same logical material basis for a right-child correction and a real-basis edit without geometry changes',()=>{
  const f=fixture(),w=split(f).recordingSnapshots!,right=f.canonical.intervals[0],rangeId=right.ranges[0].rightRangeId;
  applySnapshotCommand(w,{op:'setAngle',angle:{x:45,y:0}});const geometry=structuredClone(sample(w,45));applySnapshotCommand(w,{op:'changeInterval',layerId:'slot',sourceTrackId:right.rightTrackId,rangeId,end:.5});applySnapshotCommand(w,{op:'updateEndpointCorrection'});
  expect(sample(w,45).displayIntervals!.find(track=>track.id===right.rightTrackId)!.ranges[0].end).toBeCloseTo(.5,12);expect(sample(w,45).nodes).toEqual(geometry.nodes);expect(sample(w,45).curves).toEqual(geometry.curves);
  applySnapshotCommand(w,{op:'setAngle',angle:{x:90,y:0}});applySnapshotCommand(w,{op:'changeInterval',layerId:'slot',sourceTrackId:right.rightTrackId,rangeId,end:.7});applySnapshotCommand(w,{op:'saveSelected',layerIds:['slot']});expect(sample(w,90).displayIntervals!.find(track=>track.id===right.rightTrackId)!.ranges[0].end).toBeCloseTo(.7,12);expect(sample(w,90).displayIntervals!.find(track=>track.id===cid('material'))!.ranges[0].end).toBe(1);
 });
 it('retains partition metadata and material trajectories through a subsequent real60 insertion',()=>{
  const f=fixture(),w=split(f).recordingSnapshots!,angles=[15,30,45,60,75],before=angles.map(x=>sample(w,x).displayIntervals),partition=structuredClone(w.recordings[0].angleGraph!.materialPartitions);applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0}});
  expect(w.recordings[0].angleGraph!.materialPartitions).toEqual(partition);for(let i=0;i<angles.length;i++)for(const [j,track] of sample(w,angles[i]).displayIntervals!.entries())for(const end of ['start','end'] as const)expect(track.ranges[0][end]).toBeCloseTo(before[i]![j].ranges[0][end],12);
 });
});
