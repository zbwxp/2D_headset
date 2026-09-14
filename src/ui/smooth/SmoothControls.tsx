import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import { useSyncExternalStore } from 'react';
import { useEditor } from '../../app/store';
import { defaultSmooth, surfaceAdjacency, influence } from '../../domain/smooth/model';
import { subscribeSmooth, smoothVersion, getSmoothResult } from '../../domain/smooth/evaluation';
export function SmoothControls() {
    useSyncExternalStore(subscribeSmooth, smoothVersion);
    const s = useEditor(), settings = s.project.surfaceSmooth ?? defaultSmooth, result = getSmoothResult(s.project);
    const state = !settings.enabled ? 'off' : settings.strength === 0 ? 'zero' : !result ? 'pending' : result.error ? 'failed' : 'ready';
    return <div className="smooth-controls" data-ui-keyboard data-testid="smooth-controls" data-state={state}>
 <label><span><input type="checkbox" aria-label="Surface Smooth" checked={settings.enabled} onChange={e => s.setSmoothEnabled(e.target.checked)}/> Surface Smooth</span></label>
 <NumericSlider label="Smooth Strength" min={0} max={100} value={settings.strength*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={s.beginEdit} onChange={v=>s.setSmoothStrength(v/100)}/>
 {state === 'pending' && <small>求解中 · 暂时显示源曲面</small>}
 {state === 'failed' && <small>⚠ Smooth 已回退：{result?.error}</small>}
 {state === 'ready' && result && <details><summary>求解诊断 · 完整解</summary><div data-testid="smooth-diagnostics">
 <div>Seam residual {result.diagnostics.before.toPrecision(3)} → {result.diagnostics.after.toPrecision(3)}</div>
 <div>最大位移 {result.diagnostics.maxDisplacement.toPrecision(3)} · 平均 {result.diagnostics.averageDisplacement.toPrecision(3)}</div>
 <div>{result.diagnostics.iterations} 次迭代 · 相对残差 {result.diagnostics.relativeResidual.toExponential(1)}</div>
 {!result.diagnostics.seamSamples && <div>没有可求解的 Smooth seam</div>}
 {result.diagnostics.warnings.map((w, i) => <small key={i}>⚠ {w}</small>)}
 </div></details>}
 </div>;
}
export function SmoothEdgeControl({ id }: {
    id: string;
}) {
    const s = useEditor(), count = surfaceAdjacency(s.project).get(id)?.length ?? 0;
    if (count > 2)
        return <small>⚠ Non-manifold：此边已固定，不参与 Smooth</small>;
    if (count !== 2)
        return null;
    const value = influence(s.project, id);
    return <div className="smooth-controls" data-ui-keyboard><NumericSlider label="Smooth Influence" min={0} max={100} value={value*100} formatValue={v=>formatNumeric(v)+'%'} onEditStart={s.beginEdit} onChange={v=>s.setSmoothInfluence(id,v/100)}/>{value === 0 && <small>Hard / Crease · 边界保持 Source</small>}</div>;
}
