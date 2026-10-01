import {useEffect,useState} from 'react';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {sameAngle,placementName,placementWeights,savePlacement,discardPlacementDraft,deletePlacement,visitPlacement,importPlacement} from '../../domain/assembly/placement';
import {uiText as t} from '../i18n';
interface Props {a:AssemblyDocument;change:(f:(a:AssemblyDocument)=>AssemblyDocument)=>void}
export default function PlacementPanel({a,change}:Props){
 const r=a.placement,key=r?.keys.find(k=>sameAngle(k,a.pose)),draft=r?.drafts.find(k=>sameAngle(k,a.pose)),evaluation=r?.enabled?placementWeights(r,a.pose):undefined;
 const [name,setName]=useState(''),[source,setSource]=useState('');
 const angle=placementName(a.pose);
 useEffect(()=>setName(draft?.name??key?.name??angle),[angle,key?.id,key?.name,draft?.id,draft?.name]);
 const rows=[...r?.keys??[],...(r?.drafts??[]).filter(d=>!r?.keys.some(k=>sameAngle(d,k)))].sort((a,b)=>a.pitch-b.pitch||a.yaw-b.yaw);
 const snapshots=a.drawingSnapshots?.items.filter(s=>a.frames[s.id]);
 const status=r?.enabled&&draft?'当前角度有未保存定位':!r?.keys.length?'尚未录制':!r.enabled?'基础构造模式':key?'当前角度已录制':evaluation?.covered?'插值预览':'范围外：沿用最近定位';
 return <details open className="assembly-placement" data-testid="assembly-placement">
  <summary>{t('定位姿态录制')}</summary>
  <div className="assembly-placement-angle">{angle}</div>
  <p role="status" data-testid="assembly-placement-status">{t(status)}</p>
  <label className="assembly-placement-option"><input type="checkbox" data-testid="assembly-placement-enabled" disabled={!r||!r.keys.length&&!r.drafts.length} checked={!!r?.enabled} onChange={e=>{const enabled=e.target.checked;change(a=>a.placement?{...a,placement:{...a.placement,enabled}}:a);}}/>{t('使用定位录制')}</label>
  <label className="assembly-placement-name">{t('定位姿态名称')}<input aria-label={t('定位姿态名称')} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
  <div className="assembly-row"><button data-testid="assembly-placement-save" disabled={!name.trim()||!!r?.keys.length&&!r.enabled} onClick={()=>change(a=>savePlacement(a,name))}>{t(key?'更新此角度定位':'保存当前角度定位')}</button>
   {draft&&<button data-testid="assembly-placement-discard" onClick={()=>change(discardPlacementDraft)}>{t('撤回定位草稿')}</button>}
  </div>
  <small>{t(!r?.keys.length?'先保存正面定位，再转动角度并调整点 X/Z、面 Y。':r.enabled?'修正当前角度后保存；切换角度会保留草稿。':'已暂停录制预览。此时修改的是基础构造；已有关键帧保留。')}</small>
  {r&&<><label className="assembly-placement-option"><input type="checkbox" data-testid="assembly-placement-loop" checked={r.loop} onChange={e=>{const loop=e.target.checked;change(a=>a.placement?{...a,placement:{...a.placement,loop}}:a);}}/>{t('整圈循环插值')}</label>
   <small>{t('未开启循环时，未覆盖角度沿用最近定位，不补录关键帧。')}</small>
   <div className="assembly-placement-count">{r.keys.length} {t('已录制')} · {r.drafts.length} {t('待保存')}</div>
   <ul className="assembly-placement-list">{rows.map(k=>{const pending=r.drafts.some(d=>sameAngle(d,k)),saved=r.keys.some(s=>s.id===k.id);return <li key={k.id} data-testid="assembly-placement-key" data-id={k.id} data-yaw={k.yaw} data-pitch={k.pitch}>
    <button className="assembly-placement-visit" aria-pressed={sameAngle(k,a.pose)} onClick={()=>change(a=>visitPlacement(a,k.id))}><strong>{k.name}</strong><span>{placementName(k)}{pending?' · '+t('待保存'):''}</span></button>
    {saved&&<button aria-label={`${t('删除定位姿态')} ${k.name}`} onClick={()=>change(a=>deletePlacement(a,k.id))}>×</button>}
   </li>;})}</ul>
  </>}
  {!!snapshots?.length&&<details><summary>{t('从组装快照录入定位')}</summary><select aria-label={t('定位来源快照')} value={source} onChange={e=>setSource(e.target.value)}><option value="">{t('选择快照')}</option>{snapshots.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><button disabled={!snapshots.some(s=>s.id===source)} onClick={()=>change(a=>importPlacement(a,source))}>{t('只录入定位')}</button><small>{t('按快照角度更新定位，不替换画稿与透视。')}</small></details>}
 </details>;
}
