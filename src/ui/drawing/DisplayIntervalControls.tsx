import PanelSection from '../shared/PanelSection';
import {useState} from 'react';
import {editable,curveById,inkTaperDistance,type DrawingDocument as Doc,type DisplayIntervalMode} from '../../domain/drawing/model';
import {addDisplayInterval,changeDisplayInterval,removeDisplayInterval,setDisplayIntervalEnd,displayPath,pathTracks,intervalMode} from '../../domain/drawing/displayIntervals';
import type {DrawingSelection} from './session';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
export default function DisplayIntervalControls({d,id,selection,run,choose}:{d:Doc;id:string;selection:DrawingSelection;run:(f:()=>Doc)=>void;choose:(s:DrawingSelection)=>void}){
 const [newMode,setNewMode]=useState<DisplayIntervalMode>('SHOW');
 const path=displayPath(d,id),tracks=pathTracks(d,path),disabled=path.segments.some(x=>!editable(d,x.id));
 return <PanelSection id="drawing.intervals" title="显示区间" className="drawing-display-intervals" testId="drawing-display-intervals">
 <label className="drawing-field">{t('新增区间类型')}<select aria-label={t('新增区间类型')} value={newMode} disabled={disabled} onChange={e=>setNewMode(e.target.value as DisplayIntervalMode)}><option value="SHOW">{t('显线区间')}</option><option value="HIDE">{t('断线区间')}</option></select></label>
 <button disabled={disabled} onClick={()=>run(()=>{const n=addDisplayInterval(d,id,newMode),track=pathTracks(n,path).find(t=>!t.scope)!,range=track.ranges.at(-1)!;choose({ids:[id],displayInterval:{track:track.id,range:range.id,end:0}});return n;})}>{t('添加显示区间')}</button>
 <p className="drawing-muted">{t(tracks.length?'显线区间内绘制，断线区间内隐藏；只有断线区间时，其余整笔显示。':'未设置区间，整笔显示。')}{path.closed&&' '+t('闭环从起点沿笔画方向到终点；起点大于终点时跨过闭环原点。')}</p>
 {tracks.flatMap(track=>track.ranges.map((r,i)=><div key={r.id} className="drawing-display-range" data-testid="drawing-display-range" data-id={r.id} data-enabled={r.enabled!==false}>
  {track.scope==='CURVE'&&<small>{t('仅此曲段')} · {curveById(d,track.anchor.id).name}</small>}
  {track.revealFrom!==undefined&&<label className="drawing-field">{t('显现方向')}<select aria-label={t('显现方向')} value={track.revealFrom} disabled={disabled} onChange={e=>run(()=>({...d,displayIntervals:d.displayIntervals!.map(x=>x.id===track.id?{...x,revealFrom:+e.target.value as 0|1}:x)}))}><option value={0}>{t('从端点 A 显现')}</option><option value={1}>{t('从端点 B 显现')}</option></select></label>}
  <div className="drawing-property-actions"><span>{t('区间')} {i+1}</span>{([0,1] as const).map(end=><button key={end} aria-pressed={selection.displayInterval?.range===r.id&&selection.displayInterval.end===end} disabled={disabled} onClick={()=>choose({ids:[id],displayInterval:{track:track.id,range:r.id,end}})}>{t(end?'区间终点':'区间起点')}</button>)}<button disabled={disabled} aria-label={t('删除显示区间')} onClick={()=>run(()=>{choose({ids:[id]});return removeDisplayInterval(d,track.id,r.id);})}>×</button></div>
  <label className="drawing-field" title={t('关闭仅暂停此区间，保留位置与笔触。')}><span>{t('启用此区间')}</span><input type="checkbox" data-testid="drawing-interval-enabled" checked={r.enabled!==false} disabled={disabled} onChange={e=>run(()=>changeDisplayInterval(d,track.id,r.id,{enabled:e.target.checked}))}/></label>
  <label className="drawing-field">{t('区间类型')}<select aria-label={t('区间类型')} value={intervalMode(r)} disabled={disabled} onChange={e=>run(()=>changeDisplayInterval(d,track.id,r.id,{mode:e.target.value as DisplayIntervalMode}))}><option value="SHOW">{t('显线区间')}</option><option value="HIDE">{t('断线区间')}</option></select></label>
  <div className="drawing-fields"><NumberField label="区间起点 %" value={r.start*100} min={0} max={100} disabled={disabled} onChange={v=>run(()=>changeDisplayInterval(d,track.id,r.id,{start:v/100}))}/><NumberField label="区间终点 %" value={r.end*100} min={0} max={100} disabled={disabled} onChange={v=>run(()=>changeDisplayInterval(d,track.id,r.id,{end:v/100}))}/></div>
  {selection.displayInterval?.range===r.id&&(()=>{const end=selection.displayInterval.end,style=r.inkEnds?.[end]??{};return <div data-testid="drawing-interval-ink-end"><strong>{t(end?'区间终点笔触':'区间起点笔触')}</strong>
   <NumberField label="区间收尖距离 px" value={inkTaperDistance(style,curveById(d,path.segments[0].id).width)*250} min={0} max={5000} disabled={disabled} onChange={v=>run(()=>setDisplayIntervalEnd(d,track.id,r.id,end,{taper:v/250}))}/>
   <NumberField label="区间延伸距离 px" value={(style.extension??0)*250} min={0} max={500} disabled={disabled} onChange={v=>run(()=>setDisplayIntervalEnd(d,track.id,r.id,end,{extension:v/250}))}/>
   <p className="drawing-muted">{t(intervalMode(r)==='HIDE'?'笔触作用于缺口两侧的线头；收尖朝向缺口，延伸会伸入缺口。':'只改变区间墨线；重叠部分只保留并集外缘的收尖与延伸。')}</p>
  </div>;})()}
 </div>))}
 </PanelSection>;
}
