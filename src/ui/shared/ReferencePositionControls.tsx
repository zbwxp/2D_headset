import {useRef,useState} from 'react';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {uiText as t} from '../i18n';
import './referencePositionControls.css';

interface Props {
 document:DrawingDocument;
 current:()=>DrawingDocument|undefined;
 run:(change:()=>DrawingDocument)=>void;
 preview:(drawing:DrawingDocument|null)=>void;
}
function AxisControl({document:d,current,run,preview,axis}:{axis:0|1}&Props){
 const reference=d.reference!,label=`参考图 ${axis?'Y':'X'}`;
 const [text,setText]=useState<string|null>(null);
 const edit=useRef<{base:DrawingDocument;next:DrawingDocument}|null>(null);
 function change(value:number){
  if(reference.locked||!Number.isFinite(value))return;
  if(edit.current&&current()!==edit.current.base){finish(false);return;}
  const base=edit.current?.base??current();if(!base?.reference||base.reference.locked)return;
  const offset=base.reference.offset.map((x,i)=>i===axis?Math.max(-10,Math.min(10,value)):x) as Point2;
  const next={...base,reference:{...base.reference,offset}};
  edit.current={base,next};preview(next);
 }
 function finish(commit=true){
  const session=edit.current;edit.current=null;setText(null);
  if(!session)return;
  preview(null);
  // A new document/pose loaded during the gesture must never be overwritten.
  if(commit&&current()===session.base&&session.next.reference!.offset[axis]!==session.base.reference!.offset[axis])run(()=>session.next);
 }
 return <div className="reference-position-axis" data-ui-keyboard>
  <label>{t(label)}<input aria-label={t(label)} type="number" min={-10} max={10} step="0.001" disabled={reference.locked}
   value={text??+reference.offset[axis].toFixed(5)}
   onChange={e=>{setText(e.target.value);change(e.target.valueAsNumber);}}
   onBlur={e=>finish(Number.isFinite(e.currentTarget.valueAsNumber))} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();finish(e.key==='Enter'&&Number.isFinite(e.currentTarget.valueAsNumber));e.currentTarget.blur();}}}/></label>
  <input type="range" aria-label={t(label)} min={-10} max={10} step="0.001" value={reference.offset[axis]} disabled={reference.locked}
   onPointerDown={e=>{if(e.button===0)e.currentTarget.setPointerCapture(e.pointerId);}}
   onChange={e=>change(e.target.valueAsNumber)} onPointerUp={()=>finish()} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish()}
   onBlur={()=>finish()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();finish(false);}}}
   onKeyUp={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))finish();}}/>
 </div>;
}
/** Preview only the reference; a completed gesture produces one history entry. */
export default function ReferencePositionControls(props:Props){
 if(!props.document.reference)return null;
 return <div className="reference-position-controls">{([0,1] as const).map(axis=><AxisControl key={axis} {...props} axis={axis}/>)}</div>;
}
