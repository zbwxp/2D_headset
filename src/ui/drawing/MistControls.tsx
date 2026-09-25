import {useRef} from 'react';
import {useEditor} from '../../app/store';
import {objectById,DEFAULT_CONTOUR_MIST,MAX_CONTOUR_MIST_DENSITY,type ContourMist,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {setContourMist} from '../../domain/drawing/mist';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t} from '../i18n';
export default function MistControls({d,ids,run,preview}:{d:Doc;ids:string[];run:(f:()=>Doc)=>void;preview:(d:Doc|null)=>void}){
 const base=useRef<Doc|null>(null),next=useRef<Doc|null>(null),objects=ids.map(id=>objectById(d,id)).filter(o=>o&&'width' in o);
 if(!objects.length)return null;
 const style=objects[0].mist??DEFAULT_CONTOUR_MIST,enabled=objects.every(o=>o.mist?.enabled),mixed=objects.some(o=>JSON.stringify(o.mist??DEFAULT_CONTOUR_MIST)!==JSON.stringify(style)),disabled=objects.some(o=>o.locked);
 const end=()=>{const n=next.current,b=base.current;next.current=null;base.current=null;preview(null);if(n&&useEditor.getState().project.drawing===b)run(()=>n);};
 const change=(v:Partial<ContourMist>)=>{const n=setContourMist(base.current??d,ids,v);next.current=n;preview(n);};
 const edit={onEditStart:()=>{base.current=useEditor.getState().project.drawing!;next.current=null;},onEditEnd:end,onUndo:()=>useEditor.getState().undo(),onRedo:()=>useEditor.getState().redo()};
 return <div className="drawing-mist-controls" data-testid="drawing-mist-controls">
  <label className="drawing-check"><input aria-label={t('轮廓雾化')} type="checkbox" checked={enabled} ref={el=>{if(el)el.indeterminate=!enabled&&objects.some(o=>o.mist?.enabled);}} disabled={disabled} onChange={e=>run(()=>setContourMist(d,ids,{enabled:e.target.checked}))}/>{t('轮廓雾化')}</label>
  {objects.some(o=>o.mist?.enabled)&&<>
   {mixed&&<small>{t('多种设置；调整将统一所选线条的对应参数。')}</small>}
   <NumericSlider label="雾化宽度" value={style.width} min={.25/250} max={60/250} inputScale={250} formatValue={x=>(x*250).toFixed(1)+' px'} step={.25/250} disabled={disabled} onChange={width=>change({width})} {...edit}/>
   <NumericSlider label="雾化浓度" value={style.density} min={0} max={MAX_CONTOUR_MIST_DENSITY} snapTargets={[1]} inputScale={100} formatValue={x=>Math.round(x*100)+'%'} step={.01} disabled={disabled} onChange={density=>change({density})} {...edit}/>
   <p className="drawing-muted">{t('连续灰阶柔边，轻微错位与深浅变化；无颗粒。')}</p>
  </>}
 </div>;
}
