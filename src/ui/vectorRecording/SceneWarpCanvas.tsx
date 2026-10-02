import {useEffect,useMemo,useRef,useState} from 'react';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {drawingBounds} from '../../domain/vectorRecording/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {moveWarpNode,type WarpGrid} from '../../domain/vectorWarp/model';
import {useEditor} from '../../app/store';
import {getWorkspaceView} from '../../app/workspaceView';
import {snapWorkspacePoint} from '../../app/workspaceViewSnap';
import {useDrawing} from '../drawing/session';
import PaintScene from '../drawing/PaintScene';
import AIGuideOverlay from '../drawing/AIGuideOverlay';
import {curvePath} from '../drawing/geometry';
import ArtworkReference from '../workspaceView/ArtworkReference';
import ViewGuidesOverlay from '../workspaceView/ViewGuidesOverlay';

type Gesture={kind:'nodes'|'handle'|'box'|'pan';start:Point2;client:Point2;grid?:WarpGrid;indices:number[];index?:number;handle?:'handleU'|'handleV';pan?:Point2};
type Warning={sourceCurveId?:string;cubic:[Point2,Point2,Point2,Point2];warning?:boolean};
const noop=()=>{};
/** The scene owns data and transactions; this component owns only a cancellable
 * pointer preview. Geometry is committed once on release through the scene API. */
export default function SceneWarpCanvas({source,drawing,grid,targetKey,label,paintBatches,warnings=[],onPreview,onCommit,zh,localToggle,aiGuide}:{
 source:DrawingDocument;drawing:DrawingDocument;paintBatches?:PaintBatch[];grid?:WarpGrid;targetKey:string;label:string;warnings?:Warning[];
 onPreview:(grid:WarpGrid|null)=>void;onCommit:(grid:WarpGrid)=>void;zh:boolean;aiGuide?:{curveIds:string[];labels:Record<string,string>};localToggle?:{local:boolean;change:()=>void};
}){
 const txt=(cn:string,en:string)=>zh?cn:en,showFills=useDrawing(s=>s.showFills);
 const [selection,setSelection]=useState<number[]>([]),[selectionMode,setSelectionMode]=useState<'node'|'row'|'column'>('node'),[showGrid,setShowGrid]=useState(true),[showHandles,setShowHandles]=useState(false),[size,setSize]=useState({width:800,height:650}),[pan,setPan]=useState<Point2>([0,0]),[zoom,setZoom]=useState(1),[box,setBox]=useState<{a:Point2;b:Point2}|null>(null),[snap,setSnap]=useState<Point2|null>(null);
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<Gesture|null>(null),space=useRef(false),pending=useRef<WarpGrid|null>(null),nudge=useRef<WarpGrid|null>(null),keys=useRef(new Set<string>());
 const fitBounds=()=>{const a=drawingBounds(source),b=drawingBounds(drawing),points=[a.min,a.max,b.min,b.max,...(grid?.nodes.flatMap(n=>[n.position,n.handleU,n.handleV])??[])];return {min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))] as Point2,max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as Point2};};
 const [bounds,setBounds]=useState(fitBounds);
 useEffect(()=>{setBounds(fitBounds());},[source.curves.length]);
 const center:Point2=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2],unit=Math.max(1,Math.min((size.width-100)/(bounds.max[0]-bounds.min[0]),(size.height-100)/(bounds.max[1]-bounds.min[1])))*zoom;
 const screen=(p:Point2):Point2=>[size.width/2+(p[0]-center[0])*unit+pan[0],size.height/2-(p[1]-center[1])*unit+pan[1]],world=(p:Point2):Point2=>[(p[0]-size.width/2-pan[0])/unit+center[0],-(p[1]-size.height/2-pan[1])/unit+center[1]];
 const at=(e:{clientX:number;clientY:number}):Point2=>{const r=svg.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
 function cancel(){drag.current=null;pending.current=null;nudge.current=null;keys.current.clear();setBox(null);setSnap(null);onPreview(null);}
 useEffect(()=>{setSelection([]);cancel();},[targetKey]);
 useEffect(()=>{const h=host.current;if(!h)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({width:r.width,height:r.height});});observer.observe(h);return()=>observer.disconnect();},[]);
 useEffect(()=>{const fn=()=>cancel();window.addEventListener('contour:cancel-recording-gesture',fn);window.addEventListener('blur',fn);return()=>{window.removeEventListener('contour:cancel-recording-gesture',fn);window.removeEventListener('blur',fn);};},[onPreview]);
 function begin(e:React.PointerEvent,index:number,handle?:'handleU'|'handleV'){
  if(!grid||e.button!==0)return;e.stopPropagation();e.preventDefault();svg.current!.focus({preventScroll:true});svg.current!.setPointerCapture(e.pointerId);
  let indices=[index];if(!handle&&selectionMode==='row'){const row=Math.floor(index/(grid.columns+1));indices=grid.nodes.map((_,i)=>i).filter(i=>Math.floor(i/(grid.columns+1))===row);}else if(!handle&&selectionMode==='column'){const column=index%(grid.columns+1);indices=grid.nodes.map((_,i)=>i).filter(i=>i%(grid.columns+1)===column);}
  if(e.shiftKey)indices=[...new Set([...selection,...indices])];else if(!handle&&selection.includes(index)&&selectionMode==='node')indices=selection;
  setSelection(indices);drag.current={kind:handle?'handle':'nodes',start:world(at(e)),client:at(e),grid,indices,handle,index};
 }
 function move(e:React.PointerEvent){
  const d=drag.current;if(!d)return;const p=at(e);if(d.kind==='pan'){setPan([d.pan![0]+p[0]-d.client[0],d.pan![1]+p[1]-d.client[1]]);return;}if(d.kind==='box'){setBox({a:d.client,b:p});return;}if(!d.grid)return;
  const base=d.grid,q=world(p);let delta:Point2=[q[0]-d.start[0],q[1]-d.start[1]];
  const anchor=d.index===undefined?null:d.kind==='handle'?base.nodes[d.index][d.handle!]:base.nodes[d.index].position,hit=anchor&&!e.altKey?snapWorkspacePoint(drawing,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),[anchor[0]+delta[0],anchor[1]+delta[1]],1/unit):null;
  if(hit&&anchor)delta=[hit.point[0]-anchor[0],hit.point[1]-anchor[1]];setSnap(hit?.point??null);let next=base;
  if(d.kind==='handle')next={...base,nodes:base.nodes.map((n,i)=>i===d.index?{...n,[d.handle!]:[n[d.handle!][0]+delta[0],n[d.handle!][1]+delta[1]]}:n)};
  else for(const i of d.indices)next=moveWarpNode(next,i,[base.nodes[i].position[0]+delta[0],base.nodes[i].position[1]+delta[1]]);
  pending.current=next;onPreview(next);
 }
 function finish(e:React.PointerEvent){
  const d=drag.current;if(!d)return;drag.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
  if(d.kind==='box'&&box&&grid){const lo=[Math.min(box.a[0],box.b[0]),Math.min(box.a[1],box.b[1])],hi=[Math.max(box.a[0],box.b[0]),Math.max(box.a[1],box.b[1])],ids=grid.nodes.map((n,i)=>({i,p:screen(n.position)})).filter(({p})=>p[0]>=lo[0]&&p[0]<=hi[0]&&p[1]>=lo[1]&&p[1]<=hi[1]).map(x=>x.i);setSelection(e.shiftKey?[...new Set([...selection,...ids])]:ids);}
  const next=pending.current;pending.current=null;setBox(null);setSnap(null);onPreview(null);if(next)onCommit(next);
 }
 useEffect(()=>{
  function down(e:KeyboardEvent){if((e.target as HTMLElement).closest('input,select,textarea,dialog,[role=dialog],[contenteditable],[data-ui-keyboard]'))return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')cancel();if(e.code==='Space'){e.preventDefault();space.current=true;}if(e.key==='Escape'){e.preventDefault();cancel();}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&grid){e.preventDefault();setSelection(grid.nodes.map((_,i)=>i));}
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&grid&&selection.length&&!drag.current){e.preventDefault();keys.current.add(e.key);const base=nudge.current??grid,step=(e.shiftKey?10:1)/unit,delta:Point2=[e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowDown'?-step:e.key==='ArrowUp'?step:0];let next=base;for(const i of selection)next=moveWarpNode(next,i,[base.nodes[i].position[0]+delta[0],base.nodes[i].position[1]+delta[1]]);nudge.current=next;onPreview(next);}
  }
  function up(e:KeyboardEvent){if(e.code==='Space')space.current=false;if(keys.current.delete(e.key)&&!keys.current.size&&nudge.current){const next=nudge.current;nudge.current=null;onPreview(null);onCommit(next);}}
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};
 },[grid,selection,unit,onPreview,onCommit]);
 return <section className="vr-center">
  <header className="vr-canvas-toolbar">{localToggle&&<button aria-pressed={localToggle.local} onClick={()=>{cancel();localToggle.change();}}>{localToggle.local?txt('子 Warp 局部编辑 · 父变形暂不显示','Child local edit · parent excluded'):txt('全局预览','Global preview')}</button>}<div className="vr-segmented">{(['node','row','column'] as const).map(mode=><button key={mode} aria-pressed={selectionMode===mode} onClick={()=>setSelectionMode(mode)}>{mode==='node'?txt('节点','Nodes'):mode==='row'?txt('整行','Row'):txt('整列','Column')}</button>)}</div><button disabled={!grid} onClick={()=>grid&&setSelection(grid.nodes.map((_,i)=>i))}>{txt('全选网格','All nodes')}</button><button aria-pressed={showGrid} onClick={()=>setShowGrid(!showGrid)}>{txt('网格','Grid')}</button><button data-testid="vr-show-fills" aria-pressed={showFills} onClick={()=>useDrawing.getState().set({showFills:!showFills})}>{txt('填充','Fills')}</button><button aria-pressed={showHandles} onClick={()=>setShowHandles(!showHandles)}>{txt('Bézier 柄','Bézier handles')}</button><span>{selection.length} {txt('节点','nodes')}</span><button onClick={()=>{setBounds(fitBounds());setZoom(1);setPan([0,0]);}}>{txt('适应','Fit')}</button></header>
  <div ref={host} className="vr-canvas-host"><svg ref={svg} width={size.width} height={size.height} data-testid="vr-scene-canvas" aria-label={txt('录制场景 Warp 画布','Recording scene Warp canvas')} tabIndex={0} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current)cancel();}} onPointerDown={e=>{if(e.button!==0&&e.button!==1)return;svg.current!.focus();e.preventDefault();svg.current!.setPointerCapture(e.pointerId);const p=at(e);if(space.current||e.button===1)drag.current={kind:'pan',start:world(p),client:p,indices:[],pan};else{drag.current={kind:'box',start:world(p),client:p,indices:[]};setBox({a:p,b:p});}}} onWheel={e=>setZoom(z=>Math.max(.15,Math.min(6,z*Math.exp(-e.deltaY*.001))))}>
   <rect width="100%" height="100%" fill="#f6f7f5"/><ArtworkReference screen={screen} unit={unit}/>
   <g pointerEvents="none"><PaintScene paintBatches={paintBatches} d={drawing} screen={screen} unit={unit} pixelsPerUnit={unit} preview showFills={showFills} referenceMoving={false} tool="select" curveDown={noop} paintDown={noop} arcDown={noop}/></g>
   <g pointerEvents="none">{warnings.filter(d=>d.warning).map((d,i)=><path key={d.sourceCurveId??i} data-testid="vr-fit-warning" d={curvePath(d.cubic,screen)} fill="none" stroke="#db3948" strokeWidth="2.5"/>)}</g>
   {showGrid&&grid&&<g className="vr-grid" data-testid="vr-grid">
    {Array.from({length:grid.rows+1},(_,row)=>{const points=Array.from({length:grid.columns+1},(_,col)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=screen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${screen(before.handleU)} ${screen([2*n.position[0]-n.handleU[0],2*n.position[1]-n.handleU[1]])} ${p}`;}});return <path key={`r${row}`} d={path}/>;})}
    {Array.from({length:grid.columns+1},(_,col)=>{const points=Array.from({length:grid.rows+1},(_,row)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=screen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${screen(before.handleV)} ${screen([2*n.position[0]-n.handleV[0],2*n.position[1]-n.handleV[1]])} ${p}`;}});return <path key={`c${col}`} d={path}/>;})}
    {grid.nodes.map((n,i)=>{const p=screen(n.position),selected=selection.includes(i);return <g key={i}>{showHandles&&selected&&(['handleU','handleV'] as const).map(h=>{const a=screen(n[h]);return <g key={h}><line x1={p[0]} y1={p[1]} x2={a[0]} y2={a[1]}/><circle className="vr-handle" data-node={i} data-handle={h} cx={a[0]} cy={a[1]} r="4" onPointerDown={e=>begin(e,i,h)}/></g>})}<circle data-testid="vr-node" data-index={i} data-selected={selected} className={selected?'selected':''} cx={p[0]} cy={p[1]} r={selected?5:4} onPointerDown={e=>begin(e,i)}/></g>;})}
   </g>}
   {aiGuide&&<AIGuideOverlay d={drawing} curveIds={aiGuide.curveIds} curveLabels={aiGuide.labels} screen={screen} unit={unit} width={size.width} height={size.height}/>}
   {box&&<rect x={Math.min(box.a[0],box.b[0])} y={Math.min(box.a[1],box.b[1])} width={Math.abs(box.b[0]-box.a[0])} height={Math.abs(box.b[1]-box.a[1])} fill="#31a1e021" stroke="#338bc4" strokeDasharray="4 2" pointerEvents="none"/>}
   {snap&&<circle cx={screen(snap)[0]} cy={screen(snap)[1]} r="8" fill="none" stroke="#148b96" strokeWidth="2" pointerEvents="none"/>}<ViewGuidesOverlay screen={screen} unit={unit} width={size.width} height={size.height}/>
  </svg><div className="vr-canvas-badge">{label}</div></div>
  <footer className="vr-status"><span>{txt('源画稿只读','Source read-only')} · {source.curves.length} {txt('源段','source segments')}</span><span>{txt('Shift 多选 · 空格平移 · Esc 取消','Shift multi-select · Space pan · Esc cancel')}</span><span>{Math.round(zoom*100)}%</span></footer>
 </section>;
}
