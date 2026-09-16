import {useState} from 'react';
import {useEditor} from '../../app/store';
import FloatingPanel from '../shared/FloatingPanel';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function AddView(){
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[yaw,setYaw]=useState(0),[pitch,setPitch]=useState(0);
 return <><button onClick={()=>setOpen(true)}>＋ 添加视角</button>{open&&<FloatingPanel id="add-view" title="添加正交视角" onClose={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();if(useEditor.getState().addView(name,yaw,pitch)){setOpen(false);setName('');}}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
 <label>视角名称<input aria-label="视角名称" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="可留空，按角度命名"/></label>
 <NumericSlider label="水平偏转角" min={-180} max={180} value={yaw} onChange={setYaw} formatValue={v=>formatNumeric(v)+'°'}/>
 <NumericSlider label="俯仰角" min={-90} max={90} value={pitch} onChange={setPitch} formatValue={v=>formatNumeric(v)+'°'}/>
 <small>水平：负为左、正为右。俯仰：正为俯视、负为仰视。双击数值可直接输入。</small>
 <div className="floating-actions"><button type="button" onClick={()=>setOpen(false)}>取消</button><button type="submit">添加并切换</button></div>
 </form></FloatingPanel>}</>;
}
