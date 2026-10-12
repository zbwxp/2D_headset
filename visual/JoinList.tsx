// A point's join list in the properties panel (J1b; docs/j1b-join-panel-checklist.md §2): the point's
// joins top first — the order is the precedence (bowen 1791810865 / 1791810907) — each named by its two
// lines, with its mode, an arc's radius and the transition zone (自动 / 手动, the desired length and the
// 限长后长度), rows dragged to reorder. Every change is a one-shot core operation through `run`; numbers
// use the program's one slider (dot 1791812909).
import { useState } from 'react'
import type { Snapshot, Zones, Editor } from '../src'
import { Slider, type SliderProps } from '../slider'

type Id = string
const C = { row: '#363636', mark: '#4b5f7c', text: '#ddd', dim: '#8a8a8a', warn: '#d9a441', line: '#262626' }
const MODES: [string, string][] = [['bound', '仅绑定'], ['smooth', '平滑'], ['cusp', '尖角'], ['arc', '圆弧']]
export type SliderHooks = Pick<SliderProps, 'onStart' | 'onEnd' | 'onField'>
const idle: SliderHooks = { onStart: () => true, onEnd: () => {}, onField: () => {} }
const fmt = (v: number) => String(Number(v.toFixed(3)))

export function JoinList({ s, zones, point, line, run, slider = idle, toolRadius = 10, scope = '' }: {
  s: Snapshot; zones: Zones; point: Id
  /** The drawing and view the values belong to: part of each control's identity, so a typing draft never crosses to another view (dot 1791813754). */
  scope?: string
  /** The line whose end this is, when the panel shows a line: its rows are marked, the topmost governs its end. */
  line?: Id
  run?: (fn: (e: Editor) => void) => boolean
  slider?: SliderHooks
  toolRadius?: number
}) {
  const [dragged, setDragged] = useState<number | null>(null)
  const rows = s.joins.filter(j => j.point === point)
  const name = (id: Id) => s.lines.find(l => l.id === id)?.name ?? id
  const zoneOf = (lines: [Id, Id]) => zones.find(z => z.point === point && z.lines[0] === lines[0] && z.lines[1] === lines[1])
  const governing = line === undefined ? -1 : rows.findIndex(r => r.lines.includes(line))
  const atPoint = s.lines.filter(l => l.a === point || l.b === point).map(l => l.id)
  const unjoined = line === undefined ? [] : atPoint.filter(o => o !== line && !rows.some(r => r.lines.includes(line) && r.lines.includes(o)))
  const mirrored = new Set(s.mirrorPairs.flatMap(p => [p.a, p.b]))
  const drop = (to: number) => {
    if (dragged === null || dragged === to) return
    const order = rows.map(r => r.lines)
    const [moved] = order.splice(dragged, 1)
    order.splice(to, 0, moved!)
    run?.(e => e.joinOrder(point, order.map(l => [l[0], l[1]])))
    setDragged(null)
  }
  if (!rows.length && !unjoined.length) return null
  return (
    <div data-join-list={point} style={{ margin: '2px 0 4px 8px' }}>
      {rows.map((r, i) => {
        const z = zoneOf(r.lines), key = `${point}|${r.lines.join('|')}`, ident = `${scope}|${key}`
        return (
          <div key={key} data-join-row={r.lines.join('↔')} draggable onDragStart={() => setDragged(i)} onDragOver={e => e.preventDefault()} onDrop={() => drop(i)}
            style={{ background: i === governing ? C.mark : C.row, border: `1px solid ${C.line}`, borderRadius: 3, padding: '3px 6px', marginBottom: 2, cursor: 'grab', opacity: line !== undefined && !r.lines.includes(line) ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: C.dim }}>{i + 1}.</span>
              <span>{name(r.lines[0])} ↔ {name(r.lines[1])}</span>
              {i === governing && <span data-governing style={{ color: C.text, fontSize: 11 }}>管这一端</span>}
              <select data-join-mode value={r.mode} onChange={e => {
                const mode = e.target.value as typeof r.mode
                run?.(ed => ed.join(point, r.lines[0], r.lines[1], mode === 'arc' ? { mode, radius: r.radius ?? toolRadius } : { mode }))
              }} style={{ marginLeft: 'auto' }}>
                {MODES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            {r.mode === 'arc' && r.radius !== undefined && <Slider label="半径" value={r.radius} identity={`${ident}|radius`} accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
              fieldAttrs={{ 'data-join-radius': r.lines.join('↔') }} {...slider} onPreview={() => {}} onCommit={v => run?.(ed => ed.join(point, r.lines[0], r.lines[1], { mode: 'arc', radius: v }))} onCancel={() => {}} />}
            {z && <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: C.dim }}>
              <span>过渡区</span>
              <label><input type="checkbox" data-join-zone-manual={r.lines.join('↔')} checked={z.manual}
                onChange={e => run?.(ed => ed.zone(point, r.lines[0], r.lines[1], e.target.checked ? Number(fmt(z.desired)) : null))} /> 手动</label>
              {z.manual
                ? <Slider value={z.desired} identity={`${ident}|zone`} accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
                    fieldAttrs={{ 'data-join-zone': r.lines.join('↔') }} {...slider} onPreview={() => {}} onCommit={v => run?.(ed => ed.zone(point, r.lines[0], r.lines[1], v))} onCancel={() => {}} />
                : <span data-join-zone-auto={r.lines.join('↔')}>自动 {fmt(z.desired)}</span>}
              <span data-join-zone-limited={r.lines.join('↔')}>限长后 {fmt(z.limited)}</span>
            </div>}
          </div>
        )
      })}
      {unjoined.length > 0 && <div style={{ color: C.dim }}>相接、无接法：{unjoined.map(name).join('、')}</div>}
      {atPoint.some(id => mirrored.has(id)) && <div data-mirror-note style={{ color: C.warn }}>镜像对侧的顺序不同步</div>}
    </div>
  )
}
