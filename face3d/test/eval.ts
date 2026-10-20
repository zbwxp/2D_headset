// Evaluation of the mixed contour at a view (dot 1792493683), three measures reported apart, nothing mixed together:
//   fit        — geometric: each SHOWN mixed sample's on-screen distance to the full visible outline (all candidate
//                loops, uncut), with the nearest run and the side it lies on;
//   semantic   — the designated side's chin–jaw stretch: shown samples whose nearest visible outline is on the other
//                side; visible outline of that side in the chin–jaw band left uncovered; the same stretch drawn by both
//                sides;
//   visibility — the drawn opacity (mixed vis) against a depth test of the mixed point at this view, both ways.
// Visible / hidden runs are split where the state changes by bisecting the edge (8 steps in (u, y)), not by giving
// the whole crossing edge the old state.
import { type ContourLine, type Side, mixContour } from '../src/contour'
import { type Head } from '../src/head'
import { type Model } from '../src/model'
import { type Grid, GRID, candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, type View, rotate } from '../src/view'

export type P2 = [number, number]
export interface Run { pts: P2[]; heads: V3[]; hidden: boolean; loop: number }

const segDist = (p: P2, a: P2, b: P2) => { const ab: P2 = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); return { d: Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t), t } }

/** The outline at a view as visible / hidden runs, boundaries bisected. */
export function outlineRuns(head: Head, view: View, grid: Grid = GRID, occGrid?: Grid): Run[] {
  const occ = occluder(head, view, occGrid), P = (p: V3): P2 => { const r = rotate(p, view); return [r[0], r[1]] }
  const runs: Run[] = []
  candidates(head, view, grid).forEach((l, li) => {
    const pts = l.closed ? [...l.pts, l.pts[0]!] : l.pts
    const h = pts.map(q => hiddenOn(occ, q.p, q.u, q.y))
    let cur: Run = { pts: [P(pts[0]!.p)], heads: [pts[0]!.p], hidden: h[0]!, loop: li }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!
      if (h[i] !== h[i - 1]) {
        // bisect in (u, y) along the edge (u unwrapped) for the place the state changes
        const du = b.u + 2 * Math.PI * Math.round((a.u - b.u) / (2 * Math.PI)) - a.u
        let lo = 0, hi = 1
        for (let k = 0; k < 8; k++) { const t = (lo + hi) / 2, u = a.u + du * t, y = a.y + (b.y - a.y) * t; if (hiddenOn(occ, head.at(u, y), u, y) === h[i - 1]) lo = t; else hi = t }
        const t = (lo + hi) / 2, u = a.u + du * t, y = a.y + (b.y - a.y) * t, m = head.at(u, y)
        cur.pts.push(P(m)); cur.heads.push(m)
        if (cur.pts.length > 1) runs.push(cur)
        cur = { pts: [P(m)], heads: [m], hidden: h[i]!, loop: li }
      }
      cur.pts.push(P(b.p)); cur.heads.push(b.p)
    }
    if (cur.pts.length > 1) runs.push(cur)
  })
  return runs
}

/** nearest point on the visible runs: distance, the run, and the head-space point there */
export function nearestVisible(p: P2, runs: Run[]): { d: number; run: number; at: V3 } {
  let best = { d: Infinity, run: -1, at: [0, 0, 0] as V3 }
  runs.forEach((r, ri) => {
    if (r.hidden) return
    for (let j = 0; j + 1 < r.pts.length; j++) {
      const s = segDist(p, r.pts[j]!, r.pts[j + 1]!)
      if (s.d < best.d) { const a = r.heads[j]!, b = r.heads[j + 1]!; best = { d: s.d, run: ri, at: [a[0] + (b[0] - a[0]) * s.t, a[1] + (b[1] - a[1]) * s.t, a[2] + (b[2] - a[2]) * s.t] } }
    }
  })
  return best
}

export const NEAR = 0.02, SIDE_X = 0.02, JAW_Y = -0.95
export interface SideEval {
  side: Side
  fit: { max: number; worst: number; run: number; runSide: string }
  /** uncovered / shared: arc length on screen (R) of the side's visible chin–jaw outline */
  semantic: { otherSide: number; uncovered: number; sharedWithOther: number }
  /** shownButHidden: count, and the largest distance of those samples from the visible outline (grazing vs truly behind) */
  visibility: { shownButHidden: number; shownButHiddenFar: number; hiddenButShownOnOutline: number }
}

export function evalView(m: Model, view: View, grid: Grid = GRID): { runs: Run[]; sides: SideEval[] } {
  const head = m.head, runs = outlineRuns(head, view, grid), occ = occluder(head, view)
  const P = (p: V3): P2 => { const r = rotate(p, view); return [r[0], r[1]] }
  const lines = mixContour(head, m.table, view)
  const sideOf = (x: number) => (x > SIDE_X ? 'pos' : x < -SIDE_X ? 'neg' : 'mid')
  const jawIdx = 13 // samples 0 … 12 are the chin–jaw segment
  const sides = lines.map((line: ContourLine): SideEval => {
    const shown = line.pts.map((_, i) => line.vis[i]! >= 0.5)
    // fit, over every shown sample of the line
    let fit = { max: 0, worst: -1, run: -1, runSide: '' }
    line.pts.forEach((p, i) => { if (!shown[i]) return; const n = nearestVisible(P(p), runs); if (n.d > fit.max) fit = { max: n.d, worst: i, run: n.run, runSide: sideOf(n.at[0]) } })
    // semantic, the chin–jaw stretch only
    const want = line.side
    let otherSide = 0
    for (let i = 0; i < jawIdx; i++) if (shown[i]) { const n = nearestVisible(P(line.pts[i]!), runs); const s = sideOf(n.at[0]); if (n.d <= NEAR && s !== want && s !== 'mid') otherSide++ }
    const mine = line.pts.slice(0, jawIdx).filter((_, i) => shown[i]).map(P)
    const other = lines.find(l => l.side !== line.side)!, theirs = other.pts.slice(0, jawIdx).filter((_, i) => other.vis[i]! >= 0.5).map(P)
    let uncovered = 0, sharedWithOther = 0
    for (const r of runs) {
      if (r.hidden) continue
      for (let k = 0; k + 1 < r.pts.length; k++) {
        // each visible outline edge in the side's chin–jaw band, judged at its middle, counted by its length
        const h: V3 = [(r.heads[k]![0] + r.heads[k + 1]![0]) / 2, (r.heads[k]![1] + r.heads[k + 1]![1]) / 2, 0]
        if (h[1] > JAW_Y || sideOf(h[0]) !== want) continue
        const a = r.pts[k]!, b = r.pts[k + 1]!, q: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1])
        const dm = Math.min(...mine.map(x => Math.hypot(x[0] - q[0], x[1] - q[1])), Infinity)
        if (dm > NEAR) uncovered += L
        else if (Math.min(...theirs.map(x => Math.hypot(x[0] - q[0], x[1] - q[1])), Infinity) <= NEAR) sharedWithOther += L
      }
    }
    // visibility: drawn opacity vs a depth test of the mixed point at this view (offsets are zero here, so the mixed
    // point is the surface point at its (u, y))
    let shownButHidden = 0, shownButHiddenFar = 0, hiddenButShownOnOutline = 0
    line.pts.forEach((p, i) => {
      const uv = line.uv[i]!, depthHidden = hiddenOn(occ, head.at(uv.u, uv.y), uv.u, uv.y)
      if (shown[i] && depthHidden) { shownButHidden++; shownButHiddenFar = Math.max(shownButHiddenFar, nearestVisible(P(p), runs).d) }
      if (!shown[i] && !depthHidden && nearestVisible(P(p), runs).d <= NEAR) hiddenButShownOnOutline++
    })
    return { side: line.side, fit, semantic: { otherSide, uncovered, sharedWithOther }, visibility: { shownButHidden, shownButHiddenFar, hiddenButShownOnOutline } }
  })
  return { runs, sides }
}

// ---- drawn edges and depth gating (dot 1792493982) -----------------------------------------------------------------
// The drawing shows edge i–i+1 of a mixed line with opacity min(vis_i, vis_i+1) (viewer/main.ts); an edge is drawn
// when that is > 0. Gating: at the current view, the parts of a drawn edge whose surface points are depth-hidden are
// not drawn; the opacity of what remains is unchanged (vis stays the semantic opacity). An edge is split where the
// state changes (bisection along it in (u, y)), never dropped whole.
export interface Piece { a: P2; b: P2; alpha: number; hidden: boolean; side: Side; seg: number }
const SUB = 16
export function drawnPieces(m: Model, view: View, occGrid?: Grid): Piece[] {
  const head = m.head, occ = occluder(head, view, occGrid), P = (p: V3): P2 => { const r = rotate(p, view); return [r[0], r[1]] }
  const out: Piece[] = []
  for (const line of mixContour(head, m.table, view)) for (let i = 0; i + 1 < line.pts.length; i++) {
    const alpha = Math.min(line.vis[i]!, line.vis[i + 1]!)
    if (!(alpha > 0)) continue
    const seg = i < 12 ? 0 : i < 22 ? 1 : 2
    const ua = line.uv[i]!, ub = line.uv[i + 1]!, du = ub.u + 2 * Math.PI * Math.round((ua.u - ub.u) / (2 * Math.PI)) - ua.u
    const A = line.pts[i]!, B = line.pts[i + 1]!
    // the drawn chord's point at t, and the surface point the depth test uses at t
    const chord = (t: number): V3 => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]
    const hid = (t: number) => { const u = ua.u + du * t, y = ua.y + (ub.y - ua.y) * t; return hiddenOn(occ, head.at(u, y), u, y) }
    let t0 = 0, h0 = hid(0)
    for (let k = 1; k <= SUB; k++) {
      const t1 = k / SUB, h1 = hid(t1)
      if (h1 !== h0) {
        let lo = (k - 1) / SUB, hi = t1
        for (let n = 0; n < 10; n++) { const mid = (lo + hi) / 2; if (hid(mid) === h0) lo = mid; else hi = mid }
        const tb = (lo + hi) / 2
        out.push({ a: P(chord(t0)), b: P(chord(tb)), alpha, hidden: h0, side: line.side, seg })
        t0 = tb; h0 = h1
      }
    }
    out.push({ a: P(chord(t0)), b: P(chord(1)), alpha, hidden: h0, side: line.side, seg })
  }
  return out
}
const plen = (p: Piece) => Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1])
/** distance from point q to a set of pieces (segments) */
const toPieces = (q: P2, ps: Piece[]) => { let m = Infinity; for (const p of ps) m = Math.min(m, segDist(q, p.a, p.b).d); return m }

export interface GateReport {
  side: Side
  /** hiddenLen: depth-hidden length; hiddenFarLen: of that, the part more than NEAR from the visible outline */
  drawn: { len: number; hiddenLen: number; hiddenFarLen: number; maxOffVisible: number }
  gated: { len: number; hiddenLen: number; hiddenFarLen: number; maxOffVisible: number }
  /** visible outline the ungated drawing covered (within NEAR), and how much of it the gated drawing still covers */
  coveredBefore: number; coveredAfter: number; gapFromGating: number
}
/** Before / after gating, per side: drawn length, drawn-but-hidden length, fit to the visible outline, coverage.
 *  rule 'depth': drop every depth-hidden piece; rule 'depth-far' (a variant for comparison): drop a depth-hidden piece
 *  only when it is also more than NEAR from the visible outline (a piece grazing the outline is kept). */
export function gateReport(m: Model, view: View, occGrid?: Grid, rule: 'depth' | 'depth-far' = 'depth'): GateReport[] {
  const runs = outlineRuns(m.head, view, GRID, occGrid), pieces = drawnPieces(m, view, occGrid)
  const far = (p: Piece) => nearestVisible([(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2], runs).d > NEAR
  return (['pos', 'neg'] as const).map(side => {
    const before = pieces.filter(p => p.side === side), after = before.filter(p => !p.hidden || (rule === 'depth-far' && !far(p)))
    const stats = (ps: Piece[]) => ({
      len: ps.reduce((a, p) => a + plen(p), 0),
      hiddenLen: ps.filter(p => p.hidden).reduce((a, p) => a + plen(p), 0),
      hiddenFarLen: ps.filter(p => p.hidden && far(p)).reduce((a, p) => a + plen(p), 0),
      maxOffVisible: ps.length ? Math.max(...ps.flatMap(p => [p.a, p.b, [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2] as P2].map(q => nearestVisible(q, runs).d))) : NaN,
    })
    let coveredBefore = 0, coveredAfter = 0
    for (const r of runs) {
      if (r.hidden) continue
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const a = r.pts[k]!, b = r.pts[k + 1]!, q: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (toPieces(q, before) <= NEAR) { coveredBefore += L; if (toPieces(q, after) <= NEAR) coveredAfter += L }
      }
    }
    return { side, drawn: stats(before), gated: stats(after), coveredBefore, coveredAfter, gapFromGating: coveredBefore - coveredAfter }
  })
}
