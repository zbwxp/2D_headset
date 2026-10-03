import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]},{id:'c',position:[0,1]},{id:'d',position:[1,1]}],curves:[{id:'masked',name:'Masked',nodes:['a','b'],handles:[[.3,0],[.7,0]],width:.01,visible:true,locked:false},{id:'live',name:'Live',nodes:['c','d'],handles:[[.3,1],[.7,1]],width:.01,visible:true,locked:false}],layers:['masked','live'].map(id=>({id:id+'-layer',name:id,items:[id],visible:true,locked:false})),displayIntervals:['masked','live'].map(id=>({id:id+'-interval',anchor:{id,reverse:false},scope:'CURVE',ranges:[{id:id+'-range',mode:'HIDE',start:.2,end:.6}]}))};
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'membership',drawing),source=w.snapshots[0],id=(raw:string)=>canonicalElementId('membership',raw),views=['A','B'].map((sid,index)=>{const s=emptyRecordingSnapshot(sid,sid,'view',{x:90*index,y:0});s.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));return s;});w.snapshots.push(...views);
 const r=emptySnapshotRecording('r');r.mode='triangulated';r.snapshotIds=['A','B'];r.activeSnapshotId='A';r.angleGraph=createSnapshotAngleGraph(views.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));r.angleGraph.propertyResponses={edges:{[r.angleGraph.mesh.edges[0].id]:['masked','live'].map(raw=>({target:{kind:'interval-endpoint',layerId:id(raw+'-layer'),sourceTrackId:id(raw+'-interval'),rangeId:id(raw+'-range'),end:'end'},knots:[[.4,.1]]}))},triangles:{}};w.recordings=[r];w.activeRecordingId=r.id;applySnapshotCommand(w,{op:'createSnapshot',angle:{x:60,y:0}});return {w,id};
}
describe('retained material fields follow local membership',()=>{
 it('suspends only the missing basis material with a diagnostic and restores its exact field after membership returns',()=>{
  const {w,id}=fixture(),angles=[15,45,60,75],evaluate=(workspace:typeof w,x:number)=>evaluateRecordingSnapshot(workspace,'r',{angle:{x,y:0},useDraft:false}),before=angles.map(x=>evaluate(w,x).drawing.displayIntervals),recipes=JSON.stringify([w.recordings[0].angleGraph!.materialRecipes,w.recordings[0].angleGraph!.materialBasisRecipes]);
  const plan=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:w},{commands:[{op:'setAngle',angle:{x:0,y:0}},{op:'excludeElements',layerId:id('masked-layer'),elementIds:[id('masked')]}]}),next=plan.recordingSnapshots;
  expect(JSON.stringify([next.recordings[0].angleGraph!.materialRecipes,next.recordings[0].angleGraph!.materialBasisRecipes])).toBe(recipes);expect(next.library.curves[id('masked')]).toBeDefined();
  for(const x of angles){const result=evaluate(next,x);expect(result.drawing.displayIntervals?.some(track=>track.id===id('masked-interval'))).toBe(false);expect(result.drawing.displayIntervals?.some(track=>track.id===id('live-interval'))).toBe(true);expect(result.diagnostics.some(issue=>issue.code==='SOURCE_MATERIAL'&&issue.message.includes('inactive'))).toBe(true);}
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(next))),restored=prepareSnapshotBatch({...createEmptyProject(),recordingSnapshots:loaded},{commands:[{op:'restoreElements',layerId:id('masked-layer'),elementIds:[id('masked')]}]}).recordingSnapshots;
  for(let i=0;i<angles.length;i++)expect(evaluate(restored,angles[i]).drawing.displayIntervals).toEqual(before[i]);
 });
});
