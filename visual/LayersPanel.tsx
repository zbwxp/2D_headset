// Layers panel in the look of Adobe's (bowen 1791550416, 1791550512): on the right, dark,
// one row per layer with eye, lock, thumbnail, name and a tag bar; layers expand to their
// continuous curves; rows drag to reorder; buttons along the bottom. Visual UI only: every
// change is a one-shot core operation through `run` (doc 22 §3.5). Part of the visual package
// (docs/visual-plan.md); no visual principles yet.
import { useEffect, useRef, useState } from 'react'
import type { Snapshot, Geometry, Zones, Editor, Vec } from '../src'
import { PropertiesPanel, type Subject } from './PropertiesPanel'
import type { SliderHooks } from './JoinList'
import { Rename } from '../rename'

type Id = string
const C = { bg: '#323232', row: '#3c3c3c', active: '#4b5f7c', selected: '#3f4b5c', text: '#ddd', dim: '#8a8a8a', line: '#262626', thumb: '#fff', icon: '#c8c8c8' }

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
// a paint bucket: fills of every layer on / off (bowen 1791557559: a clearer icon than the split square)
const FILL = 'M2.5 7.5 L7.5 2.5 L12.5 7.5 L7.5 12.5 Z M2.5 7.5 h10 M14 10 c0 1.5 -1.5 1.5 -1.5 0 c0 -1 0.75 -1.8 0.75 -1.8 c0 0 0.75 0.8 0.75 1.8'
// fold / unfold every layer
const FOLD_ALL = 'M4 2 L8 6 L12 2 M4 14 L8 10 L12 14', UNFOLD_ALL = 'M4 6 L8 2 L12 6 M4 10 L8 14 L12 10'
const TWIRL_OPEN = 'M4 6 L8 10 L12 6', TWIRL_SHUT = 'M6 4 L10 8 L6 12'

interface Props {
  s: Snapshot
  g: Geometry
  /** The selected layers (at least one) and the current one among them (docs/layer-scope-plan.md §1). */
  selected: Id[]
  active: Id
  select: (layers: Id[], current: Id) => void
  run: (fn: (e: Editor) => void) => boolean
  newLayerId: () => Id
  /** A line row or a curve row was clicked (the app's name labels follow it; docs/name-labels-plan.md). */
  onPick?: (kind: 'line' | 'curve') => void
  /** The joins' zones in this view, the program's slider hooks and the Join tool's radius (the join lists, J1b). */
  zones?: Zones
  slider?: SliderHooks
  toolRadius?: number
  /** The canvas's single selected line or point: when it changes, the properties show it (the last of a canvas pick and a list click wins). */
  canvasSubject?: Subject | null
  /** The drawing and the view shown: the join controls' identity, so a draft never crosses views. */
  joinScope?: string
  /** A count of canvas picks: a new pick of the same object shows it again after a list click (dot). */
  canvasPicks?: number
}

export function LayersPanel({ s, g, selected, active, select, run, newLayerId, onPick, zones, slider, toolRadius, canvasSubject, joinScope, canvasPicks = 0 }: Props) {
  const [open, setOpen] = useState<Set<Id>>(new Set())
  const [anchor, setAnchor] = useState<Id | null>(null)
  const [rowAnchor, setRowAnchor] = useState<Id | null>(null)
  // the unit whose properties show below: the last layer, curve or line clicked (bowen 1791599608)
  const [subject, setSubject] = useState<Subject | null>(null)
  // a canvas pick of one line or point shows it; a later list click keeps its own subject until the canvas pick changes
  // again. A pick the list click itself made (its line, or a line of its curve) leaves the clicked item showing.
  const canvasKey = canvasSubject ? `${canvasSubject.kind}:${canvasSubject.id}` : ''
  const covers = (x: Subject, y: Subject) => (x.kind === y.kind && x.id === y.id)
    || (x.kind === 'group' && y.kind === 'line' && !!s.groups.find(gr => gr.id === x.id)?.lines.includes(y.id))
  const lastPicks = useRef(canvasPicks)
  useEffect(() => {
    // a new canvas pick shows its object whatever the panel showed; a selection the list click itself made does not take the panel back
    const picked = canvasPicks !== lastPicks.current
    lastPicks.current = canvasPicks
    if (canvasSubject && (picked || !(subject && covers(subject, canvasSubject)))) setSubject(canvasSubject)
  }, [canvasKey, canvasPicks]) // eslint-disable-line react-hooks/exhaustive-deps
  const selLines = new Set(s.selection.flatMap(u => (u.kind === 'line' ? [u.id] : [])))
  /**
   * A click on a continuous curve or a line row picks it as V / A would (bowen 1791558186): plain =
   * only this; Shift = the run from the last row clicked to this one, among the rows of its kind shown
   * in the list, across layers (bowen 1791897991); Cmd / Ctrl = add or remove this one. Picking in a
   * layer that is not selected adds that layer to the selected layers (bowen 1791558438: picking in the
   * list is the surest way; an element pick adds its layer) — every layer a Shift run reaches — and
   * never takes one away.
   */
  const pickRows = (rows: { id: Id; lines: Id[]; layer: Id }[], id: Id, e: React.MouseEvent, layer: Id, kind: 'group' | 'line') => {
    setSubject({ kind, id })
    onPick?.(kind === 'group' ? 'curve' : 'line')
    const at = rows.findIndex(r => r.id === id), from = rows.findIndex(r => r.id === rowAnchor)
    const units = (rs: typeof rows) => rs.flatMap(r => r.lines.map(l => ({ kind: 'line' as const, id: l })))
    const reach = (ls: Id[]) => { const add = [...new Set(ls)].filter(l => !selected.includes(l)); if (add.length) select([...selected, ...add], active) }
    if (e.shiftKey && from >= 0) {
      const run_ = rows.slice(Math.min(from, at), Math.max(from, at) + 1)
      reach(run_.map(r => r.layer))
      run(x => x.select(units(run_), 'replace'))
      return
    }
    reach([layer])
    setRowAnchor(id)
    const row = rows[at]!
    if (e.metaKey || e.ctrlKey) { run(x => x.select(units([row]), row.lines.every(l => selLines.has(l)) ? 'remove' : 'add')); return }
    run(x => x.select(units([row]), 'replace'))
  }
  /**
   * A row click, as on macOS (bowen 1791555800; dot 1791555851): a plain click selects only this
   * layer; Shift selects the run from the anchor to it; Cmd (or Ctrl) adds or removes it. At least
   * one layer stays selected. The anchor is the last row clicked without Shift; the clicked row
   * becomes current, and a removed current hands over to the topmost layer still selected.
   */
  const click = (id: Id, e: React.MouseEvent) => {
    setSubject({ kind: 'layer', id })
    const order = s.layers.map(l => l.id)
    if (e.shiftKey) {
      const from = order.indexOf(anchor && order.includes(anchor) ? anchor : active), to = order.indexOf(id)
      select(order.slice(Math.min(from, to), Math.max(from, to) + 1), id)
      return
    }
    setAnchor(id)
    if (e.metaKey || e.ctrlKey) {
      if (!selected.includes(id)) { select([...selected, id], id); return }
      if (selected.length === 1) return
      const rest = selected.filter(x => x !== id)
      select(rest, id === active ? order.filter(x => rest.includes(x)).at(-1)! : active)
      return
    }
    select([id], id)
  }
  // dragging rows (bowen 1791865224, "common sense" as in Adobe's panel): a layer drops above or below another
  // layer, by the half of the row under the cursor, shown by a line; a continuous curve drops above or below
  // another curve (in any layer), or onto a layer's row: into that layer, on top
  type Drag = { kind: 'layer' | 'group'; id: Id }
  type Target = { id: Id; at: 'above' | 'below' | 'into' }
  const [drag, setDrag] = useState<Drag | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const half = (e: React.DragEvent) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'above' as const : 'below' as const }
  // a row that is no place to drop clears the mark and the target (dot 1791865974)
  const over = (e: React.DragEvent, t: Target | null) => {
    if (!t) { if (target) setTarget(null); return }
    e.preventDefault()
    if (target?.id !== t.id || target.at !== t.at) setTarget(t)
  }
  const start = (e: React.DragEvent, d: Drag) => {
    e.stopPropagation()
    e.dataTransfer?.setData('text/plain', d.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    setDrag(d)
  }
  const end = () => { setDrag(null); setTarget(null) }
  /** The new index in a bottom → top list without the dragged item; null when nothing moves. */
  const slot = (order: Id[], id: Id, t: Target) => {
    const rest = order.filter(x => x !== id), i = rest.indexOf(t.id) + (t.at === 'above' ? 1 : 0)
    return i === order.indexOf(id) ? null : i
  }
  /** A drop acts only on the row it lands on, and only where that row is the current target. */
  const drop = (e: React.DragEvent, on: Id) => {
    e.preventDefault()
    const d = drag, t = target
    end()
    if (!d || !t || t.id !== on) return
    if (d.kind === 'layer') {
      const i = slot(s.layers.map(l => l.id), d.id, t)
      if (i !== null) run(x => x.reorderLayer(d.id, i))
      return
    }
    if (t.at === 'into') { run(x => x.moveGroup(d.id, t.id)); return }
    const layer = s.groups.find(x => x.id === t.id)!.layer, from = s.groups.find(x => x.id === d.id)!.layer
    const order = s.groups.filter(x => x.layer === layer).map(x => x.id)
    if (from === layer) { const i = slot(order, d.id, t); if (i !== null) run(x => x.reorderGroup(d.id, i)); return }
    // another layer: cut in (it lands on top), then placed; one edit
    const i = slot(order, d.id, t)!
    run(x => { x.moveGroup(d.id, layer); x.reorderGroup(d.id, i) })
  }
  const mark = (id: Id) => target?.id !== id ? undefined
    : target.at === 'into' ? 'inset 0 0 0 2px #8fb4ff' : target.at === 'above' ? 'inset 0 2px 0 #8fb4ff' : 'inset 0 -2px 0 #8fb4ff'
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
      {/* in the canvas's order: curve by curve, bottom → top, each its fills then its lines */}
      {s.groups.filter(gr => gr.lines.some(id => set.has(id))).map(gr => <g key={gr.id}>
        {g.fills.filter(f => f.visible && s.loops.find(l => l.id === f.id)?.route.every(u => set.has(u.line) && gr.lines.includes(u.line))).map(f =>
          <path key={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'} fill={f.color} />)}
        {g.lines.filter(l => set.has(l.id) && gr.lines.includes(l.id)).map(l => <path key={l.id} d={path(l.curve)} fill="none" stroke="#111" strokeWidth={Math.max(box.w, box.h) / 40 + 0.5} />)}
      </g>)}
    </svg>
  }

  const all = (ids: Id[], f: (id: Id) => boolean) => ids.length > 0 && ids.every(f)
  // every name is renamed one way, by double-click (rename/, bowen 1791708333); a taken name is refused by
  // core and shown in the status line
  const field = { background: '#1e1e1e', color: C.text, border: '1px solid #666' }
  const layers = [...s.layers].reverse() // top first, as Adobe lists them
  // the rows the list shows, top to bottom, across layers: the run a Shift click takes (bowen 1791897991)
  const groupRows = layers.filter(L => open.has(L.id)).flatMap(L => s.groups.filter(gr => gr.layer === L.id).reverse().map(gr => ({ id: gr.id, lines: gr.lines, layer: L.id })))
  const lineRows = groupRows.filter(gr => open.has(gr.id)).flatMap(gr => gr.lines.map(l => ({ id: l, lines: [l], layer: gr.layer })))
  const activeLayer = s.layers.find(l => l.id === active)
  const fillsShown = s.loops.some(l => l.filled && l.visible)
  // every layer at once (bowen 1791865192): any line shown → hide all; all hidden → show all
  const anyShown = s.lines.some(l => l.state.visible)
  const allOpen = s.layers.length > 0 && s.layers.every(l => open.has(l.id))
  const toggle = (id: Id) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // what is attached to each line, shown on its row (bowen 1791557998): its width, and at each end either the
  // join with the next line or, at an open end, its end stroke (an open end belongs to one line only)
  const pointOf = new Map(s.points.map(p => [p.id, p]))
  const ends = (l: Snapshot['lines'][number]) => (['a', 'b'] as const).map(end => {
    const pt = l[end], others = s.lines.filter(x => x.id !== l.id && (x.a === pt || x.b === pt))
    const join = s.joins.find(j => j.point === pt && j.lines.includes(l.id))
    const what = others.length ? (join ? ({ smooth: '平滑', cusp: '尖角', arc: '圆弧' } as Record<string, string>)[join.mode] ?? join.mode : '相接')
      : pointOf.get(pt)?.endStroke ? '笔触' : '开放'
    return `${end}:${what}${pointOf.get(pt)?.links.length ? '·联动' : ''}`
  })

  return (
    <div style={{ width: 270, background: C.bg, color: C.text, display: 'flex', flexDirection: 'column', font: '12px system-ui, sans-serif', borderLeft: `1px solid ${C.line}` }}>
      {/* the buttons sit beside the title (bowen 1791551539, 1791557559); fills and fold act on every layer */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${C.line}` }}>
        <span style={{ fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>图层 <span style={{ color: C.dim, fontWeight: 400 }}>{s.layers.length}</span></span>
        <Icon d={EYE} on={anyShown} title={anyShown ? '隐藏全部图层（Option 点某个图层的眼睛：只显示它）' : '显示全部图层'} onClick={() => run(x => s.layers.forEach(L => x.layerState(L.id, { visible: !anyShown })))} />
        <Icon d={FILL} on={fillsShown} title={fillsShown ? '隐藏全部图层的填充' : '显示全部图层的填充'} onClick={() => run(x => s.layers.forEach(L => x.layerFills(L.id, { visible: !fillsShown })))} />
        <Icon d={allOpen ? FOLD_ALL : UNFOLD_ALL} title={allOpen ? '收起全部图层' : '展开全部图层'} onClick={() => setOpen(allOpen ? new Set() : new Set(s.layers.map(l => l.id)))} />
        <Icon d={PLUS} title="新建图层" onClick={() => { const id = newLayerId(); if (run(x => x.layer(id, id, active || undefined))) select([id], id) }} />
        <Icon d={COPY} title="复制当前图层" onClick={() => { if (activeLayer) run(x => x.copyLayer(activeLayer.id, newLayerId())) }} />
        <Icon d={TRASH} title="删除当前图层" onClick={() => { if (activeLayer) run(x => x.deleteLayer(activeLayer.id)) }} />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null) }}>
        {layers.map(L => {
          const lines = linesIn(L.id), ids = lines.map(l => l.id)
          const shown = !all(ids, id => !s.lines.find(l => l.id === id)!.state.visible)
          const locked = all(ids, id => s.lines.find(l => l.id === id)!.state.locked)
          const mirrored = ids.some(id => paired.has(id))
          const isOpen = open.has(L.id), groups = s.groups.filter(gr => gr.layer === L.id).reverse() // top first, as the layers
          return <div key={L.id}>
            <div data-layer-row={L.id} data-drop={target?.id === L.id ? target.at : undefined} draggable onDragStart={e => start(e, { kind: 'layer', id: L.id })} onDragEnd={end}
              onDragOver={e => over(e, drag?.kind === 'layer' ? (drag.id === L.id ? null : { id: L.id, at: half(e) })
                : drag && s.groups.find(x => x.id === drag.id)?.layer !== L.id ? { id: L.id, at: 'into' } : null)}
              onDrop={e => drop(e, L.id)}
              onClick={e => click(L.id, e)}
              // selected rows stay lit; the current one is drawn stronger, with a bar on its left
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: L.id === active ? C.active : selected.includes(L.id) ? C.selected : C.row,
                boxShadow: [L.id === active ? 'inset 3px 0 0 #8fb4ff' : '', mark(L.id) ?? ''].filter(Boolean).join(', ') || undefined, borderBottom: `1px solid ${C.line}`, opacity: drag?.id === L.id ? 0.5 : 1 }}>
              {/* Option (Alt) + click: this layer alone shown, every other hidden (Photoshop / Illustrator; bowen 1791865192) */}
              <Icon d={EYE} on={shown} title={shown ? '隐藏图层（Option 点：只显示这个图层）' : '显示图层（Option 点：只显示这个图层）'} onClick={e => { e.stopPropagation(); run(x => e.altKey ? s.layers.forEach(K => x.layerState(K.id, { visible: K.id === L.id })) : x.layerState(L.id, { visible: !shown })) }} />
              <Icon d={LOCK} on={locked} title={locked ? '解锁图层' : '锁定图层'} onClick={e => { e.stopPropagation(); run(x => x.layerState(L.id, { locked: !locked })) }} />
              <Icon d={isOpen ? TWIRL_OPEN : TWIRL_SHUT} title="展开" onClick={e => { e.stopPropagation(); toggle(L.id) }} />
              <Thumb lines={ids} />
              <Rename name={L.name} fieldStyle={field} onRename={n => run(x => x.renameLayer(L.id, n))} />
              {mirrored && <Icon d={MIRROR} title="含镜像联动" />}
              <span style={{ color: C.dim, flex: 'none' }}>{lines.length}</span>
            </div>
            {isOpen && groups.map(gr => {
              const gShown = !all(gr.lines, id => !s.lines.find(l => l.id === id)!.state.visible)
              const gLocked = all(gr.lines, id => s.lines.find(l => l.id === id)!.state.locked)
              const gOpen = open.has(gr.id)
              return <div key={gr.id}><div data-group-row={gr.id} data-drop={target?.id === gr.id ? target.at : undefined} draggable onDragStart={e => start(e, { kind: 'group', id: gr.id })} onDragEnd={end}
                onDragOver={e => over(e, drag?.kind === 'group' && drag.id !== gr.id ? { id: gr.id, at: half(e) } : null)} onDrop={e => drop(e, gr.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 22px', background: '#353535', borderBottom: `1px solid ${C.line}`, boxShadow: mark(gr.id), opacity: drag?.id === gr.id ? 0.5 : 1 }}>
                <Icon d={gOpen ? TWIRL_OPEN : TWIRL_SHUT} title={gOpen ? '收起' : '展开到每条线'} onClick={() => toggle(gr.id)} />
                <Icon d={EYE} on={gShown} title={gShown ? '隐藏曲线' : '显示曲线'} onClick={() => run(x => x.groupState(gr.id, { visible: !gShown }))} />
                <Icon d={LOCK} on={gLocked} title={gLocked ? '解锁曲线' : '锁定曲线'} onClick={() => run(x => x.groupState(gr.id, { locked: !gLocked }))} />
                <Thumb lines={gr.lines} />
                <Rename name={gr.name} fieldStyle={field} onRename={n => run(x => x.renameGroup(gr.id, n))} title="点击选中这条连续曲线（Shift 连选 · Cmd 增减）· 双击改名"
                  style={{ cursor: 'pointer', color: gr.lines.every(l => selLines.has(l)) ? '#8fb4ff' : undefined }}
                  onClick={e => pickRows(groupRows, gr.id, e, L.id, 'group')} />
                {gr.lines.some(id => paired.has(id)) && <Icon d={MIRROR} title="镜像联动" />}
                <span style={{ color: C.dim, flex: 'none' }}>{gr.lines.length}</span>
              </div>
              {/* the smallest unit is the line (bowen 1791557559): one row each, with what is attached to it */}
              {gOpen && gr.lines.map(id => {
                const l = s.lines.find(x => x.id === id)!
                return <div key={id} data-line={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 2px 52px', background: '#2e2e2e', borderBottom: `1px solid ${C.line}` }}>
                  <Icon d={EYE} on={l.state.visible} title={l.state.visible ? '隐藏线' : '显示线'} onClick={() => run(x => x.lineState(id, { visible: !l.state.visible }))} />
                  <Icon d={LOCK} on={l.state.locked} title={l.state.locked ? '解锁线' : '锁定线'} onClick={() => run(x => x.lineState(id, { locked: !l.state.locked }))} />
                  <Rename name={l.name} fieldStyle={field} onRename={n => run(x => x.renameLine(id, n))} title="点击选中这条线（Shift 连选 · Cmd 增减）· 双击改名"
                    style={{ cursor: 'pointer', color: selLines.has(id) ? '#8fb4ff' : undefined }}
                    onClick={e => pickRows(lineRows, id, e, L.id, 'line')} />
                  <span style={{ color: C.dim, flex: 'none', fontSize: 11 }} title="线宽（起点→终点）· 两端（相接方式或开放端点的笔触）">w{l.stroke.width}{l.stroke.widthB === undefined ? '' : `→${l.stroke.widthB}`} {ends(l).join(' ')}</span>
                  {paired.has(id) && <Icon d={MIRROR} title="镜像联动" />}
                </div>
              })}
              </div>
            })}
          </div>
        })}
      </div>
      <PropertiesPanel s={s} subject={subject ?? (active ? { kind: 'layer', id: active } : null)} selectedLayers={selected} zones={zones} run={run} slider={slider} toolRadius={toolRadius} scope={joinScope} />
    </div>
  )
}
