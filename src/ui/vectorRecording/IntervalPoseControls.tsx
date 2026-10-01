import {inkTaperDistance,type DrawingDocument,type DisplayInterval,type InkEnds} from '../../domain/drawing/model';
import {applyIntervalOverrides,cloneIntervalTracks} from '../../domain/vectorRecording/intervals';
import type {VectorPose} from '../../domain/vectorRecording/model';
import {useLanguage} from '../i18n';

/** Appearance-only pose editing. The canonical DrawingDocument is never committed. */
export default function IntervalPoseControls({drawing,pose,layerIds,onChange}:{drawing:DrawingDocument;pose:VectorPose;layerIds:string[];onChange:(pose:VectorPose)=>void}){
 const zh=useLanguage(s=>s.language)==='zh',t=(a:string,b:string)=>zh?a:b,tracks=applyIntervalOverrides(drawing,pose.intervalOverrides).displayIntervals??[],layers=drawing.layers.filter(l=>layerIds.includes(l.id));
 function change(trackId:string,rangeId:string,patch:Partial<DisplayInterval>){
  const overrides=cloneIntervalTracks(tracks).map(track=>track.id!==trackId?track:{...track,ranges:track.ranges.map(range=>range.id!==rangeId?range:{...range,...patch})});
  onChange({...pose,intervalOverrides:overrides});
 }
 function tip(trackId:string,range:DisplayInterval,end:0|1,pixels:number){
  if(!Number.isFinite(pixels)||pixels<0||pixels>500)return;
  const ends=(range.inkEnds??[{},{}]).map(e=>({...e})) as InkEnds;delete ends[end].taperWidthScale;ends[end].taper=pixels/250;change(trackId,range.id,{inkEnds:ends});
 }
 return <section className="vr-section vr-interval-controls"><h2>{t('显示区间 / ANGLE OVERRIDES','ANGLE INTERVAL OVERRIDES')}</h2><p>{t('在此编辑本角度的显示/隐藏范围与端部笔触；只写入姿态草稿，源稿基础区间不变。边界按源稿路径长度百分比记录，再随 Warp 变形。','Edit this angle’s show/hide ranges and tip styles. Changes belong to the pose draft; base artwork intervals stay unchanged. Boundaries are source-path arc percentages, then transported through Warp.')}</p>
  {!tracks.length&&<p>{t('先在绘制模式为线条创建显示或隐藏区间。','Create a show/hide interval in Drawing first.')}</p>}
  {tracks.filter(track=>!layerIds.length||layers.some(l=>l.items.includes(track.anchor.id))).map(track=>{
   const curve=drawing.curves.find(c=>c.id===track.anchor.id),name=curve?.name??track.anchor.id;
   return <details key={track.id} className="vr-interval-track"><summary>{name}<small>{track.ranges.length}</small></summary>{track.ranges.map((range,index)=><div key={range.id} className="vr-interval-range" data-testid="vr-interval-range" data-range-id={range.id}>
    <label className="vr-checkbox"><input type="checkbox" aria-label={`${name} interval ${index+1} enabled`} checked={pose.intervals[range.id]??range.enabled!==false} onChange={e=>onChange({...pose,intervals:{...pose.intervals,[range.id]:e.target.checked}})}/>{t('区间','Interval')} {index+1}<select aria-label={`${name} interval ${index+1} mode`} value={range.mode??'SHOW'} onChange={e=>change(track.id,range.id,{mode:e.target.value as 'SHOW'|'HIDE'})}><option value="SHOW">{t('显示','Show')}</option><option value="HIDE">{t('隐藏','Hide')}</option></select></label>
    <div className="vr-interval-numbers">{(['start','end'] as const).map(key=><label key={key}>{key==='start'?t('起点 %','Start %'):t('终点 %','End %')}<input data-testid={`vr-interval-${key}`} aria-label={`${name} interval ${index+1} ${key} percent`} type="number" min="0" max="100" step=".1" value={+(range[key]*100).toFixed(4)} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0&&n<=100)change(track.id,range.id,{[key]:n/100});}}/></label>)}</div>
    <div className="vr-interval-numbers">{([0,1] as const).map(end=><label key={end}>{end===0?t('起端收尖 px','Start taper px'):t('末端收尖 px','End taper px')}<input aria-label={`${name} interval ${index+1} ${end===0?'start':'end'} taper pixels`} type="number" min="0" max="500" step=".1" value={+(inkTaperDistance(range.inkEnds?.[end]??{},curve?.width??.01,0)*250).toFixed(3)} onChange={e=>tip(track.id,range,end,Number(e.target.value))}/></label>)}</div>
   </div>)}</details>;
  })}
  <button disabled={!pose.intervalOverrides&&!Object.keys(pose.intervals).length} onClick={()=>{const {intervalOverrides,...rest}=pose;void intervalOverrides;onChange({...rest,intervals:{}});}}>{t('此角度恢复源稿区间（草稿）','Reset this angle to base intervals (draft)')}</button>
 </section>;
}
