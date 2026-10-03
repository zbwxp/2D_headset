import {add,sub,mul,length,nodeAt,shapeOf,uid,type DrawingDocument,type Cubic,type Point2,type Endpoint} from '../../domain/drawing/model';
import {createPenCurve,connect} from '../../domain/drawing/commands';

/** The pen operates in the visible Drawing document's coordinates. The room's
 * write adapter decides whether its result edits a source or a snapshot. */
export interface PenState {position:Point2;out:Point2;last?:string;first?:Endpoint}
export interface PenOptions {layerId:string|null;unit:number;width:number;join:'POSITION'|'SMOOTH'|'CUSP';taperScale:number;preserveAuthoredBrush?:boolean}
export interface PenGesture {base:DrawingDocument;from:PenState|null;start:Point2;origin:Point2;cursor:Point2}
export interface PenCandidate {document:DrawingDocument;next:PenState;closed:boolean;shape:Cubic}
export interface PenResult {state:PenState|null;candidate?:PenCandidate}

export function beginPenGesture(base:DrawingDocument,from:PenState|null,start:Point2,origin=start):PenGesture {
 return {base,from,start:[...start],origin:[...origin],cursor:[...start]};
}
export function movePenGesture(gesture:PenGesture,pointer:Point2):PenGesture {
 return {...gesture,cursor:add(gesture.start,sub(pointer,gesture.origin))};
}
export function penHoverShape(from:PenState,to:Point2,join:PenOptions['join']):Cubic {
 const chord=sub(to,from.position),out=(!from.last||join==='SMOOTH')&&length(from.out)>1e-7?from.out:mul(chord,1/3);
 return [from.position,add(from.position,out),sub(to,mul(chord,1/3)),to];
}
export function penCandidate(base:DrawingDocument,from:PenState,to:Point2,handle:Point2,options:PenOptions):PenCandidate {
 const {layerId,unit,width,join,taperScale,preserveAuthoredBrush=false}=options;
 if(!layerId||!base.layers.some(layer=>layer.id===layerId))throw Error('请先新建绘制层。');
 let closed=false,target=[...to] as Point2;
 if(from.first&&length(sub(target,nodeAt(base,from.first).position))*unit<10){target=[...nodeAt(base,from.first).position];closed=true;}
 const chord=sub(target,from.position),delta=length(sub(handle,to))*unit>2?sub(handle,to):mul(chord,1/3),out=(!from.last||join==='SMOOTH')&&length(from.out)>1e-7?from.out:mul(chord,1/3);
 const shape:Cubic=[[...from.position],add(from.position,out),sub(target,delta),target],id=uid();
 let document=createPenCurve(base,layerId,shape,width,id,taperScale);
 if(from.last)document=connect(document,{curveId:from.last,end:1},{curveId:id,end:0},join,undefined,preserveAuthoredBrush);
 const first=from.first??{curveId:id,end:0 as const};
 if(closed)document=connect(document,first,{curveId:id,end:1},join,undefined,preserveAuthoredBrush);
 const actual=shapeOf(document,id);
 return {document,next:{position:target,out:join==='SMOOTH'?sub(target,actual[2]):[0,0],last:id,first},closed,shape:actual};
}
export function previewPenGesture(gesture:PenGesture,options:PenOptions):PenCandidate|undefined {
 return gesture.from&&length(sub(gesture.start,gesture.from.position))*options.unit>2?penCandidate(gesture.base,gesture.from,gesture.start,gesture.cursor,options):undefined;
}
export function finishPenGesture(gesture:PenGesture,options:PenOptions):PenResult {
 if(!gesture.from)return {state:{position:gesture.start,out:sub(gesture.cursor,gesture.start)}};
 const candidate=previewPenGesture(gesture,options);
 return candidate?{state:candidate.closed?null:candidate.next,candidate}:{state:gesture.from};
}
/** History keys belong to the host: Drawing uses its document, Recording uses
 * the immutable workspace revision. An unsaved first anchor has no document edit. */
export function penHistoryAction(redo:boolean,activeGesture:boolean,state:PenState|null):'cancel-gesture'|'cancel-anchor'|'history' {
 return activeGesture?'cancel-gesture':!redo&&state&&!state.last?'cancel-anchor':'history';
}
