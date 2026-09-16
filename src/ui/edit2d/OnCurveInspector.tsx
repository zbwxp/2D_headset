import {isAnalytic} from '../../domain/curves/model';
import {count} from '../../domain/geometry/diagnostics';
import {useEditor} from '../../app/store';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function OnCurveInspector({loomis=false}:{loomis?:boolean}){
 count('renderOnCurveInspector');
 const s=useEditor(),point=s.project.landmarks.find(l=>l.id===s.selectedId);
 if(!point||s.selectedCurveId||s.selectedPatchId||point.placement.kind!=='ON_CURVE')return null;
 const host=s.project.curves.find(c=>c.id===(point.placement.kind==='ON_CURVE'?point.placement.hostCurveId:''));
 if(!!(host&&isAnalytic(host))!==loomis)return null;
 const placement=point.placement,owner=placement.role==='canonical'?point:s.project.landmarks.find(l=>l.id===placement.canonicalPointId)!;
 if(owner.placement.kind!=='ON_CURVE'||owner.placement.role!=='canonical')return null;
 if(owner.placement.ringEndpoint)return <div><small>逻辑 Ring 共享中线端点 · 随 Ring Offset 移动</small><button onClick={()=>host&&s.selectCurve(host.id)}>Host Ring →</button></div>;
 return <div className="curve-current" data-testid="on-curve-inspector"><strong>{point.name}</strong><p>定位方式：结构线定位</p><p>宿主结构线：{s.project.curves.find(c=>c.id===placement.hostCurveId)?.name}{loomis&&host&&<button onClick={()=>s.selectCurve(host.id)} aria-label="跳转宿主结构线">→</button>}</p><NumericSlider key={point.id} label="在线位置" min={0} max={1} value={owner.placement.s} snapTargets={[.5]} inputScale={100} formatValue={v=>formatNumeric(v*100)+'%'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setOnCurveS(point.id,v)}/></div>;
}
