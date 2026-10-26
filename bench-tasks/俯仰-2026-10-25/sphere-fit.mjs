// 俯仰 ±45: can core's sphere frame (球面框, headset-core deform/index.ts sphereField) explain bowen's hand-tuned bones?
// bowen 1793021900: fit the face outline with a sphere frame; the eyes probably bend together as one sphere.
// Base = the 0° bones (backup before any pitch edit), target = bowen's 第2版 (all locks released), view 0,0, y down.
// The sphere frame at yaw 0, roll 0: q = p − A, z = √(r² − |q|²), out = A + o + s·(qx, cos φ·qy + sin φ·(r − z)).
// A.x = o.x = 0 (the head is symmetric); fitted: A.y, r, φ, s, o.y. Compared with the plain "shift + scale" (φ = 0).
// Run: node bench-tasks/俯仰-2026-10-25/sphere-fit.mjs  → sphere-fit.json, 球面框拟合.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const H = dirname(fileURLToPath(import.meta.url))
const FILES = {
  up: { name: '仰45', base: '../备份/12-仰45-yaw0-pitch45.近2远3.耳朵骨线-before-耳点线上-181018.json', target: '手调记录/12-仰45-yaw0-pitch45.第2版-放开.json' },
  down: { name: '俯45', base: '../备份/13-俯45-yaw0-pitch-45.近2远3.耳朵骨线-before-耳点线上-181018.json', target: '手调记录/13-俯45-yaw0-pitch-45.第2版-放开.json' },
}
const GROUPS = {
  outline: { name: '脸轮廓', lines: ['lmv3m1am1-3', 'lm03-chf', 'lm03-skf', 'cmv3m1am1-6/lmv3m1am1-3', 'lm03-skb'] },
  eyes: { name: '两眼', lines: ['ley-R-0', 'ley-R-1', 'ley-R-2', 'ley-L-0', 'ley-L-1', 'ley-L-2'] },
  ear: { name: '耳朵', lines: ['lear-R-1', 'lear-R-2'] },
}
function cubics(file) {
  const d = JSON.parse(readFileSync(join(H, file), 'utf8')), net = d.document.network
  const v = net.shapes.layers.find(l => l.key === 'view:0,0'), out = {}
  for (const l of net.lines) {
    const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]
    if (!s || !a || !b) continue
    out[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]]
  }
  return out
}
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]) }
const N = 16, ts = Array.from({ length: N + 1 }, (_, i) => i / N)
const samples = (cs, ids) => ids.flatMap(id => ts.map(t => bez(cs[id], t)))
// the sphere frame; null when a point lies beyond the sphere (core refuses it)
function sphere([Ay, r, phi, s, oy], [x, y]) {
  const qx = x, qy = y - Ay, z2 = r * r - qx * qx - qy * qy
  if (!(z2 > 0) || !(r > 0) || !(s > 0)) return null
  const c = Math.cos(phi * Math.PI / 180), sn = Math.sin(phi * Math.PI / 180)
  return [s * qx, Ay + oy + s * (c * qy + sn * (r - Math.sqrt(z2)))]
}
// the same turn on a cylinder lying sideways (its axis horizontal): depth depends on height only, x is kept
function cylinder([Ay, r, phi, s, oy], [x, y]) {
  const qy = y - Ay, z2 = r * r - qy * qy
  if (!(z2 > 0) || !(r > 0) || !(s > 0)) return null
  const c = Math.cos(phi * Math.PI / 180), sn = Math.sin(phi * Math.PI / 180)
  return [s * x, Ay + oy + s * (c * qy + sn * (r - Math.sqrt(z2)))]
}
const shiftScale = ([s, oy], [x, y]) => [s * x, s * y + oy]
function cost(f, p, src, dst) {
  let e = 0
  for (let i = 0; i < src.length; i++) { const m = f(p, src[i]); if (!m) return 1e12; e += (m[0] - dst[i][0]) ** 2 + (m[1] - dst[i][1]) ** 2 }
  return e
}
function nelderMead(F, x0, step, iters = 4000) {
  const n = x0.length
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => v + (i === j ? step[j] : 0)))].map(x => ({ x, f: F(x) }))
  for (let k = 0; k < iters; k++) {
    S.sort((a, b) => a.f - b.f)
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i].x[j] / n
    const w = S[n], pt = a => c.map((v, j) => v + a * (w.x[j] - v)), ev = x => ({ x, f: F(x) })
    const r = ev(pt(-1))
    if (r.f < S[0].f) { const e = ev(pt(-2)); S[n] = e.f < r.f ? e : r }
    else if (r.f < S[n - 1].f) S[n] = r
    else { const ct = ev(pt(r.f < w.f ? -0.5 : 0.5)); if (ct.f < Math.min(r.f, w.f)) S[n] = ct; else S = S.map((v, i) => i ? ev(v.x.map((q, j) => S[0].x[j] + 0.5 * (q - S[0].x[j]))) : v) }
  }
  S.sort((a, b) => a.f - b.f); return S[0]
}
function fitSphere(src, dst, sign, f = sphere) {
  let best = null
  for (const Ay of [-40, 0, 20, 40]) for (const r of [90, 120, 180, 300, 600]) for (const phi of [20, 45, 70].map(v => v * sign)) {
    const b = nelderMead(p => cost(f, p, src, dst), [Ay, r, phi, 1, 0], [10, 30, 10, 0.05, 5])
    if (!best || b.f < best.f) best = b
  }
  return best
}
const stats = (f, p, src, dst, perLine) => {
  const e = src.map((q, i) => { const m = f(p, q); return Math.hypot(m[0] - dst[i][0], m[1] - dst[i][1]) })
  const rms = Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length), max = Math.max(...e)
  const lines = perLine.map((id, k) => ({ id, max: +Math.max(...e.slice(k * (N + 1), (k + 1) * (N + 1))).toFixed(2) }))
  return { rms: +rms.toFixed(2), max: +max.toFixed(2), lines }
}
const out = {}, R = (v, k = 2) => +v.toFixed(k)
for (const [fk, F] of Object.entries(FILES)) {
  const base = cubics(F.base), target = cubics(F.target), sign = fk === 'up' ? 1 : -1
  out[fk] = { name: F.name, groups: {} }
  for (const [gk, G] of Object.entries({ ...GROUPS, all: { name: '整体（轮廓+眼+耳）', lines: [...GROUPS.outline.lines, ...GROUPS.eyes.lines, ...GROUPS.ear.lines] } })) {
    const src = samples(base, G.lines), dst = samples(target, G.lines)
    const sp = fitSphere(src, dst, sign)
    const cy = fitSphere(src, dst, sign, cylinder)
    const cy2 = fitSphere(src, dst, -sign, cylinder), cyb = cy2.f < cy.f ? cy2 : cy
    const ss = nelderMead(p => cost(shiftScale, p, src, dst), [1, 0], [0.05, 5])
    const none = stats((_, q) => q, null, src, dst, G.lines)
    out[fk].groups[gk] = {
      name: G.name,
      unchanged: none,
      shiftScale: { params: { s: R(ss.x[0], 3), oy: R(ss.x[1]) }, ...stats(shiftScale, ss.x, src, dst, G.lines) },
      cylinder: { params: { Ay: R(cyb.x[0]), r: R(cyb.x[1], 1), pitch: R(cyb.x[2], 1), s: R(cyb.x[3], 3), oy: R(cyb.x[4]) }, ...stats(cylinder, cyb.x, src, dst, G.lines) },
      sphere: { params: { Ay: R(sp.x[0]), r: R(sp.x[1], 1), pitch: R(sp.x[2], 1), s: R(sp.x[3], 3), oy: R(sp.x[4]) }, ...stats(sphere, sp.x, src, dst, G.lines) },
    }
  }
}
writeFileSync(join(H, 'sphere-fit.json'), JSON.stringify(out, null, 1))
for (const [fk, f] of Object.entries(out)) {
  console.log(`== ${f.name}`)
  for (const g of Object.values(f.groups)) console.log(`  ${g.name}: 不动 ${g.unchanged.rms}/${g.unchanged.max} · 平移缩放 ${g.shiftScale.rms}/${g.shiftScale.max} · 横柱面 ${g.cylinder.rms}/${g.cylinder.max} ${JSON.stringify(g.cylinder.params)} · 球面框 ${g.sphere.rms}/${g.sphere.max}  ${JSON.stringify(g.sphere.params)}`)
}

// ---- shared eye sphere: one sphere (A.y, r) for both directions, only its turn (and s, o.y) per direction ----
{
  const E = GROUPS.eyes.lines, D = Object.values(FILES).map(F => [samples(cubics(F.base), E), samples(cubics(F.target), E)])
  const C = p => cost(sphere, [p[0], p[1], p[2], p[3], p[4]], ...D[0]) + cost(sphere, [p[0], p[1], p[5], p[6], p[7]], ...D[1])
  let best = null
  for (const Ay of [0, 15, 30]) for (const r of [50, 80, 130, 200]) for (const a of [20, 40, 60]) {
    const b = nelderMead(C, [Ay, r, a, 0.95, 0, -a, 0.92, 0], [8, 25, 10, 0.05, 4, 10, 0.05, 4], 6000)
    if (!best || b.f < best.f) best = b
  }
  const p = best.x, up = [p[0], p[1], p[2], p[3], p[4]], dn = [p[0], p[1], p[5], p[6], p[7]]
  out.sharedEyes = { Ay: R(p[0]), r: R(p[1], 1), up: { pitch: R(p[2], 1), s: R(p[3], 3), oy: R(p[4]), ...stats(sphere, up, ...D[0], E) }, down: { pitch: R(p[5], 1), s: R(p[6], 3), oy: R(p[7]), ...stats(sphere, dn, ...D[1], E) } }
  writeFileSync(join(H, 'sphere-fit.json'), JSON.stringify(out, null, 1))
  const o = out.sharedEyes; console.log(`两眼共用一个球（中心高 ${o.Ay}，半径 ${o.r}）: 仰 弯 ${o.up.pitch}° 误差 ${o.up.rms}/${o.up.max} · 俯 弯 ${o.down.pitch}° 误差 ${o.down.rms}/${o.down.max}`)
}

// ---- picture: per file, three columns (outline / eyes / ear groups fitted alone, and all-in-one) ----
const W = 1000, Hh = 1000, cols = [['outline', '脸轮廓：最合适的球面框'], ['eyes', '两眼：共用一个球面框']]
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" font-family="PingFang SC, sans-serif"><rect width="${W}" height="${Hh}" fill="#fff"/>`
const path = (pts, tf, col, w, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.map(p => tf(p).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
Object.entries(FILES).forEach(([fk, F], row) => {
  const base = cubics(F.base), target = cubics(F.target), allIds = [...GROUPS.outline.lines, ...GROUPS.eyes.lines, ...GROUPS.ear.lines]
  cols.forEach(([gk, title], col) => {
    const sh = out.sharedEyes, d = sh[fk]
    const g = gk === 'eyes' ? { sphere: { rms: d.rms, max: d.max, params: { Ay: sh.Ay, r: sh.r, pitch: d.pitch, s: d.s, oy: d.oy } }, shiftScale: out[fk].groups.eyes.shiftScale } : out[fk].groups[gk]
    const P = [g.sphere.params.Ay, g.sphere.params.r, g.sphere.params.pitch, g.sphere.params.s, g.sphere.params.oy]
    const ids = gk === 'all' ? allIds : GROUPS[gk].lines, zoom = gk === 'eyes' ? 4.2 : 2.6
    const cx = 250 + col * 500, cy = 40 + row * 500 + (gk === 'eyes' ? 230 : 250)
    const tf = ([x, y]) => [cx + x * zoom, cy + y * zoom]
    svg += `<text x="${cx - 230}" y="${row * 500 + 30}" font-size="20" fill="#222">${F.name} · ${title}</text>`
    svg += `<text x="${cx - 230}" y="${row * 500 + 56}" font-size="15" fill="#555">球面框 误差 均 ${g.sphere.rms} / 最大 ${g.sphere.max}　（只平移缩放 ${g.shiftScale.rms} / ${g.shiftScale.max}）</text>`
    svg += `<text x="${cx - 230}" y="${row * 500 + 78}" font-size="15" fill="#555">弯 ${g.sphere.params.pitch}° · 半径 ${g.sphere.params.r} · 中心高 ${g.sphere.params.Ay}</text>`
    for (const id of ids) {
      const t = ts.map(u => bez(base[id], u))
      svg += path(t, tf, '#bbb', 1.5)
      svg += path(ts.map(u => bez(target[id], u)), tf, '#111', 2.5)
      svg += path(t.map(q => sphere(P, q) ?? q), tf, '#e0306a', 2, '5 4')
    }
  })
})
svg += `<text x="20" y="${Hh - 14}" font-size="15" fill="#444">灰 = 0° 原骨线　黑 = bowen 手调（第2版）　红虚线 = 0° 骨线经球面框变形的结果　误差单位同骨线坐标（脸宽约 88）</text></svg>`
writeFileSync(join(H, '球面框拟合.svg'), svg)
