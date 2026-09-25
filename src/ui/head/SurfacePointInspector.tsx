import {uiText} from "../i18n";
import {useRef} from 'react';
import {surfaceHeightDirection} from './surfaceHeight';
import {useEditor} from '../../app/store';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function SurfacePointInspector({fieldsOnly=false}:{fieldsOnly?:boolean}){
 const depthSide=useRef(1);
 const s=useEditor(),p=s.project.landmarks.find(l=>l.id===s.selectedId);if(!p||s.selectedCurveId||s.selectedPatchId||(p.placement.kind!=='ON_LOOMIS_SURFACE'&&p.placement.kind!=='ON_SECTION_CAP'&&p.placement.kind!=='ON_PATCH'))return null;
 if(p.placement.kind==='ON_PATCH'){const q=p.placement;return <div><small>Host: {s.project.patches?.find(x=>x.id===q.hostPatchId)?.name}</small>{(['u','v'] as const).map(axis=><NumericSlider key={axis} label={uiText('曲面 '+axis.toUpperCase())} min={0} max={1} value={q[axis]} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={value=>s.setPatchPoint(p.id,axis==='u'?value:q.u,axis==='v'?value:q.v)}/>)}</div>;}
 if(p.placement.kind==='ON_SECTION_CAP'){
 const q=p.placement,cap=s.project.loomisCaps?.find(c=>c.id===q.hostSurfaceId),session={onEditStart:()=>s.beginEdit(true),onEditEnd:s.endEdit};
 return <div data-testid="cap-point-inspector">{!fieldsOnly&&<strong>{p.name}</strong>}{!fieldsOnly&&<button onClick={()=>cap&&s.selectCurve(cap.hostSectionCurveId)}>{uiText("Host:")}{cap?.name} →</button>}<NumericSlider label={uiText("Cap U")} disabled={Math.abs(q.v)>=1} min={-Math.sqrt(Math.max(0,1-q.v*q.v))} max={Math.sqrt(Math.max(0,1-q.v*q.v))} value={q.u} formatValue={formatNumeric} {...session} onChange={u=>s.setCapPoint(p.id,u,q.v)}/><NumericSlider label={uiText("Cap V")} disabled={Math.abs(q.u)>=1} min={-Math.sqrt(Math.max(0,1-q.u*q.u))} max={Math.sqrt(Math.max(0,1-q.u*q.u))} value={q.v} formatValue={formatNumeric} {...session} onChange={v=>s.setCapPoint(p.id,q.u,v)}/></div>;
 }
 const d=p.placement.direction,center=p.type==='CENTERLINE',horizontal=Math.atan2(d[0],d[2])*180/Math.PI,vertical=Math.asin(Math.max(-1,Math.min(1,d[1])))*180/Math.PI;
 if(Math.abs(d[2])>1e-10)depthSide.current=d[2]<0?-1:1;
 const radiusY=s.project.headFrame!.radiusY,heightLimit=radiusY*Math.sqrt(Math.max(0,1-d[0]*d[0]));
 const change=(h:number,v:number)=>{h*=Math.PI/180;v*=Math.PI/180;s.setSurfacePoint(p.id,[center?0:Math.sin(h)*Math.cos(v),Math.sin(v),Math.cos(h)*Math.cos(v)]);};
 const session={onEditStart:()=>s.beginEdit(true),onEditEnd:s.endEdit};
 return <div data-testid="surface-point-inspector">{!fieldsOnly&&<strong>{p.name}</strong>}<p>{uiText("Y 高度相对椭球中心 · 横向固定")}</p>
 {center?<NumericSlider label={uiText("中线球面角度")} min={-180} max={180} value={Math.atan2(d[1],d[2])*180/Math.PI} formatValue={v=>formatNumeric(v)+'°'} {...session} onChange={v=>s.setSurfacePoint(p.id,[0,Math.sin(v*Math.PI/180),Math.cos(v*Math.PI/180)])}/>:<><NumericSlider label={uiText("球面 Horizontal")} min={-180} max={180} value={horizontal} formatValue={v=>formatNumeric(v)+'°'} {...session} onChange={v=>change(v,vertical)}/><NumericSlider label={uiText("球面 Vertical")} min={-heightLimit} max={heightLimit} value={d[1]*radiusY} disabled={heightLimit<1e-10} formatValue={v=>formatNumeric(v)} {...session} onChange={v=>s.setSurfacePoint(p.id,surfaceHeightDirection(d,v/radiusY,depthSide.current))}/></>}
 </div>;
}
