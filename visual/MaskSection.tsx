// The 蒙版 section of the properties panel (docs/mask-p2-checklist.md §4; bowen 1791903762 "按成熟的蒙版构建逻辑来",
// dot 1791905577): the mature order — the target first, then the mask area (source fills), then the mode. The targets
// are the subject's lines and filled loops; one relation per target, all in one edit. The draft (ticked sources, mode)
// lives in this component: the panel mounts it with a key of drawing + subject, so another subject or drawing drops it.
import { useState } from 'react'
import type { Snapshot, Editor } from '../src'

type Id = string
type Target = { kind: 'line' | 'fill'; id: Id }
const C = { text: '#ddd', dim: '#8a8a8a', key: '#9a9a9a', on: '#3a5f8f', line: '#3a3a3a' }

export function MaskSection({ s, targets: all, run }: { s: Snapshot; targets: readonly Target[]; run: (fn: (e: Editor) => void) => boolean }) {
  const [ticked, setTicked] = useState<Id[]>([])
  const [mode, setMode] = useState<'inverse' | 'normal'>('inverse')
  // with lines and fills among the targets, the fills are opt-in: two layers masking each other with their fills too leave
  // their overlap empty (126.json, 2026-10-13) — shown, not decided; see the hand-in
  const [withFills, setWithFills] = useState(false)
  const mixed = all.some(t => t.kind === 'line') && all.some(t => t.kind === 'fill')
  const targets = mixed && !withFills ? all.filter(t => t.kind === 'line') : all
  const layerName = (id: Id | undefined) => s.layers.find(l => l.id === id)?.name ?? '—'
  const lineName = (id: Id) => s.lines.find(l => l.id === id)?.name ?? id
  const filled = s.loops.filter(l => l.filled)
  const fillLabel = (id: Id) => { const l = filled.find(x => x.id === id); return l ? `${layerName(l.layer)} · ${s.groups.find(g => g.id === l.group)?.name ?? '—'}` : id }
  const targetLabel = (t: Target) => (t.kind === 'line' ? `线 ${lineName(t.id)}` : `填充 ${fillLabel(t.id)}`)
  const has = (t: Target) => targets.some(x => x.kind === t.kind && x.id === t.id)
  const isAny = (t: Target) => all.some(x => x.kind === t.kind && x.id === t.id)
  const own = s.masks.filter(m => isAny(m.target))
  // a fill never masks itself: the subject's own fills are not offered
  const offered = filled.filter(l => !isAny({ kind: 'fill', id: l.id }))
  // ticked sources still offered (a source gone since it was ticked drops out; core checks again on add)
  const sources = ticked.filter(id => offered.some(l => l.id === id))
  const add = () => {
    const used = new Set(s.masks.map(m => m.id))
    let n = 1
    const ids = targets.map(() => { while (used.has(`m${n}`)) n++; used.add(`m${n}`); return `m${n}` })
    if (run(e => targets.forEach((t, i) => e.mask(ids[i]!, sources, t, mode)))) setTicked([])
  }
  if (!all.length) return null
  return (
    <div data-testid="mask-section" style={{ padding: '4px 0 0' }}>
      <div style={{ color: C.key }}>蒙版 <span style={{ color: C.dim, fontSize: 11 }}>{targets.length > 1 ? `目标：${targets.length} 项（每项一条）` : `目标：${targetLabel(targets[0]!)}`}</span></div>
      {own.map(m => <div key={m.id} data-mask={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '1px 0 1px 8px' }}>
        <span style={{ wordBreak: 'break-all', flex: 1 }}>{all.length > 1 && `${targetLabel(m.target)} ← `}{m.sources.map(fillLabel).join('、')} · {m.mode === 'inverse' ? '反向' : '正常'}</span>
        <button data-mask-remove={m.id} title="删除这条蒙版" onClick={() => run(e => e.removeMask(m.id))}>×</button>
      </div>)}
      <div style={{ padding: '2px 0 0 8px', color: C.dim, fontSize: 11 }}>新建：勾选遮挡用的填充</div>
      {mixed && <label style={{ display: 'flex', gap: 6, padding: '0 0 0 8px' }} title="默认只遮线；勾上则这些填充也被遮">
        <input type="checkbox" data-mask-with-fills checked={withFills} onChange={e => setWithFills(e.target.checked)} /> 填充也遮</label>}
      {offered.length === 0 && <div style={{ padding: '0 0 0 8px', color: C.dim }}>画稿里没有别的填充</div>}
      {offered.map(l => <label key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 0 0 8px' }}>
        <input type="checkbox" data-mask-source={l.id} checked={sources.includes(l.id)} onChange={e => setTicked(t => (e.target.checked ? [...t.filter(x => x !== l.id), l.id] : t.filter(x => x !== l.id)))} />
        <span style={{ width: 10, height: 10, background: l.color, border: `1px solid ${C.line}`, flex: 'none' }} />
        <span>{fillLabel(l.id)}{l.visible ? '' : '（已关，暂不起作用）'}</span>
      </label>)}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0 0 8px' }}>
        <label title="来源区域里的部分不画"><input type="radio" name="mask-mode" data-mask-mode="inverse" checked={mode === 'inverse'} onChange={() => setMode('inverse')} /> 反向</label>
        <label title="只画来源区域里的部分"><input type="radio" name="mask-mode" data-mask-mode="normal" checked={mode === 'normal'} onChange={() => setMode('normal')} /> 正常</label>
        <button data-testid="mask-add" disabled={!sources.length} onClick={add}>添加</button>
      </div>
    </div>
  )
}
