// An experiment, not the product (docs/sharp-join-F.md §4 I2; dot 1791782871, 1791783167, 1791783236): the sharp
// join's zone built as a UNION of pieces on straight bands, the outline taken as the union's exposed boundary — never a
// hand-written vertex order. Pieces: each stroke's kept body (outside its zone) and free-end cap, T's end piece, W's end
// piece (trimmed to T's side of T's outer-edge line in I2b-i), the outer tip (O1 / O2). Classified I1 / I2 first, then
// I2a / I2b. The outline is extracted as the union's boundary (seams dropped, loops assembled) and drawn alone; checks
// on it: the number of loops, vertices not joining exactly two sub-edges, crossings, square-end corners on it. Verifies the construction only — not the look. Run: node sharp-join-F-union.mjs → F-union.svg beside it.
import { writeFileSync } from 'node:fs'

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const meet = (P, d, R, e) => { const den = cross(d, e); if (Math.abs(den) < 1e-12) return null; const w = sub(R, P); return { s: cross(w, e) / den, t: cross(w, d) / den } }
const f = v => v.map(x => x.toFixed(4)).join(',')
/** Strictly inside a polygon (points within 1e-7 of its boundary count as not inside). */
function strictlyInside(P, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const A = poly[j], B = poly[i], d = sub(B, A), t = Math.max(0, Math.min(1, dot(sub(P, A), d) / (dot(d, d) || 1)))
    if (len(sub(P, add(A, mul(d, t)))) < 1e-7) return false
  }
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c }
  return c
}
/** The part of `poly` where cross(dir, X − P0)·keep ≥ 0 (Sutherland–Hodgman against one line). */
function clipHalf(poly, P0, dir, keep) {
  const sideOf = X => cross(dir, sub(X, P0)) * keep, out = []
  for (let i = 0; i < poly.length; i++) { const P = poly[i], Q = poly[(i + 1) % poly.length], sp = sideOf(P), sq = sideOf(Q); if (sp >= 0) out.push(P); if ((sp >= 0) !== (sq >= 0)) out.push(add(P, mul(sub(Q, P), sp / (sp - sq)))) }
  return out
}
/** Inside a polygon by the even-odd rule (no boundary tolerance; used at points just off an edge). */
function insideEO(P, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c } return c }
/**
 * The union's outline (dot 1791783571). Each edge of each polygon is split at every point where another polygon's edge
 * crosses it or another polygon's vertex lies on it (collinear overlaps included). A sub-edge is on the outline iff
 * exactly one of its two sides has ink — tested at points just off its midpoint on either side, against all polygons —
 * so internal seams (ink on both sides) drop out. Kept sub-edges are oriented with ink on their left, duplicates merged,
 * and assembled into loops; every vertex must join exactly two sub-edges.
 * (Two earlier versions: a fixed-step split straddled the union's corners; a midpoint "inside another polygon" test kept
 * seams shared by two pieces, as their midpoint lies on the other piece's boundary, not strictly inside.)
 */
function unionOutline(polys) {
  const TOL = 1e-6
  // one vertex registry: every split point is snapped to a registered vertex within TOL, so coincident edges of
  // different pieces are cut at the same vertices and deduplicate by vertex ids (dot 1791783896: a rotated case left
  // overlapping duplicates when each piece cut a shared edge at its own points)
  const verts = []
  const vid = P => { for (let i = 0; i < verts.length; i++) if (Math.abs(verts[i][0] - P[0]) < TOL && Math.abs(verts[i][1] - P[1]) < TOL) return i; verts.push(P); return verts.length - 1 }
  polys.forEach(poly => poly.forEach(vid)) // every polygon vertex first
  const edges = polys.map(poly => poly.map((A, i) => [A, poly[(i + 1) % poly.length]]))
  // pass 1: every crossing between edges of different pieces is registered before any edge is cut — an edge cut
  // before a later crossing was found would be cut differently from its coincident twin
  edges.forEach((es, k) => es.forEach(([A, B]) => {
    const d = sub(B, A)
    edges.forEach((fs, j) => { if (j <= k) return; for (const [C, D] of fs) { const e = sub(D, C), den = cross(d, e); if (Math.abs(den) < 1e-12) continue; const w = sub(C, A), t = cross(w, e) / den, u = cross(w, d) / den; if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) vid(add(A, mul(d, t))) } })
  }))
  // pass 2: each edge cut at every registered vertex lying on it; a sub-edge kept iff exactly one side has ink
  const raw = []
  edges.forEach(es => es.forEach(([A, B]) => {
    const d = sub(B, A), L2 = dot(d, d)
    if (L2 < TOL * TOL) return
    const L = Math.sqrt(L2), cuts = [vid(A), vid(B)]
    verts.forEach((V, i) => { const t = dot(sub(V, A), d) / L2; if (t > 0 && t < 1 && len(sub(V, add(A, mul(d, t)))) < TOL) cuts.push(i) })
    const ids = [...new Set(cuts)].sort((x, y) => dot(sub(verts[x], A), d) - dot(sub(verts[y], A), d))
    const n = mul([-d[1], d[0]], 1 / L) // the edge's left normal
    for (let m = 0; m + 1 < ids.length; m++) {
      const P = verts[ids[m]], Q = verts[ids[m + 1]]
      if (ids[m] === ids[m + 1] || len(sub(Q, P)) < TOL) continue
      const mid = mul(add(P, Q), 0.5), eps = 1e-5
      const left = polys.some(q => insideEO(add(mid, mul(n, eps)), q)), right = polys.some(q => insideEO(sub(mid, mul(n, eps)), q))
      if (left === right) continue // ink on both sides (a seam) or on neither
      raw.push(left ? [ids[m], ids[m + 1]] : [ids[m + 1], ids[m]]) // oriented: ink on the left
    }
  }))
  const seen = new Set(), segIds = []
  for (const [a, b] of raw) { const kk = a + '>' + b; if (!seen.has(kk)) { seen.add(kk); segIds.push([a, b]) } }
  const out = new Map(), inn = new Map()
  for (const sg of segIds) { (out.get(sg[0]) ?? out.set(sg[0], []).get(sg[0])).push(sg); inn.set(sg[1], (inn.get(sg[1]) ?? 0) + 1) }
  let badVertices = 0
  for (const [v, list] of out) if (list.length !== 1 || inn.get(v) !== 1) badVertices++
  for (const [v] of inn) if (!out.has(v)) badVertices++
  // chains: a loop counts only if it comes back to its start; an open chain is reported, never drawn as closed
  const used = new Set(), loops = [], openChains = []
  for (const sg of segIds) {
    if (used.has(sg)) continue
    const chain = [sg[0]]
    let cur = sg, closed = false
    while (cur && !used.has(cur)) { used.add(cur); const next = out.get(cur[1]); if (cur[1] === chain[0]) { closed = true; break } chain.push(cur[1]); cur = next && next.length === 1 ? next[0] : null }
    ;(closed ? loops : openChains).push(chain.map(i => verts[i]))
  }
  return { segs: segIds.map(([a, b]) => [verts[a], verts[b]]), loops, openChains, badVertices }
}
const segCross = (P1, P2, P3, P4) => { const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2); if (Math.abs(den) < 1e-12) return false; const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den; return s > 1e-9 && s < 1 - 1e-9 && t > 1e-9 && t < 1 - 1e-9 }
const circle = (c, r, n = 32) => Array.from({ length: n }, (_, i) => add(c, [Math.cos(i / n * 2 * Math.PI) * r, Math.sin(i / n * 2 * Math.PI) * r]))

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
