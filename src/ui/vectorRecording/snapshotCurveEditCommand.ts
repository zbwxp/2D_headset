import {hasNonlinearDeformationFor} from '../../domain/drawing/evaluatedDeformation';
import {layerFor} from '../../domain/drawing/model';
import {layerUsesCage} from '../../domain/recordingSnapshot/layerDomainControlEdit';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {applyScenePlacementMatrix,tryInverseScenePlacement} from '../../domain/recordingScene/tracks';
import type {RecordingCurveEdit} from './SceneCurveEditOverlay';

/** Cage controls, including a referenced parent's retained program, arrive in
 * final world coordinates. The command adapter alone resolves their write
 * stage; the canvas must not unproject the local placement a second time. */
export function snapshotCurveEditCommand(evaluation:SnapshotEvaluation,change:RecordingCurveEdit,worldCoordinates=false):SnapshotCommand {
 const {drawing}=evaluation,curve=change.kind==='handle'?drawing.curves.find(curve=>curve.id===change.curveId):drawing.curves.find(curve=>curve.nodes.includes(change.nodeId)),layerId=curve&&layerFor(drawing,curve.id)?.id;
 if(!layerId||!curve)throw Error('The selected source is no longer in this snapshot.');
 let position=change.position;
 if(!worldCoordinates&&!layerUsesCage(evaluation.state.layerDomains,layerId)&&!hasNonlinearDeformationFor(drawing,curve.id)){
  const inverse=tryInverseScenePlacement(evaluation.placements[layerId]??identityScenePlacement());if(!inverse)throw Error('Restore width or height before editing curves.');
  const elementInverse=tryInverseScenePlacement(evaluation.elementPlacements[curve.id]??identityScenePlacement());if(!elementInverse)throw Error('Restore the stroke width or height before editing curves.');
  position=applyScenePlacementMatrix(elementInverse,applyScenePlacementMatrix(inverse,position));
 }
 return change.kind==='node'?{op:'moveShapeNode',layerId,nodeId:change.nodeId,position}:{op:'moveShapeHandle',layerId,curveId:change.curveId,end:change.end,position};
}
