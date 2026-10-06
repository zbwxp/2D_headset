// Exact point insertion experiment (headset-design doc 18 §19, item 3; dot 1791303399). STANDALONE.
// One curve, stored with FULL control points in every state and every preset of a family (§19.0-1: the old
// per-anchor offset format cannot express a split — dot's 0 / 8 → 2 / 4 / 6 example).
//
// Inserting a point at parameter u of one segment splits that cubic in EVERY state and preset at the same u
// (de Casteljau: the same curve, cut in two, shape unchanged), re-maps every (segment, u) reference, replaces
// the segment in fill boundaries in order and direction, and splits FROZEN transfer data geometrically while
// keeping its frozen linear map as stored — never re-fitting it on the split pieces (dot 1791302010-5).
// Mature reference for the split itself: Paper.js `Curve.divideAtTime(time)` (official reference).
import { v, type V } from './scenarioE'

export type Cubic = [V, V, V, V]
export type Mat2 = [number, number, number, number]
export type Anchor = { id: string; p: V; hIn: V; hOut: V }
export type Segment = { id: string; from: string; to: string }
/** curve structure (shared by all states) + per-state anchor positions */
export type Curve = { id: string; order: string[]; segments: Segment[]; states: Record<string, Record<string, Anchor>> }
export type Ref = { segmentId: string; u: number }
export type FillStep = { segmentId: string; dir: 1 | -1 }
/** a frozen line takeover: geometry (basis front + target) plus the linear map fixed at takeover time */
export type Takeover = { state: string; basisFront: Record<string, Anchor>; target: Record<string, Anchor>; L: Mat2 }
export type Doc = {
  presets: Record<string, Curve> // same structure in every preset of the family
  refs: Record<string, Ref> // interval ends, attachments …
  fill: FillStep[]
  takeover: Takeover | null
  seq: number
}

const lerp = (a: V, b: V, t: number): V => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
export function segCubic(c: Curve, state: string, segId: string): Cubic {
  const s = c.segments.find((x) => x.id === segId)!
  const A = c.states[state][s.from]
  const B = c.states[state][s.to]
  return [A.p, A.hOut, B.hIn, B.p]
}
export const bez = (q: Cubic, t: number): V => {
  const u = 1 - t
  return v(u * u * u * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t * t * t * q[3].x, u * u * u * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t * t * t * q[3].y)
}
/** de Casteljau split of anchor-pair data at u: returns new from.hOut, the new anchor (hIn, p, hOut), new to.hIn */
function splitAnchors(A: Anchor, B: Anchor, u: number, newId: string): { a: Anchor; m: Anchor; b: Anchor } {
  const p01 = lerp(A.p, A.hOut, u), p12 = lerp(A.hOut, B.hIn, u), p23 = lerp(B.hIn, B.p, u)
  const p012 = lerp(p01, p12, u), p123 = lerp(p12, p23, u)
  const p = lerp(p012, p123, u)
  return { a: { ...A, hOut: p01 }, m: { id: newId, hIn: p012, p, hOut: p123 }, b: { ...B, hIn: p23 } }
}

/** a (segment, u) reference after splitting segment `old` at us into (sa, sb) */
export function remapRef(r: Ref, old: string, us: number, sa: string, sb: string): Ref {
  if (r.segmentId !== old) return r
  return r.u <= us ? { segmentId: sa, u: r.u / us } : { segmentId: sb, u: (r.u - us) / (1 - us) }
}

export function insertPoint(doc: Doc, segId: string, us: number): Doc {
  const d: Doc = structuredClone(doc)
  // one identity plan for every state and preset; new ids never collide with any existing segment / anchor id
  const segIds = new Set(Object.values(d.presets).flatMap((c) => c.segments.map((x) => x.id)))
  const anchorIds = new Set(Object.values(d.presets).flatMap((c) => [...c.order, ...Object.values(c.states).flatMap((st) => Object.keys(st))]))
  const fresh = (base: string, taken: Set<string>) => {
    let id = base
    while (taken.has(id)) id = `${base}~${++d.seq}`
    taken.add(id)
    return id
  }
  const mId = fresh(`m${++d.seq}`, anchorIds)
  const sa = fresh(`${segId}a`, segIds)
  const sb = fresh(`${segId}b`, segIds)
  for (const c of Object.values(d.presets)) {
    const s = c.segments.find((x) => x.id === segId)!
    for (const st of Object.keys(c.states)) {
      const r = splitAnchors(c.states[st][s.from], c.states[st][s.to], us, mId)
      c.states[st] = { ...c.states[st], [s.from]: r.a, [mId]: r.m, [s.to]: r.b }
    }
    const i = c.segments.indexOf(s)
    c.segments.splice(i, 1, { id: sa, from: s.from, to: mId }, { id: sb, from: mId, to: s.to })
    c.order.splice(c.order.indexOf(s.from) + 1, 0, mId)
  }
  for (const k of Object.keys(d.refs)) d.refs[k] = remapRef(d.refs[k], segId, us, sa, sb)
  d.fill = d.fill.flatMap((f) => (f.segmentId !== segId ? [f] : f.dir === 1 ? [{ segmentId: sa, dir: 1 as const }, { segmentId: sb, dir: 1 as const }] : [{ segmentId: sb, dir: -1 as const }, { segmentId: sa, dir: -1 as const }]))
  if (d.takeover) {
    const cut = (anchors: Record<string, Anchor>, from: string, to: string) => {
      const r = splitAnchors(anchors[from], anchors[to], us, mId)
      return { ...anchors, [from]: r.a, [mId]: r.m, [to]: r.b }
    }
    const ends = doc.presets[Object.keys(doc.presets)[0]].segments.find((x) => x.id === segId)!
    d.takeover = { ...d.takeover, basisFront: cut(d.takeover.basisFront, ends.from, ends.to), target: cut(d.takeover.target, ends.from, ends.to) } // L kept as stored
  }
  return d
}

/** line-takeover transfer: target + L · (front now − basis front), per control point (anchor p, hIn, hOut) */
export function transfer(t: Takeover, frontNow: Record<string, Anchor>): Record<string, Anchor> {
  const m = t.L
  const apply = (q: V, a: V, b: V) => v(q.x + m[0] * (a.x - b.x) + m[2] * (a.y - b.y), q.y + m[1] * (a.x - b.x) + m[3] * (a.y - b.y))
  return Object.fromEntries(
    Object.entries(t.target).map(([id, T]) => {
      const F = frontNow[id]
      const B = t.basisFront[id]
      return [id, { id, p: apply(T.p, F.p, B.p), hIn: apply(T.hIn, F.hIn, B.hIn), hOut: apply(T.hOut, F.hOut, B.hOut) }]
    }),
  )
}

// ---------- fixture ----------
const A = (id: string, x: number, y: number, hi: V, ho: V): Anchor => ({ id, p: v(x, y), hIn: v(x + hi.x, y + hi.y), hOut: v(x + ho.x, y + ho.y) })
export function fixture(): Doc {
  const front = { a: A('a', -10, 0, v(0, 0), v(3, -4)), b: A('b', 0, -4, v(-5, 0), v(5, 0)), c: A('c', 10, 0, v(-3, -4), v(0, 0)) }
  // a second state whose handles do NOT just follow their anchors (independent handle change)
  const side = { a: A('a', -4, 1, v(0, 0), v(1.5, -3)), b: A('b', 1, -3.5, v(-2.5, 0.3), v(2, -0.4)), c: A('c', 5, 1.5, v(-1, -3.5), v(0, 0)) }
  const closed = { a: A('a', -10, 0, v(0, 0), v(3, 1)), b: A('b', 0, 2, v(-5, 0), v(5, 0)), c: A('c', 10, 0, v(-3, 1), v(0, 0)) }
  const curve = (k: number): Curve => {
    const sc = (rec: Record<string, Anchor>) => Object.fromEntries(Object.entries(rec).map(([id, a]) => [id, { id, p: v(a.p.x, a.p.y * k), hIn: v(a.hIn.x, a.hIn.y * k), hOut: v(a.hOut.x, a.hOut.y * k) }]))
    return { id: 'U', order: ['a', 'b', 'c'], segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }], states: { '0|open': sc(front), '90|open': sc(side), '0|closed': sc(closed) } }
  }
  return {
    presets: { A: curve(1), B: curve(1.3) },
    refs: { intervalStart: { segmentId: 's1', u: 0.3 }, intervalEnd: { segmentId: 's1', u: 0.85 }, lash: { segmentId: 's2', u: 0.5 } },
    fill: [{ segmentId: 's1', dir: 1 }, { segmentId: 's2', dir: 1 }],
    takeover: { state: '90|open', basisFront: structuredClone(curve(1).states['0|open']), target: structuredClone(curve(1).states['90|open']), L: [0.42, -0.07, 0.11, 0.9] },
    seq: 0,
  }
}
