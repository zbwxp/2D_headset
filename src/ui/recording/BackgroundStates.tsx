import {applyBackgroundState,deleteBackgroundState,matchesBackgroundState,renameBackgroundState,saveBackgroundState,updateBackgroundState,type RecordingReferenceImage} from '../../domain/recording/reference';
import {uiText as t} from '../i18n';

export default function BackgroundStates({reference:r,change}:{reference:RecordingReferenceImage;change:(fn:(r:RecordingReferenceImage)=>RecordingReferenceImage)=>void}){
 const states=r.states??[],active=states.find(s=>s.id===r.activeStateId),dirty=active&&!matchesBackgroundState(r,active);
 const add=(slot?:number)=>change(current=>{
  let next=slot??0;if(slot===undefined)while(current.states?.some(s=>s.slot===next))next++;
  return saveBackgroundState(current,crypto.randomUUID(),t('背景状态')+' '+(next+1),next);
 });
 const slots=[...new Set([...Array.from({length:9},(_,i)=>i),...states.map(s=>s.slot)])].sort((a,b)=>a-b);
 return <details className="recording-background-states" open>
  <summary>{t('背景状态')} ({states.length})</summary>
  <small>{t('点击状态切换；空位保存当前位置。名称可修改。')}</small>
  <div className="recording-background-state-grid">
   {slots.map(slot=>{const s=states.find(s=>s.slot===slot);return s?<button key={slot} data-testid="recording-background-state" data-state-id={s.id} aria-pressed={active?.id===s.id} title={s.name} onClick={()=>change(current=>applyBackgroundState(current,s.id))}><span>{slot+1}</span>{s.name}</button>:<button key={slot} data-testid="recording-background-state-empty" className="empty" aria-label={t('保存背景状态')+' '+(slot+1)} onClick={()=>add(slot)}>＋ {slot+1}</button>;})}
  </div>
  <button data-testid="recording-background-state-add" onClick={()=>add()}>{t('保存为新背景状态')}</button>
  {active&&<div className="recording-background-state-edit">
   <label>{t('状态名称')}<input key={active.id+':'+active.name} aria-label={t('背景状态名称')} defaultValue={active.name} onBlur={e=>{const name=e.target.value.trim();if(!name){e.target.value=active.name;return;}change(current=>renameBackgroundState(current,active.id,name));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.currentTarget.value=active.name;e.currentTarget.blur();}}}/></label>
   <small data-testid="recording-background-state-status">{t(dirty?'已调整背景，尚未更新此状态':'当前背景与此状态一致')}</small>
   <div><button disabled={!dirty} onClick={()=>change(current=>updateBackgroundState(current,active.id))}>{t('更新当前背景状态')}</button><button onClick={()=>change(current=>deleteBackgroundState(current,active.id))}>{t('删除背景状态')}</button></div>
  </div>}
 </details>;
}
