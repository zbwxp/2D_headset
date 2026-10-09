// select-transform — V picks a whole curve, A a point, handle or line; pressing selects (a
// pre-edit, one step), dragging only previews, release commits one translate on the units
// the drag started with (explicit targets), Esc or a cancelled pointer drops it.
import type { Core, Snapshot, Vec } from '../../src'
import type { Ctx, Flow, Id, Mods, Preview, Unit } from '../base'

export interface SelectTransform extends Flow {
  pointerDown(at: Vec, mods: Mods): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
  pointerCancel(): void
  readonly dragging: boolean
}

export function selectTransform(ctx: Ctx): SelectTransform {
  let drag: { core: Core; start: Vec; units: Unit[]; offset: Vec } | null = null
  const key = (u: Unit) => (u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`)
  const mode = (m: Mods) => (m.shift ? 'add' : m.alt ? 'remove' : 'replace') as 'add' | 'remove' | 'replace'

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
  /** A: a point, else a handle shown for the selection, else a line; nearest first. */
  function hitDirect(at: Vec): Unit | undefined {
    const shown = handlesShown(ctx.snap())
    for (const h of ctx.shown(at)) {
      if (h.kind === 'point') return { kind: 'point', id: h.id }
      if (h.kind === 'handle' && shown.has(`${h.line}:${h.end}`)) return { kind: 'handle', line: h.line, end: h.end }
      if (h.kind === 'line') return { kind: 'line', id: h.id }
    }
    return undefined
  }
  const startDrag = (at: Vec) => { drag = { core: ctx.core(), start: at, units: ctx.snap().selection, offset: { x: 0, y: 0 } } }

  return {
    cancelLevel: 1,
    get dragging() { return !!drag },
    pointerDown(at, mods) {
      const picked: Unit | undefined = ctx.tool() === 'V'
        ? (() => { const line = ctx.hitLine(at); return line ? { kind: 'line' as const, id: line } : undefined })()
        : hitDirect(at)
      if (!picked) { if (ctx.snap().selection.length) ctx.commit(e => e.select([], 'replace')); return false }
      const already = ctx.snap().selection.some(v => key(v) === key(picked))
      if (!already || mods.shift || mods.alt) {
        if (ctx.tool() === 'V' && picked.kind === 'line') ctx.commit(e => e.selectGroup(picked.id, mode(mods)))
        else ctx.commit(e => e.select([picked], mode(mods)))
      }
      startDrag(at)
      return true
    },
    pointerMove(at) { if (drag) drag.offset = { x: at.x - drag.start.x, y: at.y - drag.start.y } },
    pointerUp(at) {
      const d = drag
      drag = null // a repeated release finds nothing to commit (plan item 19)
      if (!d || !ctx.mine(d)) return // the drawing changed under the drag: it never lands elsewhere
      const offset = { x: at.x - d.start.x, y: at.y - d.start.y }
      if ((offset.x || offset.y) && d.units.length) ctx.commit(e => e.translate(offset.x, offset.y, d.units))
    },
    pointerCancel() { drag = null },
    cancel() { if (!drag) return false; drag = null; return true },
    toolChanged() { drag = null }, // an interaction default: a tool change cancels a drag
    drawingChanged() { drag = null },
    historyChanged() { drag = null },
    preview(p: Preview) { if (drag && ctx.mine(drag)) p.drag = { units: structuredClone(drag.units), offset: { ...drag.offset } } },
  }
}
