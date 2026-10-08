// Throwaway test bench (bowen 1791477975): only for trying the graph modules by hand and by AI.
// No quality bar. Uses core's public entry only; never change core for this file's sake.
import { createRoot } from 'react-dom/client'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Core, type Vec, type Snapshot, type Editor } from '../../src'

type Id = string
type Tool = 'V' | 'A' | 'pen' | 'split' | 'bind' | 'merge' | 'link' | 'unbind' | 'join' | 'fill'
type Unit = Snapshot['selection'][number]

const core = Core.newDocument({ axis: 0 })
let seq = 0
const nid = (p: string) => `${p}${++seq}`
const P = (x: number, y: number): Vec => ({ x, y })
const add = (a: Vec, b: Vec) => P(a.x + b.x, a.y + b.y)
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const cubicAt = (c: readonly Vec[], t: number) => {
  const u = 1 - t
  return P(u * u * u * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t * t * t * c[3]!.x,
    u * u * u * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t * t * t * c[3]!.y)
}
const nearestT = (c: readonly Vec[], at: Vec) => {
  let best = 0.5, bd = Infinity
  for (let i = 1; i < 200; i++) { const t = i / 200, d = dist(cubicAt(c, t), at); if (d < bd) { bd = d; best = t } }
  return best
}
const path = (c: readonly Vec[]) => `M${c[0]!.x},${c[0]!.y} C${c[1]!.x},${c[1]!.y} ${c[2]!.x},${c[2]!.y} ${c[3]!.x},${c[3]!.y}`
type LogRow = { calls: string; result: string }
const log: LogRow[] = []
const hist = (k: 'undo' | 'redo') => { const ok = k === 'undo' ? core.canUndo : core.canRedo; core[k](); log.unshift({ calls: k + '()', result: ok ? 'ok' : 'ok (nothing to ' + k + ')' }) }

function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [tool, setTool] = useState<Tool>('pen')
  const [layer, setLayer] = useState<Id>('layer-1')
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState<Id[]>([]) // clicked points for two-click tools; pen: last point
  const [joinMode, setJoinMode] = useState<'smooth' | 'cusp' | 'arc'>('smooth')
  const [radius, setRadius] = useState(10)
  const [color, setColor] = useState('#f2c94c')
  const [width, setWidth] = useState(2)
  const [source, setSource] = useState<Id[]>([])
  const [box, setBox] = useState({ x: -400, y: -300, w: 800, h: 600 })
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<null | { kind: 'move'; start: Vec } | { kind: 'pan'; start: Vec; box: typeof box }>(null)
  const [ghost, setGhost] = useState<Vec | null>(null) // drag offset: drawn only, nothing sent to core until release

  const s = core.snapshot(), g = core.geometry()
  const line = (id: Id) => s.lines.find(l => l.id === id)!
  const pos = (id: Id) => s.points.find(p => p.id === id)!.position
  const sel = s.selection
  const selLines = sel.filter(u => u.kind === 'line').map(u => (u as { id: Id }).id)
  const groupOf = (l: Id) => s.groups.find(gr => gr.lines.includes(l))!.id

  useEffect(() => {
    ;(window as unknown as { bench: unknown }).bench = { core, refresh: bump, svg: () => svg.current?.outerHTML, log }
  })

  const run = (fn: (e: Editor) => void, quiet = false) => {
    // every Editor call is logged with what core returned, so a bench mistake is not taken for a core one (dot)
    const calls: string[] = []
    const rec = (e: Editor) => new Proxy(e, { get: (t, k) => { const v = Reflect.get(t, k); return typeof v === 'function' ? (...a: unknown[]) => { calls.push(`${String(k)}(${a.map(x => JSON.stringify(x)).join(', ')})`); return v.apply(t, a) } : v } })
    try { core.edit(e => fn(rec(e))); if (!quiet) setMsg(''); log.unshift({ calls: calls.join('; '), result: 'ok' }); return true }
    catch (err) { const m = (err as Error).message; setMsg('✗ ' + m); log.unshift({ calls: calls.join('; '), result: '✗ ' + m }); return false }
    finally { log.length = Math.min(log.length, 50); bump() }
  }
  const toDoc = (e: { clientX: number; clientY: number }) => {
    const m = svg.current!.getScreenCTM()!.inverse()
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return P(p.x, p.y)
  }
  const startMove = (at: Vec) => { drag.current = { kind: 'move', start: at }; setGhost(null) }
  const mode = (e: React.PointerEvent) => (e.shiftKey ? 'add' : e.altKey ? 'remove' : 'replace') as 'add' | 'remove' | 'replace'

  const onPoint = (e: React.PointerEvent, id: Id) => {
    e.stopPropagation()
    const at = toDoc(e)
    if (tool === 'A') { run(x => x.select([{ kind: 'point', id }], mode(e)), true); startMove(at); return }
    if (tool === 'pen') return penTo(id)
    if (tool === 'join') {
      const ls = s.lines.filter(l => l.a === id || l.b === id).map(l => l.id)
      if (ls.length < 2) return setMsg('join: need two lines at this point')
      if (e.altKey) return run(x => x.removeJoin(id, ls[0]!, ls[1]!))
      return run(x => x.join(id, ls[0]!, ls[1]!, { mode: joinMode, ...(joinMode === 'arc' ? { radius } : {}) }))
    }
    if (tool === 'bind' || tool === 'merge' || tool === 'link') {
      if (!pending.length) { setPending([id]); setMsg(`${tool}: first point ${id}; click the second`); return }
      const [a] = pending; setPending([])
      if (tool === 'bind') run(x => x.bind(a!, id))
      if (tool === 'merge') run(x => x.mergePosition(a!, id))
      if (tool === 'link') run(x => x.link(a!, id))
      return
    }
  }
  const onHandle = (e: React.PointerEvent, l: Id, end: 'a' | 'b') => {
    e.stopPropagation()
    run(x => x.select([{ kind: 'handle', line: l, end }], mode(e)), true); startMove(toDoc(e))
  }
  const onLine = (e: React.PointerEvent, id: Id) => {
    e.stopPropagation()
    const at = toDoc(e)
    if (tool === 'V') { run(x => x.selectGroup(id, mode(e)), true); startMove(at); return }
    if (tool === 'A') { run(x => x.select([{ kind: 'line', id }], mode(e)), true); startMove(at); return }
    if (tool === 'split') {
      const l = line(id), full = [pos(l.a), add(pos(l.a), l.ha), add(pos(l.b), l.hb), pos(l.b)]
      return run(x => x.split(id, nearestT(full, at), nid('p'), nid('l'), nid('l')))
    }
    if (tool === 'unbind') {
      const l = line(id), pt = dist(pos(l.a), at) < dist(pos(l.b), at) ? l.a : l.b
      return run(x => x.unbind(pt, [id], nid('p')))
    }
    if (tool === 'fill') return onBackground(e)
    if (tool === 'pen') return onBackground(e)
  }
  const penTo = (spec: Id | { id: Id; layer: Id; position: Vec }) => {
    const id = typeof spec === 'string' ? spec : spec.id
    const last = pending[0]
    if (!last) {
      if (typeof spec === 'string') { setPending([id]); return }
      // a lone point is removed by the pipeline (isolated points), so the first click only remembers where
      setPending([JSON.stringify(spec)]); return
    }
    const from = last.startsWith('{') ? JSON.parse(last) : last
    if (run(x => x.line(nid('l'), from, spec))) setPending([id])
  }
  const onBackground = (e: React.PointerEvent) => {
    const at = toDoc(e)
    if (e.button === 1 || e.altKey && tool !== 'fill' || tool === 'V' || tool === 'A') {
      if (tool === 'V' || tool === 'A') run(x => x.select([], 'replace'), true)
      drag.current = { kind: 'pan', start: P(e.clientX, e.clientY), box }
      return
    }
    if (tool === 'pen') return penTo({ id: nid('p'), layer, position: at })
    if (tool === 'fill') {
      const loop = core.pickLoop(at)
      if (!loop) return setMsg('fill: no closed curve here')
      return run(x => (e.shiftKey ? x.clearFill(loop) : x.fill(loop, color)))
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      const k = d.box.w / svg.current!.clientWidth
      setBox({ ...d.box, x: d.box.x - (e.clientX - d.start.x) * k, y: d.box.y - (e.clientY - d.start.y) * k })
      return
    }
    // preview is a ghost drawn by the bench only; core is called once, on release (dot)
    const at = toDoc(e)
    setGhost(P(at.x - d.start.x, at.y - d.start.y))
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'move' && ghost && (ghost.x || ghost.y)) run(x => x.translate(ghost.x, ghost.y))
    setGhost(null)
  }
  const onWheel = (e: React.WheelEvent) => {
    const at = toDoc(e), k = Math.exp(e.deltaY * 0.001)
    setBox(b => ({ x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k }))
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'Escape') { setPending([]); setMsg(''); drag.current = null; setGhost(null) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { hist(e.shiftKey ? 'redo' : 'undo'); bump() }
      if (e.key === 'Delete' || e.key === 'Backspace') run(x => x.deleteSelection())
      const t: Record<string, Tool> = { v: 'V', a: 'A', p: 'pen', s: 'split', b: 'bind', m: 'merge', l: 'link', u: 'unbind', j: 'join', f: 'fill' }
      if (!e.metaKey && !e.ctrlKey && t[e.key]) { setTool(t[e.key]!); setPending([]) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // centre of the selected points / line ends, for rotate and scale buttons
  const selPoints = new Set<Id>()
  for (const u of sel) {
    if (u.kind === 'point') selPoints.add(u.id)
    if (u.kind === 'line') { selPoints.add(line(u.id).a); selPoints.add(line(u.id).b) }
    if (u.kind === 'handle') selPoints.add(line(u.line)[u.end])
  }
  const handleSel = new Set(sel.filter(u => u.kind === 'handle').map(u => (u as { line: Id; end: string }).line + (u as { end: string }).end))
  // points that are in selPoints only because a handle of theirs is selected (the point itself does not move)
  const handleOnly = new Set<Id>()
  for (const u of sel) if (u.kind === 'handle') { const pt = line(u.line)[u.end]; if (!sel.some(v => v.kind === 'point' && v.id === pt) && !sel.some(v => v.kind === 'line' && (line(v.id).a === pt || line(v.id).b === pt))) handleOnly.add(pt) }
  const ps = [...selPoints].map(pos)
  const centre = ps.length ? P((Math.min(...ps.map(p => p.x)) + Math.max(...ps.map(p => p.x))) / 2, (Math.min(...ps.map(p => p.y)) + Math.max(...ps.map(p => p.y))) / 2) : P(0, 0)
  const key = (u: Unit) => u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`
  const isSel = (u: Unit) => sel.some(v => key(v) === key(u))
  const handleLines = new Set<Id>(tool === 'A' ? s.lines.filter(l => selLines.includes(l.id) || selPoints.has(l.a) || selPoints.has(l.b)).map(l => l.id) : [])
  const px = box.w / 900 // ~one screen pixel in document units

  const B = (label: string, f: () => void, title?: string) => <button title={title} onClick={f}>{label}</button>
  const toolBtn = (t: Tool, label: string) => <button style={{ fontWeight: tool === t ? 700 : 400, background: tool === t ? '#cde' : undefined }} onClick={() => { setTool(t); setPending([]) }}>{label}</button>

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 230, padding: 8, borderRight: '1px solid #ccc', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Tools</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {toolBtn('pen', 'Pen P')}{toolBtn('V', 'V group')}{toolBtn('A', 'A direct')}{toolBtn('split', 'Split S')}
          {toolBtn('bind', 'Bind B')}{toolBtn('merge', 'Merge pos M')}{toolBtn('link', 'Link L')}{toolBtn('unbind', 'Unbind U')}
          {toolBtn('join', 'Join J')}{toolBtn('fill', 'Fill F')}
        </div>
        {tool === 'join' && <div>
          <select value={joinMode} onChange={e => setJoinMode(e.target.value as typeof joinMode)}><option>smooth</option><option>cusp</option><option>arc</option></select>
          {joinMode === 'arc' && <> r <input type="number" value={radius} style={{ width: 50 }} onChange={e => setRadius(+e.target.value)} /></>}
          <div style={{ color: '#666' }}>alt-click: remove join</div>
        </div>}
        {tool === 'fill' && <div><input type="color" value={color} onChange={e => setColor(e.target.value)} /> <span style={{ color: '#666' }}>shift-click: clear</span></div>}
        <b>Edit</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Undo', () => { hist('undo'); bump() })}{B('Redo', () => { hist('redo'); bump() })}
          {B('Delete', () => run(x => x.deleteSelection()))}
          {B('Flip', () => run(x => x.flip()))}
          {B('Rot +15°', () => run(x => x.rotate(centre, Math.PI / 12)))}
          {B('×1.1', () => run(x => x.scale(centre, 1.1, 1.1)))}{B('×0.9', () => run(x => x.scale(centre, 0.9, 0.9)))}
        </div>
        <b>Selected lines ({selLines.length})</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Lock', () => run(x => selLines.forEach(l => x.lineState(l, { locked: true }))))}
          {B('Unlock', () => run(x => selLines.forEach(l => x.lineState(l, { locked: false }))))}
          {B('Hide', () => run(x => selLines.forEach(l => x.lineState(l, { visible: false }))))}
          {B('Show all', () => run(x => s.lines.filter(l => !l.state.visible).forEach(l => x.lineState(l.id, { visible: true }))))}
          <span>width <input type="number" value={width} style={{ width: 40 }} onChange={e => setWidth(+e.target.value)} /></span>
          {B('Set width', () => run(x => selLines.forEach(l => x.lineStroke(l, { ...line(l).stroke, width }))))}
        </div>
        <b>Names</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Rename line', () => { if (selLines.length !== 1) return setMsg('select one line (A)'); const n = prompt('line name', line(selLines[0]!).name); if (n !== null) run(x => x.renameLine(selLines[0]!, n)) })}
          {B('Rename curve', () => { if (!selLines.length) return setMsg('select a curve (V)'); const gid = groupOf(selLines[0]!); const n = prompt('curve name', s.groups.find(x => x.id === gid)!.name); if (n !== null) run(x => x.renameGroup(gid, n)) })}
          <input placeholder="find by name" style={{ width: 110 }} onKeyDown={e => {
            if (e.key !== 'Enter') return
            const q = (e.target as HTMLInputElement).value
            const l = s.lines.find(x => x.name === q), gr = s.groups.find(x => x.name === q)
            if (l) run(x => x.select([{ kind: 'line', id: l.id }]), true)
            else if (gr) run(x => x.selectGroup(gr.lines[0]!), true)
            else setMsg(`no line or curve named "${q}"`)
          }} />
        </div>
        {selLines.length > 0 && <div style={{ color: '#555' }}>{[...new Set(selLines.map(groupOf))].map(gid => { const gr = s.groups.find(x => x.id === gid)!; return <div key={gid}><b>{gr.name}</b>: {gr.lines.map(id => line(id).name).join(' · ')}</div> })}</div>}
        <b>Mirror (axis x = {s.axis})</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B(`Set source (${source.length})`, () => { setSource(selLines); setMsg(`mirror source: ${selLines.join(', ')}`) })}
          {B('Apply → selected', () => run(x => x.mirrorApply(source, selLines)))}
          {B('Link → selected', () => run(x => x.mirrorLink([...new Set(source.map(groupOf))], [...new Set(selLines.map(groupOf))])))}
          {B('Unmirror', () => run(x => x.unmirror(selLines)))}
        </div>
        <div style={{ color: '#666' }}>pairs: {s.mirrorPairs.length}</div>
        <b>Layers (top first)</b>
        {B('+ New layer', () => { const id = nid('layer-'); run(x => x.layer(id, id)); setLayer(id) })}
        {[...s.layers].reverse().map((L, i, arr) => {
          const index = arr.length - 1 - i, lines = s.lines.filter(l => s.points.find(p => p.id === l.a)!.layer === L.id)
          const allLocked = lines.length > 0 && lines.every(l => l.state.locked), allHidden = lines.length > 0 && lines.every(l => !l.state.visible)
          return <div key={L.id} style={{ border: '1px solid #ddd', padding: 3, background: L.id === layer ? '#eef' : undefined }} onClick={() => setLayer(L.id)}>
            <b>{L.name}</b> <span style={{ color: '#999' }}>{L.id} · {lines.length} lines</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {B('rename', () => { const n = prompt('name', L.name); if (n) run(x => x.renameLayer(L.id, n)) })}
              {B('↑', () => run(x => x.reorderLayer(L.id, index + 1)))}{B('↓', () => run(x => x.reorderLayer(L.id, index - 1)))}
              {B(allHidden ? 'show' : 'hide', () => run(x => x.layerState(L.id, { visible: allHidden })))}
              {B(allLocked ? 'unlock' : 'lock', () => run(x => x.layerState(L.id, { locked: !allLocked })))}
              {B('fills off', () => run(x => x.layerFills(L.id, { visible: false })))}{B('fills on', () => run(x => x.layerFills(L.id, { visible: true })))}
              {B('copy', () => run(x => x.copyLayer(L.id, nid('layer-'))))}
              {B('delete', () => run(x => x.deleteLayer(L.id)))}
            </div>
          </div>
        })}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', minHeight: 18, color: msg.startsWith('✗') ? '#c00' : '#333' }}>
          {msg || `tool ${tool} · layer ${layer} · selection ${sel.map(u => u.kind[0] + ':' + ('id' in u ? u.id : u.line + '.' + u.end)).join(' ') || '—'}${pending.length && tool !== 'pen' ? ' · pending ' + pending[0] : ''}`}
        </div>
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none' }} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onBackground} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}
          onContextMenu={e => { e.preventDefault(); setPending([]) }}>
          <line x1={s.axis} x2={s.axis} y1={box.y - 1e4} y2={box.y + 1e4} stroke="#9cf" strokeDasharray={`${6 * px} ${4 * px}`} strokeWidth={px} />
          {g.fills.filter(f => f.visible).map(f => <path key={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'}
            fill={f.color} stroke={isSel({ kind: 'fill', id: f.id }) ? '#06f' : 'none'} strokeWidth={2 * px} />)}
          {g.lines.map(G => {
            const l = line(G.id), on = isSel({ kind: 'line', id: l.id }) || selLines.includes(l.id)
            return <g key={G.id}>
              <path d={path(G.curve)} fill="none" stroke={on ? '#06f' : l.state.locked ? '#933' : '#111'} strokeWidth={l.stroke.width}
                strokeDasharray={l.state.visible ? undefined : `${4 * px} ${4 * px}`} opacity={l.state.visible ? 1 : 0.35} strokeLinecap="round" />
              <path d={path(G.curve)} fill="none" stroke="transparent" strokeWidth={10 * px} onPointerDown={e => onLine(e, G.id)} />
            </g>
          })}
          {g.arcs.map(a => <path key={a.key} d={path(a.curve)} fill="none" stroke="#a50" strokeWidth={2} />)}
          {s.lines.filter(l => handleLines.has(l.id)).flatMap(l => (['a', 'b'] as const).map(end => {
            const p = pos(l[end]), h = add(p, end === 'a' ? l.ha : l.hb), on = isSel({ kind: 'handle', line: l.id, end })
            return <g key={l.id + end}>
              <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="#888" strokeWidth={px} />
              <rect x={h.x - 3 * px} y={h.y - 3 * px} width={6 * px} height={6 * px} fill={on ? '#06f' : '#fff'} stroke="#555" strokeWidth={px}
                onPointerDown={e => onHandle(e, l.id, end)} />
            </g>
          }))}
          {ghost && s.lines.filter(l => selPoints.has(l.a) || selPoints.has(l.b) || handleSel.has(l.id + 'a') || handleSel.has(l.id + 'b')).map(l => {
            const mv = (id: Id) => (selPoints.has(id) && !handleOnly.has(id) ? add(pos(id), ghost) : pos(id))
            const a = mv(l.a), b = mv(l.b)
            const ha = add(a, add(l.ha, handleSel.has(l.id + 'a') ? ghost : P(0, 0))), hb = add(b, add(l.hb, handleSel.has(l.id + 'b') ? ghost : P(0, 0)))
            return <path key={'g' + l.id} d={path([a, ha, hb, b])} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} pointerEvents="none" />
          })}
          {tool !== 'V' && s.points.map(p => {
            const on = isSel({ kind: 'point', id: p.id }) || pending.includes(p.id)
            return <circle key={p.id} cx={p.position.x} cy={p.position.y} r={(p.links.length ? 5 : 3.5) * px}
              fill={on ? '#06f' : p.links.length ? '#fc0' : '#fff'} stroke="#333" strokeWidth={px} onPointerDown={e => onPoint(e, p.id)} />
          })}
        </svg>
        <div style={{ height: 120, overflow: 'auto', padding: '2px 8px', borderTop: '1px solid #ccc', font: '11px ui-monospace, monospace' }}>
          {log.map((r, i) => <div key={log.length - i} style={{ color: r.result.startsWith('ok') ? '#333' : '#c00' }}>{r.result.startsWith('ok') ? '✓' : r.result} · {r.calls || '(no call)'}</div>)}
        </div>
        <div style={{ padding: '2px 8px', color: '#888', borderTop: '1px solid #eee' }}>
          wheel zoom · drag empty space (V/A) or alt-drag to pan · Esc / right-click ends pen · ⌘Z / ⇧⌘Z · Delete · window.bench = {'{ core, refresh, svg, log }'}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
