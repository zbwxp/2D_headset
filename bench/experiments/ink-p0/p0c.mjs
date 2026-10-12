// F1 at several scales: is the ~2e-4 area gap quantization (it must shrink as 1/s) or something else?
import * as C2 from 'clipper2-ts'
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / len(a)), cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const areaF = l => l.reduce((s, P, i) => s + cross(P, l[(i + 1) % l.length]), 0) / 2
const ccw = l => areaF(l) < 0 ? l.slice().reverse() : l
const circle = (c, r, n) => Array.from({ length: n }, (_, i) => add(c, [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]))
const band = (P0, P1, h) => { const d = unit(sub(P1, P0)), n = [-d[1] * h, d[0] * h]; return [add(P0, n), add(P1, n), sub(P1, n), sub(P0, n)] }
const h = 6, c = [1507.8224, 884.3168], d = unit([1, 0.0001]), body = ccw(band(sub(c, mul(d, 120)), c, h)), cap = ccw(circle(c, h, 32))
const exact = 120 * 2 * h + areaF(cap) / 2
for (const s of [1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]) {
  const R = [body, cap].map(p => p.map(([x, y]) => ({ x: Math.round(x * s), y: Math.round(y * s) })))
  // the exact area of the union of the ROUNDED inputs: area(body') + area(cap') − area(body' ∩ cap'), each from the library in integers (exact)
  // exact: twice the area as a BigInt in grid units², then one division (the comparison itself no longer loses precision)
  const A2 = q => q.reduce((t, P, i) => t + BigInt(P.x) * BigInt(q[(i + 1) % q.length].y) - BigInt(q[(i + 1) % q.length].x) * BigInt(P.y), 0n)
  const A = q => Number(A2(q)) / 2 / (s * s)
  const exactRoundedDiff = (u, R0, R1, I) => { const tot = u.reduce((t, q) => t + A2(q), 0n) - (A2(R0) + A2(R1) - I.reduce((t, q) => t + A2(q), 0n)); return Number(tot) / 2 / (s * s) }
  const u = C2.union(R, C2.FillRule.NonZero), inter = C2.intersect([R[0]], [R[1]], C2.FillRule.NonZero)
  const Au = u.reduce((t, q) => t + A(q), 0), Ai = inter.reduce((t, q) => t + A(q), 0)
  console.log(`s=${s.toExponential(0)}: union ${Au.toFixed(9)} · vs true ${(Au - exact).toExponential(2)} · vs rounded inputs (A0'+A1'−A∩', exact in integers) ${exactRoundedDiff(u, R[0], R[1], inter).toExponential(2)} · paths ${u.length}`)
}
