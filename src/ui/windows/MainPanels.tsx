import ViewportPanel from './ViewportPanel';
import {uiText} from "../i18n";
import NumericSlider from '../shared/NumericSlider';
import type {ReactNode} from 'react';
import {panelNames,useWindows,type PanelId} from './state';
const ids:PanelId[]=['viewport','contour','threeD'];
export default function MainPanels({viewport,threeD,contour}:{viewport:ReactNode;threeD:ReactNode;contour:ReactNode}){
 const s=useWindows(),count=ids.filter(id=>s.visible[id]).length,contents={viewport,threeD,contour};
 const name=(id:PanelId)=>uiText(panelNames[s.contents[id]])+(s.contents[id]!==id?` · ${ids.indexOf(id)+1}`:'');
 return <div className="main-view-modules">
 <nav className="window-controls" aria-label={uiText("主窗口")} data-ui-keyboard>
 {ids.map(id=><label key={id}><input type="checkbox" aria-label={uiText('显示 '+name(id)+' 窗口')} checked={s.visible[id]} disabled={count===1&&s.visible[id]} onChange={()=>s.toggle(id)}/>{uiText(name(id))}</label>)}
 <details><summary>{uiText("窗口比例")}</summary><div>{ids.filter(id=>s.visible[id]).map(id=><NumericSlider key={id} label={uiText(name(id)+' 窗口比例')} min={.5} max={3} value={s.ratios[id]} onChange={v=>s.ratio(id,v)}/>)}</div></details>
 </nav>
 <div className="main-panels" data-panel-count={count}>
 {ids.filter(id=>s.visible[id]).map(id=><section key={id} className="main-view-panel" data-testid={'main-panel-'+id} style={{flex:s.ratios[id]+' 1 0'}} aria-label={uiText(name(id)+' 窗口')}>
 <header className="window-heading"><select aria-label={uiText("窗口内容")} value={s.contents[id]} onChange={e=>s.setContent(id,e.target.value as PanelId)}>{ids.map(kind=><option key={kind} value={kind}>{uiText(panelNames[kind])}</option>)}</select><button aria-label={uiText('隐藏 '+name(id)+' 窗口')} disabled={count===1} onClick={()=>s.toggle(id)}>{uiText("收起")}</button></header>
 {s.contents[id]==='viewport'?<ViewportPanel panelId={id}/>:uiText(contents[s.contents[id]])}
 </section>)}
 </div></div>;
}
