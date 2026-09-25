import {useEditor} from '../../app/store';
import type {DrawingDocument} from '../../domain/drawing/model';
export function commitDrawing(next:DrawingDocument){const e=useEditor.getState();if(next===e.project.drawing)return;e.beginEdit();e.setDrawing(next);e.endEdit();}
