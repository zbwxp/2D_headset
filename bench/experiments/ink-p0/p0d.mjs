// F1 with an exact rational reference (dot 1791790804): both F1 pieces are convex, so the exact
// intersection of the ROUNDED inputs is a Sutherland–Hodgman clip in rationals (BigInt fractions). Then
// exact union area of the rounded inputs = A0' + A1' − A∩(exact), and the library's union is compared with it:
// that difference is the operation's own error (rounding of new vertices), separate from input rounding.
import * as C2 from 'clipper2-ts'
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / len(a)), cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const areaF = l => l.reduce((s, P, i) => s + cross(P, l[(i + 1) % l.length]), 0) / 2
const ccw = l => areaF(l) < 0 ? l.slice().reverse() : l
const circle = (c, r, n) => Array.from({ length: n }, (_, i) => add(c, [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]))
const band = (P0, P1, h) => { const d = unit(sub(P1, P0)), n = [-d[1] * h, d[0] * h]; return [add(P0, n), add(P1, n), sub(P1, n), sub(P0, n)] }
// rationals: [num, den] BigInt, den > 0
const g = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
const R = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d } const k = g(n, d) || 1n; return [n / k, d / k] }
const rs = (a, b) => R(a[0] * b[1] - b[0] * a[1], a[1] * b[1]), ra = (a, b) => R(a[0] * b[1] + b[0] * a[1], a[1] * b[1]), rm = (a, b) => R(a[0] * b[0], a[1] * b[1]), rd = (a, b) => R(a[0] * b[1], a[1] * b[0])
const rsign = a => (a[0] > 0n ? 1 : a[0] < 0n ? -1 : 0)
const pt = (x, y) => [R(BigInt(x)), R(BigInt(y))]
const rcross = (o, a, b) => rs(rm(rs(a[0], o[0]), rs(b[1], o[1])), rm(rs(a[1], o[1]), rs(b[0], o[0]))) // (a−o)×(b−o)
function clipConvex(subject, clip) { // both CCW convex, rational points
  let out = subject
  for (let i = 0; i < clip.length; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length], inp = out; out = []
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length], sp = rsign(rcross(A, B, P)), sq = rsign(rcross(A, B, Q))
      if (sp >= 0) out.push(P)
      if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { // P + t (Q − P), t = cross(A,B,P) / (cross(A,B,P) − cross(A,B,Q))
        const cp = rcross(A, B, P), cq = rcross(A, B, Q), t = rd(cp, rs(cp, cq))
        out.push([ra(P[0], rm(t, rs(Q[0], P[0]))), ra(P[1], rm(t, rs(Q[1], P[1])))])
      }
    }
  }
  return out
}
const rarea2 = q => q.reduce((t, P, i) => { const Q = q[(i + 1) % q.length]; return ra(t, rs(rm(P[0], Q[1]), rm(Q[0], P[1]))) }, R(0n))
const h = 6, c = [1507.8224, 884.3168], d = unit([1, 0.0001]), body = ccw(band(sub(c, mul(d, 120)), c, h)), cap = ccw(circle(c, h, 32))
const exact = 120 * 2 * h + areaF(cap) / 2
for (const s of [1e2, 1e3, 1e4, 1e5, 1e6]) {
  const Ri = [body, cap].map(p => p.map(([x, y]) => ({ x: Math.round(x * s), y: Math.round(y * s) })))
  const Rr = Ri.map(p => p.map(q => pt(q.x, q.y)))
  const inter = clipConvex(Rr[0], Rr[1])
  const exactUnion2 = rs(ra(rarea2(Rr[0]), rarea2(Rr[1])), rarea2(inter)) // 2 × area in grid units², exact rational
  const lib = C2.union(Ri, C2.FillRule.NonZero)
  const lib2 = lib.reduce((t, q) => t + q.reduce((u, P, i) => u + BigInt(P.x) * BigInt(q[(i + 1) % q.length].y) - BigInt(q[(i + 1) % q.length].x) * BigInt(P.y), 0n), 0n)
  const opErr = (Number(lib2 * exactUnion2[1] - exactUnion2[0]) / Number(exactUnion2[1])) / 2 / (s * s) // library union − exact union of rounded inputs, drawing units²
  const inErr = Number(exactUnion2[0]) / Number(exactUnion2[1]) / 2 / (s * s) - exact // exact union of rounded inputs − true
  console.log(`s=${s.toExponential(0)}: input rounding (exact union of rounded inputs − true) ${inErr.toExponential(2)} · operation (library union − exact union of rounded inputs) ${opErr.toExponential(2)} · paths ${lib.length}`)
}
