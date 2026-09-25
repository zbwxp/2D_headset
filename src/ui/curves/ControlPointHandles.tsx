import {useRef} from 'react';
import {useEditor} from '../../app/store';
import {pointPosition} from '../../domain/geometry/evaluation';
import {displayPoint,rawDisplayPlane} from '../../rendering/moduleDisplay';
import {worldToSvg,screenToPlane,type OrthographicViewState} from '../../rendering/orthographic';
import {modulePickable} from '../authoring/moduleAccess';
export default function ControlPointHandles({view}:{view:OrthographicViewState}){
 const s=useEditor(),drag=useRef<{id:string;started:boolean;x:number;y:number}|null>(null),c=s.project.curves.find(c=>c.id===s.selectedCurveId);
 if(!c||!('controlPointIds' in c)||s.tool.kind!=='select'||!modulePickable(c.id))return null;
 const pos=(id:string)=>worldToSvg(displayPoint(s.project,id,pointPosition(s.project,id),view.forward),view);
 const finish=()=>{if(drag.current?.started)useEditor.getState().endEdit();drag.current=null;};
 return <g data-testid="control-point-handles">{c.controlPointIds.map((id,i)=>{const a=pos(i?c.endLandmarkId:c.startLandmarkId),b=pos(id);return <g key={id}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#d3b5ee" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/><circle data-testid={`lid-handle-${i}`} cx={b[0]} cy={b[1]} r={6/view.zoom} fill="#543b64" stroke="#ffe0ff" vectorEffect="non-scaling-stroke" style={{cursor:'grab'}} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id,started:false,x:e.clientX,y:e.clientY};}} onPointerMove={e=>{const d=drag.current;if(!d)return;e.stopPropagation();if(!d.started&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<2)return;if(!d.started){s.beginEdit(true);d.started=true;}const rect=e.currentTarget.ownerSVGElement!.getBoundingClientRect(),xy=screenToPlane([e.clientX-rect.left,e.clientY-rect.top],view),current=useEditor.getState();current.movePoint(id,rawDisplayPlane(current.project,id,xy,view));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/></g>;})}</g>;
}
