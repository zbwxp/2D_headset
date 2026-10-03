import {connect,linkEndpoints,merge} from '../../domain/drawing/commands';
import {editable,length,nodeAt,sameEnd,sub,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import type {DrawingSelection} from './session';
import type {ConnectionTool} from './tools';

export type DrawingEndpointTool=ConnectionTool|'merge';
/** Command cause travels separately from its geometry so source followers are
 * never mistaken for directly authored original controls. */
export interface DrawingCommandIntent {kind:'relation-authoring'}
export type DrawingCommandRun=(operation:()=>DrawingDocument,intent?:DrawingCommandIntent)=>void;
/** The endpoint overlay and picking always use the same editable layer scope.
 * Omit layerId only when a caller deliberately offers all visible layers. */
export function drawingEndpointCurveIds(drawing:DrawingDocument,layerId?:string|null):string[]{
 return (layerId===undefined?drawing.layers.flatMap(layer=>layer.items):drawing.layers.find(layer=>layer.id===layerId)?.items??[]).filter(id=>editable(drawing,id));
}
/** Pick from committed coordinates, never the moving second-click preview. */
export function pickDrawingEndpoint(drawing:DrawingDocument,curveIds:readonly string[],point:Point2,unit:number,first:Endpoint|null=null):Endpoint|null {
 const hit=curveIds.flatMap(curveId=>([0,1] as const).map(end=>({curveId,end}))).filter(endpoint=>editable(drawing,endpoint.curveId)&&(!first||!sameEnd(first,endpoint))).map(endpoint=>({...endpoint,distance:length(sub(point,nodeAt(drawing,endpoint).position))*unit})).filter(endpoint=>endpoint.distance<=11).sort((a,b)=>a.distance-b.distance)[0];
 return hit?{curveId:hit.curveId,end:hit.end}:null;
}
export const drawingEndpointSelection=(drawing:DrawingDocument,endpoint:Endpoint):DrawingSelection=>({ids:[endpoint.curveId],node:nodeAt(drawing,endpoint).id});
/** One Drawing command dispatch. 'link' preserves identities; 'bind' really
 * merges source nodes and must never masquerade as an inherited local link. */
export function applyDrawingEndpointTool(drawing:DrawingDocument,tool:DrawingEndpointTool,first:Endpoint,second:Endpoint):DrawingDocument {
 return tool==='link'?linkEndpoints(drawing,first,second,true):tool==='merge'?merge(drawing,first,second):connect(drawing,first,second,tool==='smooth'?'SMOOTH':tool==='cusp'?'CUSP':tool==='arc'?'ARC':'POSITION');
}
