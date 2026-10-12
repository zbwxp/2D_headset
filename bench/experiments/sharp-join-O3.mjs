// An experiment, not the product (docs/sharp-join-F.md §4 O3; dot 1791782871): the blunt angles where two lines of
// different widths cannot meet in a forward tip — labelled "no tip: a smooth width transition", NOT the sharp join's
// default. Straight bands. Inside the joint zone the ink is rebuilt between two bridges: outer E0o → E1o and inner
// E0i → E1i, each a cubic leaving the thinner / arriving at the wider edge along that edge's direction (handles
// 1/3 of the chord, a starting value). Outside the zones nothing changes. Checks (the shared outline extractor): one
// closed loop, crossings, rotations; a bridge folding back along its chord; the width across the zone (min / max,
// a bulge if outside the two lines' widths) — the local width change reported as it is. Run: node sharp-join-O3.mjs
import { writeFileSync } from 'node:fs'
import { add, circle, cross, dot, f, len, mul, segCross, sub, unionOutline } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const cubic = (P0, P1, P2, P3, t) => { const u = 1 - t; return add(add(mul(P0, u * u * u), mul(P1, 3 * u * u * t)), add(mul(P2, 3 * u * t * t), mul(P3, t * t * t))) }
const dcubic = (P0, P1, P2, P3, t) => { const u = 1 - t; return add(add(mul(sub(P1, P0), 3 * u * u), mul(sub(P2, P1), 6 * u * t)), mul(sub(P3, P2), 3 * t * t)) }
/** A bridge from P0 leaving along d0 to P3 arriving along d3; handle length = h × the chord. */
const bridge = (P0, d0, P3, d3, h) => { const c = len(sub(P3, P0)) * h; return [P0, add(P0, mul(d0, c)), sub(P3, mul(d3, c)), P3] }
const sample = (B, n = 48) => Array.from({ length: n + 1 }, (_, i) => cubic(...B, i / n))

const angles = [110, 130, 150, 170, 180]
const cols = [[1, 2, 3], [1, 3, 3], [1, 3, 6], [3, 1, 3], [3, 1, 6], [2, 1, 3]]
const W = 4, cell = 230, pad = 30, H = 1 / 3
let body = ''
angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.55, oy + cell * 0.3]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), Lb = ell + 30
  const a = [1, 0], th = Math.PI - deg * Math.PI / 180, b = [Math.cos(th), Math.sin(th)]
  const turn = cross(a, b), side = turn > 0 ? -1 : turn < 0 ? 1 : 1, n0 = [-a[1], a[0]], n1 = [-b[1], b[0]]
  const o0 = mul(n0, side * h0), o1 = mul(n1, side * h1)
  const E0 = sub(p, mul(a, ell)), E1 = add(p, mul(b, ell)), start0 = sub(p, mul(a, Lb)), end1 = add(p, mul(b, Lb))
  // O3 holds iff the outer edges' forward extensions do not meet (unequal widths, θ ≥ 180° − arccos(1/r))
  const den = cross(a, mul(b, -1)), w = sub(add(p, o1), add(p, o0)), sM = Math.abs(den) < 1e-12 ? -1 : cross(w, mul(b, -1)) / den, tM = Math.abs(den) < 1e-12 ? -1 : cross(w, a) / den
  const O3 = !(sM >= 0 && tM >= 0)
  const band = (from, to, o) => [add(from, o), add(to, o), sub(to, o), sub(from, o)]
  let label, note
  if (!O3) { label = `not O3 here (a forward tip exists) — not drawn by this sheet`; note = ''; body += `<path d="M${[...band(start0, p, o0)].map(f).join(' L')} Z M${band(p, end1, o1).map(f).join(' L')} Z" fill="#111" opacity="0.3"/>` }
  else {
    const Bo = bridge(add(E0, o0), a, add(E1, o1), b, H), Bi = bridge(sub(E0, o0), a, sub(E1, o1), b, H)
    const outer = sample(Bo), inner = sample(Bi)
    const zone = [...outer, ...inner.slice().reverse()]
    const pieces = [band(start0, E0, o0), band(E1, end1, o1), circle(start0, h0), circle(end1, h1), zone]
    const { segs, loops, openChains, badVertices } = unionOutline(pieces)
    let crossings = 0
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++
    const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
    const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].filter(rr => { const u = unionOutline(pieces.map(q => q.map(rot(rr)))); return !(u.loops.length === 1 && !u.openChains.length && !u.badVertices) })
    // a fold: the bridge turning back against its chord somewhere (its derivative's projection on the chord ≤ 0)
    const folds = [Bo, Bi].map(B => { const ch = sub(B[3], B[0]); let n = 0; for (let i = 0; i <= 96; i++) if (dot(dcubic(...B, i / 96), ch) <= 0) n++; return n })
    // the width across the zone: from each outer bridge sample to the nearest point of the inner bridge
    const widths = outer.map(P => Math.min(...inner.map(Q => len(sub(P, Q)))))
    const wmin = Math.min(...widths), wmax = Math.max(...widths), lo = 2 * Math.min(h0, h1), hi = 2 * Math.max(h0, h1)
    const bulge = wmax > hi + 1e-6 || wmin < lo - 1e-6
    label = 'O3 — no tip: a smooth width transition (experiment)'
    note = `loops ${loops.length} · open ${openChains.length} · bad ${badVertices} · crossings ${crossings} · rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×6'} · folds ${folds.join('/')} · width in zone ${wmin.toFixed(2)}–${wmax.toFixed(2)} (lines ${lo}, ${hi})${bulge ? ' BULGE' : ''}`
    body += `<path d="${loops.map(l => 'M' + l.map(f).join(' L') + ' Z').join(' ')}" fill="#111"/>`
    for (const ch of openChains) body += `<path d="M${ch.map(f).join(' L')}" fill="none" stroke="#e00"/>`
  }
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="${O3 ? '#363' : '#a50'}">${label}</text>`
  if (note) body += `<text x="${ox + 6}" y="${oy + cell - 22}" font-size="7" fill="${/FAIL|BULGE|loops [02-9]|open [1-9]|bad [1-9]|crossings [1-9]|folds [1-9]|folds \d+\/[1-9]/.test(note) ? '#e00' : '#555'}">${note}</text>`
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${W})</text>` })
const width = pad * 2 + 70 + cell * cols.length, height = Math.max(pad * 2 + 50 + cell * angles.length, width)
writeFileSync(new URL('./O3.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">O3 (experiment) — no tip: a smooth width transition inside the zone; not the sharp join's default</text>${body}</svg>`)
console.log('wrote O3.svg', width, height)
