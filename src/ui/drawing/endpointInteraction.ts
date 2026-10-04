import type {DrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
import {connect,linkEndpoints,merge} from '../../domain/drawing/commands';
import {editable,length,nodeAt,sameEnd,sub,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import type {DrawingSelection} from './session';
import type {ConnectionTool} from './tools';

export type DrawingEndpointTool=ConnectionTool|'merge';
/** Command cause travels separately from its geometry so source followers are
 * never mistaken for directly authored original controls. */
export type DrawingCommandIntent={kind:'relation-authoring'}|{kind:'node-unbind';endpoint:Endpoint}|{kind:'geometry-authoring';controlPlan?:DrawingControlEditPlan}|{kind:'mirror-authoring'};
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
/** A rejected commit must end the hover preview just like a successful commit.
 * Keep the explicit relation intent attached to the actual LINK command. */
export function commitDrawingEndpointTool(drawing:DrawingDocument,tool:DrawingEndpointTool,first:Endpoint,second:Endpoint,commit:(next:DrawingDocument,intent?:Extract<DrawingCommandIntent,{kind:'relation-authoring'}>)=>void,finish:()=>void):DrawingDocument {
 try{const next=applyDrawingEndpointTool(drawing,tool,first,second);commit(next,tool==='link'?{kind:'relation-authoring'}:undefined);return next;}finally{finish();}
}

/** Shared two-click prompt; only LINK may retain its first endpoint across layers. */
export function drawingEndpointInstruction(tool:string,hasFirst:boolean):string {
 return hasFirst?(tool==='smooth'?'第二步：选择需要对齐的一侧':'第二步：选择要移动的端点'):(tool==='smooth'?'第一步：选择保留方向的一侧':'第一步：选择固定端点');
}
