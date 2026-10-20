// Diagnostic (dot 1792490143): one pruned spur — before / after, the 3D positions, and whether the cut stretch is
// really hidden: exact occlusion by a ray to the camera against a fine mesh, next to what the depth buffer says.
// Writes a picture and prints a table when F3D_DIAG_DIR is set; asserts nothing (it is evidence for a decision).
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { pruneSpurs, walk } from '../src/contour'
import { CHIN_Y, defaultShape, makeHead } from '../src/head'
import { DEPTH_EPS, OUTWARD, candidates, mask } from '../src/outline'
import { type V3, add, cross, dot, len, rotate, scale, sub, toCamera } from '../src/view'

const head = makeHead(defaultShape)
const dir = process.env.F3D_DIAG_DIR

/** exact: does the ray from p toward the camera hit the head (a 360 × 240 triangle mesh) beyond a small start gap? */
function rayHits(p: V3, d: V3, tris: [V3, V3, V3][]): number {
  let best = Infinity
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h)
    if (Math.abs(det) < 1e-12) continue
    const f = 1 / det, s = sub(p, a), u = f * dot(s, h)
    if (u < 0 || u > 1) continue
    const q = cross(s, e1), v = f * dot(d, q)
    if (v < 0 || u + v > 1) continue
    const t = f * dot(e2, q)
    if (t > 1e-3 && t < best) best = t
  }
  return best
}

it('a pruned spur at yaw 0 / pitch -45: hidden or a real jaw line?', () => {
  if (!dir) return
  const view = { yaw: 0, pitch: -45 }, d = toCamera(view)
  const extent = (l: { pts: { p: V3 }[] }) => Math.max(...[0, 1, 2].map(k => Math.max(...l.pts.map(q => q.p[k]!)) - Math.min(...l.pts.map(q => q.p[k]!))))
  const loops = candidates(head, view).filter(l => extent(l) >= 0.15)
  const chin = head.at(0, CHIN_Y)
  // the x+ side's walk as traceKey picks it (nearest the chin, moving toward screen right)
  let path: ReturnType<typeof walk> = []
  const near = loops.flatMap((l, li) => l.pts.map((q, i) => ({ li, i, d: len(sub(q.p, chin)) }))).sort((a, b) => a.d - b.d)
  for (const c of near.slice(0, 80)) {
    const w = [walk(loops[c.li]!, c.i, 1), walk(loops[c.li]!, c.i, -1)].find(x => x.length > 8 && rotate(x[8]!.p, view)[0] - rotate(x[0]!.p, view)[0] > 0.01)
    if (w) { path = w; break }
  }
  const kept = new Set(pruneSpurs(path, view))
  const cut = path.map((q, i) => ({ q, i })).filter(x => !kept.has(x.q))
  // fine mesh for the exact test
  const NU = 360, NY = 240, tris: [V3, V3, V3][] = []
  const P = (i: number, j: number) => head.at(-Math.PI + (i / NU) * 2 * Math.PI, head.shape.yMax - (j / NY) * (head.shape.yMax - head.shape.yMin))
  for (let j = 0; j < NY; j++) for (let i = 0; i < NU; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), e = P(i + 1, j + 1); tris.push([a, b, e], [a, e, c]) }
  const m = mask(head, view)
  const rows = path.map((q, i) => {
    const n = head.normal(q.u, q.y), start = add(q.p, scale(n, 1e-4))
    const t = rayHits(start, d, tris)
    const sq = add(q.p, scale(n, OUTWARD)), r = rotate(sq, view)
    const cx = Math.floor((r[0] - m.x0) / m.px), cy = Math.floor((r[1] - m.y0) / m.px), k = cy * m.w + cx
    const buf = m.on[k] ? m.depth[k]! : -Infinity
    return { i, cut: !kept.has(q), u: q.u, y: q.y, nd: dot(n, d), exact: Number.isFinite(t) ? 'hidden' : 'visible', t, bufGap: buf - r[2], bufSays: buf <= r[2] + DEPTH_EPS ? 'visible' : 'hidden' }
  })
  const lines = rows.filter(r => r.cut || rows.some(c => c.cut && Math.abs(c.i - r.i) <= 3)).map(r =>
    `${String(r.i).padStart(3)} ${r.cut ? 'CUT ' : 'kept'} u ${(r.u * 57.3).toFixed(1).padStart(6)}° y ${r.y.toFixed(3)}  n·d ${r.nd.toFixed(3).padStart(6)}  exact ${r.exact.padEnd(7)}${Number.isFinite(r.t) ? ` (hit at ${r.t.toFixed(3)} R)` : '                '}  buffer ${r.bufSays.padEnd(7)} (front − point ${Number.isFinite(r.bufGap) ? r.bufGap.toFixed(3) : 'none'} R, eps ${DEPTH_EPS})`)
  writeFileSync(`${dir}/diag-spur.txt`, `path ${path.length} points, cut ${cut.length}\n` + lines.join('\n'))
  // picture: left = this view near the jaw (cut red, kept green, the head's candidate outline grey); right = the same
  // points seen from the side (yaw 90) with the head's profile, to show where they are in 3D
  const panel = (v: { yaw: number; pitch: number }, ox: number, title: string, zoom: number, centre: V3) => {
    const c = rotate(centre, v), Q = (p: V3) => { const r = rotate(p, v); return [ox + 300 + (r[0] - c[0]) * zoom, 330 - (r[1] - c[1]) * zoom] as const }
    let s = `<text x="${ox + 10}" y="20" font-size="14">${title}</text>`
    for (const l of candidates(head, v)) for (const q of l.pts) { const a = Q(q.p); if (a[0] > ox && a[0] < ox + 600 && a[1] > 30 && a[1] < 640) s += `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="1" fill="#bbb"/>` }
    rows.forEach(r => { const a = Q(path[r.i]!.p); s += `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="${r.cut ? 3.5 : 2.5}" fill="${r.cut ? (r.exact === 'hidden' ? '#d32f2f' : '#ff9800') : '#2e7d32'}"/>` })
    return s
  }
  const centre = cut.length ? cut[Math.floor(cut.length / 2)]!.q.p : path[0]!.p
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  svg += panel(view, 0, 'yaw 0 · 俯视 45（本视角，放大）', 1400, centre) + panel({ yaw: 90, pitch: 0 }, 600, '同一批点从侧面看（yaw 90 平视）', 700, centre)
  svg += `<text x="10" y="700" font-size="16">绿 = 保留；红 = 剪掉且精确测试判为被遮挡；橙 = 剪掉但精确测试判为可见（剪错）；灰 = 头模候选轮廓</text>`
  writeFileSync(`${dir}/diag-spur.svg`, svg + '</svg>')
}, 120000)
