import type {AssemblyDocument} from '../../domain/assembly/model';
import {saveViewSlot,applyViewSlot,updateViewSlot,renameViewSlot,deleteViewSlot,matchesViewSlot} from '../../domain/assembly/viewSlots';
import {NameField} from '../assemblyDrawing/Field';
import {uiText as t} from '../i18n';

export default function ViewSlots({a,change}:{a:AssemblyDocument;change:(f:(a:AssemblyDocument)=>AssemblyDocument)=>void}){
 const states=a.viewSlots??[],active=states.find(s=>s.id===a.activeViewSlotId);
 const slots=[...new Set([...Array.from({length:9},(_,i)=>i),...states.map(s=>s.slot)])].sort((a,b)=>a-b);
 const save=(slot?:number)=>{
  let index=slot??0;while(slot===undefined&&states.some(s=>s.slot===index))index++;
  change(a=>saveViewSlot(a,crypto.randomUUID(),`${t('视角')} ${index+1}`,index));
 };
 return <details className="assembly-view-slots" data-testid="assembly-view-slots"><summary>{t('主轴视角 Slot')}</summary>
  <small>{t('保存转头、俯仰和歪头角度。')}</small>
  <div className="assembly-view-slot-grid">{slots.map(i=>{const s=states.find(s=>s.slot===i);return <button key={i} data-testid="assembly-view-slot" data-slot={i} data-filled={!!s} aria-pressed={!!s&&s.id===active?.id}
   aria-label={s?`${t('切换主轴视角')} ${s.name}`:`${t('保存当前视角到 Slot')} ${i+1}`}
   title={s?`${s.name} · Yaw ${s.yaw}° / Pitch ${s.pitch}° / Roll ${s.roll}°`:t('保存当前视角')}
   onClick={()=>s?change(a=>applyViewSlot(a,s.id)):save(i)}><span>{i+1}</span><strong>{s?.name??t('空位')}</strong></button>;})}</div>
  <button className="assembly-view-slot-new" onClick={()=>save()}>{t('保存为新视角 Slot')}</button>
  {active&&<><label className="assembly-view-slot-name">{t('视角 Slot 名称')}<NameField label="视角 Slot 名称" value={active.name} onChange={name=>change(a=>renameViewSlot(a,active.id,name))}/></label>
   <div className="assembly-row"><button disabled={matchesViewSlot(a,active)} onClick={()=>change(a=>updateViewSlot(a,active.id))}>{t('用当前角度覆盖')}</button><button onClick={()=>change(a=>deleteViewSlot(a,active.id))}>{t('清空此 Slot')}</button></div>
   {!matchesViewSlot(a,active)&&<small>{t('当前角度已调整，尚未覆盖此 Slot。')}</small>}
  </>}
 </details>;
}
