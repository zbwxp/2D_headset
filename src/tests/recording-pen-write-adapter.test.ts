import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../app/snapshotEditTransaction';
import {createCurve} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {canonicalElementId,upsertDrawingSource} from '../domain/recordingSnapshot/sources';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {beginPenGesture,movePenGesture,finishPenGesture,type PenState} from '../ui/drawing/penController';
import {createDrawingLayer,deleteDrawingSelection,duplicateDrawingLayers} from '../ui/drawing/layerStructuralCommands';

function fixture(){
 const drawing=createCurve({...emptyDrawing(),layers:[{id:'layer',name:'Drawing layer',visible:true,locked:false,items:[]}]},'layer',[[0,0],[.2,.2],[.8,.2],[1,0]],.01,'Original','original');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view','View'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording','Recording');
 view.layers=[{kind:'reference',id:'slot',name:'Local reference',baseSnapshotId:source.id,baseLayerId:canonicalElementId('source','layer')}];side.layers=structuredClone(view.layers);
 view.deformation.layers.slot={placement:{translation:[3,4],rotation:.3,scale:1,scaleX:1.3,scaleY:.7}};
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let project={...createEmptyProject(),drawing,recordingSnapshots:workspace};
 const current=()=>evaluateRecordingSnapshot(project.recordingSnapshots,recording.id,{useDraft:true,immutableInputs:true}).drawing;
 const write=(next:DrawingDocument)=>{const plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'local-drawing-topology',recordingId:recording.id,snapshotId:view.id,angle:recording.angle,beforeDrawing:current(),drawing:next});project=plan.project as typeof project;};
 return {current,write,project:()=>project,source,side};
}
const near=(actual:Point2,expected:Point2)=>actual.forEach((value,axis)=>expect(value).toBeCloseTo(expected[axis],8));

test.each(['POSITION','SMOOTH','CUSP'] as const)('shared %s pen closes through the real Recording write adapter at the visible affine target',join=>{
 const f=fixture(),initial=f.project(),sourceJSON=JSON.stringify(f.source),sideJSON=JSON.stringify(f.side),options={layerId:'slot',unit:200,width:.01,join,taperScale:8,preserveAuthoredBrush:true};
 let state:PenState|null=null;
 const points:Point2[]=[[3.2,4.5],[4.2,4.6],[4.1,5.2],[3.2,4.5]];
 for(const [i,point] of points.entries()){
  const base=f.current(),result=finishPenGesture(movePenGesture(beginPenGesture(base,state,point),[point[0]+.12,point[1]+.2]),options);state=result.state;
  if(!result.candidate){expect(i).toBe(0);continue;}
  f.write(result.candidate.document);const actual=f.current();
  for(const curve of result.candidate.document.curves)shapeOf(actual,curve.id).forEach((p,index)=>near(p,shapeOf(result.candidate!.document,curve.id)[index]));
 }
 expect(state).toBeNull();expect(f.current().curves).toHaveLength(4);expect(f.project().drawing).toBe(initial.drawing);
 expect(JSON.stringify(f.project().recordingSnapshots.snapshots.find(s=>s.id===f.source.id))).toBe(sourceJSON);expect(JSON.stringify(f.project().recordingSnapshots.snapshots.find(s=>s.id===f.side.id))).toBe(sideJSON);
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(f.project().recordingSnapshots)));expect(resolveSnapshot(loaded,'view').drawing.curves.map(c=>c.id)).toEqual(f.current().curves.map(c=>c.id));expect(resolveSnapshot(loaded,'side').drawing.curves).toHaveLength(1);
});

test('native shared layer commands create, duplicate, and delete local structure through the same snapshot transaction',()=>{
 const f=fixture(),original=f.project(),created=createDrawingLayer(f.current(),'Empty');f.write(created.document);const layerId=created.activeLayerId!;
 expect(f.current().layers.find(layer=>layer.id===layerId)?.items).toEqual([]);
 const duplicate=duplicateDrawingLayers(f.current(),['slot']);f.write(duplicate.document);expect(f.current().curves).toHaveLength(2);
 f.write(deleteDrawingSelection(f.current(),{ids:[],layers:[layerId,...duplicate.selection.layers!]}).document);expect(f.current().layers.map(layer=>layer.id)).toEqual(['slot']);expect(f.current().curves).toHaveLength(1);
 f.write(deleteDrawingSelection(f.current(),{ids:f.current().curves.map(curve=>curve.id)}).document);expect(f.current().curves).toEqual([]);expect(f.project().drawing).toBe(original.drawing);expect(resolveSnapshot(f.project().recordingSnapshots,'side').drawing.curves).toHaveLength(1);
});
