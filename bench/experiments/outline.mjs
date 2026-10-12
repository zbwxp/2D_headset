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
export function unionOutline(polys) {
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
export const segCross = (P1, P2, P3, P4) => { const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2); if (Math.abs(den) < 1e-12) return false; const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den; return s > 1e-9 && s < 1 - 1e-9 && t > 1e-9 && t < 1 - 1e-9 }
export const circle = (c, r, n = 32) => Array.from({ length: n }, (_, i) => add(c, [Math.cos(i / n * 2 * Math.PI) * r, Math.sin(i / n * 2 * Math.PI) * r]))
