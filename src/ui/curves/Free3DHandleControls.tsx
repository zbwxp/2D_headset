import {useEditor} from '../../app/store';
import {canonical,isCenterCurve} from '../../domain/curves/geometry';
import {isDerived,isFree3DShape} from '../../domain/curves/model';
import type {Vec3} from '../../domain/project/types';
import {uiText} from '../i18n';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';

const handles=[['startHandleOffset','起点控制柄'],['endHandleOffset','终点控制柄']] as const;
const axes=['X','Y','Z'] as const;

export default function Free3DHandleControls({id}:{id:string}){
 const p=useEditor(s=>s.project),c=p.curves.find(c=>c.id===id);
 if(!c||isDerived(c))return null;
 const base=canonical(p,c),shape=base.shape;
 if(!isFree3DShape(shape))return null;
 const center=isCenterCurve(p,c);
 const restoreSelection=(redo:boolean)=>{
  const s=useEditor.getState();redo?s.redo():s.undo();
  const next=useEditor.getState();if(next.project.curves.some(c=>c.id===id))next.selectCurve(id);
 };
 const session={onEditStart:()=>useEditor.getState().beginEdit(true),onEditEnd:()=>useEditor.getState().endEdit(),onUndo:()=>restoreSelection(false),onRedo:()=>restoreSelection(true)};
 return <div className="free3d-handle-controls" data-testid="free3d-inspector">
  <small>{uiText('相对各自端点 · 模型 XYZ 轴 · 以头框各轴半径为单位')}</small>
  {handles.map(([key,label])=><fieldset key={key} data-testid={key}>
   <legend>{uiText(label)}</legend>
   {axes.map((axis,i)=>{
    const value=shape[key][i]*(c.role==='mirror'&&i===0?-1:1);
    return <NumericSlider key={axis} label={axis} value={value}
     min={Math.min(-2,Math.floor(value))} max={Math.max(2,Math.ceil(value))} step={.01}
     disabled={center&&i===0} snapTargets={[0]} formatValue={v=>formatNumeric(v)+' R'} {...session}
     onChange={value=>{
      const s=useEditor.getState(),selected=s.project.curves.find(c=>c.id===id);
      if(!selected||isDerived(selected))return;
      const source=canonical(s.project,selected);if(!isFree3DShape(source.shape))return;
      const offset:Vec3=[...source.shape[key]];
      offset[i]=value*(selected.role==='mirror'&&i===0?-1:1);
      if(isCenterCurve(s.project,selected))offset[0]=0;
      s.setCurveShape(source.id,{...source.shape,[key]:offset});
     }}/>;
   })}
  </fieldset>)}
 </div>;
}
