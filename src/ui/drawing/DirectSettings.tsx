import {useEffect,useRef,useState} from 'react';
import {useDirectPreferences} from './directPreferences';
import {uiText as t} from '../i18n';

export default function DirectSettings({close}:{close:()=>void}){
 const preferences=useDirectPreferences(),[draft,setDraft]=useState(String(preferences.followPercent)),dialog=useRef<HTMLDialogElement>(null);
 const value=Number(draft),valid=draft.trim()!==''&&Number.isFinite(value)&&value>=0&&value<=100;
 useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close();},[]);
 return <dialog ref={dialog} role="dialog" className="drawing-pen-settings" aria-label={t('直接选择设置')} onCancel={e=>{e.preventDefault();close();}}>
  <form onSubmit={e=>{e.preventDefault();if(valid){preferences.setFollowPercent(value);close();}}}>
   <strong>{t('直接选择设置')}</strong>
   <label className="drawing-field">{t('方向跟随')}<input autoFocus aria-label={t('方向跟随')} type="number" min={0} max={100} step="any" value={draft} onChange={e=>setDraft(e.target.value)}/><span>%</span></label>
   <input aria-label={t('方向跟随滑条')} type="range" min={0} max={100} step={1} value={valid?value:0} onChange={e=>setDraft(e.target.value)}/>
   <p>{t('0% 保持原方向；数值越大，控制柄越随端点位置转动。')}</p>
   <p>{t('只影响之后的端点拖动，保留柄长和平滑接笔。设置会自动记住。')}</p>
   {!valid&&<p role="alert">{t('请输入 0–100 之间的百分比。')}</p>}
   <footer><button type="button" onClick={close}>{t('取消')}</button><button type="submit" disabled={!valid}>{t('应用')}</button></footer>
  </form>
 </dialog>;
}
