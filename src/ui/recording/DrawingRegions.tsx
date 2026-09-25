import type {RecordedCurve,Recording} from '../../domain/recording/model';
import {editDrawingRegion,enableDrawingRegions,removeDrawingRegion} from '../../domain/recording/drawingRegions';
import {uiText as t} from '../i18n';

export default function DrawingRegions({recording,curve,adding,onAdd,commit}:{recording:Recording;curve:RecordedCurve;adding:boolean;onAdd:()=>void;commit:(r:Recording)=>void}){
 const drawing=curve.drawing;
 return <details className="recording-drawing-regions" open data-testid="drawing-regions">
  <summary>{t('绘制区域')} · {drawing?.regions.length??0}</summary>
  <label><input type="checkbox" checked={drawing?.enabled??false} disabled={curve.locked} onChange={e=>commit(enableDrawingRegions(recording,curve.id,e.target.checked))}/>{t('只绘制区域内')}</label>
  <small>{t('仅影响最终预览；区域随曲线跨视角变形。关闭限制时整条绘制。')}</small>
  <button className={adding?'active':''} disabled={curve.locked||!curve.visible} onClick={onAdd}>{t(adding?'取消添加区域':'新增绘制区域')}</button>
  {drawing?.enabled&&!drawing.regions.length&&<small>{t('尚无区域，最终预览不绘制此曲线。请在线上点选起止位置。')}</small>}
  {drawing?.regions.map((region,i)=><div className="recording-drawing-region" data-testid="drawing-region-row" key={region.id}>
   <span>{i+1}</span>
   {(['start','end'] as const).map((field,index)=><label key={field}>{t(index?'终点':'起点')} %
    <input key={`${region.start}:${region.end}`} type="number" min={0} max={100} step={.1} aria-label={`${t(index?'区域终点':'区域起点')} ${i+1}`} defaultValue={+(region[field]*100).toFixed(3)} disabled={curve.locked}
     onBlur={event=>{if(event.target.valueAsNumber===+(region[field]*100).toFixed(3))return;const value=event.target.valueAsNumber/100,next=editDrawingRegion(recording,curve.id,region.id,field==='start'?value:region.start,field==='end'?value:region.end);if(next===recording)event.target.value=String(+(region[field]*100).toFixed(3));else commit(next);}}
     onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){event.currentTarget.value=String(+(region[field]*100).toFixed(3));event.currentTarget.blur();}}}/>
   </label>)}
   <button disabled={curve.locked} aria-label={`${t('删除绘制区域')} ${i+1}`} onClick={()=>commit(removeDrawingRegion(recording,curve.id,region.id))}>×</button>
  </div>)}
  {!!drawing?.regions.length&&<small>{t('百分比表示从曲线起点到终点的参数位置；重叠区域合并绘制。')}</small>}
 </details>;
}
