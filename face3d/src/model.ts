// The prototype model (PLAN §5): the rough head, its surface bones and key contours; what to draw at a view.
import { type Bone, attachAll, isAttach, place } from './bones'
import { type ContourLine, type KeyTable, keyTable, mixContour } from './contour'
import { type Head, type HeadShape, defaultShape, makeHead } from './head'
import { candidates, mask, visible } from './outline'
import { type V3, type View, dot, toCamera } from './view'

export interface Model { readonly head: Head; readonly bones: Bone[]; readonly table: KeyTable }

export function makeModel(shape: HeadShape = defaultShape): Model {
  const head = makeHead(shape)
  return { head, bones: attachAll(head), table: keyTable(head) }
}

export interface DrawnBone { readonly name: string; readonly part: Bone['part']; readonly closed: boolean; readonly pts: V3[]; readonly facing: boolean[] }

/** Surface bones at a view: head-space points, and whether each faces the camera (occlusion is out of scope, PLAN §0). */
export function bonesAt(m: Model, view: View): DrawnBone[] {
  const d = toCamera(view)
  return m.bones.map(b => ({
    name: b.name, part: b.part, closed: b.closed,
    pts: b.at.map(a => place(m.head, a)),
    facing: b.at.map(a => !isAttach(a) || dot(m.head.normal(a.u, a.y), d) > -0.15),
  }))
}

export const contourAt = (m: Model, view: View): ContourLine[] => mixContour(m.head, m.table, view)

/** The rough head's own visible outline at this view (the comparison switch, dot constraint 2): visible candidates. */
export function headOutline(m: Model, view: View): V3[][] {
  const mk = mask(m.head, view), out: V3[][] = []
  for (const loop of candidates(m.head, view, { nu: 160, ny: 110 })) {
    let run: V3[] = []
    for (const q of loop.pts) { if (visible(mk, q.p, view, m.head.normal(q.u, q.y))) run.push(q.p); else { if (run.length > 1) out.push(run); run = [] } }
    if (run.length > 1) out.push(run)
  }
  return out
}
