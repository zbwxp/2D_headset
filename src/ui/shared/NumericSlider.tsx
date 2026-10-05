import {uiText} from "../i18n";
import {useCallback,useEffect,useRef,useState} from 'react';
import {SLIDER,formatNumeric,modifierScale,holdMultiplier,trackValue,snapTowardTargets} from './numericSliderMath';
export interface NumericSliderProps {
 label:string; value:number; min:number; max:number;
 onChange:(value:number)=>void; onEditStart?:()=>void; onEditEnd?:()=>void; onEditCancel?:()=>void;
 onUndo?:()=>void; onRedo?:()=>void;
 snapTargets?:number[]; step?:number; fineScale?:number; coarseScale?:number;
 /** Display units per stored unit, e.g. 100 for normalized percentages. */
 inputScale?:number; formatValue?:(value:number)=>string; disabled?:boolean; className?:string;
}
/** Owns input sessions only. History and parameter meaning belong to the caller. */
export default function NumericSlider(props:NumericSliderProps){
 const [draft,setDraft]=useState<string|null>(null),[invalid,setInvalid]=useState(false);
 const draftActive=useRef(false);
 const latest=useRef(props);latest.current=props;
 const input=useRef<HTMLInputElement>(null),editing=useRef(false),pointer=useRef<number|null>(null);
 const pointerAtNeutral=useRef<number|null>(null);
 const hold=useRef<{key:string;direction:number;start:number;last:number;alt:boolean;shift:boolean}|null>(null),raf=useRef(0);
 const finish=useCallback((commit:boolean)=>{
  cancelAnimationFrame(raf.current);hold.current=null;pointerAtNeutral.current=null;
  const id=pointer.current;pointer.current=null;
  if(id!==null&&input.current?.hasPointerCapture(id))input.current.releasePointerCapture(id);
  if(editing.current){editing.current=false;const p=latest.current;if(!commit&&p.onEditCancel)p.onEditCancel();else p.onEditEnd?.();}
 },[]);
 const end=useCallback(()=>finish(true),[finish]),cancel=useCallback(()=>finish(false),[finish]);
 const change=useCallback((value:number,snap=true)=>{
  const p=latest.current;if(p.disabled||!Number.isFinite(value))return;
  value=Math.max(p.min,Math.min(p.max,value));if(snap)value=snapTowardTargets(p.value,value,p.min,p.max,p.snapTargets);if(value===p.value)return;
  if(!editing.current){editing.current=true;p.onEditStart?.();}
  latest.current={...p,value};p.onChange(value);
 },[]);
 useEffect(()=>{const stop=()=>cancel(),visibility=()=>{if(document.hidden)cancel();};window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);cancel();};},[cancel]);
 useEffect(()=>{if(props.disabled){cancel();draftActive.current=false;setDraft(null);setInvalid(false);}},[props.disabled,cancel]);
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
 const finishDraft=(commit:boolean)=>{
  if(!draftActive.current)return;
  const text=(draft??'').trim().replace(/[%°]$/, '').trim();
  const value=text===''?NaN:Number(text)/(latest.current.inputScale??1);
  if(commit&&!Number.isFinite(value)){setInvalid(true);return;}
  draftActive.current=false;setDraft(null);setInvalid(false);
  if(commit){change(value,false);end();}
 };
 return <div className={'numeric-slider '+(props.className??'')} data-ui-keyboard>
 <span className="numeric-slider-caption" onClick={()=>input.current?.focus({preventScroll:true})}>{uiText(props.label)}{draft===null?<span className="numeric-slider-value" title={uiText("双击输入数值")} onDoubleClick={e=>{
  e.preventDefault();e.stopPropagation();if(props.disabled)return;end();draftActive.current=true;setInvalid(false);setDraft(String(props.value*(props.inputScale??1)));
 }}>{uiText((props.formatValue??formatNumeric)(props.value))}</span>:<input className="numeric-slider-entry" aria-label={uiText(props.label+' 数值')} aria-invalid={invalid} title={uiText(invalid?'请输入有效数字':'Enter 确认，Esc 取消')} type="text" inputMode="decimal" value={draft} disabled={props.disabled}
 ref={el=>{if(el&&document.activeElement!==el){el.focus({preventScroll:true});el.select();}}}
 onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
 onChange={e=>{setDraft(e.target.value);setInvalid(false);}} onBlur={()=>finishDraft(true)}
 onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finishDraft(true);}if(e.key==='Escape'){e.preventDefault();finishDraft(false);input.current?.focus();}}}/>}</span>
 <input ref={input} aria-label={uiText(props.label)} aria-valuetext={(props.formatValue??formatNumeric)(props.value)} type="range" min={props.min} max={props.max} step="any" value={props.value} disabled={props.disabled}
 onPointerDown={e=>{if(e.button!==0||props.disabled)return;e.preventDefault();end();e.currentTarget.focus();pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);move(e.clientX);}}
 onPointerMove={e=>{if(pointer.current===e.pointerId)move(e.clientX);}}
 onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={end}
 onKeyDown={e=>{
  if(e.key==='Escape'&&editing.current&&latest.current.onEditCancel){e.preventDefault();e.stopPropagation();cancel();return;}
  if((e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())){
   const action=e.key.toLowerCase()==='y'||e.shiftKey?latest.current.onRedo:latest.current.onUndo;
   if(action){e.preventDefault();e.stopPropagation();if(editing.current&&latest.current.onEditCancel)cancel();else{end();action();}}
   return;
  }
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
 </div>;
}
