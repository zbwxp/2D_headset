import {useDrawingWorkspace} from './workspace';
import PanelSection from '../shared/PanelSection';
import {useRef} from 'react';
import {objectById,MAX_CONTOUR_MIST_DENSITY,type ContourMist,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {setContourMist,inkEdgeStyle} from '../../domain/drawing/mist';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t} from '../i18n';
export default function MistControls({d,ids,run,preview}:{d:Doc;ids:string[];run:(f:()=>Doc)=>void;preview:(d:Doc|null)=>void}){
 const {editor:useEditor}=useDrawingWorkspace();
 const base=useRef<Doc|null>(null),next=useRef<Doc|null>(null),objects=ids.map(id=>objectById(d,id)).filter(o=>o&&'width' in o);
 if(!objects.length)return null;
 const style=inkEdgeStyle(objects[0].mist),enabled=objects.every(o=>o.mist?.enabled),mixed=objects.some(o=>JSON.stringify(inkEdgeStyle(o.mist))!==JSON.stringify(style)),disabled=objects.some(o=>o.locked);
 const end=()=>{const n=next.current,b=base.current;next.current=null;base.current=null;preview(null);if(n&&useEditor.getState().project.drawing===b)run(()=>n);};
 const change=(v:Partial<ContourMist>)=>{const n=setContourMist(base.current??d,ids,v);next.current=n;preview(n);};
 const edit={onEditStart:()=>{base.current=useEditor.getState().project.drawing!;next.current=null;},onEditEnd:end,onUndo:()=>useEditor.getState().undo(),onRedo:()=>useEditor.getState().redo()};
 return <PanelSection id="drawing.ink-edge" title="像素笔触" className="drawing-mist-controls" testId="drawing-mist-controls">
  <label className="drawing-check"><input aria-label={t('像素笔触')} type="checkbox" checked={enabled} ref={el=>{if(el)el.indeterminate=!enabled&&objects.some(o=>o.mist?.enabled);}} disabled={disabled} onChange={e=>run(()=>setContourMist(d,ids,{enabled:e.target.checked}))}/>{t('像素笔触')}</label>
  {objects.some(o=>o.mist?.enabled)&&<>
   {mixed&&<small>{t('多种设置；调整将统一所选线条的对应参数。')}</small>}
   <NumericSlider label="软边宽度" value={style.width} min={.25/250} max={3/250} inputScale={250} formatValue={x=>(x*250).toFixed(2)+' px'} step={.05/250} disabled={disabled} onChange={width=>change({width})} {...edit}/>
   <NumericSlider label="笔触强度" value={style.density} min={0} max={MAX_CONTOUR_MIST_DENSITY} snapTargets={[1]} inputScale={100} formatValue={x=>Math.round(x*100)+'%'} step={.01} disabled={disabled} onChange={density=>change({density})} {...edit}/>
   <p className="drawing-muted">{t('仅柔化墨线边缘，保留实心与尖端；不产生雾圈或颗粒。')}</p>
  </>}
 </PanelSection>;
}
