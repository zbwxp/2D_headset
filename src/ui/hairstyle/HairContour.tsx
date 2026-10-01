import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {shapeOf,visible,layerFor,type Cubic,type DrawingDocument,type Point2,type Endpoint} from '../../domain/drawing/model';
import type {HairView} from '../../domain/hairstyle/projection';
import {hairDragGuide,type HairControl} from '../../domain/hairstyle/inverse';
import {useLanguage} from '../i18n';
import PaintScene from '../drawing/PaintScene';
import HairNetOverlay from './HairNetOverlay';
import type {HairGeometry} from '../../domain/hairstyle/geometry';
import {useHairZoom} from './useHairZoom';
import {curvePath} from '../drawing/geometry';
import type {DrawingSelection} from '../drawing/session';
import type {ReferenceImage} from '../../domain/project/types';

type Props={geometry:HairGeometry;netOverlay:boolean;netOpacity:number;drawing:DrawingDocument;view:HairView;zoom:number;orbitBaseUnit:number;pan:Point2;selection:DrawingSelection;choose:(id:string,shift:boolean)=>void;tool:'select'|'bind'|'cusp'|'zoom';active:string|null;endpoint:(e:Endpoint)=>void;first:Endpoint|null;moving:boolean;changeReference:(r:ReferenceImage)=>void;begin:()=>void;end:()=>void;showFills:boolean;fillVisibility:Record<string,boolean>;startControl:(id:string,control:HairControl)=>boolean;moveControl:(p:Point2)=>void;finishControl:(cancel?:boolean)=>void};
type CurveDrag={pointer:number;x:number;y:number;unit:number;shape:Cubic;control:HairControl;pending:Point2|null};
export default function HairContour({geometry,netOverlay,netOpacity,drawing:d,view,zoom,orbitBaseUnit,pan,selection,choose,tool,active,endpoint,first,moving,changeReference,begin,end,showFills,fillVisibility,startControl,moveControl,finishControl}:Props){
 const host=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:600,height:500}),drag=useRef<{id:number;x:number;y:number;reference:ReferenceImage}|null>(null);
 const curveDrag=useRef<CurveDrag|null>(null),raf=useRef(0),[guide,setGuide]=useState<{shape:Cubic;control:HairControl}|null>(null);
 const callbacks=useRef({moveControl,finishControl,end});callbacks.current={moveControl,finishControl,end};
 const zh=useLanguage(s=>s.language)==='zh',unit=Math.min(size.width/2.7,size.height/2.7)*zoom;
 const zoomTool=useHairZoom(tool==='zoom',unit/zoom/orbitBaseUnit);
 const screen=(p:Point2):Point2=>[size.width/2+(p[0]+pan[0])*unit,size.height/2+(-p[1]+pan[1])*unit];
 useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(host.current!);return()=>observer.disconnect();},[]);
 const flush=()=>{cancelAnimationFrame(raf.current);raf.current=0;const a=curveDrag.current;if(a?.pending){const target=a.pending;a.pending=null;setGuide({shape:hairDragGuide(a.shape,a.control,target),control:a.control});callbacks.current.moveControl(target);}};
 const finish=(cancel=false)=>{
  if(curveDrag.current){if(cancel)cancelAnimationFrame(raf.current);else flush();curveDrag.current=null;raf.current=0;setGuide(null);callbacks.current.finishControl(cancel);}
  if(drag.current){drag.current=null;callbacks.current.end();}
 };
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(!curveDrag.current)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();finish(true);}};
  window.addEventListener('keydown',key,true);
  return()=>{window.removeEventListener('keydown',key,true);cancelAnimationFrame(raf.current);if(curveDrag.current){const a=curveDrag.current;if(a.pending)callbacks.current.moveControl(a.pending);curveDrag.current=null;callbacks.current.finishControl();}if(drag.current){drag.current=null;callbacks.current.end();}};
 },[]);
 const down=(e:ReactPointerEvent<SVGGElement>,id:string,control:HairControl)=>{
  if(e.button!==0)return;e.stopPropagation();e.preventDefault();
  if(tool!=='select'){if(control===0||control===3)endpoint({curveId:id,end:control===0?0:1});return;}
  choose(id,false);if(!startControl(id,control))return;
  curveDrag.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,unit,shape:shapeOf(d,id),control,pending:null};
  e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId);
 };
 const move=(e:ReactPointerEvent<SVGSVGElement>)=>{
  const c=curveDrag.current;
  if(c&&c.pointer===e.pointerId){
   const dx=(e.clientX-c.x)/c.unit,dy=-(e.clientY-c.y)/c.unit;
   if(!guide&&Math.hypot(e.clientX-c.x,e.clientY-c.y)<2)return;
   const target:Point2=[c.shape[c.control][0]+dx,c.shape[c.control][1]+dy];
   c.pending=target;
   if(!raf.current)raf.current=requestAnimationFrame(flush);return;
  }
  const a=drag.current;if(!a||a.id!==e.pointerId)return;
  changeReference({...a.reference,offset:[Math.max(-10,Math.min(10,a.reference.offset[0]+(e.clientX-a.x)/unit)),Math.max(-10,Math.min(10,a.reference.offset[1]-(e.clientY-a.y)/unit))]});
 };
 const r=d.reference,refWidth=r?r.width/Math.max(r.width,r.height)*2.6*unit*r.scale:0,refHeight=r?refWidth*r.height/r.width:0;
 const picks=d.curves.filter(c=>visible(d,c.id)&&!c.locked&&(tool==='select'?selection.ids.includes(c.id):layerFor(d,c.id)?.id===active));
 return <div ref={host} className={"hair-contour"+(tool==='zoom'?' zoom-tool'+(zoomTool.out?' zoom-out':''):'')} tabIndex={0} {...zoomTool.handlers} data-testid="hair-contour">
  <svg width="100%" height="100%" role="img" aria-label={zh?'发型实时轮廓':'Live hair contour'} viewBox={`0 0 ${size.width} ${size.height}`} style={{cursor:moving?'move':tool==='select'?'default':'crosshair'}}
   onContextMenu={e=>{if(tool==='zoom')e.preventDefault();}} onPointerDown={e=>{if(e.button!==0||!moving||!r||r.locked||!r.visible)return;e.preventDefault();begin();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,reference:r};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={move} onPointerUp={e=>{if(curveDrag.current)move(e);finish();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>finish()} onLostPointerCapture={()=>finish()}>
   {r?.visible&&<image data-testid="hair-reference-image" href={r.dataUrl} x={-refWidth/2} y={-refHeight/2} width={refWidth} height={refHeight} opacity={r.opacity} transform={`translate(${screen(r.offset)}) rotate(${r.rotation})`} pointerEvents="none"/>}
   {netOverlay&&<HairNetOverlay shell={geometry.shell} base={geometry.base} rim={geometry.rim} netLines={geometry.netLines} view={view} width={size.width} height={size.height} unit={unit} panX={pan[0]} panY={pan[1]} opacity={netOpacity}/>}
   <PaintScene d={d} screen={screen} unit={unit} preview={false} showFills={showFills} fillVisibility={fillVisibility} referenceMoving={moving} tool="direct" selectedPaint={selection.paint} curveDown={(e,id)=>{if(tool!=='select')return;e.stopPropagation();choose(id,e.shiftKey||e.metaKey||e.ctrlKey);}} paintDown={(e,id)=>{e.stopPropagation();choose(id,e.shiftKey);}} arcDown={(e,id)=>{const j=d.joins.find(j=>j.id===id);if(j){e.stopPropagation();choose(j.a.curveId,e.shiftKey);}}}/>
   {!moving&&tool!=='zoom'&&picks.map(c=>{const shape=shapeOf(d,c.id);return <g key={c.id} data-testid="hair-selected-strand" data-id={c.id}>
    <path d={curvePath(shape,screen)} stroke="#268eb6" strokeWidth="1" strokeDasharray="4 4" fill="none" pointerEvents="none" opacity=".5"/>
    {tool==='select'&&([1,2] as const).map(i=>{const p=screen(shape[i]),a=screen(shape[i===1?0:3]);return <g key={'h'+i} data-testid="hair-handle" data-curve-id={c.id} data-control={i} aria-label={`${c.name} ${zh?'控制柄':'handle'} ${i}`} onPointerDown={e=>down(e,c.id,i)} style={{cursor:'grab'}}>
     <line x1={a[0]} y1={a[1]} x2={p[0]} y2={p[1]} stroke="#409eba" strokeWidth="1" pointerEvents="none"/>
     <circle cx={p[0]} cy={p[1]} r="10" fill="transparent"/>
     <circle cx={p[0]} cy={p[1]} r="4" fill="#e4f5fa" stroke="#268eb6" strokeWidth="1.5"/>
    </g>;})}
    {([0,1] as const).map(i=>{const p=screen(shape[i===0?0:3]),picked=first?.curveId===c.id&&first.end===i;return <g key={i} data-testid="hair-endpoint" data-curve-id={c.id} data-end={i} aria-label={`${c.name} ${i?(zh?'发梢':'tip'):(zh?'发根':'root')}`} onPointerDown={e=>down(e,c.id,i===0?0:3)} style={{cursor:tool==='select'?'grab':'pointer'}}><circle cx={p[0]} cy={p[1]} r="11" fill="transparent"/><circle cx={p[0]} cy={p[1]} r={picked?7:5} fill={picked?'#e69235':'#fff'} stroke={i?'#c78432':'#268eb6'} strokeWidth="2"/><text x={p[0]+8} y={p[1]-7} fontSize="11" fill={i?'#9c691f':'#247ca0'} pointerEvents="none">{i?(zh?'梢':'Tip'):(zh?'根':'Root')}</text></g>;})}
   </g>;})}
   {guide&&<g pointerEvents="none" data-testid="hair-drag-guide" opacity=".7"><path d={curvePath(guide.shape,screen)} stroke="#d58b30" strokeWidth="1.25" strokeDasharray="5 4" fill="none"/>{(()=>{const p=screen(guide.shape[guide.control]),a=screen(guide.shape[guide.control<2?0:3]);return <><line x1={a[0]} y1={a[1]} x2={p[0]} y2={p[1]} stroke="#d58b30" strokeDasharray="3 3"/><circle cx={p[0]} cy={p[1]} r="5" fill="none" stroke="#d58b30"/></>;})()}</g>}
  </svg>
  <div className="hair-contour-view">Yaw {view.yaw.toFixed(1)}° · {zh?'俯仰':'Pitch'} {view.pitch.toFixed(1)}°</div>
  <div className="hair-contour-note">{tool==='zoom'?(zh?'Z 缩放：上拖放大，下拖缩小 · V/A 返回选择':'Z zoom: drag up / down · V/A to select'):moving?(zh?'拖动参考图 · 滑条可缩放至 1000%':'Drag reference · Scale up to 1000%'):tool==='select'?(zh?'当前视角二维编辑 · 发网自动贴面 · Esc 取消':'Edit 2D in this view · Project onto net · Esc cancels'):(zh?'依次点选当前图层的两个端点':'Pick two endpoints in the active layer')}</div>
 </div>;
}
