// Throwaway test bench (bowen 1791477975): drawing, camera, panels, files and the log.
// The tools and every unfinished operation are the interaction package's (graph
// "Interaction", doc 22); one-shot panel commands call core's public operations and then
// tell interaction (doc 22 §3.5). Uses core's public entry only.
import { createRoot } from 'react-dom/client'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Core, save, open, type Vec, type Snapshot, type Editor } from '../../src'
import { createInteraction, type Tool, type Preview } from '../../interaction'
import eyeFixture from '../../test/fixtures/v2-right-eye.json'
import { LayersPanel } from '../../visual'

type Id = string
type Unit = Snapshot['selection'][number]

let core = Core.newDocument({ axis: 0 })
let seq = 0
// New ids carry a per-session prefix: an opened file may hold ids used by an earlier session,
// including deleted ones that core still keeps reserved (dot 1791512144); existing ones are skipped too.
const session = Date.now().toString(36)
const nid = (p: string) => {
  const s = core.snapshot(), used = new Set([...s.points.map(x => x.id), ...s.lines.map(x => x.id), ...s.layers.map(x => x.id)])
  let id: string
  do id = `${p}${session}-${++seq}`; while (used.has(id))
  return id
}
const P = (x: number, y: number): Vec => ({ x, y })
const add = (a: Vec, b: Vec) => P(a.x + b.x, a.y + b.y)
const path = (c: readonly Vec[]) => `M${c[0]!.x},${c[0]!.y} C${c[1]!.x},${c[1]!.y} ${c[2]!.x},${c[2]!.y} ${c[3]!.x},${c[3]!.y}`
const mid = (c: readonly Vec[]) => P((c[0]!.x + 3 * c[1]!.x + 3 * c[2]!.x + c[3]!.x) / 8, (c[0]!.y + 3 * c[1]!.y + 3 * c[2]!.y + c[3]!.y) / 8)

// ---- the log: every edit's Editor calls and what core returned -------------------------
type LogRow = { calls: string; result: string }
const log: LogRow[] = []
const short = (x: unknown) => { const t = JSON.stringify(x) ?? String(x); return t.length > 80 ? t.slice(0, 77) + '…' : t }
/** Ids in a message shown with their names, e.g. "u1" → "u1「左上眼睑外」". */
function withNames(m: string) {
  const s = core.snapshot(), names = new Map<string, string>([...s.lines.map(l => [l.id, l.name] as const), ...s.groups.map(g => [g.id, g.name] as const)])
  return m.replace(/[^\s(),"]+/g, w => (names.has(w) ? `${w}「${names.get(w)}」` : w))
}
/** The open Core seen through a logging wrapper (one wrapper per Core, so interaction's identity checks hold). */
const wrappers = new WeakMap<Core, Core>()
function logged(c: Core): Core {
  let w = wrappers.get(c)
  if (w) return w
  w = new Proxy(c, {
    get(t, k) {
      if (k === 'edit') return (fn: (e: Editor) => void) => {
        const calls: string[] = []
        const rec = (e: Editor) => new Proxy(e, { get: (x, n) => { const v = Reflect.get(x, n); return typeof v === 'function' ? (...a: unknown[]) => { calls.push(`${String(n)}(${a.map(short).join(', ')})`); return v.apply(x, a) } : v } })
        try { t.edit(e => fn(rec(e))); log.unshift({ calls: calls.join('; '), result: 'ok' }) }
        catch (err) { log.unshift({ calls: calls.join('; '), result: '✗ ' + withNames((err as Error).message) }); throw err }
        finally { log.length = Math.min(log.length, 50) }
      }
      if (k === 'undo' || k === 'redo') return () => { const could = k === 'undo' ? t.canUndo : t.canRedo; t[k](); log.unshift({ calls: `${k}()`, result: could ? 'ok' : `ok (nothing to ${k})` }) }
      const v = Reflect.get(t, k, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  wrappers.set(c, w)
  return w
}

// ---- demo scenes (test data, not a load feature) -----------------------------------------
/** A left eye (smooth top and bottom, an arc corner, filled, named), a copy flipped to the right and mirror-linked. */
function demo() {
  const L = core.snapshot().layers[0]?.id ?? 'layer-1', p = (id: Id, x: number, y: number) => ({ id, layer: L, position: P(x, y) })
  core.edit(e => { e.line('u1', p('a', -300, 0), p('b', -200, -60)); e.line('u2', 'b', p('c', -100, 0)); e.line('w1', 'c', p('d', -200, 40)); e.line('w2', 'd', 'a') })
  core.edit(e => { e.join('b', 'u1', 'u2', { mode: 'smooth' }); e.join('d', 'w1', 'w2', { mode: 'smooth' }); e.join('a', 'u1', 'w2', { mode: 'arc', radius: 10 }) })
  core.edit(e => e.fill(core.snapshot().loops[0]!.id, '#f2c94c'))
  core.edit(e => { e.renameGroup(core.snapshot().groups[0]!.id, '左眼'); e.renameLine('u1', '左上眼睑外'); e.renameLine('u2', '左上眼睑内') })
  core.edit(e => e.copyLayer(L, 'R'))
  core.edit(e => { e.selectGroup('R/u1'); e.translate(400, 0); e.flip() })
  const g = (line: Id) => core.snapshot().groups.find(x => x.lines.includes(line))!.id
  core.edit(e => { e.mirrorLink([g('u1')], [g('R/u1')]); e.select([]) })
}
/** The v2 right eye (test fixture from 4bc7cc2), scaled ×1000 and shifted onto the bench's axis, one layer per stroke, with its corner links. */
function v2Eye() {
  const k = 1000, S = (v: Vec) => P(v.x * k, v.y * k), at = (v: Vec) => P((v.x - eyeFixture.axis) * k, v.y * k - 200), made = new Set<string>()
  core.edit(e => {
    for (const L of eyeFixture.layers) e.layer(L.id, L.name)
    const end = (id: string, layer: string, v: Vec) => { if (made.has(id)) return id; made.add(id); return { id, layer, position: at(v) } }
    for (const l of eyeFixture.lines) e.line(l.id, end(l.a, l.layer, l.pa), end(l.b, l.layer, l.pb), { ha: S(l.ha), hb: S(l.hb) })
    for (const [a, b] of eyeFixture.links) e.link(a!, b!)
    for (const l of eyeFixture.lines) e.renameLine(l.id, l.name)
  })
}

const TOOLS: [Tool, string][] = [['pen', 'Pen P'], ['V', 'V group'], ['A', 'A direct'], ['split', 'Split S'], ['bind', 'Bind B'], ['merge', 'Merge pos M'], ['link', 'Link L'], ['unbind', 'Unbind U'], ['join', 'Join J'], ['fill', 'Fill F']]

function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [layer, setLayer] = useState<Id>('layer-1')
  const [width, setWidth] = useState(2)
  const [box, setBox] = useState({ x: -400, y: -300, w: 800, h: 600 })
  const svg = useRef<SVGSVGElement>(null)
  const pan = useRef<null | { start: Vec; box: typeof box }>(null)
  const px = box.w / 900 // about one screen pixel in document units

  const s = core.snapshot(), g = core.geometry()
  // the drawing layer falls back to the top layer when the chosen one is gone (deleted, or a file was opened)
  const drawLayer = s.layers.some(l => l.id === layer) ? layer : s.layers[s.layers.length - 1]?.id ?? ''
  const env = useRef({ layer: drawLayer, px })
  env.current = { layer: drawLayer, px }
  const ix = useRef(createInteraction({ core: () => logged(core), newId: nid, layer: () => env.current.layer || undefined, tolerance: () => 8 * env.current.px })).current
  useEffect(() => ix.subscribe(bump), [ix])
  const pv: Preview = ix.preview()

  const line = (id: Id) => s.lines.find(l => l.id === id)!
  const pos = (id: Id) => s.points.find(p => p.id === id)!.position
  const sel = s.selection
  const selLines = sel.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  const groupOf = (l: Id) => s.groups.find(gr => gr.lines.includes(l))?.id
  const opts = ix.options()

  useEffect(() => {
    ;(window as unknown as { bench: unknown }).bench = { core, ix, refresh: bump, svg: () => svg.current?.outerHTML, log, demo: () => { demo(); ix.historyChanged(); bump() }, v2Eye: () => { v2Eye(); ix.historyChanged(); bump() } }
  })

  /** A one-shot panel command: straight to core, then interaction checks its unfinished operations (doc 22 §3.5). */
  const run = (fn: (e: Editor) => void) => {
    // the outcome goes to interaction, the one owner of feedback (dot 1791551067)
    try { logged(core).edit(fn); ix.outcome(); return true }
    catch (err) { ix.outcome(err); return false }
    finally { bump() }
  }
  const toDoc = (e: { clientX: number; clientY: number }) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
    return P(p.x, p.y)
  }
  const mods = (e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey })

  const onDown = (e: React.PointerEvent) => {
    // a right click goes straight to cancel (contextmenu), never into a tool first (dot 1791544530)
    if (e.button === 2) return
    svg.current!.setPointerCapture(e.pointerId)
    if (e.button === 1 || !ix.pointerDown(toDoc(e), mods(e))) pan.current = { start: P(e.clientX, e.clientY), box }
  }
  const onMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (p) { const k = p.box.w / svg.current!.clientWidth; setBox({ ...p.box, x: p.box.x - (e.clientX - p.start.x) * k, y: p.box.y - (e.clientY - p.start.y) * k }); return }
    ix.pointerMove(toDoc(e))
  }
  const onUp = (e: React.PointerEvent) => { if (e.button === 2) return; if (pan.current) { pan.current = null; return } ix.pointerUp(toDoc(e)) }
  const onCancel = () => { pan.current = null; ix.pointerCancel() }
  const onWheel = (e: React.WheelEvent) => {
    const at = toDoc(e), k = Math.exp(e.deltaY * 0.001)
    setBox(b => ({ x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k }))
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // keys typed into a form control are its own (dot 1791544530)
      const t = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName) || t.isContentEditable) return
      if (ix.key(e.key, mods(e))) e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ix])

  // what the selection touches, for the rotate / scale buttons and the A handles
  const selPoints = new Set<Id>()
  for (const u of sel) {
    if (u.kind === 'point') selPoints.add(u.id)
    if (u.kind === 'line') { selPoints.add(line(u.id).a); selPoints.add(line(u.id).b) }
    if (u.kind === 'handle') selPoints.add(line(u.line)[u.end])
  }
  const ps = [...selPoints].map(pos)
  const centre = ps.length ? P((Math.min(...ps.map(p => p.x)) + Math.max(...ps.map(p => p.x))) / 2, (Math.min(...ps.map(p => p.y)) + Math.max(...ps.map(p => p.y))) / 2) : P(0, 0)
  const key = (u: Unit) => (u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`)
  const isSel = (u: Unit) => sel.some(v => key(v) === key(u))
  const handleLines = new Set<Id>(ix.tool === 'A' ? s.lines.filter(l => l.state.visible && (selLines.includes(l.id) || selPoints.has(l.a) || selPoints.has(l.b))).map(l => l.id) : [])

  // the drag ghost: the units the drag moves, drawn moved by its offset (a preview only)
  const ghostLines = (() => {
    const d = pv.drag
    if (!d) return []
    const pts = new Set<Id>(), hs = new Set<string>(), lns = new Set<Id>()
    // the view never dereferences an id that is gone (dot 1791544530)
    const has = (id: Id) => s.lines.some(l => l.id === id), hasPoint = (id: Id) => s.points.some(p => p.id === id)
    const exists = (u: Unit) => (u.kind === 'point' ? hasPoint(u.id) : u.kind === 'line' ? has(u.id) : u.kind === 'handle' ? has(u.line) : true)
    for (const u of d.units.filter(exists)) {
      if (u.kind === 'point') pts.add(u.id)
      if (u.kind === 'line') { lns.add(u.id); pts.add(line(u.id).a); pts.add(line(u.id).b) }
      if (u.kind === 'handle') hs.add(u.line + u.end)
    }
    return s.lines.filter(l => pts.has(l.a) || pts.has(l.b) || hs.has(l.id + 'a') || hs.has(l.id + 'b')).map(l => {
      const mv = (id: Id) => (pts.has(id) ? add(pos(id), d.offset) : pos(id))
      const a = mv(l.a), b = mv(l.b)
      return [a, add(a, add(l.ha, hs.has(l.id + 'a') ? d.offset : P(0, 0))), add(b, add(l.hb, hs.has(l.id + 'b') ? d.offset : P(0, 0))), b]
    })
  })()
  // the refusal mark: a red cross on each object it names
  const refusalAt = (pv.refusal?.objects ?? []).flatMap(o => {
    if (o.kind === 'point') { const p = s.points.find(x => x.id === o.id); return p ? [p.position] : [] }
    if (o.kind === 'line') { const c = g.lines.find(x => x.id === o.id); return c ? [mid(c.curve)] : [] }
    if (o.kind === 'group') { const gr = s.groups.find(x => x.id === o.id); const c = gr && g.lines.find(x => x.id === gr.lines[0]); return c ? [mid(c.curve)] : [] }
    return []
  })
  const cutLines = new Set(s.groups.filter(x => pv.cut.includes(x.id)).flatMap(x => x.lines))

  const B = (label: string, f: () => void, title?: string) => <button title={title} onClick={f}>{label}</button>
  const status = pv.refusal ? '✗ ' + withNames(pv.refusal.message)
    : `tool ${ix.tool} · layer ${drawLayer} · selection ${sel.map(u => u.kind[0] + ':' + ('id' in u ? u.id : u.line + '.' + u.end)).join(' ') || '—'}${pv.pick ? ' · first pick ' + pv.pick.id : ''}${pv.cut.length ? ' · cut pending (paste moves, Esc cancels)' : ''}${pv.mirrorSource.length ? ' · mirror source ' + pv.mirrorSource.length : ''}`

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 230, padding: 8, borderRight: '1px solid #ccc', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Tools</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {TOOLS.map(([t, label]) => <button key={t} style={{ fontWeight: ix.tool === t ? 700 : 400, background: ix.tool === t ? '#cde' : undefined }} onClick={() => ix.setTool(t)}>{label}</button>)}
        </div>
        {ix.tool === 'join' && <div>
          <select value={opts.joinMode} onChange={e => ix.setOptions({ joinMode: e.target.value as typeof opts.joinMode })}><option>smooth</option><option>cusp</option><option>arc</option></select>
          {opts.joinMode === 'arc' && <> r <input type="number" value={opts.radius} style={{ width: 50 }} onChange={e => ix.setOptions({ radius: +e.target.value })} /></>}
          <div style={{ color: '#666' }}>click two lines; alt on the second: remove join</div>
        </div>}
        {ix.tool === 'fill' && <div><input type="color" value={opts.color} onChange={e => ix.setOptions({ color: e.target.value })} /> <span style={{ color: '#666' }}>shift-click: clear</span></div>}
        <b>Edit</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Undo', () => ix.undo())}{B('Redo', () => ix.redo())}
          {B('Delete', () => ix.deleteSelection())}
          {B('Cut', () => ix.cut(), '⌘X: grey until pasted; Esc cancels')}{B('Copy', () => ix.copy(), '⌘C')}{B('Paste', () => ix.paste(), '⌘V: into the current layer')}
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
          {B('Rename line', () => { if (selLines.length !== 1) return; const n = prompt('line name', line(selLines[0]!).name); if (n !== null) run(x => x.renameLine(selLines[0]!, n)) })}
          {B('Rename curve', () => { const gid = selLines[0] && groupOf(selLines[0]); if (!gid) return; const n = prompt('curve name', s.groups.find(x => x.id === gid)!.name); if (n !== null) run(x => x.renameGroup(gid, n)) })}
          <input placeholder="find by name" style={{ width: 110 }} onKeyDown={e => {
            if (e.key !== 'Enter') return
            const q = (e.target as HTMLInputElement).value, l = s.lines.find(x => x.name === q), gr = s.groups.find(x => x.name === q)
            if (l) run(x => x.select([{ kind: 'line', id: l.id }]))
            else if (gr) run(x => x.selectGroup(gr.lines[0]!))
          }} />
        </div>
        {selLines.length > 0 && <div style={{ color: '#555' }}>{[...new Set(selLines.map(groupOf))].map(gid => { const gr = s.groups.find(x => x.id === gid); return gr ? <div key={gid}><b>{gr.name}</b>: {gr.lines.map(id => line(id).name).join(' · ')}</div> : null })}</div>}
        <b>Mirror (axis x = {s.axis})</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B(`Set source (${pv.mirrorSource.length})`, () => ix.setMirrorSource())}
          {B('Apply → selected', () => ix.mirrorApply())}
          {B('Link → selected', () => ix.mirrorLink())}
          {B('Unmirror', () => run(x => x.unmirror(selLines)))}
        </div>
        <div style={{ color: '#666' }}>pairs: {s.mirrorPairs.length}</div>
        <b>File</b>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          {B('Save', () => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([save(core)], { type: 'application/json' }))
            a.download = 'drawing.headset.json'; a.click(); URL.revokeObjectURL(a.href)
            log.unshift({ calls: 'save()', result: 'ok' }); bump()
          })}
          <label style={{ border: '1px solid #aaa', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', background: '#f4f4f4' }}>Open
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              // the drawing is replaced only if the file opens; only then does interaction hear of it
              try {
                core = open(await f.text())
                const ls = core.snapshot().layers; setLayer(ls[ls.length - 1]?.id ?? '')
                ix.drawingChanged()
                log.unshift({ calls: `open(${f.name})`, result: 'ok' })
              } catch (err) { log.unshift({ calls: `open(${f.name})`, result: '✗ ' + (err as Error).message }) }
              bump()
            }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>{B('demo eyes', () => { try { demo() } catch { /* already there */ } ix.historyChanged(); bump() })}{B('v2 right eye', () => { try { v2Eye() } catch { /* already there */ } ix.historyChanged(); bump() })}</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', minHeight: 18, color: pv.refusal ? '#c00' : '#333' }}>{status}</div>
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none' }} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onLostPointerCapture={onCancel} onWheel={onWheel}
          onContextMenu={e => { e.preventDefault(); ix.cancel() }}>
          <line x1={s.axis} x2={s.axis} y1={box.y - 1e4} y2={box.y + 1e4} stroke="#9cf" strokeDasharray={`${6 * px} ${4 * px}`} strokeWidth={px} />
          {g.fills.filter(f => f.visible).map(f => <path key={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'}
            fill={f.color} opacity={cutLines.size && s.loops.find(l => l.id === f.id)?.route.every(u => cutLines.has(u.line)) ? 0.35 : 1}
            stroke={isSel({ kind: 'fill', id: f.id }) ? '#06f' : 'none'} strokeWidth={2 * px} />)}
          {g.lines.map(G => {
            const l = line(G.id), on = selLines.includes(l.id), picked = pv.pick?.kind === 'line' && pv.pick.id === l.id
            const stroke = cutLines.has(l.id) ? '#bbb' : picked ? '#f80' : pv.mirrorSource.includes(l.id) ? '#a3c' : on ? '#06f' : l.state.locked ? '#933' : '#111'
            return <path key={G.id} d={path(G.curve)} fill="none" stroke={stroke} strokeWidth={l.stroke.width}
              strokeDasharray={l.state.visible ? undefined : `${4 * px} ${4 * px}`} opacity={l.state.visible ? 1 : 0.35} strokeLinecap="round" />
          })}
          {g.arcs.map(a => <path key={a.key} d={path(a.curve)} fill="none" stroke="#a50" strokeWidth={2} />)}
          {ghostLines.map((c, i) => <path key={'g' + i} d={path(c)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {s.lines.filter(l => handleLines.has(l.id)).flatMap(l => (['a', 'b'] as const).map(end => {
            const p = pos(l[end]), h = add(p, end === 'a' ? l.ha : l.hb), on = isSel({ kind: 'handle', line: l.id, end })
            return <g key={l.id + end}>
              <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="#888" strokeWidth={px} />
              <rect x={h.x - 3 * px} y={h.y - 3 * px} width={6 * px} height={6 * px} fill={on ? '#06f' : '#fff'} stroke="#555" strokeWidth={px} />
            </g>
          }))}
          {ix.tool !== 'V' && s.points.filter(p => s.lines.some(l => (l.a === p.id || l.b === p.id) && l.state.visible)).map(p => {
            const on = isSel({ kind: 'point', id: p.id }), picked = pv.pick?.kind === 'point' && pv.pick.id === p.id
            return <circle key={p.id} cx={p.position.x} cy={p.position.y} r={(p.links.length ? 5 : 3.5) * px}
              fill={picked ? '#f80' : on ? '#06f' : p.links.length ? '#fc0' : '#fff'} stroke="#333" strokeWidth={px} />
          })}
          {pv.pen && 'at' in pv.pen && <circle cx={pv.pen.at.x} cy={pv.pen.at.y} r={3 * px} fill="#f80" />}
          {refusalAt.map((p, i) => <g key={'x' + i} stroke="#d00" strokeWidth={2.5 * px}>
            <line x1={p.x - 6 * px} y1={p.y - 6 * px} x2={p.x + 6 * px} y2={p.y + 6 * px} /><line x1={p.x - 6 * px} y1={p.y + 6 * px} x2={p.x + 6 * px} y2={p.y - 6 * px} />
          </g>)}
        </svg>
        <div style={{ height: 120, overflow: 'auto', padding: '2px 8px', borderTop: '1px solid #ccc', font: '11px ui-monospace, monospace' }}>
          {log.map((r, i) => <div key={log.length - i} style={{ color: r.result.startsWith('ok') ? '#333' : '#c00' }}>{r.result.startsWith('ok') ? '✓' : r.result} · {r.calls || '(no call)'}</div>)}
        </div>
        <div style={{ padding: '2px 8px', color: '#888', borderTop: '1px solid #eee' }}>
          wheel zoom · drag empty space or middle-drag to pan · Esc / right-click cancels · ⌘Z / ⇧⌘Z · ⌘C ⌘X ⌘V · Delete · window.bench = {'{ core, ix, refresh, svg, log }'}
        </div>
      </div>
      <LayersPanel s={s} g={g} active={drawLayer} setActive={setLayer} run={run} newLayerId={() => nid('layer-')} />
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
import.meta.hot?.dispose(() => root.unmount())
