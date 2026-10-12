import * as C2 from 'clipper2-ts'
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / len(a)), cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const areaF = l => l.reduce((s, P, i) => s + cross(P, l[(i + 1) % l.length]), 0) / 2
const ccw = l => areaF(l) < 0 ? l.slice().reverse() : l
const circle = (c, r, n) => Array.from({ length: n }, (_, i) => add(c, [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]))
const band = (P0, P1, h) => { const d = unit(sub(P1, P0)), n = [-d[1] * h, d[0] * h]; return [add(P0, n), add(P1, n), sub(P1, n), sub(P0, n)] }
const toTs = (polys, s) => polys.map(p => p.map(([x, y]) => ({ x: Math.round(x * s), y: Math.round(y * s) })))
const fromTs = (paths, s) => paths.map(p => p.map(q => [q.x / s, q.y / s]))
const S = 1e4
{ const h = 6, c = [1507.8224, 884.3168], d = unit([1, 0.0001]), body = band(sub(c, mul(d, 120)), c, h), cap = circle(c, h, 32)
  console.log('orientations: body', Math.sign(areaF(body)), 'cap', Math.sign(areaF(cap)))
  const exact = 240 * h + areaF(cap) / 2
  const r = fromTs(C2.union(toTs([ccw(body), ccw(cap)], S), C2.FillRule.NonZero), S)
  console.log(`F1 with consistent orientation: paths ${r.length}, area ${r.reduce((t, l) => t + areaF(l), 0).toFixed(6)} (expected ${exact.toFixed(6)})`)
  const r2 = fromTs(C2.union(toTs([body, cap], S), C2.FillRule.Positive), S)
  console.log(`F1 mixed orientation, rule Positive: paths ${r2.length}`)
}
// the library's own rounding: exact crossings of the ROUNDED input edges (in grid units), against the output vertices
let worstOwn = 0, worstFromTrue = 0, minSin = 1
for (let k = 0; k < 200; k++) {
  const th = 0.1 + k * 0.0137, a = band([0, 0], [50, 0], 2), b = band([25 - 30 * Math.cos(th), -30 * Math.sin(th)], [25 + 30 * Math.cos(th), 30 * Math.sin(th)], 1.3)
  const [A, B] = toTs([ccw(a), ccw(b)], S).map(p => p.map(q => [q.x, q.y]))
  const edges = q => q.map((P, i) => [P, q[(i + 1) % q.length]]), ex = []
  for (const [P, Q] of edges(A)) for (const [R, T] of edges(B)) { const d1 = sub(Q, P), d2 = sub(T, R), den = cross(d1, d2); if (Math.abs(den) < 1e-12) continue; const w = sub(R, P), u = cross(w, d2) / den, v = cross(w, d1) / den; if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { ex.push(add(P, mul(d1, u))); minSin = Math.min(minSin, Math.abs(den) / (len(d1) * len(d2))) } }
  const out = C2.union([A.map(([x, y]) => ({ x, y })), B.map(([x, y]) => ({ x, y }))], C2.FillRule.NonZero).flat().map(q => [q.x, q.y])
  for (const X of ex) worstOwn = Math.max(worstOwn, Math.min(...out.map(P => len(sub(P, X)))))
}
console.log(`own rounding of new crossings (vs exact crossing of the rounded input): worst ${worstOwn.toFixed(3)} grid units (≤ √2/2 = 0.707 expected); smallest crossing sine ${minSin.toFixed(3)} → input rounding alone can move a crossing by up to ≈ 0.5/sin = ${(0.5 / minSin).toFixed(2)} units`)
