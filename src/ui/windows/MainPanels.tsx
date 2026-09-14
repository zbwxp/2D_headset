import NumericSlider from '../shared/NumericSlider';
import type {ReactNode} from 'react';
import {panelNames,useWindows,type PanelId} from './state';
const ids:PanelId[]=['viewport','contour','threeD'];
export default function MainPanels({viewport,threeD,contour}:{viewport:ReactNode;threeD:ReactNode;contour:ReactNode}){
 const s=useWindows(),count=ids.filter(id=>s.visible[id]).length,contents={viewport,threeD,contour};
 return <div className="main-view-modules">
 <nav className="window-controls" aria-label="主窗口" data-ui-keyboard>
 {ids.map(id=><label key={id}><input type="checkbox" aria-label={'显示 '+panelNames[id]+' 窗口'} checked={s.visible[id]} disabled={count===1&&s.visible[id]} onChange={()=>s.toggle(id)}/>{panelNames[id]}</label>)}
 <details><summary>窗口比例</summary><div>{ids.filter(id=>s.visible[id]).map(id=><NumericSlider key={id} label={panelNames[id]+' 窗口比例'} min={.5} max={3} value={s.ratios[id]} onChange={v=>s.ratio(id,v)}/>)}</div></details>
 </nav>
 <div className="main-panels" data-panel-count={count}>
 {ids.filter(id=>s.visible[id]).map(id=><section key={id} className="main-view-panel" data-testid={'main-panel-'+id} style={{flex:s.ratios[id]+' 1 0'}} aria-label={panelNames[id]+' 窗口'}>
 <header className="window-heading"><span>{panelNames[id]}</span><button aria-label={'隐藏 '+panelNames[id]+' 窗口'} disabled={count===1} onClick={()=>s.toggle(id)}>收起</button></header>
 {contents[id]}
 </section>)}
 </div></div>;
}
