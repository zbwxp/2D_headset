// Diagnostic (dot 1792492800 / 1792493265): yaw 45 / pitch 15 and 75 / 15, x+ side.
// (1) The chin–jaw polyline of the mix against the view's own traced chin–jaw polyline: two-way POINT-TO-SEGMENT
//     distance on screen, the worst point in each direction and the nearest segment it falls to.
// (2) A picture per view: the view's own trace (black), the mix (red), and the four contributing keys' chosen paths
//     (their three segments, start ●, end ■, anchors ▲) projected into this view — to tell sampling deviation, start
//     mismatch and a wrong path apart. Loop numbers, candidate ranks and walk directions are per-view labels and say
//     nothing about branch identity across views (dot), so they are not used here.
// Prints / draws only (F3D_DIAG=1, F3D_DIAG_DIR for the pictures).
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { COUNTS, PITCH_KEYS, type Side, YAW_KEYS, mixContour, traceKey, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { type V3, rotate } from '../src/view'

type P2 = [number, number]
const segDist = (p: P2, a: P2, b: P2) => { const ab: P2 = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t) }
/** worst distance from the points of A to polyline B: value, which point of A, which segment of B */
const worstTo = (A: P2[], B: P2[]) => { let best = { d: -1, i: -1, seg: -1 }; A.forEach((p, i) => { let m = Infinity, sj = -1; for (let j = 0; j + 1 < B.length; j++) { const d = segDist(p, B[j]!, B[j + 1]!); if (d < m) { m = d; sj = j } } if (m > best.d) best = { d: m, i, seg: sj } }); return best }

it.skipIf(!process.env.F3D_DIAG)('45,15 and 75,15: two-way point-to-segment distance, keys\' chosen paths overlaid', () => {
  const m = makeModel(), head = m.head, side: Side = 'pos', dir = process.env.F3D_DIAG_DIR
  // the keys exactly as the table holds them (their chosen paths are their three segments' samples)
  const anchorOf = (yaw: number, pitch: number) => { const k = m.table.at(yaw, pitch), o: Partial<Record<Side, V3>> = {}; for (const s of ['pos', 'neg'] as const) { const q = k[s][0]!.samples[0]!; o[s] = head.at(q.u, q.y) } return o }
  void PITCH_KEYS; void YAW_KEYS
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) {
    const W = weights(v.yaw, v.pitch), near = [...W].sort((a, b) => b.w - a.w)[0]!
    const tr = traceKey(head, v, anchorOf(near.yaw, near.pitch))
    const P = (p: V3): P2 => { const r = rotate(p, v); return [r[0], r[1]] }
    const target = (tr[side][0] ?? []).map(q => P(head.at(q.u, q.y)))
    const mixed = mixContour(head, m.table, v).find(l => l.side === side)!.pts.slice(0, COUNTS[0]).map(P)
    const a = worstTo(mixed, target), b = worstTo(target, mixed)
    console.log(`view ${v.yaw},${v.pitch}: mixed → target worst ${a.d.toFixed(3)} R at mixed #${a.i} (nearest target segment ${a.seg}–${a.seg + 1}); target → mixed worst ${b.d.toFixed(3)} R at target #${b.i} (nearest mixed segment ${b.seg}–${b.seg + 1})`)
    if (!dir) continue
    const S = 420, c = target.length ? target[Math.floor(target.length / 2)]! : [0, 0], X = (p: P2) => `${(450 + (p[0] - c[0]) * S).toFixed(1)},${(470 - (p[1] - c[1]) * S).toFixed(1)}`
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
    svg += `<text x="10" y="20" font-size="14">yaw ${v.yaw} · 仰视 ${v.pitch}，x+ 侧，投影到本视角：黑 = 本视角描出的下巴–颌角段；红 = mix；彩色 = 四个关键视角实际选中的路径（● 起点、▲ 锚点、■ 终点）</text>`
    svg += `<text x="10" y="40" font-size="13">mix→本视角最坏 ${a.d.toFixed(3)}R（mix #${a.i}）；本视角→mix 最坏 ${b.d.toFixed(3)}R（本视角 #${b.i}）。紫色连线 = 最坏点到它最近的线段</text>`
    const kc = ['#1e88e5', '#43a047', '#8e24aa', '#fb8c00']
    W.forEach((w, n) => {
      const k = m.table.at(w.yaw, w.pitch)[side], pts = k.flatMap((sg, i) => (i === 0 ? sg.samples : sg.samples.slice(1)).map(q => P(head.at(q.u, q.y))))
      svg += `<polyline fill="none" stroke="${kc[n]}" stroke-width="1.5" opacity="0.8" points="${pts.map(X).join(' ')}"/>`
      const [sx, sy] = X(pts[0]!).split(','), [ex, ey] = X(pts[pts.length - 1]!).split(',')
      svg += `<circle cx="${sx}" cy="${sy}" r="6" fill="${kc[n]}"/><rect x="${+ex! - 5}" y="${+ey! - 5}" width="10" height="10" fill="${kc[n]}"/>`
      for (const ai of [COUNTS[0] - 1, COUNTS[0] + COUNTS[1] - 2]) { const [x, y] = X(pts[ai]!).split(','); svg += `<path d="M${+x!} ${+y! - 7} L${+x! - 6} ${+y! + 5} L${+x! + 6} ${+y! + 5} Z" fill="${kc[n]}"/>` }
      svg += `<text x="10" y="${70 + n * 18}" font-size="13" fill="${kc[n]}">key ${w.yaw},${w.pitch}（权重 ${w.w.toFixed(2)}）${k[0]!.present ? '' : '，下巴段缺席'}</text>`
    })
    svg += `<polyline fill="none" stroke="#000" stroke-width="3" points="${target.map(X).join(' ')}"/><polyline fill="none" stroke="#d32f2f" stroke-width="2.5" points="${mixed.map(X).join(' ')}"/>`
    const link = (p: P2, A: P2, B: P2) => { const ab: P2 = [B[0] - A[0], B[1] - A[1]], t = Math.max(0, Math.min(1, ((p[0] - A[0]) * ab[0] + (p[1] - A[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); return `<polyline fill="none" stroke="#9c27b0" stroke-width="2" stroke-dasharray="4 3" points="${X(p)} ${X([A[0] + ab[0] * t, A[1] + ab[1] * t])}"/>` }
    if (a.seg >= 0) svg += link(mixed[a.i]!, target[a.seg]!, target[a.seg + 1]!)
    if (b.seg >= 0) svg += link(target[b.i]!, mixed[b.seg]!, mixed[b.seg + 1]!)
    writeFileSync(`${dir}/diag-two-views-${v.yaw}-${v.pitch}.svg`, svg + '</svg>')
  }
})
