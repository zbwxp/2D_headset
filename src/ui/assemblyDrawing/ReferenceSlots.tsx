import {uid,type DrawingDocument} from '../../domain/drawing/model';
import {saveBackgroundState,applyBackgroundState,updateBackgroundState,renameBackgroundState,deleteBackgroundState,matchesBackgroundState,type RecordingReferenceImage} from '../../domain/recording/reference';
import PanelSection from '../shared/PanelSection';
import {NameField} from './Field';
import {uiText as t} from '../i18n';

export default function ReferenceSlots({document:d,run}:{document:DrawingDocument;run:(fn:()=>DrawingDocument)=>void}){
 const ref:RecordingReferenceImage|undefined=d.reference;
 if(!ref)return null;
 const states=ref.states??[],active=states.find(s=>s.id===ref.activeStateId);
 const slots=[...new Set([...Array.from({length:9},(_,i)=>i),...states.map(s=>s.slot)])].sort((a,b)=>a-b);
 const change=(fn:(r:RecordingReferenceImage)=>RecordingReferenceImage)=>run(()=>{
  const reference=fn(ref);return reference===ref?d:{...d,reference};
 });
 const save=(slot?:number)=>{
  let index=slot??0;while(slot===undefined&&states.some(s=>s.slot===index))index++;
  change(r=>saveBackgroundState(r,uid(),`${t('位置')} ${index+1}`,index));
 };
 return <PanelSection id="assembly.reference-slots" title="参考图位置 Slot" className="assembly-drawing-reference-slots" testId="assembly-reference-slots">
  <div data-ui-keyboard>
   <p className="assembly-drawing-muted">{t('点击空位保存；点击已存位置切换。')}</p>
   <div className="assembly-reference-slot-grid">
    {slots.map(i=>{
     const state=states.find(s=>s.slot===i),selected=state?.id===active?.id&&!!state;
     return <button key={i} data-testid="assembly-reference-slot" data-slot={i} data-filled={!!state} aria-pressed={selected}
      aria-label={state?`${t('切换参考图位置')} ${state.name}`:`${t('保存当前位置到 Slot')} ${i+1}`}
      title={state?`${state.name} · X ${state.offset[0].toFixed(2)} / Y ${state.offset[1].toFixed(2)} · ${Math.round(state.scale*100)}%`:t('保存当前位置')}
      onClick={()=>state?change(r=>applyBackgroundState(r,state.id)):save(i)}>
      <span>{i+1}</span><strong>{state?.name??t('空位')}</strong>
     </button>;
    })}
   </div>
   <button className="assembly-reference-slot-new" onClick={()=>save()}>{t('保存为新 Slot')}</button>
   {active&&<>
    <label className="assembly-reference-slot-name">{t('Slot 名称')}<NameField label="Slot 名称" value={active.name} onChange={name=>change(r=>renameBackgroundState(r,active.id,name))}/></label>
    <div className="assembly-drawing-property-actions">
     <button disabled={matchesBackgroundState(ref,active)} onClick={()=>change(r=>updateBackgroundState(r,active.id))}>{t('用当前位置覆盖此 Slot')}</button>
     <button onClick={()=>change(r=>deleteBackgroundState(r,active.id))}>{t('清空此 Slot')}</button>
    </div>
    {!matchesBackgroundState(ref,active)&&<p className="assembly-drawing-muted">{t('已调整背景，尚未更新此状态')}</p>}
   </>}
  </div>
 </PanelSection>;
}
