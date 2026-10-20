// Diagnostic (dot 1792494232), 45,15 and 75,15 only: what jawline each view should express, and which interval of each
// contributing key's chin–jaw segment corresponds to it. PROPOSED definition, for review (not settled): the x+ jawline
// at a view is the VISIBLE outline from the x+ jaw-angle point along the outline toward the chin until it crosses the
// head's mid plane x = 0; if the visible outline ends first, the path ends there and that is marked. The jaw-angle
// point: the outline point nearest the end of that view's own traced chin–jaw segment (the y = −0.95 / spread anchor).
// For every key the same definition is applied at the key's own view, and its actual chin–jaw segment is compared
// with it: which samples lie on the intended path, which lie beyond the mid plane (the other side), which lie off it.
// Also drawn: the x− mixed line at 45,15, whose faded part runs inside the face (0.237 R from any visible outline).
// Prints / draws only (F3D_DIAG=1, F3D_DIAG_DIR).
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { type Side, mixContour, traceKey, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { type V3, type View, rotate } from '../src/view'
import { type P2, type Run, outlineRuns } from './eval'

const NEAR = 0.02
const m = makeModel(), head = m.head
const P = (v: View) => (p: V3): P2 => { const r = rotate(p, v); return [r[0], r[1]] }

/** the intended x+ jawline at a view, given the jaw-angle point (head space): along the visible run through it */
function intended(v: View, runs: Run[], jaw: V3): { path: V3[]; end: 'mid plane' | 'visibility ends' | 'run ends'; startOff: number } {
  const p = P(v)(jaw)
  let best = { r: -1, k: -1, d: Infinity }
  runs.forEach((r, ri) => { if (r.hidden) return; r.pts.forEach((q, k) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best.d) best = { r: ri, k, d } }) })
  if (best.r < 0) return { path: [], end: 'run ends', startOff: Infinity }
  const r = runs[best.r]!
  // walk toward the chin: the direction in which y goes down
  const dir = (r.heads[Math.min(best.k + 3, r.heads.length - 1)]![1] < r.heads[Math.max(best.k - 3, 0)]![1]) ? 1 : -1
  const path: V3[] = [r.heads[best.k]!]
  for (let k = best.k + dir; k >= 0 && k < r.heads.length; k += dir) {
    const a = path[path.length - 1]!, b = r.heads[k]!
    if (a[0] > 0 && b[0] <= 0) { const t = a[0] / (a[0] - b[0]); path.push([0, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); return { path, end: 'mid plane', startOff: best.d } }
    path.push(b)
  }
  // the visible run ended before the mid plane: is the next point hidden (visibility ends) or the loop's end?
  return { path, end: 'visibility ends', startOff: best.d }
}

/** compare a chin–jaw segment (head points) with an intended path at view v: per sample on / beyond mid plane / off */
function compare(v: View, seg: V3[], path: V3[]) {
  const pp = path.map(P(v))
  const dist = (q: P2) => { let mm = Infinity; for (let j = 0; j + 1 < pp.length; j++) { const a = pp[j]!, b = pp[j + 1]!, ab: P2 = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); mm = Math.min(mm, Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t)) } return mm }
  return seg.map(h => (h[0] < -NEAR ? 'x' : dist(P(v)(h)) <= NEAR ? 'o' : '·')) // o on the path, x beyond the mid plane, · off
}

it.skipIf(!process.env.F3D_DIAG)('intended x+ jawline and the keys\' corresponding intervals, 45,15 and 75,15', () => {
  const dir = process.env.F3D_DIAG_DIR, out: string[] = []
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  svg += `<text x="10" y="20" font-size="14">每格在各自视角下：灰 = 可见轮廓（细虚 = 被挡）；绿粗 = 按定义要表达的 x+ 颌线（颌角点 ▲ → 正中面 ●，或可见性提前结束 ✕）；红点 = 该视角下巴–颌角段的样点（o 在路径上、x 越过正中面、· 偏离）</text>`
  ;[{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }].forEach((v, row) => {
    const W = weights(v.yaw, v.pitch), views: { label: string; view: View; seg: V3[] }[] = []
    const near = [...W].sort((a, b) => b.w - a.w)[0]!, nk = m.table.at(near.yaw, near.pitch), ref: Partial<Record<Side, V3>> = {}
    for (const s of ['pos', 'neg'] as const) { const q = nk[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
    const tr = traceKey(head, v, ref)
    views.push({ label: `本视角 ${v.yaw},${v.pitch}（mix）`, view: v, seg: mixContour(head, m.table, v).find(l => l.side === 'pos')!.pts.slice(0, 13) })
    for (const w of W) views.push({ label: `key ${w.yaw},${w.pitch}（w ${w.w.toFixed(2)}）`, view: { yaw: w.yaw, pitch: w.pitch }, seg: m.table.at(w.yaw, w.pitch).pos[0]!.samples.map(q => head.at(q.u, q.y)) })
    views.forEach((x, col) => {
      const runs = outlineRuns(head, x.view)
      // the jaw-angle point: the end of the view's own chin–jaw (for the mix view: of its own trace)
      const jawEnd = col === 0 ? (() => { const s = tr.pos[0]; return s ? head.at(s[s.length - 1]!.u, s[s.length - 1]!.y) : x.seg[x.seg.length - 1]! })() : x.seg[x.seg.length - 1]!
      const it = intended(x.view, runs, jawEnd), marks = compare(x.view, x.seg, it.path)
      out.push(`${row === 0 ? '45,15' : '75,15'} | ${x.label}: intended path ${it.path.length} pts, ends at ${it.end}${it.startOff > NEAR ? ` (jaw point ${it.startOff.toFixed(3)} R from the visible outline)` : ''}; chin–jaw samples ${marks.join('')} (start ${marks[0]}, end ${marks[marks.length - 1]})`)
      // panel
      const ox = col * 300, oy = 60 + row * 700, Q = P(x.view), c = Q(jawEnd), S = 300, X = (p: P2) => `${(ox + 150 + (p[0] - c[0]) * S).toFixed(1)},${(oy + 200 - (p[1] - c[1]) * S).toFixed(1)}`
      const ph = row === 0 ? 300 : 640
      svg += `<svg x="${ox}" y="${oy}" width="300" height="${ph}" viewBox="${ox} ${oy} 300 ${ph}" overflow="hidden"><rect x="${ox + 2}" y="${oy}" width="296" height="${ph}" fill="white" stroke="#eee"/><text x="${ox + 8}" y="${oy + 16}" font-size="12">${x.label}</text>`
      for (const r of runs) svg += `<polyline fill="none" stroke="${r.hidden ? '#ccc' : '#888'}" stroke-width="${r.hidden ? 1 : 1.5}" ${r.hidden ? 'stroke-dasharray="3 3"' : ''} points="${r.pts.map(X).join(' ')}"/>`
      if (it.path.length > 1) {
        svg += `<polyline fill="none" stroke="#2e7d32" stroke-width="4" opacity="0.7" points="${it.path.map(Q).map(X).join(' ')}"/>`
        const [sx, sy] = X(Q(it.path[0]!)).split(','), [ex, ey] = X(Q(it.path[it.path.length - 1]!)).split(',')
        svg += `<path d="M${+sx!} ${+sy! - 8} L${+sx! - 7} ${+sy! + 6} L${+sx! + 7} ${+sy! + 6} Z" fill="#2e7d32"/>`
        svg += it.end === 'mid plane' ? `<circle cx="${ex}" cy="${ey}" r="6" fill="#2e7d32"/>` : `<text x="${+ex! - 6}" y="${+ey! + 6}" font-size="18" fill="#2e7d32">✕</text>`
      }
      x.seg.forEach((h, i) => { const [hx, hy] = X(Q(h)).split(','); svg += `<circle cx="${hx}" cy="${hy}" r="3" fill="${marks[i] === 'o' ? '#d32f2f' : 'white'}" stroke="#d32f2f"/>${i === 0 ? `<text x="${+hx! + 4}" y="${+hy! + 12}" font-size="10" fill="#d32f2f">起点</text>` : ''}` })
      svg += '</svg>'
    })
    // 45,15: the x− mixed line with its opacity, in a panel of its own below the row (centred on the line), with the
    // visible outline and each sample's opacity and distance from it
    if (row === 0) {
      const neg = mixContour(head, m.table, v).find(l => l.side === 'neg')!, runs = outlineRuns(head, v), Q = P(v)
      const ox = 0, oy = 380, c = Q(neg.pts[Math.floor(neg.pts.length / 2)]!), S = 160, X = (p: P2) => `${(ox + 750 + (p[0] - c[0]) * S).toFixed(1)},${(oy + 150 - (p[1] - c[1]) * S).toFixed(1)}`
      svg += `<svg x="0" y="${oy}" width="1500" height="300" viewBox="0 ${oy} 1500 300" overflow="hidden"><rect x="2" y="${oy}" width="1496" height="300" fill="white" stroke="#eee"/><text x="8" y="${oy + 16}" font-size="12">45,15 的 x− 侧 mix：蓝线粗细 = 透明度；数字 = 样点号；灰 = 可见轮廓</text>`
      for (const r of runs) if (!r.hidden) svg += `<polyline fill="none" stroke="#888" stroke-width="1.5" points="${r.pts.map(X).join(' ')}"/>`
      for (let i = 0; i + 1 < neg.pts.length; i++) { const o = Math.min(neg.vis[i]!, neg.vis[i + 1]!); if (o > 0.001) svg += `<polyline fill="none" stroke="#1976d2" stroke-width="${(0.5 + 4 * o).toFixed(1)}" points="${X(Q(neg.pts[i]!))} ${X(Q(neg.pts[i + 1]!))}"/>` }
      neg.pts.forEach((p, i) => { if (i % 2) return; const [x, y] = X(Q(p)).split(','); svg += `<text x="${x}" y="${+y! - 4}" font-size="9" fill="#1976d2">${i}</text>` })
      svg += '</svg>'
      const far = neg.pts.map((p, i) => ({ i, o: i + 1 < neg.pts.length ? Math.min(neg.vis[i]!, neg.vis[i + 1]!) : 0, d: Math.min(...runs.filter(r => !r.hidden).flatMap(r => r.pts.map(q => Math.hypot(q[0] - Q(p)[0], q[1] - Q(p)[1])))) }))
      out.push(`45,15 x− mix, per sample (opacity of the edge after it, distance to the visible outline): ${far.map(f => `#${f.i} ${f.o.toFixed(2)}/${f.d.toFixed(3)}`).join(' ')}`)
    }
  })
  console.log(out.join('\n'))
  if (dir) writeFileSync(`${dir}/diag-intent.svg`, svg + '</svg>')
})
