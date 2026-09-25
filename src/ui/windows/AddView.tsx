import type {LandmarkView} from '../../domain/landmarks/model';
import {viewIsLocked} from '../../domain/landmarks/model';
import {LockKeyhole} from 'lucide-react';
import {uiText} from "../i18n";
import {useState} from 'react';
import {useEditor} from '../../app/store';
import FloatingPanel from '../shared/FloatingPanel';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function AddView({view,active=false,onSelect}:{view?:LandmarkView;active?:boolean;onSelect?:(id:string)=>void}){
 const canDelete=useEditor(s=>s.project.views.length>1);
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[yaw,setYaw]=useState(0),[pitch,setPitch]=useState(0);
 const select=(id:string)=>{useEditor.getState().selectView(id);onSelect?.(id);};
 const launch=()=>{if(view){select(view.id);setName(view.label);const [x,y,z]=view.camera.position.map((n,i)=>n-view.camera.target[i]);setYaw(Math.atan2(x,z)*180/Math.PI);setPitch(Math.atan2(y,Math.hypot(x,z))*180/Math.PI);}setOpen(true);};
 return <><button className={active?'active':''} onClick={()=>view?select(view.id):launch()} onDoubleClick={view?launch:undefined}>{view?uiText(view.label):uiText("＋ 添加视角")}{view&&viewIsLocked(useEditor.getState().project,view.id)&&<LockKeyhole size={12}/>}</button>{open&&<FloatingPanel id="add-view" title={uiText(view?"编辑视角":"添加正交视角")} onClose={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();if(view?useEditor.getState().updateView(view.id,name,yaw,pitch):useEditor.getState().addView(name,yaw,pitch)){onSelect?.(useEditor.getState().viewId);setOpen(false);setName('');}}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
 <label>{uiText("视角名称")}<input aria-label={uiText("视角名称")} maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder={uiText("可留空，按角度命名")}/></label>
 <NumericSlider label={uiText("水平偏转角")} min={-180} max={180} value={yaw} onChange={setYaw} formatValue={v=>formatNumeric(v)+'°'}/>
 <NumericSlider label={uiText("俯仰角")} min={-90} max={90} value={pitch} onChange={setPitch} formatValue={v=>formatNumeric(v)+'°'}/>
 <small>{uiText("水平：负为左、正为右。俯仰：正为俯视、负为仰视。双击数值可直接输入。")}</small>
 <div className="floating-actions">{view&&<button type="button" disabled={!canDelete} title={!canDelete?uiText("至少保留一个视角"):undefined} onClick={()=>{useEditor.getState().deleteView(view.id);setOpen(false);}}>{uiText("删除视角")}</button>}<button type="button" onClick={()=>setOpen(false)}>{uiText("取消")}</button><button type="submit">{uiText(view?"保存修改":"添加并切换")}</button></div>
 </form></FloatingPanel>}</>;
}
