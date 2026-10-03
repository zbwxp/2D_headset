import type {PointerEvent} from 'react';
import {add,mul,type Point2} from '../../domain/drawing/model';
import {drawingDeformProjection,quadProjection,type DeformRect,type Quad} from '../../domain/drawing/deform';
import {bendEdges,type BendValue} from '../../domain/deformation/coons';
import {point} from '../../domain/drawing/sampling';
import {inverse3,map3} from '../../domain/assembly/perspective';
import {uiText as t} from '../i18n';

/** Pointer deltas enter the normalized pre-homography boundary frame. */
export function moveDeformBoundary(rect:DeformRect,quad:Quad,bend:BendValue,edge:number,handle:0|1|2,start:Point2,current:Point2):BendValue{
 const inverse=inverse3(quadProjection(rect,quad).matrix),a=map3(inverse,start),b=map3(inverse,current),delta:Point2=[(b[0]-a[0])/(rect.max[0]-rect.min[0]),(b[1]-a[1])/(rect.max[1]-rect.min[1])],next=structuredClone(bend);
 if(handle===2)for(const i of [0,1] as const)next.handles[edge][i]=add(next.handles[edge][i],mul(delta,4/3));
 else next.handles[edge][handle]=add(next.handles[edge][handle],delta);
 return next;
}

/** The same editing cage can present source edits or snapshot-local targets.
 * All document writes and gesture lifetime stay with the editing context. */
export default function DeformCageOverlay({rect,quad,bend,screen,onCorner,onBoundary}:{rect:DeformRect;quad:Quad;bend:BendValue;screen:(p:Point2)=>Point2;onCorner:(event:PointerEvent,index:number)=>void;onBoundary:(event:PointerEvent,edge:number,handle:0|1|2)=>void}){
 const project=quadProjection(rect,quad),deform=drawingDeformProjection(rect,quad,bend),source=([u,v]:Point2):Point2=>[rect.min[0]+u*(rect.max[0]-rect.min[0]),rect.min[1]+v*(rect.max[1]-rect.min[1])],map=(p:Point2)=>screen(project.map(source(p)));
 const poly=(f:(t:number)=>Point2)=>Array.from({length:33},(_,i)=>`${i?'L':'M'} ${f(i/32).join(' ')}`).join(' '),edges=bendEdges(bend);
 return <g data-testid="drawing-deform-cage">
  {[.25,.5,.75].map(n=><path key={n} d={poly(v=>screen(deform.map(source([n,v]))))+poly(u=>screen(deform.map(source([u,n]))))} fill="none" stroke="#a35ac0" strokeDasharray="4 4" opacity=".4" pointerEvents="none"/>)}
  {edges.map((edge,i)=><g key={i}>
   <path data-testid="drawing-deform-edge" data-edge={i} d={poly(t=>map(point(edge,t)))} fill="none" stroke="#a35ac0" strokeWidth="1.5" pointerEvents="none"/>
   {([0,1] as const).map(handle=>{const p=map(edge[handle+1]),anchor=map(edge[handle?3:0]);return <g key={handle}>
    <path d={`M ${anchor.join(' ')} L ${p.join(' ')}`} fill="none" stroke="#a35ac0" opacity=".65" pointerEvents="none"/>
    <circle data-testid="drawing-deform-bend-handle" data-edge={i} data-handle={handle} cx={p[0]} cy={p[1]} r="4.5" fill="white" stroke="#a35ac0" strokeWidth="1.5" style={{cursor:'move',touchAction:'none'}} onPointerDown={event=>onBoundary(event,i,handle)}><title>{t('拖动控制柄调整曲边')}</title></circle>
   </g>;})}
   {(()=>{const p=map(point(edge,.5));return <path data-testid="drawing-deform-bend-midpoint" data-edge={i} d={`M ${p[0]} ${p[1]-5} l 5 5 -5 5 -5 -5 Z`} fill="#a35ac0" stroke="white" style={{cursor:'move',touchAction:'none'}} onPointerDown={event=>onBoundary(event,i,2)}><title>{t('拖动边中点整体弯曲')}</title></path>;})()}
  </g>)}
  {quad.map((p,i)=>{const q=screen(p);return <rect key={i} data-testid="drawing-deform-corner" data-corner={i} x={q[0]-6} y={q[1]-6} width="12" height="12" fill="white" stroke="#a35ac0" strokeWidth="2" style={{cursor:'move',touchAction:'none'}} onPointerDown={event=>onCorner(event,i)}><title>{t('拖动四角变形')}</title></rect>;})}
 </g>;
}
