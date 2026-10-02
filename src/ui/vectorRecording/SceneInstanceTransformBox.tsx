import type {PointerEvent} from 'react';
import type {Point2} from '../../domain/drawing/model';
import type {ScenePlacementValue} from '../../domain/recordingScene/model';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';

export type InstanceTransformBounds={min:Point2;max:Point2;center:Point2};
export type InstanceTransformKind='move'|'scale'|'rotate';
export type RecordingInstanceTransform={ids:string[];bounds:InstanceTransformBounds;onPreview:(delta:ScenePlacementValue|null)=>void;onCommit:(delta:ScenePlacementValue)=>void;editable:boolean;label:string};
export type InstanceTransformGesture={kind:InstanceTransformKind;start:Point2;origin:Point2;lastAngle:number;rotation:number};
export function beginInstanceTransform(kind:InstanceTransformKind,start:Point2,origin:Point2):InstanceTransformGesture{
 return {kind,start,origin,lastAngle:Math.atan2(start[1]-origin[1],start[0]-origin[0]),rotation:0};
}
/** Deltas are world-space similarities, left-composed onto each instance. The
 * gesture accumulates angle across the atan2 seam instead of wrapping at 180°. */
export function instanceTransformDelta(gesture:InstanceTransformGesture,point:Point2,shift=false):ScenePlacementValue{
 const {kind,start,origin}=gesture;
 if(kind==='move')return {translation:[point[0]-start[0],point[1]-start[1]],rotation:0,scale:1};
 let rotation=0,scale=1;
 if(kind==='scale'){
  const x=start[0]-origin[0],y=start[1]-origin[1],length=x*x+y*y;
  scale=length>1e-20?Math.max(.001,((point[0]-origin[0])*x+(point[1]-origin[1])*y)/length):1;
 }else{
  const angle=Math.atan2(point[1]-origin[1],point[0]-origin[0]),step=Math.atan2(Math.sin(angle-gesture.lastAngle),Math.cos(angle-gesture.lastAngle));
  gesture.rotation+=step*180/Math.PI;gesture.lastAngle=angle;rotation=shift?Math.round(gesture.rotation/15)*15:gesture.rotation;
 }
 const a=rotation*Math.PI/180,c=Math.cos(a)*scale,s=Math.sin(a)*scale;
 return {translation:[origin[0]-c*origin[0]+s*origin[1],origin[1]-s*origin[0]-c*origin[1]],rotation,scale};
}
export function instanceTransformCorners(bounds:InstanceTransformBounds):Point2[]{return [bounds.min,[bounds.max[0],bounds.min[1]],bounds.max,[bounds.min[0],bounds.max[1]]];}

export default function SceneInstanceTransformBox({bounds,delta,screen,editable,label,onBegin}:{bounds:InstanceTransformBounds;delta?:ScenePlacementValue;screen:(p:Point2)=>Point2;editable:boolean;label:string;onBegin:(event:PointerEvent,kind:InstanceTransformKind,origin:Point2)=>void}){
 const map=(p:Point2)=>screen(delta?applyScenePlacement(delta,p):p),corners=instanceTransformCorners(bounds),points=corners.map(map),center=map(bounds.center),top=map([bounds.center[0],bounds.max[1]]),dx=top[0]-center[0],dy=top[1]-center[1],length=Math.hypot(dx,dy),rotation:Point2=[top[0]+(length?dx/length:0)*25,top[1]+(length?dy/length:-1)*25];
 return <g data-testid="vr-instance-transform-box" aria-label={label} data-editable={editable} opacity={editable?1:.55}>
  <polygon data-testid="vr-instance-move" points={points.map(p=>p.join(',')).join(' ')} fill="transparent" stroke="#238eb5" strokeWidth="1.25" strokeDasharray="4 3" style={{cursor:editable?'move':'default'}} onPointerDown={e=>onBegin(e,'move',bounds.center)}/>
  <line x1={top[0]} y1={top[1]} x2={rotation[0]} y2={rotation[1]} stroke="#238eb5" pointerEvents="none"/>
  <circle data-testid="vr-instance-rotate" cx={rotation[0]} cy={rotation[1]} r="5" fill="#fff" stroke="#238eb5" style={{cursor:editable?'alias':'default'}} onPointerDown={e=>onBegin(e,'rotate',bounds.center)}/>
  {corners.map((_,i)=><rect key={i} data-testid="vr-instance-scale" data-corner={i} x={points[i][0]-4} y={points[i][1]-4} width="8" height="8" fill="#fff" stroke="#238eb5" style={{cursor:editable?(i%2?'nwse-resize':'nesw-resize'):'default'}} onPointerDown={e=>onBegin(e,'scale',corners[(i+2)%4])}/>)}
  <circle data-testid="vr-instance-center" cx={center[0]} cy={center[1]} r="9" fill="transparent" style={{cursor:editable?'move':'default'}} onPointerDown={e=>onBegin(e,'move',bounds.center)}/>
  <path d={`M ${center[0]-5} ${center[1]} h 10 M ${center[0]} ${center[1]-5} v 10`} stroke="#238eb5" pointerEvents="none"/>
 </g>;
}
