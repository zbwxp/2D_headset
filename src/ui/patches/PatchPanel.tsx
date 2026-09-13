import { useEditor } from '../../app/store';
import { defaultDisplay } from '../../domain/patches/model';
import { tessellate } from '../../domain/patches/geometry';
export default function PatchPanel() {
    const s = useEditor(), d = { ...defaultDisplay, ...s.project.patchDisplay };
    return <section className="patch-panel" data-ui-keyboard>
    <h3>曲面 Patch · {s.project.patches?.length ?? 0}</h3>
    <button onClick={s.patchCreation ? s.cancelPatch : s.startPatch}>{s.patchCreation ? '退出绘制面（Esc）' : '绘制面'}</button>
    {s.patchCreation && <div>已选 {s.patchCreation.length} / 4 条边{s.patchCreation.map(id => <button key={id} onClick={() => s.pickPatchEdge(id)}>{s.project.curves.find(c => c.id === id)?.name} ×</button>)}</div>}
    {(['opacity2d', 'opacity3d'] as const).map((key, i) => <label key={key}>{i ? '3D Patch 不透明度' : '2D Patch 不透明度'} · {Math.round(d[key] * 100)}%<input aria-label={i ? '3D Patch 不透明度' : '2D Patch 不透明度'} type="range" min="0" max="100" value={d[key] * 100} onChange={e => s.setPatchDisplay(key, +e.target.value / 100)}/></label>)}
    {(s.project.patches ?? []).map((p, i) => { const m = tessellate(s.project, p); return <div key={p.id} data-testid={`patch-row-${p.id}`}><button aria-pressed={s.selectedPatchId === p.id} onClick={() => s.selectPatch(p.id)}>{p.type === 'tri' ? '三边面' : '四边面'} {i + 1}{p.mirrorPartnerId ? ' · 镜像对' : ''}</button><button aria-label={`删除 Patch ${i + 1}`} onClick={() => s.deletePatch(p.id)}>删除</button>{(m.invalid || m.warning) && <small>⚠ {m.invalid ? 'INVALID：' : ''}{m.invalid ?? m.warning}</small>}</div>; })}
    </section>;
}
