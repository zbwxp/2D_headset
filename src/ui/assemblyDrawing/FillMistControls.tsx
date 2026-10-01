import {useDrawingWorkspace} from './workspace';
import PanelSection from '../shared/PanelSection';
import {useRef} from 'react';
import {DEFAULT_FILL_MIST,type DrawingDocument as Doc,type FillRegion,type FillMist} from '../../domain/drawing/model';
import {setFillMist} from '../../domain/drawing/fillMist';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t} from '../i18n';
export default function FillMistControls({d,fill,run,preview}:{d:Doc;fill:FillRegion;run:(f:()=>Doc)=>void;preview:(d:Doc|null)=>void}){
 const {editor:useEditor}=useDrawingWorkspace();
 const base=useRef<Doc|null>(null),next=useRef<Doc|null>(null),style=fill.mist??DEFAULT_FILL_MIST,disabled=fill.locked;
 const end=()=>{const n=next.current,b=base.current;next.current=null;base.current=null;preview(null);if(n&&useEditor.getState().project.drawing===b)run(()=>n);};
 const change=(v:Partial<FillMist>)=>{const n=setFillMist(base.current??d,fill.id,v);next.current=n;preview(n);};
 const edit={onEditStart:()=>{base.current=useEditor.getState().project.drawing!;next.current=null;},onEditEnd:end,onUndo:()=>useEditor.getState().undo(),onRedo:()=>useEditor.getState().redo()};
 if(fill.color==='transparent')return null;
 return <PanelSection id="drawing.fill-mist" title="填充类型" className="assembly-drawing-fill-mist-controls" testId="assembly-drawing-fill-mist-controls">
  <label className="assembly-drawing-field">{t('填充类型')}<select aria-label={t('填充类型')} value={fill.mist?.enabled?'MIST':'SOLID'} disabled={disabled} onChange={e=>run(()=>setFillMist(d,fill.id,{enabled:e.target.value==='MIST'}))}><option value="SOLID">{t('实色填充')}</option><option value="MIST">{t('雾化填充')}</option></select></label>
  {fill.mist?.enabled&&<>
   <label className="assembly-drawing-field">{t('扩散方向')}<select aria-label={t('填充扩散方向')} value={style.side} disabled={disabled} onChange={e=>run(()=>setFillMist(d,fill.id,{side:e.target.value as FillMist['side']}))}><option value="INSIDE">{t('向内')}</option><option value="OUTSIDE">{t('向外')}</option><option value="BOTH">{t('双侧')}</option></select></label>
   <NumericSlider label="填充雾化宽度" value={style.width} min={.25/250} max={200/250} inputScale={250} formatValue={x=>(x*250).toFixed(1)+' px'} step={.25/250} disabled={disabled} onChange={width=>change({width})} {...edit}/>
   <NumericSlider label="填充不透明度" value={style.opacity} min={0} max={1} inputScale={100} formatValue={x=>Math.round(x*100)+'%'} step={.01} disabled={disabled} onChange={opacity=>change({opacity})} {...edit}/>
   <p className="assembly-drawing-muted">{t('沿闭合边界最浓，按高斯曲线逐渐透明；不改变描边。')}</p>
  </>}
 </PanelSection>;
}
