import {useShallow} from 'zustand/react/shallow';
import SymmetricPairListItem from "../shared/SymmetricPairListItem";
import InlineName from "../shared/InlineName";
import {patchRows} from "../shared/pairRows";
import {SmoothControls} from "../smooth/SmoothControls";
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import { useUI } from "../session";
import { useEditor } from '../../app/store';
import { defaultDisplay, patchSampling, patchQualityLevels, type PatchQuality } from '../../domain/patches/model';
import { tessellate } from '../../domain/patches/geometry';
function FullnessControl({id}:{id:string}) {
 const s=useEditor(useShallow(s=>({beginEdit:s.beginEdit,beginDisplayEdit:s.beginDisplayEdit,cancelPatch:s.cancelPatch,deletePatch:s.deletePatch,endEdit:s.endEdit,patchCreation:s.patchCreation,pickPatchEdge:s.pickPatchEdge,project:s.project,selectPatch:s.selectPatch,selectedPatchId:s.selectedPatchId,setFullness:s.setFullness,setPatchDisplay:s.setPatchDisplay,setPatchQuality:s.setPatchQuality,setPatchVisible:s.setPatchVisible,startPatch:s.startPatch}))),patch=s.project.patches?.find(p=>p.id===id),value=patch?.fullness??0;
 return <div data-testid="fullness-control"><NumericSlider label="面凸度 Fullness" min={-100} max={100} value={value*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setFullness(id,v/100)}/>
 <button disabled={value===0} onClick={()=>{s.beginEdit();s.setFullness(id,0);}}>凸度归零</button></div>;
}
export default function PatchPanel() {
    const collapsed = useUI(s=>s.patchCollapsed);
    const s = useEditor(useShallow(s=>({beginEdit:s.beginEdit,beginDisplayEdit:s.beginDisplayEdit,cancelPatch:s.cancelPatch,deletePatch:s.deletePatch,endEdit:s.endEdit,patchCreation:s.patchCreation,pickPatchEdge:s.pickPatchEdge,project:s.project,selectPatch:s.selectPatch,selectedPatchId:s.selectedPatchId,setFullness:s.setFullness,setPatchDisplay:s.setPatchDisplay,setPatchQuality:s.setPatchQuality,setPatchVisible:s.setPatchVisible,startPatch:s.startPatch}))), d = { ...defaultDisplay, ...s.project.patchDisplay };
    return <section className={`patch-panel ${collapsed ? "collapsed" : ""}`} aria-label="曲面 Patch" data-ui-keyboard>
    <button className="section-heading patch-heading" aria-expanded={!collapsed} aria-controls="patch-panel-content" onClick={()=>useUI.setState({patchCollapsed:!collapsed})}><span>{collapsed ? "▶" : "▼"} 曲面 Patch</span><span>{patchRows(s.project).length} 行</span></button>
    {!collapsed && <>
    <div className="patch-visibility">
    <label><span><input type="checkbox" aria-label="显示 Patch" checked={d.visible!==false} onChange={e=>s.setPatchVisible(e.target.checked)}/> 显示 Patch</span></label>
    </div>
    <div id="patch-panel-content" className="patch-panel-content">
    <button onClick={s.patchCreation ? s.cancelPatch : s.startPatch}>{s.patchCreation ? '退出绘制面（Esc）' : '绘制面'}</button>
    {s.patchCreation && <div>已选 {s.patchCreation.length} / 4 条边{s.patchCreation.map(id => <button key={id} onClick={() => s.pickPatchEdge(id)}>{s.project.curves.find(c => c.id === id)?.name} ×</button>)}</div>}
    {patchRows(s.project).map(({primary,mirror},i)=>{
      const p=[primary,mirror].find(x=>x?.id===s.selectedPatchId)??primary;
      const name=primary.name??mirror?.name??`${primary.type==='tri'?'三边面':'四边面'} ${i+1}`;
      const m=d.visible===false?{invalid:undefined,warning:undefined}:tessellate(s.project,p,patchSampling(d).subdivisions);
      return <div className="patch-card" key={primary.id} data-patch-card>
      <SymmetricPairListItem data-testid={`patch-row-${primary.id}`} primaryId={primary.id} mirrorId={mirror?.id} selectedId={s.selectedPatchId} displayName={name} onSelect={s.selectPatch}
      onRename={id=>useUI.setState({renameTarget:{kind:"patch",id}})}>
      {()=> <><InlineName target={{kind:"patch",id:p.id}} name={name} baseName={name}/><button aria-label={`删除 Patch ${i+1}`} onClick={e=>{e.stopPropagation();s.deletePatch(p.id);}}>删除</button>{(m.invalid||m.warning)&&<small>⚠ {m.invalid??m.warning}</small>}</>}
      </SymmetricPairListItem>
      {s.selectedPatchId===p.id && <FullnessControl key={p.canonicalId??p.id} id={p.canonicalId??p.id}/>}
      </div>;
    })}
    <div className="patch-global-settings" aria-label="曲面全局设置">
    <label>显示精度<select aria-label="Patch 显示精度" value={d.quality==='ultra'?'high':d.quality??'high'} onChange={e=>s.setPatchQuality(e.target.value as PatchQuality)}>{Object.entries(patchQualityLevels).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
    {d.visible===false && <small>已隐藏 2D/3D 曲面，Contour 由窗口开关独立控制。</small>}
    <SmoothControls/>
    {(['opacity2d','opacity3d'] as const).map((key,i)=><NumericSlider key={key} label={i?'3D Patch 不透明度':'2D Patch 不透明度'} min={0} max={100} value={d[key]*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={s.beginDisplayEdit} onEditEnd={s.endEdit} onChange={v=>s.setPatchDisplay(key,v/100)}/>)}
    </div>
    </div></>}
    </section>;
}
