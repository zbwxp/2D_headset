import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {layerProjection} from '../../domain/assembly/projection';
import {refinedControls,refinementProjector,refinementApplied,moveRefinedControl} from '../../domain/assembly/refinement';
import {shapeOf,visible,editable,layerFor,type Point2} from '../../domain/drawing/model';
import {vectorProjection} from '../../domain/assembly/vectorProjection';
import {pathOf} from '../../domain/drawing/appearance';
import {useDrawing} from '../assemblyDrawing/session';
import type {DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
interface Drag extends TrackedPointer {base:AssemblyDocument;id:string;index:0|1|2|3;start:Point2;svg:SVGSVGElement;latest:AssemblyDocument;unit:number}
export default function RefinementOverlay({a,view,preview}:{a:AssemblyDocument;view:DrawingUnderlay;preview:(a:AssemblyDocument|null)=>void}){
 const session=useDrawing(),drag=useRef<Drag|null>(null),[error,setError]=useState('');
 const position=(svg:SVGSVGElement,x:number,y:number):Point2=>{const m=svg.getScreenCTM();if(!m)throw Error('画布不可用');const q=new DOMPoint(x,y).matrixTransform(m.inverse());return [q.x,q.y];};
 const update=(e:PointerEvent|MouseEvent)=>{const g=drag.current;if(!g)return;try{const p=position(g.svg,e.clientX,e.clientY);g.latest=moveRefinedControl(g.base,g.id,g.index,[(p[0]-g.start[0])/g.unit,-(p[1]-g.start[1])/g.unit]);preview(g.latest);setError('');}catch(e){setError((e as Error).message);}};
 const finish=(e?:PointerEvent|MouseEvent,cancel=false)=>{if(!drag.current)return;if(e&&!cancel)update(e);const g=drag.current;drag.current=null;preview(null);const editor=useEditor.getState();if(cancel||editor.project.assembly!==g.base||g.latest===g.base)return;editor.beginEdit();try{editor.setAssembly(g.latest);}finally{editor.endEdit();}};
 usePointerDragTracking({active:()=>drag.current,move:update,finish});
 useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(drag.current&&(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')){e.preventDefault();e.stopImmediatePropagation();finish(undefined,true);}};window.addEventListener('keydown',cancel,true);return()=>{window.removeEventListener('keydown',cancel,true);if(drag.current)preview(null);};},[]);
 useEffect(()=>setError(''),[a.timeline?.stage,session.tool]);
 if(session.tool!=='direct')return null;
 const active=refinementApplied(a),color=active?'#9653be':'#278dac',vector=([x,y]:Point2):Point2=>[x*view.unit,-y*view.unit];
 return <g data-testid="assembly-refinement-overlay" data-editable={active}>
 {session.selection.ids.filter(id=>a.drawing.curves.some(c=>c.id===id)&&visible(a.drawing,id)).map(id=>{
  const layer=layerFor(a.drawing,id)!,p=layerProjection(a,layer.id,view),map=refinementProjector(a,p.mapCanonical,vector),controls=refinedControls(a,id,p.mapCanonical,vector),path=pathOf(vectorProjection(map,.2).shapes([shapeOf(a.drawing,id)]));
  return <g key={id} data-testid="assembly-refinement-curve" data-id={id}>
   <path d={path} stroke={color} strokeWidth="1.2" strokeDasharray="4 3" fill="none" pointerEvents="none"/>
   {[0,1].map(i=><path key={i} d={`M${controls[i?3:0]}L${controls[i?2:1]}`} stroke={color} strokeWidth="1" pointerEvents="none"/>)}
   {controls.map((q,index)=>{const end=index===0||index===3;return <g key={index} data-testid="assembly-refinement-grip" data-id={id} data-index={index} transform={`translate(${q})`} style={{cursor:active&&editable(a.drawing,id)?'grab':'pointer'}} onPointerDown={e=>{
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();session.set({selection:{ids:[id],...(end?{node:a.drawing.curves.find(c=>c.id===id)!.nodes[index===0?0:1]}:{handle:{curveId:id,end:(index===1?0:1) as 0|1}})}});
    if(!active){setError('当前仅查看结构；点击顶部「单线微调」后拖动，原稿不会改变。');return;}
    if(!editable(a.drawing,id)){setError('此曲线已锁定');return;}
    const svg=e.currentTarget.ownerSVGElement!,base=useEditor.getState().project.assembly!;svg.focus();e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={base,latest:base,id,index:index as 0|1|2|3,svg,unit:view.unit,start:position(svg,e.clientX,e.clientY),pointerId:e.pointerId,button:e.button,pointerType:e.pointerType};setError('');
   }}>{end?<rect x="-5" y="-5" width="10" height="10" fill="white" stroke={color} strokeWidth="2"/>:<circle r="4.5" fill="white" stroke={color} strokeWidth="1.6"/>}<title>{active?'当前角度 · 单线微调':'原曲线结构 · 只读'} · {end?'端点':'控制柄'} {index<2?'A':'B'}</title></g>;})}
  </g>;
 })}
 {error&&<text x="15" y="90" fill={color} pointerEvents="none">{error}</text>}
 </g>;
}
