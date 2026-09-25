import {useEffect,useState} from 'react';
import {useEditor} from '../../app/store';
import {armNames,pointId,type ChinArm} from '../../domain/chin/model';
import {chinAttachments,chinArm,chinField} from '../../domain/chin/junction';
import {uiText} from '../i18n';
import NumericSlider from '../shared/NumericSlider';
export function ChinControls(){
 const s=useEditor(),p=s.project,c=p.chinScaffold;if(!c||c.version!==3)return null;
 const attached=chinAttachments(p),diagnostic=chinField(p).diagnostic;
 return <div data-testid="chin-controls" data-ui-keyboard>
 <small data-testid="chin-attachment-count">{uiText('已接入曲线')}：{attached.length}</small>
 {diagnostic&&<p role="status">{uiText(diagnostic)}</p>}
 {(Object.keys(armNames) as ChinArm[]).map(arm=><div key={arm} title={attached.filter(a=>chinArm(p,a.curveId)===arm).map(a=>p.curves.find(c=>c.id===a.curveId)!.name).join(' / ')||uiText('未接入')}>
 <NumericSlider label={uiText(armNames[arm])} min={.01} max={.1} step={.001} value={c.ranges![arm]} formatValue={v=>`${Number(v.toFixed(3))}R`} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setChinRange(arm,v)}/>
 </div>)}
 <details><summary>{uiText('连接信息与位置')}</summary><p>{uiText('所有接入线共用一个下巴点；局部平滑自动求解。')}</p><p>{uiText('影响范围 0.01R–0.1R；左右联动，范围外保留原形。')}</p>{(Object.keys(armNames) as ChinArm[]).map(arm=><p key={arm}>{uiText(armNames[arm])}：{attached.filter(a=>chinArm(p,a.curveId)===arm).map(a=>p.curves.find(c=>c.id===a.curveId)!.name).join(' / ')||uiText('未接入')}</p>)}{(['y','z'] as const).map(key=><NumericSlider key={key} label={uiText(key==='y'?'下巴位置 Y':'下巴位置 Z')} min={-2} max={2} value={c.parameters[key]} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setChinParameter(key,v)}/>)}</details>
 </div>;
}
export default function ChinConstruction(){
 const s=useEditor(),[open,setOpen]=useState(false),chin=s.project.chinScaffold;
 useEffect(()=>{if(s.selection?.id===pointId('CHIN_M'))setOpen(true);else if(s.selection)setOpen(false);},[s.selection,s.selectionTick]);
 if(s.activeModule!=='HEADSET')return null;
 const status=!chin?'未创建':chinAttachments(s.project).length?'自动平滑连接':'待挂接';
 return <section className="construction-panel" data-testid="chin-construction"><button className="section-heading chin-heading" aria-expanded={open} onClick={()=>setOpen(!open)}><span>{open?'▾':'▸'} {uiText('下巴连接点')}</span><small data-testid="chin-status">{uiText(status)}</small></button>{open&&(!chin?<div className="inline-inspector"><p>{uiText('创建一个带局部平滑范围的下巴语义点。')}</p><button onClick={s.createChin}>{uiText('创建下巴连接点')}</button></div>:<div className="inline-inspector"><ChinControls/></div>)}</section>;
}
