// mirror — a two-step apply: the selection is taken as the source, then the selection at
// the second step is the target; then a mirror apply or a mirror link. The source is fixed
// once given (explicit targets). Later two-step applies join here.
import type { Core } from '../../src'
import type { Ctx, Flow, Id, Preview } from '../base'
import { note } from '../feedback'

export interface Mirror extends Flow { setSource(): void; apply(link: boolean): void }

export function mirror(ctx: Ctx): Mirror {
  // the source keeps the lines picked and, for a link, the whole curves they were then
  let source: { core: Core; lines: Id[]; groups: { id: Id; lines: Id[] }[] } | null = null
  const selectedLines = () => ctx.snap().selection.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  const sameSet = (a: readonly Id[], b: readonly Id[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  /** The whole curves the lines make up, or null when they are not whole curves (never widened for the user; dot 1791544469). */
  function wholeGroups(lines: readonly Id[]): { id: Id; lines: Id[] }[] | null {
    const groups = ctx.snap().groups.filter(g => g.lines.some(l => lines.includes(l)))
    if (!groups.length || !sameSet(groups.flatMap(g => g.lines), lines)) return null
    return groups.map(g => ({ id: g.id, lines: [...g.lines] }))
  }
  return {
    cancelLevel: 2,
    setSource() { const lines = selectedLines(); source = { core: ctx.core(), lines, groups: wholeGroups(lines) ?? [] } },
    apply(link) {
      const src = source
      if (!src || !ctx.mine(src) || !src.lines.length) { ctx.feedback = note('no-mirror-source', 'pick the mirror source first'); return }
      const s = ctx.snap(), target = selectedLines()
      if (src.lines.some(l => !s.lines.some(x => x.id === l))) { source = null; ctx.feedback = note('pick-gone', 'the mirror source is gone'); return }
      let ok: boolean
      if (link) {
        // a mirror link joins whole first-level elements: both sides must be exactly whole curves,
        // and the source curves must still have the members they had when picked
        const srcNow = wholeGroups(src.lines), tgt = wholeGroups(target)
        if (!src.groups.length || !srcNow || !sameSet(srcNow.map(g => JSON.stringify([g.id, [...g.lines].sort()])), src.groups.map(g => JSON.stringify([g.id, [...g.lines].sort()])))) {
          source = null; ctx.feedback = note('mirror-source-not-whole', 'the mirror source is not whole curves (or they changed since): pick it again with V', src.lines.map(id => ({ kind: 'line' as const, id }))); return
        }
        if (!tgt) { ctx.feedback = note('mirror-target-not-whole', 'the mirror target must be whole curves: select them with V', target.map(id => ({ kind: 'line' as const, id }))); return }
        ok = ctx.commit(e => e.mirrorLink(src.groups.map(g => g.id), tgt.map(g => g.id)))
      } else ok = ctx.commit(e => e.mirrorApply(src.lines, target))
      if (ok) source = null
    },
    cancel() { if (!source) return false; source = null; return true },
    toolChanged() { /* the source is picked with buttons, not a tool: it stays */ },
    drawingChanged() { source = null },
    historyChanged() { if (source && source.lines.some(l => !ctx.snap().lines.some(x => x.id === l))) source = null },
    preview(p: Preview) { if (source && ctx.mine(source)) p.mirrorSource = [...source.lines] },
  }
}
