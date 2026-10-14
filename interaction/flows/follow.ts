// Handle follow (docs/handle-follow-checklist.md; bowen 1791941335, 1791944499; v103 7205381
// src/domain/drawing/nodeDrag.ts): when a move takes a line's end points, the line's handles follow its chord — the
// similarity (rotation and length ratio) taking the old chord to the new is applied to each handle offset the move
// does not itself take. A line whose ends move together keeps its chord: nothing changes. At a smooth join whose two
// lines both turn, the two ends there share one turn, weighted by the old chord lengths (v103), so the join stays
// smooth; each keeps its own length ratio. Pure: the commit and the drag preview use the same function.
import type { Snapshot, Vec } from '../../src'
import type { Unit } from '../base'

type Id = string
type End = 'a' | 'b'
export interface Follow { readonly line: Id; readonly end: End; readonly offset: Vec }

/** Below this a chord counts as collapsed: its line's handles do not follow. */
const TINY = 1e-9

/** The handle offsets a move of `units` by `offset` makes follow, in the snapshot's view. */
export function followHandles(s: Snapshot, units: readonly Unit[], offset: Vec): Follow[] {
  if (offset.x === 0 && offset.y === 0) return []
  const moved = new Set<Id>(), taken = new Set<string>()
  const lineOf = new Map(s.lines.map(l => [l.id, l]))
  for (const u of units) {
    if (u.kind === 'point') moved.add(u.id)
    else if (u.kind === 'handle') taken.add(`${u.line}:${u.end}`)
    else if (u.kind === 'line') { const l = lineOf.get(u.id); if (l) { moved.add(l.a); moved.add(l.b); taken.add(`${l.id}:a`); taken.add(`${l.id}:b`) } }
  }
  const pos = new Map(s.points.map(p => [p.id, p.position]))
  const at = (id: Id, after: boolean): Vec => { const p = pos.get(id)!; return after && moved.has(id) ? { x: p.x + offset.x, y: p.y + offset.y } : p }
  // each line's turn (angle) and length ratio, from its old chord to its new
  const turns = new Map<Id, { angle: number; ratio: number; length: number }>()
  for (const l of s.lines) {
    if (!moved.has(l.a) && !moved.has(l.b)) continue
    const a0 = at(l.a, false), b0 = at(l.b, false), a1 = at(l.a, true), b1 = at(l.b, true)
    const o = { x: b0.x - a0.x, y: b0.y - a0.y }, n = { x: b1.x - a1.x, y: b1.y - a1.y }
    const lo = Math.hypot(o.x, o.y), ln = Math.hypot(n.x, n.y)
    if (lo < TINY || ln < TINY) continue
    const angle = Math.atan2(o.x * n.y - o.y * n.x, o.x * n.x + o.y * n.y), ratio = ln / lo
    if (angle === 0 && ratio === 1) continue
    turns.set(l.id, { angle, ratio, length: lo })
  }
  // per end: the line's own turn; at a smooth join of two turning lines, one shared turn (v103)
  const endAngle = new Map<string, number>()
  for (const [id, t] of turns) { endAngle.set(`${id}:a`, t.angle); endAngle.set(`${id}:b`, t.angle) }
  for (const j of s.joins) {
    if (j.mode !== 'smooth') continue
    const [l1, l2] = j.lines, t1 = turns.get(l1), t2 = turns.get(l2)
    if (!t1 || !t2) continue
    const shared = (t1.angle * t1.length + t2.angle * t2.length) / (t1.length + t2.length)
    for (const id of j.lines) { const l = lineOf.get(id)!; for (const e of ['a', 'b'] as const) if (l[e] === j.point) endAngle.set(`${id}:${e}`, shared) }
  }
  const out: Follow[] = []
  for (const [id, t] of turns) {
    const l = lineOf.get(id)!
    for (const end of ['a', 'b'] as const) {
      if (taken.has(`${id}:${end}`)) continue
      const h = end === 'a' ? l.ha : l.hb, angle = endAngle.get(`${id}:${end}`)!, c = Math.cos(angle) * t.ratio, sn = Math.sin(angle) * t.ratio
      out.push({ line: id, end, offset: { x: h.x * c - h.y * sn, y: h.x * sn + h.y * c } })
    }
  }
  return out
}

/** Straight (S): each line's handles on its chord at 1/3 and 2/3 (bowen 1791944499). */
export function straightHandles(s: Snapshot, lines: readonly Id[]): Follow[] {
  const pos = new Map(s.points.map(p => [p.id, p.position]))
  return s.lines.filter(l => lines.includes(l.id)).flatMap(l => {
    const a = pos.get(l.a)!, b = pos.get(l.b)!, third = { x: (b.x - a.x) / 3, y: (b.y - a.y) / 3 }
    return [{ line: l.id, end: 'a' as const, offset: third }, { line: l.id, end: 'b' as const, offset: { x: -third.x, y: -third.y } }]
  })
}
