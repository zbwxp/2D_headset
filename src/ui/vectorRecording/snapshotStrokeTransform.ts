import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';
import {composePlacementSimilarity,scenePlacementScales,tryInverseScenePlacement} from '../../domain/recordingScene/tracks';
import {selectionBounds} from '../drawing/geometry';

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

export function snapshotStrokeValueCommands(ids:string[],value:ScenePlacementValue):SnapshotCommand[]{
 return [{op:'setShapeElementPlacement',curveIds:ids,value}];
}
export function snapshotStrokeDeltaCommands(evaluation:SnapshotEvaluation,ids:string[],delta:ScenePlacementValue):SnapshotCommand[]{
 const frame=snapshotStrokeTransformFrame(evaluation,ids);
 return frame?.placement?snapshotStrokeValueCommands(frame.ids,composePlacementSimilarity(frame.placement,delta)):[{op:'transformShapeElements',curveIds:ids,value:delta}];
}
