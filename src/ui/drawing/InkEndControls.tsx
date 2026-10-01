import PanelSection from '../shared/PanelSection';
import {boundEndpoint,curveById,nodeAt,inkTaperDistance,type DrawingDocument as Doc,type InkEnds} from '../../domain/drawing/model';
import {setInkEnd,enableInteriorInkEnd} from '../../domain/drawing/paintCommands';
import {strokeFor,strokePaths} from '../../domain/drawing/strokes';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {arcField,defaultTaperDistances,extendedInk,offsetGeometry,strokeEnds,inkEndpointInfo} from '../../domain/drawing/appearance';
import type {DrawingSelection} from './session';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';

export default function InkEndControls({d,id,selection,run,choose}:{d:Doc;id:string;selection:DrawingSelection;run:(f:()=>Doc)=>void;choose:(s:DrawingSelection)=>void}){
 const curve=curveById(d,id),offset=d.offsets.find(o=>o.id===id),stroke=curve?strokePaths(strokeFor(d,id)).find(p=>p.segments.some(x=>x.id===id)):undefined;
 if(!curve&&!offset)return null;
 const pathEnds=stroke?strokeEnds(d,stroke).map(e=>({id:e.endpoint.curveId,end:e.endpoint.end,style:e.style})):[{id,end:0 as const,style:offset!.inkEnds?.[0]??{}},{id,end:1 as const,style:offset!.inkEnds?.[1]??{}}];
 const outer=pathEnds.filter(e=>!curve||!boundEndpoint(d,{curveId:e.id,end:e.end}));
 const inner=curve&&selection.ids.length===1?([0,1] as const).filter(end=>!outer.some(e=>e.id===id&&e.end===end)).map(end=>({id,end,style:curve.inkEnds?.[end]??{}})):[];
 const ends=[...outer,...inner],selected=ends.find(e=>selection.inkEnd?e.id===selection.inkEnd.id&&e.end===selection.inkEnd.end:!!selection.node&&e.id===id&&nodeAt(d,{curveId:e.id,end:e.end}).id===selection.node);
 const info=selected?inkEndpointInfo(d,selected.id,selected.end):undefined;
 const g=stroke?derivedUses(d,stroke.segments,stroke.closed):offsetGeometry(d,offset!),style=stroke?curveById(d,stroke.segments[0].id):offset!,index=selected?pathEnds.findIndex(e=>e.id===selected.id&&e.end===selected.end):-1;
 const lengths=defaultTaperDistances(style.profile??'UNIFORM',!!style.profileReverse,arcField(extendedInk(g.shapes,(pathEnds.length?pathEnds.map(e=>e.style):[{},{}]) as InkEnds).shapes).total);
 const obj=selected?(curveById(d,selected.id)??offset):undefined,disabled=!obj||obj.locked||!obj.visible||!!g.error;
 return <PanelSection id="drawing.ink-ends" title="笔触端点" className="drawing-ink-ends" testId="drawing-ink-ends">
 <div className="drawing-property-actions">{ends.map((e,i)=><button key={`${e.id}:${e.end}`} aria-pressed={e===selected} onClick={()=>choose(curve?{ids:[e.id],inkEnd:{id:e.id,end:e.end}}:{ids:[],paint:id,inkEnd:{id,end:e.end}})}>{i<outer.length?t(pathEnds.findIndex(x=>x.id===e.id&&x.end===e.end)===1?'笔触终点':'笔触起点'):`P${e.end} ${t('内部端点笔触')}`}</button>)}</div>
 {!!stroke?.closed&&!inner.length&&<p className="drawing-muted">{t('选择一条具体曲线，再设置它的 P0 / P1 端点笔触。')}</p>}
 {selected&&info?.interior&&<>
  <p className="drawing-muted">{curveById(d,selected.id).name} · P{selected.end}</p>
  <label className="drawing-check"><input type="checkbox" aria-label={t('启用内部端点笔触')} checked={info.enabled} disabled={disabled} onChange={e=>run(()=>enableInteriorInkEnd(d,selected.id,selected.end,e.target.checked))}/>{t('启用内部端点笔触')}</label>
  <p className="drawing-muted">{t('默认等宽连接；只改变所选曲线这一端的墨线，不移动共享点或改变填充。')}</p>
 </>}
 {selected&&info?.enabled&&<>
 <NumberField label="端点收尖距离 px" value={inkTaperDistance(selected.style,style.width,index<0?0:lengths[index])*250} min={0} max={5000} disabled={disabled} onChange={v=>run(()=>setInkEnd(d,selected.id,selected.end,{taper:v/250}))}/>
 {selected.style.taperWidthScale!==undefined&&<p className="drawing-muted">{t('收尖随线宽变化；短笔画自动缩短收尖距离。')}</p>}
 <NumberField label="笔触延伸距离 px" value={(selected.style.extension??0)*250} min={0} max={500} disabled={disabled} onChange={v=>run(()=>setInkEnd(d,selected.id,selected.end,{extension:v/250}))}/>
 <button disabled={disabled} onClick={()=>run(()=>setInkEnd(d,selected.id,selected.end,{taper:0}))}>{t('取消收尖')}</button>
 <p className="drawing-muted">{t(info.interior?'收尖距离等于延伸距离时，延伸部分从原线宽收至尖端；圆弧接笔沿可见源线的切线延伸。':'沿控制柄反方向延伸墨线，保持原曲线和绑定点不变。')}</p>
 </>}
 </PanelSection>;
}
