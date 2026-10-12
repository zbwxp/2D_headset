// P0 measurement (docs/ink-joins-plan.md §5, §10.1; bowen 1791790281 allowed the scratch download). Not product code.
// Measures clipper2-ts and clipper2-wasm on our fixtures: correctness on the sliver / touch / collinear cases, the rounding
// of new intersection points, the size below which regions vanish, and speed.
import * as C2 from 'clipper2-ts'
import Clipper2ZFactory from 'clipper2-wasm/dist/es/clipper2z.js'

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / len(a)), cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const areaF = l => l.reduce((s, P, i) => s + cross(P, l[(i + 1) % l.length]), 0) / 2
const circle = (c, r, n) => Array.from({ length: n }, (_, i) => add(c, [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]))
const band = (P0, P1, h) => { const d = unit(sub(P1, P0)), n = [-d[1] * h, d[0] * h]; return [add(P0, n), add(P1, n), sub(P1, n), sub(P0, n)] }
const halfDisc = (c, d, h, n = 16) => { const nn = [-d[1], d[0]], a0 = Math.atan2(nn[1], nn[0]); return Array.from({ length: n + 1 }, (_, i) => add(c, mul([Math.cos(a0 + Math.PI * i / n), Math.sin(a0 + Math.PI * i / n)], h))) }

// --- adapters: float polygons → integer paths at scale s, and back
const toTs = (polys, s) => polys.map(p => p.map(([x, y]) => ({ x: Math.round(x * s), y: Math.round(y * s) })))
const fromTs = (paths, s) => paths.map(p => p.map(q => [q.x / s, q.y / s]))
const tsUnion = (polys, s) => fromTs(C2.union(toTs(polys, s), C2.FillRule.NonZero), s)
const tsOp = (ct, subj, clip, s) => fromTs(C2.booleanOp(ct, toTs(subj, s), toTs(clip, s), C2.FillRule.NonZero), s)

const W = await Clipper2ZFactory()
function wasmPaths(polys, s) { const ps = new W.Paths64(); for (const p of polys) { const a = new BigInt64Array(p.length * 3); p.forEach(([x, y], i) => { a[3 * i] = BigInt(Math.round(x * s)); a[3 * i + 1] = BigInt(Math.round(y * s)) }); const path = new W.Path64(); path.assign(a); ps.push_back(path); path.delete() } return ps }
function wasmRead(ps, s) { const out = []; for (let i = 0; i < ps.size(); i++) { const v = ps.get(i).view(), pts = []; for (let j = 0; j < v.length; j += 3) pts.push([Number(v[j]) / s, Number(v[j + 1]) / s]); out.push(pts) } return out }
const wUnion = (polys, s) => { const a = wasmPaths(polys, s), r = W.Union64(a, new W.Paths64(), W.FillRule.NonZero); const o = wasmRead(r, s); a.delete(); r.delete(); return o }

const report = (name, out, expect) => { const A = out.reduce((t, l) => t + areaF(l), 0); console.log(`  ${name}: paths ${out.length}, area ${A.toFixed(6)}${expect !== undefined ? ` (expected ${expect.toFixed(6)}, diff ${(A - expect).toExponential(2)})` : ''}`) }

console.log('== speed: a drawing of N lines, each a 2×120-vertex outline + a 17-vertex cap at each end, union per line; and join groups of 2 lines')
const lines = N => Array.from({ length: N }, (_, i) => { const y = i * 3, pts = []; const top = [], bot = []
  for (let k = 0; k <= 120; k++) { const x = k, yy = y + 2 * Math.sin(k / 10 + i); const h = 0.6 + 0.4 * Math.sin(k / 30); top.push([x, yy + h]); bot.push([x, yy - h]) }
  return [[...top, ...bot.reverse()], halfDisc(top[0].map((v, j) => (v + bot[bot.length - 1][j]) / 2), [-1, 0], 0.6), halfDisc([120, y + 2 * Math.sin(12 + i)], [1, 0], 0.6)] })
for (const [N, s] of [[300, 1e4], [300, 1e6], [300, 1e8]]) {
  const ls = lines(N).map(l => l.map(p => (p.reduce((t, P, i) => t + (P[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * P[1]), 0) < 0 ? p.slice().reverse() : p)))
  for (const [nm, f] of [['clipper2-ts', tsUnion], ['clipper2-wasm', wUnion]]) {
    for (let warm = 0; warm < 3; warm++) for (const l of ls) f(l, s)
    const t0 = performance.now(); for (let rep = 0; rep < 5; rep++) for (const l of ls) f(l, s); const per = (performance.now() - t0) / 5
    const t1 = performance.now(); for (let rep = 0; rep < 5; rep++) for (let i = 0; i + 1 < ls.length; i += 2) f([...ls[i], ...ls[i + 1]], s); const perG = (performance.now() - t1) / 5
    console.log(`  N = ${N}, s = ${s}, ${nm}: per-line unions ${per.toFixed(1)} ms per frame · 2-line groups ${perG.toFixed(1)} ms per frame`)
  }
}
