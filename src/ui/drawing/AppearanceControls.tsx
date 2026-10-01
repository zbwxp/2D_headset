import PanelSection from '../shared/PanelSection';
import {curveById,layerFor,type DrawingDocument as Doc,type FillRegion} from '../../domain/drawing/model';
import {setInk,createFill,createOffset,changePaint,deletePaint,detachOffset,reorderPaint,movePaint} from '../../domain/drawing/paintCommands';
import {fillGeometry,offsetGeometry,fillVisible} from '../../domain/drawing/appearance';
import {paintItems} from '../../domain/drawing/strokes';
import {NumberField,NameField} from './Field';
import {uiText as t} from '../i18n';
import InkEndControls from './InkEndControls';
import MistControls from './MistControls';
import FillMistControls from './FillMistControls';
import type {DrawingSelection} from './session';
export default function AppearanceControls({d,selection,run,choose,preview}:{d:Doc;selection:DrawingSelection;run:(f:()=>Doc)=>void;choose:(s:DrawingSelection)=>void;preview:(d:Doc|null)=>void}){
 const ids=selection.ids.filter(id=>curveById(d,id)),c=curveById(d,ids[0]),f=d.fills.find(f=>f.id===selection.paint),o=d.offsets.find(o=>o.id===selection.paint),obj=f??o;
 if(obj){const layer=layerFor(d,obj.id)!,disabled=obj.locked,status=f?fillGeometry(d,f):offsetGeometry(d,o!);
  const change=(v:Parameters<typeof changePaint>[2])=>run(()=>changePaint(d,obj.id,v));
  function order(dir:'up'|'down'|'top'|'bottom'){const list=paintItems(d,layer.id),i=list.findIndex(x=>x.id===obj!.id),target=list[dir==='top'?0:dir==='bottom'?list.length-1:dir==='up'?i-1:i+1];if(target)run(()=>reorderPaint(d,obj!.id,target.id,dir==='down'||dir==='bottom'));}
  return <div className="drawing-appearance"><NameField label={f?'填充名称':'偏移线名称'} value={obj.name} disabled={disabled} onChange={name=>change({name})}/>
   <p className={status.error?'drawing-invalid':'drawing-muted'} data-testid="drawing-paint-status">{t(status.error??(f?'闭合边界有效':'持续跟随源笔画'))}</p>
   {f?<><FillMistControls d={d} fill={f} run={run} preview={preview}/><label className="drawing-field">{t('填充')}<select aria-label={t('填充颜色')} disabled={disabled} value={f.color} onChange={e=>change({color:e.target.value as FillRegion['color']})}><option value="white">{t('白色')}</option><option value="black">{t('黑色')}</option><option value="transparent">{t('透明挖空')}</option></select></label>{f.color==='transparent'&&<p className="drawing-muted">{t('挖空本图层内的黑白填充，露出下层；描边不受影响。')}</p>}</>:<>
    <div className="drawing-fields">{(['X','Y'] as const).map((axis,i)=><NumberField key={axis} label={'偏移位置 '+axis} value={(o!.translation??[0,0])[i]} disabled={disabled} onChange={v=>change({translation:(o!.translation??[0,0]).map((x,k)=>k===i?v:x) as [number,number]})}/>)}</div>
    <NumberField label="偏移距离 px" value={o!.distance*250} min={-500} max={500} disabled={disabled} onChange={v=>change({distance:v/250})}/>
    <div className="drawing-fields"><NumberField label="源线起点 %" value={o!.start*100} min={0} max={100} disabled={disabled} onChange={v=>change({start:v/100})}/><NumberField label="源线终点 %" value={o!.end*100} min={0} max={100} disabled={disabled} onChange={v=>change({end:v/100})}/></div>
    <NumberField label="两端收拢 %" value={o!.taper*100} min={0} max={50} disabled={disabled} onChange={v=>change({taper:v/100})}/>
    <NumberField label="线宽" value={o!.width*250} min={.25} max={40} disabled={disabled} onChange={v=>change({width:v/250})}/>
    <MistControls d={d} ids={[o!.id]} run={run} preview={preview}/>
    <InkEndControls d={d} id={o!.id} selection={selection} run={run} choose={choose}/>
    <p className="drawing-muted">{t('正负距离切换偏移侧；线宽与距离随画布缩放。')}</p>
    <button disabled={disabled||!!status.error} onClick={()=>run(()=>{const n=detachOffset(d,o!.id);choose({ids:n.ids});return n.document;})}>{t('转为独立曲线')}</button>
   </>}
   <button onClick={()=>choose({ids:(f?.boundary??o!.source).filter(x=>curveById(d,x.id)).map(x=>x.id)})}>{t('选择源边界')}</button>
   <div className="drawing-property-actions">{(['top','up','down','bottom'] as const).map((dir,i)=><button key={dir} disabled={disabled} onClick={()=>order(dir)}>{t(['置顶','上移一层','下移一层','置底'][i])}</button>)}</div>
   <label className="drawing-field">{t('移动到图层')}<select aria-label={t('移动到图层')} disabled={disabled} value="" onChange={e=>run(()=>movePaint(d,obj.id,e.target.value))}><option value="">—</option>{d.layers.filter(l=>l!==layer).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <button disabled={disabled} onClick={()=>run(()=>{choose({ids:[]});return deletePaint(d,obj.id);})}>{t('删除')}</button>
  </div>;
 }
 if(!c)return null;const disabled=ids.some(id=>curveById(d,id).locked||!curveById(d,id).visible);
 return <PanelSection id="drawing.appearance" title="描边与填充" className="drawing-appearance">
  <MistControls d={d} ids={ids} run={run} preview={preview}/>
  <InkEndControls d={d} id={c.id} selection={selection} run={run} choose={choose}/>
  <label className="drawing-check"><input type="checkbox" checked={ids.every(id=>curveById(d,id).inkVisible!==false)} disabled={disabled} onChange={e=>run(()=>setInk(d,ids,{inkVisible:e.target.checked}))}/>{t('绘制所选段描边')}</label>
  <div className="drawing-property-actions">{(['white','black','transparent'] as const).map(color=><button key={color} disabled={disabled} onClick={()=>run(()=>{const n=createFill(d,ids,color);choose({ids:[],paint:n.fills.at(-1)!.id});return n;})}>{t(color==='white'?'建立白色填充':color==='black'?'建立黑色填充':'建立透明填充')}</button>)}</div>
  <button data-testid="drawing-create-mist-fill" disabled={disabled} onClick={()=>run(()=>{const n=createFill(d,ids,'black','MIST');choose({ids:[],paint:n.fills.at(-1)!.id});return n;})}>{t('建立雾化填充')}</button>
  <div className="drawing-property-actions"><button disabled={disabled} onClick={()=>run(()=>{const n=createOffset(d,c.id);choose({ids:[],paint:n.offsets.at(-1)!.id});return n;})}>{t('创建偏移跟随')}</button><button disabled={disabled} onClick={()=>run(()=>{const n=createOffset(d,c.id),result=detachOffset(n,n.offsets.at(-1)!.id);choose({ids:result.ids});return result.document;})}>{t('独立偏移副本')}</button></div>
 </PanelSection>;
}
