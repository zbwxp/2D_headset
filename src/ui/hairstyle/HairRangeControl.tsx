import {useRef} from 'react';
import NumericSlider from '../shared/NumericSlider';
import type {HairRange} from '../../domain/hairstyle/strandTypes';
import {resolveHairRange} from '../../domain/hairstyle/strandTypes';
import {useLanguage} from '../i18n';
/** The two thumbs bound additive jitter; coincident thumbs are deterministic. */
export default function HairRangeControl({label,value,sample,min,max,spread,percent=false,onChange,begin,end,disabled=false}:{label:string;value:HairRange;sample:number;min:number;max:number;spread:number;percent?:boolean;onChange:(v:HairRange)=>void;begin:()=>void;end:()=>void;disabled?:boolean}){
 const zh=useLanguage(s=>s.language)==='zh',track=useRef<HTMLDivElement>(null),drag=useRef<0|1|null>(null),latest=useRef(value);latest.current=value;
 const format=(n:number)=>(percent?(n*100).toFixed(1)+'%':n.toFixed(3)+' R');
 const change=(i:0|1,n:number)=>{const r=[...latest.current.random] as [number,number];r[i]=Math.max(-spread,Math.min(spread,i===0?Math.min(n,r[1]):Math.max(n,r[0])));const next={...latest.current,random:r};latest.current=next;onChange(next);};
 const at=(x:number)=>{const r=track.current!.getBoundingClientRect();return Math.max(-spread,Math.min(spread,((x-r.left)/r.width*2-1)*spread));};
 const finish=()=>{if(drag.current!==null){drag.current=null;end();}};
 return <div className="hair-range" data-ui-keyboard>
  <NumericSlider label={label} value={value.value} min={min} max={max} inputScale={percent?100:1} formatValue={format} disabled={disabled} onChange={v=>onChange({...value,value:v})} onEditStart={begin} onEditEnd={end}/>
  <details><summary>{zh?'随机偏移':'Random offset'} <span>{format(value.random[0])} ～ {format(value.random[1])}</span></summary>
   <div ref={track} className={'hair-range-track'+(disabled?' disabled':'')} onPointerDown={e=>{if(disabled||e.button!==0)return;e.preventDefault();const n=at(e.clientX),thumb=(e.target as HTMLElement).dataset.thumb;drag.current=thumb==='0'?0:thumb==='1'?1:Math.abs(n-value.random[0])<Math.abs(n-value.random[1])?0:Math.abs(n-value.random[0])===Math.abs(n-value.random[1])&&n<=value.random[0]?0:1;begin();e.currentTarget.setPointerCapture(e.pointerId);change(drag.current,n);}} onPointerMove={e=>{if(drag.current!==null)change(drag.current,at(e.clientX));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    <div className="hair-range-band" style={{left:`${(value.random[0]/spread+1)*50}%`,right:`${(1-value.random[1]/spread)*50}%`}}/>
    {([0,1] as const).map(i=><span key={i} data-thumb={i} role="slider" aria-label={label+(i?(zh?' 随机上限':' random maximum'):(zh?' 随机下限':' random minimum'))} aria-valuemin={-spread} aria-valuemax={spread} aria-valuenow={value.random[i]} aria-disabled={disabled} tabIndex={disabled?-1:0} style={{left:`${(value.random[i]/spread+1)*50}%`}} onKeyDown={e=>{if(disabled||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();begin();change(i,e.key==='Home'?-spread:e.key==='End'?spread:value.random[i]+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)*spread*(e.shiftKey?.1:.01));end();}}/>)}
   </div>
   <div className="hair-range-caption"><span>{zh?'本次':'Sample'} {format(Math.max(min,Math.min(max,resolveHairRange(value,sample))))}</span><button disabled={disabled} onClick={()=>{begin();onChange({...value,random:[0,0]});end();}}>{zh?'固定':'Fixed'}</button></div>
  </details>
 </div>;
}
