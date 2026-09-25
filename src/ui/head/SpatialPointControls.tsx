import {useEditor} from '../../app/store';
import {pointPosition} from '../../domain/geometry/evaluation';
import {toRelative} from '../../domain/head/frame';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
/** Spatial coordinates in HeadFrame radii, using the existing constrained move command. */
export default function SpatialPointControls({id}:{id:string}){
 const s=useEditor(),l=s.project.landmarks.find(l=>l.id===id);
 if(!l||(l.placement.kind!=='EYE_LOCAL'&&l.placement.kind!=='FRAME_RELATIVE'&&l.placement.kind!=='WORLD'))return null;
 const position=toRelative(s.project,pointPosition(s.project,id));
 const restore=(redo:boolean)=>{const store=useEditor.getState();redo?store.redo():store.undo();const next=useEditor.getState();if(next.project.landmarks.some(l=>l.id===id))next.selectLandmark(id);};
 return <div data-testid="spatial-point-coordinates">{(['X','Y','Z'] as const).map((axis,i)=><NumericSlider key={axis} label={axis} min={-2} max={2} value={position[i]} disabled={i===0&&l.type==='CENTERLINE'} snapTargets={[0]} formatValue={v=>formatNumeric(v)+' R'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onUndo={()=>restore(false)} onRedo={()=>restore(true)} onChange={value=>{const current=useEditor.getState(),q=toRelative(current.project,pointPosition(current.project,id));current.nudgePoint(id,i as 0|1|2,value-q[i]);}}/>)}</div>;
}
