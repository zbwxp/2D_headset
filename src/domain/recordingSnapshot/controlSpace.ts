import {hasEvaluatedDeformationFor} from '../drawing/evaluatedDeformation';
import {layerUsesCage} from './layerDomainControlEdit';
import type {SnapshotEvaluation} from './evaluation';
import {layerDomainMatrices,isLayerCageDomain} from './layerDomains';
import {identityScenePlacement} from '../recordingScene/model';
import {placementMatrix} from '../recordingScene/tracks';
import {composeAffine2D,identityAffine2D,inverseAffine2D,type Affine2D} from '../geometry/affine2d';
import {affine2DMaxScale} from '../geometry/affine2d';
import {evaluatedAffine} from '../drawing/evaluatedAffine';

type PlacementEvaluation=Pick<SnapshotEvaluation,'state'|'placements'|'elementPlacements'>;
const domains=new WeakMap<object,Record<string,Affine2D>>();
export function snapshotDomainMatrices(evaluation:PlacementEvaluation):Record<string,Affine2D> {
 let result=domains.get(evaluation);if(!result){result=layerDomainMatrices(evaluation.state.layerDomains);domains.set(evaluation,result);}return result;
}
/** The only point-space contract: element → legacy layer → ordered domains.
 * Warp and shape coordinates remain unchanged by placement unprojection. */
export function snapshotControlMatrix(evaluation:PlacementEvaluation,layerId:string,curveId:string):Affine2D {
 return composeAffine2D(snapshotDomainMatrices(evaluation)[layerId]??identityAffine2D(),composeAffine2D(placementMatrix(evaluation.placements[layerId]??identityScenePlacement()),placementMatrix(evaluation.elementPlacements[curveId]??identityScenePlacement())));
}
export function trySnapshotControlInverse(evaluation:PlacementEvaluation,layerId:string,curveId:string):Affine2D|null {
 if(layerUsesCage(evaluation.state.layerDomains,layerId))return null;
 return inverseAffine2D(snapshotControlMatrix(evaluation,layerId,curveId));
}
/** Brush metadata scales only until the first deferred affine stage. Later
 * stages project the source ARC and keep that source-space trim unchanged. */
export function snapshotControlBrushScale(evaluation:PlacementEvaluation&Pick<SnapshotEvaluation,'source'>,layerId:string,curveId:string):number {
 if(evaluatedAffine(evaluation.source,curveId)||hasEvaluatedDeformationFor(evaluation.source,curveId))return 1;
 let scale=1;
 const relevant=(evaluation.state.layerDomains??[]).filter(domain=>domain.layerIds.includes(layerId)&&domain.enabled!==false),firstCage=relevant.findIndex(isLayerCageDomain),domainMatrices=firstCage<0?[snapshotDomainMatrices(evaluation)[layerId]??identityAffine2D()]:relevant.slice(0,firstCage).flatMap(domain=>isLayerCageDomain(domain)?[]:[domain.matrix]);
 for(const matrix of [placementMatrix(evaluation.elementPlacements[curveId]??identityScenePlacement()),placementMatrix(evaluation.placements[layerId]??identityScenePlacement()),...domainMatrices]){
  if(matrix[0]!==matrix[3]||matrix[1]!==-matrix[2]||Math.hypot(matrix[0],matrix[1])===0)break;
  scale*=affine2DMaxScale(matrix);
 }
 return scale;
}
