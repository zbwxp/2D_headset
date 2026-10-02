import {useEffect,useMemo,useRef,useState} from 'react';
import {editable,groupFor,objectById,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {selectionUnit,selectedGroup} from '../../domain/drawing/groups';
import {drawingBounds} from '../../domain/vectorRecording/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {moveWarpNode,type WarpGrid} from '../../domain/vectorWarp/model';
import {useEditor} from '../../app/store';
import {getWorkspaceView} from '../../app/workspaceView';
import {snapWorkspacePoint} from '../../app/workspaceViewSnap';
import {useDrawing,type DrawingSelection} from '../drawing/session';
import {TOOLS} from '../drawing/tools';
import PaintScene from '../drawing/PaintScene';
import AIGuideOverlay from '../drawing/AIGuideOverlay';
import {curvePath} from '../drawing/geometry';
import ArtworkReference from '../workspaceView/ArtworkReference';
import ViewGuidesOverlay from '../workspaceView/ViewGuidesOverlay';

type Tool='select'|'direct'|'hand'|'zoom';
type Gesture={kind:'nodes'|'handle'|'box'|'pan'|'zoom';pointerId:number;start:Point2;client:Point2;grid?:WarpGrid;indices:number[];index?:number;handle?:'handleU'|'handleV';pan?:Point2;zoom?:number;zoomMoved?:boolean};
type Warning={sourceCurveId?:string;cubic:[Point2,Point2,Point2,Point2];warning?:boolean};
/** Keep compiled IDs intact: the scene, not the canvas, resolves provenance. */
export function recordingCurveSelection(drawing:DrawingDocument,current:DrawingSelection,id:string,tool:'select'|'direct',shift=false):DrawingSelection|null{
 if(!editable(drawing,id))return null;const selected=current.ids.filter(id=>editable(drawing,id));let ids=(tool==='select'?selectionUnit(drawing,id):[id]).filter(id=>editable(drawing,id));
 if(shift)ids=ids.every(id=>selected.includes(id))?selected.filter(id=>!ids.includes(id)):[...new Set([...selected,...ids])];
 return {ids,group:tool==='select'?selectedGroup(drawing,ids)?.id:undefined};
}
/** The world point beneath the pointer is stable for wheel, click and drag zoom. */
export function recordingZoomAt(point:Point2,anchor:Point2,view:{center:Point2;size:{width:number;height:number};unit:number;zoom:number},value:number):{zoom:number;pan:Point2}{
 const zoom=Math.max(.1,Math.min(12,value)),unit=view.unit*zoom/view.zoom;return {zoom,pan:[point[0]-view.size.width/2-(anchor[0]-view.center[0])*unit,point[1]-view.size.height/2+(anchor[1]-view.center[1])*unit]};
}
/** The scene owns data and transactions; this component owns only a cancellable
 * pointer preview. Geometry is committed once on release through the scene API. */
export default function SceneWarpCanvas({source,drawing,grid,targetKey,label,paintBatches,warnings=[],onPreview,onCommit,zh,localToggle,aiGuide,selection,onSelection,editEnabled=true}:{
 source:DrawingDocument;drawing:DrawingDocument;paintBatches?:PaintBatch[];grid?:WarpGrid;targetKey:string;label:string;warnings?:Warning[];
 onPreview:(grid:WarpGrid|null)=>void;onCommit:(grid:WarpGrid)=>void;zh:boolean;aiGuide?:{curveIds:string[];labels:Record<string,string>};localToggle?:{local:boolean;change:()=>void};
 selection?:DrawingSelection;onSelection?:(selection:DrawingSelection)=>void;editEnabled?:boolean;
}){
 const txt=(cn:string,en:string)=>zh?cn:en,showFills=useDrawing(s=>s.showFills),fillVisibility=useDrawing(s=>s.fillVisibility);
 const [ownSelection,setOwnSelection]=useState<DrawingSelection>({ids:[]}),[tool,setTool]=useState<Tool>('select'),[nodeSelection,setNodeSelection]=useState<number[]>([]),[selectionMode,setSelectionMode]=useState<'node'|'row'|'column'>('node'),[showGrid,setShowGrid]=useState(true),[showHandles,setShowHandles]=useState(false),[size,setSize]=useState({width:800,height:650}),[pan,setPan]=useState<Point2>([0,0]),[zoom,setZoom]=useState(1),[box,setBox]=useState<{a:Point2;b:Point2}|null>(null),[snap,setSnap]=useState<Point2|null>(null);
 const drawingSelection=selection??ownSelection,selectedCurves=useMemo(()=>drawingSelection.ids.filter(id=>editable(drawing,id)),[drawing,drawingSelection]);
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<Gesture|null>(null),space=useRef(false),pending=useRef<WarpGrid|null>(null),nudge=useRef<WarpGrid|null>(null),keys=useRef(new Set<string>());
 const fitBounds=()=>{const a=drawingBounds(source),b=drawingBounds(drawing),points=[a.min,a.max,b.min,b.max,...(grid?.nodes.flatMap(n=>[n.position,n.handleU,n.handleV])??[])];return {min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))] as Point2,max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as Point2};};
 const [bounds,setBounds]=useState(fitBounds);
 useEffect(()=>{setBounds(fitBounds());},[source.curves.length]);
 const center:Point2=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2],unit=Math.max(1,Math.min((size.width-100)/(bounds.max[0]-bounds.min[0]),(size.height-100)/(bounds.max[1]-bounds.min[1])))*zoom;
 const screen=(p:Point2):Point2=>[size.width/2+(p[0]-center[0])*unit+pan[0],size.height/2-(p[1]-center[1])*unit+pan[1]],world=(p:Point2):Point2=>[(p[0]-size.width/2-pan[0])/unit+center[0],-(p[1]-size.height/2-pan[1])/unit+center[1]];
 const at=(e:{clientX:number;clientY:number}):Point2=>{const r=svg.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
 function release(pointerId:number){if(svg.current?.hasPointerCapture(pointerId))svg.current.releasePointerCapture(pointerId);}
 function cancel(){const d=drag.current;drag.current=null;if(d){release(d.pointerId);if(d.kind==='zoom'){setZoom(d.zoom!);setPan(d.pan!);}else if(d.kind==='pan')setPan(d.pan!);}pending.current=null;nudge.current=null;keys.current.clear();setBox(null);setSnap(null);onPreview(null);}
 function choose(next:DrawingSelection){setOwnSelection(next);onSelection?.(next);}
 function chooseTool(next:Tool){cancel();setTool(next);}
 function zoomAt(p:Point2,value:number,anchor=world(p)){const next=recordingZoomAt(p,anchor,{center,size,unit,zoom},value);setZoom(next.zoom);setPan(next.pan);}
 useEffect(()=>{setNodeSelection([]);cancel();},[targetKey]);
 useEffect(()=>{if(!editEnabled)cancel();},[editEnabled]);
 useEffect(()=>{const h=host.current;if(!h)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({width:r.width,height:r.height});});observer.observe(h);return()=>observer.disconnect();},[]);
 useEffect(()=>{const fn=()=>{space.current=false;cancel();};window.addEventListener('contour:cancel-recording-gesture',fn);window.addEventListener('blur',fn);return()=>{window.removeEventListener('contour:cancel-recording-gesture',fn);window.removeEventListener('blur',fn);};},[onPreview]);
 function curveDown(e:React.PointerEvent,id:string){
  if(space.current||e.button!==0||tool==='hand'||tool==='zoom')return;e.stopPropagation();e.preventDefault();svg.current?.focus({preventScroll:true});const next=recordingCurveSelection(drawing,drawingSelection,id,tool,e.shiftKey);if(!next)return;
  choose(next);setNodeSelection([]);
 }
 function paintDown(e:React.PointerEvent,id:string){
  if(space.current||e.button!==0||tool==='hand'||tool==='zoom')return;e.stopPropagation();e.preventDefault();svg.current?.focus({preventScroll:true});const item=objectById(drawing,id);if(!item?.visible||item.locked)return;
  const group=tool==='select'?groupFor(drawing,id):undefined;if(group){const first=group.curveIds.find(id=>editable(drawing,id));if(first){curveDown(e,first);return;}}
  const current=[...new Set([...(drawingSelection.paintIds??[]),...(drawingSelection.paint?[drawingSelection.paint]:[])])].filter(id=>{const o=objectById(drawing,id);return o?.visible&&!o.locked;}),paintIds=e.shiftKey?(current.includes(id)?current.filter(x=>x!==id):[...current,id]):[id];
  choose({ids:e.shiftKey?selectedCurves:[],paintIds,paint:paintIds.length===1?paintIds[0]:undefined});setNodeSelection([]);
 }
 function arcDown(e:React.PointerEvent,id:string){const join=drawing.joins.find(j=>j.id===id);if(join)curveDown(e,join.a.curveId);}
 function begin(e:React.PointerEvent,index:number,handle?:'handleU'|'handleV'){
  if(!grid||drag.current||space.current||tool==='hand'||tool==='zoom'||e.button!==0)return;e.stopPropagation();e.preventDefault();svg.current!.focus({preventScroll:true});
  let indices=[index];if(!handle&&selectionMode==='row'){const row=Math.floor(index/(grid.columns+1));indices=grid.nodes.map((_,i)=>i).filter(i=>Math.floor(i/(grid.columns+1))===row);}else if(!handle&&selectionMode==='column'){const column=index%(grid.columns+1);indices=grid.nodes.map((_,i)=>i).filter(i=>i%(grid.columns+1)===column);}
  if(e.shiftKey)indices=[...new Set([...nodeSelection,...indices])];else if(!handle&&nodeSelection.includes(index)&&selectionMode==='node')indices=nodeSelection;
  setNodeSelection(indices);if(!editEnabled)return;svg.current!.setPointerCapture(e.pointerId);drag.current={kind:handle?'handle':'nodes',pointerId:e.pointerId,start:world(at(e)),client:at(e),grid,indices,handle,index};
 }
 function move(e:React.PointerEvent){
  const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;const p=at(e);if(d.kind==='pan'){setPan([d.pan![0]+p[0]-d.client[0],d.pan![1]+p[1]-d.client[1]]);return;}if(d.kind==='zoom'){const dy=d.client[1]-p[1];if(!d.zoomMoved&&Math.abs(dy)<2)return;d.zoomMoved=true;zoomAt(d.client,d.zoom!*Math.exp(dy*.008),d.start);return;}if(d.kind==='box'){setBox({a:d.client,b:p});return;}if(!d.grid||!editEnabled)return;
  const base=d.grid,q=world(p);let delta:Point2=[q[0]-d.start[0],q[1]-d.start[1]];
  const anchor=d.index===undefined?null:d.kind==='handle'?base.nodes[d.index][d.handle!]:base.nodes[d.index].position,hit=anchor&&!e.altKey?snapWorkspacePoint(drawing,useEditor.getState().project.drawingSnapshots,getWorkspaceView(),[anchor[0]+delta[0],anchor[1]+delta[1]],1/unit):null;
  if(hit&&anchor)delta=[hit.point[0]-anchor[0],hit.point[1]-anchor[1]];setSnap(hit?.point??null);let next=base;
  if(d.kind==='handle')next={...base,nodes:base.nodes.map((n,i)=>i===d.index?{...n,[d.handle!]:[n[d.handle!][0]+delta[0],n[d.handle!][1]+delta[1]]}:n)};
  else for(const i of d.indices)next=moveWarpNode(next,i,[base.nodes[i].position[0]+delta[0],base.nodes[i].position[1]+delta[1]]);
  pending.current=next;onPreview(next);
 }
 function finish(e:React.PointerEvent){
  const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;drag.current=null;release(e.pointerId);
  if(d.kind==='zoom'&&!d.zoomMoved)zoomAt(d.client,d.zoom!*((e.ctrlKey||e.altKey)?1/1.3:1.3),d.start);
  if(d.kind==='box'){const p=at(e),lo=[Math.min(d.client[0],p[0]),Math.min(d.client[1],p[1])],hi=[Math.max(d.client[0],p[0]),Math.max(d.client[1],p[1])],inside=(p:Point2)=>p[0]>=lo[0]&&p[0]<=hi[0]&&p[1]>=lo[1]&&p[1]<=hi[1];
   if(showGrid&&grid){const ids=grid.nodes.map((n,i)=>({i,p:screen(n.position)})).filter(({p})=>inside(p)).map(x=>x.i);setNodeSelection(e.shiftKey?[...new Set([...nodeSelection,...ids])]:ids);}
   else{const hits=drawing.curves.filter(c=>editable(drawing,c.id)&&shapeOf(drawing,c.id).every(p=>inside(screen(p)))).flatMap(c=>tool==='select'?selectionUnit(drawing,c.id):[c.id]),ids=[...new Set([...(e.shiftKey?selectedCurves:[]),...hits])].filter(id=>editable(drawing,id));choose({ids,group:tool==='select'?selectedGroup(drawing,ids)?.id:undefined});}
  }
  const next=pending.current;pending.current=null;setBox(null);setSnap(null);onPreview(null);if(next&&editEnabled)onCommit(next);
 }
 function down(e:React.PointerEvent){
  if(drag.current||![0,1,2].includes(e.button))return;svg.current!.focus({preventScroll:true});e.preventDefault();svg.current!.setPointerCapture(e.pointerId);const p=at(e),base={pointerId:e.pointerId,start:world(p),client:p,indices:[]};
  if(tool==='zoom'&&!space.current&&(e.button===0||e.button===2&&e.ctrlKey))drag.current={...base,kind:'zoom',zoom,pan};
  else if(space.current||e.button===1||e.button===2||tool==='hand')drag.current={...base,kind:'pan',pan};
  else{drag.current={...base,kind:'box'};setBox({a:p,b:p});if(!e.shiftKey)choose({ids:[]});}
 }
 useEffect(()=>{
  function down(e:KeyboardEvent){const target=e.target instanceof Element?e.target:null;if(e.defaultPrevented||e.isComposing||target?.closest('input,select,textarea,dialog,[role=dialog],[role=menu],[role=menuitem],[contenteditable],[data-ui-keyboard]'))return;
   if(target?.closest('button,a,summary,[role=button],[role=slider]')&&(e.code==='Space'||e.key==='Enter'||e.key.startsWith('Arrow')))return;
   if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){cancel();return;}
   if(e.key==='Escape'){e.preventDefault();cancel();return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();if(target?.closest('.drawing-layers'))choose({ids:drawing.curves.map(c=>c.id),paintIds:[...drawing.fills,...drawing.offsets].map(o=>o.id)});else if(showGrid&&grid)setNodeSelection(grid.nodes.map((_,i)=>i));else choose({ids:drawing.curves.filter(c=>editable(drawing,c.id)).map(c=>c.id)});return;}
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.code==='Space'){e.preventDefault();space.current=true;return;}
   const toolMap:Record<string,Tool>={v:'select',a:'direct',h:'hand',z:'zoom'};if(toolMap[e.key.toLowerCase()]){e.preventDefault();chooseTool(toolMap[e.key.toLowerCase()]);return;}
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&editEnabled&&grid&&nodeSelection.length&&!drag.current){e.preventDefault();keys.current.add(e.key);const base=nudge.current??grid,step=(e.shiftKey?10:1)/unit,delta:Point2=[e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowDown'?-step:e.key==='ArrowUp'?step:0];let next=base;for(const i of nodeSelection)next=moveWarpNode(next,i,[base.nodes[i].position[0]+delta[0],base.nodes[i].position[1]+delta[1]]);nudge.current=next;onPreview(next);}
  }
  function up(e:KeyboardEvent){if(e.code==='Space')space.current=false;if(keys.current.delete(e.key)&&!keys.current.size&&nudge.current){const next=nudge.current;nudge.current=null;onPreview(null);if(editEnabled)onCommit(next);}}
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};
 },[grid,nodeSelection,unit,onPreview,onCommit,editEnabled,tool,showGrid,drawing,drawingSelection,zoom,pan]);
 return <section className="vr-center">
  <header className="vr-canvas-toolbar"><nav className="vr-segmented" aria-label={txt('录制画布工具','Recording canvas tools')}>{TOOLS.map(([value,cn,key,,Icon])=>{if(value!=='select'&&value!=='direct'&&value!=='hand'&&value!=='zoom')return null;const name=txt(cn,value==='select'?'Select stroke':value==='direct'?'Direct selection':value==='hand'?'Hand':'Zoom');return <button key={value} data-testid={`vr-tool-${value}`} aria-label={name} title={`${name} (${key})`} aria-pressed={tool===value} className={tool===value?'active':''} onClick={()=>chooseTool(value)}><Icon size={16}/><kbd>{key}</kbd></button>;})}</nav>{localToggle&&<button aria-pressed={localToggle.local} onClick={()=>{cancel();localToggle.change();}}>{localToggle.local?txt('子 Warp 局部编辑 · 父变形暂不显示','Child local edit · parent excluded'):txt('全局预览','Global preview')}</button>}<div className="vr-segmented">{(['node','row','column'] as const).map(mode=><button key={mode} aria-pressed={selectionMode===mode} onClick={()=>setSelectionMode(mode)}>{mode==='node'?txt('节点','Nodes'):mode==='row'?txt('整行','Row'):txt('整列','Column')}</button>)}</div><button disabled={!grid} onClick={()=>grid&&setNodeSelection(grid.nodes.map((_,i)=>i))}>{txt('全选网格','All nodes')}</button><button aria-pressed={showGrid} onClick={()=>{cancel();setShowGrid(!showGrid);}}>{txt('网格','Grid')}</button><button data-testid="vr-show-fills" aria-pressed={showFills} onClick={()=>useDrawing.getState().set({showFills:!showFills,fillVisibility:{}})}>{txt('填充','Fills')}</button><button aria-pressed={showHandles} onClick={()=>setShowHandles(!showHandles)}>{txt('Warp Bézier 柄','Warp Bézier handles')}</button><span>{nodeSelection.length} {txt('节点','nodes')}</span><button onClick={()=>{cancel();setBounds(fitBounds());setZoom(1);setPan([0,0]);}}>{txt('适应','Fit')}</button></header>
  <div ref={host} className={`vr-canvas-host drawing-canvas-wrap tool-${tool}`}><svg ref={svg} width={size.width} height={size.height} data-testid="vr-scene-canvas" data-tool={tool} data-edit-enabled={editEnabled} aria-label={txt('录制场景 Warp 画布','Recording scene Warp canvas')} tabIndex={0} onContextMenu={e=>e.preventDefault()} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current)cancel();}} onPointerDown={down} onWheel={e=>{if(!drag.current)zoomAt(at(e),zoom*Math.exp(-e.deltaY*.001));}}>
   <rect width="100%" height="100%" fill="#f6f7f5"/><ArtworkReference screen={screen} unit={unit}/>
   <PaintScene paintBatches={paintBatches} d={drawing} screen={screen} unit={unit} pixelsPerUnit={unit} preview={false} showFills={showFills} fillVisibility={fillVisibility} referenceMoving={false} tool={tool} selectedPaint={drawingSelection.paint} selectedPaints={drawingSelection.paintIds} curveDown={curveDown} paintDown={paintDown} arcDown={arcDown}/>
   <g pointerEvents="none">{selectedCurves.map(id=><path key={id} data-testid="vr-selected-curve" data-id={id} d={curvePath(shapeOf(drawing,id),screen)} fill="none" stroke="#2589b0" strokeWidth="1.5"/>)}</g>
   <g pointerEvents="none">{warnings.filter(d=>d.warning).map((d,i)=><path key={d.sourceCurveId??i} data-testid="vr-fit-warning" d={curvePath(d.cubic,screen)} fill="none" stroke="#db3948" strokeWidth="2.5"/>)}</g>
   {showGrid&&grid&&<g className="vr-grid" data-testid="vr-grid">
    {Array.from({length:grid.rows+1},(_,row)=>{const points=Array.from({length:grid.columns+1},(_,col)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=screen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${screen(before.handleU)} ${screen([2*n.position[0]-n.handleU[0],2*n.position[1]-n.handleU[1]])} ${p}`;}});return <path key={`r${row}`} d={path}/>;})}
    {Array.from({length:grid.columns+1},(_,col)=>{const points=Array.from({length:grid.rows+1},(_,row)=>grid.nodes[row*(grid.columns+1)+col]);let path='';points.forEach((n,i)=>{const p=screen(n.position);if(!i)path=`M ${p}`;else{const before=points[i-1];path+=` C ${screen(before.handleV)} ${screen([2*n.position[0]-n.handleV[0],2*n.position[1]-n.handleV[1]])} ${p}`;}});return <path key={`c${col}`} d={path}/>;})}
    {grid.nodes.map((n,i)=>{const p=screen(n.position),selected=nodeSelection.includes(i);return <g key={i}>{showHandles&&selected&&(['handleU','handleV'] as const).map(h=>{const a=screen(n[h]);return <g key={h}><line x1={p[0]} y1={p[1]} x2={a[0]} y2={a[1]}/><circle className="vr-handle" data-node={i} data-handle={h} cx={a[0]} cy={a[1]} r="4" onPointerDown={e=>begin(e,i,h)}/></g>})}<circle data-testid="vr-node" data-index={i} data-selected={selected} className={selected?'selected':''} cx={p[0]} cy={p[1]} r={selected?5:4} onPointerDown={e=>begin(e,i)}/></g>;})}
   </g>}
   {aiGuide&&<AIGuideOverlay d={drawing} curveIds={aiGuide.curveIds} curveLabels={aiGuide.labels} screen={screen} unit={unit} width={size.width} height={size.height}/>}
   {box&&<rect x={Math.min(box.a[0],box.b[0])} y={Math.min(box.a[1],box.b[1])} width={Math.abs(box.b[0]-box.a[0])} height={Math.abs(box.b[1]-box.a[1])} fill="#31a1e021" stroke="#338bc4" strokeDasharray="4 2" pointerEvents="none"/>}
   {snap&&<circle cx={screen(snap)[0]} cy={screen(snap)[1]} r="8" fill="none" stroke="#148b96" strokeWidth="2" pointerEvents="none"/>}<ViewGuidesOverlay screen={screen} unit={unit} width={size.width} height={size.height}/>
  </svg><div className="vr-canvas-badge">{label}</div></div>
  <footer className="vr-status"><span>{txt('源画稿只读','Source read-only')} · {source.curves.length} {txt('源段','source segments')}</span><span>{txt('V 整笔 · A 单段 · Z 缩放 · 空格平移 · Esc 取消','V stroke · A segment · Z zoom · Space pan · Esc cancel')}</span><span>{Math.round(zoom*100)}%</span></footer>
 </section>;
}
