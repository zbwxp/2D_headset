// fills — a fill is an attribute of a closed loop (Q18). Loops are found from
// shared points; a filled loop keeps its identity and boundary lines through
// splits and binds, and its fill disappears when the boundary is no longer one
// closed walk in one layer (Q21: one principle, no per-operation special cases).
// Fill order: bottom → top; a new fill goes on top (Q24 D).
import * as net from '../network'

type Id = net.Id

export interface FilledLoop { id: Id; layer: Id; lines: Id[]; color: string; visible: boolean }
export interface FillsState { loops: FilledLoop[]; order: Id[] }
export interface LoopView { id: Id; layer: Id; route: net.LoopUse[]; filled: boolean; color?: string; visible?: boolean }

export const create = (): FillsState => ({ loops: [], order: [] })

function find(f: FillsState, id: Id): FilledLoop {
  const l = f.loops.find(x => x.id === id)
  if (!l) throw new Error(`No filled loop ${id}`)
  return l
}

/** All loops: filled ones (fill order), then unfilled simple loops (discovery order). */
export function discover(f: FillsState, n: net.NetworkState): LoopView[] {
  const filled = f.order.map(id => find(f, id))
  const filledKeys = new Set(filled.map(l => net.loopKey(l.lines)))
  const views: LoopView[] = filled.map(l => ({ id: l.id, layer: l.layer, route: closedWalk(n, l.lines)!, filled: true, color: l.color, visible: l.visible }))
  for (const found of net.simpleLoops(n)) {
    if (filledKeys.has(found.key)) continue
    views.push({ id: found.key, layer: found.layer, route: found.route, filled: false })
  }
  return views
}

/** Fill a loop (by id from discover). A new fill goes on top. */
export function fill(f: FillsState, n: net.NetworkState, id: Id, color: string) {
  const existing = f.loops.find(l => l.id === id)
  if (existing) { existing.color = color; return }
  const found = net.simpleLoops(n).find(l => l.key === id)
  if (!found) throw new Error(`No loop ${id}`)
  f.loops.push({ id, layer: found.layer, lines: found.route.map(u => u.line), color, visible: true })
  f.order.push(id)
}

export function clearFill(f: FillsState, id: Id) {
  find(f, id)
  f.loops = f.loops.filter(l => l.id !== id)
  f.order = f.order.filter(x => x !== id)
}

export function setVisible(f: FillsState, id: Id, visible: boolean) { find(f, id).visible = visible }

export function reorder(f: FillsState, id: Id, index: number) {
  find(f, id)
  f.order = f.order.filter(x => x !== id)
  f.order.splice(Math.max(0, Math.min(index, f.order.length)), 0, id)
}

/** Keep boundary references after one network operation. */
export function update(f: FillsState, ch: net.Changes) {
  for (const r of ch.replaced) for (const l of f.loops) l.lines = l.lines.flatMap(x => (x === r.line ? [...r.pieces] : [x]))
  const collapsed = new Set(ch.collapsedLines)
  for (const l of f.loops) l.lines = l.lines.filter(x => !collapsed.has(x))
  const deleted = new Set(ch.deletedLines)
  drop(f, f.loops.filter(l => l.lines.some(x => deleted.has(x))).map(l => l.id))
}

/** Drop every fill whose boundary is no longer one closed walk in one layer. */
export function validate(f: FillsState, n: net.NetworkState) {
  drop(f, f.loops.filter(l => !closedWalk(n, l.lines) || l.lines.some(x => net.layerOfLine(n, x) !== l.layer)).map(l => l.id))
}

function drop(f: FillsState, ids: Id[]) {
  if (!ids.length) return
  const gone = new Set(ids)
  f.loops = f.loops.filter(l => !gone.has(l.id))
  f.order = f.order.filter(x => !gone.has(x))
}

/**
 * The lines as one closed walk using each line once (connected, every point of
 * even degree), ordered and oriented; null if they are not one. A walk may pass a
 * point twice (bowen 1791391694).
 */
export function closedWalk(n: net.NetworkState, lines: Id[]): net.LoopUse[] | null {
  if (lines.length < 2 || new Set(lines).size !== lines.length || lines.some(x => !net.hasLine(n, x))) return null
  const ls = lines.map(id => net.line(n, id))
  const degree = new Map<Id, number>()
  for (const l of ls) for (const p of [l.a, l.b]) degree.set(p, (degree.get(p) ?? 0) + 1)
  if ([...degree.values()].some(d => d % 2)) return null
  // Hierholzer from the first line's start.
  const unused = new Set(lines)
  const stack: { point: Id; use?: net.LoopUse }[] = [{ point: ls[0]!.a }]
  const out: net.LoopUse[] = []
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const next = ls.find(l => unused.has(l.id) && (l.a === top.point || l.b === top.point))
    if (next) {
      unused.delete(next.id)
      const reversed = next.a !== top.point
      stack.push({ point: reversed ? next.a : next.b, use: { line: next.id, reversed } })
    } else {
      const done = stack.pop()!
      if (done.use) out.push(done.use)
    }
  }
  if (unused.size) return null
  return out.reverse()
}
