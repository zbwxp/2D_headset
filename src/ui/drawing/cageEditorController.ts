import {add,mul,sub,uid,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {quadProjection,rectQuad,type DeformRect,type Quad} from '../../domain/drawing/deform';
import {neutralBend,type BendValue} from '../../domain/deformation/coons';
import {inverse3,map3} from '../../domain/deformation/homography';
import {isLayerCageDomain,type SnapshotLayerDomain} from '../../domain/recordingSnapshot/layerDomains';
import {selectedLayers,type DrawingSelection} from './session';
import {selectionBounds} from './geometry';
import {layerCageIntentForSelection} from './layerDomainGesture';

export interface DrawingCage {domainOperationId?:string;base:DrawingDocument;committed:DrawingDocument;ids:string[];rect:DeformRect;quad:Quad;bend:BendValue;maxError:number}
export type CageControl={corner:number}|{edge:number;handle:0|1|2};
export interface CageGesture {cage:DrawingCage;selection:DrawingSelection;control:CageControl;start:Point2;operationId:string}

/** Drawing owns the frame and gestures. Consumers supply resolved documents and
 * layer namespaces; only their transaction adapters choose where to write. */
export function resolveDrawingCage(drawing:DrawingDocument,selection:DrawingSelection,options:{cached?:DrawingCage|null;domains?:readonly SnapshotLayerDomain[];canonicalId?:(id:string)=>string;maxError?:number}={}):DrawingCage|null {
 const ids=selection.ids.filter(id=>drawing.curves.some(curve=>curve.id===id));if(!ids.length)return null;
 const cached=options.cached;if(cached?.committed===drawing&&cached.ids.length===ids.length&&ids.every(id=>cached.ids.includes(id)))return cached;
 const layers=selectedLayers(selection).map(options.canonicalId??(id=>id)),last=[...options.domains??[]].reverse().find(domain=>domain.layerIds.some(id=>layers.includes(id)));
 if(last&&isLayerCageDomain(last)&&last.layerIds.length===layers.length&&last.layerIds.every(id=>layers.includes(id)))return {base:drawing,committed:drawing,ids,rect:structuredClone(last.restRect),quad:structuredClone(last.quad),bend:structuredClone(last.bend??neutralBend()),domainOperationId:last.id,maxError:options.maxError??0};
 const bounds=selectionBounds(drawing,ids);if(!bounds)return null;
 const pad=Math.max(.01,Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])*.05),rect:DeformRect={min:[...bounds.min],max:[...bounds.max]};
 for(const axis of [0,1] as const)if(rect.max[axis]-rect.min[axis]<pad){rect.min[axis]-=pad;rect.max[axis]+=pad;}
 return {base:drawing,committed:drawing,ids,rect,quad:rectQuad(rect),bend:neutralBend(),maxError:0};
}

/** Pointer deltas enter the normalized pre-homography boundary frame. */
export function moveDeformBoundary(rect:DeformRect,quad:Quad,bend:BendValue,edge:number,handle:0|1|2,start:Point2,current:Point2):BendValue {
 const inverse=inverse3(quadProjection(rect,quad).matrix),a=map3(inverse,start),b=map3(inverse,current),delta:Point2=[(b[0]-a[0])/(rect.max[0]-rect.min[0]),(b[1]-a[1])/(rect.max[1]-rect.min[1])],next=structuredClone(bend);
 if(handle===2)for(const i of [0,1] as const)next.handles[edge][i]=add(next.handles[edge][i],mul(delta,4/3));
 else next.handles[edge][handle]=add(next.handles[edge][handle],delta);
 return next;
}
export function beginDrawingCageGesture(cage:DrawingCage,selection:DrawingSelection,control:CageControl,start:Point2,operationId:string=uid()):CageGesture {
 return {cage,selection,control,start:[...start],operationId:cage.domainOperationId??operationId};
}
export function updateDrawingCageGesture(gesture:CageGesture,current:Point2) {
 const {cage,control}=gesture,quad=structuredClone(cage.quad),bend='corner' in control?cage.bend:moveDeformBoundary(cage.rect,cage.quad,cage.bend,control.edge,control.handle,gesture.start,current);
 if('corner' in control)quad[control.corner]=add(quad[control.corner],sub(current,gesture.start));
 const next={...cage,quad,bend},intent=layerCageIntentForSelection(cage.committed,gesture.selection,{kind:'h-coons',restRect:cage.rect,quad,bend},cage.ids,gesture.operationId,!!cage.domainOperationId);
 return {cage:next,intent};
}

export interface DrawingCageEditorAdapter {
 drawing:DrawingDocument;
 domains:readonly SnapshotLayerDomain[];
 targetKey:string;
 historyKey:object;
 editable:boolean;
 disabledReason?:string;
 maxError:number;
 onPreview:(intent:NonNullable<ReturnType<typeof layerCageIntentForSelection>>|null)=>boolean;
 onCommit:(intent:NonNullable<ReturnType<typeof layerCageIntentForSelection>>)=>void;
 onError:(message:string)=>void;
}

/** Recording exposes Drawing's cage only for explicit complete layer scopes.
 * This deliberately does not turn a coincident all-curve selection into a live
 * membership operation. Hidden members remain part of an explicit layer. */
export function drawingCageSelectionIssue(drawing:DrawingDocument,selection:DrawingSelection):string|undefined {
 const layers=selectedLayers(selection),selected=drawing.layers.filter(layer=>layers.includes(layer.id));
 if(!layers.length||selected.length!==layers.length||!layerCageIntentForSelection(drawing,selection,{kind:'h-coons',restRect:{min:[0,0],max:[1,1]},quad:rectQuad({min:[0,0],max:[1,1]})},selection.ids,'selection-check'))return 'Select complete layers in the current snapshot to edit a live cage.';
 if(selected.some(layer=>layer.locked||drawing.curves.some(curve=>layer.items.includes(curve.id)&&curve.locked)))return 'Unlock the selected layer and its curves before transforming the whole layer.';
 if(!selection.ids.length)return 'Add a curve to the selected layer before creating its cage.';
}
