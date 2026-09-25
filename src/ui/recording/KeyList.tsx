import {useState} from 'react';
import type {View} from '../../domain/recording/model';
import {uiText as t} from '../i18n';
const id=(v:View)=>`${v.yaw}:${v.pitch}`;
/** Selection is UI-only; range order is the visible, canonical yaw/pitch order. */
export default function KeyList({keys,disabled=false,minKeys=1,deleteLabel='删除 Key',minimumLabel='曲线至少保留一个 Key',navigate,onDelete}:{keys:View[];disabled?:boolean;minKeys?:number;deleteLabel?:string;minimumLabel?:string;navigate:(v:View)=>void;onDelete:(views:View[])=>void}){
 const [selected,setSelected]=useState<string[]>([]),[anchor,setAnchor]=useState<string|null>(null);
 const ordered=[...keys].sort((a,b)=>a.yaw-b.yaw||a.pitch-b.pitch),chosen=ordered.filter(k=>selected.includes(id(k)));
 function remove(views:View[]){if(disabled||!views.length||keys.length-views.length<minKeys)return;onDelete(views);setSelected([]);setAnchor(null);}
 return <div className="recording-key-list">
 <small>{t('点击选择 · Shift 点击连续范围 · Ctrl/⌘ 点击多选')}</small>
 <div><button disabled={disabled||!chosen.length||keys.length-chosen.length<minKeys} onClick={()=>remove(chosen)}>{t('删除所选帧')} ({chosen.length})</button></div>
 {minKeys>0&&<small>{t(minimumLabel)}</small>}
 {ordered.map(k=><div className={`recording-key${selected.includes(id(k))?' selected':''}`} key={id(k)}>
 <button aria-pressed={selected.includes(id(k))} onClick={e=>{const target=id(k),start=ordered.findIndex(x=>id(x)===anchor),end=ordered.indexOf(k);
 if(e.shiftKey&&start>=0){const range=ordered.slice(Math.min(start,end),Math.max(start,end)+1).map(id);setSelected(e.ctrlKey||e.metaKey?[...new Set([...selected,...range])]:range);}
 else {setSelected(e.ctrlKey||e.metaKey?selected.includes(target)?selected.filter(x=>x!==target):[...selected,target]:[target]);setAnchor(target);}navigate(k);
 }}>Yaw {+k.yaw.toFixed(2)}° · Pitch {+k.pitch.toFixed(2)}°</button>
 <button aria-label={t(deleteLabel)} disabled={disabled||keys.length<=minKeys} onClick={()=>remove([k])}>×</button>
 </div>)}
 </div>;
}
