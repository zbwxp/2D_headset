import { useRef } from 'react';
import { useUI } from "../session";
import { useEditor } from '../../app/store';
import { defaultDisplay, patchSampling, patchQualityLevels, type PatchQuality } from '../../domain/patches/model';
import { tessellate } from '../../domain/patches/geometry';
function FullnessControl({id}:{id:string}) {
 const s=useEditor(), started=useRef(false);
 const patch=s.project.patches?.find(p=>p.id===id), value=patch?.fullness??0;
 const end=()=>{started.current=false;};
 const change=(next:number)=>{if(next===value)return;if(!started.current){s.beginEdit();started.current=true;}s.setFullness(id,next);};
 return <div data-testid="fullness-control"><label>面凸度 / Fullness · {Math.round(value*100)}%
 <input aria-label="面凸度 Fullness" type="range" min="-100" max="100" step="1" value={Math.round(value*100)}
 onPointerDown={end} onPointerUp={end} onPointerCancel={end} onBlur={end} onKeyUp={end}
 onChange={e=>change(+e.target.value/100)}/></label>
 <button disabled={value===0} onClick={()=>{end();s.beginEdit();s.setFullness(id,0);}}>凸度归零</button></div>;
}
export default function PatchPanel() {
    const collapsed = useUI(s=>s.patchCollapsed);
    const s = useEditor(), d = { ...defaultDisplay, ...s.project.patchDisplay };
    return <section className={`patch-panel ${collapsed ? "collapsed" : ""}`} aria-label="曲面 Patch" data-ui-keyboard>
    <button className="section-heading patch-heading" aria-expanded={!collapsed} aria-controls="patch-panel-content" onClick={()=>useUI.setState({patchCollapsed:!collapsed})}><span>{collapsed ? "▶" : "▼"} 曲面 Patch</span><span>{s.project.patches?.length ?? 0}</span></button>
    {!collapsed && <div id="patch-panel-content" className="patch-panel-content">
    <label><span><input type="checkbox" aria-label="显示 Patch" checked={d.visible!==false} onChange={e=>s.setPatchVisible(e.target.checked)}/> 显示 Patch</span></label>
    <label>显示精度<select aria-label="Patch 显示精度" value={d.quality==='ultra'?'high':d.quality??'high'} onChange={e=>s.setPatchQuality(e.target.value as PatchQuality)}>{Object.entries(patchQualityLevels).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label>
    {d.visible===false && <small>已暂停曲面计算，调整点线后开启即可查看。</small>}
    <button onClick={s.patchCreation ? s.cancelPatch : s.startPatch}>{s.patchCreation ? '退出绘制面（Esc）' : '绘制面'}</button>
    {s.patchCreation && <div>已选 {s.patchCreation.length} / 4 条边{s.patchCreation.map(id => <button key={id} onClick={() => s.pickPatchEdge(id)}>{s.project.curves.find(c => c.id === id)?.name} ×</button>)}</div>}
    {(['opacity2d', 'opacity3d'] as const).map((key, i) => <label key={key}>{i ? '3D Patch 不透明度' : '2D Patch 不透明度'} · {Math.round(d[key] * 100)}%<input aria-label={i ? '3D Patch 不透明度' : '2D Patch 不透明度'} type="range" min="0" max="100" value={d[key] * 100} onChange={e => s.setPatchDisplay(key, +e.target.value / 100)}/></label>)}
    {s.selectedPatchId && (()=>{const p=s.project.patches?.find(p=>p.id===s.selectedPatchId);return p?<FullnessControl key={p.canonicalId??p.id} id={p.canonicalId??p.id}/>:null;})()}
    {(s.project.patches ?? []).map((p, i) => { const m = d.visible===false ? {invalid:undefined,warning:undefined} : tessellate(s.project, p, patchSampling(d).subdivisions); return <div key={p.id} data-testid={`patch-row-${p.id}`}><button aria-pressed={s.selectedPatchId === p.id} onClick={() => s.selectPatch(p.id)}>{p.type === 'tri' ? '三边面' : '四边面'} {i + 1}{p.mirrorPartnerId ? ' · 镜像对' : ''}</button><button aria-label={`删除 Patch ${i + 1}`} onClick={() => s.deletePatch(p.id)}>删除</button>{(m.invalid || m.warning) && <small>⚠ {m.invalid ? 'INVALID：' : ''}{m.invalid ?? m.warning}</small>}</div>; })}
    </div>}
    </section>;
}
