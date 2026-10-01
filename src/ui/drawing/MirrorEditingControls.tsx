import {useState} from 'react';
import PanelSection from '../shared/PanelSection';
import {curveById,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {setMirrorEditingEnabled,addMirrorCurvePair,removeMirrorCurvePair,changeMirrorCurvePair,setMirrorAxisNodes} from '../../domain/drawing/mirrorCommands';
import {setMirrorAxis} from '../../domain/drawing/commands';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
export default function MirrorEditingControls({d,ids,nodeId,run}:{d:Doc;ids:string[];nodeId?:string;run:(f:()=>Doc)=>void}){
 const [reverse,setReverse]=useState(false),config=d.mirrorEditing,pairs=config?.curvePairs??[],selected=pairs.filter(p=>ids.includes(p.a)||ids.includes(p.b)),eligible=ids.length===2&&ids.every(id=>!pairs.some(p=>p.a===id||p.b===id));
 return <PanelSection id="drawing.mirror-editing" title="持续镜像" testId="drawing-mirror-controls">
 <label className="drawing-field">{t('镜像编辑开关')}<input type="checkbox" aria-label={t('镜像编辑开关')} checked={!!config?.enabled} onChange={e=>run(()=>setMirrorEditingEnabled(d,e.target.checked))}/></label>
 <small>{pairs.length} {t('组曲线配对')} · {t('几何约束')}</small>
 <NumberField label="镜像轴 X" value={d.mirrorAxisX??0} disabled={!!config?.enabled} onChange={x=>run(()=>setMirrorAxis(d,x))}/>
 <p className="drawing-muted">{t('节点与控制柄双向镜像；中心约束固定在轴上。关闭后可独立编辑，再开启只校验，不覆盖任意一侧。')}</p>
 {selected.map(pair=><div key={pair.id} data-testid="drawing-mirror-pair" data-pair-id={pair.id}><small>{curveById(d,pair.a)?.name} ↔ {curveById(d,pair.b)?.name}</small><label className="drawing-field">{t('配对方向')}<select value={pair.reverse?'reverse':'same'} onChange={e=>run(()=>changeMirrorCurvePair(d,pair.id,{reverse:e.target.value==='reverse'}))}><option value="same">P0 ↔ P0 · P1 ↔ P1</option><option value="reverse">P0 ↔ P1 · P1 ↔ P0</option></select></label><button onClick={()=>run(()=>removeMirrorCurvePair(d,pair.id))}>{t('解除镜像配对')}</button></div>)}
 {eligible&&<><label className="drawing-field">{t('反向端点配对')}<input type="checkbox" checked={reverse} onChange={e=>setReverse(e.target.checked)}/></label><button onClick={()=>run(()=>addMirrorCurvePair(d,ids[0],ids[1],reverse))}>{t('建立所选曲线镜像配对')}</button></>}
 {!selected.length&&!eligible&&<p className="drawing-muted">{t('选择一对曲线可建立或检查配对。配对支持反向与轴上自对称曲线。')}</p>}
 {nodeId&&<label className="drawing-field">{t('此节点固定镜像轴')}<input type="checkbox" checked={!!config?.axisNodeIds?.includes(nodeId)} onChange={e=>run(()=>setMirrorAxisNodes(d,e.target.checked?[...new Set([...(config?.axisNodeIds??[]),nodeId])]:(config?.axisNodeIds??[]).filter(id=>id!==nodeId)))}/></label>}
 </PanelSection>;
}
