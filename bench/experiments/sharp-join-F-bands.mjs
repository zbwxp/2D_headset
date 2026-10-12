// An experiment, not the product (docs/sharp-join-F.md; dot 1791781802): variant F on STRAIGHT bands only, before
// any real curve. Each stroke keeps its own width; inside each stroke's joint zone (arc length ℓ = k × the wider full
// width from the joint) the ink is rebuilt — the outline runs E0o → M → E1o → E1i → Q → E0i — and each stroke outside
// its zone is closed by the same cut. F is drawn only where it is defined (O1 / O2 × I1); every other cell is marked
// with its class. Run: node sharp-join-F-bands.mjs → F-bands.svg beside it.
import { writeFileSync } from 'node:fs'

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0]
/** Where the line P + s·d meets the line R + t·e: { s, t } (null for parallel lines). */
const meet = (P, d, R, e) => { const den = cross(d, e); if (Math.abs(den) < 1e-12) return null; const w = sub(R, P); return { s: cross(w, e) / den, t: cross(w, d) / den } }
const f = v => v.map(x => x.toFixed(2)).join(',')
const poly = pts => 'M' + pts.map(f).join(' L') + ' Z'
const disc = (c, r) => `M${(c[0] + r).toFixed(2)},${c[1].toFixed(2)} a${r},${r} 0 1,0 ${-2 * r},0 a${r},${r} 0 1,0 ${2 * r},0`

const angles = [0, 8, 20, 45, 70, 90, 110, 140, 170, 180] // θ, the angle between the strokes (180 = straight on)
const cols = [[1, 1, 3], [1, 1, 6], [1, 3, 3], [1, 3, 6], [3, 1, 3], [3, 1, 6]] // [incoming, outgoing] width × k
const W = 4, cell = 200, pad = 30 // the thinner full width; each band is drawn longer than its zone (below)
let body = ''

angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.62, oy + cell * 0.42]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, hw = Math.max(h0, h1), ell = k * 2 * hw, Lb = ell + 18 // a band always reaches past its zone's cut
  const a = [1, 0] // the incoming stroke arrives along +x
  const th = Math.PI - deg * Math.PI / 180, b = [Math.cos(th), Math.sin(th)] // the outgoing leaves at θ from the incoming
  const turn = cross(a, b), side = turn > 0 ? -1 : 1, n0 = [-a[1], a[0]], n1 = [-b[1], b[0]]
  const o0 = mul(n0, side * h0), o1 = mul(n1, side * h1)
  // the bands as drawn without a join: incoming from p − a·Lb to p, outgoing from p to p + b·Lb, square at p
  const start0 = sub(p, mul(a, Lb)), end1 = add(p, mul(b, Lb))
  let cls = '', fpath = null, notes = []
  if (deg === 0 || deg === 180) {
    cls = deg === 0 ? 'θ = 0°: reversal (pinch, as v103) — own case' : k0 === k1 ? 'θ = 180°, equal widths: straight on — nothing to join' : 'θ = 180°, widths differ: a width change — as O3'
  } else {
    // the outer edges extended forward from A = p + o0 (along a) and B = p + o1 (back along −b); M where they meet
    const mo = meet(add(p, o0), a, add(p, o1), mul(b, -1)), mi = meet(sub(p, o0), mul(a, -1), sub(p, o1), b)
    const outerForward = mo && mo.s >= 0 && mo.t >= 0
    const limit = 5 * (h0 + h1)
    const M = outerForward ? add(add(p, o0), mul(a, mo.s)) : null
    // the inner edges, back along the incoming and forward along the outgoing, meet at Q; I1 when within both zones
    const Q = mi ? sub(sub(p, o0), mul(a, mi.s)) : null
    const inZones = mi && mi.s >= 0 && mi.s <= ell && mi.t >= 0 && mi.t <= ell
    const outerCls = !outerForward ? 'O3' : len(sub(M, p)) > limit ? 'O2' : 'O1'
    const innerCls = inZones ? 'I1' : 'I2'
    cls = `${outerCls} × ${innerCls}`
    if (outerCls !== 'O3' && innerCls === 'I1') {
      const E0o = sub(add(p, o0), mul(a, ell)), E0i = sub(sub(p, o0), mul(a, ell)), E1o = add(add(p, o1), mul(b, ell)), E1i = add(sub(p, o1), mul(b, ell))
      // O2: the tip shortened for this sheet by pulling the apex in to the limit circle (style A, straight sides)
      const tipPts = outerCls === 'O1' ? [M] : (() => { const X = add(p, mul(sub(M, p), limit / len(sub(M, p)))); notes.push('O2: tip as A (apex at the limit)'); return [X] })()
      fpath = [E0o, ...tipPts, E1o, E1i, Q, E0i]
      notes.push(`ℓ = ${k}×wider width; Q at ${mi.s.toFixed(1)} / ${mi.t.toFixed(1)} along`)
    } else notes.push(outerCls === 'O3' ? 'O3: not covered (this experiment uses no backward extension)' : 'I2: not covered (Q beyond the zone)')
  }
  // draw: F replaces the zone ends; otherwise the two square-ended bands as they are (with the class marked)
  const band = (from, to, d, o) => [add(from, o), add(to, o), sub(to, o), sub(from, o)]
  if (fpath) {
    const E0 = sub(p, mul(a, ell)), E1 = add(p, mul(b, ell))
    body += `<path d="${poly(band(start0, E0, a, o0))}" fill="#111"/><path d="${poly(band(E1, end1, b, o1))}" fill="#111"/><path d="${poly(fpath)}" fill="#111"/>`
  } else {
    body += `<path d="${poly(band(start0, p, a, o0))}" fill="#111" opacity="0.35"/><path d="${poly(band(p, end1, b, o1))}" fill="#111" opacity="0.35"/>`
  }
  body += `<path d="${disc(start0, h0)}" fill="#111" opacity="${fpath ? 1 : 0.35}"/><path d="${disc(end1, h1)}" fill="#111" opacity="${fpath ? 1 : 0.35}"/>`
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="10" fill="${fpath ? '#363' : '#a50'}">${cls}</text>`
  notes.forEach((n, i) => { body += `<text x="${ox + 6}" y="${oy + cell - 22 + i * 11}" font-size="8" fill="#555">${n}</text>` })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}×</text>` })
const height = pad * 2 + 50 + cell * angles.length, width = Math.max(pad * 2 + 70 + cell * cols.length, height)
writeFileSync(new URL('./F-bands.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="13">F on straight bands (experiment) — green label: F drawn (O1/O2 × I1); orange + faded: not covered here, the plain square-ended bands shown</text>${body}</svg>`)
console.log('wrote F-bands.svg', width, height)
