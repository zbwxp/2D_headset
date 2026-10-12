// FAILED ATTEMPT, kept as a failure case (dot 1791781680; docs/sharp-join-F.md §5) — not a construction to use.
// Variant F here clips each stroke's end piece by the straight line from the inner to the outer meeting point
// computed on straight edges through the joint; at widths 1:3 it notches at 8°, leaves an enclosed blank at 20° and
// an open white wedge at 140° / 170°. Run: node sharp-join-F-failed-attempt.mjs 1 (writes sheet-1.svg beside it).

// A throwaway sample sheet (bench glue, not the product) for bowen 1791780683 / dot 1791780807, 1791780987: sharp
// joins (尖头接笔) drawn five ways across angles and width ratios — none presumed right. Run: node sharp-join-sheet.mjs 0|1 [long]
// (0 = widths 1:1, 1 = 1:3; long = the first sheet's longer strokes, the gap's failure sample) → sheet-<n>.svg beside it. Marks: kinks of a tip side against its stroke's outer edge,
// enclosed gaps near the joint (rasterized at 0.25 px; a crack open to the outside is NOT caught by this check), outer / inner shoulders (a square stroke end showing).
import { writeFileSync } from 'node:fs'

let POLYS = [] // the current cell's ink as polygons, for the gap check
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }

/** The part of `poly` on the side of the line through P0 along `dir` where cross(dir, X − P0) has the sign `keep`. */
function clipHalf(poly, P0, dir, keep) {
  const sideOf = X => cross(dir, sub(X, P0)) * keep, out = []
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], sp = sideOf(P), sq = sideOf(Q)
    if (sp >= 0) out.push(P)
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push(add(P, mul(sub(Q, P), t))) }
  }
  return out
}
/** A stroke of width w along cubic c: a filled outline, round cap at the free start, butt at the joined end. */
function strokeOutline(c, w, capStart, wAt = () => w, clip = null) {
  const L = [], R = []
  for (let i = 0; i <= 80; i++) { const t = i / 80, p = bez(c, t), n = unit(dbez(c, t)), nn = [-n[1], n[0]], h = wAt(t) / 2; L.push(add(p, mul(nn, h))); R.push(sub(p, mul(nn, h))) }
  let pts = [...L, ...R.reverse()]
  // F: only the stroke's end piece near the joint (t ≥ clip.t0) keeps its own side of the cut line — a local trim
  // (dot 1791781468); the side is judged from the end piece's own start, not from far along the stroke
  if (clip) {
    const k = Math.round(clip.t0 * 80), body = [...L.slice(0, k + 1), ...R.slice(80 - k)], end = [...L.slice(k), ...R.slice(0, 80 - k + 1)]
    const keep = cross(clip.dir, sub(bez(c, clip.t0), clip.P0)) >= 0 ? 1 : -1
    POLYS.push(body)
    pts = clipHalf(end, clip.P0, clip.dir, keep)
    let d0 = 'M' + body.map(q => q.map(v => v.toFixed(2)).join(',')).join(' L') + ' Z'
    if (pts.length > 2) { POLYS.push(pts); d0 += ' M' + pts.map(q => q.map(v => v.toFixed(2)).join(',')).join(' L') + ' Z' }
    if (capStart) { const q = c[0]; POLYS.push(Array.from({ length: 24 }, (_, i) => add(q, [Math.cos(i / 24 * 2 * Math.PI) * w / 2, Math.sin(i / 24 * 2 * Math.PI) * w / 2]))); d0 += ` M${(q[0] + w / 2).toFixed(2)},${q[1].toFixed(2)} a${w / 2},${w / 2} 0 1,0 ${-w},0 a${w / 2},${w / 2} 0 1,0 ${w},0` }
    return d0
  }
  POLYS.push(pts)
  let d = 'M' + pts.map(p => p.map(v => v.toFixed(2)).join(',')).join(' L') + ' Z'
  if (capStart) { const p = c[0]; POLYS.push(Array.from({ length: 24 }, (_, i) => add(p, [Math.cos(i / 24 * 2 * Math.PI) * w / 2, Math.sin(i / 24 * 2 * Math.PI) * w / 2]))); d += ` M${(p[0] + w / 2).toFixed(2)},${p[1].toFixed(2)} a${w / 2},${w / 2} 0 1,0 ${-w},0 a${w / 2},${w / 2} 0 1,0 ${w},0` }
  return d
}

/** The tip at the joint: incoming ends at p with tangent a, outgoing starts at p with tangent b; half widths h0, h1. */
function tip(a, b, p, h0, h1, variant) {
  const cosT = Math.max(-1, Math.min(1, dot(a, b))), turn = cross(a, b)
  if (Math.abs(turn) < 1e-9) return null
  const side = turn > 0 ? -1 : 1, n0 = [-a[1], a[0]], n1 = [-b[1], b[0]]
  const o0 = mul(n0, side * h0), o1 = mul(n1, side * h1)
  // the outer edges continue along a from p+o0 and back along b from p+o1: their intersection is the natural miter
  const miter = h0 === h1 ? mul(add(n0, n1), side * h0 / (1 + cosT)) : add(o0, mul(a, side * (h0 * cosT - h1) / turn))
  const limit = 5 * (h0 + h1), natural = len(miter), capped = natural > limit
  // where the two outer edges meet, measured along each edge from its own corner (A along a, B back along −b):
  // a negative distance means the edges meet inside the other stroke's body — no tip on that side, the wider
  // stroke's square end shows (a shoulder). Not a dent: the ink is continuous there.
  const sA = side * (h0 * cosT - h1) / turn, sB = side * (h1 * cosT - h0) / turn
  const shoulder = sA < 0 || sB < 0
  const apex = capped ? mul(miter, limit / natural) : miter
  const A = add(p, o0), B = add(p, o1), M = add(p, miter), X = add(p, apex)
  const f = v => v.map(x => x.toFixed(2)).join(',')
  if (variant === 'trueBevel') { POLYS.push([p, A, B]); return { d: `M${f(p)} L${f(A)} L${f(B)} Z`, capped, shoulder, A, B, X: A, sideA: sub(B, A), sideB: sub(A, B), bevel: true } }
  if (variant === 'v103' || !capped || shoulder) { POLYS.push([p, A, X, B]); return { d: `M${f(p)} L${f(A)} L${f(X)} L${f(B)} Z`, capped, shoulder, A, B, X, sideA: sub(X, A), sideB: sub(X, B) } }
  if (variant === 'bevel') {
    // cut flat across the miter at the limit: each side runs along its own outer edge up to the cut
    const m = unit(miter), sA = (limit - dot(o0, m)) / dot(a, m), sB = (limit - dot(o1, m)) / dot(mul(b, -1), m)
    const A2 = add(A, mul(a, sA)), B2 = add(B, mul(b, -sB))
    POLYS.push([p, A, A2, B2, B])
    return { d: `M${f(p)} L${f(A)} L${f(A2)} L${f(B2)} L${f(B)} Z`, capped, shoulder, A, B, X: A2, sideA: sub(A2, A), sideB: sub(B2, B) }
  }
  // the curved-side variant: each side leaves the stroke along that stroke's outer edge (its control point is the
  // natural miter, which lies on that edge's continuation) and bends to the shortened apex — tangent there, still pointed
  const q = (P0, C, P1) => Array.from({ length: 13 }, (_, i) => { const t = i / 12, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  POLYS.push([p, ...q(A, M, X), ...q(X, M, B).slice(1)])
  return { d: `M${f(p)} L${f(A)} Q${f(M)} ${f(X)} Q${f(M)} ${f(B)} Z`, capped, shoulder, A, B, X, sideA: sub(M, A), sideB: sub(M, B) }
}

const angles = [8, 20, 45, 90, 140, 170] // the interior angle between the two strokes
const ratios = [[[1, 1], [1, 3]][Number(process.argv[2] ?? 0)]]
const variants = ['v103', 'bevel', 'trueBevel', 'curved', 'blend', 'trim']
const W = 8 // the thinner stroke's width
const cell = 165, pad = 40
let body = ''
angles.forEach((deg, r) => {
  ratios.forEach(([k0, k1], ci) => variants.forEach((v, vi) => {
    POLYS = []
    const col = ci * 6 + vi, ox = pad + 90 + col * cell, oy = pad + 60 + r * cell
    const p = [ox + cell / 2 + 10, oy + cell * 0.36]
    // incoming arrives along +x (slightly curved); outgoing leaves back at the interior angle `deg`
    const th = Math.PI - deg * Math.PI / 180
    const inc = process.argv[3] === 'long' ? [[p[0] - 80, p[1] + 12], [p[0] - 55, p[1] + 2], [p[0] - 25, p[1]], p] : [[p[0] - 70, p[1] + 11], [p[0] - 48, p[1] + 2], [p[0] - 22, p[1]], p]
    const dir = [Math.cos(th), Math.sin(th)]
    // 'long' keeps the first sheet's geometry, where an enclosed gap of 0.2 px² showed at 20° / 1:3 (dot 1791781103: a
    // failure sample stays a failure sample — shortening the lines is no fix)
    const LONG = process.argv[3] === 'long'
    const outEnd = LONG ? add(p, mul(dir, 85)) : add(p, mul(dir, 70)), outC1 = LONG ? add(p, mul(dir, 28)) : add(p, mul(dir, 24)), outC2 = LONG ? add(add(p, mul(dir, 58)), [0, 6]) : add(add(p, mul(dir, 48)), [0, 5])
    const out = [p, outC1, outC2, outEnd]
    const w0 = W * k0, w1 = W * k1
    const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0))
    // 'blend': within ~2 average widths of the joint each stroke eases to the average width, so the tip is even
    const avg = (w0 + w1) / 2, ramp = (w, Lpx) => t => { const t0 = 1 - Math.min(0.6, (2 * avg) / Lpx); if (t <= t0) return w; const u = (t - t0) / (1 - t0), sm = u * u * (3 - 2 * u); return w + (avg - w) * sm }
    const blend = v === 'blend', trim = v === 'trim'
    const t = tip(a, b, p, (blend ? avg : w0) / 2, (blend ? avg : w1) / 2, blend || trim ? 'curved' : v)
    // F's cut line: from where the inner edges meet (Q) to where the outer edges meet (the natural miter M) — the
    // line along which the two offset regions meet exactly; each stroke keeps its own side, the outer tip as B
    let clip = null
    if (trim) {
      const cosT = dot(a, b), turn = cross(a, b), side = turn > 0 ? -1 : 1, h0 = w0 / 2, h1 = w1 / 2, n0 = [-a[1], a[0]]
      const M = add(p, add(mul(n0, side * h0), mul(a, side * (h0 * cosT - h1) / turn)))
      const Q = add(p, add(mul(n0, -side * h0), mul(a, -side * (h0 * cosT - h1) / turn)))
      if (Number.isFinite(M[0]) && Number.isFinite(Q[0]) && len(sub(M, Q)) > 1e-9) clip = { P0: Q, dir: unit(sub(M, Q)), t0: Math.max(0.4, 1 - 2 * Math.max(w0, w1) / 75) }
    }
    body += `<path d="${strokeOutline(inc, w0, true, blend ? ramp(w0, 85) : undefined, clip)}" fill="#111" fill-rule="nonzero"/>`
    body += `<path d="${strokeOutline([...out].reverse(), w1, true, blend ? ramp(w1, 85) : undefined, clip)}" fill="#111" fill-rule="nonzero"/>`
    if (t) {
      body += `<path d="${t.d}" fill="#111"/>`
      // a kink: the tip's side leaves the stroke's outer edge at another direction than the edge itself
      const kinkA = Math.acos(Math.max(-1, Math.min(1, dot(unit(t.sideA), a)))) * 180 / Math.PI
      const kinkB = Math.acos(Math.max(-1, Math.min(1, dot(unit(t.sideB), mul(b, -1))))) * 180 / Math.PI
      const sides = t.bevel || t.shoulder ? [] : [[kinkA, t.A], [kinkB, t.B]]
      for (const [k, P] of sides) if (k > 1) body += `<circle cx="${P[0].toFixed(1)}" cy="${P[1].toFixed(1)}" r="3.2" fill="none" stroke="#e00" stroke-width="1.6"/><text x="${(P[0] + 5).toFixed(1)}" y="${(P[1] - 5).toFixed(1)}" font-size="10" fill="#e00">${k.toFixed(0)}°</text>`
      if (t.capped) body += `<text x="${ox + 8}" y="${oy + cell - 20}" font-size="11" fill="#06c">capped at 5× avg width</text>`
      if (t.shoulder) body += `<text x="${ox + 8}" y="${oy + cell - 34}" font-size="10" fill="#c60">outer shoulder</text>`
    }
    {
      // the inner side: both strokes end square at the joint, so where the widths there differ the wider end's inner
      // corner stands out past the thinner stroke — at every angle (this sheet adds nothing on the inner side)
      const hw0 = blend ? avg : w0, hw1 = blend ? avg : w1
      if (!trim && Math.abs(hw0 - hw1) > 1e-9) body += `<text x="${ox + 8}" y="${oy + cell - 48}" font-size="10" fill="#c60">inner shoulder</text>`
    }
    {
      const inside = (P, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c } return c }
      const R = Math.ceil(Math.max(w0, w1) * 3), S = 0.25, N = Math.ceil(2 * R / S)
      const ink = new Uint8Array(N * N)
      for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) { const P = [p[0] - R + xx * S, p[1] - R + yy * S]; if (POLYS.some(poly => inside(P, poly))) ink[yy * N + xx] = 1 }
      // flood the blank from the window's border: blank not reached is enclosed — a gap inside the ink
      const seen = new Uint8Array(N * N), stack = []
      for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (!ink[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      while (stack.length) { const k = stack.pop(), x = k % N, y = (k / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const nk = ny * N + nx; if (!ink[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk) } } }
      let holes = 0, hx = 0, hy = 0
      for (let k = 0; k < N * N; k++) if (!ink[k] && !seen[k]) { holes++; hx += (k % N) * S - R; hy += ((k / N) | 0) * S - R }
      // where it is, from the joint (px), and how far that is in widths of the wider stroke
      const where = holes ? ` at (${(hx / holes).toFixed(1)}, ${(hy / holes).toFixed(1)}) = ${(Math.hypot(hx / holes, hy / holes) / Math.max(w0, w1)).toFixed(1)}w from the joint` : ''
      body += `<text x="${ox + 8}" y="${oy + 16}" font-size="10" fill="${holes ? '#e00' : '#393'}">${holes ? `gap: ${(holes * S * S).toFixed(1)} px²${where}` : 'no gap'}</text>`
    }
    body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
  }))
  body += `<text x="${pad}" y="${pad + 60 + r * cell + cell / 2}" font-size="15" fill="#333">${deg}°</text>`
})
const NAMES = { v103: 'A pull tip in', bevel: 'D clip at limit', trueBevel: 'E true bevel', curved: 'B curve sides', blend: 'C B + widths changed*', trim: 'F trim + B tip' }
ratios.forEach(([k0, k1], ci) => variants.forEach((v, vi) => {
  const col = ci * 6 + vi, x = pad + 90 + col * cell
  body += `<text x="${x + 6}" y="${pad + 40}" font-size="13" fill="#333">${k0}:${k1} · ${NAMES[v]}</text>`
}))
const height = pad * 2 + 60 + cell * angles.length, width = Math.max(pad * 2 + 90 + cell * 6, height)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 8}" font-size="14" fill="#111">Sharp join v3 — red circle: a tip side kinks against its stroke edge (deg) · top-left: enclosed gap · orange: a square stroke end shows (inner / outer shoulder) · *C changes widths near the joint (relaxes "widths unchanged")</text>${body}</svg>`
writeFileSync(new URL(`./sheet-${process.argv[2] ?? 0}${process.argv[3] === 'long' ? '-long' : ''}.svg`, import.meta.url), svg)
console.log('wrote sheet.svg', width, height)
