import {useEffect,useRef} from 'react';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {sourcePoint,normalizedPoint,perspectiveMatrix,map3,inverse3,assertPerspective,type LayerPerspective,type Matrix3} from '../../domain/assembly/perspective';
import {layerProjection} from '../../domain/assembly/projection';
import type {Point2} from '../../domain/drawing/model';
import type {DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
import {uiText as t} from '../i18n';
interface Drag extends TrackedPointer {base:LayerPerspective;index:number;inverse:Matrix3;svg:SVGSVGElement;start:Point2;corner:Point2;latest:LayerPerspective}
interface Props {curved?:boolean;a:AssemblyDocument;p:LayerPerspective;view:DrawingUnderlay;change:(p:LayerPerspective|null,commit?:boolean)=>void;error:(s:string)=>void}
export default function PerspectiveCage({a,p,view,change,error,curved=false}:Props){
 const drag=useRef<Drag|null>(null),latest=useRef({change,error});latest.current={change,error};
 const point=(svg:SVGSVGElement,x:number,y:number):Point2=>{const matrix=svg.getScreenCTM();if(!matrix)throw Error('画布暂不可用');const q=new DOMPoint(x,y).matrixTransform(matrix.inverse());return [q.x,q.y];};
 const update=(e:PointerEvent|MouseEvent)=>{
  const d=drag.current;if(!d)return;
  try{
   const q=map3(d.inverse,point(d.svg,e.clientX,e.clientY)),quad=structuredClone(d.base.quad);
   quad[d.index]=normalizedPoint(d.base.source,[d.corner[0]+q[0]-d.start[0],d.corner[1]+q[1]-d.start[1]]);
   const next={...d.base,quad,enabled:true};assertPerspective(next);d.latest=next;latest.current.change(next);latest.current.error('');
  }catch(e){latest.current.error((e as Error).message);}
 };
 const finish=(event?:PointerEvent|MouseEvent,interrupted=false)=>{if(!drag.current)return;if(event&&!interrupted)update(event);const d=drag.current;drag.current=null;latest.current.change(interrupted?null:d.latest,!interrupted);};
 usePointerDragTracking({active:()=>drag.current,move:update,finish});
 useEffect(()=>{
  const cancel=(e:KeyboardEvent)=>{if(!drag.current)return;if(e.key==='Escape'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')){e.preventDefault();e.stopImmediatePropagation();finish(undefined,true);}};
  window.addEventListener('keydown',cancel,true);return()=>{window.removeEventListener('keydown',cancel,true);if(drag.current){drag.current=null;latest.current.change(null);}};
 },[]);
 const {placement}=layerProjection(a,p.layerId,view),corners=p.quad.map(q=>map3(placement,sourcePoint(p.source,q)));
 const h=perspectiveMatrix(p),project=(uv:Point2)=>map3(placement,map3(h,sourcePoint(p.source,uv)));
 let editable=true;try{inverse3(placement);}catch{editable=false;}
 return <g data-testid="assembly-perspective-cage" data-layer={p.layerId}>
  {!curved&&<path d={corners.map((q,i)=>(i?'L':'M')+q).join('')+'Z'} fill="none" stroke="#bb6c23" strokeWidth="1.5" pointerEvents="none"/>}
  {!curved&&[.25,.5,.75].map(n=><path key={n} d={`M${project([n,0])}L${project([n,1])}M${project([0,n])}L${project([1,n])}`} fill="none" stroke="#bb6c23" strokeOpacity=".5" strokeDasharray="4 4" pointerEvents="none"/>)}
  {corners.map((q,index)=><rect key={index} data-testid="assembly-perspective-corner" data-corner={index} x={q[0]-6} y={q[1]-6} width="12" height="12" fill={editable?'#fff6dc':'#c8c8c8'} stroke="#b66d29" strokeWidth="2" style={{cursor:editable?'move':'not-allowed',touchAction:'none'}} onPointerDown={e=>{
   if(e.button!==0)return;e.stopPropagation();e.preventDefault();
   try{const svg=e.currentTarget.ownerSVGElement!,inverse=inverse3(placement);svg.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={base:p,index,inverse,svg,start:map3(inverse,point(svg,e.clientX,e.clientY)),corner:sourcePoint(p.source,p.quad[index]),latest:p,pointerId:e.pointerId,button:e.button,pointerType:e.pointerType};}
   catch(e){error((e as Error).message);}
  }}/>)}
  {!editable&&<text x={corners[2][0]+10} y={corners[2][1]-12} fill="#b66d29" fontSize="12" pointerEvents="none">{t('接近侧立，请转回一些角度再调整')}</text>}
 </g>;
}
