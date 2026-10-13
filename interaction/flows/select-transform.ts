// select-transform — V picks a whole curve, A a point, handle or line; pressing selects (a
// pre-edit, one step), dragging only previews, release commits one translate on the units
// the drag started with (explicit targets), Esc or a cancelled pointer drops it. A press on
// nothing, in any tool but the pen, starts a selection box (bowen 1791558733, 1791559014):
// dragged right, it takes the lines wholly inside; dragged left, every line it touches; only in
// the selected layers (bowen 1791897991: with two layers lit, the box takes lines of both).
import { createMover, type Target } from '../../move'
import type { Core, Snapshot, Vec } from '../../src'
import type { Ctx, Flow, Id, Mods, Preview, Unit } from '../base'
import { handlesOf, hitBox, opAt, startHandleDrag, type BoxOp, type Bounds, type HandleDrag } from './selection-box'

export interface SelectTransform extends Flow {
  pointerDown(at: Vec, mods: Mods): boolean
  /** `mods` are read live by a box handle's drag (Option: about the centre; Shift: 15° steps). */
  pointerMove(at: Vec, mods?: Mods): void
  pointerUp(at: Vec, mods?: Mods): void
  /** The pointer moved with no button held: what it is over on the selection box (true if that changed). */
  hover(at: Vec | null, mods?: Mods): boolean
  pointerCancel(): void
  /** Start a selection box; `clear`: a click without dragging clears the selection (V / A). */
  startBox(at: Vec, mods: Mods, clear: boolean): void
  /** What the last V / A press picked, or null (a box). */
  readonly lastPress: Unit['kind'] | null
  /** An arrow key with V / A and a selection: a step of the selection's key run (move/); true if taken. */
  keyDown(key: string, mods: Mods): boolean
  /** An arrow key released: the key run commits when no arrow is held. */
  keyUp(key: string): void
  /** What move session runs: a drag of the selection, a key run, or nothing. */
  readonly moving: 'drag' | 'keys' | null
  readonly dragging: boolean
}

export function selectTransform(ctx: Ctx): SelectTransform {
  // moving the selection is a move/ session (docs/move-plan.md): a drag or a key run, one at a time; what is
  // shown meanwhile is `moving` (the units taken at begin, the offset so far); one translate at the end
  const mover = createMover()
  /** The selection's arrows: 1 drawing unit, Shift 10, Option / Ctrl 0.1 (bowen 1791733125, 1791733775) — this caller's sizes (bowen 1791769146). */
  const SELECTION_STEPS = { step: 1, long: 10, short: 0.1 }
  let moving: { core: Core; view: string; units: Unit[]; offset: Vec } | null = null
  /** The selection as a move target: taken at begin (drawing, view, units), re-checked at commit (dot 1791733489). */
  const selectionTarget = (): Target | undefined => {
    const units = ctx.selection()
    if (!units.length) return undefined
    const owned = ctx.owned()
    return {
      begin: () => { moving = { ...owned, units, offset: { x: 0, y: 0 } }; return true },
      preview: o => { if (moving) moving.offset = { x: o.x, y: o.y } },
      commit: o => { moving = null; if (ctx.mine(owned)) ctx.commit(e => e.translate(o.x, o.y, units)) },
      cancel: () => { moving = null },
    }
  }
  let box: { core: Core; view: string; from: Vec; to: Vec; mods: Mods; clear: boolean } | null = null
  /** Commit what the box takes: lines of the focus, replacing, adding or removing as a click would. */
  function boxUp(b: NonNullable<typeof box>, at: Vec) {
    const px = ctx.env.pixel()
    if (Math.hypot(at.x - b.from.x, at.y - b.from.y) <= 3 * px) { // a click on nothing: V / A clear, as before
      if (b.clear && !b.mods.shift && !b.mods.alt && ctx.snap().selection.length) ctx.commit(e => e.select([], 'replace'))
      return
    }
    // the box takes lines of every selected layer (bowen 1791897991; it was the current layer only, bowen 1791558733)
    const s = ctx.snap(), of = ctx.layerOf(s), visible = new Set(s.lines.filter(l => l.state.visible).map(l => l.id)), lit = new Set(ctx.env.layers?.() ?? [ctx.env.layer()])
    const lines = ctx.reader().linesInRect(b.from, at, at.x >= b.from.x).filter(id => visible.has(id) && lit.has(of.line(id)))
    if (!lines.length && (b.mods.shift || b.mods.alt)) return
    ctx.commit(e => e.select(lines.map(id => ({ kind: 'line' as const, id })), mode(b.mods)))
  }
  const key = (u: Unit) => (u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`)
  const mode = (m: Mods) => (m.shift ? 'add' : m.alt ? 'remove' : 'replace') as 'add' | 'remove' | 'replace'

  /**
   * The handles A shows: both handles of every visible line in its scope, the selected layers
   * (bowen 1791553510, 1791555800). One list, used both to draw and to pick: what is shown can
   * be operated, and nothing else is hit (bowen 1791553331).
   */
  function handlesShown(s: Snapshot): { line: Id; end: 'a' | 'b' }[] {
    if (ctx.tool() !== 'A') return []
    const of = ctx.layerOf(s)
    return s.lines.filter(l => l.state.visible && ctx.inScope(of.line(l.id)))
      .flatMap(l => [{ line: l.id, end: 'a' as const }, { line: l.id, end: 'b' as const }])
  }
  /** A: a point, else a shown handle, else a line; nearest first. */
  function hitDirect(at: Vec): Unit | undefined {
    const shown = new Set(handlesShown(ctx.snap()).map(h => `${h.line}:${h.end}`))
    for (const h of ctx.shown(at)) {
      if (h.kind === 'point') return { kind: 'point', id: h.id }
      if (h.kind === 'handle' && shown.has(`${h.line}:${h.end}`)) return { kind: 'handle', line: h.line, end: h.end }
      if (h.kind === 'line') return { kind: 'line', id: h.id }
    }
    return undefined
  }
  // the press position is copied in, so a caller reusing its Vec never changes the offset (dot 1791544469)
  const startDrag = (at: Vec) => { const t = selectionTarget(); if (t) mover.press(t, { x: at.x, y: at.y }) }
  const stop = () => { mover.cancel(); box = null }

  // the selection box (docs/selection-box-plan.md): around what a transform moves — lines, points and handles
  // selected explicitly, never fills (dot 1791735873) — in the view edited, with V / A
  const transformUnits = () => ctx.selection().filter(u => u.kind === 'line' || u.kind === 'point' || u.kind === 'handle')
  const boxNow = (): Bounds | null => {
    if (ctx.tool() !== 'V' && ctx.tool() !== 'A') return null
    const units = transformUnits()
    return units.length ? ctx.reader().selectionBounds(units) : null
  }
  // where the pointer rests (no button) and its modifiers — the inputs only; what is hot is worked out from them on
  // each preview, so a tool, view or selection change never leaves a stale answer (docs/selection-box-problems.md)
  let resting: { at: Vec; mods: Mods } | null = null
  const hotNow = (): ReturnType<typeof hitBox> => {
    if (!resting || mover.running || box) return null
    // what a press here would do, so the cursor never promises another action (dot 1791737043)
    const hit = boxNow() ? pressHit(resting.at, resting.mods) : null
    return hit?.kind === 'box' ? hit.handle : hit?.kind === 'inside' ? 'inside' : null
  }
  let mods: Mods = {} // the modifiers last seen during a press (read live by a handle drag)
  /** A handle drag in progress: its basis (fixed at the start), the operation so far, and what it belongs to. */
  let transforming: { core: Core; view: string; units: Unit[]; drag: HandleDrag; press: Vec; op: BoxOp | null } | null = null
  const run = (op: BoxOp, units: Unit[]) => (e: Parameters<Parameters<Core['edit']>[0]>[0]) => {
    if (op.kind === 'scale') e.scale(op.anchor, op.sx, op.sy, units)
    else e.rotate(op.centre, op.angle, units)
  }
  const startHandle = (handle: Exclude<ReturnType<typeof hitBox>, 'inside' | null>, b: Bounds, at: Vec) => {
    const owned = ctx.owned(), units = transformUnits(), press = { x: at.x, y: at.y }
    const drag = startHandleDrag(handle, b, press, ctx.env.pixel())
    const target: Target = {
      begin: () => { transforming = { ...owned, units, drag, press, op: null }; return true },
      preview: o => { if (transforming) transforming.op = opAt(drag, { x: press.x + o.x, y: press.y + o.y }, mods) },
      commit: o => {
        const op = opAt(drag, { x: press.x + o.x, y: press.y + o.y }, mods) // the release's modifiers decide
        transforming = null
        if (ctx.mine(owned)) ctx.commit(run(op, units))
      },
      cancel: () => { transforming = null },
    }
    mover.press(target, press)
  }

  /**
   * What a press at `at` does — one answer for the press, the hover cursor and the hot handle (plan §2, §6).
   * The order: A's points and Bézier handles keep their priority (dot 1791735216); then a box handle, which wins
   * over a line and over grabbing the inside (dot 1791733296); then what the tool picks, as today; then the inside
   * of the box grabs the whole selection, unless Shift / Option ask for the marquee that adds / removes; else a marquee.
   */
  type PressHit = { kind: 'box'; handle: Exclude<ReturnType<typeof hitBox>, 'inside' | null>; b: Bounds } | { kind: 'item'; unit: Unit } | { kind: 'inside' } | { kind: 'marquee' }
  const pressHit = (at: Vec, m: Mods): PressHit => {
    const b = boxNow(), onBox = b ? hitBox(b, at, ctx.env.pixel()) : null
    const direct = ctx.tool() === 'A' ? hitDirect(at) : undefined
    const pointFirst = direct && (direct.kind === 'point' || direct.kind === 'handle')
    if (!pointFirst && b && onBox && onBox !== 'inside') return { kind: 'box', handle: onBox, b }
    const picked: Unit | undefined = ctx.tool() === 'V'
      ? (() => { const line = ctx.hitLine(at); return line ? { kind: 'line' as const, id: line } : undefined })()
      : direct
    if (picked) return { kind: 'item', unit: picked }
    if (onBox === 'inside' && !m.shift && !m.alt) return { kind: 'inside' }
    return { kind: 'marquee' }
  }

  /** What the last A / V press picked (a box or nothing: null); read by the app's name labels (docs/name-labels-plan.md). */
  let lastPress: Unit['kind'] | null = null
  return {
    hover(at, m = {}) {
      const was = hotNow()
      resting = at ? { at: { x: at.x, y: at.y }, mods: { ...m } } : null
      return hotNow() !== was
    },
    get lastPress() { return lastPress },
    get moving() { return mover.running },
    cancelLevel: 1,
    get dragging() { return !!mover.running || !!box },
    keyDown(key, mods) {
      if (ctx.tool() !== 'V' && ctx.tool() !== 'A') return false
      return mover.keyDown(selectionTarget, { key, repeat: mods.repeat, shift: mods.shift, alt: mods.alt, ctrl: mods.ctrl }, SELECTION_STEPS)
    },
    keyUp(key) { mover.keyUp(key) },
    startBox(at, mods, clear) { box = { ...ctx.owned(), from: { x: at.x, y: at.y }, to: { x: at.x, y: at.y }, mods: { ...mods }, clear } },
    pointerDown(at, m) {
      resting = null
      lastPress = null
      mods = { ...m }
      const hit = pressHit(at, m)
      if (hit.kind === 'box') { startHandle(hit.handle, hit.b, at); return true }
      if (hit.kind === 'inside') { startDrag(at); return true }
      if (hit.kind === 'marquee') { this.startBox(at, m, true); return true }
      const picked = hit.unit
      const mods_ = m
      lastPress = picked.kind
      const already = ctx.selection().some(v => key(v) === key(picked))
      if (!already || mods_.shift || mods_.alt) {
        if (ctx.tool() === 'V' && picked.kind === 'line') ctx.commit(e => e.selectGroup(picked.id, mode(mods_)))
        else ctx.commit(e => e.select([picked], mode(mods_)))
      }
      startDrag(at)
      return true
    },
    pointerMove(at, m) {
      if (m) mods = { ...m }
      if (mover.running === 'drag') mover.drag(at)
      if (box) box.to = { x: at.x, y: at.y }
    },
    pointerUp(at, m) {
      if (m) mods = { ...m }
      const b = box
      box = null
      if (b && ctx.mine(b)) boxUp(b, at)
      // a repeated release finds nothing to commit (plan item 19); the target re-checks the drawing (it never lands elsewhere)
      if (mover.running === 'drag') mover.release(at)
    },
    pointerCancel() { stop() },
    cancel() { if (!mover.running && !box) return false; stop(); return true },
    toolChanged() { stop() }, // an interaction default: a tool change cancels a drag or a key run
    drawingChanged() { stop() },
    // the drawing changed under the move (undo, redo, a selection change, an edit such as Delete): it ends
    historyChanged() { stop() },
    preview(p: Preview) {
      if (moving && ctx.mine(moving)) p.drag = { units: structuredClone(moving.units), offset: { ...moving.offset } }
      const b = boxNow()
      if (b) {
        const px = ctx.env.pixel()
        // during a move of the inside the box follows the offset; during a handle drag, the result (dot 1791735431)
        const o = moving && ctx.mine(moving) ? moving.offset : { x: 0, y: 0 }
        p.selectionBox = { min: { x: b.min.x + o.x, y: b.min.y + o.y }, max: { x: b.max.x + o.x, y: b.max.y + o.y }, handles: handlesOf(b, px).map(h => ({ id: h.id, at: { x: h.at.x + o.x, y: h.at.y + o.y } })), hot: transforming ? transforming.drag.handle : hotNow() }
      }
      if (transforming && transforming.op && ctx.mine(transforming)) {
        const t = transforming
        try {
          // core's own preview of the very operation the release commits (dot 1791735216 §3)
          const r = ctx.env.core().preview(t.view, run(t.op!, t.units))
          if (r) {
            // what the operation changes: the lines and the joins' arcs, new or moved (dot 1791737043)
            const g0 = ctx.reader().geometry(), g1 = r.geometry()
            const before = new Map(g0.lines.map(l => [l.id, JSON.stringify(l.curve)])), arcsBefore = new Map(g0.arcs.map(a => [a.key, JSON.stringify(a.curve)]))
            const copy = (c: readonly Vec[]) => c.map(v => ({ x: v.x, y: v.y }))
            p.transform = {
              lines: g1.lines.filter(l => before.get(l.id) !== JSON.stringify(l.curve)).map(l => ({ id: l.id, curve: copy(l.curve) })),
              arcs: g1.arcs.filter(a => arcsBefore.get(a.key) !== JSON.stringify(a.curve)).map(a => ({ key: a.key, curve: copy(a.curve) })),
              box: r.selectionBounds(t.units),
            }
          }
        } catch (err) { p.transform = { lines: [], arcs: [], box: null, refused: (err as Error)?.message ?? String(err) } }
      }
      if (box && ctx.mine(box)) p.box = { from: { ...box.from }, to: { ...box.to }, whole: box.to.x >= box.from.x }
      p.handles = handlesShown(ctx.snap())
    },
  }
}
