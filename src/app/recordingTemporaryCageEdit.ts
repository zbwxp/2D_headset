import {applyLayerDomainIntent,type LayerCageDomainIntent} from '../domain/drawing/layerDomainIntent';
import type {DrawingDocument} from '../domain/drawing/model';
import type {Angle} from '../domain/recordingSnapshot/model';
import {prepareSnapshotDrawingToolEdit} from './snapshotDrawingToolEdit';
import type {SnapshotEditContext,SnapshotEditPlan} from './snapshotEditTransaction';

export interface RecordingTemporaryCageEdit {
 recordingId:string;snapshotId:string;angle:Angle;beforeDrawing:DrawingDocument;
 intent:LayerCageDomainIntent;validation?:'preview'|'full';
}

/** Intermediate cages author a desired Drawing frame, then use the same atomic
 * grouped inverse as A/V. Only the resulting scalar responses are persisted. */
export function prepareRecordingTemporaryCageEdit(context:SnapshotEditContext,edit:RecordingTemporaryCageEdit):SnapshotEditPlan {
 const workspace=context.workspace??context.project.recordingSnapshots,recording=workspace?.recordings.find(value=>value.id===edit.recordingId);
 if(recording?.mode!=='triangulated'||!recording.angleGraph||recording.angleGraph.mesh.vertices.some(value=>value.angle.x===edit.angle.x&&value.angle.y===edit.angle.y))throw Error('A temporary cage requires an intermediate angle in a triangulated Recording.');
 if(edit.intent.replace)throw Error('A temporary cage cannot replace a saved cage. Start a new cage on the current curves.');
 const drawing=applyLayerDomainIntent(edit.beforeDrawing,edit.intent).document;
 return prepareSnapshotDrawingToolEdit(context,{recordingId:edit.recordingId,snapshotId:edit.snapshotId,angle:edit.angle,beforeDrawing:edit.beforeDrawing,drawing,intent:{kind:'geometry'},validation:edit.validation});
}
