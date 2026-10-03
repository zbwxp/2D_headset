import {editable,type DrawingDocument,type EndpointLink} from '../../domain/drawing/model';
import {unlinkEndpoints} from '../../domain/drawing/commands';
import {addDisplayInterval,displayPath} from '../../domain/drawing/displayIntervals';
import DisplayRouteControls from './DisplayRouteControls';
import EndpointLinkBrushInfo from './EndpointLinkBrushInfo';
import {uiText as t} from '../i18n';

export default function EndpointRelationControls({drawing,link,editable:allowed,run}:{drawing:DrawingDocument;link:EndpointLink;editable:boolean;run:(operation:()=>DrawingDocument)=>void}){
 const tracks=(drawing.displayIntervals??[]).filter(track=>displayPath(drawing,track.anchor.id).segments.some(use=>use.id===link.a.curveId||use.id===link.b.curveId)),active=tracks.some(track=>track.displayRoute?.throughLinkIds.includes(link.id)),disabled=!allowed||[link.a,link.b].some(endpoint=>!editable(drawing,endpoint.curveId));
 return <section className="drawing-endpoint-link-card" data-testid="endpoint-relation-controls" data-link-id={link.id}>
  <EndpointLinkBrushInfo d={drawing} link={link}/>
  {!tracks.length&&<button data-testid="endpoint-create-display-interval" disabled={disabled} onClick={()=>run(()=>addDisplayInterval(drawing,link.a.curveId))}>{t('新建显示区间')}</button>}
  {tracks.map(track=><DisplayRouteControls key={track.id} d={drawing} track={track} disabled={disabled} run={run}/>)}
  <div className="drawing-property-actions"><button disabled={disabled||active} onClick={()=>run(()=>unlinkEndpoints(drawing,link.id))}>{t('解除联动')}</button></div>
 </section>;
}
