import type {RecordedPoint,Recording,View} from '../../domain/recording/model';
import {sameView} from '../../domain/recording/model';
import {deleteRecordedPoint,evaluatePoint,pointUsers,reorderRecordedPoint,updateRecordedPoint} from '../../domain/recording/points';
import {visibleAtView} from '../../domain/recording/visibility';
import SortableList from './SortableList';
import FrameVisibility from './FrameVisibility';
import KeyList from './KeyList';
import {uiText as t} from '../i18n';

export default function PointPanel({recording:r,selected,view,onSelect,navigate,commit}:{recording:Recording;selected:string|null;view:View;onSelect:(id:string)=>void;navigate:(v:View)=>void;commit:(r:Recording)=>void}){
 const point=r.points?.find(p=>p.id===selected),evaluated=point?evaluatePoint(point,view):null;
 const update=(id:string,fn:(p:RecordedPoint)=>RecordedPoint)=>commit(updateRecordedPoint(r,id,fn));
 return <>
 <h3>{t('录制语义点')}</h3>
 <SortableList items={r.points??[]} selected={selected} kind="point" onReorder={(id,target,after)=>commit(reorderRecordedPoint(r,id,target,after))}>{p=><>
  <button className="recording-name" data-recording-list-select data-recording-point-select onClick={()=>onSelect(p.id)}>{p.name}<span className="recording-point-badge">{t('点')}</span>{!visibleAtView(p,view)&&<span className="recording-hidden-badge" data-testid="recording-frame-hidden">{t('当前帧已隐藏')}</span>}</button>
  <label title={t('显示')}><input type="checkbox" aria-label={t('显示')+' '+p.name} checked={p.visible} onChange={e=>update(p.id,p=>({...p,visible:e.target.checked}))}/></label>
  <button aria-label={t('锁定')+' '+p.name} title={t(p.locked?'解锁':'锁定')} onClick={()=>update(p.id,p=>({...p,locked:!p.locked}))}>{p.locked?'🔒':'🔓'}</button>
 </>}</SortableList>
 {point&&<section className="recording-inspector" key={point.id} data-testid="recording-point-inspector">
  <input aria-label={t('录制语义点名称')} key={point.name} defaultValue={point.name} disabled={point.locked} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==point.name)update(point.id,p=>({...p,name}));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
  <span className="recording-point-badge">{t('点')}</span>
  <p data-testid="recording-point-status">{t(evaluated?.status==='key'?'当前正式 Key':evaluated?.status==='interpolation'?'有效插值':'未覆盖 · 冻结参考')}</p>
  <small>{t('拖动语义点录制位置；连接曲线自动跟随。隐藏只影响点标记。')}</small>
  <small className="recording-point-help">{t('方向键移动 · Shift 加快 · Alt 精细 · 拖动列表行排序')}</small>
  <FrameVisibility element={point} recording={r} view={view} commit={commit}/>
  <h4>{t('视角 Keys')}</h4>
  <KeyList keys={point.keys} disabled={point.locked} minimumLabel="语义点至少保留一个 Key" navigate={navigate} onDelete={views=>update(point.id,p=>({...p,keys:p.keys.filter(k=>!views.some(v=>sameView(v,k)))}))}/>
  <details><summary>{t('永久删除')}</summary><button disabled={point.locked||pointUsers(r,point.id).length>0} onClick={()=>commit(deleteRecordedPoint(r,point.id))}>{t('删除语义点及所有关键帧')}</button>
   {pointUsers(r,point.id).length>0&&<small>{t('此点仍被语义曲线引用，请先删除连接曲线。')}</small>}
  </details>
 </section>}
 </>;
}
