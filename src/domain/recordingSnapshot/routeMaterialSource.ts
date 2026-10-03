import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import {createDisplayRouteField,resolveDisplayRoute} from '../drawing/displayRoutes';
import {drawingSmoothComponents,projectDrawingSmoothComponent} from '../drawing/smoothHandleAuthoring';
import {deformDrawing} from '../vectorWarp/evaluation';

const sources=new WeakMap<DrawingDocument,Map<string,DrawingDocument>>();
const inputs=new WeakSet<DrawingDocument>();
export function markSnapshotRouteMaterialInput(drawing:DrawingDocument):DrawingDocument {inputs.add(drawing);return drawing;}
export function retainSnapshotRouteMaterialInput(drawing:DrawingDocument,source:DrawingDocument):DrawingDocument {if(inputs.has(source))inputs.add(drawing);return drawing;}
/** A local Snapshot route can be structurally complete while its live parent
 * ports are still separated. Material uses the existing linked-node resolver's
 * identity field, never a saved geometry copy or an invented percentage map.
 * Final evaluated drawings already have valid ports and return themselves. */
export function snapshotRouteMaterialSource(drawing:DrawingDocument,track:StrokeDisplayIntervals):DrawingDocument {
 const route=track.displayRoute;if(!route||!inputs.has(drawing))return drawing;
 let cache=sources.get(drawing);if(!cache){cache=new Map();sources.set(drawing,cache);}const key=JSON.stringify([track.id,route]),known=cache.get(key);if(known)return known;
 const structural=resolveDisplayRoute(drawing,route,{deferEndpointPositions:true});if(structural.diagnostics.length)return drawing;
 if(!createDisplayRouteField(drawing,route).diagnostics.length){cache.set(key,drawing);return drawing;}
 const resolved=deformDrawing({...drawing,displayIntervals:[]},[],{diagnostics:'preview'}).drawing;
 for(const component of drawingSmoothComponents(resolved))projectDrawingSmoothComponent(resolved,component);
 const material={...resolved,displayIntervals:drawing.displayIntervals};
 if(createDisplayRouteField(material,route).diagnostics.length)return drawing;
 cache.set(key,material);return material;
}
/** Numeric interval edits and topology authors use the same material frame as
 * transport and retained insertion recipes. The returned Drawing is transient. */
export function snapshotIntervalMaterialSource(evaluation:{source:DrawingDocument},trackId:string):DrawingDocument {
 const track=evaluation.source.displayIntervals?.find(value=>value.id===trackId);return track?snapshotRouteMaterialSource(evaluation.source,track):evaluation.source;
}
