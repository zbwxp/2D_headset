import {useEffect,useRef} from 'react';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {bendEdges,bendPoint,assertBend,type BendValue} from '../../domain/assembly/bending';
import {layerProjection} from '../../domain/assembly/projection';
import {map3,inverse3,sourcePoint,normalizedPoint,type LayerPerspective,type Matrix3} from '../../domain/assembly/perspective';
import {point} from '../../domain/drawing/sampling';
import type {Point2} from '../../domain/drawing/model';
import type {DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
import {uiText as t} from '../i18n';
interface Drag extends TrackedPointer {base:BendValue;edge:number;handle:number;inverse:Matrix3;svg:SVGSVGElement;start:Point2;latest:BendValue}
export default function BendCage({a,p,value,view,change,error}:{a:AssemblyDocument;p:LayerPerspective;value:BendValue;view:DrawingUnderlay;change:(v:BendValue|null,commit?:boolean)=>void;error:(s:string)=>void}){
 const drag=useRef<Drag|null>(null),callbacks=useRef({change,error});callbacks.current={change,error};
 const {manualPlacement}=layerProjection(a,p.layerId,view),project=(q:Point2)=>map3(manualPlacement,sourcePoint(p.source,q)),edges=bendEdges(value);
 const position=(svg:SVGSVGElement,e:{clientX:number;clientY:number},inverse:Matrix3)=>{const m=svg.getScreenCTM();if(!m)throw Error('画布暂不可用');const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());return normalizedPoint(p.source,map3(inverse,[q.x,q.y]));};
 const update=(e:PointerEvent|MouseEvent)=>{const d=drag.current;if(!d)return;try{const q=position(d.svg,e,d.inverse),next=structuredClone(d.base);next.enabled=true;
  for(const j of [0,1])if(d.handle===j||d.handle===2){const rate=d.handle===2?4/3:1;next.handles[d.edge][j]=[d.base.handles[d.edge][j][0]+(q[0]-d.start[0])*rate,d.base.handles[d.edge][j][1]+(q[1]-d.start[1])*rate];}
  assertBend(next);d.latest=next;callbacks.current.change(next);callbacks.current.error('');
 }catch(e){callbacks.current.error((e as Error).message);}};
 const finish=(e?:PointerEvent|MouseEvent,cancel=false)=>{if(!drag.current)return;if(e&&!cancel)update(e);const d=drag.current;drag.current=null;callbacks.current.change(cancel?null:d.latest,!cancel);};
 usePointerDragTracking({active:()=>drag.current,move:update,finish});
 useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(drag.current&&(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')){e.preventDefault();e.stopImmediatePropagation();finish(undefined,true);}};window.addEventListener('keydown',cancel,true);return()=>{window.removeEventListener('keydown',cancel,true);if(drag.current)callbacks.current.change(null);};},[]);
 const down=(e:React.PointerEvent<SVGElement>,edge:number,handle:number)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();try{const svg=e.currentTarget.ownerSVGElement!,inverse=inverse3(manualPlacement);svg.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={base:value,latest:value,edge,handle,svg,inverse,start:position(svg,e,inverse),pointerId:e.pointerId,button:e.button,pointerType:e.pointerType};}catch(e){error((e as Error).message);}};
 const poly=(fn:(t:number)=>Point2)=>Array.from({length:33},(_,i)=>(i?'L':'M')+project(fn(i/32))).join('');
 return <g data-testid="assembly-bend-cage" data-layer={p.layerId}>
  {[.25,.5,.75].map(n=><path key={n} d={poly(t=>bendPoint(value,[n,t]))+poly(t=>bendPoint(value,[t,n]))} fill="none" stroke="#2c91a4" strokeOpacity=".45" strokeDasharray="3 4" pointerEvents="none"/>)}
  {edges.map((edge,i)=><g key={i}>
   <path d={poly(t=>point(edge,t))} fill="none" stroke="#2c91a4" strokeWidth="1.8" pointerEvents="none"/>
   {[0,1].map(j=>{const q=project(edge[j+1]),anchor=project(edge[j?3:0]);return <g key={j}>
    <path d={`M${anchor}L${q}`} stroke="#2c91a4" opacity=".65" pointerEvents="none"/>
    <circle data-testid="assembly-bend-handle" data-edge={i} data-handle={j} cx={q[0]} cy={q[1]} r="5" fill="#efffff" stroke="#208698" strokeWidth="2" style={{cursor:'move',touchAction:'none'}} onPointerDown={e=>down(e,i,j)}><title>{t('拖动控制柄调整曲边')}</title></circle>
   </g>;})}
   {(()=>{const q=project(point(edge,.5));return <path data-testid="assembly-bend-midpoint" data-edge={i} d={`M${q[0]} ${q[1]-6}l6 6 -6 6 -6 -6Z`} fill="#2c91a4" stroke="white" style={{cursor:'move',touchAction:'none'}} onPointerDown={e=>down(e,i,2)}><title>{t('拖动边中点整体弯曲')}</title></path>;})()}
  </g>)}
 </g>;
}
