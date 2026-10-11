// Throwaway test bench (bowen 1791477975): drawing, camera, panels, files and the log.
// The tools and every unfinished operation are the interaction package's (graph
// "Interaction", doc 22); one-shot panel commands call core's public operations and then
// tell interaction (doc 22 §3.5). Uses core's public entry only.
import { useEffect, useReducer, useRef, useState } from 'react'
import { Core, save, open, correctionEdge, Refusal, type Vec, type Snapshot, type Editor, type ReferenceImage, type ReferenceProps, type ReferenceSlot } from '../../src'
import { createInteraction, REACH, type Tool, type Preview } from '../../interaction'
import { createAutosave, indexedDbStore, type Autosave, type Store } from '../../autosave'
import eyeFixture from '../../test/fixtures/v2-right-eye.json'
import { LayersPanel } from '../../visual'
import { Rename } from '../../rename'
import { cursorFor } from '../../cursor'

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
/** A call argument for the log; never throws (a circular or unprintable argument is shown as such; dot 1791697642). */
const short = (x: unknown) => {
  let t: string
  try { t = JSON.stringify(x) ?? String(x) } catch { t = '‹unprintable›' }
  return t.length > 80 ? t.slice(0, 77) + '…' : t
}
/** Ids in a message shown with their names, e.g. "u1" → "u1「左上眼睑外」". */
function withNames(m: string) {
  const s = core.snapshot(), names = new Map<string, string>([...s.lines.map(l => [l.id, l.name] as const), ...s.groups.map(g => [g.id, g.name] as const)])
  return m.replace(/[^\s(),"]+/g, w => (names.has(w) ? `${w}「${names.get(w)}」` : w))
}
/**
 * The open Core seen through a logging wrapper, one per App and Core (so interaction's identity
 * checks hold). `readOnly` is that App's playback (stage 3a; dot 1791683911, 1791686247: the flag
 * and the wrapper belong to the App instance, not the module). While it is on, undo and redo are
 * refused, and an edit is allowed only if it calls `correct` exactly once and nothing else (stage
 * 3b package 5; dot 1791696773, 1791696847): a forbidden call throws and is remembered even if the
 * callback catches it; when the callback returns, before control goes back to core, a forbidden
 * call or a count other than one fails the edit; the callback's own result is returned unchanged,
 * so core still refuses an async callback.
 */
/** The App's write mode: editing, playback (one correct per edit), or locked (restoring the autosaved drawing: nothing writes). */
type WriteMode = 'edit' | 'playback' | 'locked'
function loggedFor(mode: () => WriteMode, afterWrite: () => void = () => {}): (c: Core) => Core {
  const wrappers = new WeakMap<Core, Core>()
  return c => {
    let w = wrappers.get(c)
    if (w) return w
    w = new Proxy(c, {
      get(t, k) {
        if (k === 'edit' || k === 'editIn') return (...args: unknown[]) => {
          const [view, fn] = (k === 'edit' ? ['view:0,0', args[0]] : args) as [string, (e: Editor) => void]
          const m = mode()
          if (m === 'locked') { log.unshift({ calls: `${k}(…)`, result: '✗ restoring the autosaved drawing' }); throw new Error('restoring: nothing is written until the autosaved drawing is restored') }
          const playback = m === 'playback'
          const calls: string[] = []
          let corrects = 0, forbidden: string | undefined
          const rec = (e: Editor) => new Proxy(e, { get: (x, n) => { const v = Reflect.get(x, n); return typeof v === 'function' ? (...a: unknown[]) => {
            // the gate first, then the log: nothing before the gate may throw (dot 1791697642)
            if (playback && n !== 'correct') forbidden ??= String(n)
            calls.push(`${String(n)}(${a.map(short).join(', ')})`)
            if (playback) {
              if (n !== 'correct') throw new Error(`read-only-playback: ${String(n)} is not allowed during playback (only one correct)`)
              corrects++
            }
            return v.apply(x, a)
          } : v } })
          const head = view === 'view:0,0' ? '' : `[${view}] `
          try {
            t.editIn(view, e => {
              const result: unknown = fn(rec(e))
              if (playback && (forbidden !== undefined || corrects !== 1)) {
                throw new Error(`read-only-playback: during playback an edit must call correct exactly once and nothing else (${forbidden !== undefined ? `it called ${forbidden}` : `it called correct ${corrects} times`})`)
              }
              return result as void
            })
            log.unshift({ calls: head + calls.join('; '), result: 'ok' })
            afterWrite() // every write through the wrapper reaches autosave, rendered or not
          }
          catch (err) { log.unshift({ calls: head + calls.join('; '), result: '✗ ' + withNames((err as Error).message) }); throw err }
          finally { log.length = Math.min(log.length, 50) }
        }
        if (k === 'undo' || k === 'redo') return () => { if (mode() !== 'edit') { log.unshift({ calls: `${k}()`, result: mode() === 'locked' ? '✗ restoring the autosaved drawing' : '✗ read only during playback' }); return } const could = k === 'undo' ? t.canUndo : t.canRedo; t[k](); log.unshift({ calls: `${k}()`, result: could ? 'ok' : `ok (nothing to ${k})` }); afterWrite() }
        const v = Reflect.get(t, k, t)
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
    wrappers.set(c, w)
    return w
  }
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

/** The autosave store (docs/autosave-plan.md): IndexedDB in a browser; a test may give its own; none without either. */
const autosaveStore = (): Store | undefined => (window as unknown as { benchStore?: Store }).benchStore ?? (typeof indexedDB !== 'undefined' ? indexedDbStore() : undefined)

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
  // the current view (multi-view step 7): every read and every edit is in it; the app holds it
  const [view, setView] = useState('view:0,0')
  // playback (stage 3a): the pose shown, or null when editing; `poseGen` counts entries (a file
  // read started before one is dropped), `openSeq` counts Opens (only the latest may open)
  const [pose, setPose] = useState<null | { yaw: number; pitch: number }>(null)
  const poseGen = useRef(0), openSeq = useRef(0)
  // stage 3b package 5: a playback drag's refusal, shown until the next press, pose change or
  // leaving playback; the drag's ghost (the picked point and where it is dragged); the number
  // fields' own text, kept apart from the pose (dot 1791696847)
  const [corrRefusal, setCorrRefusal] = useState<null | { message: string; objects: readonly { kind: string; id: string }[] }>(null)
  const [corrGhost, setCorrGhost] = useState<null | { id: Id; to: Vec }>(null)
  const [poseText, setPoseText] = useState({ yaw: '0', pitch: '0' })
  // reference pictures (docs/reference-images-plan.md §7.1): this App's counter, advanced by a view change,
  // entering or leaving playback, an Open and unmounting; a picture read keeps it and writes only if unchanged
  const refGen = useRef(0)
  useEffect(() => () => { refGen.current++ }, [])
  // autosave (docs/autosave-plan.md): restoring locks every write entry until the stored drawing is back
  const store = useRef(autosaveStore()).current
  const [restoring, setRestoring] = useState(!!store)
  const restoringNow = useRef(!!store)
  const saver = useRef<Autosave | null>(null)
  // pictures that failed to draw (a stored picture that does not decode): shown in the status, nothing else changes
  // bound to the drawing and the picture's source, not the id alone: a good picture with the same id in another drawing is not marked (dot 1791703225)
  const [refBroken, setRefBroken] = useState<{ core: Core; id: string; src: string }[]>([])
  // round two (docs/reference-images-plan.md §8, §8a): a live preview of one picture's changes, the
  // Move picture mode and its active picture; each bound to the drawing, the App's counter and the picture
  type RefBind = { core: Core; gen: number; id: string; src: string }
  const [refPreview, setRefPreview] = useState<null | (RefBind & { base: ReferenceImage; props: ReferenceProps })>(null)
  const previewNow = useRef(refPreview)
  const [moveRef, setMoveRef] = useState(false)
  const [activeRef, setActiveRef] = useState<null | RefBind>(null)
  const keyHooks = useRef<{ nudge?: (e: KeyboardEvent) => boolean }>({})
  // this App's read-only flag and its own logged wrapper: another App mounting, posing or
  // unmounting never touches them (dot 1791686247)
  const posing = useRef(false) // set only by startPose / stopPose, with the pose state
  const logged = useRef(loggedFor(() => (restoringNow.current ? 'locked' : posing.current ? 'playback' : 'edit'), () => saver.current?.want())).current
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

  const shown = core.views().includes(view) ? view : 'view:0,0'
  // lines whose front differs from the angle baseline (stage 2): marked on the canvas
  const pending = core.pendingLines()
  // while posing, the drawing is the pose (Core.atPose: read only, drawn through the same reads as a view)
  const posed = (() => { try { return pose ? core.atPose(pose) : null } catch (err) { return err as Error } })()
  // the drawing this frame shows, bound with it during playback: a press on a frame drawn before
  // another App changed the shared drawing must not start a correction (dot 1791697642)
  const frame = useRef<{ core: Core; text: string } | null>(null)
  frame.current = pose || moveRef ? { core, text: save(core) } : null
  const reader = posed && !(posed instanceof Error) ? posed : core.in(shown)
  const s = reader.snapshot(), g = reader.geometry()
  // one visibility rule for the playback drag's picking, its point marks and its ghost, computed once
  // per frame (dot 1791697776; docs/stage3b-pkg5-problems.md): the visible lines and the points they end at
  const shownLines = s.lines.filter(l => l.state.visible), shownEnds = new Set(shownLines.flatMap(l => [l.a, l.b]))
  // the drawing layer falls back to the top layer when the chosen one is gone (deleted, or a file was opened)
  const drawLayer = s.layers.some(l => l.id === layer) ? layer : s.layers[s.layers.length - 1]?.id ?? ''
  // the selected layers that still exist, always with the current one
  const selLayers = [...new Set([...layers.filter(id => s.layers.some(l => l.id === id)), ...(drawLayer ? [drawLayer] : [])])]
  const env = useRef({ layer: drawLayer, layers: selLayers, px, view: shown })
  env.current = { layer: drawLayer, layers: selLayers, px, view: shown }
  const ix = useRef(createInteraction({ core: () => logged(core), view: () => env.current.view, newId: nid, layer: () => env.current.layer || undefined, layers: () => env.current.layers, pixel: () => env.current.px })).current
  useEffect(() => ix.subscribe(bump), [ix])
  // autosave: restore first (an Open of the stored text), then save every change in order; a late
  // restore after unmount applies nothing (the package checks its owner)
  useEffect(() => {
    if (!store) return
    const a = createAutosave(store, {
      apply: text => {
        const next = open(text)
        core = next
        const ls = core.snapshot().layers, top = ls[ls.length - 1]?.id ?? ''
        setLayer(top); setLayers([top]); refGen.current++
        ix.drawingChanged(); setDrawing(k => k + 1)
        log.unshift({ calls: 'autosave: restored the saved drawing', result: 'ok' })
      },
      current: () => save(core),
      changed: () => bump(),
    })
    saver.current = a
    let live = true
    void a.start().then(() => { if (!live) return; restoringNow.current = false; setRestoring(false); bump() })
    return () => { live = false; a.dispose(); saver.current = null }
  }, [])
  // every render may follow a change: autosave compares the text and writes only a new one
  useEffect(() => { saver.current?.want() })
  // leaving or refreshing while unsaved asks first (only the last completed save is kept)
  useEffect(() => {
    const ask = (e: BeforeUnloadEvent) => { if (saver.current?.unsaved()) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [])
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
    ;(window as unknown as { bench: unknown }).bench = { core, ix, refresh: bump, pose: () => pose, view: () => env.current.view, chooseView: (k: string) => chooseView(k), scope: () => ({ layer: env.current.layer, layers: [...env.current.layers] }), svg: () => svg.current?.outerHTML, log, edit: (fn: (e: Editor) => void) => logged(core).edit(fn), demo: () => { demo(); ix.historyChanged(); bump() }, v2Eye: () => { v2Eye(); ix.historyChanged(); bump() } }
  })

  /** A one-shot panel command: straight to core, then interaction checks its unfinished operations (doc 22 §3.5). */
  /** The picture a binding names, if the drawing, the counter, the view's list and its source still hold. */
  const refNow = (b: RefBind | null) => (b && b.core === core && b.gen === refGen.current ? core.in(shown).references().find(r => r.id === b.id && r.src === b.src) : undefined)
  const SETTABLE = ['x', 'y', 'scale', 'angle', 'opacity', 'visible'] as const
  const sameBase = (a: ReferenceImage, b: ReferenceImage) => SETTABLE.every(k => a[k] === b[k])
  /** A live change of one picture, drawn but not written (§8.1). */
  const previewRef = (r: ReferenceImage, props: ReferenceProps) => {
    const p = previewNow.current
    const next = p && p.id === r.id && refNow(p) ? { ...p, props: { ...p.props, ...props } } : { core, gen: refGen.current, id: r.id, src: r.src, base: r, props }
    previewNow.current = next; setRefPreview(next)
  }
  /** The preview ends once: written if its picture is unchanged underneath, else dropped (§8a.1). */
  const commitPreview = () => {
    const p = previewNow.current
    if (!p) return
    previewNow.current = null; setRefPreview(null)
    const now = refNow(p)
    if (!now || !sameBase(now, p.base)) { note('reference change dropped: the picture changed underneath'); bump(); return }
    run(x => x.setReference(p.id, p.props))
  }
  const cancelPreview = () => { previewNow.current = null; setRefPreview(null) }
  const run = (fn: (e: Editor) => void) => {
    // the outcome goes to interaction, the one owner of feedback (dot 1791551067)
    try { logged(core).editIn(env.current.view, fn); ix.outcome(); return true }
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
  // a press the tool took is held: the canvas cursor asks cursor/ with it (A / V grab). Set where the
  // gesture starts, cleared in its one `stop` (release, cancel, blur, tool change, playback) (dot 1791708548)
  const [pressed, setPressed] = useState(false)
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
    // a new press of the same pointer anywhere on the page, another App included, ends this gesture:
    // its window listeners would otherwise still act on that press's release (dot 1791696828)
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const stop = () => {
      setPressed(false)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onOtherDown, true)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: e.button === 2, cancel: cancelWith }
    if (kind === 'tool') setPressed(true)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', onCancel); window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  /**
   * A drag during playback (stage 3b package 5, docs/stage3b-pkg5-bench-drag.md): only on a line,
   * a visible point within reach; the press binds the drawing, the pose, the point and its start
   * (dot 1791696808); the target is the start plus the pointer's displacement; on release one
   * `correct` edit, unless the drawing changed meanwhile. The same one gesture slot and cancel path.
   */
  /**
   * Move picture (§8.2): a press on a visible picture of this view (topmost first, inside its rotated
   * rectangle) drags it; preview at start + displacement, one setReference on release unless the
   * drawing changed. Lines are never picked while the mode is on.
   */
  const onRefDown = (e: React.PointerEvent) => {
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return
      gesture.current.cancel('a new press of the same pointer')
    }
    if (e.button !== 0) return
    const shownFrom = frame.current
    if (!shownFrom || shownFrom.core !== core || shownFrom.text !== save(core)) { note('press ignored: the drawing changed since this frame was drawn; redrawn'); bump(); return }
    const at = toDoc(e)
    const inside = (r: ReferenceImage) => {
      const a = -r.angle * Math.PI / 180, dx = at.x - r.x, dy = at.y - r.y
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
      return Math.abs(lx) <= r.width * r.scale / 2 && Math.abs(ly) <= r.height * r.scale / 2
    }
    const hit = [...core.in(shown).references()].reverse().find(r => r.visible && inside(r))
    if (!hit) return
    const bind = { core: shownFrom.core, gen: refGen.current, id: hit.id, src: hit.src }
    setActiveRef(bind)
    cancelPreview()
    const id = e.pointerId, pressed = P(e.clientX, e.clientY)
    let moved = false, done = false
    const target = (ev: PointerEvent) => { const now = toDoc(ev); return { x: hit.x + now.x - at.x, y: hit.y + now.y - at.y } }
    const travel = (ev: PointerEvent) => { moved ||= Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & 1) === 0) { release(ev); return }
      travel(ev)
      if (moved) { const next = { ...bind, base: hit, props: target(ev) }; previewNow.current = next; setRefPreview(next) }
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      travel(ev)
      stop()
      if (!moved) return
      if (core !== shownFrom.core || save(core) !== shownFrom.text) { note('picture move cancelled: the drawing changed during the drag'); bump(); return }
      run(x => x.setReference(hit.id, target(ev)))
    }
    const cancelWith = (why: string) => { if (done) return; stop(); note(`picture move cancelled by ${why}`); bump() }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const onBlur = () => cancelWith('leaving the window')
    const onMenu = () => cancelWith('a right click')
    const listeners: [string, (ev: PointerEvent) => void][] = [['pointermove', move], ['pointerup', release], ['pointercancel', onCancel], ['blur', onBlur], ['contextmenu', onMenu]]
    const stop = () => {
      done = true
      for (const [t, f] of listeners) window.removeEventListener(t, f as EventListener)
      window.removeEventListener('pointerdown', onOtherDown, true)
      previewNow.current = null; setRefPreview(null)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: false, cancel: cancelWith }
    for (const [t, f] of listeners) window.addEventListener(t, f as EventListener)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  /** Arrow keys while Move picture is on (§8.2, §8a.2): they nudge the active picture and never reach lines. */
  keyHooks.current.nudge = (e: KeyboardEvent) => {
    if (!moveRef || !e.key.startsWith('Arrow')) return false
    e.preventDefault()
    if (gesture.current || previewNow.current) return true
    const r = refNow(activeRef)
    if (!r) return true
    const step = e.shiftKey ? 10 : 1, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft']
    if (d) run(x => x.setReference(r.id, { x: r.x + d[0]!, y: r.y + d[1]! }))
    return true
  }
  const onPoseDown = (e: React.PointerEvent) => {
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return
      gesture.current.cancel('a new press of the same pointer')
    }
    setCorrRefusal(null)
    if (e.button !== 0 || !pose || !posed || posed instanceof Error || !('edge' in correctionEdge(pose))) return
    const shownFrom = frame.current
    if (!shownFrom || shownFrom.core !== core || shownFrom.text !== save(core)) { note('playback press ignored: the drawing changed since this frame was drawn; redrawn'); bump(); return }
    // picked from this frame (the one just checked as current), by the frame's one visibility rule:
    // a point only if a visible line ends at it (a hidden layer is its lines hidden; dot 1791696828)
    const at = toDoc(e)
    const hit = s.points.filter(p => shownEnds.has(p.id)).map(p => ({ p, d: Math.hypot(p.position.x - at.x, p.position.y - at.y) }))
      .filter(x => x.d <= REACH.point * px).sort((a, b) => a.d - b.d)[0]
    if (!hit) return
    const bound = { core: shownFrom.core, text: shownFrom.text, pose: { ...pose }, id: hit.p.id, start: hit.p.position, from: at }
    const id = e.pointerId, pressed = P(e.clientX, e.clientY)
    let moved = false, done = false
    const target = (ev: PointerEvent) => { const now = toDoc(ev); return P(bound.start.x + now.x - bound.from.x, bound.start.y + now.y - bound.from.y) }
    const travel = (ev: PointerEvent) => { moved ||= Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & 1) === 0) { release(ev); return }
      travel(ev)
      if (moved) setCorrGhost({ id: bound.id, to: target(ev) })
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      travel(ev)
      stop()
      if (!moved) return
      if (core !== bound.core || save(core) !== bound.text) { note('playback drag cancelled: the drawing changed during the drag'); bump(); return }
      try { logged(core).edit(x => x.correct(bound.pose, { points: [{ id: bound.id, position: target(ev) }] })) }
      catch (err) { setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] }) }
      bump()
    }
    const cancelWith = (why: string) => { if (done) return; stop(); note(`playback drag cancelled by ${why}`); bump() }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const onBlur = () => cancelWith('leaving the window')
    const onMenu = () => cancelWith('a right click')
    const listeners: [string, (ev: PointerEvent) => void][] = [['pointermove', move], ['pointerup', release], ['pointercancel', onCancel], ['blur', onBlur], ['contextmenu', onMenu]]
    const stop = () => {
      done = true
      for (const [t, f] of listeners) window.removeEventListener(t, f as EventListener)
      window.removeEventListener('pointerdown', onOtherDown, true)
      setCorrGhost(null)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: false, cancel: cancelWith }
    for (const [t, f] of listeners) window.addEventListener(t, f as EventListener)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  useEffect(() => () => gesture.current?.cancel('unmounting'), []) // unmounting ends any gesture
  /** A view change ends any gesture and what interaction holds for one view (step 7); not an edit. */
  const chooseView = (k: string) => {
    gesture.current?.cancel('a view change')
    env.current = { ...env.current, view: k }
    refGen.current++
    setView(k); ix.viewChanged()
  }
  /**
   * Playback (stage 3a): entering ends any gesture (its window listeners go with it) and every
   * unfinished operation in interaction, at every level; then nothing writes until leaving.
   */
  const startPose = () => {
    gesture.current?.cancel('entering playback')
    ix.cancelAll()
    posing.current = true; poseGen.current++; refGen.current++
    const [yaw, pitch] = shown.slice('view:'.length).split(',').map(Number)
    setPose({ yaw: yaw!, pitch: pitch! }); setPoseText({ yaw: String(yaw), pitch: String(pitch) }); setCorrRefusal(null)
  }
  const stopPose = () => { gesture.current?.cancel('leaving playback'); refGen.current++; posing.current = false; setPose(null); setCorrRefusal(null) }
  /** A valid pose change ends a playback drag first: a target belongs to one pose (dot 1791696847). */
  const changePose = (next: { yaw: number; pitch: number }) => { gesture.current?.cancel('a pose change'); setCorrRefusal(null); setPose(next) }
  const LIMITS = { yaw: 90, pitch: 45 } as const
  /** A number field's text, and the pose only when it parses to a finite angle in range; "", "-" and the like change nothing. */
  const typePose = (axis: 'yaw' | 'pitch', text: string) => {
    setPoseText(t => ({ ...t, [axis]: text }))
    const v = Number(text)
    if (pose && text.trim() !== '' && Number.isFinite(v) && Math.abs(v) <= LIMITS[axis] && v !== pose[axis]) changePose({ ...pose, [axis]: v })
  }
  const poseTextValid = (axis: 'yaw' | 'pitch') => { const v = Number(poseText[axis]); return poseText[axis].trim() !== '' && Number.isFinite(v) && Math.abs(v) <= LIMITS[axis] }
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
      // Esc first: it cancels a gesture even in playback and with a field focused (dot 1791696958)
      if (e.key === 'Escape' && gesture.current) { gesture.current.cancel('Esc'); e.preventDefault(); return }
      // playback next, before the typing check: a focused slider must not pass keys on (dot 1791683911)
      if (restoringNow.current) return // restoring: no shortcut writes (dot 1791704242)
      if (posing.current) return
      // only a field that takes typing keeps its keys (dot 1791544530); a focused button never blocks a
      // shortcut (bowen 1791556992: after clicking Flip or Zoom, V / A / ⌘Z still work)
      const t = e.target as HTMLElement
      const typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
        || (t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset'].includes((t as HTMLInputElement).type))
      if (typing) return
      if (keyHooks.current.nudge?.(e)) return
      // one Esc cancels one thing: a gesture in progress (above) if there is one, else interaction's innermost (dot 1791553129)
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
  const refusalAt = ((pose ? corrRefusal : pv.refusal)?.objects ?? []).flatMap(o => {
    if (o.kind === 'point') { const p = s.points.find(x => x.id === o.id); return p ? [p.position] : [] }
    if (o.kind === 'line') { const c = g.lines.find(x => x.id === o.id); return c ? [mid(c.curve)] : [] }
    if (o.kind === 'group') { const gr = s.groups.find(x => x.id === o.id); const c = gr && g.lines.find(x => x.id === gr.lines[0]); return c ? [mid(c.curve)] : [] }
    return []
  })
  const cutLines = new Set(s.groups.filter(x => pv.cut.includes(x.id)).flatMap(x => x.lines))

  const B = (label: string, f: () => void, title?: string) => <button title={title} onClick={f}>{label}</button>
  // where the pose lies for a correction, by core's own rule (correctionEdge; dot 1791696958)
  const where = pose ? correctionEdge(pose) : null
  const onLine = !!where && 'edge' in where
  const brokenHere = core.in(shown).references().filter(r => refBroken.some(x => x.core === core && x.id === r.id && x.src === r.src)).map(r => r.id)
  const status = pose ? (corrRefusal ? '✗ ' + withNames(corrRefusal.message)
    : `playback yaw ${pose.yaw}, pitch ${pose.pitch} · ${!where ? '' : 'edge' in where ? `on the line ${where.inner} → ${where.outer} at t = ${+where.t.toFixed(3)} · drag a point to correct` : where.code === 'correction-at-view' ? 'at a view · read only (edit the view itself)' : where.code === 'correction-off-edge' ? 'inside a cell · read only (this round corrects on lines only)' : '✗ ' + where.message}${posed instanceof Error ? ' · ✗ ' + posed.message : ''}`)
    : pv.refusal ? '✗ ' + withNames(pv.refusal.message)
    : brokenHere.length ? `✗ reference picture ${brokenHere.join(', ')} could not be drawn (the drawing is unaffected)`
    : `view ${shown} · tool ${ix.tool} · layer ${drawLayer} · selection ${sel.map(u => u.kind[0] + ':' + ('id' in u ? u.id : u.line + '.' + u.end)).join(' ') || '—'}${pv.pick ? ' · first pick ' + pv.pick.id : ''}${pv.cut.length ? ' · cut pending (paste moves, Esc cancels)' : ''}${pv.mirrorSource.length ? ' · mirror source ' + pv.mirrorSource.length : ''}`

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 230, padding: 8, borderRight: '1px solid #ccc', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* playback (stage 3a): a pose between the views, read only; everything that writes below is disabled meanwhile */}
        <b>Playback</b>
        <div data-testid="playback" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {pose ? <>
            <button onClick={stopPose}>Leave playback</button>
            {(['yaw', 'pitch'] as const).map(axis => <label key={axis}>{axis} {pose[axis]}
              <input type="range" data-testid={axis} min={-LIMITS[axis]} max={LIMITS[axis]} step={1} value={pose[axis]} onChange={e => { const v = +e.target.value; setPoseText(t => ({ ...t, [axis]: String(v) })); changePose({ ...pose, [axis]: v }) }} />
              <input data-testid={`${axis}-text`} value={poseText[axis]} style={{ width: 64, borderColor: poseTextValid(axis) ? undefined : '#c00' }} onChange={e => typePose(axis, e.target.value)} />
            </label>)}
          </> : <button onClick={startPose}>Playback</button>}
        </div>
        <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        <b>View</b>
        {/* the nine views (step 7): columns yaw −90 / 0 / +90, rows pitch +45 / 0 / −45 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }} data-testid="views">
          {[45, 0, -45].flatMap(pitch => [-90, 0, 90].map(yaw => {
            const k = `view:${yaw},${pitch}`, on = k === shown
            return <button key={k} data-view={k} title={k} style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : undefined }} onClick={() => chooseView(k)}>{yaw},{pitch}</button>
          }))}
        </div>
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
          {B('Broadcast stroke', () => ix.broadcastStroke(), 'this view\'s width, profile and end strokes of the selected lines → every other view')}
        </div>
        {/* stage 2: shapes between views (front → others), separate from the stroke broadcast above */}
        <b>Angle (shapes) · pending {pending.length}</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Broadcast shape', () => ix.broadcastShape(), 'front view only: the selected lines\' change since the last broadcast → every other view')}
          {B('Fit', () => ix.fit(), 'accept the selected lines\' front as the baseline; no view changes')}
          {B('Draft corners', () => ix.draftCorners(), 'the four corner views of the selected lines = front + yaw change + pitch change')}
        </div>
        <b>Reference ({shown})</b>
        <div data-testid="reference" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label>Place… <input type="file" data-testid="ref-file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            // bound at the start: this App's counter, the drawing and the view (§7.1)
            const start = { gen: refGen.current, core, text: save(core), view: shown, box }
            const reader = new FileReader()
            reader.onload = () => {
              const src = String(reader.result), pic = new Image()
              pic.onload = () => {
                if (start.gen !== refGen.current || start.core !== core || save(core) !== start.text) { note(`reference ${f.name} dropped: the drawing, view or mode changed while it was read`); bump(); return }
                const k = Math.min(1, 0.9 * start.box.w / pic.width, 0.9 * start.box.h / pic.height)
                run(x => x.placeReference({ id: nid('ref-'), view: start.view, src, width: pic.width, height: pic.height, x: start.box.x + start.box.w / 2, y: start.box.y + start.box.h / 2, scale: k, angle: 0, opacity: 0.5, visible: true }))
              }
              pic.onerror = () => { note(`reference ${f.name} not placed: the picture does not decode`); bump() }
              pic.src = src
            }
            reader.readAsDataURL(f)
          }} /></label>
          <label><input type="checkbox" data-testid="move-picture" checked={moveRef} onChange={e => { if (!e.target.checked) { gesture.current?.cancel('Move picture turned off'); setActiveRef(null) } cancelPreview(); setMoveRef(e.target.checked) }} /> Move picture (drag it, or arrow keys; Shift ×10)</label>
          {core.in(shown).references().map(r => {
            const live = refPreview && refPreview.id === r.id && refNow(refPreview) ? { ...r, ...refPreview.props } : r
            const active = refNow(activeRef)?.id === r.id
            const RANGE = { x: [box.x, box.x + box.w, 1], y: [box.y, box.y + box.h, 1], scale: [-3, 2, 0.01], angle: [-180, 180, 1], opacity: [0, 1, 0.01] } as const
            const writeSlots = (slots: ReferenceSlot[]) => run(x => x.setReference(r.id, { slots }))
            return <div key={r.id} data-ref={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, outline: active ? '1px solid #2a7fff' : undefined }}>
            <input type="checkbox" checked={r.visible} onChange={e => run(x => x.setReference(r.id, { visible: e.target.checked }))} />
            {(['x', 'y', 'scale', 'angle', 'opacity'] as const).map(k => {
              const [lo, hi, step] = RANGE[k], toSlider = (v: number) => (k === 'scale' ? Math.log10(v) : v), fromSlider = (v: number) => (k === 'scale' ? 10 ** v : v)
              return <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{k}
                <input key={`${r.id}:${k}:${r[k]}`} data-field={k} type="number" style={{ width: 54 }} defaultValue={r[k]} step={k === 'opacity' ? 0.1 : undefined}
                  onChange={e => { const t = e.target.value, v = Number(t); if (t.trim() !== '' && Number.isFinite(v)) previewRef(r, { [k]: v }) }}
                  onKeyDown={e => { if (e.key === 'Enter') commitPreview(); else if (e.key === 'Escape') { cancelPreview(); (e.target as HTMLInputElement).value = String(r[k]) } }}
                  onBlur={commitPreview} />
                <input data-slider={k} type="range" min={lo} max={hi} step={step} value={Math.min(hi, Math.max(lo, toSlider(live[k])))} style={{ width: 70 }}
                  onChange={e => previewRef(r, { [k]: fromSlider(Number(e.target.value)) })} onPointerUp={commitPreview} onKeyUp={commitPreview} onBlur={commitPreview} />
              </label>
            })}
            {B('Remove', () => run(x => x.removeReference(r.id)))}
            <div data-slots={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, width: '100%' }}>
              {r.slots.map((sl, k) => <span key={k} data-slot={k} style={{ border: '1px solid #ccc', padding: '0 3px' }}>
                <Rename key={drawing} name={sl.name || `slot ${k + 1}`} style={{ fontWeight: 700, flex: 'none' }} fieldStyle={{ width: 70 }} onRename={n => writeSlots(r.slots.map((x, j) => (j === k ? { ...x, name: n.slice(0, 100) } : x)))} />
                <button onClick={() => writeSlots(r.slots.map((x, j) => (j === k ? { ...x, placement: { x: r.x, y: r.y, scale: r.scale, angle: r.angle } } : x)))}>存</button>
                <button disabled={!sl.placement} onClick={() => sl.placement && run(x => x.setReference(r.id, { ...sl.placement! }))}>调出</button>
                <button onClick={() => writeSlots(r.slots.map((x, j) => (j === k ? { ...x, placement: null } : x)))}>×</button>
              </span>)}
              <button onClick={() => writeSlots([...r.slots, { name: '', placement: null }])}>＋ 加一格</button>
            </div>
          </div>
          })}
        </div>
        <b>Names</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {/* renaming is by double-click on the name in the layers panel (rename/, bowen 1791708333) */}
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
        </fieldset>
        <b>File</b>
        <div data-testid="autosave" style={{ color: saver.current?.status().state === 'failed' || saver.current?.status().state === 'off' ? '#c00' : '#666' }}>{(() => {
          const st = saver.current?.status()
          if (!store) return 'autosave: off (no browser storage)'
          if (!st || st.state === 'restoring') return 'autosave: restoring…'
          const head = st.state === 'saved' ? 'autosave: saved' : st.state === 'saving' ? 'autosave: saving…' : st.state === 'failed' ? `✗ autosave: not saved (${st.error})` : `✗ autosave off: ${st.error}`
          return st.notice ? `${head} · ${st.notice}` : head
        })()}{saver.current?.status().state === 'failed' && <> <button onClick={() => saver.current?.retry()}>Retry</button></>}</div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          {B('Save', () => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([save(core)], { type: 'application/json' }))
            a.download = 'drawing.headset.json'; a.click(); URL.revokeObjectURL(a.href)
            log.unshift({ calls: 'save()', result: 'ok' }); bump()
          })}
          <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0 }}>
          <label style={{ border: '1px solid #aaa', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', background: '#f4f4f4' }}>Open
            <input type="file" data-testid="open" accept=".json" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              // a read returns later: it may open only if it is still the latest Open and playback has
              // not been entered since (ledger row 8; dot 1791684079)
              const mine = ++openSeq.current, gen = poseGen.current
              // the drawing is replaced only if the file opens; only then does interaction hear of it
              try {
                const text = await f.text()
                if (mine !== openSeq.current || gen !== poseGen.current) {
                  log.unshift({ calls: `open(${f.name})`, result: `✗ dropped: ${mine !== openSeq.current ? 'a later Open was started' : 'playback was entered meanwhile'}` })
                  bump(); return
                }
                const next = open(text)
                gesture.current?.cancel('opening another drawing') // only once the file opened (dot 1791554909)
                core = next
                refGen.current++
                const ls = core.snapshot().layers, top = ls[ls.length - 1]?.id ?? ''; setLayer(top); setLayers([top])
                ix.drawingChanged(); setDrawing(k => k + 1)
                log.unshift({ calls: `open(${f.name})`, result: 'ok' })
              } catch (err) { log.unshift({ calls: `open(${f.name})`, result: '✗ ' + (err as Error).message }) }
              bump()
            }} />
          </label>
          </fieldset>
        </div>
        <div style={{ display: 'flex', gap: 3 }}><fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 3 }}>{B('demo eyes', () => { try { demo() } catch { /* already there */ } ix.historyChanged(); bump() })}{B('v2 right eye', () => { try { v2Eye() } catch { /* already there */ } ix.historyChanged(); bump() })}</fieldset></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', minHeight: 18, color: (pose ? corrRefusal : pv.refusal) ? '#c00' : '#333' }}>{status}</div>
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none', cursor: pose ? 'default' : cursorFor(zoomTool ? 'Z' : ix.tool, pressed) }} data-testid="canvas" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={restoring ? undefined : pose ? onPoseDown : moveRef ? onRefDown : onDown} onWheel={onWheel}
          // the right click itself is the unmoved right press (onDown); a right press during a left
          // drag comes only as this event, and cancels that drag (one level)
          onContextMenu={e => { e.preventDefault(); if (gesture.current && !gesture.current.right) gesture.current.cancel('a right click') }}>
          {!pose && core.in(shown).references().filter(r => r.visible).map(r0 => {
            // a live preview of this picture, if it is still bound to what is shown (§8.1, §8a.3)
            const r = refPreview && refPreview.id === r0.id && refNow(refPreview) ? { ...r0, ...refPreview.props } : r0
            const w = r.width * r.scale, h = r.height * r.scale
            return <image key={r.id} data-reference={r.id} href={r.src} x={r.x - w / 2} y={r.y - h / 2} width={w} height={h} opacity={r.opacity} preserveAspectRatio="none"
              transform={`rotate(${r.angle} ${r.x} ${r.y})`} onError={() => { const at = core; setRefBroken(b => (b.some(x => x.core === at && x.id === r.id && x.src === r.src) ? b : [...b, { core: at, id: r.id, src: r.src }])) }} />
          })}
          <line x1={s.axis} x2={s.axis} y1={box.y - 1e4} y2={box.y + 1e4} stroke="#9cf" strokeDasharray={`${6 * px} ${4 * px}`} strokeWidth={px} />
          {g.fills.filter(f => f.visible).map(f => <path key={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'}
            fill={f.color} opacity={cutLines.size && s.loops.find(l => l.id === f.id)?.route.every(u => cutLines.has(u.line)) ? 0.35 : 1}
            stroke={!pose && isSel({ kind: 'fill', id: f.id }) ? '#06f' : 'none'} strokeWidth={2 * px} />)}
          {/* the selection box (bowen 1791558733): solid blue = wholly inside (dragged right), dashed green = touching (dragged left) */}
          {!pose && pv.box && <rect x={Math.min(pv.box.from.x, pv.box.to.x)} y={Math.min(pv.box.from.y, pv.box.to.y)} width={Math.abs(pv.box.to.x - pv.box.from.x)} height={Math.abs(pv.box.to.y - pv.box.from.y)}
            fill={pv.box.whole ? 'rgba(42,127,255,0.08)' : 'rgba(40,170,90,0.08)'} stroke={pv.box.whole ? '#2a7fff' : '#28aa5a'} strokeWidth={px}
            strokeDasharray={pv.box.whole ? undefined : `${5 * px} ${3 * px}`} />}
          {/* the selection reads at a glance (bowen 1791558186): a wide blue halo under each selected line, and a dashed box around it all */}
          {!pose && g.lines.filter(G => selLines.includes(G.id)).map(G => <path key={'halo' + G.id} d={path(G.curve)} fill="none" stroke="#2a7fff" strokeOpacity={0.3}
            strokeWidth={line(G.id).stroke.width + 8 * px} strokeLinecap="round" />)}
          {!pose && selLines.length > 0 && ps.length > 1 && (() => {
            const xs = ps.map(p => p.x), ys = ps.map(p => p.y), m = 8 * px
            return <rect x={Math.min(...xs) - m} y={Math.min(...ys) - m} width={Math.max(...xs) - Math.min(...xs) + 2 * m} height={Math.max(...ys) - Math.min(...ys) + 2 * m}
              fill="none" stroke="#2a7fff" strokeWidth={px} strokeDasharray={`${4 * px} ${3 * px}`} />
          })()}
          {g.lines.map(G => {
            const l = line(G.id), on = selLines.includes(l.id), picked = pv.pick?.kind === 'line' && pv.pick.id === l.id
            // while posing, no edit marks: neither selection nor picks (dot 1791686247)
            const stroke = pose ? (l.state.locked ? '#933' : '#111') : cutLines.has(l.id) ? '#bbb' : picked ? '#f80' : pv.mirrorSource.includes(l.id) ? '#a3c' : on ? '#06f' : l.state.locked ? '#933' : '#111'
            return <path key={G.id} d={path(G.curve)} fill="none" stroke={stroke} strokeWidth={l.stroke.width}
              strokeDasharray={l.state.visible ? undefined : `${4 * px} ${4 * px}`} opacity={l.state.visible ? 1 : 0.35} strokeLinecap="round" />
          })}
          {g.arcs.map(a => <path key={a.key} d={path(a.curve)} fill="none" stroke="#a50" strokeWidth={2} />)}
          {/* the pending mark (stage 2): an orange dot on each line whose front differs from the baseline */}
          {!pose && g.lines.filter(G => pending.includes(G.id)).map(G => { const m = mid(G.curve); return <circle key={'pending' + G.id} data-pending={G.id} cx={m.x} cy={m.y} r={4 * px} fill="#f80" stroke="#fff" strokeWidth={px} /> })}
          {/* playback on a line: the pickable points, and the drag's ghost at start + displacement (stage 3b package 5) */}
          {pose && onLine && (() => s.points.filter(p => shownEnds.has(p.id)).map(p => <circle key={'pp' + p.id} data-pickable={p.id} cx={p.position.x} cy={p.position.y} r={3 * px} fill="#fff" stroke="#333" strokeWidth={px} />))()}
          {pose && corrGhost && shownLines.filter(l => l.a === corrGhost.id || l.b === corrGhost.id).map(l => {
            const mv = (id: Id) => (id === corrGhost.id ? corrGhost.to : pos(id)), a = mv(l.a), b = mv(l.b)
            return <path key={'cg' + l.id} data-ghost={l.id} d={path([a, add(a, l.ha), add(b, l.hb), b])} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />
          })}
          {pose && corrGhost && <circle data-ghost-point={corrGhost.id} cx={corrGhost.to.x} cy={corrGhost.to.y} r={4 * px} fill="#06f" />}
          {!pose && ghostLines.map((c, i) => <path key={'g' + i} d={path(c)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {!pose && pv.handles.map(({ line: id, end }) => {
            const l = line(id), p = pos(l[end]), h = add(p, end === 'a' ? l.ha : l.hb), on = isSel({ kind: 'handle', line: id, end })
            return <g key={id + end}>
              <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="#888" strokeWidth={px} />
              <rect x={h.x - 3 * px} y={h.y - 3 * px} width={6 * px} height={6 * px} fill={on ? '#06f' : '#fff'} stroke="#555" strokeWidth={px} />
            </g>
          })}
          {!pose && s.points.filter(p => pvPoints.has(p.id)).map(p => {
            const on = isSel({ kind: 'point', id: p.id }), picked = pv.pick?.kind === 'point' && pv.pick.id === p.id
            return <circle key={p.id} cx={p.position.x} cy={p.position.y} r={(p.links.length ? 5 : 3.5) * px}
              fill={picked ? '#f80' : on ? '#06f' : p.links.length ? '#fc0' : '#fff'} stroke="#333" strokeWidth={px} />
          })}
          {!pose && pv.pen && 'at' in pv.pen && <circle cx={pv.pen.at.x} cy={pv.pen.at.y} r={3 * px} fill="#f80" />}
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
