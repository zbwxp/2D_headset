import {useCallback,useEffect,useRef} from 'react';
import {SLIDER,formatNumeric,modifierScale,holdMultiplier,trackValue,snapTowardTargets} from './numericSliderMath';
export interface NumericSliderProps {
 label:string; value:number; min:number; max:number;
 onChange:(value:number)=>void; onEditStart?:()=>void; onEditEnd?:()=>void;
 snapTargets?:number[]; step?:number; fineScale?:number; coarseScale?:number;
 formatValue?:(value:number)=>string; disabled?:boolean; className?:string;
}
/** Owns input sessions only. History and parameter meaning belong to the caller. */
export default function NumericSlider(props:NumericSliderProps){
 const latest=useRef(props);latest.current=props;
 const input=useRef<HTMLInputElement>(null),editing=useRef(false),pointer=useRef<number|null>(null);
 const pointerAtNeutral=useRef<number|null>(null);
 const hold=useRef<{key:string;direction:number;start:number;last:number;alt:boolean;shift:boolean}|null>(null),raf=useRef(0);
 const end=useCallback(()=>{
  cancelAnimationFrame(raf.current);hold.current=null;pointerAtNeutral.current=null;
  const id=pointer.current;pointer.current=null;
  if(id!==null&&input.current?.hasPointerCapture(id))input.current.releasePointerCapture(id);
  if(editing.current){editing.current=false;latest.current.onEditEnd?.();}
 },[]);
 const change=useCallback((value:number)=>{
  const p=latest.current;if(p.disabled||!Number.isFinite(value))return;
  value=snapTowardTargets(p.value,Math.max(p.min,Math.min(p.max,value)),p.min,p.max,p.snapTargets);if(value===p.value)return;
  if(!editing.current){editing.current=true;p.onEditStart?.();}
  latest.current={...p,value};p.onChange(value);
 },[]);
 useEffect(()=>{const stop=()=>end(),visibility=()=>{if(document.hidden)end();};window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);end();};},[end]);
 useEffect(()=>{if(props.disabled)end();},[props.disabled,end]);
 const move=(x:number)=>{
  const r=input.current!.getBoundingClientRect(),p=latest.current,raw=trackValue(x,r.left,r.width,p.min,p.max);
  if(pointerAtNeutral.current!==null&&Math.abs(raw-pointerAtNeutral.current)<=(p.max-p.min)*.01)return;
  pointerAtNeutral.current=null;
  const snapped=snapTowardTargets(p.value,raw,p.min,p.max,p.snapTargets);
  if(snapped!==raw)pointerAtNeutral.current=snapped;
  change(snapped);
 };
 const tick=()=>{
  const h=hold.current;if(!h)return;const now=performance.now(),p=latest.current;
  const dt=Math.min(50,Math.max(0,now-Math.max(h.last,h.start+SLIDER.delay)));h.last=now;
  if(dt)change(p.value+h.direction*(p.step??(p.max-p.min)*SLIDER.normalizedStep)*modifierScale(h.alt,h.shift,p.fineScale,p.coarseScale)*SLIDER.stepsPerSecond*holdMultiplier(now-h.start)*dt/1000);
  if(hold.current)raf.current=requestAnimationFrame(tick);
 };
 return <label className={'numeric-slider '+(props.className??'')} data-ui-keyboard>
 <span className="numeric-slider-caption" onClick={()=>input.current?.focus()}>{props.label}<span className="numeric-slider-value">{(props.formatValue??formatNumeric)(props.value)}</span></span>
 <input ref={input} aria-label={props.label} aria-valuetext={(props.formatValue??formatNumeric)(props.value)} type="range" min={props.min} max={props.max} step="any" value={props.value} disabled={props.disabled}
 onPointerDown={e=>{if(e.button!==0||props.disabled)return;e.preventDefault();end();e.currentTarget.focus();pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);move(e.clientX);}}
 onPointerMove={e=>{if(pointer.current===e.pointerId)move(e.clientX);}}
 onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
 onKeyDown={e=>{
  if(hold.current){hold.current.alt=e.altKey;hold.current.shift=e.shiftKey;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  e.preventDefault();e.stopPropagation();if(e.repeat||hold.current?.key===e.key)return;
  end();const p=latest.current;
  if(e.key==='Home'||e.key==='End'){change(e.key==='Home'?p.min:p.max);return;}
  const direction=e.key==='ArrowRight'||e.key==='ArrowUp'?1:-1,now=performance.now();
  hold.current={key:e.key,direction,start:now,last:now,alt:e.altKey,shift:e.shiftKey};
  change(p.value+direction*(p.step??(p.max-p.min)*SLIDER.normalizedStep)*modifierScale(e.altKey,e.shiftKey,p.fineScale,p.coarseScale));raf.current=requestAnimationFrame(tick);
 }}
 onKeyUp={e=>{if(hold.current){hold.current.alt=e.altKey;hold.current.shift=e.shiftKey;}if(e.key===hold.current?.key||e.key==='Home'||e.key==='End'){e.preventDefault();end();}}}
 onChange={e=>{change(+e.target.value);if(pointer.current===null&&!hold.current)end();}}/>
 </label>;
}
