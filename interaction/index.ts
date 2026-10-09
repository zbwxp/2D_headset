// interaction — the tools and every unfinished operation (graph "Interaction": one owner
// per state; cancellable, atomic commit; explicit targets. doc 22; docs/interaction-plan.md).
//
// It owns only temporary state: the current tool and its options, a drag in progress, a
// pending cut, a two-click tool's first pick, the pen chain, a mirror source, the clip and
// its paste count, and the last refusal to show. The drawing, the selection and the
// history are core's: every change goes through core's public operations, as one edit.
// It draws nothing: `preview()` describes what to show, as plain data.
import { Core, Refusal, type Clip, type Snapshot, type Vec, type Editor, type RefusalObject } from '../src'

type Id = string
type Unit = Snapshot['selection'][number]

export type Tool = 'pen' | 'V' | 'A' | 'split' | 'bind' | 'merge' | 'link' | 'unbind' | 'join' | 'fill'
export interface Options { joinMode: 'smooth' | 'cusp' | 'arc'; radius: number; color: string }
export interface Mods { shift?: boolean; alt?: boolean; meta?: boolean }

/** What the app gives: the open drawing, a source of new ids, the layer to draw into, and the pick tolerance in document units. */
export interface Env {
  core: () => Core
  newId: (prefix: string) => Id
  layer: () => Id | undefined
  tolerance: () => number
}

/** What to show, as plain data (the view draws it). */
export interface Preview {
  /** A drag in progress: the units it moves and the offset so far. */
  drag?: { units: Unit[]; offset: Vec }
  /** Groups of a pending cut, shown grey. */
  cut: Id[]
  /** A two-click tool's first pick. */
  pick?: { kind: 'point' | 'line'; id: Id }
  /** The pen's last point, or the position of its first click before any line exists. */
  pen?: { point: Id } | { at: Vec }
  /** Lines picked as the mirror source. */
  mirrorSource: Id[]
  /** The last refusal: its code, message and objects (kind + id). */
  refusal?: { code: string; message: string; objects: RefusalObject[] }
}

export interface Interaction {
  readonly tool: Tool
  setTool(tool: Tool): void
  setOptions(o: Partial<Options>): void
  options(): Options
  /** Returns false when nothing was hit and the tool did nothing, so the app may pan. */
  pointerDown(at: Vec, mods?: Mods): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
  pointerCancel(): void
  key(name: string, mods?: Mods): boolean
  cancel(): void
  deleteSelection(): void
  copy(): void
  cut(): void
  paste(): void
  setMirrorSource(): void
  mirrorApply(): void
  mirrorLink(): void
  undo(): void
  redo(): void
  /** The app tells interaction about changes it made elsewhere. */
  drawingChanged(): void
  historyChanged(): void
  preview(): Preview
  subscribe(listener: () => void): () => void
}

const STEP = 20

export function createInteraction(env: Env): Interaction {
  let tool: Tool = 'pen'
  let opts: Options = { joinMode: 'smooth', radius: 10, color: '#f2c94c' }
  // each unfinished operation remembers the Core it belongs to (explicit targets; dot 1791543494)
  let drag: { core: Core; start: Vec; units: Unit[]; offset: Vec } | null = null
  let pick: { core: Core; kind: 'point' | 'line'; id: Id } | null = null
  let pen: { core: Core; from: Id | { id: Id; layer: Id; position: Vec } } | null = null
  let mirrorSource: { core: Core; lines: Id[] } | null = null
  let cutState: { core: Core; groups: { id: Id; lines: Id[] }[] } | null = null
  let clip: Clip | null = null, pastes = 0
  let refusal: Preview['refusal']
  const listeners = new Set<() => void>()
  const changed = () => { for (const f of listeners) f() }

  const core = () => env.core()
  const snap = () => core().snapshot()

  /** One edit; a refusal is kept to show, and nothing is left half done (core is atomic). */
  function commit(fn: (e: Editor) => void): boolean {
    try { core().edit(fn); refusal = undefined; return true }
    catch (err) {
      const r = err instanceof Refusal ? err : null
      refusal = { code: r?.code ?? 'error', message: (err as Error).message, objects: r ? [...r.objects] : [] }
      return false
    }
  }

  // ---- picking (interaction's rules; core only measures) ------------------------------
  const visible = (at: Vec) => core().nearby(at, env.tolerance()).filter(x => x.visible)
  const hitPoint = (at: Vec) => { const h = visible(at).find(x => x.kind === 'point'); return h && h.kind === 'point' ? h.id : undefined }
  const hitLine = (at: Vec) => { const h = visible(at).find(x => x.kind === 'line'); return h && h.kind === 'line' ? h.id : undefined }
  /** A: a point, else a handle shown for the selection, else a line; nearest first. */
  function hitDirect(at: Vec): Unit | undefined {
    const s = snap(), shown = handlesShown(s)
    for (const h of visible(at)) {
      if (h.kind === 'point') return { kind: 'point', id: h.id }
      if (h.kind === 'handle' && shown.has(`${h.line}:${h.end}`)) return { kind: 'handle', line: h.line, end: h.end }
      if (h.kind === 'line') return { kind: 'line', id: h.id }
    }
    return undefined
  }
  /** Handles are shown (and so pickable) on lines the selection touches. */
  function handlesShown(s: Snapshot): Set<string> {
    const pts = new Set<Id>(), lines = new Set<Id>()
    for (const u of s.selection) {
      if (u.kind === 'point') pts.add(u.id)
      if (u.kind === 'line') lines.add(u.id)
      if (u.kind === 'handle') lines.add(u.line)
    }
    const out = new Set<string>()
    for (const l of s.lines) if (l.state.visible && (lines.has(l.id) || pts.has(l.a) || pts.has(l.b))) { out.add(`${l.id}:a`); out.add(`${l.id}:b`) }
    return out
  }
  const key = (u: Unit) => (u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`)
  const mode = (m: Mods) => (m.shift ? 'add' : m.alt ? 'remove' : 'replace') as 'add' | 'remove' | 'replace'

  // ---- pointer -----------------------------------------------------------------------------
  function startDrag(at: Vec) {
    drag = { core: core(), start: at, units: snap().selection, offset: { x: 0, y: 0 } }
  }

  function pointerDown(at: Vec, mods: Mods = {}): boolean {
    refusal = undefined
    let handled = true
    if (tool === 'V') {
      const line = hitLine(at)
      if (line) {
        const already = snap().selection.some(u => u.kind === 'line' && u.id === line)
        if (!already || mods.shift || mods.alt) commit(e => e.selectGroup(line, mode(mods)))
        startDrag(at)
      } else { if (snap().selection.length) commit(e => e.select([], 'replace')); handled = false }
    } else if (tool === 'A') {
      const u = hitDirect(at)
      if (u) {
        const already = snap().selection.some(v => key(v) === key(u))
        if (!already || mods.shift || mods.alt) commit(e => e.select([u], mode(mods)))
        startDrag(at)
      } else { if (snap().selection.length) commit(e => e.select([], 'replace')); handled = false }
    } else if (tool === 'pen') penClick(at)
    else if (tool === 'bind' || tool === 'merge' || tool === 'link') twoPoints(at)
    else if (tool === 'join') twoLines(at, mods)
    else if (tool === 'split') splitAt(at)
    else if (tool === 'unbind') unbindAt(at)
    else if (tool === 'fill') fillAt(at, mods)
    changed()
    return handled
  }

  function pointerMove(at: Vec) {
    if (!drag) return
    drag.offset = { x: at.x - drag.start.x, y: at.y - drag.start.y }
    changed()
  }

  function pointerUp(at: Vec) {
    const d = drag
    drag = null // a repeated release finds nothing to commit (plan item 19)
    if (!d) return
    const offset = { x: at.x - d.start.x, y: at.y - d.start.y }
    if (d.core !== core()) { changed(); return } // the drawing changed under the drag: it never lands elsewhere
    if ((offset.x || offset.y) && d.units.length) commit(e => e.translate(offset.x, offset.y, d.units))
    changed()
  }

  function pointerCancel() { if (drag) { drag = null; changed() } }

  // ---- tools ----------------------------------------------------------------------------------
  function penClick(at: Vec) {
    const layer = env.layer()
    if (!layer) { refusal = { code: 'no-layer', message: 'no layer to draw into', objects: [] }; return }
    const onPoint = hitPoint(at)
    const spec = onPoint ?? { id: env.newId('p'), layer, position: at }
    if (pen && pen.core !== core()) pen = null
    if (!pen) { pen = { core: core(), from: spec }; return }
    const from = pen.from
    if (typeof from === 'string' && !snap().points.some(p => p.id === from)) { pen = { core: core(), from: spec }; return }
    if (commit(e => e.line(env.newId('l'), from, spec))) pen = { core: core(), from: typeof spec === 'string' ? spec : spec.id }
  }

  function twoPoints(at: Vec) {
    const id = hitPoint(at)
    if (!id) return
    if (!pick || pick.core !== core() || pick.kind !== 'point') { pick = { core: core(), kind: 'point', id }; return }
    const first = pick.id
    pick = null
    // the first pick must still be there; nothing else stands in for it (plan item 17)
    if (!snap().points.some(p => p.id === first)) { refusal = { code: 'pick-gone', message: `the first point ${first} is gone`, objects: [{ kind: 'point', id: first }] }; return }
    if (tool === 'bind') commit(e => e.bind(first, id))
    if (tool === 'merge') commit(e => e.mergePosition(first, id))
    if (tool === 'link') commit(e => e.link(first, id))
  }

  function twoLines(at: Vec, mods: Mods) {
    const id = hitLine(at)
    if (!id) return
    if (!pick || pick.core !== core() || pick.kind !== 'line') { pick = { core: core(), kind: 'line', id }; return }
    const first = pick.id
    pick = null
    const s = snap(), l1 = s.lines.find(l => l.id === first), l2 = s.lines.find(l => l.id === id)
    if (!l1) { refusal = { code: 'pick-gone', message: `the first line ${first} is gone`, objects: [{ kind: 'line', id: first }] }; return }
    const point = l2 && first !== id ? [l1.a, l1.b].find(p => p === l2.a || p === l2.b) : undefined
    if (!point) { refusal = { code: 'join-needs-shared-point', message: 'the two lines must share an end point', objects: [{ kind: 'line', id: first }, { kind: 'line', id }] }; return }
    // click order: the second line turns to the first (graph, symmetric relations)
    if (mods.alt) commit(e => e.removeJoin(point, first, id))
    else commit(e => e.join(point, first, id, { mode: opts.joinMode, ...(opts.joinMode === 'arc' ? { radius: opts.radius } : {}) }))
  }

  function splitAt(at: Vec) {
    const id = hitLine(at)
    if (!id) return
    const s = snap(), l = s.lines.find(x => x.id === id)!
    const pa = s.points.find(p => p.id === l.a)!.position, pb = s.points.find(p => p.id === l.b)!.position
    const c = [pa, { x: pa.x + l.ha.x, y: pa.y + l.ha.y }, { x: pb.x + l.hb.x, y: pb.y + l.hb.y }, pb]
    commit(e => e.split(id, nearestT(c, at), env.newId('p'), env.newId('l'), env.newId('l')))
  }

  function unbindAt(at: Vec) {
    const id = hitLine(at)
    if (!id) return
    const s = snap(), l = s.lines.find(x => x.id === id)!
    const pos = (p: Id) => s.points.find(x => x.id === p)!.position
    const pt = Math.hypot(pos(l.a).x - at.x, pos(l.a).y - at.y) <= Math.hypot(pos(l.b).x - at.x, pos(l.b).y - at.y) ? l.a : l.b
    commit(e => e.unbind(pt, [id], env.newId('p')))
  }

  function fillAt(at: Vec, mods: Mods) {
    const loop = core().pickLoop(at)
    if (!loop) return
    commit(e => (mods.shift ? e.clearFill(loop) : e.fill(loop, opts.color)))
  }

  // ---- clipboard ------------------------------------------------------------------------------
  function copy() {
    try { clip = core().copy(); pastes = 0; cutState = null; refusal = undefined }
    catch (err) { const r = err instanceof Refusal ? err : null; refusal = { code: r?.code ?? 'error', message: (err as Error).message, objects: r ? [...r.objects] : [] } }
    changed()
  }

  /** Cut only marks whole curves; the next paste moves them (bowen, cut = grey). */
  function cut() {
    const s = snap(), lines = s.selection.flatMap(u => (u.kind === 'line' ? [u.id] : []))
    const groups = s.groups.filter(g => g.lines.some(l => lines.includes(l)))
    if (!groups.length || groups.some(g => !g.lines.every(l => lines.includes(l)))) {
      refusal = { code: 'cut-whole-curves', message: 'cut takes whole curves: select them with V', objects: [] }
    } else { cutState = { core: core(), groups: groups.map(g => ({ id: g.id, lines: [...g.lines] })) }; refusal = undefined }
    changed()
  }

  function paste() {
    const layer = env.layer()
    if (!layer) { refusal = { code: 'no-layer', message: 'no layer to paste into', objects: [] }; changed(); return }
    if (cutState) {
      const c = cutState
      if (c.core !== core()) { cutState = null; changed(); return }
      if (!cutIntact(c)) { cutState = null; refusal = { code: 'cut-changed', message: 'the cut curves changed; select them again', objects: c.groups.map(g => ({ kind: 'group' as const, id: g.id })) }; changed(); return }
      const lines = c.groups.flatMap(g => g.lines)
      // a refused paste keeps the cut for another try (plan item 9)
      if (commit(e => { for (const g of c.groups) e.moveGroup(g.id, layer); e.select(lines.map(id => ({ kind: 'line' as const, id }))) })) {
        cutState = null
        try { clip = core().copy(lines); pastes = 0 } catch { clip = null }
      }
      changed()
      return
    }
    if (!clip) { refusal = { code: 'nothing-copied', message: 'nothing copied', objects: [] }; changed(); return }
    const k = pastes + 1, c = clip
    if (commit(e => e.paste(c, layer, { x: STEP * k, y: STEP * k }, env.newId('c')))) pastes = k
    changed()
  }

  /** A pending cut holds while its groups exist with the same members (plan item 21). */
  function cutIntact(c: NonNullable<typeof cutState>): boolean {
    const groups = snap().groups
    return c.groups.every(g => { const now = groups.find(x => x.id === g.id); return !!now && JSON.stringify([...now.lines].sort()) === JSON.stringify([...g.lines].sort()) })
  }

  // ---- mirror (a two-step pick: source, then the selection as target) ---------------------
  const selectedLines = () => snap().selection.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  function setMirrorSource() { mirrorSource = { core: core(), lines: selectedLines() }; changed() }
  function mirror(link: boolean) {
    const src = mirrorSource
    if (!src || src.core !== core() || !src.lines.length) { refusal = { code: 'no-mirror-source', message: 'pick the mirror source first', objects: [] }; changed(); return }
    const s = snap(), target = selectedLines(), groupOf = (l: Id) => s.groups.find(g => g.lines.includes(l))?.id
    if (src.lines.some(l => !groupOf(l))) { mirrorSource = null; refusal = { code: 'pick-gone', message: 'the mirror source is gone', objects: [] }; changed(); return }
    const ok = link
      ? commit(e => e.mirrorLink([...new Set(src.lines.map(groupOf) as Id[])], [...new Set(target.map(groupOf).filter((x): x is Id => !!x))]))
      : commit(e => e.mirrorApply(src.lines, target))
    if (ok) mirrorSource = null
    changed()
  }

  // ---- lifecycle (doc 22 §3.5) ------------------------------------------------------------
  /** Innermost first (an interaction default): drag, then a pick / pen chain / mirror source, then a pending cut. */
  function cancel() {
    if (drag) drag = null
    else if (pick || pen || mirrorSource) { pick = null; pen = null; mirrorSource = null }
    else if (cutState) cutState = null
    refusal = undefined
    changed()
  }
  function setTool(t: Tool) {
    // a tool's own unfinished state ends with it; a drag is cancelled (default); the pending cut and the clip stay
    tool = t; drag = null; pick = null; pen = null
    refusal = undefined
    changed()
  }
  function drawingChanged() {
    drag = null; pick = null; pen = null; mirrorSource = null; cutState = null; pastes = 0; refusal = undefined
    changed()
  }
  function historyChanged() {
    drag = null
    const s = snap(), pts = new Set(s.points.map(p => p.id)), lines = new Set(s.lines.map(l => l.id))
    if (pick && !(pick.kind === 'point' ? pts : lines).has(pick.id)) pick = null
    if (pen && typeof pen.from === 'string' && !pts.has(pen.from)) pen = null
    if (cutState && !cutIntact(cutState)) cutState = null
    if (mirrorSource && mirrorSource.lines.some(l => !lines.has(l))) mirrorSource = null
    changed()
  }

  function undo() { if (!drag) { core().undo(); historyChanged() } }
  function redo() { if (!drag) { core().redo(); historyChanged() } }

  function deleteSelection() { commit(e => e.deleteSelection()); changed() }

  function keyPress(name: string, mods: Mods = {}): boolean {
    const k = name.toLowerCase()
    if (k === 'escape') { cancel(); return true }
    if (mods.meta) {
      if (k === 'z') { mods.shift ? redo() : undo(); return true }
      if (k === 'c') { copy(); return true }
      if (k === 'x') { cut(); return true }
      if (k === 'v') { paste(); return true }
      return false
    }
    if (k === 'delete' || k === 'backspace') { deleteSelection(); return true }
    const tools: Record<string, Tool> = { v: 'V', a: 'A', p: 'pen', s: 'split', b: 'bind', m: 'merge', l: 'link', u: 'unbind', j: 'join', f: 'fill' }
    if (tools[k]) { setTool(tools[k]!); return true }
    return false
  }

  function preview(): Preview {
    const p: Preview = { cut: cutState && cutState.core === core() ? cutState.groups.map(g => g.id) : [], mirrorSource: mirrorSource && mirrorSource.core === core() ? [...mirrorSource.lines] : [] }
    if (drag && drag.core === core()) p.drag = { units: structuredClone(drag.units), offset: { ...drag.offset } }
    if (pick && pick.core === core()) p.pick = { kind: pick.kind, id: pick.id }
    if (pen && pen.core === core()) p.pen = typeof pen.from === 'string' ? { point: pen.from } : { at: { ...pen.from.position } }
    if (refusal) p.refusal = structuredClone(refusal)
    return p
  }

  return {
    get tool() { return tool },
    setTool, setOptions: o => { opts = { ...opts, ...o }; changed() }, options: () => ({ ...opts }),
    pointerDown, pointerMove, pointerUp, pointerCancel, key: keyPress, cancel, deleteSelection,
    copy, cut, paste, setMirrorSource, mirrorApply: () => mirror(false), mirrorLink: () => mirror(true),
    undo, redo, drawingChanged, historyChanged, preview,
    subscribe: f => { listeners.add(f); return () => listeners.delete(f) },
  }
}

/** The parameter on a cubic nearest to `at` (sampling, then refinement); for split. */
function nearestT(c: readonly Vec[], at: Vec): number {
  const ev = (t: number) => {
    const u = 1 - t
    return {
      x: u * u * u * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t * t * t * c[3]!.x,
      y: u * u * u * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t * t * t * c[3]!.y,
    }
  }
  const d = (t: number) => { const p = ev(t); return Math.hypot(p.x - at.x, p.y - at.y) }
  let best = 0.5, bd = Infinity
  for (let i = 1; i < 64; i++) { const t = i / 64, x = d(t); if (x < bd) { bd = x; best = t } }
  let lo = Math.max(0.001, best - 1 / 64), hi = Math.min(0.999, best + 1 / 64)
  for (let k = 0; k < 40; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d(m1) < d(m2)) hi = m2; else lo = m1 }
  return (lo + hi) / 2
}
