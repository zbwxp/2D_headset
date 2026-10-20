// The x+ jawline as a path along a candidate loop's own edge order (dot 1792494616), shared by the diagnostics: from a
// jaw-angle point along the loop toward the chin (or the other way, flip) to the first x = 0 crossing (an optional
// marker); occlusion only splits the path into visible / hidden intervals (boundaries bisected), it never ends it.
import { MIN_LOOP, type Side, traceKey, weights } from '../src/contour'
import { type Head } from '../src/head'
import { type Model } from '../src/model'
import { type Loop, candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, type View, len, sub } from '../src/view'

const extent = (l: Loop) => Math.max(...[0, 1, 2].map(k => Math.max(...l.pts.map(q => q.p[k]!)) - Math.min(...l.pts.map(q => q.p[k]!))))

export interface JawPath { pts: V3[]; uv: { u: number; y: number }[]; hid: boolean[]; marker: V3 | undefined; intervals: { hidden: boolean; len: number; pts: V3[] }[]; loop: V3[]; maxStep: number; jawOff: number; jaw: V3; loopPts: number; closed: boolean }

/** the x+ jawline path at a view, from a jaw-angle point (head space) */
export function jawPath(head: Head, view: View, jawAt: V3, flip = false): JawPath | undefined {
  const loops = candidates(head, view).filter(l => extent(l) >= MIN_LOOP)
  let best = { l: -1, i: -1, d: Infinity }
  loops.forEach((l, li) => l.pts.forEach((q, i) => { const d = len(sub(q.p, jawAt)); if (d < best.d) best = { l: li, i, d } }))
  if (best.l < 0) return undefined
  const L = loops[best.l]!, n = L.pts.length
  // direction toward the chin: the one whose height falls over the first 0.05 R of arc
  const step = (dir: number) => { let s = 0, k = best.i; while (s < 0.05) { const j = k + dir; if (!L.closed && (j < 0 || j >= n)) break; const jj = (j + n) % n; s += len(sub(L.pts[jj]!.p, L.pts[k]!.p)); k = jj; if (k === best.i) break } return L.pts[k]!.y - L.pts[best.i]!.y }
  const dir = (step(1) < step(-1) ? 1 : -1) * (flip ? -1 : 1)
  const pts: V3[] = [L.pts[best.i]!.p], uv = [{ u: L.pts[best.i]!.u, y: L.pts[best.i]!.y }]
  let marker: V3 | undefined, k = best.i
  for (let s = 0; s < n - 1; s++) {
    let j = k + dir
    if (!L.closed && (j < 0 || j >= n)) break
    j = (j + n) % n
    const a = L.pts[k]!, b = L.pts[j]!
    if (a.p[0] > 0 && b.p[0] <= 0) { const t = a.p[0] / (a.p[0] - b.p[0]); marker = [0, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t]; pts.push(marker); uv.push({ u: a.u + (b.u - a.u) * t, y: a.y + (b.y - a.y) * t }); break }
    pts.push(b.p); uv.push({ u: b.u, y: b.y }); k = j
  }
  // visible / hidden intervals along the path (display only), boundaries bisected
  const occ = occluder(head, view), intervals: { hidden: boolean; len: number; pts: V3[] }[] = []
  const hidAt = pts.map((_, i) => hiddenOn(occ, pts[i]!, uv[i]!.u, uv[i]!.y)), hid = (i: number) => hidAt[i]!
  let state = hid(0)
  intervals.push({ hidden: state, len: 0, pts: [pts[0]!] })
  for (let i = 1; i < pts.length; i++) {
    const h = hid(i), seg = len(sub(pts[i]!, pts[i - 1]!))
    if (h === state) { const c = intervals[intervals.length - 1]!; c.len += seg; c.pts.push(pts[i]!); continue }
    const a = uv[i - 1]!, b = uv[i]!, du = b.u + 2 * Math.PI * Math.round((a.u - b.u) / (2 * Math.PI)) - a.u
    let lo = 0, hi = 1
    for (let q = 0; q < 10; q++) { const t = (lo + hi) / 2, u = a.u + du * t, y = a.y + (b.y - a.y) * t; if (hiddenOn(occ, head.at(u, y), u, y) === state) lo = t; else hi = t }
    const t = (lo + hi) / 2, cut = head.at(a.u + du * t, a.y + (b.y - a.y) * t), c = intervals[intervals.length - 1]!
    c.len += seg * t; c.pts.push(cut)
    state = h; intervals.push({ hidden: h, len: seg * (1 - t), pts: [cut, pts[i]!] })
  }
  let maxStep = 0
  for (let i = 1; i < pts.length; i++) maxStep = Math.max(maxStep, len(sub(pts[i]!, pts[i - 1]!)))
  return { pts, uv, hid: hidAt, marker, intervals, maxStep, jawOff: best.d, jaw: pts[0]!, loop: L.pts.map(q => q.p), loopPts: n, closed: L.closed }
}


/** a view's x+ jaw-angle point: the end of its own traced chin–jaw (a key: the table's; another view: a trace
 *  continuing the nearest key's anchors) */
export function jawOf(m: Model, v: View, key?: { yaw: number; pitch: number }): V3 | undefined {
  const head = m.head
  if (key) { const s = m.table.at(key.yaw, key.pitch).pos[0]!.samples, q = s[s.length - 1]!; return head.at(q.u, q.y) }
  const near = [...weights(Math.abs(v.yaw), v.pitch)].sort((a, b) => b.w - a.w)[0]!, k = m.table.at(near.yaw, near.pitch), ref: Partial<Record<Side, V3>> = {}
  for (const s of ['pos', 'neg'] as const) { const q = k[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
  const s = traceKey(head, v, ref).pos[0]
  if (!s) return undefined
  const q = s[s.length - 1]!; return head.at(q.u, q.y)
}
