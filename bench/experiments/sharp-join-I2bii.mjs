// An experiment, not the product (docs/sharp-join-F.md §4 I2b-ii; dot 1791786172, 1791786463): an EXPERIMENTAL VARIANT
// THAT WIDENS THE LOCAL TRIM RANGE — on straight bands only. Where W's square end sticks out past T's outer edge and W's
// inner edge comes back to T's side only beyond the zone (d1 > ℓ), W's trim runs to R1 instead of the zone cut: W's
// ink within d1 of p counts only on T's side of T's outer-edge line. Ink = T's body + T's end piece (cut at ℓ) + W's body
// (beyond R1) + W's trimmed piece (p to R1) + the outer tip (O1 / O2) + free-end caps; the outline from the shared
// extractor. Each cell draws the original ℓ cut (blue dashes), the actual trim end R1 (magenta) and the removed ink beyond
// ℓ (red). Readings: class, d1 / ℓ, the stretch d1 − ℓ beyond the cut, the largest change (the wedge's height at the
// cut), the removed area beyond ℓ; loops / holes against the input alone, open, bad, crossings, W's corner C_W on the
// outline, W's inner corner at the ℓ cut on the outline (the step a trim stopped at ℓ leaves — a mutation shows it in every
// cell), R1 on both edges, the outline's turn at R1, the tip against the limit, 12 rotations. Cells of other classes
// are labelled, not drawn. Run: node sharp-join-I2bii.mjs → I2bii.svg beside it.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, meet, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
const inq = (P, q, b) => P[0] >= b[0] && P[0] <= b[2] && P[1] >= b[1] && P[1] <= b[3] && insideEO(P, q)
function region(spec) {
  const plain = spec.plain.map(q => [q, box(q)]), trims = spec.trims.map(t => [t.poly, box(t.poly), t.keep, box(t.keep)])
  const ink = P => plain.some(([q, b]) => inq(P, q, b)) || trims.some(([q, b, k, kb]) => inq(P, q, b) && inq(P, k, kb))
  return regionOutline([...spec.plain, ...spec.trims.flatMap(t => [t.poly, t.keep])], ink)
}
const mapSpec = (spec, fn) => ({ plain: spec.plain.map(q => q.map(fn)), trims: spec.trims.map(t => ({ poly: t.poly.map(fn), keep: t.keep.map(fn) })) })
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }
/** A free-end cap: the half disc on the exact end edge (outer end O, inner end I), bulging along `back`. */
function cap(O, I, back, n = 16) {
  const c = mul(add(O, I), 0.5), h = len(sub(O, I)) / 2, a0 = Math.atan2(O[1] - c[1], O[0] - c[0])
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [O, ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), I]
}

const angles = [2, 3, 4, 5, 6]
const cols = [[1, 3, 3], [3, 1, 3], [1, 2, 3], [2, 1, 3], [1, 3, 6], [3, 1, 6]]
const W = 4, cell = 280, pad = 30, zoom = 1.6
let body = ''
angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.86, oy + cell * 0.3]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1), th = deg * Math.PI / 180
  const hw = Math.max(h0, h1), ht = Math.min(h0, h1), d1 = (hw * Math.cos(th) - ht) / Math.sin(th), Lb = Math.max(ell, d1) + 40
  const a = [1, 0], b = [Math.cos(Math.PI - th), Math.sin(Math.PI - th)]
  const side = cross(a, b) > 0 ? -1 : 1, o0 = mul([-a[1], a[0]], side * h0), o1 = mul([-b[1], b[0]], side * h1), A = add(p, o0), B = add(p, o1)
  // class, as F-union: I1 first (inner edges meet within both zones), then I2a / I2b by the protrusion, then d1 vs ℓ
  const mi = meet(sub(p, o0), mul(a, -1), sub(p, o1), b), I1 = mi && mi.s >= 0 && mi.s <= ell && mi.t >= 0 && mi.t <= ell
  const protrude = hw * Math.cos(th) > ht + 1e-12
  const cls = I1 ? 'I1' : !protrude ? 'I2a' : d1 <= ell ? 'I2b-i' : 'I2b-ii'
  const mo = meet(A, a, B, mul(b, -1)), M = add(A, mul(a, mo.s)), outerCls = len(sub(M, p)) > limit ? 'O2' : 'O1'
  let note = '', label = `${outerCls} × ${cls}`
  if (cls !== 'I2b-ii') { note = `not I2b-ii here (d1 = ${d1.toFixed(1)}, ℓ = ${ell}) — not drawn`; body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#a50">${label}</text>` + readingLines(ox + 6, oy + cell - 60, note) + `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`; return }
  label += ' — experimental variant: trim widened to R1'
  // T = the thinner (dT: from T's free end towards p), W = the wider (dW: from p along W away from the joint)
  const tIs0 = h0 <= h1, dT = tIs0 ? a : mul(b, -1), oT = tIs0 ? o0 : o1, dW = tIs0 ? b : mul(a, -1), oW = tIs0 ? o1 : o0
  const lenT = Lb, lenW = Lb, applies = d1 < lenW && d1 < lenT
  const quad = (P0, C, P1) => Array.from({ length: 24 }, (_, i) => { const t = (i + 1) / 24, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  const tip = outerCls === 'O1' ? [p, A, M, B] : (() => { const X = add(p, mul(sub(M, p), limit / len(sub(M, p)))); return [p, A, ...quad(A, add(A, mul(a, Math.sqrt(limit * limit - h0 * h0))), X), ...quad(X, add(B, mul(b, -Math.sqrt(limit * limit - h1 * h1))), B)] })()
  const band = (P0, P1, o) => [add(P0, o), add(P1, o), sub(P1, o), sub(P0, o)]
  const Tfree = sub(p, mul(dT, lenT)), Tcut = sub(p, mul(dT, ell)), Wfree = add(p, mul(dW, lenW)), WR1 = add(p, mul(dW, d1))
  const Tbody = band(Tfree, Tcut, oT), Tend = band(Tcut, p, oT), Wbody = band(WR1, Wfree, oW), Wtrim = band(p, WR1, oW)
  const caps = [cap(add(Tfree, oT), sub(Tfree, oT), mul(dT, -1)), cap(add(Wfree, oW), sub(Wfree, oW), dW)]
  // H_T: T's side of T's outer-edge line (through T's outer corner, along dT) — straight band, so a large half plane
  const Tc = add(p, oT), inT = unit(mul(oT, -1)), big = 600
  const HT = [sub(Tc, mul(dT, big)), add(Tc, mul(dT, big)), add(add(Tc, mul(dT, big)), mul(inT, big)), add(sub(Tc, mul(dT, big)), mul(inT, big))]
  const spec = { plain: [Tbody, Tend, Wbody, ...caps, tip], trims: [{ poly: Wtrim, keep: HT }] }
  const { segs, loops, openChains, badVertices, touchVertices } = region(spec), topo = topology({ loops })
  const input = topology(region({ plain: [band(Tfree, p, oT), band(p, Wfree, oW), ...caps], trims: [] }))
  let crossings = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++
  const near = (P, Q) => len(sub(P, Q)) < 1e-6
  const onOutline = P => segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
  const CW = sub(p, oW), R1 = add(WR1, mul(oW, -1)) // W's inner edge at s = d1
  const distToT = P => Math.abs(cross(dT, sub(P, Tc))) // distance from T's outer-edge line
  // the outline's turn at R1: the sub-edges arriving at and leaving R1 (R1 lies on one straight edge — expected 0)
  const into = segs.find(([, E]) => near(E, R1)), outOf = segs.find(([S0]) => near(S0, R1))
  const turnR1 = into && outOf ? Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(into[1], into[0])), unit(sub(outOf[1], outOf[0])))))) * 180 / Math.PI : null
  const onR1 = turnR1 !== null ? `turn at R1 ${turnR1.toFixed(4)}°` : onOutline(R1) ? 'R1 inside an outline sub-edge (turn 0)' : 'R1 not on the outline'
  // the change beyond ℓ: the wedge between W's inner edge and T's outer-edge line from the cut (s = ℓ) to R1 (s = d1)
  // the removed region beyond ℓ is bounded by W's cut at ℓ (perpendicular to W), W's inner edge and T's outer-edge line:
  // the triangle Ecut, R1, X with X where the cut line meets T's line (dot: not the foot of the normal to T) — its area
  // on straight bands is ½·(d1 − ℓ)²·tan θ; the largest change is reported both normal to T's edge and along the cut
  const Ecut = add(p, add(mul(dW, ell), mul(oW, -1))), hCut = distToT(Ecut)
  const xm = meet(Ecut, unit(oW), Tc, dT), X = add(Ecut, mul(unit(oW), xm.s)), alongCut = len(sub(X, Ecut))
  const wedge = Math.abs(area([Ecut, R1, X])), wedgeFormula = 0.5 * (d1 - ell) ** 2 * Math.tan(th)
  // the new cut across W at R1 (from R1 to W's outer edge there) must lie on the kept side (T's side) entirely
  const Rout = add(WR1, oW), cutKept = insideEO(mul(add(R1, Rout), 0.5), HT) && insideEO(sub(Rout, mul(unit(oW), 1e-6)), HT)
  const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
  const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
  const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => { const w = region(mapSpec(spec, fn)), t = topology(w); return !(t.loops === topo.loops && t.holes === topo.holes && !w.openChains.length && !w.badVertices) }).map(([tag]) => tag + rr))
  const tipReach = Math.max(...tip.slice(1).map(P => len(sub(P, p))))
  note = `${applies ? '' : 'NOT APPLICABLE (R1 beyond a stroke) · '}d1 ${d1.toFixed(1)} vs ℓ ${ell} · beyond the cut: stretch ${(d1 - ell).toFixed(1)}, largest change ${hCut.toFixed(3)} normal to T's edge (${alongCut.toFixed(3)} along the cut), removed area ${wedge.toFixed(3)} (½(d1−ℓ)²tanθ = ${wedgeFormula.toFixed(3)}) · the new cut at R1 on the kept side: ${cutKept ? 'yes' : 'NO'} · loops ${topo.loops}, holes ${topo.holes} (input alone ${input.loops}, ${input.holes}) · open ${openChains.length} · bad ${badVertices} · touch ${touchVertices} · crossings ${crossings} · C_W on the outline: ${onOutline(CW) ? 'YES' : 'no'} · W's inner corner at the ℓ cut on the outline (a step): ${onOutline(Ecut) && !near(Ecut, R1) ? 'YES' : 'no'} · R1 off W's inner edge ${len(sub(R1, add(WR1, mul(oW, -1)))).toExponential(1)}, off T's outer edge ${distToT(R1).toExponential(1)} · ${onR1} · tip ${tipReach.toFixed(1)} / ${limit} · rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12'}`
  const cid = `c${r}_${c}`, toP = P => P
  body += `<clipPath id="${cid}"><rect x="${ox}" y="${oy + 18}" width="${cell - 6}" height="${cell - 120}"/></clipPath><g clip-path="url(#${cid})"><g transform="translate(${f(p)}) scale(${zoom}) translate(${f(mul(p, -1))})">`
  body += `<path d="${loops.map(l => 'M' + l.map(f).join(' L') + ' Z').join(' ')}" fill="#111"/>`
  body += `<path d="M${[Ecut, R1, X].map(toP).map(f).join(' L')} Z" fill="#e00" opacity="0.8"/>` // the removed ink beyond ℓ
  body += `<path d="M${f(add(add(p, mul(dW, ell)), oW))} L${f(Ecut)}" stroke="#36c" stroke-width="${0.8 / zoom}" stroke-dasharray="${2 / zoom},${1.5 / zoom}"/>`
  body += `<circle cx="${R1[0]}" cy="${R1[1]}" r="${2.2 / zoom}" fill="#c0c"/><circle cx="${p[0]}" cy="${p[1]}" r="${1.6 / zoom}" fill="#e80"/>`
  for (const ch of openChains) body += `<path d="M${ch.map(f).join(' L')}" fill="none" stroke="#e00" stroke-width="0.3"/>`
  body += '</g></g>'
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#363">${label}</text>`
  body += readingLines(ox + 6, oy + cell - 98, note, { maxChars: 56, fill: /FAIL|NOT APPLICABLE|YES|NO\b|not on the outline|open [1-9]|bad [1-9]|· crossings [1-9]/.test(note) ? '#e00' : '#555' })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 3}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${W}) · ×${zoom}</text>` })
const size = Math.max(pad * 2 + 70 + cell * cols.length, pad * 2 + 50 + cell * angles.length)
writeFileSync(new URL('./I2bii.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">I2b-ii, straight bands — an experimental variant that widens the trim from the ℓ cut (blue dashes) to R1 (magenta); removed ink beyond ℓ in red; p orange</text>${body}</svg>`)
console.log('wrote I2bii.svg', size)
