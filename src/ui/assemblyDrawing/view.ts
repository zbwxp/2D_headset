import type {Point2} from '../../domain/drawing/model';

/** Two view origins share a scale: artwork navigation never edits the 3D rig. */
export interface AssemblyView {zoom:number;pan:Point2;rigPan:Point2}
export function panAssemblyView(from:Pick<AssemblyView,'pan'|'rigPan'>,pan:Point2,locked:boolean):Pick<AssemblyView,'pan'|'rigPan'> {
 return {pan,rigPan:locked?[from.rigPan[0]+pan[0]-from.pan[0],from.rigPan[1]+pan[1]-from.pan[1]]:from.rigPan};
}
export function zoomAssemblyView(from:AssemblyView,zoom:number,pan:Point2=from.pan):AssemblyView {
 const ratio=zoom/from.zoom;
 // Apply the same screen-space zoom to the independent reference origin.
 return {zoom,pan,rigPan:[pan[0]+(from.rigPan[0]-from.pan[0])*ratio,pan[1]+(from.rigPan[1]-from.pan[1])*ratio]};
}
export function rigPointInDrawing(point:Point2,view:{pan:Point2;rigPan:Point2;unit:number}):Point2 {
 return [point[0]+(view.rigPan[0]-view.pan[0])/view.unit,point[1]-(view.rigPan[1]-view.pan[1])/view.unit];
}
