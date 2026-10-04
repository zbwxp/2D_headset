import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import type {ScenePlacementValue} from '../../domain/recordingScene/model';
import {composePlacementSimilarity} from '../../domain/recordingScene/tracks';
import {snapshotStrokeTransformFrame} from '../../domain/recordingSnapshot/strokeTransformFrame';
export {snapshotStrokeTransformFrame} from '../../domain/recordingSnapshot/strokeTransformFrame';

export function snapshotStrokeValueCommands(ids:string[],value:ScenePlacementValue):SnapshotCommand[]{
 return [{op:'setShapeElementPlacement',curveIds:ids,value}];
}
export function snapshotStrokeDeltaCommands(evaluation:SnapshotEvaluation,ids:string[],delta:ScenePlacementValue):SnapshotCommand[]{
 const frame=snapshotStrokeTransformFrame(evaluation,ids);
 return frame?.placement?snapshotStrokeValueCommands(frame.ids,composePlacementSimilarity(frame.placement,delta)):[{op:'transformShapeElements',curveIds:ids,value:delta}];
}
