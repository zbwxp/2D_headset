// deform — the 四角 / 曲边 edit (package 2; docs/deform-p2-checklist.md): the given lines refitted under the
// frame's field (deform/), written as one edit through core's own move and handle operations. The same
// operation is previewed (core.preview) and committed (core.editIn), so the preview is the commit's pipeline.
import { deformField, deformPlan, type Bend, type Plan, type PlanLine, type Quad, type Rect } from '../../deform'
import type { Core, Editor } from '../../src'

export interface DeformOp {
  /** The edit: every end point moved, then every handle set. */
  readonly run: (e: Editor) => void
  /** The plan's fit diagnostic (input units; sampled, not a bound). */
  readonly maxError: number
}

/**
 * The deform of `lines` in `view`: each line's stored curve (its end points and handles in that view), refitted
 * under the field of the rest frame `rect` taken to `quad` and bent by `bend`. Refused before anything is written
 * for no line or an unknown one; the field's own refusals (a crossed quad, a fold, the horizon) pass through.
 */
export function deformOp(core: Core, view: string, lines: readonly string[], rect: Rect, quad: Quad, bend?: Bend): DeformOp {
  if (!lines.length) throw Error('deform-no-lines: select lines to deform')
  const s = core.in(view).snapshot(), at = new Map(s.points.map(p => [p.id, p.position]))
  const given: PlanLine[] = [...new Set(lines)].map(id => {
    const l = s.lines.find(x => x.id === id)
    if (!l) throw Error(`deform-unknown-line: no line ${id}`)
    const a = at.get(l.a)!, b = at.get(l.b)!
    return { id, a: l.a, b: l.b, curve: [a, { x: a.x + l.ha.x, y: a.y + l.ha.y }, { x: b.x + l.hb.x, y: b.y + l.hb.y }, b] }
  })
  const plan: Plan = deformPlan(given, deformField(rect, quad, bend))
  return {
    run: e => {
      e.move(plan.points)
      for (const h of plan.handles) e.moveHandle(h.line, h.end, h.offset)
    },
    maxError: plan.maxError,
  }
}
