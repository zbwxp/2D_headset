import {useState,useRef} from 'react';
import {useInspectionCamera} from '../windows/state';
import {useEditor} from '../../app/store';
import {gazeFacing} from '../../domain/eyes/tracking';
import {rotateFrame} from '../../domain/head/frame';
import {uiText as t} from '../i18n';
/** Narrow subscriptions keep camera readouts out of the geometry/render component. */
export default function CameraAngles({onPitch}:{onPitch:(degrees:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null),editing=useRef(false);
 const finish=(apply:boolean)=>{if(!editing.current)return;editing.current=false;const value=Number(draft);if(apply&&draft?.trim()&&Number.isFinite(value))onPitch(Math.max(-90,Math.min(90,value)));setDraft(null);};
 const q=useInspectionCamera(s=>s.quaternion),f=useEditor(s=>s.project.headFrame);
 const world=gazeFacing(q),v=f?rotateFrame(world,f,true):world;
 const horizontal=Math.hypot(v[0],v[2]),yaw=horizontal<1e-10?0:Math.atan2(v[0],v[2])*180/Math.PI,pitch=Math.atan2(v[1],horizontal)*180/Math.PI;
 const format=(n:number)=>{const r=Math.round(n*10)/10;return (r>0?'+':'')+r.toFixed(1)+'°';};
 return <div className="inspection-camera-angles" data-testid="inspection-camera-angles" title={t('头部局部坐标；俯仰正值为俯视，负值为仰视')}><span>Yaw {format(yaw)}</span><span>{t('俯仰')} {draft===null?<button aria-label={t('设置俯仰角')} onClick={()=>{editing.current=true;setDraft((Math.round(pitch*10)/10).toString());}}>{format(pitch)}</button>:<input autoFocus aria-label={t('俯仰角数值')} type="number" min={-90} max={90} step="any" value={draft} onFocus={e=>e.target.select()} onChange={e=>setDraft(e.target.value)} onBlur={()=>finish(true)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}}}/>}</span></div>;
}
