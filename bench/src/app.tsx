// Throwaway test bench (bowen 1791477975): drawing, camera, panels, files and the log.
// The tools and every unfinished operation are the interaction package's (graph
// "Interaction", doc 22); one-shot panel commands call core's public operations and then
// tell interaction (doc 22 §3.5). Uses core's public entry only.
import { useEffect, useReducer, useRef, useState } from 'react'
import { Core, save, open, correctionEdge, Refusal, type Vec, type Snapshot, type Editor, type ReferenceImage, type ReferenceProps, type ReferenceSlot, type AssetUse } from '../../src'
import { createInteraction, REACH, type Tool, type Preview } from '../../interaction'
import { createAutosave, indexedDbStore, type Autosave, type Store } from '../../autosave'
import eyeFixture from '../../test/fixtures/v2-right-eye.json'
import { LayersPanel } from '../../visual'
import { Rename } from '../../rename'
import { cursorFor } from '../../cursor'
import { PosePad } from '../../pose-pad'
import { labelsFor, middleOf, type Kind as LabelKind } from '../../name-labels'
import { createMover, isArrow, type Target } from '../../move'
import { Slider } from '../../slider'
import { createInkCache } from '../../ink'

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

const TOOLS: [Tool, string][] = [['pen', 'Pen P'], ['V', 'V group'], ['A', 'A direct'], ['split', 'Split S'], ['bind', 'Bind B'], ['merge', 'Merge pos M'], ['link', 'Link L'], ['unbind', 'Unbind U'], ['join', 'Join J'], ['fill', 'Fill F'], ['deform', '四角/曲边']]

/** The autosave store (docs/autosave-plan.md): IndexedDB in a browser; a test may give its own; none without either. */
const autosaveStore = (): Store | undefined => (window as unknown as { benchStore?: Store }).benchStore ?? (typeof indexedDB !== 'undefined' ? indexedDbStore() : undefined)

export function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [layer, setLayer] = useState<Id>('layer-1')
  const [layers, setLayers] = useState<Id[]>(['layer-1']) // the selected layers (docs/layer-scope-plan.md §1)
  // Z is a view tool: the camera is the app's, so it lives here, not in interaction (bowen 1791554415)
  const [zoomTool, setZoomTool] = useState(false)
  // 从视角应用 (bowen 1791878160): on, the nine view buttons pick the view to apply from; Esc cancels. It belongs
  // to the drawing and the view it was started in: another drawing or view ends it (dot 1791879488)
  const [applyFromAt, setApplyFromAt] = useState<{ core: Core; view: string } | null>(null), applyFromOn = useRef(false)
  // the one display kind of the name labels (docs/name-labels-plan.md; bowen 1791731823; dot 1791732110): set only
  // when A / V actually hit a line, a layers row is clicked or a name is found; nothing else changes it
  const [labelKind, setLabelKind] = useState<LabelKind>('line')
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
  // the newest pose for the key listener, which is installed once per ix (dot 1791769087); set again by each key step
  const poseRef = useRef(pose)
  poseRef.current = pose
  const poseGen = useRef(0), openSeq = useRef(0)
  // stage 3b package 5: a playback drag's refusal, shown until the next press, pose change or
  // leaving playback; the drag's ghost (the picked point and where it is dragged); the number
  // fields' own text, kept apart from the pose (dot 1791696847)
  const [corrRefusal, setCorrRefusal] = useState<null | { message: string; objects: readonly { kind: string; id: string }[] }>(null)
  const [corrGhost, setCorrGhost] = useState<null | { id: Id; to: Vec }>(null)
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
  // ink outlines (docs/ink-p1-checklist.md): on by default since bowen 1791815311 (joins only show with it); off = the
  // old SVG strokes, kept for comparison; not saved, never in undo
  const [inkOn, setInkOn] = useState(true)
  const [canvasPicks, setCanvasPicks] = useState(0)
  const inkCache = useRef(createInkCache())
  const [activeRef, setActiveRef] = useState<null | RefBind>(null)
  const keyHooks = useRef<{ nudge?: (e: KeyboardEvent) => boolean; afterArrow?: () => void; poseArrow?: (e: KeyboardEvent) => void }>({})
  // moving by keyboard (docs/move-plan.md): the picture's sessions run here, the selection's in interaction;
  // a key run holds the one gesture slot as `KEYS`, so a canvas press meanwhile is ignored and every cancel path ends it
  const KEYS = -1
  /** A slider's thumb key run (docs/slider-plan.md): its own slot id; every rule for a key run applies to it too (dot 1791771773). */
  const SLIDER_KEYS = -2
  const isKeyRun = (g: null | { id: number }) => g?.id === KEYS || g?.id === SLIDER_KEYS
  const picMover = useRef(createMover()).current
  /** The picture's arrows: 1 drawing unit, Shift 10, Option / Ctrl 0.1 — this caller's sizes (bowen 1791769146). */
  const PICTURE_STEPS = { step: 1, long: 10, short: 0.1 }
  /**
   * Playback's arrows turn the view, as the coord grid's point does (bowen 1791768754; docs/keyboard-pose-pan-plan.md):
   * a `move/` key run whose steps — 1°, Shift 10°, Option / Ctrl 0.1° — each move the pose as it is now.
   */
  const poseMover = useRef(createMover()).current
  const POSE_STEPS = { step: 1, long: 10, short: 0.1 }
  const holdKeys = () => {
    if (gesture.current) return
    const cancel = (why: string) => {
      if (gesture.current?.cancel === cancel) gesture.current = null
      if (ix.moving() === 'keys') ix.cancel(); else if (picMover.running) picMover.cancel(); else poseMover.cancel()
      note(`key move cancelled by ${why}`); bump()
    }
    gesture.current = { id: KEYS, right: false, cancel }
  }
  // after every render: a key run that has ended (committed, or ended inside interaction by an undo or a selection change) gives the slot back
  useEffect(() => { if (gesture.current?.id === KEYS && ix.moving() !== 'keys' && picMover.running !== 'keys' && poseMover.running !== 'keys') gesture.current = null })
  /** A press during a pose key run is not ignored: it ends the run (the pose stays) and acts (dot 1791769205). */
  const endPoseRun = () => { if (gesture.current?.id === KEYS && poseMover.running === 'keys') gesture.current.cancel('a press') }
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
  const applyFrom = applyFromAt !== null && applyFromAt.core === core && applyFromAt.view === shown
  const setApplyFrom = (on: boolean) => setApplyFromAt(on ? { core, view: shown } : null)
  applyFromOn.current = applyFrom
  // ended, not paused: coming back to that drawing or view does not bring it back (dot 1791879765)
  useEffect(() => { if (applyFromAt && !applyFrom) setApplyFromAt(null) })
  // lines whose front differs from the angle baseline (stage 2): marked on the canvas
  const pending = core.pendingLines()
  // while posing, the drawing is the pose (Core.atPose: read only, drawn through the same reads as a view)
  const posed = (() => { try { return pose ? core.atPose(pose) : null } catch (err) { return err as Error } })()
  // the drawing this frame shows, bound with it during playback: a press on a frame drawn before
  // another App changed the shared drawing must not start a correction (dot 1791697642)
  const frame = useRef<{ core: Core; text: string } | null>(null)
  frame.current = pose || moveRef ? { core, text: save(core) } : null
  const reader = posed && !(posed instanceof Error) ? posed : core.in(shown)
  const s = reader.snapshot(), g = reader.geometry(), zones = reader.zones()
  // the canvas's one selected line or point: the properties panel shows it (J1b)
  const canvasSubject = s.selection.length === 1 && (s.selection[0]!.kind === 'line' || s.selection[0]!.kind === 'point') ? { kind: s.selection[0]!.kind, id: s.selection[0]!.id } : null
  // with the switch on, each visible line's ink (P1: single lines, today's round-capped look); a line whose ink a check
  // flags is still drawn and marked red (visible, reproducible — never hidden); only a line with nothing to draw is drawn
  // as today's stroke (bowen 1791801560 / 1791801629, dot 1791801801)
  const ink = inkOn ? inkCache.current.build(g, { ...s, zones }) : null, inkOf = new Map((ink?.pieces ?? []).map(p => [p.source.id, p] as const))
  const inkDefects = new Map((ink?.diagnostics ?? []).filter(d => d.status === 'defect').map(d => [d.source.id, d.reason ?? ''] as const))
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
  const SETTABLE = ['x', 'y', 'scale', 'angle', 'opacity', 'visible', 'flipped'] as const
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
  /**
   * The one ending of a control acting on a picture (§10; dot 1791725888, ledger row 16): (1) the binding made
   * when the control was drawn — drawing, counter, picture id and source — must still find that picture,
   * otherwise the whole action is dropped (dot 1791717696); (2) a running gesture is cancelled by its one
   * cancel path, listeners and ghost with it (dot 1791717672); (3) a panel preview ends by its one ending,
   * written if unchanged underneath; (4) the picture is read again and the action done with those values
   * (so a previewed angle, then 存, saves the angle just written; dot 1791717133).
   */
  const refAct = (b: RefBind, what: string, act: (r: ReferenceImage) => void) => {
    if (!refNow(b)) { note(`${what} dropped: the picture is no longer the one shown`); bump(); return }
    endOpenField() // an open field ends by its own ending (its typed value written), never written again by a late blur
    gesture.current?.cancel(what)
    commitPreview()
    const r = refNow(b)
    if (r) act(r)
  }
  /** Mirror ⇆ (§9): what is seen, flipped left-right about the picture's centre — flipped toggled, angle negated. */
  const mirrorRef = (b: RefBind) => refAct(b, 'Mirror', r => run(x => x.setReference(r.id, { flipped: !r.flipped, angle: 0 - r.angle })))
  /** A library picture as a control drew it (§10): the same drawing and counter, the entry with the same id and content. */
  const libNow = (b: RefBind) => (b.core === core && b.gen === refGen.current ? core.library().find(a => a.id === b.id && a.src === b.src) : undefined)
  /** The same one ending for a library control, bound to its entry. */
  const libAct = (b: RefBind, what: string, act: (a: AssetUse) => void) => {
    if (!libNow(b)) { note(`${what} dropped: the library picture is no longer the one shown`); bump(); return }
    endOpenField()
    gesture.current?.cancel(what)
    commitPreview()
    const a = libNow(b)
    if (a) act(a)
  }
  /** A picture file read and decoded, then handed on only if this App's counter and the drawing still hold (§7.1). */
  const readPicture = (f: File, done: (pic: { src: string; width: number; height: number }) => void) => {
    const start = { gen: refGen.current, core, text: save(core) }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result), pic = new Image()
      pic.onload = () => {
        if (start.gen !== refGen.current || start.core !== core || save(core) !== start.text) { note(`picture ${f.name} dropped: the drawing, view or mode changed while it was read`); bump(); return }
        done({ src, width: pic.width, height: pic.height })
      }
      pic.onerror = () => { note(`picture ${f.name} not added: it does not decode`); bump() }
      pic.src = src
    }
    reader.readAsDataURL(f)
  }
  const run = (fn: (e: Editor) => void) => {
    // the outcome goes to interaction, the one owner of feedback (dot 1791551067)
    try { logged(core).editIn(env.current.view, fn); ix.outcome(); return true }
    catch (err) { ix.outcome(err); return false }
    finally { bump() }
  }
  /** The panel changed the selected layers; the selection elsewhere simply goes inert (docs/layer-scope-plan.md §3). */
  const selectLayers = (ids: Id[], current: Id) => { if (isKeyRun(gesture.current)) gesture.current!.cancel('a layer scope change'); setLayers(ids); setLayer(current) }
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
  // where the pointer rests over the canvas (no button held), in screen coordinates — a pan or zoom maps it anew
  // (dot 1791737579) — with its modifiers; the hover is asked again after every render and on Shift / Option
  const hoverAt = useRef<{ clientX: number; clientY: number; mods: ReturnType<typeof mods> } | null>(null)
  // a press the tool took is held: the canvas cursor asks cursor/ with it (A / V grab). Set where the
  // gesture starts, cleared in its one `stop` (release, cancel, blur, tool change, playback) (dot 1791708548)
  const [pressed, setPressed] = useState(false)
  // what a press on the canvas does, named for the cursor table in the same order as the canvas routes
  // the press: Zoom (a viewport tool) in every mode; else restoring takes none, playback drags the pose,
  // Move picture moves the picture, otherwise the tool; those three show the arrow (dot 1791710244, 1791727663)
  const boxShown = !pose && !restoring && !moveRef && !!pv.selectionBox
  const boxHot = boxShown ? pv.selectionBox?.hot ?? null : null
  // the resting pointer asked again — after every render (a tool, view, selection, pan or zoom change) and on Shift / Option
  const rehover = useRef(() => {})
  rehover.current = () => {
    const h = hoverAt.current
    if (h && !gesture.current && !pose && !restoring && !moveRef && !zoomTool) ix.pointerHover(toDoc(h), h.mods)
  }
  useEffect(() => { rehover.current() })
  const pressTakenBy = zoomTool ? 'Z' : restoring ? 'restoring' : pose ? 'playback' : moveRef ? 'movePicture' : boxHot ? `box:${boxHot}` : ix.tool
  const note = (what: string) => { log.unshift({ calls: what, result: 'ok (diagnostic)' }); log.length = Math.min(log.length, 50) }
  const BUTTON_BIT = [1, 4, 2] // button 0 → buttons bit 1 (left), 1 → 4 (middle), 2 → 2 (right)
  const CLICK = 2 // screen px a press may move and still be a click (v1: 7205381 DrawingRoom zoom)
  const onDown = (e: React.PointerEvent) => {
    endOpenField()
    endPoseRun()
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return // another pointer while a gesture runs: ignored
      gesture.current.cancel('a new press of the same pointer') // its earlier release was missed
    }
    const id = e.pointerId, bit = BUTTON_BIT[e.button] ?? 1, start = P(e.clientX, e.clientY), from = box, at = toDoc(e)
    // what this press is (bowen 1791554290, 1791554415): right or middle drags the canvas, and an
    // unmoved right press is the right click (cancel one level); with Z, the left button zooms;
    // otherwise the tool gets the press, and a press that hits nothing only clears the selection
    const kind = e.button === 1 || e.button === 2 ? 'pan' : zoomTool ? 'zoom' : ix.pointerDown(at, mods(e)) ? 'tool' : null
    // A or V picked a line (a line already selected included): the labels follow the tool. A point, a handle or
    // nothing picked changes nothing (dot 1791732824); what was picked is the interaction's, not decided here
    if (kind === 'tool' && (ix.tool === 'A' || ix.tool === 'V') && ix.lastPress() === 'line') setLabelKind(ix.tool === 'A' ? 'line' : 'curve')
    // every canvas pick of a line or a point counts, even of the object already picked: the properties panel shows the last pick (dot)
    if (kind === 'tool' && (ix.tool === 'A' || ix.tool === 'V') && (ix.lastPress() === 'line' || ix.lastPress() === 'point')) setCanvasPicks(n => n + 1)
    if (!kind) return
    let moved = false
    const zoomBy = (k: number) => setBox({ x: at.x - (at.x - from.x) * k, y: at.y - (at.y - from.y) * k, w: from.w * k, h: from.h * k })
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & bit) === 0) { if (kind === 'tool') note('release found by a move without the starting button held (pointerup missed)'); release(ev); return }
      if (kind === 'tool') { ix.pointerMove(toDoc(ev), mods(ev)); return }
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
      if (kind === 'tool') { ix.pointerUp(toDoc(ev), mods(ev)); return }
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
    endOpenField()
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
    // the drag is a move/ session (docs/move-plan.md): its offset the pointer's displacement, one setReference at the end;
    // it commits only if the whole drawing is still the frame pressed on (as before)
    picMover.press(pictureTarget(hit, bind, () => core === shownFrom.core && save(core) === shownFrom.text, 'picture move cancelled: the drawing changed during the drag'), at)
    const travel = (ev: PointerEvent) => { moved ||= Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & 1) === 0) { release(ev); return }
      travel(ev)
      if (moved) picMover.drag(toDoc(ev))
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      travel(ev)
      stop()
      if (!moved) { picMover.cancel(); return } // a click only makes the picture active
      picMover.release(toDoc(ev))
    }
    const cancelWith = (why: string) => { if (done) return; picMover.cancel(); stop(); note(`picture move cancelled by ${why}`); bump() }
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
  /**
   * The picture as a move target (docs/move-plan.md): bound to the picture as drawn; the preview is start +
   * offset, never written; one setReference at the end, only if `still()` holds and the picture is the one
   * bound and unchanged underneath (§8a), else dropped with `why`.
   */
  function pictureTarget(r: ReferenceImage, bind: RefBind, still: () => boolean, why: string): Target {
    const at = (o: { x: number; y: number }) => ({ x: r.x + o.x, y: r.y + o.y })
    const clear = () => { previewNow.current = null; setRefPreview(null) }
    return {
      begin: () => true,
      preview: o => { const next = { ...bind, base: r, props: at(o) }; previewNow.current = next; setRefPreview(next) },
      commit: o => {
        clear()
        const now = refNow(bind)
        if (!still() || !now || !sameBase(now, r)) { note(why); bump(); return }
        run(x => x.setReference(r.id, at(o)))
      },
      cancel: clear,
    }
  }
  /**
   * Arrow keys while Move picture is on (§8.2, §8a.2): a key run on the active picture — Shift ×10, Option or
   * Ctrl ×0.1, one undo step for the whole run (bowen 1791733125, 1791733775) — never reaching lines.
   */
  keyHooks.current.nudge = (e: KeyboardEvent) => {
    if (!moveRef || !isArrow(e.key)) return false
    if (e.metaKey && !e.ctrlKey) return false // ⌘ + arrow is not a move, as for the selection (dot 1791734673)
    e.preventDefault()
    if (gesture.current && gesture.current.id !== KEYS) return true // a drag runs: one session at a time
    if (!picMover.running && previewNow.current) return true // a panel preview is open
    picMover.keyDown(() => { const r = refNow(activeRef); return r ? pictureTarget(r, { core, gen: refGen.current, id: r.id, src: r.src }, () => true, 'picture move dropped: the picture changed underneath') : undefined },
      { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, PICTURE_STEPS)
    if (picMover.running === 'keys') holdKeys()
    return true
  }
  /** The selection's arrows (with V / A): interaction runs them; the bench gives the run the one gesture slot. */
  keyHooks.current.afterArrow = () => { if (ix.moving() === 'keys') holdKeys() }
  const onPoseDown = (e: React.PointerEvent) => {
    endOpenField()
    endPoseRun()
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
    ix.cancelAll(); setApplyFrom(false)
    posing.current = true; poseGen.current++; refGen.current++
    const [yaw, pitch] = shown.slice('view:'.length).split(',').map(Number)
    setPose({ yaw: yaw!, pitch: pitch! }); setCorrRefusal(null)
  }
  const stopPose = () => { gesture.current?.cancel('leaving playback'); refGen.current++; posing.current = false; setPose(null); setCorrRefusal(null) }
  /** A valid pose change ends a playback drag first: a target belongs to one pose (dot 1791696847). */
  /**
   * The one update of a pose that takes effect (dot 1791727663, 1791727680): the pose and both number fields
   * together, so the pad, the sliders and the fields agree. Its source decides what it cancels: the pad's own
   * updates during its drag never cancel that drag; any other source (a slider, a field) ends a running
   * gesture first — a correction drag (dot 1791696847) or a pad drag. A field being typed into keeps its text.
   */
  const changePose = (next: { yaw: number; pitch: number }, source: 'pad' | 'keys' | 'slider' | 'yaw-field' | 'pitch-field') => {
    // the pad's and the keys' own steps never end their own gesture; any other source ends a running one
    if (source !== 'pad' && source !== 'keys' && source !== 'slider') gesture.current?.cancel('a pose change')
    setCorrRefusal(null); setPose(next)
  }
  const LIMITS = { yaw: 90, pitch: 45 } as const
  /**
   * The decimal places of a number (up to 20), so a step adds without a float tail and without losing the pose's own
   * decimals; a number with more (no short decimal form) is added as it is, at plain JS precision (dot 1791770081).
   */
  const places = (n: number) => { for (let d = 0; d <= 20; d++) if (Number(n.toFixed(d)) === n) return d; return Infinity }
  const SHORT_PLACES = places(POSE_STEPS.short)
  /**
   * The pose's key run (docs/keyboard-pose-pan-plan.md §1): each preview is turned into the step it adds and applied to
   * the pose as it is now, on the moved axis only, clamped — no dead travel at a limit (dot 1791769205); ending keeps
   * the last pose (commit and cancel alike), as the grid does.
   */
  const poseTarget = (): Target | undefined => {
    if (!poseRef.current) return undefined
    let last = { x: 0, y: 0 }
    const sum = (v: number, d: number) => { const p = Math.max(places(v), SHORT_PLACES); return p <= 20 ? Number((v + d).toFixed(p)) : v + d }
    const add = (v: number, d: number, limit: number) => (d === 0 ? v : Math.max(-limit, Math.min(limit, sum(v, d))))
    return {
      begin: () => true,
      preview: o => {
        const now = poseRef.current
        const dx = Number((o.x - last.x).toFixed(SHORT_PLACES)), dy = Number((o.y - last.y).toFixed(SHORT_PLACES))
        last = o
        if (!now) return
        const next = { yaw: add(now.yaw, dx, LIMITS.yaw), pitch: add(now.pitch, -dy, LIMITS.pitch) } // ↑ is +pitch: the grid's top is +45
        if (next.yaw === now.yaw && next.pitch === now.pitch) return
        poseRef.current = next
        changePose(next, 'keys')
      },
      commit: () => {},
      cancel: () => {},
    }
  }
  keyHooks.current.poseArrow = (e: KeyboardEvent) => {
    poseMover.keyDown(poseTarget, { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, POSE_STEPS)
    if (poseMover.running === 'keys') holdKeys()
  }
  /**
   * The sliders (docs/slider-plan.md): a slide or a thumb key run takes the one gesture slot as a pad drag does (its key
   * runs as `SLIDER_KEYS`, not `KEYS`, which the editing and picture runs own); typing is the one **open field**, ended
   * — as leaving it would — before any other input begins (dot 1791770098).
   */
  const openField = useRef<null | { end(): void }>(null)
  const endOpenField = () => { const f = openField.current; openField.current = null; f?.end() }
  const sliderHooks = {
    onStart: (d: { input: 'drag' | 'keys'; pointerId?: number; cancel(): void }) => {
      endOpenField()
      const id = d.input === 'keys' ? SLIDER_KEYS : d.pointerId!
      if (gesture.current && gesture.current.id !== id && d.input === 'drag' && gesture.current.id >= 0) return false // another pointer's gesture keeps the slot
      gesture.current?.cancel('a slider')
      gesture.current = { id, right: false, cancel: () => d.cancel() }
      sliderCancel.current = gesture.current.cancel
      return true
    },
    onEnd: () => { if (gesture.current && gesture.current.cancel === sliderCancel.current) gesture.current = null; sliderCancel.current = null },
    onField: (d: { end(): void } | null) => { if (d) { if (openField.current && openField.current !== d) endOpenField(); openField.current = d } else openField.current = null },
  }
  const sliderCancel = useRef<null | ((why: string) => void)>(null)
  /** A tool change (key or button, Z included) ends any gesture through its one cancel path (dot 1791554909). */
  const chooseTool = (t: Tool | 'Z') => {
    gesture.current?.cancel('a tool change')
    setZoomTool(t === 'Z')
    if (t !== 'Z') ix.setTool(t)
  }
  /** Zoom is a viewport tool (bowen 1791727452): Z or its button turns it on and, pressed again, off — in every mode. */
  const toggleZoom = () => { gesture.current?.cancel('a tool change'); setZoomTool(z => !z) }
  /** In playback, Move picture and restoring, a press that belongs to a viewport tool (Zoom on, the middle or right button) goes to the canvas's viewport path; none of these reaches a tool that writes. */
  const viewportPress = (e: React.PointerEvent) => zoomTool || e.button === 1 || e.button === 2
  const onWheel = (e: React.WheelEvent) => {
    const at = toDoc(e), k = Math.exp(e.deltaY * 0.001)
    setBox(b => ({ x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k }))
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'Shift' || e.key === 'Alt') && hoverAt.current) { hoverAt.current.mods = mods(e); rehover.current() }
      // Esc first: it cancels a gesture even in playback and with a field focused (dot 1791696958)
      if (e.key === 'Escape' && gesture.current) { gesture.current.cancel('Esc'); e.preventDefault(); return }
      if (e.key === 'Escape' && applyFromOn.current) { setApplyFrom(false); e.preventDefault(); return }
      // only a field that takes typing keeps its keys (dot 1791544530), an input method its own (dot 1791727663);
      // a focused button never blocks a shortcut (bowen 1791556992: after clicking Flip or Zoom, V / A / ⌘Z still work)
      const t = e.target as HTMLElement
      const typing = e.isComposing || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
        || (t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset'].includes((t as HTMLInputElement).type))
      // an input method taking the keys ends a key run: its held key's repeats are not this run's after (dot 1791770081)
      if (typing) { if (e.isComposing && isKeyRun(gesture.current)) gesture.current!.cancel('an input method'); return }
      // an arrow on any focused field or slider is that control's own (a slider steps with it), never a move;
      // a key run already running still ends only by its own paths (dot 1791734673)
      if (isArrow(e.key) && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.getAttribute?.('role') === 'slider')) return
      // undo / redo during a key run (the selection's or the picture's) end the run, write nothing and undo nothing earlier (dot 1791734673)
      if (isKeyRun(gesture.current) && e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) { gesture.current!.cancel(e.shiftKey ? 'redo' : 'undo'); e.preventDefault(); return }
      // a plain Z is the viewport's zoom, in every mode (bowen 1791727452); ⌘Z / Ctrl-Z stays undo
      // a key held down repeats: only its first press toggles (dot 1791731833)
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey) { if (!e.repeat) toggleZoom(); e.preventDefault(); return }
      // then the write gates: restoring and playback take no other shortcut (dot 1791704242, 1791683911)
      if (restoringNow.current) return
      // playback: a plain arrow on the canvas turns the view; its default is prevented even when it changes nothing
      // (a limit, a gesture running), so the page never scrolls; ⌘ + arrow keeps its own behaviour (dot 1791769087)
      if (posing.current && isArrow(e.key) && !e.metaKey) { // every ⌘ combination keeps its own (⌘ + Ctrl too; dot 1791770081)
        e.preventDefault()
        if (gesture.current && gesture.current.id !== KEYS) return // a drag runs: ignored, and its repeats never start a run
        keyHooks.current.poseArrow?.(e)
        return
      }
      if (posing.current) return
      if (keyHooks.current.nudge?.(e)) return
      if (isArrow(e.key) && gesture.current && gesture.current.id !== KEYS) { e.preventDefault(); return } // a drag runs: one session at a time
      // one Esc cancels one thing: a gesture in progress (above) if there is one, else interaction's innermost (dot 1791553129)
      // a plain letter interaction takes is a tool key: it ends any gesture and leaves Z
      if (/^[a-y]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && ix.key(e.key, mods(e))) { e.preventDefault(); chooseTool(ix.tool); return }
      if (ix.key(e.key, { ...mods(e), ctrl: e.ctrlKey, repeat: e.repeat })) { e.preventDefault(); if (isArrow(e.key)) keyHooks.current.afterArrow?.() }
    }
    // a key release ends a key run wherever focus is: no typing check here (dot 1791733489)
    const up = (e: KeyboardEvent) => {
      if ((e.key === 'Shift' || e.key === 'Alt') && hoverAt.current) { hoverAt.current.mods = mods(e); rehover.current() }
      if (!isArrow(e.key)) return; ix.keyUp(e.key); picMover.keyUp(e.key); poseMover.keyUp(e.key) }
    // a key run ends on leaving the window, and when focus moves inside the page to a field or a slider
    const blur = () => { if (isKeyRun(gesture.current)) gesture.current!.cancel('leaving the window') }
    const focus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (isKeyRun(gesture.current) && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) gesture.current!.cancel('focus moving to a field')
    }
    const composing = () => { if (isKeyRun(gesture.current)) gesture.current!.cancel('an input method') }
    window.addEventListener('keydown', key); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('focusin', focus); document.addEventListener('compositionstart', composing)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('focusin', focus); document.removeEventListener('compositionstart', composing) }
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
            {(['yaw', 'pitch'] as const).map(axis => {
              // the pose is a view: preview and commit both set it, a cancel keeps the last (as the grid); a thumb session's
              // own updates never cancel it, typing ends any other gesture as a field always did
              const set = (v: number, input: 'drag' | 'keys' | 'typing') => { const now = poseRef.current; if (now && now[axis] !== v) changePose({ ...now, [axis]: v }, input === 'typing' ? `${axis}-field` : 'slider') }
              return <div key={axis}><Slider label={axis} value={pose[axis]} identity={`pose:${axis}`} accept={v => Math.abs(v) <= LIMITS[axis]} track={[-LIMITS[axis], LIMITS[axis]]}
                steps={POSE_STEPS} fieldAttrs={{ 'data-testid': `${axis}-text` }} thumbAttrs={{ 'data-testid': axis }} {...sliderHooks}
                onPreview={set} onCommit={set} onCancel={() => {}} /></div>
            })}
            {/* yaw and pitch on one grid (bowen 1791727397): its drag takes the one gesture slot, ending the old gesture first */}
            <PosePad yaw={pose.yaw} pitch={pose.pitch} limits={LIMITS}
              onStart={d => {
                // as on the canvas: another pointer's running gesture keeps the slot, the press is ignored (dot 1791731833);
                // a pose key run is ended instead (the pose stays), and the press acts (dot 1791769205)
                endOpenField(); endPoseRun()
                if (gesture.current && gesture.current.id !== d.pointerId) return false
                gesture.current?.cancel('a pose pad press'); gesture.current = { id: d.pointerId, right: false, cancel: d.cancel }; return true
              }}
              onChange={p => changePose(p, 'pad')}
              onEnd={cancel => { if (gesture.current?.cancel === cancel) gesture.current = null }} />
          </> : <button onClick={startPose}>Playback</button>}
        </div>
        {/* viewport tools change only what the canvas shows: enabled in every mode (bowen 1791727452) */}
        <b>View</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <button data-testid="zoom" style={{ fontWeight: zoomTool ? 700 : 400, background: zoomTool ? '#cde' : undefined }} onClick={toggleZoom}>Zoom Z</button>
        </div>
        <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Tools</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {TOOLS.map(([t, label]) => { const on = !zoomTool && ix.tool === t; return <button key={t} style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : undefined }} onClick={() => chooseTool(t)}>{label}</button> })}
        </div>
        {ix.tool === 'join' && <div>
          <select value={opts.joinMode} onChange={e => ix.setOptions({ joinMode: e.target.value as typeof opts.joinMode })}><option>bound</option><option>smooth</option><option>cusp</option><option>arc</option></select>
          {opts.joinMode === 'arc' && <Slider label="r" value={opts.radius} identity="join-radius" accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
            fieldAttrs={{ 'data-testid': 'radius' }} {...sliderHooks} onPreview={() => {}} onCommit={v => ix.setOptions({ radius: v })} onCancel={() => {}} />}
          <div style={{ color: '#666' }}>click two lines; alt on the second: remove join</div>
        </div>}
        {ix.tool === 'fill' && <div><input type="color" value={opts.color} onChange={e => ix.setOptions({ color: e.target.value })} /> <span style={{ color: '#666' }}>shift-click: clear</span></div>}
        {/* 四角 / 曲边 (docs/deform-p3-checklist.md §3): the readout is the fit error before constraints (dot 1791892720) */}
        {ix.tool === 'deform' && <div data-testid="deform-panel">
          {pv.deform ? <>
            <div data-testid="deform-error" style={{ color: '#555' }}>约束前采样拟合误差 {pv.deform.maxError.toFixed(3)}</div>
            <div style={{ display: 'flex', gap: 3 }}><button data-testid="deform-reset" onClick={() => ix.deformReset()}>重置变形框</button><button data-testid="deform-done" onClick={() => ix.deformDone()}>完成</button></div>
          </> : <div style={{ color: '#666' }}>先用 V 或 A 选中要变形的线，再选这个工具</div>}
        </div>}
        <b>View</b>
        {/* the nine views (step 7): columns yaw −90 / 0 / +90, rows pitch +45 / 0 / −45 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }} data-testid="views">
          {[45, 0, -45].flatMap(pitch => [-90, 0, 90].map(yaw => {
            const k = `view:${yaw},${pitch}`, on = k === shown
            return <button key={k} data-view={k} title={applyFrom ? (on ? '当前视角' : `把 ${k} 里选中图层的曲线搬到当前视角`) : k} disabled={applyFrom && on}
              style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : applyFrom ? '#fec' : undefined }}
              onClick={() => { if (!applyFrom) { chooseView(k); return } setApplyFrom(false); run(e => e.applyFromView([...env.current.layers], k)) }}>{yaw},{pitch}</button>
          }))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button data-testid="apply-from" style={{ fontWeight: applyFrom ? 700 : 400, background: applyFrom ? '#fec' : undefined, whiteSpace: 'nowrap' }} onClick={() => setApplyFrom(!applyFrom)}
            title="把另一个视角里选中图层的曲线（端点位置和两个手柄）原样搬到当前视角；宽度等其他都不动；一步可撤销">从视角应用…</button>
          {applyFrom && <span style={{ color: '#a60' }}>选一个视角，把它的曲线搬到选中的图层（Esc 取消）</span>}
        </div>
        <b>Edit</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Undo', () => (isKeyRun(gesture.current) ? gesture.current!.cancel('undo') : ix.undo()))}{B('Redo', () => (isKeyRun(gesture.current) ? gesture.current!.cancel('redo') : ix.redo()))}
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
          {/* a field only (bowen 1791769257); "Set width" still applies it to the selected lines (dot 1791769298) */}
          <Slider label="width" value={width} identity="stroke-width" accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
            fieldAttrs={{ 'data-testid': 'width' }} {...sliderHooks} onPreview={() => {}} onCommit={v => setWidth(v)} onCancel={() => {}} />
          {B('Set width', () => (selLines.length ? run(x => selLines.forEach(l => x.lineStroke(l, { profile: line(l).stroke.profile, width }))) : (note('Set width: no line is selected — select lines first, or set a line\'s width in its properties'), bump())))}
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
            // bound at the start: the view and the box it is placed into (§7.1); into the library (or the identical entry), then placed
            const view = shown, at = box
            readPicture(f, pic => {
              const k = Math.min(1, 0.9 * at.w / pic.width, 0.9 * at.h / pic.height)
              run(x => { const asset = x.addAsset({ id: nid('asset-'), name: f.name.slice(0, 100), ...pic }); x.placeReference({ id: nid('ref-'), view, asset, width: pic.width, height: pic.height, x: at.x + at.w / 2, y: at.y + at.h / 2, scale: k, angle: 0, opacity: 0.5, visible: true }) })
            })
          }} /></label>
          <label title="实验：用墨迹轮廓画线（单线，与今天的圆头描边同形）"><input type="checkbox" data-testid="ink-outline" checked={inkOn} onChange={e => setInkOn(e.target.checked)} /> 墨迹轮廓（实验）{ink && <span data-testid="ink-diagnostics"> · 已验证 {ink.diagnostics.filter(d => d.status === 'verified').length} · 未完全证明 {ink.diagnostics.filter(d => d.status === 'unproven').length} · 瑕疵 {ink.diagnostics.filter(d => d.status === 'defect').length} · 回退 {ink.diagnostics.filter(d => d.status === 'fallback').length}</span>}</label>
          <label><input type="checkbox" data-testid="move-picture" checked={moveRef} onChange={e => { if (!e.target.checked) { gesture.current?.cancel('Move picture turned off'); setActiveRef(null) } cancelPreview(); setMoveRef(e.target.checked) }} /> Move picture (drag it, or arrow keys; Shift ×10)</label>
          {core.in(shown).references().map(r => {
            const live = refPreview && refPreview.id === r.id && refNow(refPreview) ? { ...r, ...refPreview.props } : r
            const active = refNow(activeRef)?.id === r.id
            const RANGE = { x: [box.x, box.x + box.w, 1], y: [box.y, box.y + box.h, 1], scale: [-3, 2, 0.01], angle: [-180, 180, 1], opacity: [0, 1, 0.01] } as const
            // every control below acts through the one ending, bound to this picture as drawn (dot 1791725888)
            const bound: RefBind = { core, gen: refGen.current, id: r.id, src: r.src }
            const slotsOf = (what: string, next: (now: ReferenceImage) => ReferenceSlot[] | null) => refAct(bound, what, now => { const slots = next(now); if (slots) run(x => x.setReference(now.id, { slots })) })
            return <div key={r.id} data-ref={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, outline: active ? '1px solid #2a7fff' : undefined }}>
            <input type="checkbox" checked={r.visible} onChange={e => { const v = e.target.checked; refAct(bound, 'visibility', now => run(x => x.setReference(now.id, { visible: v }))) }} />
            {(['x', 'y', 'scale', 'angle', 'opacity'] as const).map(k => {
              // one slider each (docs/slider-plan.md): preview → the shared picture preview, commit → its one setReference,
              // cancel → the preview withdrawn; accepted as core accepts (src/reference), the track only the slide's range
              const SLIDE = { x: [box.x, box.x + box.w], y: [box.y, box.y + box.h], scale: [-3, 2], angle: [-180, 180], opacity: [0, 1] } as const
              const STEPS = { x: { step: 1, long: 10, short: 0.1 }, y: { step: 1, long: 10, short: 0.1 }, angle: { step: 1, long: 10, short: 0.1 }, scale: { step: 0.01, long: 0.1, short: 0.001 }, opacity: { step: 0.01, long: 0.1, short: 0.001 } }
              const accept = (v: number) => (k === 'scale' ? v > 0 && Number.isFinite(r.width * v) && Number.isFinite(r.height * v) : k === 'opacity' ? v >= 0 && v <= 1 : Number.isFinite(v))
              return <Slider key={k} label={k} value={r[k]} identity={`${r.id}:${r.src}:${k}`} version={refGen.current} accept={accept} track={SLIDE[k]} scale={k === 'scale' ? 'log' : 'linear'} steps={STEPS[k]}
                fieldAttrs={{ 'data-field': k }} thumbAttrs={{ 'data-slider': k }} {...sliderHooks}
                onStart={d => (refNow(bound) ? sliderHooks.onStart(d) : false)}
                onPreview={v => { const now = refNow(bound); if (now) previewRef(now, { [k]: v }) }}
                onCommit={v => { const now = refNow(bound); if (!now) return; previewRef(now, { [k]: v }); commitPreview() }}
                onCancel={() => cancelPreview()} />
            })}
            {B('Mirror ⇆', () => mirrorRef(bound))}
            {B('Remove', () => refAct(bound, 'Remove', now => run(x => x.removeReference(now.id))))}
            <div data-slots={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, width: '100%' }}>
              {r.slots.map((sl, k) => <span key={k} data-slot={k} style={{ border: '1px solid #ccc', padding: '0 3px' }}>
                <Rename key={drawing} name={sl.name || `slot ${k + 1}`} style={{ fontWeight: 700, flex: 'none' }} fieldStyle={{ width: 70 }} onRename={n => slotsOf('slot rename', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, name: n.slice(0, 100) } : x)) : null))} />
                <button onClick={() => slotsOf('存', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, placement: { x: now.x, y: now.y, scale: now.scale, angle: now.angle } } : x)) : null))}>存</button>
                <button disabled={!sl.placement} onClick={() => refAct(bound, '调出', now => { const p = now.slots[k]?.placement; if (p) run(x => x.setReference(now.id, { ...p })) })}>调出</button>
                <button onClick={() => slotsOf('slot ×', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, placement: null } : x)) : null))}>×</button>
              </span>)}
              <button onClick={() => slotsOf('＋ 加一格', now => [...now.slots, { name: '', placement: null }])}>＋ 加一格</button>
            </div>
          </div>
          })}
        </div>
        <b>Library</b>
        {/* each picture's content once (§10; bowen 1791725516): placed into a view by its button, removed only when no view shows it */}
        <div data-testid="library" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label>＋ 加图片 <input type="file" data-testid="lib-file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            readPicture(f, pic => run(x => { x.addAsset({ id: nid('asset-'), name: f.name.slice(0, 100), ...pic }) }))
          }} /></label>
          {core.library().map(a => {
            const lb: RefBind = { core, gen: refGen.current, id: a.id, src: a.src }
            const k = Math.min(1, 0.9 * box.w / a.width, 0.9 * box.h / a.height)
            return <div key={a.id} data-asset={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <img src={a.src} alt="" style={{ width: 40, height: 28, objectFit: 'contain', background: '#eee', flex: 'none' }} />
              <Rename key={drawing} name={a.name} style={{ flex: 1 }} fieldStyle={{ width: 90 }} onRename={n => libAct(lb, 'library rename', now => run(x => x.renameAsset(now.id, n.slice(0, 100))))} />
              <span data-uses="" style={{ color: '#666', flex: 'none' }} title="placements · views">{a.placements} · {a.views}v</span>
              <button onClick={() => libAct(lb, '放到当前视角', now => run(x => x.placeReference({ id: nid('ref-'), view: shown, asset: now.id, x: box.x + box.w / 2, y: box.y + box.h / 2, scale: k, angle: 0, opacity: 0.5, visible: true })))}>放到当前视角</button>
              <button disabled={a.placements > 0} title={a.placements > 0 ? `shown by ${a.placements} placement(s) in ${a.views} view(s)` : 'remove from the library'} onClick={() => libAct(lb, 'library ×', now => run(x => x.removeAsset(now.id)))}>×</button>
            </div>
          })}
        </div>
        <b>Names</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {/* renaming is by double-click on the name in the layers panel (rename/, bowen 1791708333) */}
          <input placeholder="find by name" style={{ width: 110 }} onKeyDown={e => {
            if (e.key !== 'Enter') return
            const q = (e.target as HTMLInputElement).value, l = s.lines.find(x => x.name === q), gr = s.groups.find(x => x.name === q)
            if (l) { setLabelKind('line'); run(x => x.select([{ kind: 'line', id: l.id }])) }
            else if (gr) { setLabelKind('curve'); run(x => x.selectGroup(gr.lines[0]!)) }
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
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* one line always, and the column never widened by it (minWidth 0): a status that wrapped would resize the canvas between a press and its release and move the press (a click on a curve with long ids nudged it) */}
        <div data-testid="status" title={status} style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', height: 18, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: (pose ? corrRefusal : pv.refusal) ? '#c00' : '#333' }}>{status}</div>
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none', cursor: cursorFor(pressTakenBy, pressed) }} data-testid="canvas" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={e => (viewportPress(e) ? onDown(e) : restoring ? undefined : pose ? onPoseDown(e) : moveRef ? onRefDown(e) : onDown(e))}
          // hovering tells interaction what the pointer is over on the selection box (the cursor follows; selection-box plan §6)
          // the pointer's place is kept on every move and release over the canvas, a drag's too (a pan ends where the pointer
          // is, dot 1791737940); the hover is asked only with no button and no gesture — and after every render
          onPointerMove={e => { hoverAt.current = { clientX: e.clientX, clientY: e.clientY, mods: mods(e) }; if (e.buttons === 0) rehover.current() }}
          onPointerUp={e => { hoverAt.current = { clientX: e.clientX, clientY: e.clientY, mods: mods(e) } }} onPointerLeave={() => { hoverAt.current = null; ix.pointerHover(null) }} onWheel={onWheel}
          // the right click itself is the unmoved right press (onDown); a right press during a left
          // drag comes only as this event, and cancels that drag (one level)
          onContextMenu={e => { e.preventDefault(); if (gesture.current && !gesture.current.right) gesture.current.cancel('a right click') }}>
          {!pose && core.in(shown).references().filter(r => r.visible).map(r0 => {
            // a live preview of this picture, if it is still bound to what is shown (§8.1, §8a.3)
            const r = refPreview && refPreview.id === r0.id && refNow(refPreview) ? { ...r0, ...refPreview.props } : r0
            const w = r.width * r.scale, h = r.height * r.scale
            return <image key={r.id} data-reference={r.id} href={r.src} x={r.x - w / 2} y={r.y - h / 2} width={w} height={h} opacity={r.opacity} preserveAspectRatio="none"
              // the picture's own left-right mirror first, then its rotation about the centre (SVG applies the list right to left)
              transform={`rotate(${r.angle} ${r.x} ${r.y})${r.flipped ? ` translate(${r.x} ${r.y}) scale(-1 1) translate(${-r.x} ${-r.y})` : ''}`} onError={() => { const at = core; setRefBroken(b => (b.some(x => x.core === at && x.id === r.id && x.src === r.src) ? b : [...b, { core: at, id: r.id, src: r.src }])) }} />
          })}
          <line x1={s.axis} x2={s.axis} y1={box.y - 1e4} y2={box.y + 1e4} stroke="#9cf" strokeDasharray={`${6 * px} ${4 * px}`} strokeWidth={px} />
          {(() => {
            const paintOf = (id: string) => {
              const l = line(id), on = selLines.includes(l.id), picked = pv.pick?.kind === 'line' && pv.pick.id === l.id
              // while posing, no edit marks: neither selection nor picks (dot 1791686247)
              return pose ? (l.state.locked ? '#933' : '#111') : cutLines.has(l.id) ? '#bbb' : picked ? '#f80' : pv.mirrorSource.includes(l.id) ? '#a3c' : on ? '#06f' : l.state.locked ? '#933' : '#111'
            }
            const loopsD = (loops: readonly (readonly { x: number; y: number }[])[]) => loops.map(q => 'M' + q.map(v => `${v.x} ${v.y}`).join(' L') + ' Z').join(' ')
            const defectMark = (key: string, d: string, why: string | undefined) => why !== undefined &&
              <path key={'defect' + key} data-ink-defect={key} d={d} fill="none" stroke="#e00" strokeWidth={1.5 * px} strokeDasharray={`${3 * px} ${2 * px}`}><title>{why}</title></path>
            // pieces joined by arcs: one filled path when their lines share a paint (no hairline seam, dot 1791802438); otherwise each line
            // in its own paint and the arc in the base colour under them — the state shows in the halo (a recorded limit); the shape is the
            // same either way, so selection never changes a join's shape
            const uniform = new Map<string, { group: NonNullable<typeof ink>['groups'][number]; paint: string; first: boolean }>(), arcsAlone: NonNullable<typeof ink>['pieces'][number][] = []
            for (const gr of ink?.groups ?? []) {
              const paints = new Set(gr.pieces.flatMap(p => p.source.kind === 'line' ? [paintOf(p.source.id)] : []))
              // an empty union is nothing to draw: the group falls back to its pieces (dot 1791803549)
              if (paints.size === 1 && gr.loops.length) { let first = true; for (const G of g.lines) if (gr.pieces.some(p => p.source.kind === 'line' && p.source.id === G.id)) { uniform.set(G.id, { group: gr, paint: [...paints][0]!, first }); first = false } }
              else arcsAlone.push(...gr.pieces.filter(p => p.source.kind !== 'line'))
            }
            for (const p of ink?.pieces ?? []) if (p.source.kind !== 'line' && !(ink?.groups ?? []).some(gr => gr.pieces.includes(p))) arcsAlone.push(p)
            // the canvas paints in the panel's order (dot 1791866043): layers bottom → top, each layer's curves bottom → top
            // (s.groups is that order), each curve its fills, then the halo of its selected lines, then its lines
            const rank = new Map(s.groups.flatMap((gr, i) => gr.lines.map(l => [l, i] as const)))
            const groupOfLoop = (id: string) => rank.get(s.loops.find(l => l.id === id)?.route[0]?.line ?? '') ?? -1
            // an arc's or a cusp tip's piece belongs to the curve of its lines (dot 1791866486)
            const groupOfPiece = (p: NonNullable<typeof ink>['pieces'][number]) => rank.get(p.source.kind === 'line' ? p.source.id : p.source.lines[0]) ?? -1
            const pieceEl = (p: NonNullable<typeof ink>['pieces'][number]) => { const d = loopsD(p.loops); return <g key={p.source.id}><path data-ink={p.source.id} d={d} fill="#111" stroke="none" />{defectMark(p.source.id, d, inkDefects.get(p.source.id))}</g> }
            // the arcs' debug centre line while the ink switch is off, and for an arc with no ink to draw (its diagnostic says why)
            const arcLines = (i: number) => g.arcs.filter(a => (rank.get(a.lines[0]) ?? -1) === i && (!ink || (!inkOf.has(a.key) && ink.diagnostics.some(d => d.source.id === a.key))))
              .map(a => <path key={a.key} data-arc-fallback={ink ? a.key : undefined} d={path(a.curve)} fill="none" stroke="#a50" strokeWidth={2} />)
            const lineEl = (G: (typeof g.lines)[number]) => {
              const l = line(G.id), stroke = paintOf(G.id)
              const u = uniform.get(G.id)
              if (u) {
                if (!u.first) return null
                const d = loopsD(u.group.loops), key = u.group.pieces.map(p => p.source.id).join(' ')
                return <g key={G.id}><path data-ink-group={key} d={d} fill={u.paint} fillRule="nonzero" stroke="none" />
                  {defectMark(key, d, u.group.status === 'defect' ? u.group.reason : undefined)}
                  {u.group.pieces.map(p => defectMark(p.source.id, loopsD(p.loops), inkDefects.get(p.source.id)))}</g>
              }
              const piece = l.state.visible ? inkOf.get(l.id) : undefined
              if (piece) {
                const d = loopsD(piece.loops)
                return <g key={G.id}><path data-ink={l.id} d={d} fill={stroke} fillRule="nonzero" stroke="none" />{defectMark(l.id, d, inkDefects.get(l.id))}</g>
              }
              return <path key={G.id} d={path(G.curve)} fill="none" stroke={stroke} strokeWidth={(l.stroke.width + (l.stroke.widthB ?? l.stroke.width)) / 2}
                strokeDasharray={l.state.visible ? undefined : `${4 * px} ${4 * px}`} opacity={l.state.visible ? 1 : 0.35} strokeLinecap="round" />
            }
            return <>
              {/* nothing should lie outside a curve; if something does, it is drawn at the bottom rather than lost */}
              {arcsAlone.filter(p => groupOfPiece(p) === -1).map(pieceEl)}
              {g.lines.filter(G => !rank.has(G.id)).map(lineEl)}
              {arcLines(-1)}
              {s.groups.map((gr, i) => <g key={'paint' + gr.id} data-paint-group={gr.id}>
                {g.fills.filter(f => f.visible && groupOfLoop(f.id) === i).map(f => <path key={f.id} data-fill={f.id} d={f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'}
                  fill={f.color} opacity={cutLines.size && s.loops.find(l => l.id === f.id)?.route.every(u => cutLines.has(u.line)) ? 0.35 : 1}
                  stroke={!pose && isSel({ kind: 'fill', id: f.id }) ? '#06f' : 'none'} strokeWidth={2 * px} />)}
                {/* the selection reads at a glance (bowen 1791558186): a wide blue halo under each selected line */}
                {!pose && g.lines.filter(G => rank.get(G.id) === i && selLines.includes(G.id)).map(G => <path key={'halo' + G.id} d={path(G.curve)} fill="none" stroke="#2a7fff" strokeOpacity={0.3}
                  strokeWidth={Math.max(line(G.id).stroke.width, line(G.id).stroke.widthB ?? 0) + 8 * px} strokeLinecap="round" />)}
                {arcsAlone.filter(p => groupOfPiece(p) === i).map(pieceEl)}
                {g.lines.filter(G => rank.get(G.id) === i).map(lineEl)}
                {arcLines(i)}
              </g>)}
            </>
          })()}
          {/* the selection box (bowen 1791558733): solid blue = wholly inside (dragged right), dashed green = touching (dragged left) */}
          {!pose && pv.box && <rect x={Math.min(pv.box.from.x, pv.box.to.x)} y={Math.min(pv.box.from.y, pv.box.to.y)} width={Math.abs(pv.box.to.x - pv.box.from.x)} height={Math.abs(pv.box.to.y - pv.box.from.y)}
            fill={pv.box.whole ? 'rgba(42,127,255,0.08)' : 'rgba(40,170,90,0.08)'} stroke={pv.box.whole ? '#2a7fff' : '#28aa5a'} strokeWidth={px}
            strokeDasharray={pv.box.whole ? undefined : `${5 * px} ${3 * px}`} />}
          {/* the selection reads at a glance (bowen 1791558186): a wide blue halo under each selected line (drawn with its curve), and a dashed box around it all —
              one box, one extent (dot 1791737043, 1791737260): where the selection box is drawn (V / A) it is that box; elsewhere
              (another tool, Move picture) the same frame — core's bounds of what a transform moves — without handles */}
          {!pose && !boxShown && (() => {
            const units = sel.filter(u => u.kind === 'line' || u.kind === 'point' || u.kind === 'handle'), b = units.length ? core.in(shown).selectionBounds(units) : null
            return b && <rect data-selection-outline="" x={b.min.x} y={b.min.y} width={b.max.x - b.min.x} height={b.max.y - b.min.y}
              fill="none" stroke="#2a7fff" strokeWidth={px} strokeDasharray={`${3 * px} ${2 * px}`} pointerEvents="none" />
          })()}
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
          {/* the selection box (docs/selection-box-plan.md): not in playback, while restoring or with Move picture — nor hit there */}
          {!pose && !restoring && !moveRef && pv.transform && pv.transform.lines.map(l => <path key={'t' + l.id} data-transform-ghost={l.id} d={path(l.curve)} fill="none" stroke={pv.transform!.refused ? '#c00' : '#06f'} strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {!pose && !restoring && !moveRef && pv.transform && pv.transform.arcs.map(a => <path key={'ta' + a.key} data-transform-ghost-arc={a.key} d={path(a.curve)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {boxShown && pv.selectionBox && (() => {
            const b = pv.transform?.box ?? pv.selectionBox, top = pv.selectionBox.handles.find(h => h.id === 'rotate')
            return <g data-selection-box="" pointerEvents="none">
              <rect x={b.min.x} y={b.min.y} width={b.max.x - b.min.x} height={b.max.y - b.min.y} fill="none" stroke={pv.transform?.refused ? '#c00' : '#2a7fff'} strokeWidth={px} strokeDasharray={`${3 * px} ${2 * px}`} />
              {top && !pv.transform && <line x1={top.at.x} y1={top.at.y} x2={top.at.x} y2={pv.selectionBox.min.y} stroke="#2a7fff" strokeWidth={px} />}
              {!pv.transform && pv.selectionBox.handles.map(h => h.id === 'rotate'
                ? <circle key={h.id} data-box-handle={h.id} cx={h.at.x} cy={h.at.y} r={4.5 * px} fill={pv.selectionBox!.hot === h.id ? '#2a7fff' : '#fff'} stroke="#2a7fff" strokeWidth={px} />
                : <rect key={h.id} data-box-handle={h.id} x={h.at.x - 3.5 * px} y={h.at.y - 3.5 * px} width={7 * px} height={7 * px} fill={pv.selectionBox!.hot === h.id ? '#2a7fff' : '#fff'} stroke="#2a7fff" strokeWidth={px} />)}
            </g>
          })()}
          {/* the 四角 / 曲边 frame, drawn from the same data interaction hits (v103 DeformCageOverlay, its sizes in screen pixels) */}
          {!pose && !restoring && pv.deform && (() => {
            const f = pv.deform.frame, c = '#a35ac0', poly = (ps: readonly Vec[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
            return <g data-testid="deform-frame" pointerEvents="none">
              {pv.deform.lines?.map(l => <path key={'dg' + l.id} data-deform-ghost={l.id} d={path(l.curve)} fill="none" stroke={pv.deform!.refused ? '#c00' : c} strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
              {f.grid.map((g, i) => <path key={'gr' + i} d={poly(g)} fill="none" stroke={c} strokeDasharray={`${4 * px} ${4 * px}`} opacity={0.4} strokeWidth={px} />)}
              {f.edges.map((e, i) => <path key={'ed' + i} data-deform-edge={i} d={poly(e)} fill="none" stroke={c} strokeWidth={1.5 * px} />)}
              {f.handles.map(h => <g key={'h' + h.edge + h.handle}>
                <line x1={h.anchor.x} y1={h.anchor.y} x2={h.at.x} y2={h.at.y} stroke={c} opacity={0.65} strokeWidth={px} />
                <circle data-deform-handle={`${h.edge}:${h.handle}`} cx={h.at.x} cy={h.at.y} r={4.5 * px} fill="#fff" stroke={c} strokeWidth={1.5 * px} />
              </g>)}
              {f.midpoints.map(m => <path key={'m' + m.edge} data-deform-midpoint={m.edge} d={`M${m.at.x} ${m.at.y - 5 * px} l${5 * px} ${5 * px} ${-5 * px} ${5 * px} ${-5 * px} ${-5 * px} Z`} fill={c} stroke="#fff" strokeWidth={px} />)}
              {f.corners.map((q, i) => <rect key={'c' + i} data-deform-corner={i} x={q.x - 6 * px} y={q.y - 6 * px} width={12 * px} height={12 * px} fill="#fff" stroke={c} strokeWidth={2 * px} />)}
            </g>
          })()}
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
          {/* the selected lines' or curves' names (name-labels/): the scoped selection, never taking a press, not in playback */}
          {!pose && labelsFor(g.lines.map(G => ({ id: G.id, name: line(G.id).name, mid: middleOf(G.curve) })), s.groups.map(gr => ({ id: gr.id, name: gr.name, lines: gr.lines })), selLines, labelKind).map(lb =>
            <text key={lb.key} data-label={lb.key} x={lb.at.x + 6 * px} y={lb.at.y - 6 * px} fontSize={12 * px} fill="#123" stroke="#fff" strokeWidth={3 * px} paintOrder="stroke" pointerEvents="none" style={{ userSelect: 'none' }}>{lb.text}</text>)}
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
      <LayersPanel key={drawing} s={s} g={g} selected={selLayers} active={drawLayer} select={selectLayers} run={run} newLayerId={() => nid('layer-')} onPick={setLabelKind}
        zones={zones} slider={sliderHooks} toolRadius={opts.radius} canvasSubject={canvasSubject} canvasPicks={canvasPicks} joinScope={`${drawing}|${shown}`} />
    </div>
  )
}
