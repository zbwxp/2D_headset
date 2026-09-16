import {useEditor} from '../../app/store';
import {hasLoomisOffset,offsetVector} from '../../domain/head/offset';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function OffsetControls(){const s=useEditor(),l=s.project.landmarks.find(l=>l.id===s.selectedId);if(!l||!hasLoomisOffset(s.project,l))return null;const o=offsetVector(l.placement);return <div data-testid="loomis-offset">{(['X','Y','Z'] as const).map((a,i)=><NumericSlider key={a} label={'Offset '+a} min={-2} max={2} value={o[i]} disabled={i===0&&l.type==='CENTERLINE'} snapTargets={[0]} formatValue={v=>formatNumeric(v)+' R'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setLoomisOffset(l.id,i as 0|1|2,v)}/>)}</div>;}
