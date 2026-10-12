// Shared by the sharp-join experiment sheets (bench glue, not the product; docs/sharp-join-F.md): vector helpers,
// polygon tests and the union-outline extractor (dot 1791783571, 1791783896) — one extractor for every sheet.
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
export const len = a => Math.hypot(a[0], a[1]), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0]
export const meet = (P, d, R, e) => { const den = cross(d, e); if (Math.abs(den) < 1e-12) return null; const w = sub(R, P); return { s: cross(w, e) / den, t: cross(w, d) / den } }
export const f = v => v.map(x => x.toFixed(4)).join(',')
/** Strictly inside a polygon (points within 1e-7 of its boundary count as not inside). */
export function strictlyInside(P, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const A = poly[j], B = poly[i], d = sub(B, A), t = Math.max(0, Math.min(1, dot(sub(P, A), d) / (dot(d, d) || 1)))
    if (len(sub(P, add(A, mul(d, t)))) < 1e-7) return false
  }
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c }
  return c
}
/** The part of `poly` where cross(dir, X − P0)·keep ≥ 0 (Sutherland–Hodgman against one line). */
export function clipHalf(poly, P0, dir, keep) {
  const sideOf = X => cross(dir, sub(X, P0)) * keep, out = []
  for (let i = 0; i < poly.length; i++) { const P = poly[i], Q = poly[(i + 1) % poly.length], sp = sideOf(P), sq = sideOf(Q); if (sp >= 0) out.push(P); if ((sp >= 0) !== (sq >= 0)) out.push(add(P, mul(sub(Q, P), sp / (sp - sq)))) }
  return out
}
/** Inside a polygon by the even-odd rule (no boundary tolerance; used at points just off an edge). */
export function insideEO(P, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c } return c }
/**
 * The union's outline (dot 1791783571). Each edge of each polygon is split at every point where another polygon's edge
 * crosses it or another polygon's vertex lies on it (collinear overlaps included). A sub-edge is on the outline iff
 * exactly one of its two sides has ink — tested at points just off its midpoint on either side, against all polygons —
 * so internal seams (ink on both sides) drop out. Kept sub-edges are oriented with ink on their left, duplicates merged,
 * and assembled into loops; every vertex must join exactly two sub-edges.
 * (Two earlier versions: a fixed-step split straddled the union's corners; a midpoint "inside another polygon" test kept
 * seams shared by two pieces, as their midpoint lies on the other piece's boundary, not strictly inside.)
 */
export function unionOutline(polys) { return regionOutline(polys, P => polys.some(q => insideEO(P, q))) }
/**
 * The same extractor for any region of ink given by a predicate `ink(P)` (true where there is ink): the candidate
 * edges are the edges of `polys`, cut as above; a sub-edge is on the outline iff `ink` differs on its two sides. A union
 * is `P => some piece holds P`; a trim is `P => a piece holds P && P is on the kept side of a curve` (the curve's
 * sampled polyline is then one of the candidate polys) — one extractor for every construction, no polygon clipping.
 * Known limit: the side test looks 1e-5 off each sub-edge, so a sliver of ink or blank thinner than that can be judged
 * wrongly (seen: a free-end cap drawn as a 32-gon centred on the end edge left a 5e-6 sliver against the body's square
 * end — open chains; fixed in the sheet by building the cap on the exact end edge). A product module would need an
 * exact side rule (winding contributions per piece), not an offset.
 */
export function regionOutline(polys, ink) {
  const TOL = 1e-6
  // one vertex registry: every split point is snapped to a registered vertex within TOL, so coincident edges of
  // different pieces are cut at the same vertices and deduplicate by vertex ids (dot 1791783896: a rotated case left
  // overlapping duplicates when each piece cut a shared edge at its own points)
  const verts = []
  // (indexed by TOL-sized buckets for speed only: the lookup still returns the lowest-numbered vertex within TOL)
  const bucket = new Map(), bkey = (x, y) => x + ',' + y
  const vid = P => {
    const bx = Math.floor(P[0] / TOL), by = Math.floor(P[1] / TOL)
    let best = -1
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of bucket.get(bkey(bx + dx, by + dy)) ?? []) if ((best < 0 || i < best) && Math.abs(verts[i][0] - P[0]) < TOL && Math.abs(verts[i][1] - P[1]) < TOL) best = i
    if (best >= 0) return best
    verts.push(P); const k = bkey(bx, by); (bucket.get(k) ?? bucket.set(k, []).get(k)).push(verts.length - 1); return verts.length - 1
  }
  polys.forEach(poly => poly.forEach(vid)) // every polygon vertex first
  const edges = polys.map(poly => poly.map((A, i) => [A, poly[(i + 1) % poly.length]]))
  // pass 1: every crossing between edges of different pieces is registered before any edge is cut — an edge cut
  // before a later crossing was found would be cut differently from its coincident twin
  // (pairs whose boxes are apart cannot meet and are skipped — a sweep over x, for speed only; the meeting pairs are
  // then tested in the original order, so the registry is built exactly as by testing every pair)
  const flat = [], M = 1e-6
  edges.forEach((es, k) => es.forEach(([A, B], i) => flat.push({ k, i, A, B, x0: Math.min(A[0], B[0]) - M, x1: Math.max(A[0], B[0]) + M, y0: Math.min(A[1], B[1]) - M, y1: Math.max(A[1], B[1]) + M })))
  const byX = flat.map((_, n) => n).sort((m, n) => flat[m].x0 - flat[n].x0), near = flat.map(() => [])
  for (let m = 0; m < byX.length; m++) {
    const E = flat[byX[m]]
    for (let q = m + 1; q < byX.length && flat[byX[q]].x0 <= E.x1; q++) {
      const F = flat[byX[q]]
      if (F.k === E.k || F.y0 > E.y1 || F.y1 < E.y0) continue
      if (F.k > E.k) near[byX[m]].push(byX[q]); else near[byX[q]].push(byX[m])
    }
  }
  flat.forEach(({ A, B }, n) => {
    const d = sub(B, A)
    for (const o of near[n].sort((x, y) => x - y)) { const [C, D] = [flat[o].A, flat[o].B], e = sub(D, C), den = cross(d, e); if (Math.abs(den) < 1e-12) continue; const w = sub(C, A), t = cross(w, e) / den, u = cross(w, d) / den; if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) vid(add(A, mul(d, t))) }
  })
  const vx = verts.map((_, i) => i).sort((m, n) => verts[m][0] - verts[n][0]) // the vertices by x, for pass 2's lookup
  // pass 2: each edge cut at every registered vertex lying on it; a sub-edge kept iff exactly one side has ink
  const raw = []
  edges.forEach(es => es.forEach(([A, B]) => {
    const d = sub(B, A), L2 = dot(d, d)
    if (L2 < TOL * TOL) return
    const L = Math.sqrt(L2), cuts = [vid(A), vid(B)]
    const xa = Math.min(A[0], B[0]) - TOL, xb = Math.max(A[0], B[0]) + TOL, ya = Math.min(A[1], B[1]) - TOL, yb = Math.max(A[1], B[1]) + TOL
    let lo = 0, hi = vx.length; while (lo < hi) { const md = (lo + hi) >> 1; if (verts[vx[md]][0] < xa) lo = md + 1; else hi = md }
    const onIt = []
    for (let q = lo; q < vx.length && verts[vx[q]][0] <= xb; q++) { const i = vx[q], V = verts[i]; if (V[1] < ya || V[1] > yb) continue; const t = dot(sub(V, A), d) / L2; if (t > 0 && t < 1 && len(sub(V, add(A, mul(d, t)))) < TOL) onIt.push(i) }
    cuts.push(...onIt.sort((x, y) => x - y))
    const ids = [...new Set(cuts)].sort((x, y) => dot(sub(verts[x], A), d) - dot(sub(verts[y], A), d))
    const n = mul([-d[1], d[0]], 1 / L) // the edge's left normal
    for (let m = 0; m + 1 < ids.length; m++) {
      const P = verts[ids[m]], Q = verts[ids[m + 1]]
      if (ids[m] === ids[m + 1] || len(sub(Q, P)) < TOL) continue
      const mid = mul(add(P, Q), 0.5), eps = 1e-5
      const left = ink(add(mid, mul(n, eps))), right = ink(sub(mid, mul(n, eps)))
      if (left === right) continue // ink on both sides (a seam) or on neither
      raw.push(left ? [ids[m], ids[m + 1]] : [ids[m + 1], ids[m]]) // oriented: ink on the left
    }
  }))
  const seen = new Set(), segIds = []
  for (const [a, b] of raw) { const kk = a + '>' + b; if (!seen.has(kk)) { seen.add(kk); segIds.push([a, b]) } }
  const out = new Map(), inn = new Map()
  for (const sg of segIds) { (out.get(sg[0]) ?? out.set(sg[0], []).get(sg[0])).push(sg); inn.set(sg[1], (inn.get(sg[1]) ?? 0) + 1) }
  // a vertex is bad if its in and out counts differ; a TOUCH vertex has k > 1 in and k out — regions meeting at one
  // point (dot 1791785710: e.g. two zero-width arms touching only at the joint). It is not an error: the walk pairs
  // each incoming sub-edge with the outgoing one met first turning clockwise from the way it came (ink stays on the
  // left), so the touching regions come out as separate loops sharing that vertex — the representation of a point contact
  let badVertices = 0, touchVertices = 0
  for (const [v, list] of out) { const k = inn.get(v) ?? 0; if (list.length !== k) badVertices++; else if (k > 1) touchVertices++ }
  for (const [v] of inn) if (!out.has(v)) badVertices++
  const nextOf = sg => {
    const list = out.get(sg[1]); if (!list) return null
    if (list.length === 1) return list[0]
    const V = verts[sg[1]], back = sub(verts[sg[0]], V)
    const ccw = e => { const d = sub(verts[e[1]], V), t = Math.atan2(cross(back, d), dot(back, d)); return t <= 0 ? t + 2 * Math.PI : t }
    return list.reduce((best, e) => (best === null || ccw(e) > ccw(best) ? e : best), null)
  }
  // chains: a loop counts only if it comes back to its starting sub-edge; an open chain is reported, never drawn closed
  const used = new Set(), loops = [], openChains = []
  for (const sg of segIds) {
    if (used.has(sg)) continue
    const chain = [sg[0]]
    let cur = sg, closed = false
    for (;;) { used.add(cur); const next = nextOf(cur); if (next === sg) { closed = true; break } if (!next || used.has(next)) break; chain.push(cur[1]); cur = next }
    ;(closed ? loops : openChains).push(chain.map(i => verts[i]))
  }
  return { segs: segIds.map(([a, b]) => [verts[a], verts[b]]), loops, openChains, badVertices, touchVertices }
}
export const segCross = (P1, P2, P3, P4) => { const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2); if (Math.abs(den) < 1e-12) return false; const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den; return s > 1e-9 && s < 1 - 1e-9 && t > 1e-9 && t < 1 - 1e-9 }
export const circle = (c, r, n = 32) => Array.from({ length: n }, (_, i) => add(c, [Math.cos(i / n * 2 * Math.PI) * r, Math.sin(i / n * 2 * Math.PI) * r]))
/** SVG lines of a reading, wrapped at about `maxChars` per line at its ' · ' separators (dot 1791784087: readings
 *  spilled into the next cell). */
export function readingLines(x, y, text, { maxChars = 46, size = 8, lineH = 10, fill = '#555' } = {}) {
  const parts = text.split(' · '), lines = []
  for (const part of parts) { const last = lines[lines.length - 1]; if (last !== undefined && (last + ' · ' + part).length <= maxChars) lines[lines.length - 1] = last + ' · ' + part; else lines.push(part) }
  return lines.map((l, i) => `<text x="${x}" y="${y + i * lineH}" font-size="${size}" fill="${fill}">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')
}
