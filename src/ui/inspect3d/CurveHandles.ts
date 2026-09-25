import {displayTransform} from '../../rendering/moduleDisplay';
import {gazeFacing} from '../../domain/eyes/tracking';
import {Camera,Plane,Raycaster,Vector2,Vector3} from 'three';
import type {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {useEditor} from '../../app/store';
import {canonical,handleShape,sourceControls} from '../../domain/curves/geometry';
import {isDerived,isFree3DShape} from '../../domain/curves/model';
import {mirrorPoint} from '../../domain/head/frame';
import {modulePickable} from '../authoring/moduleAccess';
import {uiText} from '../i18n';

/** Screen-sized editing overlay, projected with the actual inspection camera.
 * Source handles remain distinct from the evaluated/smoothed curve. */
export function createCurveHandles(host:HTMLElement,getCamera:()=>Camera,controls:OrbitControls){
 const ns='http://www.w3.org/2000/svg',overlay=document.createElementNS(ns,'svg');
 overlay.classList.add('inspect-curve-handles');overlay.dataset.testid='inspect-curve-handles';
 const lines=[0,1].map(()=>{const line=document.createElementNS(ns,'line');overlay.appendChild(line);return line;});
 const handles=([1,2] as const).map(index=>{
  const circle=document.createElementNS(ns,'circle');circle.setAttribute('r','6');
  circle.dataset.testid=`inspect-curve-handle-${index}`;circle.dataset.handleIndex=String(index);
  overlay.appendChild(circle);return circle;
 });
 host.appendChild(overlay);
 const selected=()=>{
  const s=useEditor.getState(),c=s.project.curves.find(c=>c.id===s.selectedCurveId);
  if(s.tool.kind!=='select'||s.referenceMoving||!c||isDerived(c)||!modulePickable(c.id))return null;
  const base=canonical(s.project,c);if(!isFree3DShape(base.shape))return null;
  return {project:s.project,curve:c,base};
 };
 type Selected=NonNullable<ReturnType<typeof selected>>;
 let drag:(Selected&{index:1|2;pointer:number;element:SVGCircleElement;x:number;y:number;plane:Plane;origin:Vector3;point:Vector3;started:boolean;orbitEnabled:boolean;pose:ReturnType<typeof displayTransform>})|null=null;
 const raycaster=new Raycaster();
 const hitPlane=(e:PointerEvent,plane:Plane)=>{
  const rect=overlay.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  raycaster.setFromCamera(new Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),getCamera());
  return raycaster.ray.intersectPlane(plane,new Vector3());
 };
 const finish=()=>{
  const d=drag;if(!d)return;drag=null;
  controls.enabled=d.orbitEnabled;d.element.style.cursor='';
  if(d.element.hasPointerCapture(d.pointer))d.element.releasePointerCapture(d.pointer);
  if(d.started)useEditor.getState().endEdit();
 };
 const down=(e:PointerEvent,index:1|2)=>{
  if(e.button!==0||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey||drag)return;
  const s=selected();if(!s)return;
  e.preventDefault();e.stopPropagation();
  // Stop residual orbit motion before fixing a camera-parallel drag plane.
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  const camera=getCamera();camera.updateMatrixWorld();
  const pose=displayTransform(s.project,s.curve.id,gazeFacing(camera.quaternion.toArray())),point=new Vector3(...pose.display(sourceControls(s.project,s.curve)[index]));
  const plane=new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),point),origin=hitPlane(e,plane);
  if(!origin)return;
  const element=handles[index-1];
  drag={...s,index,pointer:e.pointerId,element,x:e.clientX,y:e.clientY,plane,origin,point,pose,started:false,orbitEnabled:controls.enabled};
  controls.enabled=false;element.style.cursor='grabbing';element.setPointerCapture(e.pointerId);
  host.querySelector('canvas')?.focus({preventScroll:true});
 };
 const move=(e:PointerEvent)=>{
  const d=drag;if(!d||e.pointerId!==d.pointer)return;
  e.preventDefault();e.stopPropagation();
  if(!d.started&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<2)return;
  const hit=hitPlane(e,d.plane);if(!hit)return;
  const s=useEditor.getState();if(!d.started){s.beginEdit(true);d.started=true;}
  const target=d.pose.raw(hit.sub(d.origin).add(d.point).toArray());
  s.setCurveShape(d.base.id,handleShape(d.project,d.base,d.index,d.curve.role==='mirror'?mirrorPoint(d.project,target):target));
 };
 const up=(e:PointerEvent)=>{if(drag?.pointer!==e.pointerId)return;e.stopPropagation();finish();};
 handles.forEach((circle,i)=>{
  circle.addEventListener('pointerdown',e=>down(e,(i+1) as 1|2));
  circle.addEventListener('pointermove',move);circle.addEventListener('pointerup',up);
  circle.addEventListener('pointercancel',up);circle.addEventListener('lostpointercapture',up);
 });
 window.addEventListener('blur',finish);
 let cached:Selected|null=null,cp:ReturnType<typeof sourceControls>|null=null;
 return {
  update(){
   const s=selected();
   if(drag&&(!s||s.curve.id!==drag.curve.id))finish();
   overlay.style.display=s?'':'none';if(!s)return;
   if(cached?.project!==s.project||cached?.curve.id!==s.curve.id){cached=s;cp=sourceControls(s.project,s.curve);}
   const camera=getCamera(),width=host.clientWidth,height=host.clientHeight;
   const pose=displayTransform(s.project,s.curve.id,gazeFacing(camera.quaternion.toArray())),positions=cp!.map(p=>new Vector3(...pose.display(p)).project(camera));
   const visible=(q:Vector3)=>Number.isFinite(q.x)&&Number.isFinite(q.y)&&q.z>=-1&&q.z<=1;
   handles.forEach((circle,i)=>{
    const q=positions[i+1],anchor=positions[i===0?0:3],line=lines[i];
    circle.style.display=visible(q)?'':'none';circle.dataset.curveId=s.curve.id;
    circle.setAttribute('aria-label',uiText(`控制柄 ${i+1}`));
    circle.setAttribute('cx',String((q.x+1)*width/2));circle.setAttribute('cy',String((1-q.y)*height/2));
    line.style.display=visible(q)&&visible(anchor)?'':'none';
    line.setAttribute('x1',String((anchor.x+1)*width/2));line.setAttribute('y1',String((1-anchor.y)*height/2));
    line.setAttribute('x2',String((q.x+1)*width/2));line.setAttribute('y2',String((1-q.y)*height/2));
   });
  },
  dispose(){finish();window.removeEventListener('blur',finish);overlay.remove();},
 };
}
