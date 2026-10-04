import type {DrawingDocument} from './model';
import type {StrokePath} from './strokes';
import {evaluatedAffine} from './evaluatedAffine';
import {hasEvaluatedDeformation} from './evaluatedDeformation';
import {intervalPinch} from './intervalPinch';
import {drawingMaterialPathDependencies} from './readContext';

/** Signature only the native path's geometry, joins and material. Response
 * drafts create new Drawings, while unaffected paths retain identical input. */
export function nativeDrawingPathMaterialSignature(drawing:DrawingDocument,path:StrokePath):string|undefined {
 // Fitted controls do not identify the retained source material or program.
 // Preserve the source/projector path unless its complete inputs are guarded.
 if(hasEvaluatedDeformation(drawing)||path.segments.some(use=>evaluatedAffine(drawing,use.id)))return undefined;
 const pathIds=new Set(path.segments.map(use=>use.id)),indexed=drawingMaterialPathDependencies(drawing,[...pathIds]);
 const joins=indexed?indexed.dependencies.joinIds.map(id=>indexed.context.joins.get(id)!):drawing.joins.filter(join=>pathIds.has(join.a.curveId)||pathIds.has(join.b.curveId));
 const links=indexed?indexed.dependencies.linkIds.map(id=>indexed.context.endpointLinks.get(id)!):(drawing.endpointLinks??[]).filter(link=>pathIds.has(link.a.curveId)||pathIds.has(link.b.curveId));
 const curveIds=indexed?undefined:new Set([...pathIds,...joins.flatMap(join=>[join.a.curveId,join.b.curveId]),...links.flatMap(link=>[link.a.curveId,link.b.curveId])]);
 const curves=indexed?indexed.dependencies.curveIds.map(id=>indexed.context.curves.get(id)!):drawing.curves.filter(curve=>curveIds!.has(curve.id));
 const nodeIds=indexed?undefined:new Set(curves.flatMap(curve=>curve.nodes));
 const nodes=indexed?indexed.dependencies.nodeIds.map(id=>indexed.context.nodes.get(id)!):drawing.nodes.filter(node=>nodeIds!.has(node.id));
 // Tracks, route precedence and transient pinches belong to this exact interval
 // collection, never to a retained topology plan or a previous wrapper Drawing.
 const tracks=(drawing.displayIntervals??[]).filter(track=>pathIds.has(track.anchor.id)),routes=(drawing.displayIntervals??[]).filter(track=>track.displayRoute).map(track=>[track.id,track.anchor,track.displayRoute]);
 const structuralIds=routes.length?(indexed?.structuralIdToken??JSON.stringify([drawing.curves.map(curve=>curve.id),drawing.nodes.map(node=>node.id),drawing.joins.map(join=>join.id),(drawing.endpointLinks??[]).map(link=>link.id),drawing.layers.map(layer=>layer.id),drawing.fills.map(fill=>fill.id),drawing.offsets.map(offset=>offset.id)])):undefined;
 return JSON.stringify([path,curves,nodes,joins,links,tracks,tracks.map(track=>track.ranges.map(intervalPinch)),routes,structuralIds,routes.length?drawing.endpointLinks!==undefined:undefined]);
}
