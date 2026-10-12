// An experiment, not the product (docs/sharp-join-F.md; dot 1791781802): variant F rebuilt on REAL curved strokes,
// after the straight-band sheet. The offset edges are sampled from each cubic; Q is where the two actual inner edges
// cross inside both zones; M where the outer edges, extended forward along their end tangents from A and B, meet.
// Checked per cell: the zone outline does not cross itself; the turn where it leaves each stroke's outer edge (at A,
// B) and where it meets the cuts (E0o, E0i, E1o, E1i); an enclosed-blank alarm. Run: node sharp-join-F-curves.mjs.
import { writeFileSync } from 'node:fs'

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k]
const len = a => Math.hypot(a[0], a[1]), unit = a => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }
const f = v => v.map(x => x.toFixed(4)).join(',')
const angleBetween = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(unit(u), unit(v))))) * 180 / Math.PI
/** Segment P1P2 × segment P3P4: the crossing point and parameters, or null. */
function segCross(P1, P2, P3, P4) {
  const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2)
  if (Math.abs(den) < 1e-12) return null
  const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den
  return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? { P: add(P1, mul(d1, s)), s, t } : null
}
/** Does a closed polygon cross itself (non-adjacent edges)? */
function selfCrossings(pts) {
  let n = 0
  for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
    if (i === 0 && j === pts.length - 1) continue
    if (segCross(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) n++
  }
  return n
}
const inside = (P, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > P[1]) !== (yj > P[1]) && P[0] < (xj - xi) * (P[1] - yi) / (yj - yi) + xi) c = !c } return c }

/**
 * A stroke from its free end to the joint, sampled: centre, outer and inner edges (outer = the turn's outer side `side`),
 * with the arc length from the joint at each sample. Index 0 is the free end, the last is the joint.
 */
function sampled(c, h, sideSign, N = 600) {
  const C = [], O = [], I = [], T = []
  for (let i = 0; i <= N; i++) { const t = i / N, p = bez(c, t), d = unit(dbez(c, t)), n = [-d[1], d[0]]; C.push(p); T.push(d); O.push(add(p, mul(n, sideSign * h))); I.push(sub(p, mul(n, sideSign * h))) }
  const S = new Array(N + 1).fill(0)
  for (let i = N - 1; i >= 0; i--) S[i] = S[i + 1] + len(sub(C[i + 1], C[i]))
  return { C, O, I, T, S, N }
}

const angles = [20, 45, 70, 90, 110, 140]
const ratios = [[1, 1], [1, 3], [3, 1]]
const K = 6, W = 5, cell = 230, pad = 30
let body = ''
angles.forEach((deg, r) => ratios.forEach(([k0, k1], ci) => {
  const ox = pad + 70 + ci * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.6, oy + cell * 0.36]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = K * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1)
  // two curved strokes meeting at p, as in the sample sheet (incoming arrives along about +x; outgoing leaves at θ)
  const th = Math.PI - deg * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)], L = ell + 45
  const inc = [[p[0] - L, p[1] + 14], [p[0] - L * 0.66, p[1] + 3], [p[0] - L * 0.3, p[1]], p]
  const out = [p, add(p, mul(dir, L * 0.33)), add(add(p, mul(dir, L * 0.66)), [0, 7]), add(p, mul(dir, L))]
  const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0)), turn = cross(a, b), side = turn > 0 ? -1 : 1
  // S1 is sampled from its free end too (reversed), so both strokes run free end → joint
  const s0 = sampled(inc, h0, side), s1r = sampled([...out].reverse(), h1, -side)
  const cutIdx = s => s.S.findIndex(v => v <= ell) // the first sample within the zone
  const z0 = cutIdx(s0), z1 = cutIdx(s1r)
  const A = s0.O[s0.N], B = s1r.O[s1r.N]
  // M: the outer edges extended forward along the end tangents from A and B
  const den = cross(a, mul(b, -1)), w = sub(B, A), sM = cross(w, mul(b, -1)) / den, tM = cross(w, a) / den
  const outerForward = Number.isFinite(sM) && sM >= 0 && tM >= 0
  const M = outerForward ? add(A, mul(a, sM)) : null
  const outerCls = !outerForward ? 'O3' : len(sub(M, p)) > limit ? 'O2' : 'O1'
  // Q: where the actual inner edges cross inside both zones (the crossing nearest the joint along S0)
  let Q = null, qi0 = -1, qi1 = -1
  for (let i = s0.N - 1; i >= z0 && !Q; i--) for (let j = s1r.N - 1; j >= z1; j--) { const x = segCross(s0.I[i], s0.I[i + 1], s1r.I[j], s1r.I[j + 1]); if (x) { Q = x.P; qi0 = i; qi1 = j; break } }
  const cls = `${outerCls} × ${Q ? 'I1' : 'I2'}`
  const strokeOutside = (s, z) => [...s.O.slice(0, z + 1), ...s.I.slice(0, z + 1).reverse()]
  const capOf = (s, h) => { const c0 = s.C[0]; return `M${(c0[0] + h).toFixed(4)},${c0[1].toFixed(4)} a${h},${h} 0 1,0 ${-2 * h},0 a${h},${h} 0 1,0 ${2 * h},0` }
  const polys = [strokeOutside(s0, z0), strokeOutside(s1r, z1)]
  let notes = [], fdrawn = false
  if (outerCls !== 'O3' && Q) {
    const tip = outerCls === 'O1' ? [M] : [add(p, mul(sub(M, p), limit / len(sub(M, p))))]
    // the zone outline, in the definition's order: E0o → (S0's outer edge) → A → M → B → (S1's outer edge) → E1o →
    // cut → E1i → (S1's inner edge) → Q → (S0's inner edge) → E0i → cut
    const zone = [...s0.O.slice(z0), ...tip, ...s1r.O.slice(z1).reverse(), ...s1r.I.slice(z1, qi1 + 1), Q, ...s0.I.slice(z0, qi0 + 1).reverse()]
    polys.push(zone)
    fdrawn = true
    const crossings = selfCrossings(zone)
    // the turn of the outline: leaving the outer edge at A (edge direction vs A→tip) and at B; at the cuts the zone
    // continues the very same sampled edge, so the turn there is that edge's own (measured, should be ~0)
    const kA = angleBetween(sub(s0.O[s0.N], s0.O[s0.N - 1]), sub(tip[0], A)), kB = angleBetween(sub(s1r.O[s1r.N], s1r.O[s1r.N - 1]), sub(tip[0], B))
    const kCut = Math.max(angleBetween(sub(s0.O[z0 + 1], s0.O[z0]), sub(s0.O[z0], s0.O[z0 - 1])), angleBetween(sub(s0.I[z0 + 1], s0.I[z0]), sub(s0.I[z0], s0.I[z0 - 1])),
      angleBetween(sub(s1r.O[z1 + 1], s1r.O[z1]), sub(s1r.O[z1], s1r.O[z1 - 1])), angleBetween(sub(s1r.I[z1 + 1], s1r.I[z1]), sub(s1r.I[z1], s1r.I[z1 - 1])))
    notes.push(`self-crossings ${crossings} · turn at A ${kA.toFixed(2)}° B ${kB.toFixed(2)}° · at the cuts ≤ ${kCut.toFixed(3)}°`)
    if (outerCls === 'O2') notes.push('O2: tip as A (apex at the limit)')
    if (crossings) notes.push('the zone outline crosses itself')
  } else notes.push(outerCls === 'O3' ? 'O3: not covered (no backward extension)' : 'I2: the inner edges do not cross in the zones')
  // an enclosed-blank alarm on the union near the joint (0.25 px grid; sampling-sensitive, not a proof)
  {
    const R = Math.ceil(Math.max(h0, h1) * 6), S = Number(process.env.GRID ?? 0.25), N = Math.ceil(2 * R / S), ink = new Uint8Array(N * N)
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) { const P = [p[0] - R + xx * S, p[1] - R + yy * S]; if (polys.some(q => inside(P, q))) ink[yy * N + xx] = 1 }
    const seen = new Uint8Array(N * N), st = []
    for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (!ink[k] && !seen[k]) { seen[k] = 1; st.push(k) }
    while (st.length) { const k = st.pop(), x = k % N, y = (k / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const nk = ny * N + nx; if (!ink[nk] && !seen[nk]) { seen[nk] = 1; st.push(nk) } } }
    let n = 0; for (let k = 0; k < N * N; k++) if (!ink[k] && !seen[k]) n++
    notes.push(`enclosed-blank alarm ${(n * S * S).toFixed(2)} px² @${S}`)
  }
  const op = fdrawn ? 1 : 0.35
  for (const q of polys) body += `<path d="M${q.map(f).join(' L')} Z" fill="#111" opacity="${op}"/>`
  body += `<path d="${capOf(s0, h0)}" fill="#111" opacity="${op}"/><path d="${capOf(s1r, h1)}" fill="#111" opacity="${op}"/>`
  if (!fdrawn) body += `<path d="M${[...s0.O.slice(z0), ...s0.I.slice(z0).reverse()].map(f).join(' L')} Z M${[...s1r.O.slice(z1), ...s1r.I.slice(z1).reverse()].map(f).join(' L')} Z" fill="#111" opacity="0.35"/>`
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="10" fill="${fdrawn ? '#363' : '#a50'}">${cls}</text>`
  notes.forEach((n, i) => { body += `<text x="${ox + 6}" y="${oy + cell - 36 + i * 11}" font-size="8" fill="${/crosses/.test(n) ? '#e00' : '#555'}">${n}</text>` })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
angles.forEach((deg, r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="13">${deg}°</text>` })
ratios.forEach(([k0, k1], ci) => { body += `<text x="${pad + 70 + ci * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = ${K}× wider width</text>` })
const height = pad * 2 + 50 + cell * angles.length, width = Math.max(pad * 2 + 70 + cell * ratios.length, height)
writeFileSync(new URL('./F-curves.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">F on real curved strokes (experiment) — green: F drawn; orange + faded: not covered</text>${body}</svg>`)
console.log('wrote F-curves.svg', width, height)
