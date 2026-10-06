// Fill-only closing edge experiment (headset-design doc 18 §19, dot 1791302404). STANDALONE: a small copy
// of the proto data shapes (curve = anchors + explicit ordered segments + closed; fill = ordered boundary
// steps), not wired into the product. Undo / save-reopen at the experiment data level only.
//
// Mature reference: SVG 2 Painting 13.4 fills an open SUBPATH as if a closepath joined its last point to
// its first. Our fills are separate records whose outline runs across several independent curves, so this
// is an ADAPTATION for the existing fill record, not SVG bridging arbitrary gaps (dot):
//   - a bridge lives only in the fill's own boundary, references two endpoints, is a straight line at the
//     current positions, takes no part in endpoint linkage and draws no stroke;
//   - a cut inserts a bridge ONLY at a break the original boundary passed through, keeping order and
//     direction; invalid boundaries are never patched automatically; deleting a bridged endpoint is refused;
//   - the bridge is part of the real fill geometry: `fillGeometry` is the one source (consecutive pieces start
//     where the previous one ended — no "read p0 once"); in THIS experiment only `fillContains` (a sampled
//     even-odd test) and `fillDependencies` read it. No mask, stroke, own-ink or cache consumer exists here.
import { v, type V } from './scenarioE'

export type Anchor = { id: string; p: V; hIn: V; hOut: V } // handles are absolute points here
export type Segment = { id: string; from: string; to: string }
export type Curve = { id: string; anchors: Record<string, Anchor>; segments: Segment[]; closed: boolean }
export type End = { curveId: string; anchorId: string }
export type BoundaryStep = { kind: 'segment'; curveId: string; segmentId: string; dir: 1 | -1 } | { kind: 'bridge'; from: End; to: End }
export type Fill = { id: string; boundary: BoundaryStep[] }
export type Doc = { curves: Record<string, Curve>; fills: Record<string, Fill>; seq: number }
export type Cubic = [V, V, V, V]

const fresh = (d: Doc, p: string) => `${p}${++d.seq}`
const sameV = (a: V, b: V) => a.x === b.x && a.y === b.y

// ---------- geometry: the ONE fill geometry every reader uses ----------
function segCubic(c: Curve, s: Segment, dir: 1 | -1): Cubic {
  const a = c.anchors[s.from]
  const b = c.anchors[s.to]
  const q: Cubic = [a.p, a.hOut, b.hIn, b.p]
  return dir === 1 ? q : [q[3], q[2], q[1], q[0]]
}
const pos = (d: Doc, e: End) => d.curves[e.curveId].anchors[e.anchorId].p

/** Ordered pieces of the fill outline; a bridge is a straight cubic between its two endpoints' current positions. */
export function fillGeometry(d: Doc, fillId: string): Cubic[] {
  return d.fills[fillId].boundary.map((st) => {
    if (st.kind === 'segment') {
      const c = d.curves[st.curveId]
      return segCubic(c, c.segments.find((s) => s.id === st.segmentId)!, st.dir)
    }
    const a = pos(d, st.from)
    const b = pos(d, st.to)
    return [a, v(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3), v(a.x + (2 * (b.x - a.x)) / 3, a.y + (2 * (b.y - a.y)) / 3), b]
  })
}
/** closure check on the geometry itself: every piece starts where the previous one ended, and the outline closes */
export function outlineGaps(g: Cubic[]): number {
  let worst = 0
  for (let i = 0; i < g.length; i++) {
    const prev = g[(i + g.length - 1) % g.length][3]
    worst = Math.max(worst, Math.hypot(g[i][0].x - prev.x, g[i][0].y - prev.y))
  }
  return worst
}
/** curves a fill depends on: those of its segments AND both ends of every bridge */
export function fillDependencies(d: Doc, fillId: string): string[] {
  const s = new Set<string>()
  for (const st of d.fills[fillId].boundary) {
    if (st.kind === 'segment') s.add(st.curveId)
    else (s.add(st.from.curveId), s.add(st.to.curveId))
  }
  return [...s].sort()
}
/** sampled even-odd hit test on the SAME geometry (experiment only; not native picking, not exact) */
export function fillContains(d: Doc, fillId: string, p: V): boolean {
  const pts: V[] = []
  for (const q of fillGeometry(d, fillId))
    for (let i = 0; i < 24; i++) {
      const t = i / 24
      const u = 1 - t
      pts.push(v(u * u * u * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t * t * t * q[3].x, u * u * u * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t * t * t * q[3].y))
    }
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = [pts[i], pts[j]]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ---------- edits ----------
export type Result = { ok: true; doc: Doc } | { ok: false; reason: string }

/**
 * Break a curve at an anchor (Inkscape "Break path": two coincident, unconnected end nodes, each with one
 * handle). Closed loop → one open chain starting at the break; open chain at an interior anchor → two curves.
 * Every fill boundary that passed THROUGH this anchor gets a bridge inserted there, in its own order and
 * direction. Nothing else is bridged.
 */
export function breakAt(doc: Doc, curveId: string, anchorId: string): Result {
  const d: Doc = structuredClone(doc)
  const c = d.curves[curveId]
  const a = c.anchors[anchorId]
  if (!a) return { ok: false, reason: `no anchor ${anchorId}` }
  const iIn = c.segments.findIndex((s) => s.to === anchorId)
  const iOut = c.segments.findIndex((s) => s.from === anchorId)
  if (iIn < 0 || iOut < 0) return { ok: false, reason: 'breaking at an end node changes nothing' }
  const copyId = fresh(d, 'n')
  // the incoming segment now ends at the copy; the copy keeps only the incoming handle
  const copy: Anchor = { id: copyId, p: { ...a.p }, hIn: { ...a.hIn }, hOut: { ...a.p } }
  const kept: Anchor = { ...a, hIn: { ...a.p } }
  let left: Curve
  let right: Curve | null = null
  const segIn = { ...c.segments[iIn], to: copyId }
  if (c.closed) {
    // rotate so the chain starts at the break: [iOut … end, 0 … iIn]
    const order = [...c.segments.slice(iOut), ...c.segments.slice(0, iOut)].map((s) => (s.id === segIn.id ? segIn : s))
    left = { ...c, anchors: { ...c.anchors, [anchorId]: kept, [copyId]: copy }, segments: order, closed: false }
  } else {
    // open chain broken at an interior anchor → [0 … iIn] ends at the copy, [iOut …] starts at the original
    const newId = fresh(d, 'c')
    const first = [...c.segments.slice(0, iIn), segIn]
    const second = c.segments.slice(iOut)
    const ids1 = new Set(first.flatMap((s) => [s.from, s.to]))
    const ids2 = new Set(second.flatMap((s) => [s.from, s.to]))
    const all: Record<string, Anchor> = { ...c.anchors, [anchorId]: kept, [copyId]: copy }
    left = { ...c, anchors: Object.fromEntries([...ids1].map((k) => [k, all[k]])), segments: first, closed: false }
    right = { id: newId, anchors: Object.fromEntries([...ids2].map((k) => [k, all[k]])), segments: second, closed: false }
  }
  d.curves[curveId] = left
  if (right) d.curves[right.id] = right
  const ownerOf = (segId: string) => (right && right.segments.some((s) => s.id === segId) ? right.id : curveId)
  // re-map every fill: segment owners, and a bridge exactly where a boundary passed through the broken anchor
  for (const f of Object.values(d.fills)) {
    // owners first: segments that moved to the new curve, and bridge ends whose anchor moved there
    const ownerOfAnchor = (e: End): End => (e.curveId === curveId && right && right.anchors[e.anchorId] && !left.anchors[e.anchorId] ? { ...e, curveId: right.id } : e)
    const steps: BoundaryStep[] = f.boundary.map((st) =>
      st.kind === 'segment' ? (st.curveId === curveId ? { ...st, curveId: ownerOf(st.segmentId) } : st) : { ...st, from: ownerOfAnchor(st.from), to: ownerOfAnchor(st.to) },
    )
    // Unified adjacency pass (review of 066676c): look at EVERY consecutive pair — segment or bridge — and
    // where the pair meets at the broken anchor {anchorId, copyId}: a bridge end is re-pointed to the side its
    // neighbour actually uses; two segments meeting there get a new bridge. Existing bridges count as neighbours.
    const startOf = (st: BoundaryStep): End => {
      if (st.kind === 'bridge') return st.from
      const sg = d.curves[st.curveId].segments.find((q) => q.id === st.segmentId)!
      return { curveId: st.curveId, anchorId: st.dir === 1 ? sg.from : sg.to }
    }
    const endOf = (st: BoundaryStep): End => {
      if (st.kind === 'bridge') return st.to
      const sg = d.curves[st.curveId].segments.find((q) => q.id === st.segmentId)!
      return { curveId: st.curveId, anchorId: st.dir === 1 ? sg.to : sg.from }
    }
    const atBreak = (e: End) => e.anchorId === anchorId || e.anchorId === copyId
    const work: BoundaryStep[] = steps.map((st) => (st.kind === 'bridge' ? { ...st, from: { ...st.from }, to: { ...st.to } } : st))
    const insertAfter = new Set<number>()
    for (let i = 0; i < work.length; i++) {
      const cur = work[i]
      const nx = work[(i + 1) % work.length]
      const e = endOf(cur)
      const s0 = startOf(nx)
      if (!atBreak(e) || !atBreak(s0) || e.anchorId === s0.anchorId) continue
      if (cur.kind === 'bridge') cur.to = { ...s0 } // the bridge now ends where its neighbour starts
      else if (nx.kind === 'bridge') nx.from = { ...e } // the bridge now starts where its neighbour ends
      else insertAfter.add(i) // two segments meeting at the break: a new bridge between them
    }
    const nb: BoundaryStep[] = []
    work.forEach((st, i) => {
      nb.push(st)
      if (insertAfter.has(i)) nb.push({ kind: 'bridge', from: endOf(st), to: startOf(work[(i + 1) % work.length]) })
    })
    f.boundary = nb
  }
  return { ok: true, doc: d }
}

export function moveAnchor(doc: Doc, e: End, to: V): Doc {
  const d: Doc = structuredClone(doc)
  const a = d.curves[e.curveId].anchors[e.anchorId]
  const dx = to.x - a.p.x
  const dy = to.y - a.p.y
  d.curves[e.curveId].anchors[e.anchorId] = { ...a, p: to, hIn: v(a.hIn.x + dx, a.hIn.y + dy), hOut: v(a.hOut.x + dx, a.hOut.y + dy) }
  return d
}

/** deleting an end node that a fill bridge refers to is refused with the fill named (no dangling reference) */
export function deleteEndNode(doc: Doc, e: End): Result {
  const users = Object.values(doc.fills).filter((f) => f.boundary.some((st) => st.kind === 'bridge' && [st.from, st.to].some((x) => x.curveId === e.curveId && x.anchorId === e.anchorId)))
  if (users.length) return { ok: false, reason: `fill ${users.map((f) => f.id).join(', ')} bridges at ${e.curveId}#${e.anchorId}: remove or repair the fill first` }
  return { ok: false, reason: 'not part of this experiment' }
}

export class Session {
  private undoStack: Doc[] = []
  private redoStack: Doc[] = []
  constructor(public doc: Doc) {}
  apply(next: Doc) {
    this.undoStack.push(this.doc)
    this.redoStack = []
    this.doc = next
  }
  undo() {
    const p = this.undoStack.pop()
    if (!p) return false
    this.redoStack.push(this.doc)
    this.doc = p
    return true
  }
  redo() {
    const n = this.redoStack.pop()
    if (!n) return false
    this.undoStack.push(this.doc)
    this.doc = n
    return true
  }
  save() {
    return JSON.stringify(this.doc)
  }
  static reopen(s: string) {
    return new Session(JSON.parse(s) as Doc)
  }
}

// ---------- fixture: a closed loop of four cubic segments, filled ----------
export function loopDoc(reversed = false): Doc {
  const A = (id: string, x: number, y: number, hi: V, ho: V): Anchor => ({ id, p: v(x, y), hIn: v(x + hi.x, y + hi.y), hOut: v(x + ho.x, y + ho.y) })
  const c: Curve = {
    id: 'C',
    anchors: { a: A('a', -10, 0, v(0, 4), v(0, -4)), b: A('b', 0, -8, v(-4, 0), v(4, 0)), c: A('c', 10, 0, v(0, -4), v(0, 4)), d: A('d', 0, 8, v(4, 0), v(-4, 0)) },
    segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'a' }],
    closed: true,
  }
  const fwd: BoundaryStep[] = c.segments.map((s) => ({ kind: 'segment', curveId: 'C', segmentId: s.id, dir: 1 }))
  const boundary = reversed ? [...fwd].reverse().map((st) => ({ ...st, dir: -1 as const })) : fwd
  return { curves: { C: c }, fills: { F: { id: 'F', boundary } }, seq: 0 }
}
export { sameV }
