// Layers panel in the look of Adobe's (bowen 1791550416, 1791550512): on the right, dark,
// one row per layer with eye, lock, thumbnail, name and a tag bar; layers expand to their
// continuous curves; rows drag to reorder; buttons along the bottom. Visual UI only: every
// change is a one-shot core operation through `run` (doc 22 §3.5). No visual principles yet,
// so this lives in the bench's ui folder until they exist.
import { useState } from 'react'
import type { Snapshot, Geometry, Editor, Vec } from '../../../src'

type Id = string
const C = { bg: '#323232', row: '#3c3c3c', active: '#4b5f7c', text: '#ddd', dim: '#8a8a8a', line: '#262626', thumb: '#fff', icon: '#c8c8c8' }

const Icon = ({ d, on = true, title, onClick }: { d: string; on?: boolean; title: string; onClick?: (e: React.MouseEvent) => void }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" onClick={onClick} style={{ cursor: 'pointer', flex: 'none', opacity: on ? 1 : 0.25 }}>
    <title>{title}</title><path d={d} fill="none" stroke={C.icon} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const EYE = 'M1.5 8 C4 3.5 12 3.5 14.5 8 C12 12.5 4 12.5 1.5 8 Z M8 6 a2 2 0 1 0 0.01 0'
const LOCK = 'M4 7.5 h8 v6 h-8 z M5.5 7.5 v-2 a2.5 2.5 0 0 1 5 0 v2'
const MIRROR = 'M8 2 v12 M6 4 L2 8 L6 12 M10 4 L14 8 L10 12'
const PLUS = 'M8 3 v10 M3 8 h10'
const COPY = 'M5 5 h8 v8 h-8 z M3 11 v-8 h8'
const TRASH = 'M3 4.5 h10 M6 4.5 v-2 h4 v2 M4.5 4.5 l1 9 h5 l1 -9'
const FILL = 'M3 3 h10 v10 h-10 z M3 8 h10 M8 3 v10'
const TWIRL_OPEN = 'M4 6 L8 10 L12 6', TWIRL_SHUT = 'M6 4 L10 8 L6 12'

interface Props {
  s: Snapshot
  g: Geometry
  active: Id
  setActive: (id: Id) => void
  run: (fn: (e: Editor) => void) => boolean
  newLayerId: () => Id
}

export function LayersPanel({ s, g, active, setActive, run, newLayerId }: Props) {
  const [open, setOpen] = useState<Set<Id>>(new Set())
  const [editing, setEditing] = useState<Id | null>(null)
  const [dragging, setDragging] = useState<Id | null>(null)
  const layerOf = new Map(s.points.map(p => [p.id, p.layer]))
  const linesIn = (layer: Id) => s.lines.filter(l => layerOf.get(l.a) === layer)
  const paired = new Set(s.mirrorPairs.flatMap(p => [p.a, p.b]))

  // every thumbnail shows its layer inside the same frame: the bounds of the whole drawing
  const pts = g.lines.flatMap(l => l.curve)
  const box = pts.length
    ? { x: Math.min(...pts.map(p => p.x)), y: Math.min(...pts.map(p => p.y)), w: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), h: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) }
    : { x: -1, y: -1, w: 2, h: 2 }
  const pad = Math.max(box.w, box.h) * 0.08 + 1
  const path = (c: readonly Vec[]) => `M${c[0]!.x},${c[0]!.y} C${c[1]!.x},${c[1]!.y} ${c[2]!.x},${c[2]!.y} ${c[3]!.x},${c[3]!.y}`
  const Thumb = ({ lines }: { lines: Id[] }) => {
    const set = new Set(lines)
    return <svg width={38} height={28} viewBox={`${box.x - pad} ${box.y - pad} ${box.w + 2 * pad} ${box.h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" style={{ background: C.thumb, flex: 'none', border: `1px solid ${C.line}` }}>
      {g.fills.filter(f => f.visible && s.loops.find(l => l.id === f.id)?.route.every(u => set.has(u.line))).map(f =>
        <path key={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'} fill={f.color} />)}
      {g.lines.filter(l => set.has(l.id)).map(l => <path key={l.id} d={path(l.curve)} fill="none" stroke="#111" strokeWidth={Math.max(box.w, box.h) / 40 + 0.5} />)}
    </svg>
  }

  const all = (ids: Id[], f: (id: Id) => boolean) => ids.length > 0 && ids.every(f)
  // Enter or leaving the field commits once; a taken or empty name is refused by core and shown in the status line
  const rename = (id: Id, old: string, value: string) => {
    if (editing !== id) return
    setEditing(null)
    const n = value.trim()
    if (n && n !== old) run(x => x.renameLayer(id, n))
  }
  const layers = [...s.layers].reverse() // top first, as Adobe lists them
  const activeLayer = s.layers.find(l => l.id === active)

  return (
    <div style={{ width: 270, background: C.bg, color: C.text, display: 'flex', flexDirection: 'column', font: '12px system-ui, sans-serif', borderLeft: `1px solid ${C.line}` }}>
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.line}`, fontWeight: 600, letterSpacing: 0.3 }}>图层</div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {layers.map(L => {
          const lines = linesIn(L.id), ids = lines.map(l => l.id)
          const shown = !all(ids, id => !s.lines.find(l => l.id === id)!.state.visible)
          const locked = all(ids, id => s.lines.find(l => l.id === id)!.state.locked)
          const mirrored = ids.some(id => paired.has(id))
          const isOpen = open.has(L.id), groups = s.groups.filter(gr => gr.layer === L.id)
          return <div key={L.id}>
            <div draggable onDragStart={() => setDragging(L.id)} onDragEnd={() => setDragging(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragging && dragging !== L.id) run(x => x.reorderLayer(dragging, s.layers.findIndex(l => l.id === L.id))); setDragging(null) }}
              onClick={() => setActive(L.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: L.id === active ? C.active : C.row, borderBottom: `1px solid ${C.line}`, opacity: dragging === L.id ? 0.5 : 1 }}>
              <Icon d={EYE} on={shown} title={shown ? '隐藏图层' : '显示图层'} onClick={e => { e.stopPropagation(); run(x => x.layerState(L.id, { visible: !shown })) }} />
              <Icon d={LOCK} on={locked} title={locked ? '解锁图层' : '锁定图层'} onClick={e => { e.stopPropagation(); run(x => x.layerState(L.id, { locked: !locked })) }} />
              <Icon d={isOpen ? TWIRL_OPEN : TWIRL_SHUT} title="展开" onClick={e => { e.stopPropagation(); setOpen(o => { const n = new Set(o); if (n.has(L.id)) n.delete(L.id); else n.add(L.id); return n }) }} />
              <Thumb lines={ids} />
              {editing === L.id
                ? <input autoFocus defaultValue={L.name} style={{ flex: 1, minWidth: 0, background: '#1e1e1e', color: C.text, border: '1px solid #666' }}
                  onBlur={e => rename(L.id, L.name, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') rename(L.id, L.name, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditing(null) }} />
                : <span onDoubleClick={() => setEditing(L.id)} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="双击改名">{L.name}</span>}
              {mirrored && <Icon d={MIRROR} title="含镜像联动" />}
              <span style={{ color: C.dim, flex: 'none' }}>{lines.length}</span>
            </div>
            {isOpen && groups.map(gr => {
              const gShown = !all(gr.lines, id => !s.lines.find(l => l.id === id)!.state.visible)
              const gLocked = all(gr.lines, id => s.lines.find(l => l.id === id)!.state.locked)
              return <div key={gr.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 30px', background: '#353535', borderBottom: `1px solid ${C.line}` }}>
                <Icon d={EYE} on={gShown} title={gShown ? '隐藏曲线' : '显示曲线'} onClick={() => run(x => x.groupState(gr.id, { visible: !gShown }))} />
                <Icon d={LOCK} on={gLocked} title={gLocked ? '解锁曲线' : '锁定曲线'} onClick={() => run(x => x.groupState(gr.id, { locked: !gLocked }))} />
                <Thumb lines={gr.lines} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} title="点击选中这条连续曲线"
                  onClick={() => run(x => x.selectGroup(gr.lines[0]!))}>{gr.name}</span>
                {gr.lines.some(id => paired.has(id)) && <Icon d={MIRROR} title="镜像联动" />}
              </div>
            })}
          </div>
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '6px 10px', borderTop: `1px solid ${C.line}`, alignItems: 'center' }}>
        <span style={{ color: C.dim, flex: 1 }}>{s.layers.length} 个图层</span>
        <Icon d={FILL} title="当前图层的填充：开 / 关" onClick={() => {
          if (!activeLayer) return
          const fillsShown = s.loops.some(l => l.filled && l.visible && linesIn(activeLayer.id).some(x => x.id === l.route[0]?.line))
          run(x => x.layerFills(activeLayer.id, { visible: !fillsShown }))
        }} />
        <Icon d={PLUS} title="新建图层" onClick={() => { const id = newLayerId(); if (run(x => x.layer(id, id, active || undefined))) setActive(id) }} />
        <Icon d={COPY} title="复制当前图层" onClick={() => { if (activeLayer) run(x => x.copyLayer(activeLayer.id, newLayerId())) }} />
        <Icon d={TRASH} title="删除当前图层" onClick={() => { if (activeLayer) run(x => x.deleteLayer(activeLayer.id)) }} />
      </div>
    </div>
  )
}
