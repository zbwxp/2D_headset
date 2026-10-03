import {useEffect,useRef,useState} from 'react';
import {uiText as t} from '../i18n';
interface NumberFieldProps {label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;disabled?:boolean}
export function NumberField(props:NumberFieldProps){return <label className="drawing-field">{t(props.label)}<NumberInput {...props}/></label>;}
/** The same numeric editing contract is usable inside host-owned labels. */
export function NumberInput({label,value,onChange,min,max,disabled=false}:NumberFieldProps){
 const shown=+value.toFixed(5),[text,setText]=useState(String(shown)),cancelled=useRef(false);
 useEffect(()=>setText(String(shown)),[shown]);
 const clamp=(n:number)=>Math.max(min??-Infinity,Math.min(max??Infinity,n));
 const finish=()=>{if(cancelled.current){cancelled.current=false;setText(String(shown));return;}const n=text.trim()?Number(text):NaN;if(Number.isFinite(n)){const next=clamp(n);if(next!==shown)onChange(next);setText(String(next));}else setText(String(shown));};
 return <input aria-label={t(label)} type="number" step="any" min={min} max={max} value={text} disabled={disabled} onChange={e=>setText(e.target.value)} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const n=text.trim()&&Number.isFinite(Number(text))?Number(text):shown,step=e.altKey?.1:e.shiftKey?10:1,next=clamp(Math.round((n+(e.key==='ArrowUp'?step:-step))*1e6)/1e6);setText(String(next));if(next!==shown)onChange(next);return;}if(e.key==='Escape'){cancelled.current=true;setText(String(shown));e.currentTarget.value=String(shown);}if(e.key==='Enter'||e.key==='Escape')e.currentTarget.blur();}}/>;
}
export function NameField({label,value,onChange,disabled=false}:{label:string;value:string;onChange:(s:string)=>void;disabled?:boolean}){return <input key={value} aria-label={t(label)} defaultValue={value} disabled={disabled} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==value)onChange(name);else e.target.value=value;}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')e.currentTarget.value=value;if(e.key==='Enter'||e.key==='Escape')e.currentTarget.blur();}}/>;}
