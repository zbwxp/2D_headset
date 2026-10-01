import PanelSection from '../shared/PanelSection';
import {curveById,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {depthContext,setDepthOffset,type DepthScope} from '../../domain/drawing/depth';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
export default function DepthControls({d,id,run}:{d:Doc;id:string;run:(fn:()=>Doc)=>void}){
 const c=curveById(d,id),context=depthContext(d,id),value=c.depthOffset??0;
 const set=(value:number,scope:DepthScope=context.scope)=>run(()=>setDepthOffset(d,id,Math.round(value),scope));
 return <PanelSection id="drawing.depth" title="深度偏移" className="assembly-drawing-depth-controls" testId="assembly-drawing-depth-controls">
 <label className="assembly-drawing-field">{t('基准')}<select aria-label={t('深度基准')} value={context.scope} disabled={c.locked} onChange={e=>set(0,e.target.value as DepthScope)}><option value="PARENT">{t('所属笔画 / 直接父级')}</option><option value="LAYER">{t('所属图层')}</option></select></label>
 <NumberField label="深度偏移" value={value} min={context.min} max={context.max} disabled={c.locked} onChange={set}/>
 <div className="assembly-drawing-property-actions"><button disabled={c.locked||context.effective>=context.max} onClick={()=>set(context.effective+1)}>{t('向前 +1')}</button><button disabled={c.locked||context.effective<=context.min} onClick={()=>set(context.effective-1)}>{t('向后 −1')}</button><button disabled={c.locked||value===0} onClick={()=>set(0)}>{t('重置')}</button></div>
 <p className="assembly-drawing-muted">{context.parent?.name} {context.effective!==0?`${context.effective>0?'↑':'↓'} ${context.target.name}`:''}{value!==context.effective?` · ${t('已到达该级边界')}`:''}</p>
 <p className="assembly-drawing-muted">{t('只改变此线的遮挡深度，列表位置与连接保持不变。切换基准会重置偏移。')}</p>
 </PanelSection>;
}
