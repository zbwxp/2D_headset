// Local experiment, checks first (dot 1792494616): the x+ jawline as a path ALONG a candidate loop's own edge order.
//   1. the path: from the jaw-angle endpoint (the loop point nearest the view's own chin–jaw end) along the loop toward
//      the chin; occlusion only splits its display into visible / hidden intervals, it never ends the path; no switching
//      to another loop or gluing by screen nearness;
//   2. x = 0 is an optional marker on the path (the path ends there when it exists); none found is recorded, and an
//      occlusion boundary never stands in for it;
//   3. checks: hidden stretches not bridged, visible stretches after a gap on the same path kept, no side switch (the
//      path stops at its first x = 0 crossing, so the check is WHERE that crossing is: chin or elsewhere; and the
//      longest step, so no jump), and endpoints stable under ±1° in yaw and in pitch.
// Prints only (F3D_DIAG=1). The mix is not involved yet.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { MIN_LOOP, type Side, traceKey, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { type Loop, candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, type View, len, rotate, sub } from '../src/view'

const m = makeModel(), head = m.head
const extent = (l: Loop) => Math.max(...[0, 1, 2].map(k => Math.max(...l.pts.map(q => q.p[k]!)) - Math.min(...l.pts.map(q => q.p[k]!))))

interface JawPath { pts: V3[]; uv: { u: number; y: number }[]; marker: V3 | undefined; intervals: { hidden: boolean; len: number; pts: V3[] }[]; loop: V3[]; maxStep: number; jawOff: number; jaw: V3; loopPts: number; closed: boolean }

/** the x+ jawline path at a view, from a jaw-angle point (head space) */
function jawPath(view: View, jawAt: V3, flip = false): JawPath | undefined {
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
  const hid = (i: number) => hiddenOn(occ, pts[i]!, uv[i]!.u, uv[i]!.y)
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
  return { pts, uv, marker, intervals, maxStep, jawOff: best.d, jaw: pts[0]!, loop: L.pts.map(q => q.p), loopPts: n, closed: L.closed }
}

it.skipIf(!process.env.F3D_DIAG)('the x+ jawline as a path along its candidate loop: checks at 45,15 / 75,15 and their keys', () => {
  const out: string[] = [], dir = process.env.F3D_DIAG_DIR
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  svg += `<text x="10" y="20" font-size="14">每格在各自视角下：浅灰 = 全部候选轮廓；灰 = 选中的那条；绿实 = 颌线路径的可见段，红虚 = 被挡段（只断开显示，路径继续）；▲ 颌角点，● 路径上第一次 x=0（标 y），✕ = 没有交点</text>`
  const panel = (row: number, col: number, label: string, v: View, p: JawPath) => {
    const Q = (q: V3) => { const r = rotate(q, v); return [r[0], r[1]] as const }, all = p.pts.map(Q)
    const x0 = Math.min(...all.map(q => q[0])), x1 = Math.max(...all.map(q => q[0])), y0 = Math.min(...all.map(q => q[1])), y1 = Math.max(...all.map(q => q[1]))
    const ox = col * 300, oy = 40 + row * 730, S = Math.min(200, 270 / Math.max(1e-3, x1 - x0), 640 / Math.max(1e-3, y1 - y0))
    const X = (q: V3) => { const [a, b] = Q(q); return `${(ox + 150 + (a - (x0 + x1) / 2) * S).toFixed(1)},${(oy + 360 - (b - (y0 + y1) / 2) * S).toFixed(1)}` }
    svg += `<svg x="${ox}" y="${oy}" width="300" height="720" viewBox="${ox} ${oy} 300 720" overflow="hidden"><rect x="${ox + 2}" y="${oy}" width="296" height="720" fill="white" stroke="#eee"/><text x="${ox + 8}" y="${oy + 16}" font-size="12">${label}${S < 200 ? `（缩小 ×${(S / 200).toFixed(2)}）` : ''}</text>`
    for (const l of candidates(head, v)) svg += `<polyline fill="none" stroke="#e4e4e4" stroke-width="1" points="${[...l.pts, ...(l.closed ? [l.pts[0]!] : [])].map(q => X(q.p)).join(' ')}"/>`
    svg += `<polyline fill="none" stroke="#999" stroke-width="1" points="${[...p.loop, ...(p.closed ? [p.loop[0]!] : [])].map(X).join(' ')}"/>`
    for (const iv of p.intervals) svg += `<polyline fill="none" stroke="${iv.hidden ? '#d32f2f' : '#2e7d32'}" stroke-width="${iv.hidden ? 3 : 4}" ${iv.hidden ? 'stroke-dasharray="4 3"' : 'opacity="0.75"'} points="${iv.pts.map(X).join(' ')}"/>`
    const [sx, sy] = X(p.jaw).split(',').map(Number)
    svg += `<path d="M${sx} ${sy! - 8} L${sx! - 7} ${sy! + 6} L${sx! + 7} ${sy! + 6} Z" fill="#2e7d32"/>`
    const end = p.pts[p.pts.length - 1]!, [ex, ey] = X(end).split(',').map(Number)
    svg += p.marker ? `<circle cx="${ex}" cy="${ey}" r="6" fill="#1565c0"/><text x="${ex! + 8}" y="${ey! + 4}" font-size="11" fill="#1565c0">y ${p.marker[1].toFixed(2)}</text>` : `<text x="${ex! - 6}" y="${ey! + 6}" font-size="18" fill="#1565c0">✕</text>`
    svg += '</svg>'
  }
  const anchorsOf = (yaw: number, pitch: number) => { const k = m.table.at(yaw, pitch), o: Partial<Record<Side, V3>> = {}; for (const s of ['pos', 'neg'] as const) { const q = k[s][0]!.samples[0]!; o[s] = head.at(q.u, q.y) } return o }
  // a view's jaw-angle point: the end of its own traced chin–jaw (keys: the table's; other views: a trace continuing
  // the nearest key's anchors)
  const jawOf = (v: View, key?: { yaw: number; pitch: number }) => {
    if (key) { const s = m.table.at(key.yaw, key.pitch).pos[0]!.samples, q = s[s.length - 1]!; return head.at(q.u, q.y) }
    const near = [...weights(Math.abs(v.yaw), v.pitch)].sort((a, b) => b.w - a.w)[0]!, tr = traceKey(head, v, anchorsOf(near.yaw, near.pitch)), s = tr.pos[0]
    if (!s) return undefined
    const q = s[s.length - 1]!; return head.at(q.u, q.y)
  }
  const describe = (label: string, v: View, jaw: V3 | undefined) => {
    if (!jaw) return { line: `${label}: no chin–jaw traced`, p: undefined }
    const p = jawPath(v, jaw)
    if (!p) return { line: `${label}: no loop`, p: undefined }
    const gaps = p.intervals.filter(x => x.hidden).length, visAfterGap = p.intervals.slice(p.intervals.findIndex(x => x.hidden) + 1).filter(x => !x.hidden).reduce((a, x) => a + x.len, 0)
    return { p, line: `${label}: loop ${p.loopPts} pts${p.closed ? '' : ' (open)'}, path ${p.pts.length} pts, ${p.marker ? `x=0 marker at y ${p.marker[1].toFixed(3)} z ${p.marker[2].toFixed(3)}` : 'NO x=0 crossing'}; intervals ${p.intervals.map(x => `${x.hidden ? 'H' : 'V'}${x.len.toFixed(3)}`).join(' ')}; hidden gaps ${gaps}${gaps ? `, visible after the first gap ${visAfterGap.toFixed(3)} R` : ''}; path length ${p.intervals.reduce((a, x) => a + x.len, 0).toFixed(3)}, longest step ${p.maxStep.toFixed(3)}, jaw point to loop ${p.jawOff.toFixed(4)}` }
  }
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) {
    const W = weights(v.yaw, v.pitch)
    out.push(`== ${v.yaw},${v.pitch}`)
    const views: { label: string; v: View; key?: { yaw: number; pitch: number } }[] = [{ label: 'target', v }, ...W.map(w => ({ label: `key ${w.yaw},${w.pitch}`, v: { yaw: w.yaw, pitch: w.pitch }, key: { yaw: w.yaw, pitch: w.pitch } }))]
    views.forEach((x, col) => {
      const base = describe(`  ${x.label}`, x.v, jawOf(x.v, x.key))
      out.push(base.line)
      if (!base.p) return
      const back = jawPath(x.v, base.p.jaw, true)
      if (back) out.push(`      the other direction from the jaw point: ${back.marker ? `first x=0 at y ${back.marker[1].toFixed(3)} z ${back.marker[2].toFixed(3)}` : 'NO x=0 crossing'}, length ${back.intervals.reduce((a, q) => a + q.len, 0).toFixed(3)}, intervals ${back.intervals.map(q => `${q.hidden ? 'H' : 'V'}${q.len.toFixed(3)}`).join(' ')}`)
      panel(v.yaw === 45 ? 0 : 1, col, `${x.label === 'target' ? `本视角 ${v.yaw},${v.pitch}` : x.label}`, x.v, base.p)
      // ±1° in yaw and pitch: the endpoints at the neighbouring views (traced at those views, not keys)
      const moves: string[] = []
      for (const [dy, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nv = { yaw: x.v.yaw + dy, pitch: x.v.pitch + dp }, nj = jawOf(nv), np = nj ? jawPath(nv, nj) : undefined
        if (!np) { moves.push(`${dy ? `yaw${dy > 0 ? '+' : '−'}1` : `pitch${dp > 0 ? '+' : '−'}1`}: none`); continue }
        const dj = len(sub(np.jaw, base.p.jaw)), dm = np.marker && base.p.marker ? len(sub(np.marker, base.p.marker)) : NaN
        moves.push(`${dy ? `yaw${dy > 0 ? '+' : '−'}1` : `pitch${dp > 0 ? '+' : '−'}1`}: jaw ${dj.toFixed(3)}, marker ${Number.isNaN(dm) ? (np.marker ? 'appears' : base.p.marker ? 'disappears' : 'none') : `${dm.toFixed(3)}${dm > 0.05 ? ` (now y ${np.marker![1].toFixed(3)} z ${np.marker![2].toFixed(3)})` : ''}`}`)
      }
      out.push(`      ±1°: ${moves.join(' | ')}`)
    })
  }
  console.log(out.join('\n'))
  if (dir) writeFileSync(`${dir}/diag-jawpath.svg`, svg + '</svg>')
}, 900000)
