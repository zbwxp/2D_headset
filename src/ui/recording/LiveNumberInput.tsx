import {useRef,useState} from 'react';

/** Preview valid numbers as they are entered; one commit per focus session. */
export default function LiveNumberInput({label,value,disabled,onStart,onPreview,onFinish}:{
 label:string;value:number;disabled?:boolean;
 onStart:()=>void;onPreview:(value:number)=>void;onFinish:(commit:boolean)=>void;
}){
 const [text,setText]=useState<string|null>(null),editing=useRef(false);
 function finish(commit:boolean){if(!editing.current)return;editing.current=false;setText(null);onFinish(commit);}
 return <input aria-label={label} type="number" step=".01" disabled={disabled} value={text??+value.toFixed(4)}
  onFocus={()=>{editing.current=true;setText(String(+value.toFixed(4)));onStart();}}
  onChange={e=>{setText(e.target.value);const n=e.target.valueAsNumber;if(Number.isFinite(n))onPreview(n);}}
  onBlur={()=>finish(true)} onKeyDown={e=>{
   if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);e.currentTarget.blur();}
  }}/>;
}
