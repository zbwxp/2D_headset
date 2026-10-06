// Point deletion experiment (headset-design doc 18 §19 items 4a / 4b). STANDALONE, full control points in
// every state of every preset. Two different commands, as Illustrator distinguishes them (dot 1791302010):
//
// 4a removeAnchorJoin — remove an interior anchor and keep the curve continuous: the two segments become one.
//    Default follows Inkscape 1.4 (official notes, dot): at a SHARP corner the neighbouring handles are kept;
//    only at a SMOOTH node are the handles adjusted to keep the shape (here: least squares on the two handle
//    lengths along the kept end tangents — the same idea as v103 fitWarpedCubic); variant 'straight' replaces
//    the part by a straight segment. Direct edit, no confirmation; per-state error REPORTED as information.
// 4b deleteAnchorWithSegments — delete the anchor and its adjacent segments: an interior anchor splits the
//    curve into two open chains, an end anchor shortens it (a closed curve is not handled in this experiment).
//
// Broken dependencies are refused with the dependant named (no dangling reference, no automatic patching):
// a connection on the anchor, a fill using only one of the two segments (4a) or any removed segment (4b),
// and (4b) a (segment, u) reference on a removed segment. Non-finite input is refused, not propagated.
import { v, type V } from './scenarioE'

export type Cubic = [V, V, V, V]
export type Anchor = { id: string; p: V; hIn: V; hOut: V }
export type Segment = { id: string; from: string; to: string }
export type Curve = { id: string; segments: Segment[]; states: Record<string, Record<string, Anchor>> }
export type Ref = { curveId: string; segmentId: string; u: number }
export type FillStep = { curveId: string; segmentId: string; dir: 1 | -1 }
export type End = { curveId: string; anchorId: string }
export type Doc = {
  presets: Record<string, Record<string, Curve>> // preset → curve id → curve (same structure in every preset)
  refs: Record<string, Ref>
  fills: Record<string, FillStep[]>
  connections: Record<string, End[]>
  seq: number
}
export type Result = { ok: true; doc: Doc; errors: Record<string, number>; refMoves: Record<string, number> } | { ok: false; reason: string }

const sub = (a: V, b: V) => v(a.x - b.x, a.y - b.y)
const len = (a: V) => Math.hypot(a.x, a.y)
export const bez = (q: Cubic, t: number): V => {
  const u = 1 - t
  return v(u * u * u * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t * t * t * q[3].x, u * u * u * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t * t * t * q[3].y)
}
export const segCubic = (c: Curve, st: string, segId: string): Cubic => {
  const s = c.segments.find((x) => x.id === segId)!
  const A = c.states[st][s.from]
  const B = c.states[st][s.to]
  return [A.p, A.hOut, B.hIn, B.p]
}
const N = 200
function arcTable(q: Cubic) {
  const pts = Array.from({ length: N + 1 }, (_, i) => bez(q, i / N))
  const acc = [0]
  for (let i = 1; i <= N; i++) acc.push(acc[i - 1] + len(sub(pts[i], pts[i - 1])))
  return { pts, acc, total: acc[N] }
}
const d1 = (q: Cubic, t: number): V => {
  const u = 1 - t
  return v(3 * (u * u * (q[1].x - q[0].x) + 2 * u * t * (q[2].x - q[1].x) + t * t * (q[3].x - q[2].x)), 3 * (u * u * (q[1].y - q[0].y) + 2 * u * t * (q[2].y - q[1].y) + t * t * (q[3].y - q[2].y)))
}
const d2 = (q: Cubic, t: number): V =>
  v(6 * ((1 - t) * (q[2].x - 2 * q[1].x + q[0].x) + t * (q[3].x - 2 * q[2].x + q[1].x)), 6 * ((1 - t) * (q[2].y - 2 * q[1].y + q[0].y) + t * (q[3].y - 2 * q[2].y + q[1].y)))
/** distance from p to the cubic: best of 100 samples, then Newton on (Q(t) − p) · Q'(t) = 0 */
export function distanceTo(q: Cubic, p: V): number {
  let t = 0
  let best = Infinity
  for (let i = 0; i <= 100; i++) {
    const dd = len(sub(bez(q, i / 100), p))
    if (dd < best) [best, t] = [dd, i / 100]
  }
  for (let k = 0; k < 8; k++) {
    const e = sub(bez(q, t), p), a = d1(q, t), b = d2(q, t)
    const den = a.x * a.x + a.y * a.y + e.x * b.x + e.y * b.y
    if (Math.abs(den) < 1e-14) break
    t = Math.min(1, Math.max(0, t - (e.x * a.x + e.y * a.y) / den))
  }
  return Math.min(best, len(sub(bez(q, t), p)))
}
/** max over samples of `from` of the distance to `to` (one-sided Hausdorff estimate) */
export function deviation(from: Cubic[], to: Cubic): number {
  let worst = 0
  for (const q of from) for (let i = 0; i <= 50; i++) worst = Math.max(worst, distanceTo(to, bez(q, i / 50)))
  return worst
}

/** is the node a sharp corner? (its two handles not collinear through it, or a handle collapsed) */
export function isCusp(m: Anchor, degrees = 5): boolean {
  const a = sub(m.p, m.hIn)
  const b = sub(m.hOut, m.p)
  if (len(a) < 1e-9 || len(b) < 1e-9) return true
  const cos = (a.x * b.x + a.y * b.y) / (len(a) * len(b))
  return Math.acos(Math.max(-1, Math.min(1, cos))) > (degrees * Math.PI) / 180
}

/** the one cubic for A → C replacing (A → M → C) in one state */
export function joinCubic(A: Anchor, M: Anchor, C: Anchor, mode: 'keepShape' | 'straight'): { hOut: V; hIn: V } {
  if (mode === 'straight') return { hOut: { ...A.p }, hIn: { ...C.p } }
  const keep = { hOut: { ...A.hOut }, hIn: { ...C.hIn } }
  if (isCusp(M)) return keep // sharp corner: keep the neighbouring handles
  // smooth: keep both end tangent DIRECTIONS and solve the two handle lengths by least squares against samples
  // of the two old segments. Mature method: Schneider, "An Algorithm for Automatically Fitting Digitized Curves"
  // (Graphics Gems, 1990) — chord-length parameters, then Newton re-parameterisation; Paper.js PathFitter uses it.
  const t1 = arcTable([A.p, A.hOut, M.hIn, M.p])
  const t2 = arcTable([M.p, M.hOut, C.hIn, C.p])
  const total = t1.total + t2.total
  const dA = sub(A.hOut, A.p)
  const dC = sub(C.hIn, C.p)
  if (len(dA) < 1e-12 || len(dC) < 1e-12 || total < 1e-12) return keep
  const nA = v(dA.x / len(dA), dA.y / len(dA))
  const nC = v(dC.x / len(dC), dC.y / len(dC))
  const pts = [...t1.pts, ...t2.pts.slice(1)]
  const ts = [...t1.acc.map((a) => a / total), ...t2.acc.slice(1).map((a) => (t1.total + a) / total)]
  let best = keep
  for (let iter = 0; iter < 8; iter++) {
    let s11 = 0, s12 = 0, s22 = 0, r1 = 0, r2 = 0
    pts.forEach((pt, i) => {
      const t = ts[i], u = 1 - t
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
      // pt ≈ (b0 + b1) A + b1 α nA + b2 β nC + (b2 + b3) C
      const rx = pt.x - ((b0 + b1) * A.p.x + (b2 + b3) * C.p.x)
      const ry = pt.y - ((b0 + b1) * A.p.y + (b2 + b3) * C.p.y)
      const ax = b1 * nA.x, ay = b1 * nA.y, cx = b2 * nC.x, cy = b2 * nC.y
      s11 += ax * ax + ay * ay; s12 += ax * cx + ay * cy; s22 += cx * cx + cy * cy
      r1 += ax * rx + ay * ry; r2 += cx * rx + cy * ry
    })
    const det = s11 * s22 - s12 * s12
    if (Math.abs(det) < 1e-12) break
    const alpha = (r1 * s22 - r2 * s12) / det
    const beta = (r2 * s11 - r1 * s12) / det
    if (!(alpha > 0) || !(beta > 0)) break // would reverse a tangent: keep what we have
    best = { hOut: v(A.p.x + alpha * nA.x, A.p.y + alpha * nA.y), hIn: v(C.p.x + beta * nC.x, C.p.y + beta * nC.y) }
    // Newton step per sample on f(t) = (Q(t) − P) · Q'(t)
    const q: Cubic = [A.p, best.hOut, best.hIn, C.p]
    for (let i = 1; i < pts.length - 1; i++) {
      const t = ts[i]
      const Q1 = d1(q, t), Q2 = d2(q, t)
      const e = sub(bez(q, t), pts[i])
      const den = Q1.x * Q1.x + Q1.y * Q1.y + e.x * Q2.x + e.y * Q2.y
      if (Math.abs(den) > 1e-12) ts[i] = Math.min(1, Math.max(0, t - (e.x * Q1.x + e.y * Q1.y) / den))
    }
  }
  return best
}

/** refusal text when the curve is missing or any control point anywhere (any preset, any state) is non-finite */
function invalid(doc: Doc, curveId: string, anchorId: string): string | null {
  for (const [pid, curves] of Object.entries(doc.presets)) {
    const c = curves[curveId]
    if (!c) return `curve ${curveId} missing in preset ${pid}`
    for (const [st, an] of Object.entries(c.states)) {
      if (!an[anchorId]) return `anchor ${curveId}#${anchorId} missing in ${pid}/${st}`
      for (const a of Object.values(an)) for (const q of [a.p, a.hIn, a.hOut]) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return `non-finite coordinate on ${curveId}#${a.id} in ${pid}/${st}`
    }
  }
  return null
}
const connectionOn = (doc: Doc, curveId: string, anchorId: string) =>
  Object.entries(doc.connections).find(([, ends]) => ends.some((e) => e.curveId === curveId && e.anchorId === anchorId))?.[0]
const first = <T>(r: Record<string, T>) => Object.values(r)[0]

export function removeAnchorJoin(doc: Doc, curveId: string, anchorId: string, mode: 'keepShape' | 'straight' = 'keepShape'): Result {
  const bad = invalid(doc, curveId, anchorId)
  if (bad) return { ok: false, reason: bad }
  const c0 = first(doc.presets)[curveId]
  const sIn = c0.segments.find((s) => s.to === anchorId)
  const sOut = c0.segments.find((s) => s.from === anchorId)
  if (!sIn || !sOut) return { ok: false, reason: `${anchorId} is an end node: use deleteAnchorWithSegments` }
  const conn = connectionOn(doc, curveId, anchorId)
  if (conn) return { ok: false, reason: `connection ${conn} uses ${curveId}#${anchorId}: unbind it first` }
  const pair = (st: FillStep) => st.curveId === curveId && (st.segmentId === sIn.id || st.segmentId === sOut.id)
  for (const [fid, steps] of Object.entries(doc.fills)) {
    const idx = steps.map((st, i) => (pair(st) ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    const adjacent = idx.length === 2 && (idx[1] - idx[0] === 1 || (idx[0] === 0 && idx[1] === steps.length - 1))
    if (!adjacent) return { ok: false, reason: `fill ${fid} uses only part of ${sIn.id} / ${sOut.id}: repair or remove the fill first` }
  }
  const d: Doc = structuredClone(doc)
  const newSeg = `${sIn.id}+${sOut.id}`
  const errors: Record<string, number> = {}
  const refMoves: Record<string, number> = {}
  for (const [pid, curves] of Object.entries(d.presets)) {
    const c = curves[curveId]
    for (const st of Object.keys(c.states)) {
      const A = c.states[st][sIn.from], M = c.states[st][anchorId], C = c.states[st][sOut.to]
      const old: Cubic[] = [[A.p, A.hOut, M.hIn, M.p], [M.p, M.hOut, C.hIn, C.p]]
      let j = joinCubic(A, M, C, mode)
      let err = deviation(old, [A.p, j.hOut, j.hIn, C.p])
      if (mode === 'keepShape' && !isCusp(M)) {
        // candidates, the smallest measured deviation wins: the least-squares fit (minimises the mean, not the worst
        // distance), the old handles, and the inverse of a de Casteljau split (exact when M came from one: the
        // split parameter is the ratio of M's handle lengths, the outer handles are scaled back by 1/u and 1/(1−u))
        const hi = len(sub(M.p, M.hIn)), ho = len(sub(M.hOut, M.p))
        const u = hi / (hi + ho)
        const cands = [
          { hOut: { ...A.hOut }, hIn: { ...C.hIn } },
          { hOut: v(A.p.x + (A.hOut.x - A.p.x) / u, A.p.y + (A.hOut.y - A.p.y) / u), hIn: v(C.p.x + (C.hIn.x - C.p.x) / (1 - u), C.p.y + (C.hIn.y - C.p.y) / (1 - u)) },
        ]
        for (const k of cands) {
          const e = deviation(old, [A.p, k.hOut, k.hIn, C.p])
          if (e < err) [j, err] = [k, e]
        }
      }
      errors[`${pid}/${st}`] = err // information only
      const states = { ...c.states[st], [sIn.from]: { ...A, hOut: j.hOut }, [sOut.to]: { ...C, hIn: j.hIn } }
      delete states[anchorId]
      c.states[st] = states
    }
    const i = c.segments.findIndex((s) => s.id === sIn.id)
    c.segments.splice(i, 2, { id: newSeg, from: sIn.from, to: sOut.to })
  }
  // references: one shared u per reference (as stored), mapped by arc-length fraction measured in the first
  // preset's first state; how far each moves there is reported, never hidden
  const st0 = Object.keys(c0.states)[0]
  const q1 = segCubic(c0, st0, sIn.id), q2 = segCubic(c0, st0, sOut.id)
  const t1 = arcTable(q1), t2 = arcTable(q2)
  const total = t1.total + t2.total
  for (const [k, r] of Object.entries(d.refs)) {
    if (r.curveId !== curveId || (r.segmentId !== sIn.id && r.segmentId !== sOut.id)) continue
    const onIn = r.segmentId === sIn.id
    const at = (onIn ? t1 : t2).acc[Math.round(r.u * N)]
    const u = total > 0 ? (onIn ? at : t1.total + at) / total : 0.5
    d.refs[k] = { curveId, segmentId: newSeg, u }
    refMoves[k] = len(sub(bez(segCubic(first(d.presets)[curveId], st0, newSeg), u), bez(onIn ? q1 : q2, r.u)))
  }
  for (const [fid, steps] of Object.entries(d.fills)) {
    const idx = steps.findIndex(pair)
    if (idx < 0) continue
    const kept = steps.filter((st) => !pair(st))
    // a wrap-around pair (first and last step) becomes the last step; the boundary loop is unchanged
    kept.splice(idx === 0 && !pair(steps[1]) ? kept.length : idx, 0, { curveId, segmentId: newSeg, dir: steps[idx].dir })
    d.fills[fid] = kept
  }
  return { ok: true, doc: d, errors, refMoves }
}

export function deleteAnchorWithSegments(doc: Doc, curveId: string, anchorId: string): Result {
  const bad = invalid(doc, curveId, anchorId)
  if (bad) return { ok: false, reason: bad }
  const c0 = first(doc.presets)[curveId]
  const sIn = c0.segments.find((s) => s.to === anchorId)
  const sOut = c0.segments.find((s) => s.from === anchorId)
  const removed = [sIn, sOut].filter((s): s is Segment => !!s).map((s) => s.id)
  const conn = connectionOn(doc, curveId, anchorId)
  if (conn) return { ok: false, reason: `connection ${conn} uses ${curveId}#${anchorId}: unbind it first` }
  const refs = Object.entries(doc.refs).filter(([, r]) => r.curveId === curveId && removed.includes(r.segmentId)).map(([k]) => k)
  if (refs.length) return { ok: false, reason: `reference ${refs.join(', ')} sits on a removed segment: move or remove it first` }
  const fills = Object.entries(doc.fills).filter(([, st]) => st.some((x) => x.curveId === curveId && removed.includes(x.segmentId))).map(([k]) => k)
  if (fills.length) return { ok: false, reason: `fill ${fills.join(', ')} uses a removed segment: repair or remove it first` }
  const split = (segs: Segment[]) => {
    const i = segs.findIndex((s) => s.id === removed[0])
    return [segs.slice(0, i), segs.slice(i + removed.length)].filter((p) => p.length)
  }
  const parts0 = split(c0.segments)
  if (parts0.length === 0) return { ok: false, reason: `deleting ${anchorId} would leave ${curveId} without segments: delete the curve instead` }
  // a connection on an anchor that loses all its segments would dangle
  const kept0 = new Set(parts0.flat().flatMap((s) => [s.from, s.to]))
  const orphan = Object.entries(doc.connections).find(([, ends]) => ends.some((e) => e.curveId === curveId && !kept0.has(e.anchorId)))
  if (orphan) return { ok: false, reason: `connection ${orphan[0]} uses an anchor of ${curveId} that would be left without segments: unbind it first` }
  const d: Doc = structuredClone(doc)
  const newId = parts0.length === 2 ? `${curveId}~${++d.seq}` : ''
  for (const curves of Object.values(d.presets)) {
    const c = curves[curveId]
    const parts = split(c.segments)
    const pick = (segs: Segment[]) => {
      const set = new Set(segs.flatMap((s) => [s.from, s.to]))
      return Object.fromEntries(Object.entries(c.states).map(([st, an]) => [st, Object.fromEntries(Object.entries(an).filter(([id]) => set.has(id)))]))
    }
    curves[curveId] = { id: curveId, segments: parts[0], states: pick(parts[0]) } // the first remaining part keeps the id
    if (newId) curves[newId] = { id: newId, segments: parts[1], states: pick(parts[1]) }
  }
  if (newId) {
    const segs = new Set(parts0[1].map((s) => s.id))
    const anchors = new Set(parts0[1].flatMap((s) => [s.from, s.to]))
    for (const r of Object.values(d.refs)) if (r.curveId === curveId && segs.has(r.segmentId)) r.curveId = newId
    for (const steps of Object.values(d.fills)) for (const st of steps) if (st.curveId === curveId && segs.has(st.segmentId)) st.curveId = newId
    for (const ends of Object.values(d.connections)) for (const e of ends) if (e.curveId === curveId && anchors.has(e.anchorId)) e.curveId = newId
  }
  return { ok: true, doc: d, errors: {}, refMoves: {} }
}

export class Session {
  private past: Doc[] = []
  private future: Doc[] = []
  constructor(public doc: Doc) {}
  apply(r: Result): boolean {
    if (!r.ok) return false
    this.past.push(this.doc)
    this.future = []
    this.doc = r.doc
    return true
  }
  undo() {
    const p = this.past.pop()
    if (!p) return false
    this.future.push(this.doc)
    this.doc = p
    return true
  }
  redo() {
    const f = this.future.pop()
    if (!f) return false
    this.past.push(this.doc)
    this.doc = f
    return true
  }
}

// ---------- fixture: one open curve a → b → c → d → e, two presets × three states ----------
const A = (id: string, x: number, y: number, hi: V, ho: V): Anchor => ({ id, p: v(x, y), hIn: v(x + hi.x, y + hi.y), hOut: v(x + ho.x, y + ho.y) })
export function fixture(): Doc {
  // b is SMOOTH (collinear handles), c is a SHARP corner, d is smooth
  const front = { a: A('a', -20, 0, v(0, 0), v(3, -5)), b: A('b', -10, -6, v(-4, 0), v(4, 0)), c: A('c', 0, -2, v(-3, -2), v(3, -3)), d: A('d', 10, -6, v(-4, 0), v(4, 0)), e: A('e', 20, 0, v(-3, -5), v(0, 0)) }
  // a turned state whose handles change on their own (not a uniform transform of the front)
  const side = { a: A('a', -8, 1, v(0, 0), v(1, -4)), b: A('b', -3, -5, v(-2, -0.4), v(2.5, 0.5)), c: A('c', 2, -1.5, v(-1, -2), v(1.5, -2.5)), d: A('d', 6, -4.5, v(-1.5, 0.3), v(1.5, -0.3)), e: A('e', 10, 1, v(-1, -4), v(0, 0)) }
  const closed = { a: A('a', -20, 0, v(0, 0), v(3, 1)), b: A('b', -10, 1.5, v(-4, 0), v(4, 0)), c: A('c', 0, 2, v(-3, 0.5), v(3, -0.6)), d: A('d', 10, 1.5, v(-4, 0), v(4, 0)), e: A('e', 20, 0, v(-3, 1), v(0, 0)) }
  const curve = (k: number): Curve => {
    const sc = (rec: Record<string, Anchor>) => Object.fromEntries(Object.entries(rec).map(([id, a]) => [id, { id, p: v(a.p.x, a.p.y * k), hIn: v(a.hIn.x, a.hIn.y * k), hOut: v(a.hOut.x, a.hOut.y * k) }]))
    return {
      id: 'U',
      segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'e' }],
      states: { '0|open': sc(front), '90|open': sc(side), '0|closed': sc(closed) },
    }
  }
  return {
    presets: { A: { U: curve(1) }, B: { U: curve(1.4) } },
    refs: { intervalStart: { curveId: 'U', segmentId: 's1', u: 0.4 }, lash: { curveId: 'U', segmentId: 's2', u: 0.5 }, intervalEnd: { curveId: 'U', segmentId: 's4', u: 0.7 } },
    fills: {},
    connections: {},
    seq: 0,
  }
}
