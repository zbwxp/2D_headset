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
export function outlineRuns(head: Head, view: View, grid: Grid = GRID): Run[] {
  const occ = occluder(head, view), P = (p: V3): P2 => { const r = rotate(p, view); return [r[0], r[1]] }
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
