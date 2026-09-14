import {SmoothControls} from "../smooth/SmoothControls";
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import { useUI } from "../session";
import { useEditor } from '../../app/store';
import { defaultDisplay, patchSampling, patchQualityLevels, type PatchQuality } from '../../domain/patches/model';
import { tessellate } from '../../domain/patches/geometry';
function FullnessControl({id}:{id:string}) {
 const s=useEditor(),patch=s.project.patches?.find(p=>p.id===id),value=patch?.fullness??0;
 return <div data-testid="fullness-control"><NumericSlider label="面凸度 Fullness" min={-100} max={100} value={value*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={s.beginEdit} onChange={v=>s.setFullness(id,v/100)}/>
 <button disabled={value===0} onClick={()=>{s.beginEdit();s.setFullness(id,0);}}>凸度归零</button></div>;
}
export default function PatchPanel() {
    const collapsed = useUI(s=>s.patchCollapsed);
    const s = useEditor(), d = { ...defaultDisplay, ...s.project.patchDisplay };
    return <section className={`patch-panel ${collapsed ? "collapsed" : ""}`} aria-label="曲面 Patch" data-ui-keyboard>
    <button className="section-heading patch-heading" aria-expanded={!collapsed} aria-controls="patch-panel-content" onClick={()=>useUI.setState({patchCollapsed:!collapsed})}><span>{collapsed ? "▶" : "▼"} 曲面 Patch</span><span>{s.project.patches?.length ?? 0}</span></button>
    {!collapsed && <div id="patch-panel-content" className="patch-panel-content">
    <label><span><input type="checkbox" aria-label="显示 Patch" checked={d.visible!==false} onChange={e=>s.setPatchVisible(e.target.checked)}/> 显示 Patch</span></label>
    <label>显示精度<select aria-label="Patch 显示精度" value={d.quality==='ultra'?'high':d.quality??'high'} onChange={e=>s.setPatchQuality(e.target.value as PatchQuality)}>{Object.entries(patchQualityLevels).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
    {d.visible===false && <small>已隐藏 2D/3D 曲面，Contour 由窗口开关独立控制。</small>}
    <SmoothControls/>
    <button onClick={s.patchCreation ? s.cancelPatch : s.startPatch}>{s.patchCreation ? '退出绘制面（Esc）' : '绘制面'}</button>
    {s.patchCreation && <div>已选 {s.patchCreation.length} / 4 条边{s.patchCreation.map(id => <button key={id} onClick={() => s.pickPatchEdge(id)}>{s.project.curves.find(c => c.id === id)?.name} ×</button>)}</div>}
    {(['opacity2d','opacity3d'] as const).map((key,i)=><NumericSlider key={key} label={i?'3D Patch 不透明度':'2D Patch 不透明度'} min={0} max={100} value={d[key]*100} formatValue={v=>formatNumeric(v)+'%'} onChange={v=>s.setPatchDisplay(key,v/100)}/>)}
    {s.selectedPatchId && (()=>{const p=s.project.patches?.find(p=>p.id===s.selectedPatchId);return p?<FullnessControl key={p.canonicalId??p.id} id={p.canonicalId??p.id}/>:null;})()}
    {(s.project.patches ?? []).map((p, i) => { const m = d.visible===false ? {invalid:undefined,warning:undefined} : tessellate(s.project, p, patchSampling(d).subdivisions); return <div key={p.id} data-testid={`patch-row-${p.id}`}><button aria-pressed={s.selectedPatchId === p.id} onClick={() => s.selectPatch(p.id)}>{p.type === 'tri' ? '三边面' : '四边面'} {i + 1}{p.mirrorPartnerId ? ' · 镜像对' : ''}</button><button aria-label={`删除 Patch ${i + 1}`} onClick={() => s.deletePatch(p.id)}>删除</button>{(m.invalid || m.warning) && <small>⚠ {m.invalid ? 'INVALID：' : ''}{m.invalid ?? m.warning}</small>}</div>; })}
    </div>}
    </section>;
}
