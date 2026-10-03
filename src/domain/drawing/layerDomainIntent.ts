import {transform} from './commands';
import {finalizeGeometryEdit} from './geometryEdit';
import {mirrorWritesForCurves} from './mirrorEditing';
import type {DrawingDocument,Point2} from './model';
import {applyScenePlacement,isScenePlacementSimilarity,type ScenePlacementMatrix} from '../recordingScene/tracks';
import type {ScenePlacementValue} from '../recordingScene/model';

/** Explicit layer membership, never a frozen list of the current curves. A
 * domain is authored by a tool, not reconstructed from fitted controls.
 * The first exact domain is a positive similarity in evaluated/world space.
 * Quad/Coons domains can extend this discriminated union with their own data. */
export interface LayerDomainIntent {
 readonly kind:'layer-domain';
 readonly scope:{readonly kind:'layers';readonly layerIds:readonly string[]};
 readonly domain:{readonly kind:'placement-similarity';readonly value:ScenePlacementValue};
}

export function createLayerDomainIntent(layerIds:readonly string[],value:ScenePlacementValue):LayerDomainIntent {
 const intent:LayerDomainIntent={kind:'layer-domain',scope:{kind:'layers',layerIds:[...layerIds]},domain:{kind:'placement-similarity',value:{...value,translation:[...value.translation]}}};
 assertLayerDomainIntent(intent);return intent;
}
export function assertLayerDomainIntent(intent:LayerDomainIntent):void {
 const value=intent.domain.value;
 if(intent.kind!=='layer-domain'||intent.scope.kind!=='layers'||!intent.scope.layerIds.length||intent.scope.layerIds.some(id=>!id)||new Set(intent.scope.layerIds).size!==intent.scope.layerIds.length||intent.domain.kind!=='placement-similarity'||!isScenePlacementSimilarity(value)||![...value.translation,value.rotation,value.scale,value.scaleX??1,value.scaleY??1].every(Number.isFinite)||value.scale<=0)throw Error('A layer domain requires explicit layers and a finite positive similarity.');
}
export function mapLayerDomainIntent(intent:LayerDomainIntent,id:(id:string)=>string):LayerDomainIntent {
 return createLayerDomainIntent(intent.scope.layerIds.map(id),intent.domain.value);
}
/** Shared Drawing transform kernel remains the sole source-original geometry
 * edit. Snapshot adapters persist referenced domains and own their evaluation. */
export function applyLayerDomainIntent(drawing:DrawingDocument,intent:LayerDomainIntent,options:{allowRelated?:boolean}={}) {
 assertLayerDomainIntent(intent);
 const layers=intent.scope.layerIds.map(id=>{const layer=drawing.layers.find(layer=>layer.id===id);if(!layer)throw Error('A layer domain target no longer exists.');if(layer.locked)throw Error('对象已锁定。');return layer;});
 const items=new Set(layers.flatMap(layer=>layer.items)),ids=drawing.curves.filter(curve=>items.has(curve.id)).map(curve=>curve.id);
 const raw=transform(drawing,ids,point=>applyScenePlacement(intent.domain.value,point),options.allowRelated??false,true);
 return {document:finalizeGeometryEdit(drawing,raw,mirrorWritesForCurves(raw,ids)),intent,ids};
}
/** Convert tool parameters about an authored pivot, without fitting geometry. */
export function layerSimilarityValue(translation:Point2=[0,0],rotation=0,scale=1,pivot:Point2=[0,0]):ScenePlacementValue {
 const value={translation:[0,0] as Point2,rotation,scale},mapped=applyScenePlacement(value,pivot);
 return {...value,translation:[translation[0]+pivot[0]-mapped[0],translation[1]+pivot[1]-mapped[1]]};
}
/** Interpret an explicitly authored API matrix, never changed control points.
 * Exact coefficient relations distinguish a similarity from a small shear;
 * unsupported affine maps remain available to their existing source editor. */
export function layerSimilarityFromMatrix(matrix:ScenePlacementMatrix):ScenePlacementValue|undefined {
 if(!matrix.every(Number.isFinite))throw Error('Layer transform matrix must be finite.');
 const [a,b,c,d,e,f]=matrix,scale=Math.hypot(a,b);
 if(a!==d||b!==-c||scale===0)return;
 return {translation:[e,f],rotation:Math.atan2(b,a)*180/Math.PI,scale};
}
