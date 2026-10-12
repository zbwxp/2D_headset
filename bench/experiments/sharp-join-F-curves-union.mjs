// An experiment, not the product (docs/sharp-join-F.md §4; dot 1791784130): every class of the sharp join on REAL
// curved strokes (cubics), each drawn as one region of ink whose outline is extracted by the shared extractor — never a
// hand-written vertex order. The ink is a predicate over pieces: each stroke's kept body and free-end cap, its end piece
// (I2a, I2b-i), the outer tip (O1 / O2), the rebuilt zone (I1), the bridged zone (O3, an experiment). I2b-i's trim is
// part of the predicate — W's end piece counts only on T's side of T's actual outer offset curve and its forward
// extension — so no polygon clipping is written for curves. Classes are decided on the actual offset curves:
// I1 = the inner edges cross within both zones; else I2a / I2b by whether W's square end leaves T's side; I2b-i / ii by
// whether W's inner edge comes back to T's side within W's zone. Checks per cell: loops, open chains, bad vertices,
// crossings, the square ends' inner corners on the outline, the reach of the tip against 5× the average width, and the
// same 12 rotations as the straight sheets (6 about the joint, 6 about the sheet origin). O3 also: folds, the width in
// the zone. Sampled outlines: verifies the construction, not the look. θ = 0° is not on this sheet (v103's pinch is
// checked separately). Run: node sharp-join-F-curves-union.mjs [acute|blunt] → F-curves-union-<which>.svg.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }
const crossAt = (P1, P2, P3, P4) => { const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2); if (Math.abs(den) < 1e-12) return null; const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den; return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? add(P1, mul(d1, s)) : null }
/** A stroke sampled from its free end (index 0) to the joint (index N): centre, outer / inner edges, tangent, arc length to the joint. */
function sampled(c, h, sideSign, N = 150) {
  const C = [], O = [], I = [], T = []
  for (let i = 0; i <= N; i++) { const t = i / N, p = bez(c, t), d = unit(dbez(c, t)), n = [-d[1], d[0]]; C.push(p); T.push(d); O.push(add(p, mul(n, sideSign * h))); I.push(sub(p, mul(n, sideSign * h))) }
  const S = new Array(N + 1).fill(0)
  for (let i = N - 1; i >= 0; i--) S[i] = S[i + 1] + len(sub(C[i + 1], C[i]))
  return { C, O, I, T, S, N }
}
/** T's side of T's outer offset curve and its forward extension from its corner: a large polygon whose one side is that curve. */
function sideOf(s, big = 400) {
  const inN = unit(sub(s.I[s.N], s.O[s.N])), in0 = unit(sub(s.I[0], s.O[0]))
  const fwd = add(s.O[s.N], mul(s.T[s.N], big)), back = sub(s.O[0], mul(s.T[0], big))
  return [...s.O, fwd, add(fwd, mul(inN, big)), add(back, mul(in0, big)), back]
}
/** The ink: plain pieces, plus trimmed pieces (ink only where also inside `keep`); candidates = every piece's edges. */
function region(spec) {
  const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
  const inq = (P, q, b) => P[0] >= b[0] && P[0] <= b[2] && P[1] >= b[1] && P[1] <= b[3] && insideEO(P, q)
  const plain = spec.plain.map(q => [q, box(q)]), trims = spec.trims.map(t => [t.poly, box(t.poly), t.keep, box(t.keep)])
  const ink = P => plain.some(([q, b]) => inq(P, q, b)) || trims.some(([q, b, k, kb]) => inq(P, q, b) && inq(P, k, kb))
  return regionOutline([...spec.plain, ...spec.trims.flatMap(t => [t.poly, t.keep])], ink)
}
/** A free-end cap: the half disc on the stroke's own end edge O[0]–I[0] (its exact vertices), bulging away from the stroke. */
function capOf(s, h, n = 16) {
  const c = s.C[0], a0 = Math.atan2(s.O[0][1] - c[1], s.O[0][0] - c[0]), back = mul(s.T[0], -1)
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [s.O[0], ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), s.I[0]]
}
/** Loops and holes: kept edges run with ink on their left, so a hole turns the other way from the outer loops. */
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }
const mapSpec = (spec, fn) => ({ plain: spec.plain.map(q => q.map(fn)), trims: spec.trims.map(t => ({ poly: t.poly.map(fn), keep: t.keep.map(fn) })) })

const which = process.argv[2] === 'blunt' ? 'blunt' : 'acute'
const angles = which === 'acute' ? [8, 12, 20, 30, 45] : [90, 110, 140, 170, 180]
const cols = [[1, 1, 3], [1, 1, 6], [1, 3, 3], [1, 3, 6], [3, 1, 3], [3, 1, 6]]
const W = 4, cell = 280, pad = 30
const tally = {}
let body = ''
angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * (which === 'acute' ? 0.7 : 0.47), oy + cell * (which === 'acute' ? 0.3 : 0.22)]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1)
  // two curved strokes meeting at p (as F-curves): the incoming arrives along +x, the outgoing leaves at θ; both bend
  const th = Math.PI - deg * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)], L = ell + 30
  const inc = [[p[0] - L, p[1] + 14], [p[0] - L * 0.66, p[1] + 3], [p[0] - L * 0.3, p[1]], p]
  const out = [p, add(p, mul(dir, L * 0.33)), add(add(p, mul(dir, L * 0.66)), [0, 7]), add(p, mul(dir, L))]
  const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0)), turn = cross(a, b), side = turn > 0 ? -1 : 1
  const s0 = sampled(inc, h0, side), s1 = sampled([...out].reverse(), h1, -side) // both run free end → joint
  const z0 = s0.S.findIndex(v => v <= ell), z1 = s1.S.findIndex(v => v <= ell)
  const A = s0.O[s0.N], B = s1.O[s1.N]
  const bodyOf = (s, z) => [...s.O.slice(0, z + 1), ...s.I.slice(0, z + 1).reverse()], endOf = (s, z) => [...s.O.slice(z), ...s.I.slice(z).reverse()]
  const kept = [bodyOf(s0, z0), bodyOf(s1, z1), capOf(s0, h0), capOf(s1, h1)]
  // the outer tip: M where the outer edges, extended forward along the end tangents from A and B, meet
  const den = cross(a, mul(b, -1)), w = sub(B, A), sM = Math.abs(den) < 1e-12 ? -1 : cross(w, mul(b, -1)) / den, tM = Math.abs(den) < 1e-12 ? -1 : cross(w, a) / den
  const M = sM >= 0 && tM >= 0 ? add(A, mul(a, sM)) : null
  const outerCls = deg === 180 ? (k0 === k1 ? 'straight' : 'O3') : !M ? 'O3' : len(sub(M, p)) > limit ? 'O2' : 'O1'
  const quad = (P0, C, P1) => Array.from({ length: 24 }, (_, i) => { const t = (i + 1) / 24, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  const X = outerCls === 'O2' ? add(p, mul(sub(M, p), limit / len(sub(M, p)))) : null
  const tipMid = outerCls === 'O1' ? [M] : outerCls === 'O2' ? [...quad(A, add(A, mul(a, Math.sqrt(limit * limit - h0 * h0))), X), ...quad(X, add(B, mul(b, -Math.sqrt(limit * limit - h1 * h1))), B).slice(0, -1)] : []
  let cls, spec = null, note = '', o3 = null
  if (outerCls === 'straight') { cls = '180°, equal widths: straight on'; spec = { plain: [...kept, endOf(s0, z0), endOf(s1, z1)], trims: [] } }
  else if (outerCls === 'O3') {
    // the bridged zone (experiment, as sharp-join-O3): cubics E0o → E1o and E0i → E1i leaving / arriving along the edges
    const br = (P0, d0, P3, d3) => { const cc = len(sub(P3, P0)) / 3; return [P0, add(P0, mul(d0, cc)), sub(P3, mul(d3, cc)), P3] }
    const Bo = br(s0.O[z0], s0.T[z0], s1.O[z1], mul(s1.T[z1], -1)), Bi = br(s0.I[z0], s0.T[z0], s1.I[z1], mul(s1.T[z1], -1))
    const smp = Bz => Array.from({ length: 49 }, (_, i) => bez(Bz, i / 48)), outer = smp(Bo), inner = smp(Bi)
    const folds = [Bo, Bi].map(Bz => { const ch = sub(Bz[3], Bz[0]); let n = 0; for (let i = 0; i <= 96; i++) if (dot(dbez(Bz, i / 96), ch) <= 0) n++; return n })
    const widths = outer.map(P => Math.min(...inner.map(Q => len(sub(P, Q))))), wmin = Math.min(...widths), wmax = Math.max(...widths), lo = 2 * Math.min(h0, h1), hi = 2 * Math.max(h0, h1)
    o3 = `folds ${folds.join('/')} · sampled-boundary nearest distance ${wmin.toFixed(2)}–${wmax.toFixed(2)} (lines ${lo}, ${hi}; not a thickness proof)${wmax > hi + 1e-6 || wmin < lo - 1e-6 ? ' OUTSIDE' : ''}`
    cls = (deg === 180 ? '180°, widths differ: ' : '') + 'O3 (experiment): width transition, no tip'
    spec = { plain: [...kept, [...outer, ...inner.slice().reverse()]], trims: [] }
  } else {
    // I1: the actual inner edges cross within both zones (the crossing nearest the joint along S0)
    let Q = null, q0 = -1, q1 = -1
    for (let i = s0.N - 1; i >= z0 && !Q; i--) for (let j = s1.N - 1; j >= z1; j--) { const x = crossAt(s0.I[i], s0.I[i + 1], s1.I[j], s1.I[j + 1]); if (x) { Q = x; q0 = i; q1 = j; break } }
    if (Q) {
      cls = `${outerCls} × I1`
      spec = { plain: [...kept, [...s0.O.slice(z0), ...tipMid, ...s1.O.slice(z1).reverse(), ...s1.I.slice(z1, q1 + 1), Q, ...s0.I.slice(z0, q0 + 1).reverse()]], trims: [] }
    } else {
      const tip = [p, A, ...tipMid, B]
      const [sT, zT, sW, zW] = h0 <= h1 ? [s0, z0, s1, z1] : [s1, z1, s0, z0], HT = sideOf(sT), HW = sideOf(sW)
      if (k0 !== k1 && !insideEO(sT.I[sT.N], HW)) { cls = `${outerCls} × I2 (thinner end leaves W's side)`; note = 'not covered' }
      else if (insideEO(sW.I[sW.N], HT)) { cls = `${outerCls} × I2a`; spec = { plain: [...kept, endOf(s0, z0), endOf(s1, z1), tip], trims: [] } }
      else {
        // d1: from the joint back along W, where W's inner edge comes back to T's side; I2b-i also needs it to stay on
        // T's side from there to W's cut (else the kept body would step out at the cut — treated as I2b-ii)
        let i1 = -1
        for (let i = sW.N; i >= zW; i--) if (insideEO(sW.I[i], HT)) { i1 = i; break }
        if (i1 >= 0) for (let i = i1; i >= zW; i--) if (!insideEO(sW.I[i], HT)) { i1 = -1; break }
        if (i1 < 0) { cls = `${outerCls} × I2b-ii`; note = 'not covered (the protrusion leaves the zone)' }
        else {
          cls = `${outerCls} × I2b-i`; note = `d1 ≈ ${sW.S[i1].toFixed(1)} ≤ ℓ = ${ell}`
          spec = { plain: [...kept, endOf(sT, zT), tip], trims: [{ poly: endOf(sW, zW), keep: HT }] }
        }
      }
    }
  }
  tally[cls] = (tally[cls] ?? 0) + 1
  // drawn magnified about the joint (the checks use the unscaled geometry), clipped to the cell
  const zoom = which === 'acute' ? 1.6 : 1.2, cid = `c${r}_${c}`
  body += `<clipPath id="${cid}"><rect x="${ox}" y="${oy + 18}" width="${cell - 6}" height="${cell - 90}"/></clipPath><g clip-path="url(#${cid})"><g transform="translate(${f(p)}) scale(${zoom}) translate(${f(mul(p, -1))})">`
  if (spec) {
    const { segs, loops, openChains, badVertices } = region(spec), topo = topology({ loops })
    // the input alone (the two strokes square-ended at p, no join): the loops / holes the curves make by themselves —
    // e.g. strokes bent toward each other that cross again outside the zones enclose a blank that is not the join's
    const input = topology(region({ plain: [...kept, endOf(s0, z0), endOf(s1, z1)], trims: [] }))
    const same = u => { const t = topology(u); return t.loops === topo.loops && t.holes === topo.holes && !u.openChains.length && !u.badVertices }
    let crossings = 0
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++
    const onOutline = P => segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
    const shown = outerCls === 'straight' || outerCls === 'O3' ? [] : [['C0', s0.I[s0.N]], ['C1', s1.I[s1.N]]].filter(([, P]) => onOutline(P)).map(([n]) => n)
    const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
    const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
    const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => { const u = region(mapSpec(spec, fn)); return !same(u) }).map(([tag]) => tag + rr))
    // the tip's reach: the farthest outline point from p, against 5× the average width (only where there is a tip)
    const tipReach = outerCls.startsWith('O') && outerCls !== 'O3' ? Math.max(...[A, ...tipMid, B].map(P => len(sub(P, p)))) : null
    note = `${note}${note ? ' · ' : ''}loops ${topo.loops}, holes ${topo.holes} (input alone ${input.loops}, ${input.holes})${topo.loops !== input.loops || topo.holes !== input.holes ? ' DIFFERS' : ''} · open ${openChains.length} · bad ${badVertices} · crossings ${crossings}${o3 ? '' : ` · corners shown: ${shown.length ? shown.join(', ') : 'none'}`}${tipReach !== null ? ` · tip ${tipReach.toFixed(1)} / ${limit}${tipReach > limit + 1e-6 ? ' OVER' : ''}` : ''}${o3 ? ' · ' + o3 : ''} · rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12 (same loops / holes)'}`
    body += `<path d="${loops.map(l => 'M' + l.map(f).join(' L') + ' Z').join(' ')}" fill="#111"/>`
    for (const ch of openChains) body += `<path d="M${ch.map(f).join(' L')}" fill="none" stroke="#e00"/>`
  } else {
    for (const q of [...kept, endOf(s0, z0), endOf(s1, z1)]) body += `<path d="M${q.map(f).join(' L')} Z" fill="#111" opacity="0.35"/>`
  }
  body += `</g></g><text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="${spec ? '#363' : '#a50'}">${cls}</text>`
  body += readingLines(ox + 6, oy + cell - 66, note, { maxChars: 58, fill: /FAIL|OUTSIDE|OVER|DIFFERS|open [1-9]|bad [1-9]|crossings [1-9]|shown: C|folds [1-9]|folds \d+\/[1-9]/.test(note) ? '#e00' : '#555' })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${W}) · drawn ×${which === 'acute' ? 1.6 : 1.2}</text>` })
const width = pad * 2 + 70 + cell * cols.length, height = Math.max(pad * 2 + 50 + cell * angles.length, width) // square: the thumbnailer crops to a square
writeFileSync(new URL(`./F-curves-union-${which}.svg`, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">Sharp join on real curved strokes, every class, one region of ink each (experiment, ${which}) — verifies the construction, not the look</text>${body}</svg>`)
console.log(`wrote F-curves-union-${which}.svg`, width, height, JSON.stringify(tally))
