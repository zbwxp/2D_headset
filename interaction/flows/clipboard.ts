// clipboard — copy reads a clip from core (the content stays core's clipboard module);
// cut only greys whole curves, and the next paste moves them with their ids (core
// moveGroup); later pastes copy, each one step further. The pending cut belongs to one
// drawing and ends when its curves change members (plan item 21).
import type { Clip, Core } from '../../src'
import type { Ctx, Flow, Id, Preview } from '../base'
import { fromError, note } from '../feedback'

export interface Clipboard extends Flow { copy(): void; cut(): void; paste(): void }

const STEP = 20

export function clipboard(ctx: Ctx): Clipboard {
  let clip: Clip | null = null, pastes = 0
  let pending: { core: Core; groups: { id: Id; lines: Id[] }[] } | null = null

  /** A pending cut holds while its groups exist with the same members. */
  const intact = (c: NonNullable<typeof pending>) => {
    const groups = ctx.snap().groups
    return c.groups.every(g => { const now = groups.find(x => x.id === g.id); return !!now && JSON.stringify([...now.lines].sort()) === JSON.stringify([...g.lines].sort()) })
  }

  return {
    cancelLevel: 3,
    copy() {
      try { clip = ctx.core().copy(); pastes = 0; pending = null; ctx.feedback = undefined }
      catch (err) { ctx.feedback = fromError(err) }
    },
    cut() {
      const s = ctx.snap(), lines = s.selection.flatMap(u => (u.kind === 'line' ? [u.id] : []))
      const groups = s.groups.filter(g => g.lines.some(l => lines.includes(l)))
      if (!groups.length || groups.some(g => !g.lines.every(l => lines.includes(l)))) { ctx.feedback = note('cut-whole-curves', 'cut takes whole curves: select them with V'); return }
      pending = { core: ctx.core(), groups: groups.map(g => ({ id: g.id, lines: [...g.lines] })) }
      ctx.feedback = undefined
    },
    paste() {
      const layer = ctx.env.layer()
      if (!layer) { ctx.feedback = note('no-layer', 'no layer to paste into'); return }
      if (pending) {
        const c = pending
        if (!ctx.mine(c)) { pending = null; return }
        if (!intact(c)) { pending = null; ctx.feedback = note('cut-changed', 'the cut curves changed; select them again', c.groups.map(g => ({ kind: 'group' as const, id: g.id }))); return }
        const lines = c.groups.flatMap(g => g.lines)
        // a refused paste keeps the cut for another try (plan item 9)
        if (ctx.commit(e => { for (const g of c.groups) e.moveGroup(g.id, layer); e.select(lines.map(id => ({ kind: 'line' as const, id }))) })) {
          pending = null
          try { clip = ctx.core().copy(lines); pastes = 0 } catch { clip = null }
        }
        return
      }
      if (!clip) { ctx.feedback = note('nothing-copied', 'nothing copied'); return }
      const k = pastes + 1, c = clip
      if (ctx.commit(e => e.paste(c, layer, { x: STEP * k, y: STEP * k }, ctx.env.newId('c')))) pastes = k
    },
    cancel() { if (!pending) return false; pending = null; return true },
    toolChanged() { /* the pending cut belongs to the clipboard, not to a tool: it stays */ },
    drawingChanged() { pending = null; pastes = 0 /* the clip is plain data: it stays */ },
    historyChanged() { if (pending && !intact(pending)) pending = null },
    preview(p: Preview) { p.cut = pending && ctx.mine(pending) ? pending.groups.map(g => g.id) : [] },
  }
}
