import {applyDrawingControlWrites,drawingControlEditProof,prepareDrawingControlEditPlan,type DrawingControlEditPlan,type DrawingControlEditIntent} from '../domain/drawing/controlEditPlan';
import type {DrawingDocument} from '../domain/drawing/model';
import {snapshotDrawingEditContent} from '../domain/recordingSnapshot/drawingControlTargetEdit';
import {remapLayerCageStrokeScope} from '../domain/recordingSnapshot/layerCageScope';

/** Identity adaptation is another controlled write, not a copied proof stamp.
 * Authenticate the presentation producer, compile its canonical dependency
 * closure, then require that this producer reconstructs the complete target.
 * Source/editor metadata or material changes keep the full adapter fallback. */
export function prepareDrawingSnapshotControlTarget(before:DrawingDocument,wanted:DrawingDocument,canonicalBefore:DrawingDocument,canonicalWanted:DrawingDocument,canonicalId:(id:string)=>string,plan?:DrawingControlEditPlan):{drawing:DrawingDocument;controlPlan:DrawingControlEditPlan}|undefined {
 const proof=drawingControlEditProof(before,wanted,plan);if(!proof)return;
 const original=proof.intent;
 const intent:DrawingControlEditIntent=original.kind==='node'?{...original,nodeId:canonicalId(original.nodeId)}:original.kind==='handle'?{...original,endpoint:{...original.endpoint,curveId:canonicalId(original.endpoint.curveId)}}:original.kind==='curves'?{...original,curveIds:original.curveIds.map(canonicalId)}:{...original,layerIds:original.layerIds.map(canonicalId),...(original.curveIds?{curveIds:original.curveIds.map(canonicalId)}:{}),...(original.strokeScope?{strokeScope:remapLayerCageStrokeScope(original.strokeScope,canonicalId)}:{})};
 const controlPlan=prepareDrawingControlEditPlan(canonicalBefore,intent),nodes=new Map(canonicalWanted.nodes.map(node=>[node.id,node.position])),curves=new Map(canonicalWanted.curves.map(curve=>[curve.id,curve]));
 const drawing=applyDrawingControlWrites(controlPlan,{nodePositions:new Map(controlPlan.controls.flatMap(control=>control.kind==='node'?[[control.nodeId,nodes.get(control.nodeId)!] as const]:[])),handlePositions:controlPlan.controls.flatMap(control=>control.kind==='handle'?[{curveId:control.curveId,end:control.end,position:curves.get(control.curveId)!.handles[control.end]}]:[])});
 if(JSON.stringify(snapshotDrawingEditContent(drawing))!==JSON.stringify(snapshotDrawingEditContent(canonicalWanted))||JSON.stringify(drawing.mirrorEditing?.curvePairs??[])!==JSON.stringify(canonicalWanted.mirrorEditing?.curvePairs??[]))return;
 return {drawing,controlPlan};
}
