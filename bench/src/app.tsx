// Throwaway test bench (bowen 1791477975): drawing, camera, panels, files and the log.
// The tools and every unfinished operation are the interaction package's (graph
// "Interaction", doc 22); one-shot panel commands call core's public operations and then
// tell interaction (doc 22 §3.5). Uses core's public entry only.
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

export function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [layer, setLayer] = useState<Id>('layer-1')
  const [layers, setLayers] = useState<Id[]>(['layer-1']) // the selected layers (docs/layer-scope-plan.md §1)
  // Z is a view tool: the camera is the app's, so it lives here, not in interaction (bowen 1791554415)
  const [zoomTool, setZoomTool] = useState(false)
  const [width, setWidth] = useState(2)
  // changes with every drawing opened: the panel's own temporary state (a rename draft, a dragged
  // row) belongs to one drawing and ends with it (dot 1791551140)
  const [drawing, setDrawing] = useState(0)
  const [box, setBox] = useState({ x: -400, y: -300, w: 800, h: 600 })
  const svg = useRef<SVGSVGElement>(null)
  // one screen pixel in document units, from the canvas's real size (the viewBox is fitted, so the
  // larger ratio wins); the old fixed 900-pixel width made picking about half as wide as meant
  const [size, setSize] = useState({ w: 900, h: 600 })
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 600 })
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const px = Math.max(box.w / size.w, box.h / size.h)

  const s = core.snapshot(), g = core.geometry()
  // the drawing layer falls back to the top layer when the chosen one is gone (deleted, or a file was opened)
  const drawLayer = s.layers.some(l => l.id === layer) ? layer : s.layers[s.layers.length - 1]?.id ?? ''
  // the selected layers that still exist, always with the current one
  const selLayers = [...new Set([...layers.filter(id => s.layers.some(l => l.id === id)), ...(drawLayer ? [drawLayer] : [])])]
  const env = useRef({ layer: drawLayer, layers: selLayers, px })
  env.current = { layer: drawLayer, layers: selLayers, px }
  const ix = useRef(createInteraction({ core: () => logged(core), newId: nid, layer: () => env.current.layer || undefined, layers: () => env.current.layers, pixel: () => env.current.px })).current
  useEffect(() => ix.subscribe(bump), [ix])
  const pv: Preview = ix.preview()
  const pvPoints = new Set(pv.points) // the points interaction shows (and so can hit) for this tool

  const line = (id: Id) => s.lines.find(l => l.id === id)!
  const pos = (id: Id) => s.points.find(p => p.id === id)!.position
  // only the selection on the selected layers is shown selected and acted on (docs/layer-scope-plan.md §3)
  const sel = ix.selection()
  const selLines = sel.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  const groupOf = (l: Id) => s.groups.find(gr => gr.lines.includes(l))?.id
  const opts = ix.options()

  useEffect(() => {
    ;(window as unknown as { bench: unknown }).bench = { core, ix, refresh: bump, scope: () => ({ layer: env.current.layer, layers: [...env.current.layers] }), svg: () => svg.current?.outerHTML, log, demo: () => { demo(); ix.historyChanged(); bump() }, v2Eye: () => { v2Eye(); ix.historyChanged(); bump() } }
  })

  /** A one-shot panel command: straight to core, then interaction checks its unfinished operations (doc 22 §3.5). */
  const run = (fn: (e: Editor) => void) => {
    // the outcome goes to interaction, the one owner of feedback (dot 1791551067)
    try { logged(core).edit(fn); ix.outcome(); return true }
    catch (err) { ix.outcome(err); return false }
    finally { bump() }
  }
  /** The panel changed the selected layers; the selection elsewhere simply goes inert (docs/layer-scope-plan.md §3). */
  const selectLayers = (ids: Id[], current: Id) => { setLayers(ids); setLayer(current) }
  const toDoc = (e: { clientX: number; clientY: number }) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
    return P(p.x, p.y)
  }
  const mods = (e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey })

  // A gesture (a tool's drag, or a pan) follows the pointer on the whole window, not pointer
  // capture: bowen's log showed capture lost before any release reached the canvas, which ended
  // the drag (inbox #7; bowen 1791552361; the root cause is not confirmed, dot 1791552536).
  // One gesture at a time, tracked on the window from press to release (start, end and unmount
  // in one place; dot 1791552536, 1791552771). It belongs to the pointer and the button that
  // started it: other pointers are ignored, and it is released when that button is no longer
  // held (its pointerup, or a move whose buttons lack it: the up was missed). pointercancel for
  // that pointer, Esc and leaving the window cancel it; so does unmounting.
  // `cancel` is the one way a gesture ends without a release: it stops the window tracking and
  // ends the drag in interaction (a pan simply stops) — never only one of the two (dot 1791552803)
  // `right` marks a right-button pan, whose own release (unmoved) is the right click (bowen 1791554290)
  const gesture = useRef<null | { id: number; right: boolean; cancel: (why: string) => void }>(null)
  const note = (what: string) => { log.unshift({ calls: what, result: 'ok (diagnostic)' }); log.length = Math.min(log.length, 50) }
  const BUTTON_BIT = [1, 4, 2] // button 0 → buttons bit 1 (left), 1 → 4 (middle), 2 → 2 (right)
  const CLICK = 2 // screen px a press may move and still be a click (v1: 7205381 DrawingRoom zoom)
  const onDown = (e: React.PointerEvent) => {
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return // another pointer while a gesture runs: ignored
      gesture.current.cancel('a new press of the same pointer') // its earlier release was missed
    }
    const id = e.pointerId, bit = BUTTON_BIT[e.button] ?? 1, start = P(e.clientX, e.clientY), from = box, at = toDoc(e)
    // what this press is (bowen 1791554290, 1791554415): right or middle drags the canvas, and an
    // unmoved right press is the right click (cancel one level); with Z, the left button zooms;
    // otherwise the tool gets the press, and a press that hits nothing only clears the selection
    const kind = e.button === 1 || e.button === 2 ? 'pan' : zoomTool ? 'zoom' : ix.pointerDown(at, mods(e)) ? 'tool' : null
    if (!kind) return
    let moved = false
    const zoomBy = (k: number) => setBox({ x: at.x - (at.x - from.x) * k, y: at.y - (at.y - from.y) * k, w: from.w * k, h: from.h * k })
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & bit) === 0) { if (kind === 'tool') note('release found by a move without the starting button held (pointerup missed)'); release(ev); return }
      if (kind === 'tool') { ix.pointerMove(toDoc(ev)); return }
      follow(ev)
    }
    /** Pan or zoom to where the pointer is; also run on release, so a release far away with no move between is a drag, not a click (dot 1791554963). */
    const follow = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > CLICK
      if (!moved) return
      if (kind === 'pan') { const k = from.w / svg.current!.clientWidth; setBox({ ...from, x: from.x - (ev.clientX - start.x) * k, y: from.y - (ev.clientY - start.y) * k }) }
      else zoomBy(Math.exp((ev.clientY - start.y) * 0.008)) // up zooms in, down zooms out (v1's rate)
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      stop()
      if (kind === 'tool') { ix.pointerUp(toDoc(ev)); return }
      follow(ev)
      if (!moved && kind === 'zoom') zoomBy(ev.altKey || ev.ctrlKey ? 1.3 : 1 / 1.3) // a click zooms in ×1.3, Alt / Ctrl-click out (v1)
      else if (!moved && e.button === 2) ix.cancel() // the right click
    }
    // a cancelled pan or zoom puts the view back where it started (v1: cancelViewport)
    const cancelWith = (why: string) => { stop(); if (kind === 'tool') { if (ix.preview().drag) note(`drag cancelled by ${why}`); ix.pointerCancel() } else setBox(from) }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onBlur = () => cancelWith('leaving the window')
    const stop = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onBlur)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: e.button === 2, cancel: cancelWith }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', onCancel); window.addEventListener('blur', onBlur)
  }
  useEffect(() => () => gesture.current?.cancel('unmounting'), []) // unmounting ends any gesture
  /** A tool change (key or button, Z included) ends any gesture through its one cancel path (dot 1791554909). */
  const chooseTool = (t: Tool | 'Z') => {
    gesture.current?.cancel('a tool change')
    setZoomTool(t === 'Z')
    if (t !== 'Z') ix.setTool(t)
  }
  const onWheel = (e: React.WheelEvent) => {
    const at = toDoc(e), k = Math.exp(e.deltaY * 0.001)
    setBox(b => ({ x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k }))
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // only a field that takes typing keeps its keys (dot 1791544530); a focused button never blocks a
      // shortcut (bowen 1791556992: after clicking Flip or Zoom, V / A / ⌘Z still work)
      const t = e.target as HTMLElement
      const typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
        || (t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset'].includes((t as HTMLInputElement).type))
      if (typing) return
      // one Esc cancels one thing: a gesture in progress if there is one, else interaction's innermost (dot 1791553129)
      if (e.key === 'Escape' && gesture.current) { gesture.current.cancel('Esc'); e.preventDefault(); return }
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) { chooseTool('Z'); e.preventDefault(); return }
      // a plain letter interaction takes is a tool key: it ends any gesture and leaves Z
      if (/^[a-y]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && ix.key(e.key, mods(e))) { e.preventDefault(); chooseTool(ix.tool); return }
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
          {TOOLS.map(([t, label]) => { const on = !zoomTool && ix.tool === t; return <button key={t} style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : undefined }} onClick={() => chooseTool(t)}>{label}</button> })}
          <button style={{ fontWeight: zoomTool ? 700 : 400, background: zoomTool ? '#cde' : undefined }} onClick={() => chooseTool('Z')}>Zoom Z</button>
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
          {B('Flip', () => run(x => x.flip(sel)))}
          {B('Rot +15°', () => run(x => x.rotate(centre, Math.PI / 12, sel)))}
          {B('×1.1', () => run(x => x.scale(centre, 1.1, 1.1, sel)))}{B('×0.9', () => run(x => x.scale(centre, 0.9, 0.9, sel)))}
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
                const next = open(await f.text())
                gesture.current?.cancel('opening another drawing') // only once the file opened (dot 1791554909)
                core = next
                const ls = core.snapshot().layers, top = ls[ls.length - 1]?.id ?? ''; setLayer(top); setLayers([top])
                ix.drawingChanged(); setDrawing(k => k + 1)
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
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none', cursor: zoomTool ? 'zoom-in' : undefined }} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onDown} onWheel={onWheel}
          // the right click itself is the unmoved right press (onDown); a right press during a left
          // drag comes only as this event, and cancels that drag (one level)
          onContextMenu={e => { e.preventDefault(); if (gesture.current && !gesture.current.right) gesture.current.cancel('a right click') }}>
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
          {pv.handles.map(({ line: id, end }) => {
            const l = line(id), p = pos(l[end]), h = add(p, end === 'a' ? l.ha : l.hb), on = isSel({ kind: 'handle', line: id, end })
            return <g key={id + end}>
              <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="#888" strokeWidth={px} />
              <rect x={h.x - 3 * px} y={h.y - 3 * px} width={6 * px} height={6 * px} fill={on ? '#06f' : '#fff'} stroke="#555" strokeWidth={px} />
            </g>
          })}
          {s.points.filter(p => pvPoints.has(p.id)).map(p => {
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
          wheel or Z (drag up / down, click) zooms · right- or middle-drag pans · Esc / right-click cancels · ⌘Z / ⇧⌘Z · ⌘C ⌘X ⌘V · Delete · window.bench = {'{ core, ix, refresh, svg, log }'}
        </div>
      </div>
      <LayersPanel key={drawing} s={s} g={g} selected={selLayers} active={drawLayer} select={selectLayers} run={run} newLayerId={() => nid('layer-')} />
    </div>
  )
}
