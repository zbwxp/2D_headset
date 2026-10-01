import {useEditor} from '../../app/store';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {DrawingSnapshotState} from '../../domain/drawing/snapshots';
export function commitDrawing(next:DrawingDocument){const e=useEditor.getState();if(next===e.project.drawing)return;e.beginEdit();e.setDrawing(next);e.endEdit();}
export function commitDrawingSnapshot(change:(state:DrawingSnapshotState)=>DrawingSnapshotState){
 const e=useEditor.getState(),next=change({drawing:e.project.drawing,drawingSnapshots:e.project.drawingSnapshots});
 e.beginEdit();try{e.setDrawingSnapshotState(next);}finally{e.endEdit();}
}
