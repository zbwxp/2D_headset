import {useRef} from 'react';
import type {Angle} from '../../domain/vectorRecording/interpolation';
import {sameAngle} from '../../domain/vectorRecording/interpolation';
import {sceneAngleFromPad,sceneAngleToPad} from './angleInspection';
import './angleInspection.css';

export interface SceneAnglePadProps {
 angle:Angle;
 views:readonly {id:string;name:string;angle:Angle}[];
 onChange:(angle:Angle)=>void;
 zh?:boolean;
}

/** View navigation only. The parent owns its numeric inputs and transactions. */
export default function SceneAnglePad({angle,views,onChange,zh=false}:SceneAnglePadProps){
 const drag=useRef<{id:number;x:number;y:number;moved:boolean;view?:Angle}|null>(null),point=sceneAngleToPad(angle);
 function update(event:React.PointerEvent<HTMLDivElement>){const rect=event.currentTarget.getBoundingClientRect();if(rect.width&&rect.height)onChange(sceneAngleFromPad((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height));}
 function release(event:React.PointerEvent<HTMLDivElement>){if(drag.current?.id!==event.pointerId)return;drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 return <div className="vr-angle-pad-wrap" data-testid="scene-angle-pad-wrap">
  <div className="vr-angle-pad" data-testid="scene-angle-pad" role="group" aria-label={zh?'XY 角度平面：X 左右转向，Y 上下俯仰':'XY angle pad: X yaw, Y pitch'} data-ui-keyboard="true"
   onPointerDown={event=>{if(event.button!==0||drag.current!==null)return;event.preventDefault();event.stopPropagation();const viewId=(event.target as Element).closest('[data-view-id]')?.getAttribute('data-view-id'),view=views.find(v=>v.id===viewId)?.angle;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,view};event.currentTarget.setPointerCapture(event.pointerId);if(!view)update(event);}}
   onPointerMove={event=>{if(drag.current?.id===event.pointerId){event.preventDefault();const start=drag.current;if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>2)start.moved=true;if(start.moved)update(event);}}}
   onPointerUp={event=>{if(drag.current?.id===event.pointerId){if(drag.current.view&&!drag.current.moved)onChange(drag.current.view);else update(event);release(event);}}}
   onPointerCancel={release} onLostPointerCapture={()=>{drag.current=null;}}>
   <span className="vr-angle-pad-axis horizontal"/><span className="vr-angle-pad-axis vertical"/>
   <span className="vr-angle-pad-label top">+Y 90°</span><span className="vr-angle-pad-label bottom">−Y 90°</span>
   <span className="vr-angle-pad-label left">−90°</span><span className="vr-angle-pad-label right">+X 90°</span>
   {views.map(view=>{const p=sceneAngleToPad(view.angle);return <button type="button" key={view.id} aria-label={`${view.name} · X ${view.angle.x}° / Y ${view.angle.y}°`} onClick={event=>{event.stopPropagation();if(event.detail===0)onChange(view.angle);}} className={'vr-angle-pad-view'+(sameAngle(view.angle,angle)?' current':'')} data-testid="scene-angle-pad-view" data-view-id={view.id} title={`${view.name} · X ${view.angle.x}° / Y ${view.angle.y}°`} style={{left:`${p[0]*100}%`,top:`${p[1]*100}%`}}/>;})}
   <span className="vr-angle-pad-cursor" data-testid="scene-angle-pad-cursor" data-angle-x={angle.x} data-angle-y={angle.y} style={{left:`${point[0]*100}%`,top:`${point[1]*100}%`}}/>
  </div>
  <div className="vr-angle-pad-caption"><span>{zh?'拖动检查 · 点标记跳转':'Drag to inspect · click marks to jump'}</span><span>X {angle.x}° / Y {angle.y}°</span></div>
 </div>;
}
