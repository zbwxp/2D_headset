// steps — operations that collect their objects click by click (bind, merge position, link:
// two points; join: two lines in click order), and the one-click ones (split, unbind, fill).
// Objects already given are never replaced; a first pick that is gone ends the step.
import type { Core, Vec } from '../../src'
import type { Ctx, Flow, Id, Mods, Preview } from '../base'
import { note } from '../feedback'

export interface Steps extends Flow { click(at: Vec, mods: Mods): void }

export function steps(ctx: Ctx): Steps {
  let pick: { core: Core; kind: 'point' | 'line'; id: Id } | null = null

  function twoPoints(at: Vec) {
    const id = ctx.hitPoint(at)
    if (!id) return
    if (!pick || !ctx.mine(pick) || pick.kind !== 'point') { pick = { core: ctx.core(), kind: 'point', id }; return }
    const first = pick.id
    pick = null
    // the first pick must still be there; nothing else stands in for it (plan item 17)
    if (!ctx.snap().points.some(p => p.id === first)) { ctx.feedback = note('pick-gone', `the first point ${first} is gone`, [{ kind: 'point', id: first }]); return }
    const tool = ctx.tool()
    if (tool === 'bind') ctx.commit(e => e.bind(first, id))
    if (tool === 'merge') ctx.commit(e => e.mergePosition(first, id))
    if (tool === 'link') ctx.commit(e => e.link(first, id))
  }

  function twoLines(at: Vec, mods: Mods) {
    const id = ctx.hitLine(at)
    if (!id) return
    if (!pick || !ctx.mine(pick) || pick.kind !== 'line') { pick = { core: ctx.core(), kind: 'line', id }; return }
    const first = pick.id
    pick = null
    const s = ctx.snap(), l1 = s.lines.find(l => l.id === first), l2 = s.lines.find(l => l.id === id)
    if (!l1) { ctx.feedback = note('pick-gone', `the first line ${first} is gone`, [{ kind: 'line', id: first }]); return }
    const point = l2 && first !== id ? [l1.a, l1.b].find(p => p === l2.a || p === l2.b) : undefined
    if (!point) { ctx.feedback = note('join-needs-shared-point', 'the two lines must share an end point', [{ kind: 'line', id: first }, { kind: 'line', id }]); return }
    // click order: the second line turns to the first (graph, symmetric relations)
    const o = ctx.options()
    if (mods.alt) ctx.commit(e => e.removeJoin(point, first, id))
    else ctx.commit(e => e.join(point, first, id, { mode: o.joinMode, ...(o.joinMode === 'arc' ? { radius: o.radius } : {}) }))
  }

  function splitAt(at: Vec) {
    // core measures and gives the parameter on the line's own curve (arc trims included); interaction only picks
    const h = ctx.shown(at).find(x => x.kind === 'line')
    if (!h || h.kind !== 'line') return
    ctx.commit(e => e.split(h.id, h.t, ctx.env.newId('p'), ctx.env.newId('l'), ctx.env.newId('l')))
  }

  function unbindAt(at: Vec) {
    const id = ctx.hitLine(at)
    if (!id) return
    const s = ctx.snap(), l = s.lines.find(x => x.id === id)!
    const pos = (p: Id) => s.points.find(x => x.id === p)!.position
    const pt = Math.hypot(pos(l.a).x - at.x, pos(l.a).y - at.y) <= Math.hypot(pos(l.b).x - at.x, pos(l.b).y - at.y) ? l.a : l.b
    ctx.commit(e => e.unbind(pt, [id], ctx.env.newId('p')))
  }

  function fillAt(at: Vec, mods: Mods) {
    const loop = ctx.core().pickLoop(at)
    if (!loop) return
    const color = ctx.options().color
    ctx.commit(e => (mods.shift ? e.clearFill(loop) : e.fill(loop, color)))
  }

  return {
    cancelLevel: 2,
    click(at, mods) {
      const tool = ctx.tool()
      if (tool === 'bind' || tool === 'merge' || tool === 'link') twoPoints(at)
      else if (tool === 'join') twoLines(at, mods)
      else if (tool === 'split') splitAt(at)
      else if (tool === 'unbind') unbindAt(at)
      else if (tool === 'fill') fillAt(at, mods)
    },
    cancel() { if (!pick) return false; pick = null; return true },
    toolChanged() { pick = null },
    drawingChanged() { pick = null },
    historyChanged() {
      if (!pick) return
      const s = ctx.snap(), there = pick.kind === 'point' ? s.points.some(p => p.id === pick!.id) : s.lines.some(l => l.id === pick!.id)
      if (!there) pick = null
    },
    preview(p: Preview) { if (pick && ctx.mine(pick)) p.pick = { kind: pick.kind, id: pick.id } },
  }
}
