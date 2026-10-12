// An experiment, not the product (docs/sharp-join-F.md §4 I2b-ii-w, on curves; dot 1791787379, 1791787478, 1791787531):
// the I2b-ii cells on REAL curved strokes, finished within ℓ by narrowing W's inner side only. Every quantity from the
// actual curves: J = the first hit of the ray p + n_in(0)·h on T's actual outer offset curve (all hits counted); h_in(0)
// = that h; h_in′(0) = −(1 − κ_in(0)·h_in(0))·(t_W × τ_J) / (n_in × τ_J) (tangent at J; κ_in W's curvature signed along
// its inner normal, analytic from the cubic); h_in(ℓ) = h_w, h_in′(ℓ) = 0; a cubic Hermite in W's polyline arc length,
// a sample inserted at s = ℓ. Checked per cell on the samples — no general guarantee on curves: h_in within its end values,
// every narrowed-edge sample on (0, ℓ] outside T and every narrowed-edge segment free of crossings with T's outline, no
// fold, J on the final outline, the direction −E′(0)·τ_J > 0, the sampled turns at J and at the cut, the hump, the ink
// removed (the strip between the two inner edges) — plus topology against the input alone, open, bad, crossings, the tip, 12 rotations.
// The derivative formula holds for true arc length; with polyline arc length and analytic curvature it is approximate,
// so the sampled turns are what is reported. Run: node sharp-join-I2biiw-curves.mjs → I2biiw-curves.svg beside it.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1)), left = v => [-v[1], v[0]]
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }
const ddbez = (c, t) => [0, 1].map(i => 6 * (1 - t) * (c[2][i] - 2 * c[1][i] + c[0][i]) + 6 * t * (c[3][i] - 2 * c[2][i] + c[1][i]))
const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
const inkOf = polys => { const bs = polys.map(box); return P => polys.some((q, i) => P[0] >= bs[i][0] && P[0] <= bs[i][2] && P[1] >= bs[i][1] && P[1] <= bs[i][3] && insideEO(P, q)) }
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }
const hermite = (v0, m0, v1, m1, L) => s => { const t = Math.min(1, s / L), t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * L * m1 }
function cap(O, I, back, n = 16) {
  const c = mul(add(O, I), 0.5), h = len(sub(O, I)) / 2, a0 = Math.atan2(O[1] - c[1], O[0] - c[0])
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [O, ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), I]
}
/**
 * A stroke sampled along its cubic from t = 0 to 1, with a sample inserted at polyline arc length `cut` measured from
 * the t = 0 end; outer / inner half widths as functions of that arc length; `outerSign` picks the outer side of the
 * left normal.
 */
function sampled(c, hOut, hIn, outerSign, cut, N = 300) {
  const ts = Array.from({ length: N + 1 }, (_, i) => i / N), P0 = ts.map(t => bez(c, t)), S0 = [0]
  for (let i = 1; i <= N; i++) S0.push(S0[i - 1] + len(sub(P0[i], P0[i - 1])))
  const i = S0.findIndex(v => v > cut) - 1
  if (i >= 0 && S0[i] < cut) { let lo = ts[i], hi = ts[i + 1]; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (S0[i] + len(sub(bez(c, m), P0[i])) < cut) lo = m; else hi = m } ts.splice(i + 1, 0, (lo + hi) / 2) }
  const C = ts.map(t => bez(c, t)), T = ts.map(t => unit(dbez(c, t))), S = [0]
  for (let k = 1; k < C.length; k++) S.push(S[k - 1] + len(sub(C[k], C[k - 1])))
  const z = S.findIndex(v => Math.abs(v - cut) < 1e-9)
  const nOut = T.map(t => mul(left(t), outerSign)), O = C.map((P, k) => add(P, mul(nOut[k], hOut(S[k])))), I = C.map((P, k) => sub(P, mul(nOut[k], hIn(S[k]))))
  return { C, T, S, O, I, z, nOut, ts }
}
/** T's side of T's outer offset curve and its forward extension (as the curve sheet). */
function sideOf(O, I, dirEnd, big = 400) {
  const n = O.length - 1, inN = unit(sub(I[n], O[n])), in0 = unit(sub(I[0], O[0])), d0 = unit(sub(O[1], O[0]))
  const fwd = add(O[n], mul(dirEnd, big)), back = sub(O[0], mul(d0, big))
  return [...O, fwd, add(fwd, mul(inN, big)), add(back, mul(in0, big)), back]
}

const angles = [2, 3, 4, 6], bends = [7, -7]
const cols = [[1, 3, 3], [3, 1, 3], [1, 2, 3], [2, 1, 3]]
const Wd = 4, cell = 320, pad = 30
let body = '', focus = null
const rows = angles.flatMap(deg => bends.map(bend => [deg, bend]))
rows.forEach(([deg, bend], r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 110 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.8, oy + cell * 0.3]
  const h0 = Wd * k0 / 2, h1 = Wd * k1 / 2, ell = k * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1), L = 170
  const th = Math.PI - deg * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)]
  const inc = [[p[0] - L, p[1] + 14], [p[0] - L * 0.66, p[1] + 3], [p[0] - L * 0.3, p[1]], p] // as the curve sheets
  const out = [p, add(p, mul(dir, L * 0.33)), add(add(p, mul(dir, L * 0.66)), [0, bend]), add(p, mul(dir, L))]
  const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0)), side = cross(a, b) > 0 ? -1 : 1
  // T (thinner) and W (wider), each sampled from p outwards (W) or from its free end to p (T, reversed below)
  const tIs0 = h0 <= h1, ht = Math.min(h0, h1), hw = Math.max(h0, h1)
  const cT = tIs0 ? inc : [...out].reverse(), cW = tIs0 ? out : [...inc].reverse() // T: free end → p; W: p → free end
  const sT = tIs0 ? side : -side, sW = tIs0 ? side : -side // outer side of each, in the curve sheet's convention
  const Tst = sampled(cT, () => ht, () => ht, sT, Math.max(0, (() => { let s = 0, P = cT[0]; for (let i = 1; i <= 400; i++) { const Q = bez(cT, i / 400); s += len(sub(Q, P)); P = Q } return s })() - ell))
  const Wo = sampled(cW, () => hw, () => hw, sW, ell) // W at its own width (the input), from p (reversing a stroke flips its left normal, so the same sign as in the curve sheet)
  const A = Tst.O[Tst.O.length - 1], B = Wo.O[0]
  const HT = sideOf(Tst.O, Tst.I, unit(sub(A, Tst.O[Tst.O.length - 2])))
  // class: I2b-ii = W's own inner corner outside T's side and W's own inner edge not back on T's side anywhere in (0, ℓ]
  const zW = Wo.z, cornerOut = !insideEO(Wo.I[0], HT), backIn = Wo.I.slice(1, zW + 1).some(P => insideEO(P, HT))
  let label = cornerOut && !backIn ? 'I2b-ii' : cornerOut ? 'I2b-i' : 'I1 / I2a'
  const cellFrame = `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
  if (label !== 'I2b-ii') { body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#a50">${label}</text>` + readingLines(ox + 6, oy + cell - 60, 'not I2b-ii here — not drawn') + cellFrame; return }
  // J: the ray p + n_in(0)·h against T's actual outer offset polyline — every hit counted, the first (smallest h) chosen
  const nIn0 = mul(Wo.nOut[0], -1), hits = []
  for (let i = 0; i + 1 < Tst.O.length; i++) { const P = Tst.O[i], Q = Tst.O[i + 1], d = sub(Q, P), den = cross(nIn0, d); if (Math.abs(den) < 1e-14) continue; const w = sub(P, p), hh = cross(w, d) / den, uu = cross(w, nIn0) / den; if (hh > 1e-9 && uu >= 0 && uu <= 1) hits.push({ h: hh, i, uu }) }
  hits.sort((x, y) => x.h - y.h)
  const notes = []
  if (!hits.length) { body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#a50">I2b-ii — no J (the ray misses T's outer edge) — not covered</text>` + cellFrame; return }
  const jh = hits[0], hJ = jh.h, J = add(p, mul(nIn0, hJ)), tauJ = unit(sub(Tst.O[jh.i + 1], Tst.O[jh.i])) // τ_J pointing towards A
  const jFromA = -((Tst.S[Tst.S.length - 1] - Tst.S[jh.i]) - jh.uu * len(sub(Tst.O[jh.i + 1], Tst.O[jh.i]))) // arc length along T's centre samples, negative = behind A
  const inZoneT = (Tst.S[Tst.S.length - 1] - Tst.S[jh.i]) <= ell
  // W's curvature at p signed along its inner normal (analytic): t′ = κ_in·n_in
  const d1v = dbez(cW, 0), d2v = ddbez(cW, 0), kLeft = cross(d1v, d2v) / len(d1v) ** 3, kIn = kLeft * dot(left(unit(d1v)), nIn0)
  const tW = unit(d1v), num = cross(tW, tauJ), den = cross(nIn0, tauJ), m0 = -(1 - kIn * hJ) * num / den
  const H = hermite(hJ, m0, hw, 0, ell), hIn = s => (s <= ell ? H(s) : hw)
  const Wn = sampled(cW, () => hw, hIn, sW, ell) // the narrowed W
  const E = Wn.I.slice(0, Wn.z + 1) // the narrowed inner edge on [0, ℓ]
  // E′(0) by the formula, and the direction check: arriving at J (−E′(0)) and leaving towards A (τ_J) must agree
  const Ep0 = add(mul(tW, 1 - kIn * hJ), mul(nIn0, m0)), dirOK = dot(mul(Ep0, -1), tauJ) > 0
  // pieces
  const Tband = [...Tst.O, ...Tst.I.slice().reverse()], Tcap = cap(Tst.O[0], Tst.I[0], mul(Tst.T[0], -1))
  const zN = Wn.z, Wend = [...Wn.O.slice(0, zN + 1), ...Wn.I.slice(0, zN + 1).reverse()], Wbody = [...Wn.O.slice(zN), ...Wn.I.slice(zN).reverse()]
  const nW = Wn.C.length - 1, Wcap = cap(Wn.O[nW], Wn.I[nW], Wn.T[nW])
  const outerA = tIs0 ? A : B, outerB = tIs0 ? B : A // S0's outer corner and S1's outer corner (a, b as the curve sheet)
  // M: S0's outer edge forward along a from outerA meets S1's outer edge back along −b from outerB
  const mo = (() => { const dA = a, dB = mul(b, -1), dd = cross(dA, dB); if (Math.abs(dd) < 1e-12) return null; const w = sub(outerB, outerA); return { s: cross(w, dB) / dd, t: cross(w, dA) / dd } })()
  const M = mo && mo.s >= 0 && mo.t >= 0 ? add(outerA, mul(a, mo.s)) : null
  if (!M) { body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#a50">I2b-ii — no forward tip (O3) — not covered</text>` + cellFrame; return }
  const outerCls = len(sub(M, p)) > limit ? 'O2' : 'O1'
  const quad = (P0, C, P1) => Array.from({ length: 24 }, (_, i) => { const t = (i + 1) / 24, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  const ha = len(sub(outerA, p)), hb = len(sub(outerB, p))
  const tip = outerCls === 'O1' ? [p, outerA, M, outerB] : (() => { const X = add(p, mul(sub(M, p), limit / len(sub(M, p)))); return [p, outerA, ...quad(outerA, add(outerA, mul(a, Math.sqrt(limit * limit - ha * ha))), X), ...quad(X, add(outerB, mul(b, -Math.sqrt(limit * limit - hb * hb))), outerB)] })()
  const pieces = [Tband, Tcap, Wend, Wbody, Wcap, tip]
  const u = regionOutline(pieces, inkOf(pieces)), topo = topology(u)
  const inPieces = [Tband, Tcap, [...Wo.O, ...Wo.I.slice().reverse()], cap(Wo.O[Wo.O.length - 1], Wo.I[Wo.I.length - 1], Wo.T[Wo.T.length - 1])]
  const input = topology(regionOutline(inPieces, inkOf(inPieces)))
  let crossings = 0
  for (let i = 0; i < u.segs.length; i++) for (let j = i + 1; j < u.segs.length; j++) if (segCross(u.segs[i][0], u.segs[i][1], u.segs[j][0], u.segs[j][1])) crossings++
  const near = (P, Q) => len(sub(P, Q)) < 1e-6
  const onOutline = P => u.segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
  // the conditions, on the samples
  const hs = Wn.S.slice(0, zN + 1).map(hIn), hLo = Math.min(hJ, hw) - 1e-9, hHi = Math.max(hJ, hw) + 1e-9, within = hs.every(v => v >= hLo && v <= hHi)
  const inT = inkOf([Tband, Tcap]), samplesOut = E.slice(1).every(P => !inT(P) && !insideEO(P, HT))
  const Tsegs = [Tband, Tcap].flatMap(q => q.map((P, i) => [P, q[(i + 1) % q.length]]))
  let segHits = 0
  for (let i = 0; i + 1 < E.length; i++) for (const [P, Q] of Tsegs) if (segCross(E[i], E[i + 1], P, Q)) segHits++
  const folds = E.reduce((n, P, i) => n + (i > 0 && dot(sub(P, E[i - 1]), Wn.T[i - 1]) <= 0 ? 1 : 0), 0) + (1 - kIn * hJ > 0 ? 0 : 1)
  const ang = (v, w) => Math.acos(Math.max(-1, Math.min(1, dot(unit(v), unit(w))))) * 180 / Math.PI
  const into = u.segs.find(([, Q]) => near(Q, J)), outOf = u.segs.find(([P]) => near(P, J))
  const turnJ = into && outOf ? ang(sub(into[1], into[0]), sub(outOf[1], outOf[0])) : null
  const turnCut = ang(sub(E[zN], E[zN - 1]), sub(Wn.I[zN + 1], Wn.I[zN]))
  const distToT = P => { let best = Infinity; for (let i = 0; i + 1 < Tst.O.length; i++) { const A0 = Tst.O[i], d = sub(Tst.O[i + 1], A0), t = Math.max(0, Math.min(1, dot(sub(P, A0), d) / dot(d, d))); best = Math.min(best, len(sub(P, add(A0, mul(d, t))))) } return best }
  const hump = Math.max(...E.map(distToT))
  // the ink removed: the strip between W's own inner edge and the narrowed one on [0, ℓ], closed by W's end face at p
  // (C_W → J) — all of it outside T, since the narrowed edge is checked to lie outside T. Measured on that polygon directly:
  // the strip narrows to nothing at the cut (tangent there by design), thinner than the extractor's 1e-5 side offset, so
  // the predicate extraction left an open chain in three 1:3 cells (the known limit, outline.mjs)
  const strip = [...Wo.I.slice(0, zW + 1), ...Wn.I.slice(0, zN + 1).reverse()], removed = Math.abs(area(strip))
  // the strip equals the ink actually removed only if no other ink covers it (dot 1791787928): points inside the strip —
  // at each sample between the two inner edges, at 1/4, 1/2 and 3/4 of the way — tested against the final ink
  const finalInk = inkOf(pieces)
  let stripHits = 0, probes = 0
  for (let i = 1; i < Math.min(zW, zN); i++) for (const w of [0.25, 0.5, 0.75]) { if (len(sub(Wo.I[i], Wn.I[i])) < 1e-4) continue; probes++; if (finalInk(add(mul(Wn.I[i], 1 - w), mul(Wo.I[i], w)))) stripHits++ }
  const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
  const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
  const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => { const q = pieces.map(x => x.map(fn)), w = regionOutline(q, inkOf(q)), t = topology(w); return !(t.loops === topo.loops && t.holes === topo.holes && !w.openChains.length && !w.badVertices) }).map(([tag]) => tag + rr))
  const tipReach = Math.max(...tip.slice(1).map(P => len(sub(P, p))))
  const covered = within && samplesOut && segHits === 0 && folds === 0 && onOutline(J) && dirOK && inZoneT
  label = `${outerCls} × I2b-ii — within ℓ, curves${covered ? '' : ' — NOT COVERED'}`
  const note = [`ray hits on T's outer edge ${hits.length}, J the first: ${jFromA.toFixed(3)} from A along T${inZoneT ? '' : ' (OUTSIDE T\'s zone)'}`, `|n_in×τ_J| ${Math.abs(den).toFixed(4)}`, `1−κh at J ${(1 - kIn * hJ).toFixed(4)}`,
    `h_in(0) ${hJ.toFixed(4)}, h_in′(0) ${m0.toFixed(4)}`, `direction −E′(0)·τ_J ${dot(mul(Ep0, -1), tauJ).toFixed(4)}${dirOK ? '' : ' WRONG'}`,
    `h_in within its end values: ${within ? 'yes' : 'NO'}`, `samples outside T: ${samplesOut ? 'yes' : 'NO'}`, `segment crossings with T ${segHits}`, `folds ${folds}`,
    `J on the outline: ${onOutline(J) ? 'yes' : 'NO'}`, turnJ !== null ? `sampled turn at J ${turnJ.toFixed(3)}°` : 'J inside an outline sub-edge', `sampled turn at the cut ${turnCut.toFixed(3)}°`,
    `hump ${hump.toFixed(3)}`, `removed ${removed.toFixed(3)} (within ℓ)`, `strip probes covered by other ink ${stripHits}/${probes}`, `loops ${topo.loops}, holes ${topo.holes} (input alone ${input.loops}, ${input.holes})`, `open ${u.openChains.length}`, `bad ${u.badVertices}`, `crossings ${crossings}`,
    `tip ${tipReach.toFixed(1)} / ${limit}`, `rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12'}`].join(' · ')
  const marks = { loops: u.loops, openChains: u.openChains, removed: [strip], cut: [Wn.O[zN], Wn.I[zN]], J, p }
  if (deg === 2 && bend > 0 && k0 === 1 && k1 === 3) focus = { ...marks, label: `${deg}°, W bends +7, ${k0}:${k1}, k = ${k}` }
  body += drawFitted(marks, ox + 8, oy + 22, cell - 22, cell * 0.38)
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="${covered ? '#363' : '#e00'}">${label}</text>`
  body += readingLines(ox + 6, oy + cell * 0.38 + 40, note, { maxChars: 56, fill: /FAIL|NOT|NO\b|WRONG|OUTSIDE|open [1-9]|bad [1-9]|· crossings [1-9]|crossings with T [1-9]|covered by other ink [1-9]|folds [1-9]/.test(note) ? '#e00' : '#555' })
  body += cellFrame
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
rows.forEach(([deg, bend], r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 3}" font-size="12">${deg}°, W bends ${bend > 0 ? '+' : '−'}7</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 110 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${Wd})</text>` })
const gridW = pad * 2 + 110 + cell * cols.length, size = Math.max(gridW, pad * 2 + 50 + cell * rows.length)
// the enlarged cell (as on the straight sheet): ℓ cut, J, the removed strip and the tip at once, in the space to the right
if (focus) {
  const fx = gridW, fw = size - gridW - pad, fy = pad + 70, fh = 700
  body += `<text x="${fx}" y="${fy - 10}" font-size="12">Enlarged: ${focus.label} — ℓ cut blue dashes, J green, removed strip red, p orange (uniform scale)</text>`
  body += drawFitted(focus, fx, fy, fw, fh) + `<rect x="${fx - 4}" y="${fy - 4}" width="${fw + 8}" height="${fh + 22}" fill="none" stroke="#ddd"/>`
  // and the junction region alone, about J: the narrowed edge meeting T's edge tangentially
  const zx = fx, zy = fy + fh + 60, zw = fw, zh = 500, R = 6
  body += `<text x="${zx}" y="${zy - 10}" font-size="12">The junction: within ${R} units of J (uniform scale)</text>`
  const clipId = 'jz', T0 = [focus.J[0] - R, focus.J[1] - R], k = Math.min(zw, zh) / (2 * R)
  const tr = P => [zx + (P[0] - T0[0]) * k, zy + (P[1] - T0[1]) * k], path = (l, z) => 'M' + l.map(P => f(tr(P))).join(' L') + (z ? ' Z' : '')
  body += `<clipPath id="${clipId}"><rect x="${zx}" y="${zy}" width="${2 * R * k}" height="${2 * R * k}"/></clipPath><g clip-path="url(#${clipId})"><path d="${focus.loops.map(l => path(l, true)).join(' ')}" fill="#111"/><path d="${focus.removed.map(l => path(l, true)).join(' ')}" fill="#e00" opacity="0.85"/><circle cx="${tr(focus.J)[0]}" cy="${tr(focus.J)[1]}" r="4" fill="#0a8"/><circle cx="${tr(focus.p)[0]}" cy="${tr(focus.p)[1]}" r="4" fill="#e80"/></g><rect x="${zx}" y="${zy}" width="${2 * R * k}" height="${2 * R * k}" fill="none" stroke="#ddd"/>`
}
writeFileSync(new URL('./I2biiw-curves.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">I2b-ii-w on curved strokes (experiment) — W's inner side narrowed within ℓ, tangent to T's actual outer edge at J (green); ℓ cut blue dashes; removed ink red; checked on the samples only</text>${body}</svg>`)
console.log('wrote I2biiw-curves.svg', size)
