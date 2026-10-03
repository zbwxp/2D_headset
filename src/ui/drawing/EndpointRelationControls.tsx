import {editable,type DrawingDocument,type EndpointLink} from '../../domain/drawing/model';
import {unlinkEndpoints} from '../../domain/drawing/commands';
import {setEndpointLinkBrush} from '../../domain/drawing/endpointRelationAuthoring';
import {detachDisplayRoute} from '../../domain/drawing/displayRouteAuthoring';
import {NumberField} from './Field';
import EndpointLinkBrushInfo from './EndpointLinkBrushInfo';
import {uiText as t} from '../i18n';

export default function EndpointRelationControls({drawing,link,editable:allowed,run}:{drawing:DrawingDocument;link:EndpointLink;editable:boolean;run:(operation:()=>DrawingDocument)=>void}){
 const tracks=(drawing.displayIntervals??[]).filter(track=>track.displayRoute?.throughLinkIds.includes(link.id)),active=link.throughDisplay===true&&tracks.length>0,disabled=!allowed||[link.a,link.b].some(endpoint=>!editable(drawing,endpoint.curveId)),brush=link.joinBrush;
 return <section className="drawing-endpoint-link-card" data-testid="endpoint-relation-controls" data-link-id={link.id}>
  <EndpointLinkBrushInfo d={drawing} link={link}/>
  <label className="drawing-field">{t('末端接笔')}<select aria-label={t('末端接笔')} disabled={disabled} value={brush?.kind??'POSITION'} onChange={event=>run(()=>setEndpointLinkBrush(drawing,link.id,event.target.value==='POSITION'?undefined:event.target.value==='ARC'?{kind:'ARC',trimDistance:.04}:{kind:event.target.value as 'SHARP'|'SMOOTH'}))}><option value="POSITION">{t('仅绑定')}</option><option value="SHARP">{t('尖点接笔')}</option><option value="SMOOTH" disabled={!active}>{t('平滑接笔')}</option><option value="ARC" disabled={!active}>{t('圆弧接笔')}</option></select></label>
  {brush?.kind==='ARC'&&<NumberField label="接笔影响距离 px" value={brush.trimDistance*250} min={.01} max={500} disabled={disabled||!active} onChange={value=>run(()=>setEndpointLinkBrush(drawing,link.id,{kind:'ARC',trimDistance:value/250}))}/>}
  {!active&&<p className="drawing-muted">{t('此联动目前仅支持位置；平滑和圆弧需要已有有效显示贯通。')}</p>}
  <div className="drawing-property-actions">{tracks.length>0&&<button disabled={disabled} onClick={()=>run(()=>tracks.reduce((document,track)=>detachDisplayRoute(document,track.id).document,drawing))}>{t('解除显示贯通')}</button>}<button disabled={disabled||tracks.length>0} onClick={()=>run(()=>unlinkEndpoints(drawing,link.id))}>{t('解除联动')}</button></div>
 </section>;
}
