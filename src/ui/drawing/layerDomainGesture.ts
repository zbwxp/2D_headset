import {createLayerDomainIntent,type LayerDomainIntent} from '../../domain/drawing/layerDomainIntent';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {ScenePlacementValue} from '../../domain/recordingScene/model';
import {selectedLayers,type DrawingSelection} from './session';

/** Whole-layer intent requires an explicit complete layer selection. Selecting
 * all current curves by box or endpoint never silently creates a live domain. */
export function layerSimilarityIntentForSelection(drawing:DrawingDocument,selection:DrawingSelection,value:ScenePlacementValue,curveIds:readonly string[]=selection.ids):LayerDomainIntent|undefined {
 if(selection.node||selection.handle||selection.paint||selection.reference||selection.mirrorAxis||selection.inkEnd||selection.displayInterval)return;
 const layerIds=selectedLayers(selection);if(!layerIds.length)return;
 const layers=drawing.layers.filter(layer=>layerIds.includes(layer.id));if(layers.length!==layerIds.length)return;
 const items=new Set(layers.flatMap(layer=>layer.items)),curves=drawing.curves.filter(curve=>items.has(curve.id));
 if(curves.length!==curveIds.length||curves.some(curve=>!curveIds.includes(curve.id)))return;
 return createLayerDomainIntent(layerIds,value);
}
