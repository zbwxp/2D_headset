// Properties panel (bowen 1791599608; v1 7205381 src/ui/drawing/DrawingPropertiesPanel.tsx): below the
// layers list, foldable; shows what is attached to the unit last clicked in the list (a layer, a
// continuous curve or a line). Read-only for now, with a placeholder where more properties will go.
// Visual UI only; no visual principles yet.
import { useState } from 'react'
import type { Snapshot, Zones, Editor } from '../src'
import { JoinList, type SliderHooks } from './JoinList'
import { Slider } from '../slider'

type Id = string
export type Subject = { kind: 'layer' | 'group' | 'line' | 'point'; id: Id }
const C = { bg: '#2b2b2b', line: '#262626', text: '#ddd', dim: '#8a8a8a', key: '#9a9a9a' }
const JOIN: Record<string, string> = { smooth: '平滑', cusp: '尖角', arc: '圆弧' }

export function PropertiesPanel({ s, subject, zones = [], run, slider, toolRadius, scope }: {
  s: Snapshot; subject: Subject | null
  /** The joins' zones in this view (J1b): the join lists show them. */
  zones?: Zones
  /** Edits through the app (the current view); without it the join lists are read-only. */
  run?: (fn: (e: Editor) => void) => boolean
  slider?: SliderHooks
  /** A join set to 圆弧 here takes the Join tool's radius. */
  toolRadius?: number
  /** The drawing and the view the join values belong to (controls' identity). */
  scope?: string
}) {
  const [open, setOpen] = useState(true)
  const layerOf = new Map(s.points.map(p => [p.id, p.layer]))
  const lineLayer = (id: Id) => layerOf.get(s.lines.find(l => l.id === id)?.a ?? '')
  const layerName = (id: Id | undefined) => s.layers.find(l => l.id === id)?.name ?? '—'
  const groupOf = (line: Id) => s.groups.find(g => g.lines.includes(line))
  const paired = new Set(s.mirrorPairs.flatMap(p => [p.a, p.b]))
  const state = (ids: Id[]) => {
    const ls = s.lines.filter(l => ids.includes(l.id))
    const v = ls.filter(l => l.state.visible).length, k = ls.filter(l => l.state.locked).length
    return `${v === ls.length ? '显示' : v ? '部分显示' : '隐藏'} · ${k === ls.length && k ? '锁定' : k ? '部分锁定' : '未锁定'}`
  }
  const fillsOf = (ids: Id[]) => s.loops.filter(l => l.filled && l.route.every(u => ids.includes(u.line)))

  let title = '未选择', rows: [string, string][] = [], lists: { label: string; point: Id; line?: Id }[] = []
  // widths belong to points (bowen 1791820396): each field edits one point's width in this view
  let widthRows: { label: string; point: Id; value: number; attr: string }[] = []
  let taperOf: { point: Id; value: number; end?: Snapshot["points"][number]["endStroke"] } | null = null
  if (subject?.kind === 'layer' && s.layers.some(l => l.id === subject.id)) {
    const ids = s.lines.filter(l => layerOf.get(l.a) === subject.id).map(l => l.id)
    title = `图层 · ${layerName(subject.id)}`
    rows = [
      ['连续曲线', String(s.groups.filter(g => g.layer === subject.id).length)],
      ['线', String(ids.length)],
      ['状态', ids.length ? state(ids) : '—'],
      ['填充', String(fillsOf(ids).length)],
      ['镜像联动', ids.some(id => paired.has(id)) ? '有' : '无'],
    ]
  } else if (subject?.kind === 'group' && s.groups.some(g => g.id === subject.id)) {
    const g = s.groups.find(x => x.id === subject.id)!
    title = `连续曲线 · ${g.name}`
    rows = [
      ['图层', layerName(g.layer)],
      ['线', g.lines.map(id => s.lines.find(l => l.id === id)?.name ?? id).join(' · ')],
      ['状态', state(g.lines)],
      ['填充', fillsOf(g.lines).map(f => f.color).join(' · ') || '无'],
      ['镜像联动', g.lines.some(id => paired.has(id)) ? '有' : '无'],
    ]
  } else if (subject?.kind === 'line' && s.lines.some(l => l.id === subject.id)) {
    const l = s.lines.find(x => x.id === subject.id)!
    // each end: the join with the next line, or at an open end its end stroke (an open end belongs to one line; bowen 1791557998)
    const end = (e: 'a' | 'b') => {
      const pt = l[e], p = s.points.find(x => x.id === pt)
      const others = s.lines.filter(x => x.id !== l.id && (x.a === pt || x.b === pt))
      const join = s.joins.find(j => j.point === pt && j.lines.includes(l.id))
      const how = others.length ? `接 ${others.map(o => o.name).join('、')}：${join ? JOIN[join.mode] ?? join.mode : '相接'}${join?.radius !== undefined ? ` r${join.radius}` : ''}`
        : p?.endStroke ? `开放 · 笔触 ${JSON.stringify(p.endStroke)}` : '开放 · 无笔触'
      return `${how}${p?.links.length ? ` · 联动 ${p.links.join('、')}` : ''}`
    }
    title = `线 · ${l.name}`
    // the width is edited here, in this view (bowen 1791814093: the line's own properties); typed values commit with Enter
    if (run) widthRows = [{ label: '起点宽', point: l.a, value: l.stroke.width, attr: 'data-line-width' }, { label: '终点宽', point: l.b, value: l.stroke.widthB ?? l.stroke.width, attr: 'data-line-width-b' }]
    rows = [
      ['连续曲线', groupOf(l.id)?.name ?? '—'],
      ['图层', layerName(lineLayer(l.id))],
      // two end widths (bowen 1791818995): 起点 = the a end, 终点 = the b end
      ...(run ? [] : [['线宽', l.stroke.widthB === undefined ? String(l.stroke.width) : `${l.stroke.width} → ${l.stroke.widthB}`] as [string, string]]),
      ['轮廓', l.stroke.profile || '—'],
      ['状态', state([l.id])],
      ['起点 a', end('a')],
      ['终点 b', end('b')],
      ['镜像联动', paired.has(l.id) ? '有' : '无'],
    ]
    // each shared end: its point's join list, top first (J1b)
    for (const [e, label] of [['a', '起点 a 的接法'], ['b', '终点 b 的接法']] as const) {
      if (s.lines.some(x => x.id !== l.id && (x.a === l[e] || x.b === l[e]))) lists.push({ label, point: l[e], line: l.id })
    }
  } else if (subject?.kind === 'point' && s.points.some(p => p.id === subject.id)) {
    const at = s.lines.filter(l => l.a === subject.id || l.b === subject.id)
    title = `点 · ${subject.id}`
    rows = [['图层', layerName(layerOf.get(subject.id))], ['相接的线', at.map(l => l.name).join('、') || '—'], ...(run ? [] : [['宽度', String(s.points.find(p => p.id === subject.id)!.width)] as [string, string]])]
    if (run) widthRows = [{ label: '宽度', point: subject.id, value: s.points.find(p => p.id === subject.id)!.width, attr: 'data-point-width' }]
    // a free end (exactly one line end here, hidden lines counted) tapers to a point: its length as a multiple of its
    // width, this view (bowen 1791853511; absent = 3, 0 = a round end)
    const ends = s.lines.reduce((n, l) => n + Number(l.a === subject.id) + Number(l.b === subject.id), 0)
    if (run && ends === 1) { const e = s.points.find(p => p.id === subject.id)!.endStroke; taperOf = { point: subject.id, value: typeof e?.taper === 'number' ? e.taper : 3, end: e } }
    lists.push({ label: '接法', point: subject.id })
  }

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, background: C.bg, color: C.text, flex: 'none', maxHeight: '45%', overflow: 'auto' }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: '6px 10px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} title={open ? '收起属性' : '展开属性'}>
        {open ? '▾' : '▸'} 属性 <span style={{ color: C.dim, fontWeight: 400 }}>{title}</span>
      </div>
      {open && <div style={{ padding: '0 10px 8px' }} data-testid="properties">
        {rows.map(([k, v]) => <div key={k} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
          <span style={{ color: C.key, width: 64, flex: 'none' }}>{k}</span><span style={{ wordBreak: 'break-all' }}>{v}</span>
        </div>)}
        {widthRows.map(w =>
          <div key={w.label} style={{ display: 'flex', gap: 8, padding: '2px 0', alignItems: 'center' }}>
            <span style={{ color: C.key, width: 64, flex: 'none' }}>{w.label}</span>
            <Slider value={w.value} identity={`${scope ?? ''}|${w.point}|point-width`} accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
              fieldAttrs={{ [w.attr]: subject?.id ?? w.point }} {...(slider ?? { onStart: () => true, onEnd: () => {}, onField: () => {} })} onPreview={() => {}}
              onCommit={v => { run?.(e => e.pointWidth(w.point, v)) }} onCancel={() => {}} />
            <span style={{ color: C.dim, fontSize: 11 }} title="宽度属于点：接在这个点上的线一起变">本视角 · 点 {w.point}</span>
          </div>)}
        {taperOf && <div style={{ display: 'flex', gap: 8, padding: '2px 0', alignItems: 'center' }}>
          <span style={{ color: C.key, width: 64, flex: 'none' }}>收尖</span>
          <Slider value={taperOf.value} identity={`${scope ?? ''}|${taperOf.point}|taper`} accept={v => v >= 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
            fieldAttrs={{ 'data-point-taper': taperOf.point }} {...(slider ?? { onStart: () => true, onEnd: () => {}, onField: () => {} })} onPreview={() => {}}
            onCommit={v => { const t = taperOf!; run?.(e => e.endStroke(t.point, { ...t.end, taper: v })) }} onCancel={() => {}} />
          <span style={{ color: C.dim, fontSize: 11 }} title="收尖长度 = 这个数 × 端点宽度；0 = 圆头">× 宽 · 本视角</span>
        </div>}
        {lists.map(x => <div key={x.label + x.point}>
          <div style={{ color: C.key, padding: '4px 0 0' }}>{x.label}</div>
          <JoinList s={s} zones={zones} point={x.point} line={x.line} run={run} slider={slider} toolRadius={toolRadius} scope={scope} />
        </div>)}
        {/* more properties go here as they are settled (bowen 1791599608: a placeholder for now) */}
        <div style={{ color: C.dim, padding: '6px 0 0', fontStyle: 'italic' }}>更多属性（待定）</div>
      </div>}
    </div>
  )
}
