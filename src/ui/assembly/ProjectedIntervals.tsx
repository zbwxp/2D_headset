import {refinementProjector} from '../../domain/assembly/refinement';
import {selectionUnit} from '../../domain/drawing/groups';
import {point} from '../../domain/drawing/sampling';
import type {Cubic} from '../../domain/drawing/model';
import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {vectorProjection} from '../../domain/assembly/vectorProjection';
import {layerProjection} from '../../domain/assembly/projection';
import {displayField,displayPath,changeDisplayInterval,nearestDisplayPosition} from '../../domain/drawing/displayIntervals';
import {visible,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import DisplayIntervalOverlay from '../assemblyDrawing/DisplayIntervalOverlay';
import {useDrawing} from '../assemblyDrawing/session';
import {updateAssemblyDrawing} from '../assemblyDrawing/workspace';
import type {DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import {usePointerDragTracking,type TrackedPointer} from '../shared/usePointerDragTracking';
interface Drag extends TrackedPointer {a:AssemblyDocument;base:DrawingDocument;latest:DrawingDocument;track:string;range:string;end:0|1;previous:number;project:(p:Point2,s?:Cubic,t?:number)=>Point2;svg:SVGSVGElement}
export default function ProjectedIntervals({a,drawing,view,applyIntervals,preview}:{a:AssemblyDocument;drawing:DrawingDocument;view:DrawingUnderlay;applyIntervals:boolean;preview:(d:DrawingDocument|null)=>void}){
 const session=useDrawing(),drag=useRef<Drag|null>(null),[draft,setDraft]=useState<DrawingDocument|null>(null),[error,setError]=useState('');
 const d=draft??drawing,update=(event:PointerEvent|MouseEvent)=>{
  const g=drag.current;if(!g)return;
  try{
   const m=g.svg.getScreenCTM();if(!m)return;const q=new DOMPoint(event.clientX,event.clientY).matrixTransform(m.inverse()),p:Point2=[q.x,q.y];
   const local=p,track=g.base.displayIntervals!.find(t=>t.id===g.track)!;
   const value=nearestDisplayPosition(displayField(g.base,displayPath(g.base,track.anchor.id)),track,local,g.previous,g.project);g.previous=value;
   g.latest=changeDisplayInterval(g.base,g.track,g.range,{[g.end?'end':'start']:value});setDraft(g.latest);preview(g.latest);
  }catch(e){setError((e as Error).message);}
 };
 const finish=(e?:PointerEvent|MouseEvent,cancel=false)=>{
  if(!drag.current)return;if(e&&!cancel)update(e);const g=drag.current;drag.current=null;setDraft(null);preview(null);
  if(cancel||useEditor.getState().project.assembly!==g.a)return;
  const editor=useEditor.getState();try{const next=updateAssemblyDrawing(g.a,g.latest);editor.beginEdit();editor.setAssembly(next);editor.endEdit();}catch(e){editor.endEdit();setError((e as Error).message);}
 };
 usePointerDragTracking({active:()=>drag.current,move:update,finish});
 useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(drag.current&&(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')){e.preventDefault();e.stopImmediatePropagation();finish(undefined,true);}};window.addEventListener('keydown',cancel,true);return()=>{window.removeEventListener('keydown',cancel,true);if(drag.current)preview(null);};},[]);
 return <g data-testid="assembly-projected-intervals">
  {d.layers.map(layer=>{
   const {mapDrawing}=layerProjection(a,layer.id,view),project=refinementProjector(a,mapDrawing,([x,y])=>[x*view.unit,-y*view.unit]);
   const ids=session.selection.ids.filter(id=>layer.items.includes(id)&&d.curves.some(c=>c.id===id));
   return <g key={layer.id}>
    {layer.items.filter(id=>d.curves.some(c=>c.id===id)&&visible(d,id)).map(id=>{
     const shape=shapeOf(d,id),points=Array.from({length:41},(_,i)=>project(point(shape,i/40),shape,i/40));
     return <path key={id} data-testid="assembly-projected-curve-hit" data-id={id} d={points.map((p,i)=>(i?'L':'M')+p).join('')} stroke="transparent" strokeWidth="10" fill="none" pointerEvents={!['select','direct'].includes(session.tool)?'none':'stroke'} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();let ids=session.tool==='select'?selectionUnit(d,id):[id];if(e.shiftKey||e.ctrlKey||e.metaKey)ids=ids.every(id=>session.selection.ids.includes(id))?session.selection.ids.filter(id=>!ids.includes(id)):[...new Set([...session.selection.ids,...ids])];session.set({layerId:layer.id,selection:{ids}});}}/>;
    })}
    {session.tool==='select'&&ids.filter(id=>visible(d,id)).map(id=>{const s=shapeOf(d,id);return <path key={id} data-testid="assembly-projected-selection" d={Array.from({length:41},(_,i)=>(i?'L':'M')+project(point(s,i/40),s,i/40)).join('')} stroke="#278dac" strokeWidth="1" fill="none" pointerEvents="none"/>;})}
    {applyIntervals&&session.tool==='select'&&ids.length>0&&<DisplayIntervalOverlay d={d} selection={{...session.selection,ids}} screen={project} projectPoint={project} projectShapes={vectorProjection(project,.2).shapes} pick={(e,track,range,end)=>{
     if(e.button!==0)return;e.preventDefault();e.stopPropagation();
     try{const svg=(e.currentTarget as SVGElement).ownerSVGElement!;svg.focus();e.currentTarget.setPointerCapture(e.pointerId);const tr=d.displayIntervals!.find(t=>t.id===track)!,r=tr.ranges.find(r=>r.id===range)!;
      session.set({selection:{ids:[tr.anchor.id],displayInterval:{track,range,end}}});drag.current={a,base:d,latest:d,track,range,end,previous:end?r.end:r.start,project,svg,pointerId:e.pointerId,pointerType:e.pointerType,button:e.button};setError('');
     }catch(e){setError((e as Error).message);}
    }}/>}
   </g>;
  })}
  {error&&<text x="15" y="70" fill="#ba622a" pointerEvents="none">{error}</text>}
 </g>;
}
