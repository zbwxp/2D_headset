import {useState} from 'react';
import {useFloatingPanel} from '../shared/useFloatingPanel';
import {useEditor} from '../../app/store';
import {applyWorkspaceView,useWorkspaceView,type WorkspaceViewCommand} from '../../app/workspaceView';
import {useLanguage} from '../i18n';
import './workspaceView.css';
export default function WorkspaceViewPanel({close,embedded=false}:{close?:()=>void;embedded?:boolean}){
 const view=useWorkspaceView(),library=useEditor(s=>s.project.drawingSnapshots),zh=useLanguage(s=>s.language)==='zh',t=(c:string,e:string)=>zh?c:e,[error,setError]=useState('');
 function run(command:WorkspaceViewCommand){try{applyWorkspaceView([command],library);setError('');}catch(e){setError((e as Error).message);}}
 const floating=useFloatingPanel({open:!embedded,storageKey:'contour-reference-panel-position-v1'});
 const ref=view.reference;
 return <aside ref={embedded?undefined:floating.panelRef} style={embedded?undefined:floating.style} className={"workspace-view-panel"+(embedded?" embedded":"")} aria-label={t('参考画稿与辅助线','Artwork reference and guides')} data-ui-keyboard><header {...(embedded?{}:floating.headerProps)} data-testid={embedded?undefined:"workspace-reference-drag-handle"} className={embedded?undefined:"reference-panel-drag-handle"} title={embedded?undefined:t('拖动标题栏移动面板','Drag the title bar to move this panel')}><strong>{t('参考画稿 / 辅助线','Reference / Guides')}</strong>{close&&<button onClick={close}>×</button>}</header><p>{t('只影响工作视图。参考不可选中，不进入普通导出。','View only. Reference is not selectable and is excluded from normal exports.')}</p>
 <label>{t('参考画稿','Saved artwork')}<select aria-label="Reference artwork" value={ref?.artworkId??''} onChange={e=>run({op:'setReference',artworkId:e.target.value||null})}><option value="">{t('无','None')}</option>{library?.items.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 {ref&&<><div className="view-buttons">{(['left','overlay','right'] as const).map(placement=><button key={placement} onClick={()=>run({op:'setReference',placement})}>{t(placement==='left'?'放左侧':placement==='right'?'放右侧':'原位叠放',placement)}</button>)}</div>
 <label>{t('显示参考','Show reference')}<input type="checkbox" checked={ref.visible} onChange={e=>run({op:'setReference',visible:e.target.checked})}/></label>
 {([0,1] as const).map(i=><label key={i}>Reference {i?'Y':'X'}<input aria-label={`Reference ${i?'Y':'X'}`} type="number" step=".01" value={ref.offset[i]} onChange={e=>run({op:'setReference',offset:i?[ref.offset[0],+e.target.value]:[+e.target.value,ref.offset[1]]})}/></label>)}
 <label>{t('缩放 %','Scale %')}<input aria-label="Reference scale" type="number" min="1" max="10000" step="1" value={ref.scale*100} onChange={e=>run({op:'setReference',scale:+e.target.value/100})}/></label><label>{t('透明度 %','Opacity %')}<input aria-label="Reference opacity" type="number" min="0" max="100" value={ref.opacity*100} onChange={e=>run({op:'setReference',opacity:+e.target.value/100})}/></label><label>{t('参考参与曲线交点吸附','Reference curve intersections can snap')}<input type="checkbox" checked={ref.snap} onChange={e=>run({op:'setReference',snap:e.target.checked})}/></label></>}
 <hr/>{([['rulers','rulersVisible','显示标尺','Rulers'],['visible','guidesVisible','显示辅助线','Show guides'],['snapping','snappingEnabled','吸附辅助线','Snap to guides']] as const).map(([option,key,cn,en])=><label key={key}>{t(cn,en)}<input type="checkbox" checked={view[key]} onChange={e=>run({op:'setGuideOptions',[option]:e.target.checked})}/></label>)}
 <div className="view-buttons"><button onClick={()=>run({op:'addGuide',axis:'y',value:0})}>{t('＋ 水平线','＋ Horizontal')}</button><button onClick={()=>run({op:'addGuide',axis:'x',value:0})}>{t('＋ 垂直线','＋ Vertical')}</button></div>
 <p>{t('从上标尺拖出水平线，从左标尺拖出垂直线。拖动标尺上的三角可移动现有线；Alt 临时绕过吸附。坐标为源逻辑单位。','Drag from the top/left ruler to create a horizontal/vertical guide. Move existing guides by their ruler triangles. Hold Alt to bypass snapping. Coordinates use source logical units.')}</p>
 {view.guides.map(g=><label key={g.id} className="view-guide-row"><span>{g.axis==='x'?'V · X':'H · Y'}</span><input aria-label={`Guide ${g.id}`} type="number" step=".01" value={g.value} onChange={e=>run({op:'changeGuide',id:g.id,value:+e.target.value})}/><button aria-label="Delete guide" onClick={()=>run({op:'deleteGuides',ids:[g.id]})}>×</button></label>)}
 {error&&<p role="alert">{error}</p>}
 </aside>;
}
