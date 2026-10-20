// Diagnostic (dot 1792490561), prints and draws when F3D_DIAG_DIR is set:
// (a) yaw 45 / pitch 38, x+ side: the head's own traced segments (target), the mixed segments, the four contributing
//     keys' segments, and visibility — where the error arises: branch choice, mixing, or occlusion;
// (b) the candidate outline points where 360 × 240 and 720 × 480 occlusion disagree, drawn per view;
// (c) the chin-pole skip: points near the chin compared with a ray test that skips nothing but a 1e-3 start gap.
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { type Side, mixContour, traceKey, weights } from '../src/contour'
import { CHIN_Y, defaultShape, makeHead } from '../src/head'
import { makeModel } from '../src/model'
import { candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, add, cross, dot, rotate, scale, sub, toCamera } from '../src/view'

const dir = process.env.F3D_DIAG_DIR
const head = makeHead(defaultShape), model = makeModel()

function rayHidden(p: V3, n: V3, d: V3, tris: [V3, V3, V3][]): boolean {
  const s0 = add(p, scale(n, 1e-4))
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h)
    if (Math.abs(det) < 1e-12) continue
    const f = 1 / det, s = sub(s0, a), u = f * dot(s, h)
    if (u < 0 || u > 1) continue
    const q = cross(s, e1), v = f * dot(d, q)
    if (v < 0 || u + v > 1) continue
    if (f * dot(e2, q) > 1e-3) return true
  }
  return false
}
const mesh = (NU: number, NY: number) => {
  const tris: [V3, V3, V3][] = [], P = (i: number, j: number) => head.at(-Math.PI + (i / NU) * 2 * Math.PI, head.shape.yMax - (j / NY) * (head.shape.yMax - head.shape.yMin))
  for (let j = 0; j < NY; j++) for (let i = 0; i < NU; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), e = P(i + 1, j + 1); tris.push([a, b, e], [a, e, c]) }
  return tris
}

it('(a) yaw 45 / pitch 38: target, mix, keys, visibility', () => {
  if (!dir) return
  const [vy, vp] = (process.env.F3D_DIAG_VIEW ?? '45,38').split(',').map(Number), v = { yaw: vy!, pitch: vp! }, side: Side = (process.env.F3D_DIAG_SIDE as Side) ?? 'pos'
  const W = weights(v.yaw, v.pitch), near = [...W].sort((a, b) => b.w - a.w)[0]!, nk = model.table.at(near.yaw, near.pitch)
  const ref: Partial<Record<Side, V3>> = {}
  for (const s of ['pos', 'neg'] as const) { const q = nk[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
  const t = traceKey(head, v, ref), mixed = mixContour(head, model.table, v).find(l => l.side === side)!
  const report: string[] = [`weights: ${W.map(w => `${w.yaw},${w.pitch}:${w.w.toFixed(3)}`).join('  ')}`]
  for (let seg = 0; seg < 3; seg++) {
    const tv = t.vis[side][seg] ?? [], ts = t[side][seg]
    report.push(`seg ${seg}: target ${ts ? `${ts.length} pts, visible ${tv.map(x => (x ? 1 : 0)).join('')}, y ${ts[0]!.y.toFixed(2)}→${ts[ts.length - 1]!.y.toFixed(2)}, u ${(ts[0]!.u * 57.3).toFixed(0)}°→${(ts[ts.length - 1]!.u * 57.3).toFixed(0)}°` : 'absent'}`)
    for (const w of W) { const ks = model.table.at(w.yaw, w.pitch)[side][seg]!; report.push(`   key ${w.yaw},${w.pitch} (w ${w.w.toFixed(2)}): ${ks.present ? 'present' : 'ABSENT'}, vis ${ks.vis.map(x => (x ? 1 : 0)).join('')}, u ${(ks.samples[0]!.u * 57.3).toFixed(0)}°→${(ks.samples[ks.samples.length - 1]!.u * 57.3).toFixed(0)}°, y ${ks.samples[0]!.y.toFixed(2)}→${ks.samples[ks.samples.length - 1]!.y.toFixed(2)}`) }
    const [a, b] = [[0, 12], [12, 22], [22, 30]][seg]!
    report.push(`   mixed vis ${mixed.vis.slice(a, b + 1).map(x => x.toFixed(1)).join(' ')}`)
  }
  const S = 260, ox = 600, oy = 470, P = (p: V3) => { const r = rotate(p, v); return `${(ox + r[0] * S).toFixed(1)},${(oy - r[1] * S).toFixed(1)}` }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/><text x="10" y="20" font-size="15">yaw 45 · 仰视 38，x+ 侧：黑 = 头模在此角度描出的目标段（实点可见、空心被挡）；红 = mix 段（粗细 = 可见度）；彩色细线 = 四个关键视角的同段</text>`
  for (const l of candidates(head, v)) svg += `<polyline fill="none" stroke="#e0e0e0" stroke-width="1" points="${l.pts.map(q => P(q.p)).join(' ')}"/>`
  const kc = ['#1e88e5', '#43a047', '#8e24aa', '#fb8c00']
  W.forEach((w, n) => { const k = model.table.at(w.yaw, w.pitch); for (let seg = 0; seg < 3; seg++) svg += `<polyline fill="none" stroke="${kc[n]}" stroke-width="1.2" stroke-dasharray="${k[side][seg]!.present ? '' : '4 3'}" points="${k[side][seg]!.samples.map(q => P(head.at(q.u, q.y))).join(' ')}"/>`; svg += `<text x="10" y="${50 + n * 18}" font-size="13" fill="${kc[n]}">key ${w.yaw},${w.pitch} w ${w.w.toFixed(2)}（虚线 = 缺席段）</text>` })
  for (let seg = 0; seg < 3; seg++) { const ts = t[side][seg]; if (ts) ts.forEach((q, i) => { const [x, y] = P(head.at(q.u, q.y)).split(','); svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${t.vis[side][seg]![i] ? '#000' : 'none'}" stroke="#000"/>` }) }
  for (let i = 0; i + 1 < mixed.pts.length; i++) svg += `<polyline fill="none" stroke="#d32f2f" stroke-width="${0.6 + 3 * Math.min(mixed.vis[i]!, mixed.vis[i + 1]!)}" points="${P(mixed.pts[i]!)} ${P(mixed.pts[i + 1]!)}"/>`
  writeFileSync(`${dir}/diag-${v.yaw}-${v.pitch}.svg`, svg + '</svg>')
  writeFileSync(`${dir}/diag-${v.yaw}-${v.pitch}.txt`, report.join('\n'))
  console.log(report.join('\n'))
}, 120000)

it('(b) grid disagreements drawn per view, (c) the chin-pole skip against a ray test', () => {
  if (!dir) return
  const views = [{ yaw: 0, pitch: -45 }, { yaw: 30, pitch: 0 }, { yaw: 60, pitch: 30 }, { yaw: 45, pitch: -30 }, { yaw: 90, pitch: 45 }]
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/><text x="10" y="20" font-size="15">360×240 与 720×480 判定不一致的候选轮廓点（红 = 粗网格说被挡、细网格说可见；蓝 = 相反）；灰 = 候选轮廓</text>`
  const lines: string[] = []
  views.forEach((v, n) => {
    const a = occluder(head, v), b = occluder(head, v, { nu: 720, ny: 480 })
    const ox = (n % 3) * 500 + 250, oy = Math.floor(n / 3) * 500 + 270, S = 140, P = (p: V3) => { const r = rotate(p, v); return [ox + r[0] * S, oy - r[1] * S] as const }
    svg += `<text x="${(n % 3) * 500 + 10}" y="${Math.floor(n / 3) * 500 + 45}" font-size="13">yaw ${v.yaw} pitch ${v.pitch}</text>`
    for (const l of candidates(head, v)) for (const q of l.pts) {
      const ha = hiddenOn(a, q.p, q.u, q.y), hb = hiddenOn(b, q.p, q.u, q.y), [x, y] = P(q.p)
      if (ha === hb) { svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.8" fill="#bbb"/>`; continue }
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="none" stroke="${ha ? '#d32f2f' : '#1e88e5'}" stroke-width="2"/>`
      lines.push(`yaw ${v.yaw} pitch ${v.pitch}: u ${(q.u * 57.3).toFixed(1)}° y ${q.y.toFixed(3)}  360x240 ${ha ? 'hidden' : 'visible'}, 720x480 ${hb ? 'hidden' : 'visible'}`)
    }
  })
  writeFileSync(`${dir}/diag-grid.svg`, svg + '</svg>')
  // (c) every candidate point within 0.25 of the chin bottom, at 9 views: fine-mesh test vs ray test (no skipping)
  const tris = mesh(720, 480), pole: string[] = []
  let n = 0
  for (const yaw of [0, 45, 90]) for (const pitch of [-45, 0, 45]) {
    const v = { yaw, pitch }, occ = occluder(head, v), d = toCamera(v)
    for (const l of candidates(head, v)) for (const q of l.pts) {
      if (q.y > CHIN_Y + 0.25) continue
      n++
      const got = hiddenOn(occ, q.p, q.u, q.y), want = rayHidden(q.p, head.normal(q.u, q.y), d, tris)
      if (got !== want) pole.push(`yaw ${yaw} pitch ${pitch}: u ${(q.u * 57.3).toFixed(1)}° y ${q.y.toFixed(3)}  fine-mesh ${got ? 'hidden' : 'visible'}, ray ${want ? 'hidden' : 'visible'}`)
    }
  }
  const text = `grid disagreements (${lines.length}):\n${lines.join('\n')}\n\nchin region (y < chin + 0.25), ${n} points, fine-mesh vs ray disagreements (${pole.length}):\n${pole.join('\n')}`
  writeFileSync(`${dir}/diag-grid.txt`, text)
  console.log(text)
  expect(true).toBe(true)
}, 300000)
