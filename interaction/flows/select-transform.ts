// select-transform — V picks a whole curve, A a point, handle or line; pressing selects (a
// pre-edit, one step), dragging only previews, release commits one translate on the units
// the drag started with (explicit targets), Esc or a cancelled pointer drops it. A press on
// nothing, in any tool but the pen, starts a selection box (bowen 1791558733, 1791559014):
// dragged right, it takes the lines wholly inside; dragged left, every line it touches; only in
// its focus, the current layer.
import { createMover, type Target } from '../../move'
import type { Core, Snapshot, Vec } from '../../src'
import type { Ctx, Flow, Id, Mods, Preview, Unit } from '../base'

export interface SelectTransform extends Flow {
  pointerDown(at: Vec, mods: Mods): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
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
    // the box's focus is the current layer, whatever the tool (bowen 1791558733)
    const s = ctx.snap(), of = ctx.layerOf(s), visible = new Set(s.lines.filter(l => l.state.visible).map(l => l.id))
    const lines = ctx.reader().linesInRect(b.from, at, at.x >= b.from.x).filter(id => visible.has(id) && of.line(id) === ctx.env.layer())
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

  /** What the last A / V press picked (a box or nothing: null); read by the app's name labels (docs/name-labels-plan.md). */
  let lastPress: Unit['kind'] | null = null
  return {
    get lastPress() { return lastPress },
    get moving() { return mover.running },
    cancelLevel: 1,
    get dragging() { return !!mover.running || !!box },
    keyDown(key, mods) {
      if (ctx.tool() !== 'V' && ctx.tool() !== 'A') return false
      return mover.keyDown(selectionTarget, { key, repeat: mods.repeat, shift: mods.shift, alt: mods.alt, ctrl: mods.ctrl })
    },
    keyUp(key) { mover.keyUp(key) },
    startBox(at, mods, clear) { box = { ...ctx.owned(), from: { x: at.x, y: at.y }, to: { x: at.x, y: at.y }, mods: { ...mods }, clear } },
    pointerDown(at, mods) {
      lastPress = null
      const picked: Unit | undefined = ctx.tool() === 'V'
        ? (() => { const line = ctx.hitLine(at); return line ? { kind: 'line' as const, id: line } : undefined })()
        : hitDirect(at)
      if (!picked) { this.startBox(at, mods, true); return true }
      lastPress = picked.kind
      const already = ctx.selection().some(v => key(v) === key(picked))
      if (!already || mods.shift || mods.alt) {
        if (ctx.tool() === 'V' && picked.kind === 'line') ctx.commit(e => e.selectGroup(picked.id, mode(mods)))
        else ctx.commit(e => e.select([picked], mode(mods)))
      }
      startDrag(at)
      return true
    },
    pointerMove(at) {
      if (mover.running === 'drag') mover.drag(at)
      if (box) box.to = { x: at.x, y: at.y }
    },
    pointerUp(at) {
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
      if (box && ctx.mine(box)) p.box = { from: { ...box.from }, to: { ...box.to }, whole: box.to.x >= box.from.x }
      p.handles = handlesShown(ctx.snap())
    },
  }
}
