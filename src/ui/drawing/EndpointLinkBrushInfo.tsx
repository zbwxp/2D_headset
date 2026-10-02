import {curveById,layerFor,type DrawingDocument,type EndpointLink} from '../../domain/drawing/model';
import {uiText as t} from '../i18n';

/** Stored link appearance, independent of whichever member shares the selected node. */
export default function EndpointLinkBrushInfo({d,link}:{d:DrawingDocument;link:EndpointLink}){
 const aLayer=layerFor(d,link.a.curveId),bLayer=layerFor(d,link.b.curveId),crossLayer=aLayer?.id!==bLayer?.id,brush=link.joinBrush;
 const active=link.throughDisplay===true&&(d.displayIntervals??[]).some(track=>track.displayRoute?.throughLinkIds.includes(link.id));
 const mode=brush?.kind??'SHARP';
 return <div className="drawing-link-brush-info" data-testid="drawing-link-brush-info" data-link-id={link.id}>
  <strong>{t(crossLayer?'跨图层末端笔触':'关联末端笔触')}：{t(brush?(mode==='ARC'?'圆弧接笔':mode==='SMOOTH'?'平滑接笔':'尖点接笔'):'未单独设置')}</strong>
  <p className="drawing-link-participants">{[link.a,link.b].map((e,i)=><span key={i} data-curve-id={e.curveId}>{i?'↔ ':''}{curveById(d,e.curveId).name} · P{e.end}<small>{layerFor(d,e.curveId)?.name}</small></span>)}</p>
  {brush?.kind==='ARC'&&<><span data-testid="drawing-link-trim-distance">{t('裁切距离')}：<b title={String(brush.trimDistance)}>{Number(brush.trimDistance.toPrecision(8))}</b> {t('绘制单位')}</span><p className="drawing-muted">{t('此值是每侧沿曲线的裁切影响距离，不是精确圆半径。圆弧替代端点附近的可见墨线，几何端点位置不变。')}</p></>}
  <small>{t(active?'已用于贯通显示路径':'未用于贯通显示路径；这里只显示已存设置')}{active&&!brush?` · ${t('默认尖点接笔')}`:''}</small>
 </div>;
}
