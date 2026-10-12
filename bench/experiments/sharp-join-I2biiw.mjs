// An experiment, not the product (docs/sharp-join-F.md §4 I2b-ii-w; dot 1791786707, 1791786993, 1791787018): the I2b-ii
// cells finished WITHIN ℓ — straight bands only. Only W's inner half width changes inside its zone: a cubic Hermite h_in(s)
// (s from p along W) with h_in(0) = h_t / cos θ, h_in′(0) = tan θ (W's inner edge meets T's outer-edge line — the tip's
// edge — tangentially at the junction J) and h_in(ℓ) = h_w, h_in′(ℓ) = 0 (back onto W's own line at the cut). W's outer
// edge, T and everything beyond ℓ untouched; no trim region. Readings: the height y of the narrowed edge above T's line on
// (0, ℓ] (min, sign changes), y′(0), h_in monotone, width / slope at the cut, folds, the outline's turn at J, J's place
// along T's line from A, the hump's height, the ink removed (shared extractor on the predicate "in W's original end piece,
// not in T, not in the narrowed W") beside the trim-to-R1 variant's; loops / holes against the input alone, open, bad,
// crossings, the tip, 12 rotations. Run: node sharp-join-I2biiw.mjs → I2biiw.svg beside it.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, meet, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
const inkOf = polys => { const bs = polys.map(box); return P => polys.some((q, i) => P[0] >= bs[i][0] && P[0] <= bs[i][2] && P[1] >= bs[i][1] && P[1] <= bs[i][3] && insideEO(P, q)) }
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }
/** The area of a region given by its extracted loops (outer loops minus holes). */
const regionArea = u => { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)) || 1; return u.loops.reduce((acc, l) => acc + sg * area(l), 0) }
function cap(O, I, back, n = 16) {
  const c = mul(add(O, I), 0.5), h = len(sub(O, I)) / 2, a0 = Math.atan2(O[1] - c[1], O[0] - c[0])
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [O, ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), I]
}
/** Cubic Hermite on [0, L]: value and derivative. */
const hermite = (v0, m0, v1, m1, L) => s => { const t = s / L, t2 = t * t, t3 = t2 * t; return [(2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * L * m1, ((6 * t2 - 6 * t) * v0 + (3 * t2 - 4 * t + 1) * L * m0 + (-6 * t2 + 6 * t) * v1 + (3 * t2 - 2 * t) * L * m1) / L] }

const angles = [2, 3, 4, 5, 6]
const cols = [[1, 3, 3], [3, 1, 3], [1, 2, 3], [2, 1, 3], [1, 3, 6], [3, 1, 6]]
const W = 4, cell = 300, pad = 30, NS = 240
let body = '', focus = null
angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.8, oy + cell * 0.3]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1), th = deg * Math.PI / 180
  const hw = Math.max(h0, h1), ht = Math.min(h0, h1), d1 = (hw * Math.cos(th) - ht) / Math.sin(th), Lb = Math.max(ell, d1) + 40
  const a = [1, 0], b = [Math.cos(Math.PI - th), Math.sin(Math.PI - th)]
  const side = cross(a, b) > 0 ? -1 : 1, o0 = mul([-a[1], a[0]], side * h0), o1 = mul([-b[1], b[0]], side * h1), A = add(p, o0), B = add(p, o1)
  const mi = meet(sub(p, o0), mul(a, -1), sub(p, o1), b), I1 = mi && mi.s >= 0 && mi.s <= ell && mi.t >= 0 && mi.t <= ell
  const cls = I1 ? 'I1' : !(hw * Math.cos(th) > ht + 1e-12) ? 'I2a' : d1 <= ell ? 'I2b-i' : 'I2b-ii'
  const mo = meet(A, a, B, mul(b, -1)), M = add(A, mul(a, mo.s)), outerCls = len(sub(M, p)) > limit ? 'O2' : 'O1'
  let label = `${outerCls} × ${cls}`
  if (cls !== 'I2b-ii') { body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#a50">${label}</text>` + readingLines(ox + 6, oy + cell - 60, `not I2b-ii here (d1 = ${d1.toFixed(1)}, ℓ = ${ell}) — not drawn`) + `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`; return }
  label += ' — finished within ℓ (inner side narrowed)'
  const tIs0 = h0 <= h1, dT = tIs0 ? a : mul(b, -1), oT = tIs0 ? o0 : o1, dW = tIs0 ? b : mul(a, -1), oW = tIs0 ? o1 : o0
  const nOut = unit(oW), nIn = mul(nOut, -1) // W's outer / inner normals
  const quad = (P0, C, P1) => Array.from({ length: 24 }, (_, i) => { const t = (i + 1) / 24, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  const tip = outerCls === 'O1' ? [p, A, M, B] : (() => { const X = add(p, mul(sub(M, p), limit / len(sub(M, p)))); return [p, A, ...quad(A, add(A, mul(a, Math.sqrt(limit * limit - h0 * h0))), X), ...quad(X, add(B, mul(b, -Math.sqrt(limit * limit - h1 * h1))), B)] })()
  const band = (P0, P1, o) => [add(P0, o), add(P1, o), sub(P1, o), sub(P0, o)]
  const Tfree = sub(p, mul(dT, Lb)), Wfree = add(p, mul(dW, Lb)), Wcut = add(p, mul(dW, ell))
  // the narrowed inner half width
  const H = hermite(ht / Math.cos(th), Math.tan(th), hw, 0, ell)
  const ss = Array.from({ length: NS + 1 }, (_, i) => ell * i / NS) // includes s = ℓ exactly
  const inner = ss.map(s => add(add(p, mul(dW, s)), mul(nIn, H(s)[0]))), outer = ss.map(s => add(add(p, mul(dW, s)), mul(nOut, hw)))
  const Wend = [...outer, ...inner.slice().reverse()] // p's outer corner B … cut … p's narrowed inner corner J
  const J = inner[0], Tc = add(p, oT)
  const pieces = [band(Tfree, p, oT), cap(add(Tfree, oT), sub(Tfree, oT), mul(dT, -1)), Wend, band(Wcut, Wfree, oW), cap(add(Wfree, oW), sub(Wfree, oW), dW), tip]
  const u = regionOutline(pieces, inkOf(pieces)), topo = topology(u)
  const WendOrig = band(p, Wcut, oW), inPieces = [band(Tfree, p, oT), band(p, Wfree, oW), pieces[1], pieces[4]]
  const input = topology(regionOutline(inPieces, inkOf(inPieces)))
  let crossings = 0
  for (let i = 0; i < u.segs.length; i++) for (let j = i + 1; j < u.segs.length; j++) if (segCross(u.segs[i][0], u.segs[i][1], u.segs[j][0], u.segs[j][1])) crossings++
  // y: the narrowed edge's height above T's outer-edge line (positive outside T)
  const outT = unit(oT), y = P => dot(sub(P, Tc), outT)
  const ys = inner.map(y), yMin = Math.min(...ys.slice(1)), signChanges = ys.slice(1).reduce((n, v, i) => n + (i > 0 && Math.sign(v) !== Math.sign(ys[i]) ? 1 : 0), 0)
  const y1 = (ys[1] - ys[0]) / (ell / NS) // y′(0) numerically
  const hs = ss.map(s => H(s)[0]), mono = hs.every((v, i) => i === 0 || v >= hs[i - 1] - 1e-12)
  const folds = inner.reduce((n, P, i) => n + (i > 0 && dot(sub(P, inner[i - 1]), dW) <= 0 ? 1 : 0), 0)
  const near = (P, Q) => len(sub(P, Q)) < 1e-6
  const into = u.segs.find(([, E]) => near(E, J)), outOf = u.segs.find(([S0]) => near(S0, J))
  const turnJ = into && outOf ? Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(into[1], into[0])), unit(sub(outOf[1], outOf[0])))))) * 180 / Math.PI : null
  const onOutline = P => u.segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
  const jAlong = dot(sub(J, Tc), dT) // J's place along T's line from A (positive: towards the tip)
  // the hump: the highest exposed point of W's inner edge above T's line — the narrowed part, and the original beyond ℓ (falls to 0 at R1)
  const hump = Math.max(...ys, (d1 - ell) * Math.sin(th))
  // ink removed: in W's original end piece, not in T, not in the narrowed W (predicate region, shared extractor)
  const inT = inkOf([band(Tfree, p, oT)]), inWo = inkOf([WendOrig]), inWn = inkOf([Wend])
  const rem = regionOutline([WendOrig, band(Tfree, p, oT), Wend], P => inWo(P) && !inT(P) && !inWn(P)), removed = regionArea(rem)
  const r1Total = 0.5 * d1 * d1 * Math.tan(th), r1Beyond = 0.5 * (d1 - ell) ** 2 * Math.tan(th)
  const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
  const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
  const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => { const q = pieces.map(x => x.map(fn)), w = regionOutline(q, inkOf(q)), t = topology(w); return !(t.loops === topo.loops && t.holes === topo.holes && !w.openChains.length && !w.badVertices) }).map(([tag]) => tag + rr))
  const tipReach = Math.max(...tip.slice(1).map(P => len(sub(P, p))))
  const ok = yMin > 0 && signChanges === 0 && mono && folds === 0
  const note = [ok ? '' : 'NOT COVERED (crosses, folds or not monotone)', `d1 ${d1.toFixed(1)} vs ℓ ${ell}`, `y on (0, ℓ]: min ${yMin.toExponential(2)}, sign changes ${signChanges}`, `y′(0) ≈ ${y1.toExponential(1)}`,
    `h_in monotone: ${mono ? 'yes' : 'NO'}`, `width at the cut ${(H(ell)[0] + hw).toFixed(6)} (own ${(2 * hw).toFixed(6)}), slope ${H(ell)[1].toExponential(1)}`, `folds ${folds}`,
    turnJ !== null ? `turn at J ${turnJ.toFixed(3)}°` : onOutline(J) ? 'J inside an outline sub-edge' : 'J NOT ON THE OUTLINE', `J ${jAlong.toFixed(3)} along T's line from A`, `hump ${hump.toFixed(3)}`,
    `removed ${removed.toFixed(3)} (all within ℓ)`, `trim-to-R1: ${r1Total.toFixed(3)}, ${r1Beyond.toFixed(3)} of it beyond ℓ`,
    `loops ${topo.loops}, holes ${topo.holes} (input alone ${input.loops}, ${input.holes})`, `open ${u.openChains.length}`, `bad ${u.badVertices}`, `crossings ${crossings}`, `tip ${tipReach.toFixed(1)} / ${limit}`, `rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12'}`].filter(Boolean).join(' · ')
  const marks = { loops: u.loops, openChains: u.openChains, cut: [add(Wcut, oW), sub(Wcut, oW)], J, p, removed: rem.loops }
  if (deg === 2 && k0 === 1 && k1 === 3 && k === 3) focus = { ...marks, label: `${deg}° · ${k0}:${k1} · k = ${k} — ${label}` }
  body += drawFitted(marks, ox + 8, oy + 22, cell - 22, cell * 0.42)
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#363">${label}</text>`
  body += readingLines(ox + 6, oy + cell * 0.42 + 40, note, { maxChars: 52, fill: /FAIL|NOT|NO\b|open [1-9]|bad [1-9]|· crossings [1-9]|folds [1-9]|sign changes [1-9]/.test(note) ? '#e00' : '#555' })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
function drawFitted(m, x, y, w, h) {
  const pts = [...m.loops.flat(), ...m.cut, m.J, m.p]
  const xs = pts.map(P => P[0]), ys = pts.map(P => P[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const k = Math.min(w / (x1 - x0 || 1), h / (y1 - y0 || 1)), tx = x + (w - k * (x1 - x0)) / 2 - k * x0, ty = y + (h - k * (y1 - y0)) / 2 - k * y0
  const T = P => [tx + k * P[0], ty + k * P[1]], path = (l, z) => 'M' + l.map(P => f(T(P))).join(' L') + (z ? ' Z' : '')
  let out = `<path d="${m.loops.map(l => path(l, true)).join(' ')}" fill="#111"/>`
  if (m.removed.length) out += `<path d="${m.removed.map(l => path(l, true)).join(' ')}" fill="#e00" opacity="0.85"/>`
  out += `<path d="${path(m.cut, false)}" stroke="#36c" stroke-width="1" stroke-dasharray="3,2"/>`
  out += `<circle cx="${T(m.J)[0]}" cy="${T(m.J)[1]}" r="2.6" fill="#0a8"/><circle cx="${T(m.p)[0]}" cy="${T(m.p)[1]}" r="2" fill="#e80"/>`
  for (const ch of m.openChains) out += `<path d="${path(ch, false)}" fill="none" stroke="#e00"/>`
  return out + `<text x="${x + w - 4}" y="${y + h + 12}" font-size="8" fill="#888" text-anchor="end">×${k.toFixed(2)}</text>`
}
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 3}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${W})</text>` })
const gridW = pad * 2 + 70 + cell * cols.length, panelY = pad + 50 + cell * angles.length + 30, panelH = 360
if (focus) {
  body += `<text x="${pad}" y="${panelY - 8}" font-size="12">Enlarged: ${focus.label} — ℓ cut blue dashes, junction J green, ink removed (within ℓ) red, p orange (uniform scale)</text>`
  body += drawFitted(focus, pad, panelY, gridW - 2 * pad, panelH)
  body += `<rect x="${pad - 4}" y="${panelY - 4}" width="${gridW - 2 * pad + 8}" height="${panelH + 22}" fill="none" stroke="#ddd"/>`
}
const size = Math.max(gridW, panelY + panelH + 40)
writeFileSync(new URL('./I2biiw.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">I2b-ii-w, straight bands — finished within ℓ: W's inner side narrowed (Hermite, tangent to T's outer edge at J); ℓ cut blue dashes, J green, removed ink red; each cell fitted to its whole outline</text>${body}</svg>`)
console.log('wrote I2biiw.svg', size)
