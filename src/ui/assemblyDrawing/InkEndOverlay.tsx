import {boundEndpoint,curveById,objectVisible,type DrawingDocument as Doc,type InkEnds,type Point2} from '../../domain/drawing/model';
import {strokeFor,strokePaths} from '../../domain/drawing/strokes';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {inkTips,offsetGeometry,strokeEnds,inkEndpointInfo} from '../../domain/drawing/appearance';
import type {DrawingSelection} from './session';
import {uiText as t} from '../i18n';

export default function InkEndOverlay({d,selection,screen,pick}:{d:Doc;selection:DrawingSelection;screen:(p:Point2)=>Point2;pick:(e:React.PointerEvent,id:string,end:0|1)=>void}){
 const seen=new Set<string>(),tips:{id:string;end:0|1;p:Point2}[]=[];
 for(const id of selection.ids){if(!curveById(d,id))continue;const stroke=strokeFor(d,id);if(!stroke||stroke.closed||seen.has(stroke.id))continue;seen.add(stroke.id);for(const path of strokePaths(stroke)){if(path.closed)continue;const ends=strokeEnds(d,path),g=derivedUses(d,path.segments),points=inkTips(g.shapes,ends.map(e=>e.style) as InkEnds);
  points.forEach((tip,i)=>{const e=ends[i].endpoint;if(!boundEndpoint(d,e)&&objectVisible(d,e.curveId)&&curveById(d,e.curveId).inkVisible!==false)tips.push({id:e.curveId,end:e.end,p:tip.point});});}
 }
 for(const id of selection.ids){const curve=curveById(d,id);if(!curve||!objectVisible(d,id)||curve.inkVisible===false)continue;
  for(const end of [0,1] as const){if(!curve.inkEnds?.[end]?.interior&&!(selection.inkEnd?.id===id&&selection.inkEnd.end===end))continue;const info=inkEndpointInfo(d,id,end);if(info?.interior&&info.tip)tips.push({id,end,p:info.tip.point});}
 }
 const offset=d.offsets.find(o=>o.id===selection.paint);if(offset&&objectVisible(d,offset.id))inkTips(offsetGeometry(d,offset).shapes,offset.inkEnds).forEach(tip=>tips.push({id:offset.id,end:tip.end,p:tip.point}));
 return <g data-testid="assembly-drawing-ink-endpoints">{tips.map(tip=>{const p=screen(tip.p),active=selection.inkEnd?.id===tip.id&&selection.inkEnd.end===tip.end,obj=curveById(d,tip.id)??offset!,locked=obj.locked;return <circle key={`${tip.id}:${tip.end}`} data-testid="assembly-drawing-ink-endpoint" data-id={tip.id} data-end={tip.end} cx={p[0]} cy={p[1]} r={6} fill={active?'#dc9840':'#fff4d8'} stroke="#b87926" strokeWidth="1.5" style={{cursor:locked?'default':'pointer'}} pointerEvents={locked?'none':'all'} onPointerDown={e=>pick(e,tip.id,tip.end)}><title>{t('笔触端点')}</title></circle>;})}</g>;
}
