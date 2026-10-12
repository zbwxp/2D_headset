// An experiment, not the product (docs/sharp-join-F.md §4 θ = 0°; dot 1791785710): the exact reversal (b = −a), as
// v103's pinch — no tip; each stroke's half width h_i(s) = h_i·σ(s/ρ), σ the clamped smoothstep, s the polyline arc
// length from p, ρ = min(1.5 × the wider full width, each stroke's length / 3) (the wider: my choice for unequal widths,
// flagged). Centre lines untouched; the ink is the union of the two eased strokes. Inputs with a zero-length stroke or no
// usable end tangent are a separate case, not on this sheet. Rows: a straight band (both strokes on one line — every
// edge collinear with the other stroke's), curves bending to the same side, to opposite sides, and to opposite sides
// sharply (the arms may then meet only at p). A point contact is a TOUCH vertex: the regions come out as separate loops
// sharing p (outline.mjs). Checked against the ink itself: on circles of radius r about p, the number of ink arcs (from
// the ink predicate, 7200 fixed angles — an arc narrower than one step can be missed, dot 1791786138) against half the
// outline's crossings with that circle (each segment solved against the circle, both roots). A sampled check, no proof. Also: loops / holes / touch vertices, open,
// bad, crossings, p on the outline (the input alone is no baseline where its own constant-width offsets fold), widths at p and at s = ρ, the max half-width slope, eased-edge folds, 12 rotations.
// Run: node sharp-join-zero.mjs → zero.svg beside it.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }
/** As sharp-join-O3w: sampled free end (0) → joint (N), half width hOf(s), a sample inserted at polyline arc length `cut`. */
function sampled(c, hOf, sideSign, cut, N = 150) {
  const ts = Array.from({ length: N + 1 }, (_, i) => i / N), C0 = ts.map(t => bez(c, t))
  const S0 = new Array(N + 1).fill(0)
  for (let i = N - 1; i >= 0; i--) S0[i] = S0[i + 1] + len(sub(C0[i + 1], C0[i]))
  const i = S0.findIndex(v => v < cut) - 1
  if (i >= 0 && S0[i] > cut) { let lo = ts[i], hi = ts[i + 1]; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (S0[i + 1] + len(sub(bez(c, m), C0[i + 1])) > cut) lo = m; else hi = m } ts.splice(i + 1, 0, (lo + hi) / 2) }
  const C = ts.map(t => bez(c, t)), T = ts.map(t => unit(dbez(c, t)))
  N = ts.length - 1
  const S = new Array(N + 1).fill(0)
  for (let k = N - 1; k >= 0; k--) S[k] = S[k + 1] + len(sub(C[k + 1], C[k]))
  const z = S.findIndex(v => Math.abs(v - cut) < 1e-9)
  const H = S.map(hOf), O = [], I = []
  for (let k = 0; k <= N; k++) { const n = [-T[k][1], T[k][0]]; O.push(add(C[k], mul(n, sideSign * H[k]))); I.push(sub(C[k], mul(n, sideSign * H[k]))) }
  return { C, O, I, T, S, H, N, z }
}
function capOf(s, n = 16) {
  const c = s.C[0], h = s.H[0], a0 = Math.atan2(s.O[0][1] - c[1], s.O[0][0] - c[0]), back = mul(s.T[0], -1)
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [s.O[0], ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), s.I[0]]
}
const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
const inkOf = polys => { const bs = polys.map(box); return P => polys.some((q, i) => P[0] >= bs[i][0] && P[0] <= bs[i][2] && P[1] >= bs[i][1] && P[1] <= bs[i][3] && insideEO(P, q)) }
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }

const rows = [['band', 'straight, one line'], ['same', 'curves, same side'], ['opposite', 'curves, opposite sides'], ['sharp', 'curves, opposite, sharp']]
const cols = [[1, 1], [1, 3], [3, 1], [2, 1]]
const W = 4, cell = 300, pad = 30, zoomOf = kind => kind === 'sharp' ? 1.3 : 2.2 // the sharp row's arms reach 40 units from p (dot 1791786172: cut off at ×2.2)
let body = ''
rows.forEach(([kind, label], r) => cols.forEach(([k0, k1], c) => {
  const ox = pad + 110 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * (kind === 'sharp' ? 0.62 : 0.8), oy + cell * (kind === 'sharp' ? 0.3 : 0.32)], zoom = zoomOf(kind)
  const h0 = W * k0 / 2, h1 = W * k1 / 2, L = 60
  // the incoming arrives along +x; the outgoing leaves along −x (the exact reversal); bends as the row says
  const line = (P0, P3) => [P0, add(P0, mul(sub(P3, P0), 1 / 3)), add(P0, mul(sub(P3, P0), 2 / 3)), P3]
  const inc = kind === 'band' ? line([p[0] - L, p[1]], p) : kind === 'sharp' ? [add(p, [-30, 40]), add(p, [-6, 10]), add(p, [-4, 0]), p] : [[p[0] - L, p[1] + 14], [p[0] - L * 0.66, p[1] + 3], [p[0] - L * 0.3, p[1]], p]
  const out = kind === 'band' ? line(p, [p[0] - L, p[1]]) : kind === 'sharp' ? [p, add(p, [-4, 0]), add(p, [-6, -10]), add(p, [-30, -40])] : [p, add(p, [-L * 0.3, 0]), add(p, [-L * 0.66, kind === 'same' ? 5 : -5]), add(p, [-L, kind === 'same' ? 10 : -10])]
  const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0))
  const reversal = 1 + dot(a, b) < 1e-10 // v103 inkJoin.ts: the pinch case
  const len0 = (cc => { let s = 0, P = cc[0]; for (let i = 1; i <= 400; i++) { const Q = bez(cc, i / 400); s += len(sub(Q, P)); P = Q } return s })
  const rho = Math.min(1.5 * 2 * Math.max(h0, h1), len0(inc) / 3, len0(out) / 3)
  const s0 = sampled(inc, s => h0 * smooth(s / rho), 1, rho), s1 = sampled([...out].reverse(), s => h1 * smooth(s / rho), -1, rho)
  const strokeOf = s => [...s.O, ...s.I.slice().reverse()]
  const pieces = [strokeOf(s0), strokeOf(s1), capOf(s0), capOf(s1)]
  const u = regionOutline(pieces, inkOf(pieces)), topo = topology(u)
  // the input alone: the same strokes at their own widths, square-ended at p
  const v0 = sampled(inc, () => h0, 1, rho), v1 = sampled([...out].reverse(), () => h1, -1, rho), inPieces = [strokeOf(v0), strokeOf(v1), capOf(v0), capOf(v1)]
  // its offset edges can fold where curvature × width ≥ 1 (the sharp row): a folded polygon is no baseline — reported so
  const foldsOf = ss => ss.reduce((n, s) => { for (const E of [s.O, s.I]) for (let i = 0; i < s.N; i++) { const d = sub(E[i + 1], E[i]); if (len(d) > 1e-12 && dot(d, s.T[i]) <= 0) n++ } return n }, 0)
  const inputFolds = foldsOf([v0, v1]), input = inputFolds ? null : topology(regionOutline(inPieces, inkOf(inPieces)))
  let crossings = 0
  for (let i = 0; i < u.segs.length; i++) for (let j = i + 1; j < u.segs.length; j++) if (segCross(u.segs[i][0], u.segs[i][1], u.segs[j][0], u.segs[j][1])) crossings++
  const onOutline = P => u.segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
  // against the ink itself: on a circle of radius r about p, ink arcs (predicate, 7200 samples) vs outline crossings / 2
  const ink = inkOf(pieces)
  const circleCheck = rr => {
    const n = 7200, onc = Array.from({ length: n }, (_, i) => ink(add(p, [rr * Math.cos(2 * Math.PI * i / n), rr * Math.sin(2 * Math.PI * i / n)])))
    let arcs = 0; for (let i = 0; i < n; i++) if (onc[i] && !onc[(i + n - 1) % n]) arcs++
    if (arcs === 0 && onc[0]) arcs = 1
    // every crossing of each outline segment with the circle, both roots of |S0 + t·d − p| = r in [0, 1) — a segment
    // with both ends outside can still cross twice (dot 1791786138: the end-inside/outside test missed that)
    // a tangency (the circle touching the outline without crossing — a double root on a segment, or a root at a vertex
    // where the outline only touches) is no crossing: such a radius is marked n/a, not counted (dot 1791786243)
    let hits = 0, tangent = false
    for (const [S0, S1] of u.segs) { const d = sub(S1, S0), w = sub(S0, p), A = dot(d, d), B = 2 * dot(w, d), C = dot(w, w) - rr * rr, D = B * B - 4 * A * C; if (A < 1e-24 || D < -1e-12 * A * rr * rr) continue; if (Math.abs(D) <= 1e-12 * A * rr * rr) { const t = -B / (2 * A); if (t >= 0 && t <= 1) tangent = true; continue } const q = Math.sqrt(D); for (const t of [(-B - q) / (2 * A), (-B + q) / (2 * A)]) if (t >= 0 && t < 1) { if (t < 1e-9 && Math.abs(len(sub(S0, p)) - rr) < 1e-9) { const prev = u.segs.find(([, E]) => E === S0); if (prev) { const din = len(sub(prev[0], p)) < rr, dout = len(sub(S1, p)) < rr; if (din === dout) tangent = true } } hits++ } }
    return tangent ? 'n/a (tangent)' : `${arcs}/${hits / 2}`
  }
  const radii = [0.05, 0.3, 1, rho].map(x => +x.toFixed(2))
  const checks = radii.map(rr => [rr, circleCheck(rr)])
  const mismatch = checks.some(([, s]) => { if (s.startsWith('n/a')) return false; const [x, y] = s.split('/'); return x !== y })
  const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
  const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
  const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => { const q = pieces.map(x => x.map(fn)), w = regionOutline(q, inkOf(q)), t = topology(w); return !(t.loops === topo.loops && t.holes === topo.holes && w.touchVertices === u.touchVertices && !w.openChains.length && !w.badVertices) }).map(([tag]) => tag + rr))
  const slope = Math.max(...[s0, s1].flatMap(s => s.H.slice(1).map((h, i) => Math.abs(h - s.H[i]) / (Math.abs(s.S[i] - s.S[i + 1]) || 1))))
  const folds = foldsOf([s0, s1])
  const note = `${reversal ? '' : 'NOT A REVERSAL · '}ρ = ${rho.toFixed(2)} · loops ${topo.loops}, holes ${topo.holes}, touch ${u.touchVertices} (input alone ${input ? `${input.loops}, ${input.holes}` : `n/a: its constant-width offsets fold at ${inputFolds} samples`}) · open ${u.openChains.length} · bad ${u.badVertices} · crossings ${crossings} · p on the outline: ${onOutline(p) ? 'yes' : 'NO'} · widths at p ${(2 * s0.H[s0.N]).toFixed(3)} / ${(2 * s1.H[s1.N]).toFixed(3)}, at ρ ${(2 * s0.H[s0.z]).toFixed(6)} / ${(2 * s1.H[s1.z]).toFixed(6)} · max half-width slope ${slope.toFixed(3)} (formula ${(1.5 * Math.max(h0, h1) / rho).toFixed(3)}) · eased-edge folds ${folds} · ink arcs / outline crossings÷2 at r = ${checks.map(([rr, s]) => `${rr}: ${s}`).join(', ')}${mismatch ? ' MISMATCH' : ''} · rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12'}`
  const cid = `c${r}_${c}`
  body += `<clipPath id="${cid}"><rect x="${ox}" y="${oy + 18}" width="${cell - 6}" height="${cell - 120}"/></clipPath><g clip-path="url(#${cid})"><g transform="translate(${f(p)}) scale(${zoom}) translate(${f(mul(p, -1))})">`
  // each loop drawn in its own shade, so separate loops touching at p are visible as such
  const shades = ['#111', '#3a5fa0', '#a04a3a', '#3a8a4a']
  body += u.loops.map((l, i) => `<path d="M${l.map(f).join(' L')} Z" fill="${topo.holes ? '#111' : shades[i % shades.length]}" fill-rule="evenodd"/>`).join('')
  for (const ch of u.openChains) body += `<path d="M${ch.map(f).join(' L')}" fill="none" stroke="#e00" stroke-width="0.3"/>`
  body += `<circle cx="${p[0]}" cy="${p[1]}" r="0.25" fill="#e80"/></g></g>`
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="#363">θ = 0° · ${k0}:${k1}${u.touchVertices ? ' · point contact at p' : ''}</text>`
  body += readingLines(ox + 6, oy + cell - 98, note, { maxChars: 62, fill: /FAIL|MISMATCH|NOT A|NO\b|open [1-9]|bad [1-9]|· crossings [1-9]|folds [1-9]/.test(note) ? '#e00' : '#555' })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
rows.forEach(([, label], r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 3}" font-size="11">${label}</text>` })
cols.forEach(([k0, k1], c) => { body += `<text x="${pad + 110 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} (thin ${W}) · drawn ×2.2 about p (sharp row ×1.3; orange dot = p)</text>` })
const size = Math.max(pad * 2 + 110 + cell * cols.length, pad * 2 + 50 + cell * rows.length)
writeFileSync(new URL('./zero.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">θ = 0° (experiment): v103's pinch — widths eased to zero at p over ρ, union of the two strokes; loops in separate shades — verifies the construction, not the look</text>${body}</svg>`)
console.log('wrote zero.svg', size)
