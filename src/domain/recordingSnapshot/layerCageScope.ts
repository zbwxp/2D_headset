import type {DrawingDocument} from '../drawing/model';
import {strokes} from '../drawing/strokes';

/** Provenance anchors, not frozen membership. Current Drawing stroke topology
 * supplies the members; coordinates and the cage rectangle never do. Empty
 * provenance remains an empty scope after its last member is deleted. */
export interface LayerCageStrokeScope {kind:'continuous-strokes';curveIds:string[]}
export interface LayerCageScope {layerIds:readonly string[];strokeScope?:LayerCageStrokeScope}

export function validateLayerCageStrokeScope(value:unknown):asserts value is LayerCageStrokeScope {
 const scope=value as LayerCageStrokeScope;
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).some(key=>!['kind','curveIds'].includes(key))||scope.kind!=='continuous-strokes'||!Array.isArray(scope.curveIds)||scope.curveIds.length>16384||Array.from(scope.curveIds).some(id=>typeof id!=='string'||!id||id.length>16384)||new Set(scope.curveIds).size!==scope.curveIds.length)throw Error('Invalid continuous stroke cage scope.');
}
export function layerCageCurveIds(drawing:DrawingDocument,scope:LayerCageScope):Set<string> {
 const layers=drawing.layers.filter(layer=>scope.layerIds.includes(layer.id));
 if(!scope.strokeScope){const items=new Set(layers.flatMap(layer=>layer.items));return new Set(drawing.curves.filter(curve=>items.has(curve.id)).map(curve=>curve.id));}
 const anchors=new Set(scope.strokeScope.curveIds);
 return new Set(layers.flatMap(layer=>strokes(drawing,layer.id).filter(stroke=>stroke.segments.some(segment=>anchors.has(segment.id))).flatMap(stroke=>stroke.segments.map(segment=>segment.id))));
}
export function remapLayerCageStrokeScope(scope:LayerCageStrokeScope,id:(id:string)=>string,keep:(id:string)=>boolean=()=>true):LayerCageStrokeScope {
 return {kind:'continuous-strokes',curveIds:[...new Set(scope.curveIds.filter(keep).map(id))]};
}
/** Carry every actual connected member before a topology mutation. Thus a new
 * continuation survives deleting the original anchor, and severed survivors
 * retain their authored provenance. Undo restores this value with the edit. */
export function reconcileLayerCageStrokeScope(scope:LayerCageScope,before:DrawingDocument,after:DrawingDocument):LayerCageStrokeScope|undefined {
 if(!scope.strokeScope)return;
 // Missing local members may be restored. True source deletion prunes these
 // identities through the same keepObject remap as every other source record.
 const curveIds=[...new Set([...scope.strokeScope.curveIds,...layerCageCurveIds(before,scope),...layerCageCurveIds(after,scope)])];
 return {kind:'continuous-strokes',curveIds};
}
