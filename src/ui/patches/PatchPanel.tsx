import {uiText} from "../i18n";
import {chinSurfaceAttached} from '../../domain/chin/junction';
import {useLoomisUI} from '../head/loomisUI';
import {EDIT_OPACITY_PRESETS,editSurfaceOpacity} from '../../rendering/edit2d/types';
import {count} from '../../domain/geometry/diagnostics';
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
export function FullnessControl({id}:{id:string}) {
 const s=useEditor(useShallow(s=>({completeLensPatch:s.completeLensPatch,createLoopPatch:s.createLoopPatch,flipLoopTraversal:s.flipLoopTraversal,beginEdit:s.beginEdit,beginDisplayEdit:s.beginDisplayEdit,cancelPatch:s.cancelPatch,deletePatch:s.deletePatch,endEdit:s.endEdit,patchCreation:s.patchCreation,pickPatchEdge:s.pickPatchEdge,project:s.project,selectPatch:s.selectPatch,selectedPatchId:s.selectedPatchId,setFullness:s.setFullness,setPatchDisplay:s.setPatchDisplay,setPatchQuality:s.setPatchQuality,setPatchVisible:s.setPatchVisible,startPatch:s.startPatch,setPatchMode:s.setPatchMode,removePatchBoundary:s.removePatchBoundary}))),patch=s.project.patches?.find(p=>p.id===id),value=patch?.fullness??0;
 return <div data-testid="fullness-control">{patch&&chinSurfaceAttached(s.project,patch)&&<small data-testid="chin-patch-status">{uiText('下巴连接：局部自动平滑')}</small>}<NumericSlider label={uiText("面凸度 Fullness")} min={-100} max={100} value={value*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setFullness(id,v/100)}/>
 <button disabled={value===0} onClick={()=>{s.beginEdit();s.setFullness(id,0);}}>{uiText("凸度归零")}</button></div>;
}
export default function PatchPanel() {
 count('renderPatchPanel');
    const collapsed = useUI(s=>s.patchCollapsed);
    const s = useEditor(useShallow(s=>({completeLensPatch:s.completeLensPatch,createLoopPatch:s.createLoopPatch,flipLoopTraversal:s.flipLoopTraversal,beginEdit:s.beginEdit,beginDisplayEdit:s.beginDisplayEdit,cancelPatch:s.cancelPatch,deletePatch:s.deletePatch,endEdit:s.endEdit,patchCreation:s.patchCreation,pickPatchEdge:s.pickPatchEdge,project:s.project,selectPatch:s.selectPatch,selectedPatchId:s.selectedPatchId,setFullness:s.setFullness,setPatchDisplay:s.setPatchDisplay,setPatchQuality:s.setPatchQuality,setPatchVisible:s.setPatchVisible,startPatch:s.startPatch,setPatchMode:s.setPatchMode,removePatchBoundary:s.removePatchBoundary}))), d = { ...defaultDisplay, ...s.project.patchDisplay };
    return <section className={`patch-panel ${collapsed ? "collapsed" : ""}`} aria-label={uiText("曲面 Patch")} data-ui-keyboard>
    <button className="section-heading patch-heading" aria-expanded={!collapsed} aria-controls="patch-panel-content" onClick={()=>{useLoomisUI.setState({open:false});useUI.setState({patchCollapsed:!collapsed});}}><span>{uiText(collapsed ? "▶" : "▼")}{uiText("曲面 Patch")}</span><span>{patchRows(s.project).length}{uiText("行")}</span></button>
    {!collapsed && <>
    <div className="patch-visibility">
    <label><span><input type="checkbox" aria-label={uiText("显示 Patch")} checked={d.visible!==false} onChange={e=>s.setPatchVisible(e.target.checked)}/>{uiText("显示 Patch")}</span></label>
    </div>
    <div id="patch-panel-content" className="patch-panel-content">
    <button onClick={s.patchCreation ? s.cancelPatch : s.startPatch}>{uiText(s.patchCreation ? '退出绘制面（Esc）' : '绘制面')}</button>
    {s.patchCreation && <div><div role="group" aria-label={uiText("边界选择模式")}>{(['whole','span','loop'] as const).map(mode=><button key={mode} aria-pressed={s.patchCreation!.mode===mode} onClick={()=>s.setPatchMode(mode)}>{uiText(mode==='loop'?'环形 Patch':mode==='whole'?'整线':'区间')}</button>)}</div><small>{uiText(s.patchCreation.host?(s.patchCreation.start?'选择第二个定位点（Esc 取消区间）':'选择第一个定位点（Esc 取消宿主）'):'选择结构线')}</small><br/>{uiText("已选")}{s.patchCreation.uses.length} / {s.patchCreation.mode==='loop'?2:4}{uiText("条边")}{s.patchCreation.uses.map((b,i) => <button key={i} onClick={() => s.removePatchBoundary(i)}>{s.project.curves.find(c => c.id === b.curveId)?.name}: {uiText(b.kind==='closed'?'完整闭环':`${s.project.landmarks.find(l=>l.id===b.startLandmarkId)?.name} → ${s.project.landmarks.find(l=>l.id===b.endLandmarkId)?.name}`)} ×</button>)}</div>}
    {s.patchCreation&&s.patchCreation.mode!=='loop'&&s.patchCreation.uses.length===2&&<button onClick={s.completeLensPatch}>{uiText("生成两边面")}</button>}
    {s.patchCreation?.mode==='loop'&&s.patchCreation.uses.length===2&&<div><small>{uiText("虚线为相同弧长 s 的对应位置。")}</small><button onClick={s.flipLoopTraversal}>{uiText("翻转第二条环方向")}</button><button onClick={s.createLoopPatch}>{uiText("创建环形 Patch")}</button></div>}
    {patchRows(s.project).map(({primary,mirror},i)=>{
      const p=[primary,mirror].find(x=>x?.id===s.selectedPatchId)??primary;
      const name=primary.name??mirror?.name??`${primary.type==='lens'?'两边面':primary.type==='loop'?'环形面':primary.type==='tri'?'三边面':'四边面'} ${i+1}`;
      const m=d.visible===false?{invalid:undefined,warning:undefined}:tessellate(s.project,p,patchSampling(d).subdivisions);
      return <div className="patch-card" key={primary.id} data-patch-card>
      <SymmetricPairListItem data-testid={`patch-row-${primary.id}`} primaryId={primary.id} mirrorId={mirror?.id} selectedId={s.selectedPatchId} displayName={name} onSelect={s.selectPatch}
      onRename={id=>useUI.setState({renameTarget:{kind:"patch",id}})}>
      {()=> <><InlineName target={{kind:"patch",id:p.id}} name={name} baseName={name}/><button aria-label={uiText(`删除 Patch ${i+1}`)} onClick={e=>{e.stopPropagation();s.deletePatch(p.id);}}>{uiText("删除")}</button>{uiText((m.invalid||m.warning)&&<small>⚠ {uiText(m.invalid??m.warning)}</small>)}</>}
      </SymmetricPairListItem>
      {s.selectedPatchId===p.id && <><FullnessControl key={p.canonicalId??p.id} id={p.canonicalId??p.id}/><div aria-label={uiText("Patch 边界")}>{p.boundaryUses.map((b,i)=><small style={{display:'block'}} key={i}>{s.project.curves.find(c=>c.id===b.curveId)?.name}: {uiText(b.kind==='closed'?'完整闭环':`${s.project.landmarks.find(l=>l.id===b.startLandmarkId)?.name} → ${s.project.landmarks.find(l=>l.id===b.endLandmarkId)?.name}`)}</small>)}</div></>}
      </div>;
    })}
    <div className="patch-global-settings" aria-label={uiText("曲面全局设置")}>
    <label>{uiText("显示精度")}<select aria-label={uiText("Patch 显示精度")} value={d.quality==='ultra'?'high':d.quality??'high'} onChange={e=>s.setPatchQuality(e.target.value as PatchQuality)}>{Object.entries(patchQualityLevels).map(([key,value])=><option key={key} value={key}>{uiText(value.label)}</option>)}</select></label>
    {d.visible===false && <small>{uiText("已隐藏 2D/3D 曲面，Contour 由窗口开关独立控制。")}</small>}
    <SmoothControls/>
    <label className="patch-opacity-presets">{uiText("2D Patch 不透明度")}<select aria-label={uiText("2D Patch 不透明度")} value={editSurfaceOpacity(d.opacity2d)} onChange={e=>s.setPatchDisplay('opacity2d',Number(e.target.value))}>{EDIT_OPACITY_PRESETS.map(n=><option key={n} value={n}>{n*100}%</option>)}</select></label>
    <NumericSlider label={uiText("3D Patch 不透明度")} min={0} max={100} value={d.opacity3d*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={s.beginDisplayEdit} onEditEnd={s.endEdit} onChange={v=>s.setPatchDisplay('opacity3d',v/100)}/>
    </div>
    </div></>}
    </section>;
}
