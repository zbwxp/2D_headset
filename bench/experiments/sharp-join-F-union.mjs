// An experiment, not the product (docs/sharp-join-F.md §4 I2; dot 1791782871, 1791783167, 1791783236): the sharp
// join's zone built as a UNION of pieces on straight bands, the outline taken as the union's exposed boundary — never a
// hand-written vertex order. Pieces: each stroke's kept body (outside its zone) and free-end cap, T's end piece, W's end
// piece (trimmed to T's side of T's outer-edge line in I2b-i), the outer tip (O1 / O2). Classified I1 / I2 first, then
// I2a / I2b. The outline is extracted as the union's boundary (seams dropped, loops assembled) and drawn alone; checks
// on it: the number of loops, vertices not joining exactly two sub-edges, crossings, square-end corners on it. Verifies the construction only — not the look. Run: node sharp-join-F-union.mjs → F-union.svg beside it.
import { writeFileSync } from 'node:fs'

import { add, circle, clipHalf, cross, dot, f, insideEO, len, meet, mul, segCross, strictlyInside, sub, unionOutline } from './outline.mjs'

const angles = [8, 12, 20, 30]
const cols = [[1, 1, 3], [1, 1, 6], [1, 3, 3], [1, 3, 6], [3, 1, 3], [3, 1, 6]]
const W = 4, cell = 230, pad = 30
let body = ''
angles.forEach((deg, r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 70 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.66, oy + cell * 0.4]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), Lb = ell + 30, limit = 5 * (h0 + h1)
  const a = [1, 0], th = Math.PI - deg * Math.PI / 180, b = [Math.cos(th), Math.sin(th)]
  const turn = cross(a, b), side = turn > 0 ? -1 : 1, n0 = [-a[1], a[0]], n1 = [-b[1], b[0]]
  const o0 = mul(n0, side * h0), o1 = mul(n1, side * h1), A = add(p, o0), B = add(p, o1)
  // the outer tip (O1 / O2): M where the forward extensions meet; O2 shortened with B's curved sides
  const mo = meet(A, a, B, mul(b, -1)), M = add(A, mul(a, mo.s)), outerCls = len(sub(M, p)) > limit ? 'O2' : 'O1'
  const quad = (P0, C, P1) => Array.from({ length: 24 }, (_, i) => { const t = (i + 1) / 24, u = 1 - t; return add(add(mul(P0, u * u), mul(C, 2 * u * t)), mul(P1, t * t)) })
  const tip = outerCls === 'O1' ? [p, A, M, B] : (() => { const X = add(p, mul(sub(M, p), limit / len(sub(M, p)))); return [p, A, ...quad(A, add(A, mul(a, Math.sqrt(limit * limit - h0 * h0))), X), ...quad(X, add(B, mul(b, -Math.sqrt(limit * limit - h1 * h1))), B)] })()
  // I1 / I2 first: the inner edges (back along the incoming, forward along the outgoing) meet at Q within both zones?
  const mi = meet(sub(p, o0), mul(a, -1), sub(p, o1), b), I1 = mi && mi.s >= 0 && mi.s <= ell && mi.t >= 0 && mi.t <= ell
  const band = (from, to, o) => [add(from, o), add(to, o), sub(to, o), sub(from, o)]
  const start0 = sub(p, mul(a, Lb)), end1 = add(p, mul(b, Lb)), E0 = sub(p, mul(a, ell)), E1 = add(p, mul(b, ell))
  const pieces = [band(start0, E0, o0), band(E1, end1, o1), circle(start0, h0), circle(end1, h1)] // the kept bodies and caps
  const T = h0 <= h1 ? 0 : 1, hw = Math.max(h0, h1), ht = Math.min(h0, h1)
  let cls, note = ''
  // the square ends' inner corners at the joint: shown on the union's outline means a square end is exposed
  const corners = [['C0', sub(p, o0)], ['C1', sub(p, o1)]]
  if (I1) {
    const Q = sub(sub(p, o0), mul(a, mi.s))
    pieces.push([add(E0, o0), ...tip.slice(1), add(E1, o1), sub(E1, o1), Q, sub(E0, o0)]) // E0o → A → tip → B → E1o → E1i → Q → E0i
    cls = `${outerCls} × I1`
  } else {
    const end0 = band(E0, p, o0), end1p = band(p, E1, o1)
    const protrude = hw * Math.cos(deg * Math.PI / 180) > ht + 1e-12
    if (!protrude) { pieces.push(end0, end1p, tip); cls = `${outerCls} × I2a` }
    else {
      const d1 = (hw * Math.cos(deg * Math.PI / 180) - ht) / Math.sin(deg * Math.PI / 180)
      if (d1 > ell) { cls = `${outerCls} × I2b-ii`; note = 'not covered (the protrusion leaves the zone)' }
      else {
        // W's end piece trimmed to T's side of T's outer-edge line (through T's outer corner, along T's direction)
        const [Tend, Wend, oT, dT] = T === 0 ? [end0, end1p, o0, a] : [end1p, end0, o1, b]
        const Tcorner = add(p, oT), keep = cross(dT, sub(p, Tcorner)) >= 0 ? 1 : -1
        pieces.push(Tend, clipHalf(Wend, Tcorner, dT, keep), tip)
        cls = `${outerCls} × I2b-i`; note = `d1 = ${d1.toFixed(1)} ≤ ℓ = ${ell}`
      }
    }
  }
  const fdrawn = !cls.includes('ii')
  if (fdrawn) {
    const { segs, loops, openChains, badVertices } = unionOutline(pieces)
    // the rotation regression (dot 1791783896): the same pieces turned about p; each must give one closed loop too
    const rot = r => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)]) }
    const sweep = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].map(r => { const u = unionOutline(pieces.map(q => q.map(rot(r)))); return { r, ok: u.loops.length === 1 && !u.openChains.length && !u.badVertices } })
    const rotBad = sweep.filter(x => !x.ok).map(x => x.r)
    let crossings = 0
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++
    const onOutline = P => segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
    const shown = corners.filter(([, P]) => onOutline(P)).map(([n]) => n)
    note = `${note}${note ? ' · ' : ''}loops ${loops.length} · open ${openChains.length} · bad vertices ${badVertices} · crossings ${crossings} · corners shown: ${shown.length ? shown.join(', ') : 'none'} · rotations ${rotBad.length ? 'FAIL at ' + rotBad.join(', ') : 'ok ×' + sweep.length}`
    // drawn from the extracted outline alone (one path, its loops), not from the pieces — seams must not show
    body += `<path d="${loops.map(l => 'M' + l.map(f).join(' L') + ' Z').join(' ')}" fill="#111" fill-rule="nonzero"/>`
    for (const c of openChains) body += `<path d="M${c.map(f).join(' L')}" fill="none" stroke="#e00" stroke-width="1"/>` // open: drawn as a red line, not filled
  } else {
    for (const q of [band(start0, p, o0), band(p, end1, o1), circle(start0, h0), circle(end1, h1)]) body += `<path d="M${q.map(f).join(' L')} Z" fill="#111" opacity="0.35"/>`
  }
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="10" fill="${fdrawn ? '#363' : '#a50'}">${cls}</text>`
  body += `<text x="${ox + 6}" y="${oy + cell - 22}" font-size="8" fill="${/crossings [1-9]|shown: [A-Z]|bad vertices [1-9]|loops ([02-9]|1\d)|open [1-9]|FAIL/.test(note) ? '#e00' : '#555'}">${note}</text>`
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="13">${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 70 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${k}× (thin ${W})</text>` })
const width = pad * 2 + 70 + cell * cols.length, height = Math.max(pad * 2 + 50 + cell * angles.length, width) // square: the thumbnailer crops to a square
writeFileSync(new URL('./F-union.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">Sharp join as a union of pieces on straight bands (experiment) — verifies the construction, not the look</text>${body}</svg>`)
console.log('wrote F-union.svg', width, height)
