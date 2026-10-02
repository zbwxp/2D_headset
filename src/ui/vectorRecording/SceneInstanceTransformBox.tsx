import type {PointerEvent} from 'react';
import type {Point2} from '../../domain/drawing/model';
import type {ScenePlacementValue} from '../../domain/recordingScene/model';
import {applyScenePlacement,scenePlacementScales,setScenePlacementAxisScale} from '../../domain/recordingScene/tracks';

export type InstanceTransformBounds={min:Point2;max:Point2;center:Point2};
export type InstanceTransformKind='move'|'scale'|'rotate';
export type RecordingInstanceTransform={ids:string[];bounds:InstanceTransformBounds;onPreview:(delta:ScenePlacementValue|null)=>void;onCommit:(delta:ScenePlacementValue)=>void;editable:boolean;label:string;basePlacement?:ScenePlacementValue;materialBounds?:InstanceTransformBounds;onValuePreview?:(value:ScenePlacementValue|null)=>void;onValueCommit?:(value:ScenePlacementValue)=>void};
export type InstanceTransformGesture={kind:InstanceTransformKind;start:Point2;origin:Point2;lastAngle:number;rotation:number};
export type InstanceAxisScaleGesture={axis:'x'|'y';start:Point2;anchor:Point2;extent:number;placement:ScenePlacementValue};
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
/** Uses the original material extent instead of the displayed width, so an
 * exact-zero axis can be expanded again without an inverse or minimum scale. */
export function instanceAxisScaleValue(gesture:InstanceAxisScaleGesture,point:Point2):ScenePlacementValue{
 const {axis,start,anchor,extent,placement}=gesture,a=placement.rotation*Math.PI/180,direction:Point2=axis==='x'?[Math.cos(a),Math.sin(a)]:[-Math.sin(a),Math.cos(a)],scales=scenePlacementScales(placement),distance=(point[0]-start[0])*direction[0]+(point[1]-start[1])*direction[1];
 const current=scales[axis==='x'?0:1],raw=extent===0?current:current+distance/extent,next=raw<=Number.EPSILON*Math.max(1,current)*8?0:Math.min(1e6,raw);
 return setScenePlacementAxisScale(placement,axis,next,anchor);
}
export function instanceTransformCorners(bounds:InstanceTransformBounds):Point2[]{return [bounds.min,[bounds.max[0],bounds.min[1]],bounds.max,[bounds.min[0],bounds.max[1]]];}

export default function SceneInstanceTransformBox({bounds,delta,basePlacement,materialBounds,value,screen,editable,label,onBegin,onBeginAxis}:{bounds:InstanceTransformBounds;delta?:ScenePlacementValue;basePlacement?:ScenePlacementValue;materialBounds?:InstanceTransformBounds;value?:ScenePlacementValue;screen:(p:Point2)=>Point2;editable:boolean;label:string;onBegin:(event:PointerEvent,kind:InstanceTransformKind,origin:Point2)=>void;onBeginAxis?:(event:PointerEvent,axis:'x'|'y',anchor:Point2,extent:number)=>void}){
 const placed=basePlacement&&materialBounds,frame=placed?materialBounds:bounds,placement=value??basePlacement;
 const world=(p:Point2)=>placed?applyScenePlacement(placement!,p):p,map=(p:Point2)=>screen(delta?applyScenePlacement(delta,world(p)):world(p)),corners=instanceTransformCorners(frame),points=corners.map(map),center=map(frame.center),top=map([frame.center[0],frame.max[1]]),worldCenter=world(frame.center);
 const angle=((placement?.rotation??0)+(delta?.rotation??0))*Math.PI/180,localY:Point2=[-Math.sin(angle),Math.cos(angle)],screenOrigin=screen([0,0]),screenY=screen(localY),dx=placed?screenY[0]-screenOrigin[0]:top[0]-center[0],dy=placed?screenY[1]-screenOrigin[1]:top[1]-center[1],length=Math.hypot(dx,dy),rotation:Point2=[top[0]+(length?dx/length:0)*30,top[1]+(length?dy/length:-1)*30];
 const axes=placed&&onBeginAxis?(['x','y'] as const).flatMap(axis=>{
  const component=axis==='x'?0:1,extent=frame.max[component]-frame.min[component],unit:Point2=axis==='x'?[Math.cos(angle),Math.sin(angle)]:[-Math.sin(angle),Math.cos(angle)],a=screen([0,0]),b=screen(unit),length=Math.hypot(b[0]-a[0],b[1]-a[1]),direction:Point2=length?[(b[0]-a[0])/length,(b[1]-a[1])/length]:[axis==='x'?1:0,axis==='y'?-1:0];
  return ([-1,1] as const).map(side=>{const point:Point2=[...frame.center],anchor:Point2=[...frame.center];point[component]=side<0?frame.min[component]:frame.max[component];anchor[component]=side<0?frame.max[component]:frame.min[component];const actual=map(point),other=map(anchor),displayExtent=Math.hypot(actual[0]-other[0],actual[1]-other[1]),offset=Math.max(0,14-displayExtent/2),handle:Point2=[actual[0]+direction[0]*side*offset,actual[1]+direction[1]*side*offset];return {axis,side,anchor,extent:side*extent,actual,handle,offset};});
 }):[];
 return <g data-testid="vr-instance-transform-box" aria-label={label} data-editable={editable} opacity={editable?1:.55}>
  <polygon data-testid="vr-instance-move" points={points.map(p=>p.join(',')).join(' ')} fill="transparent" stroke="#238eb5" strokeWidth="1.25" strokeDasharray="4 3" style={{cursor:editable?'move':'default'}} onPointerDown={e=>onBegin(e,'move',worldCenter)}/>
  <line x1={top[0]} y1={top[1]} x2={rotation[0]} y2={rotation[1]} stroke="#238eb5" pointerEvents="none"/>
  <circle data-testid="vr-instance-rotate" cx={rotation[0]} cy={rotation[1]} r="5" fill="#fff" stroke="#238eb5" style={{cursor:editable?'alias':'default'}} onPointerDown={e=>onBegin(e,'rotate',worldCenter)}/>
  {corners.map((_,i)=><rect key={i} data-testid="vr-instance-scale" data-corner={i} x={points[i][0]-4} y={points[i][1]-4} width="8" height="8" fill="#fff" stroke="#238eb5" style={{cursor:editable?(i%2?'nwse-resize':'nesw-resize'):'default'}} onPointerDown={e=>onBegin(e,'scale',world(corners[(i+2)%4]))}/>)}
  <circle data-testid="vr-instance-center" cx={center[0]} cy={center[1]} r="9" fill="transparent" style={{cursor:editable?'move':'default'}} onPointerDown={e=>onBegin(e,'move',worldCenter)}/>
  <path d={`M ${center[0]-5} ${center[1]} h 10 M ${center[0]} ${center[1]-5} v 10`} stroke="#238eb5" pointerEvents="none"/>
  {axes.map(({axis,side,anchor,extent,actual,handle,offset})=><g key={`${axis}${side}`}>
   {offset>0&&<line x1={actual[0]} y1={actual[1]} x2={handle[0]} y2={handle[1]} stroke="#238eb5" strokeDasharray="2 2" pointerEvents="none"/>}
   <rect data-testid={`vr-instance-scale-${axis}`} data-side={side} x={handle[0]-5} y={handle[1]-5} width="10" height="10" rx="1" fill="#e7f6fc" stroke="#238eb5" pointerEvents="all" style={{cursor:editable?(axis==='x'?'ew-resize':'ns-resize'):'default'}} onPointerDown={event=>onBeginAxis!(event,axis,anchor,extent)}><title>{axis==='x'?'Scale X':'Scale Y'} · drag edge; zero is allowed</title></rect>
  </g>)}
 </g>;
}
