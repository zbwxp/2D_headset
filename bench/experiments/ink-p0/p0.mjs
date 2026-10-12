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

const S = 1e4 // 1 unit = 1e-4 drawing units for the correctness fixtures
console.log(`== correctness fixtures, scale s = ${S}`)
{ // F1: the free-end cap that broke our extractor: a 32-gon centred on the body's end edge (a 5e-6 sliver)
  const h = 6, c = [1507.8224, 884.3168], d = unit([1, 0.0001]), body = band(sub(c, mul(d, 120)), c, h), cap = circle(c, h, 32)
  const exact = 240 * h + areaF(cap) / 2 // body + the half of the 32-gon outside the body (the 32-gon is symmetric about the end edge to within the sliver)
  for (const [nm, f] of [['clipper2-ts', tsUnion], ['clipper2-wasm', wUnion]]) report(`F1 cap sliver ${nm}`, f([body, cap], S), exact)
}
{ // F3: two arms touching only at p (0° sharp row): two triangles sharing one vertex
  const p = [0, 0], A = [[0, 0], [-10, 3], [-10, 6]], B = [[0, 0], [-10, -6], [-10, -3]]
  for (const [nm, f] of [['clipper2-ts', tsUnion], ['clipper2-wasm', wUnion]]) report(`F3 touch at a point ${nm}`, f([A, B], S), 15 + 15)
}
{ // F4: collinear overlap (0° straight): two bands on one line, different widths, overlapping fully
  const a = band([0, 0], [100, 0], 2), b = band([100, 0], [0, 0], 6)
  for (const [nm, f] of [['clipper2-ts', tsUnion], ['clipper2-wasm', wUnion]]) report(`F4 collinear overlap ${nm}`, f([a, b], S), 1200)
}
{ // F2: the narrowing strip at the cut: Wo − Wn where the two inner edges meet tangentially at the cut (a strip thinning to 0)
  const L = 36, n = 400, hw = 6, h0 = 2.0012, m0 = 0.0349
  const H = s => { const t = s / L, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * hw }
  const ss = Array.from({ length: n + 1 }, (_, i) => L * i / n)
  const Wo = [...ss.map(s => [s, -hw]), ...ss.slice().reverse().map(s => [s, hw])], Wn = [...ss.map(s => [s, -hw]), ...ss.slice().reverse().map(s => [s, H(s)])]
  const exact = ss.reduce((acc, s, i) => i ? acc + (ss[i] - ss[i - 1]) * ((hw - H(s)) + (hw - H(ss[i - 1]))) / 2 : 0, 0)
  report('F2 strip Wo − Wn clipper2-ts', tsOp(C2.ClipType.Difference, [Wo], [Wn], S), exact)
}

console.log('== rounding of new intersection points (two bands crossing at an irrational angle, many scales)')
for (const s of [1e2, 1e3, 1e4, 1e5, 1e6]) {
  let worst = 0
  for (let k = 0; k < 200; k++) {
    const th = 0.1 + k * 0.0137, a = band([0, 0], [50, 0], 2), b = band([25 - 30 * Math.cos(th), -30 * Math.sin(th)], [25 + 30 * Math.cos(th), 30 * Math.sin(th)], 1.3)
    // exact crossings of the four edge pairs, in double
    const edges = q => q.map((P, i) => [P, q[(i + 1) % q.length]]), ex = []
    for (const [P, Q] of edges(a)) for (const [R, T] of edges(b)) { const d1 = sub(Q, P), d2 = sub(T, R), den = cross(d1, d2); if (Math.abs(den) < 1e-12) continue; const w = sub(R, P), u = cross(w, d2) / den, v = cross(w, d1) / den; if (u >= 0 && u <= 1 && v >= 0 && v <= 1) ex.push(add(P, mul(d1, u))) }
    const out = tsUnion([a, b], s).flat()
    for (const X of ex) worst = Math.max(worst, Math.min(...out.map(P => len(sub(P, X)))))
  }
  console.log(`  s = ${s}: worst output-vertex offset from the exact crossing ${worst.toExponential(3)} drawing units = ${(worst * s).toFixed(3)} grid units`)
}

console.log('== region collapse: a thin triangle of height t (grid units) beside a square, union; does it survive?')
for (const t of [0.2, 0.5, 0.8, 1, 1.5, 2, 3]) {
  const s = 1, sq = [[0, 0], [100, 0], [100, 100], [0, 100]], tri = [[200, 0], [300, 0], [250, t]]
  const tsOut = fromTs(C2.union(toTs([sq, tri], s), C2.FillRule.NonZero), s), wOut = wUnion([sq, tri], s)
  console.log(`  t = ${t}: clipper2-ts paths ${tsOut.length} · clipper2-wasm paths ${wOut.length}`)
}
console.log('== region collapse: a thin gap of width g (grid units) between two squares — does the gap survive as a hole/split?')
for (const g of [0.2, 0.5, 0.8, 1, 1.5, 2]) {
  const s = 1, A = [[0, 0], [100, 0], [100, 100], [0, 100]], B = [[100 + g, 0], [200, 0], [200, 100], [100 + g, 100]]
  const r = C2.union(toTs([A, B], s), C2.FillRule.NonZero)
  console.log(`  g = ${g}: clipper2-ts paths ${r.length}`)
}

console.log('== speed: a drawing of N lines, each a 2×120-vertex outline + a 17-vertex cap at each end, union per line; and join groups of 2 lines')
const lines = N => Array.from({ length: N }, (_, i) => { const y = i * 3, pts = []; const top = [], bot = []
  for (let k = 0; k <= 120; k++) { const x = k, yy = y + 2 * Math.sin(k / 10 + i); const h = 0.6 + 0.4 * Math.sin(k / 30); top.push([x, yy + h]); bot.push([x, yy - h]) }
  return [[...top, ...bot.reverse()], halfDisc(top[0].map((v, j) => (v + bot[bot.length - 1][j]) / 2), [-1, 0], 0.6), halfDisc([120, y + 2 * Math.sin(12 + i)], [1, 0], 0.6)] })
for (const N of [100, 300]) {
  const ls = lines(N), s = 1e4
  for (const [nm, f] of [['clipper2-ts', tsUnion], ['clipper2-wasm', wUnion]]) {
    for (let warm = 0; warm < 3; warm++) for (const l of ls) f(l, s)
    const t0 = performance.now(); for (let rep = 0; rep < 5; rep++) for (const l of ls) f(l, s); const per = (performance.now() - t0) / 5
    const t1 = performance.now(); for (let rep = 0; rep < 5; rep++) for (let i = 0; i + 1 < ls.length; i += 2) f([...ls[i], ...ls[i + 1]], s); const perG = (performance.now() - t1) / 5
    console.log(`  N = ${N}, ${nm}: per-line unions ${per.toFixed(1)} ms per frame · 2-line groups ${perG.toFixed(1)} ms per frame`)
  }
}
const tInit0 = performance.now(); await Clipper2ZFactory(); console.log(`== clipper2-wasm: a second factory call ${(performance.now() - tInit0).toFixed(1)} ms (asynchronous load)`)
