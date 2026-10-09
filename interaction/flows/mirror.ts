// mirror — a two-step apply: the selection is taken as the source, then the selection at
// the second step is the target; then a mirror apply or a mirror link. The source is fixed
// once given (explicit targets). Later two-step applies join here.
import type { Core } from '../../src'
import type { Ctx, Flow, Id, Preview } from '../base'
import { note } from '../feedback'

export interface Mirror extends Flow { setSource(): void; apply(link: boolean): void }

export function mirror(ctx: Ctx): Mirror {
  let source: { core: Core; lines: Id[] } | null = null
  const selectedLines = () => ctx.snap().selection.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  return {
    cancelLevel: 2,
    setSource() { source = { core: ctx.core(), lines: selectedLines() } },
    apply(link) {
      const src = source
      if (!src || !ctx.mine(src) || !src.lines.length) { ctx.feedback = note('no-mirror-source', 'pick the mirror source first'); return }
      const s = ctx.snap(), target = selectedLines(), groupOf = (l: Id) => s.groups.find(g => g.lines.includes(l))?.id
      if (src.lines.some(l => !groupOf(l))) { source = null; ctx.feedback = note('pick-gone', 'the mirror source is gone'); return }
      const ok = link
        ? ctx.commit(e => e.mirrorLink([...new Set(src.lines.map(groupOf) as Id[])], [...new Set(target.map(groupOf).filter((x): x is Id => !!x))]))
        : ctx.commit(e => e.mirrorApply(src.lines, target))
      if (ok) source = null
    },
    cancel() { if (!source) return false; source = null; return true },
    toolChanged() { /* the source is picked with buttons, not a tool: it stays */ },
    drawingChanged() { source = null },
    historyChanged() { if (source && source.lines.some(l => !ctx.snap().lines.some(x => x.id === l))) source = null },
    preview(p: Preview) { if (source && ctx.mine(source)) p.mirrorSource = [...source.lines] },
  }
}
