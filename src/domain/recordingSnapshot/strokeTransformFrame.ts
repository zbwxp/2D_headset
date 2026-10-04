import type {SnapshotEvaluation} from './evaluation';
import type {Point2} from '../drawing/model';
import {identityScenePlacement,type ScenePlacementValue} from '../recordingScene/model';
import {applyScenePlacement,scenePlacementScales,tryInverseScenePlacement} from '../recordingScene/tracks';
import {selectionBounds} from '../drawing/selectionBounds';
import {snapshotUsesControlTargetStages} from './controlTargets';

/** The unplaced, live material frame survives an exact-zero displayed axis. */
export function snapshotStrokeTransformFrame(evaluation:SnapshotEvaluation,curveIds:string[]){
 const ids=curveIds.filter(id=>evaluation.drawing.curves.some(curve=>curve.id===id));
 if(!ids.length)return null;
 const same=(a:ScenePlacementValue,b:ScenePlacementValue)=>a.rotation===b.rotation&&a.translation.every((v,i)=>v===b.translation[i])&&scenePlacementScales(a).every((v,i)=>v===scenePlacementScales(b)[i]);
 const values=ids.map(id=>evaluation.elementPlacements[id]??identityScenePlacement()),first=values[0],parents=ids.map(id=>evaluation.placements[evaluation.drawing.layers.find(layer=>layer.items.includes(id))?.id??'']??identityScenePlacement()),parent=parents[0];
 const common=values.every(value=>same(value,first))&&parents.every(value=>same(value,parent));
 const bounds=selectionBounds(evaluation.drawing,ids),materialBounds=selectionBounds(evaluation.preElementPlacementDrawing,ids);
 return bounds&&materialBounds?{ids,bounds,materialBounds,placement:common?first:undefined,displayPlacement:common?parent:undefined,parentInvertible:!!tryInverseScenePlacement(parent)}:null;
}

/** One frame-space decision shared by the V editor and consumers of its reference. */
export function snapshotStrokeFrameInOutputSpace(evaluation:SnapshotEvaluation,curveIds:string[]):boolean {
 return evaluation.endpointPair?.role==='correction'||evaluation.angleSurface?.role==='correction'||!!evaluation.angleSurface&&snapshotUsesControlTargetStages(evaluation,curveIds);
}
/** Center of the actual displayed V frame. This does not select a mirror policy.
 * No inverse is required, including an exact-zero width or height. */
export function displayedSnapshotStrokeFrameCenter(evaluation:SnapshotEvaluation,curveIds:string[]):Point2|null {
 if(snapshotStrokeFrameInOutputSpace(evaluation,curveIds))return selectionBounds(evaluation.drawing,curveIds)?.center??null;
 const frame=snapshotStrokeTransformFrame(evaluation,curveIds);if(!frame)return null;
 return frame.placement?applyScenePlacement(frame.displayPlacement??identityScenePlacement(),applyScenePlacement(frame.placement,frame.materialBounds.center)):frame.bounds.center;
}
