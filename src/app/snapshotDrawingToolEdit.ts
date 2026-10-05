import type {DrawingControlEditPlan} from '../domain/drawing/controlEditPlan';
import type {DrawingDocument} from '../domain/drawing/model';
import type {Angle} from '../domain/recordingSnapshot/model';
import type {SnapshotNodeUnbindIntent} from '../domain/recordingSnapshot/nodeForks';
import {prepareSnapshotDrawingControlTarget} from '../domain/recordingSnapshot/drawingControlTargetEdit';
import {snapshotWithMirrorMetadata} from '../domain/recordingSnapshot/mirrorMetadata';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {snapshotDrawingEditContent} from '../domain/recordingSnapshot/drawingControlTargetEdit';
import {prepareSnapshotEdit,type SnapshotEditContext,type SnapshotEditPlan} from './snapshotEditTransaction';

export type SnapshotDrawingToolIntent={kind:'geometry';controlPlan?:DrawingControlEditPlan}|{kind:'topology';nodeUnbind?:SnapshotNodeUnbindIntent}|{kind:'mirror-metadata'};
export interface SnapshotDrawingToolEdit {recordingId:string;snapshotId:string;angle:Angle;beforeDrawing:DrawingDocument;drawing:DrawingDocument;intent:SnapshotDrawingToolIntent;validation?:'preview'|'full'}
/** One submitted Drawing gesture, one validated common transaction and Undo. */
export function prepareSnapshotDrawingToolEdit(context:SnapshotEditContext,edit:SnapshotDrawingToolEdit):SnapshotEditPlan {
 if(edit.intent.kind==='topology')return prepareSnapshotEdit(context,{kind:'local-drawing-topology',...edit,...(edit.intent.nodeUnbind?{nodeUnbind:edit.intent.nodeUnbind}:{})});
 const intent=edit.intent;
 return prepareSnapshotEdit(context,{kind:'snapshot-build',validation:edit.validation,build:before=>{
 let workspace=before;
 if(intent.kind==='mirror-metadata'){
  const recording=before.recordings.find(value=>value.id===edit.recordingId),snapshot=before.snapshots.find(value=>value.id===edit.snapshotId),bound=recording?.mode==='triangulated'?recording.angleGraph?.mesh.vertices.find(value=>value.snapshotId===edit.snapshotId)?.angle:snapshot?.angle;
  if(!recording||recording.legacy||!snapshot||!recording.snapshotIds.includes(snapshot.id)||!bound||bound.x!==edit.angle.x||bound.y!==edit.angle.y||recording.angle.x!==edit.angle.x||recording.angle.y!==edit.angle.y)throw Error('Mirror metadata requires a real snapshot at the exact current angle.');
  const current=evaluateRecordingSnapshot(before,recording.id,{angle:edit.angle,useDraft:true,immutableInputs:true,diagnostics:'preview'}).drawing,same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  if(!same(snapshotDrawingEditContent(current),snapshotDrawingEditContent(edit.beforeDrawing))||!same([current.mirrorAxisX,current.mirrorEditing],[edit.beforeDrawing.mirrorAxisX,edit.beforeDrawing.mirrorEditing]))throw Error('The mirror metadata target changed during this Drawing gesture.');
  if(!same(snapshotDrawingEditContent(edit.beforeDrawing),snapshotDrawingEditContent(edit.drawing)))throw Error('Mirror preferences cannot change geometry, topology or appearance.');
  const next=snapshotWithMirrorMetadata(snapshot,current,edit.drawing);if(next!==snapshot)workspace={...before,snapshots:before.snapshots.map(value=>value===snapshot?next:value)};
 }else workspace=prepareSnapshotDrawingControlTarget(before,{...edit,controlPlan:intent.controlPlan});
 return workspace;
 }});
}
