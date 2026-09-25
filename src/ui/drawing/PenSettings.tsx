import {useEffect,useRef,useState} from 'react';
import {MAX_PEN_TAPER_SCALE} from '../../domain/drawing/model';
import {usePenPreferences} from './penPreferences';
import {uiText as t} from '../i18n';

export default function PenSettings({close}:{close:()=>void}){
 const preferences=usePenPreferences(),[draft,setDraft]=useState(String(preferences.taperScale)),dialog=useRef<HTMLDialogElement>(null);
 const value=Number(draft),valid=draft.trim()!==''&&Number.isFinite(value)&&value>=0&&value<=MAX_PEN_TAPER_SCALE;
 useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close();},[]);
 return <dialog ref={dialog} role="dialog" className="drawing-pen-settings" aria-label={t('钢笔默认设置')} onCancel={e=>{e.preventDefault();close();}}>
  <form onSubmit={e=>{e.preventDefault();if(valid){preferences.setTaperScale(value);close();}}}>
   <strong>{t('钢笔默认设置')}</strong>
   <label className="drawing-field">{t('默认收尖倍数')}<input autoFocus aria-label={t('默认收尖倍数')} type="number" min={0} max={MAX_PEN_TAPER_SCALE} step="any" value={draft} onChange={e=>setDraft(e.target.value)}/><span>×</span></label>
   <input aria-label={t('默认收尖倍数滑条')} type="range" min={0} max={MAX_PEN_TAPER_SCALE} step={1} value={valid?value:0} onChange={e=>setDraft(e.target.value)}/>
   <p>{t('收尖距离 = 线宽 × 倍数；0 表示不收尖。')}</p>
   <p>{t('只影响之后新画笔画的首尾；内部接点默认等宽。已有笔画不变，设置会自动记住。')}</p>
   {!valid&&<p role="alert">{t('请输入 0–200 之间的倍数。')}</p>}
   <footer><button type="button" onClick={close}>{t('取消')}</button><button type="submit" disabled={!valid}>{t('应用')}</button></footer>
  </form>
 </dialog>;
}
