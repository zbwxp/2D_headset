import {uid} from '../../domain/drawing/model';
import {createLayerAffineIntent,type LayerAffineDomainIntent} from '../../domain/drawing/layerDomainIntent';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';
import {composePlacementSimilarity,isScenePlacementSimilarity,placementMatrix} from '../../domain/recordingScene/tracks';
import {isIdentityAffine2D,inverseAffine2D} from '../../domain/geometry/affine2d';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {snapshotLayerAffineDisplayFrame} from '../../domain/recordingSnapshot/strokeTransformFrame';
import {selectionBounds} from '../drawing/geometry';
import type {RecordingInstanceTransform} from './SceneInstanceTransformBox';

/** A real layer selection writes its native placements when representable.
 * World-axis anisotropy is a post-placement domain, so rotated layers retain
 * their input and all later world gestures stay after that domain as well. */
export function snapshotLayerSelectionTransform(
 evaluation:SnapshotEvaluation,baseline:SnapshotEvaluation,selectedIds:readonly string[],editable:boolean,
 preview:(commands:SnapshotCommand[]|null)=>boolean|void,commit:(commands:SnapshotCommand[])=>void,
 previewDomain:(intent:LayerAffineDomainIntent|null)=>boolean,commitDomain:(intent:LayerAffineDomainIntent)=>void,
 label='Selected layer transform',
):RecordingInstanceTransform|undefined {
 const ids=[...selectedIds],items=new Set(evaluation.drawing.layers.filter(layer=>ids.includes(layer.id)).flatMap(layer=>layer.items)),curves=evaluation.drawing.curves.filter(curve=>items.has(curve.id)).map(curve=>curve.id),bounds=selectionBounds(evaluation.drawing,curves);
 if(!ids.length||!bounds)return;
 const operationId=uid(),hasDomains=!!baseline.state.layerDomains?.some(domain=>domain.enabled!==false&&domain.layerIds.some(id=>ids.includes(id))),displayPlacement=ids.length===1?snapshotLayerAffineDisplayFrame(baseline.state.layerDomains,ids):undefined;
 const nativeFrame=ids.length===1&&(!hasDomains||!!displayPlacement),materialBounds=nativeFrame?selectionBounds(evaluation.prePlacementDrawing,curves):null;
 const commands=(delta:ScenePlacementValue):SnapshotCommand[]=>ids.map(layerId=>({op:'setLayerPlacement',layerId,value:composePlacementSimilarity(baseline.placements[layerId]??identityScenePlacement(),delta)}));
 const domain=(delta:ScenePlacementValue)=>createLayerAffineIntent(ids,placementMatrix(delta),{operationId});
 const needsDomain=(delta:ScenePlacementValue)=>!nativeFrame&&(hasDomains||!isScenePlacementSimilarity(delta));
 const valueCommands=(value:ScenePlacementValue):SnapshotCommand[]=>[{op:'setLayerPlacement',layerId:ids[0],value}];
 return {ids,bounds,editable:editable&&(!displayPlacement||!!inverseAffine2D(displayPlacement)),label,
  onPreview:delta=>{if(!delta){preview(null);previewDomain(null);return true;}return needsDomain(delta)?previewDomain(domain(delta)):preview(commands(delta));},
  onCommit:delta=>{if(needsDomain(delta)){const intent=domain(delta);if(!isIdentityAffine2D(intent.domain.matrix))commitDomain(intent);}else commit(commands(delta));},
  ...(nativeFrame&&materialBounds?{basePlacement:evaluation.placements[ids[0]]??identityScenePlacement(),displayPlacement,materialBounds,onValuePreview:(value:ScenePlacementValue|null)=>preview(value?valueCommands(value):null),onValueCommit:(value:ScenePlacementValue)=>commit(valueCommands(value))}:{}),
 };
}
