import {addLayer,deleteLayers,deleteObjects,duplicateLayer,reorderLayers} from '../../domain/drawing/commands';
import {curveById,type DrawingDocument} from '../../domain/drawing/model';
import {selectedLayers,selectedObjects,type DrawingSelection} from './session';

export interface DrawingStructuralResult {document:DrawingDocument;selection:DrawingSelection;activeLayerId?:string}
/** Native layer tools produce a Drawing result. Ownership is the host's write
 * adapter's concern, never a second set of Recording geometry commands. */
export function createDrawingLayer(document:DrawingDocument,name:string,after?:string|null):DrawingStructuralResult {
 const next=addLayer(document,name),id=next.layers[0].id;
 return {document:after?reorderLayers(next,id,after):next,selection:{ids:[],layer:id,layers:[id]},activeLayerId:id};
}
export function duplicateDrawingLayers(document:DrawingDocument,layerIds:string[]):DrawingStructuralResult {
 let next=document;const created:string[]=[];
 for(const id of layerIds){next=duplicateLayer(next,id);const copy=next.layers[0].id;created.push(copy);next=reorderLayers(next,copy,id);}
 const items=next.layers.filter(layer=>created.includes(layer.id)).flatMap(layer=>layer.items);
 return {document:next,selection:{layers:created,layer:created.length===1?created[0]:undefined,ids:items.filter(id=>!!curveById(next,id)),paintIds:items.filter(id=>!curveById(next,id))},activeLayerId:created[0]};
}
export function deleteDrawingSelection(document:DrawingDocument,selection:DrawingSelection):DrawingStructuralResult {
 const layers=selectedLayers(selection),ids=selectedObjects(selection);
 return {document:layers.length?deleteLayers(document,layers):ids.length?deleteObjects(document,ids):document,selection:{ids:[]}};
}
