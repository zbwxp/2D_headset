import {useState} from 'react';
import {curveById,layerFor,type DrawingDocument as Doc,type StrokeDisplayIntervals,type TerminusJoinBrush} from '../../domain/drawing/model';
import {displayPath} from '../../domain/drawing/displayIntervals';
import {adoptDisplayRoute,detachDisplayRoute} from '../../domain/drawing/displayRouteAuthoring';
import {displayRouteInkSupport} from '../../domain/drawing/displayRouteInk';
import {compileDisplayRouteBrushes} from '../../domain/drawing/displayRouteBrush';
import {resolveDisplayRoute} from '../../domain/drawing/displayRoutes';
import {setEndpointLinkBrush} from '../../domain/drawing/endpointRelationAuthoring';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
/** One selected interval track and one existing, explicitly chosen geometric link.
 * No branch guessing, global stroke merge or fill boundary change. */
export default function DisplayRouteControls({d,track,disabled,run}:{d:Doc;track:StrokeDisplayIntervals;disabled:boolean;run:(f:()=>Doc)=>void}){
 const [chosen,setChosen]=useState(''),[kind,setKind]=useState<TerminusJoinBrush['kind']>('SHARP'),[distance,setDistance]=useState(.04);
 const path=displayPath(d,track.anchor.id),ids=new Set(path.segments.map(u=>u.id)),links=(d.endpointLinks??[]).filter(l=>ids.has(l.a.curveId)||ids.has(l.b.curveId)),available=links.filter(l=>!track.displayRoute?.throughLinkIds.includes(l.id)),link=available.find(l=>l.id===chosen)??available[0];
 const describe=(id:string)=>{const c=curveById(d,id);return `${layerFor(d,id)?.name??''} / ${c.name}`;};
 const brush=():TerminusJoinBrush=>kind==='ARC'?{kind,trimDistance:distance}:{kind};
 const diagnostics=track.displayRoute?[...displayRouteInkSupport(d,track.displayRoute),...compileDisplayRouteBrushes(d,resolveDisplayRoute(d,track.displayRoute)).diagnostics.filter(x=>x.severity==='warning').map(x=>x.message)]:[];
 const changeBrush=(linkId:string,value:TerminusJoinBrush)=>run(()=>setEndpointLinkBrush(d,linkId,value));
 return <div className="drawing-route-controls" data-testid="drawing-route-controls">
 <strong>{t('贯通显示路径')}</strong>
 {track.displayRoute?<><p className="drawing-muted">{t('区间沿明确联动贯通；源笔画、图层与填充边界各自保留。')}</p>{track.displayRoute.throughLinkIds.map(id=>{const l=d.endpointLinks!.find(l=>l.id===id)!,b=l.joinBrush??{kind:'SHARP' as const};return <div key={id}><small>{describe(l.a.curveId)} ↔ {describe(l.b.curveId)}</small><label className="drawing-field">{t('末端接笔')}<select disabled={disabled} value={b.kind} onChange={e=>changeBrush(id,e.target.value==='ARC'?{kind:'ARC',trimDistance:distance}:{kind:e.target.value as 'SHARP'|'SMOOTH'})}><option value="SHARP">{t('锐角')}</option><option value="SMOOTH">{t('平滑接笔')}</option><option value="ARC">{t('圆弧')}</option></select></label>{b.kind==='ARC'&&<NumberField label="接笔影响距离 px" value={b.trimDistance*250} min={.01} max={500} disabled={disabled} onChange={v=>changeBrush(id,{kind:'ARC',trimDistance:v/250})}/>}</div>;})}<button data-testid="detach-display-route" disabled={disabled} onClick={()=>run(()=>detachDisplayRoute(d,track.id).document)}>{t('解除显示贯通')}</button></>:<p className="drawing-muted">{t('先建立显示区间，再选择真实端点联动。贯通会保留原可见范围，可整步撤销。')}</p>}
 {available.length>0&&<><label className="drawing-field">{t('选择端点联动')}<select disabled={disabled} value={link?.id??''} onChange={e=>setChosen(e.target.value)}>{available.map(l=><option key={l.id} value={l.id}>{describe(l.a.curveId)} ↔ {describe(l.b.curveId)}</option>)}</select></label><label className="drawing-field">{t('末端接笔')}<select value={kind} disabled={disabled} onChange={e=>setKind(e.target.value as TerminusJoinBrush['kind'])}><option value="SHARP">{t('锐角')}</option><option value="SMOOTH">{t('已对齐平滑')}</option><option value="ARC">{t('圆弧')}</option></select></label>{kind==='ARC'&&<NumberField label="接笔影响距离 px" value={distance*250} min={.01} max={500} disabled={disabled} onChange={v=>setDistance(v/250)}/>}<button data-testid="adopt-display-route" disabled={disabled||!link} onClick={()=>run(()=>adoptDisplayRoute({...d,endpointLinks:d.endpointLinks!.map(l=>l.id===link.id?{...l,joinBrush:brush()}:l)},track.id,link.id).document)}>{t('贯通这条显示路径')}</button></>}
 {!links.length&&<p className="drawing-muted">{t('当前路径没有端点联动；请先用“端点联动”连接需要续接的两条曲线。')}</p>}
 {diagnostics.map((message,i)=><p className="drawing-muted" role="status" key={i}>{message}</p>)}
 </div>;
}
