import {useState} from 'react';
import PanelSection from '../shared/PanelSection';
import {curveById,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {setMirrorEditingEnabled,removeMirrorCurvePair,changeMirrorCurvePair,setMirrorAxisNodes} from '../../domain/drawing/mirrorCommands';
import {setMirrorAxis} from '../../domain/drawing/commands';
import {NumberField} from './Field';
import {pairSelectedMirrorCurves} from './mirrorSelection';
import {uiText as t} from '../i18n';
export default function MirrorEditingControls({d,ids,nodeId,run}:{d:Doc;ids:string[];nodeId?:string;run:(f:()=>Doc)=>void}){
 const [reverse,setReverse]=useState(false),config=d.mirrorEditing,pairs=config?.curvePairs??[],selected=pairs.filter(p=>ids.includes(p.a)||ids.includes(p.b)),eligible=ids.length>=2,alreadyPaired=ids.length===2&&selected.some(pair=>ids.includes(pair.a)&&ids.includes(pair.b)&&pair.a!==pair.b);
 return <PanelSection id="drawing.mirror-editing" title="持续镜像" testId="drawing-mirror-controls">
 <label className="drawing-field">{t('镜像编辑开关')}<input type="checkbox" aria-label={t('镜像编辑开关')} checked={!!config?.enabled} onChange={e=>run(()=>setMirrorEditingEnabled(d,e.target.checked))}/></label>
 <small>{pairs.length} {t('组曲线配对')} · {t('编辑对应')}</small>
 <NumberField label="镜像轴 X" value={d.mirrorAxisX??0} onChange={x=>run(()=>setMirrorAxis(d,x))}/>
 <p className="drawing-muted">{t('开：把本次节点和柄的改变量镜像到未选中的对应侧。关：自由编辑。两侧都选中时按各自操作，不固定轴上节点。')}</p>
 {selected.map(pair=><div key={pair.id} data-testid="drawing-mirror-pair" data-pair-id={pair.id}><small>{curveById(d,pair.a)?.name} ↔ {curveById(d,pair.b)?.name}</small><label className="drawing-field">{t('配对方向')}<select value={pair.reverse?'reverse':'same'} onChange={e=>run(()=>changeMirrorCurvePair(d,pair.id,{reverse:e.target.value==='reverse'}))}><option value="same">P0 ↔ P0 · P1 ↔ P1</option><option value="reverse">P0 ↔ P1 · P1 ↔ P0</option></select></label><button onClick={()=>run(()=>removeMirrorCurvePair(d,pair.id))}>{t('解除镜像配对')}</button></div>)}
 {eligible&&!alreadyPaired&&<>{ids.length===2&&<label className="drawing-field">{t('反向端点配对')}<input type="checkbox" checked={reverse} onChange={e=>setReverse(e.target.checked)}/></label>}{selected.length>0&&<p className="drawing-muted">{t('此操作替换所选曲线已有的镜像对应；不会改变曲线位置。')}</p>}<button data-testid="drawing-mirror-pair-selection" onClick={()=>run(()=>pairSelectedMirrorCurves(d,ids,reverse))}>{t(selected.length?'替换所选镜像对应':'建立所选镜像对应')}</button></>}
 {!selected.length&&!eligible&&<p className="drawing-muted">{t('原位复制后按镜像轴移到对侧，再选源笔画与副本建立对应。多段笔画只按唯一精确镜像匹配。')}</p>}
 {nodeId&&<label className="drawing-field">{t('轴节点标记（不固定位置）')}<input type="checkbox" checked={!!config?.axisNodeIds?.includes(nodeId)} onChange={e=>run(()=>setMirrorAxisNodes(d,e.target.checked?[...new Set([...(config?.axisNodeIds??[]),nodeId])]:(config?.axisNodeIds??[]).filter(id=>id!==nodeId)))}/></label>}
 </PanelSection>;
}
