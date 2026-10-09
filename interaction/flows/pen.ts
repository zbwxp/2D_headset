// pen — a chain of clicks makes lines; clicking an existing point connects to it. The chain
// is the pen's own temporary state; it ends with Esc, a tool change, a drawing change, or
// when its last point is gone.
import type { Core, Vec } from '../../src'
import type { Ctx, Flow, Id, Preview } from '../base'
import { note } from '../feedback'

export interface Pen extends Flow { click(at: Vec): void }

export function pen(ctx: Ctx): Pen {
  let chain: { core: Core; from: Id | { id: Id; layer: Id; position: Vec } } | null = null
  return {
    cancelLevel: 2,
    click(at) {
      const layer = ctx.env.layer()
      if (!layer) { ctx.feedback = note('no-layer', 'no layer to draw into'); return }
      const onPoint = ctx.hitPoint(at)
      const spec = onPoint ?? { id: ctx.env.newId('p'), layer, position: at }
      if (chain && !ctx.mine(chain)) chain = null
      if (!chain) { chain = { core: ctx.core(), from: spec }; return }
      const from = chain.from
      if (typeof from === 'string' && !ctx.snap().points.some(p => p.id === from)) { chain = { core: ctx.core(), from: spec }; return }
      if (ctx.commit(e => e.line(ctx.env.newId('l'), from, spec))) chain = { core: ctx.core(), from: typeof spec === 'string' ? spec : spec.id }
    },
    cancel() { if (!chain) return false; chain = null; return true },
    toolChanged() { chain = null },
    drawingChanged() { chain = null },
    historyChanged() { if (chain && typeof chain.from === 'string' && !ctx.snap().points.some(p => p.id === chain!.from)) chain = null },
    preview(p: Preview) { if (chain && ctx.mine(chain)) p.pen = typeof chain.from === 'string' ? { point: chain.from } : { at: { ...chain.from.position } } },
  }
}
