import type {PointerEvent} from 'react';
import {editable,type DrawingDocument,type Point2} from '../../domain/drawing/model';

/** Compiled Drawing IDs and final displayed world coordinates. */
export type RecordingCurveEdit={kind:'node';nodeId:string;position:Point2}|{kind:'handle';curveId:string;end:0|1;position:Point2};
export type RecordingCurveEditor={revealTool?:'select'|'direct';editable:boolean;onPreview:(edit:RecordingCurveEdit|null)=>void;onCommit:(edit:RecordingCurveEdit)=>void;onSelect?:(edit:RecordingCurveEdit)=>void};
export type RecordingCurveGesture={edit:RecordingCurveEdit;start:Point2;editor:RecordingCurveEditor};

/** Keep the grabbed point, including its pointer offset, fixed across pose previews. */
export function beginRecordingCurveGesture(edit:RecordingCurveEdit,start:Point2,editor:RecordingCurveEditor):RecordingCurveGesture{
 return {edit:{...edit,position:[...edit.position]},start:[...start],editor};
}
export function recordingCurveGestureEdit(gesture:RecordingCurveGesture,point:Point2):RecordingCurveEdit{
 return {...gesture.edit,position:[gesture.edit.position[0]+point[0]-gesture.start[0],gesture.edit.position[1]+point[1]-gesture.start[1]]};
}
export function recordingCurveControl(drawing:DrawingDocument,edit:RecordingCurveEdit):RecordingCurveEdit|null{
 if(edit.kind==='node'){const node=drawing.nodes.find(n=>n.id===edit.nodeId);return node?{...edit,position:node.position}:null;}
 const curve=drawing.curves.find(c=>c.id===edit.curveId);return curve?{...edit,position:curve.handles[edit.end]}:null;
}

/** Raw source controls stay visible even when ARC or display intervals trim ink. */
export default function SceneCurveEditOverlay({drawing,curveIds,screen,selected,editable:canEdit,onBegin,zh}:{drawing:DrawingDocument;curveIds:string[];screen:(point:Point2)=>Point2;selected:RecordingCurveEdit|null;editable:boolean;onBegin:(event:PointerEvent,edit:RecordingCurveEdit)=>void;zh:boolean}){
 const curves=drawing.curves.filter(c=>curveIds.includes(c.id)&&editable(drawing,c.id)),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 return <g data-testid="vr-curve-edit-overlay" data-editable={canEdit}>
  {curves.map(curve=><g key={curve.id}>{([0,1] as const).map(end=>{
   const node=drawing.nodes.find(n=>n.id===curve.nodes[end]);if(!node)return null;const p=screen(curve.handles[end]),a=screen(node.position),short=Math.hypot(p[0]-a[0],p[1]-a[1])<10,active=selected?.kind==='handle'&&selected.curveId===curve.id&&selected.end===end;
   return <g key={end}><line x1={a[0]} y1={a[1]} x2={p[0]} y2={p[1]} stroke="#2589b0" strokeWidth="1" pointerEvents="none"/><circle data-testid="vr-curve-handle" data-id={curve.id} data-end={end} data-short={short} data-active={active} cx={p[0]} cy={p[1]} r={short?9:4.5} fill={short?'transparent':active?'#c8eafa':'#fff'} stroke="#2589b0" strokeWidth={active?2:1.5} strokeDasharray={short?'3 2':undefined} pointerEvents="all" style={{cursor:canEdit?'move':'default'}} onPointerDown={event=>onBegin(event,{kind:'handle',curveId:curve.id,end,position:curve.handles[end]})}><title>{zh?(short?'短控制柄：拖动圆环':'控制柄'):(short?'Short Bézier handle: drag the ring':'Bézier handle')}</title></circle></g>;
  })}</g>)}
  {drawing.nodes.filter(node=>nodeIds.has(node.id)).map(node=>{const p=screen(node.position),active=selected?.kind==='node'&&selected.nodeId===node.id;return <rect key={node.id} data-testid="vr-curve-node" data-node={node.id} data-active={active} x={p[0]-4} y={p[1]-4} width="8" height="8" fill={active?'#248ec1':'#fff'} stroke="#248ec1" strokeWidth="1.4" pointerEvents="all" style={{cursor:canEdit?'move':'default'}} onPointerDown={event=>onBegin(event,{kind:'node',nodeId:node.id,position:node.position})}><title>{zh?'曲线端点':'Curve endpoint'}</title></rect>;})}
 </g>;
}
