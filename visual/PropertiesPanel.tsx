// Properties panel (bowen 1791599608; v1 7205381 src/ui/drawing/DrawingPropertiesPanel.tsx): below the
// layers list, foldable; shows what is attached to the unit last clicked in the list (a layer, a
// continuous curve or a line). Read-only for now, with a placeholder where more properties will go.
// Visual UI only; no visual principles yet.
import { useState } from 'react'
import type { Snapshot } from '../src'

type Id = string
export type Subject = { kind: 'layer' | 'group' | 'line'; id: Id }
const C = { bg: '#2b2b2b', line: '#262626', text: '#ddd', dim: '#8a8a8a', key: '#9a9a9a' }
const JOIN: Record<string, string> = { smooth: '平滑', cusp: '尖角', arc: '圆弧' }

export function PropertiesPanel({ s, subject }: { s: Snapshot; subject: Subject | null }) {
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

  let title = '未选择', rows: [string, string][] = []
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
    rows = [
      ['连续曲线', groupOf(l.id)?.name ?? '—'],
      ['图层', layerName(lineLayer(l.id))],
      ['线宽', String(l.stroke.width)],
      ['轮廓', l.stroke.profile || '—'],
      ['状态', state([l.id])],
      ['起点 a', end('a')],
      ['终点 b', end('b')],
      ['镜像联动', paired.has(l.id) ? '有' : '无'],
    ]
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
        {/* more properties go here as they are settled (bowen 1791599608: a placeholder for now) */}
        <div style={{ color: C.dim, padding: '6px 0 0', fontStyle: 'italic' }}>更多属性（待定）</div>
      </div>}
    </div>
  )
}
