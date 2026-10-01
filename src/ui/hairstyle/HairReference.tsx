import {useState} from 'react';
import NumericSlider from '../shared/NumericSlider';
import {useLanguage} from '../i18n';
import {saveBackgroundState,applyBackgroundState,updateBackgroundState,renameBackgroundState,type RecordingReferenceImage} from '../../domain/recording/reference';
import type {ReferenceImage} from '../../domain/project/types';
import {uid} from '../../domain/drawing/model';
export default function HairReference({reference:r,change,upload,moving,setMoving,begin,end}:{reference?:ReferenceImage;change:(r:ReferenceImage|undefined)=>void;upload:()=>void;moving:boolean;setMoving:(v:boolean)=>void;begin:()=>void;end:()=>void}){
 const zh=useLanguage(s=>s.language)==='zh',t=(a:string,b:string)=>zh?a:b,[slot,setSlot]=useState(1),[name,setName]=useState('');
 if(!r)return <button onClick={upload}>{t('插入背景参考图','Insert reference image')}</button>;
 const ref=r as RecordingReferenceImage,save=(patch:Partial<ReferenceImage>)=>change({...r,...patch}),edit={onEditStart:begin,onEditEnd:end,disabled:r.locked};
 const action=(fn:()=>void)=>{begin();try{fn();}finally{end();}};
 return <div className="hair-reference-controls" data-ui-keyboard>
  <p>{r.name}</p><div className="hair-actions"><button disabled={r.locked} onClick={upload}>{t('更换参考图','Replace image')}</button><button disabled={r.locked||!r.visible} aria-pressed={moving} onClick={()=>setMoving(!moving)}>{t('拖动参考图','Move reference')}</button></div>
  <NumericSlider label={t('背景缩放','Reference scale')} min={.1} max={10} value={r.scale} inputScale={100} formatValue={v=>Math.round(v*100)+'%'} onChange={scale=>save({scale})} {...edit}/>
  <NumericSlider label={t('背景不透明度','Reference opacity')} min={0} max={1} value={r.opacity} inputScale={100} formatValue={v=>Math.round(v*100)+'%'} onChange={opacity=>save({opacity})} {...edit}/>
  {([0,1] as const).map(i=><NumericSlider key={i} label={t('背景位移 ','Reference offset ')+['X','Y'][i]} min={-10} max={10} value={r.offset[i]} onChange={v=>{const offset=[...r.offset] as [number,number];offset[i]=v;save({offset});}} {...edit}/>)}
  <NumericSlider label={t('背景旋转','Reference rotation')} min={-180} max={180} value={r.rotation} formatValue={v=>v.toFixed(1)+'°'} onChange={rotation=>save({rotation})} {...edit}/>
  <details><summary>{t('参考图状态 · 9 个位置','Reference states · 9 slots')}</summary><div className="hair-state-grid">{Array.from({length:9},(_,i)=>{const s=ref.states?.find(s=>s.slot===i+1);return <button key={i} aria-pressed={slot===i+1} title={s?.name} onClick={()=>{setSlot(i+1);setName(s?.name??'');if(s)action(()=>change(applyBackgroundState(ref,s.id)));}}>{s?.name??String(i+1)}</button>;})}</div><input aria-label={t('参考图状态名称','Reference state name')} placeholder={t('状态名称','State name')} value={name} onChange={e=>setName(e.target.value)}/><button onClick={()=>action(()=>{const old=ref.states?.find(s=>s.slot===slot),label=name||`${t('位置','Position')} ${slot}`;change(old?renameBackgroundState(updateBackgroundState(ref,old.id),old.id,label):saveBackgroundState(ref,uid(),label,slot));})}>{t('保存到此位置','Save to slot')}</button></details>
  <button disabled={r.locked} onClick={()=>action(()=>change(undefined))}>{t('移除参考图','Remove reference')}</button>
 </div>;
}
