import {useEditor} from '../../app/store';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function OnCurveInspector(){
 const s=useEditor(),point=s.project.landmarks.find(l=>l.id===s.selectedId);
 if(!point||s.selectedCurveId||s.selectedPatchId||point.placement.kind!=='ON_CURVE')return null;
 const placement=point.placement,owner=placement.role==='canonical'?point:s.project.landmarks.find(l=>l.id===placement.canonicalPointId)!;
 if(owner.placement.kind!=='ON_CURVE'||owner.placement.role!=='canonical')return null;
 return <div className="curve-current" data-testid="on-curve-inspector"><strong>{point.name}</strong><p>定位方式：结构线定位</p><p>宿主结构线：{s.project.curves.find(c=>c.id===placement.hostCurveId)?.name}</p><NumericSlider key={point.id} label="在线位置" min={0} max={1} value={owner.placement.s} snapTargets={[.5]} formatValue={v=>formatNumeric(v*100)+'%'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setOnCurveS(point.id,v)}/></div>;
}
