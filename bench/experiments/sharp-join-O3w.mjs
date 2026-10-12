// An experiment, not the product (docs/sharp-join-F.md §4 O3-w; dot 1791784305, 1791785125): the unequal blunt angles
// with the corner KEPT — only the widths change. Inside each zone the half width eases from the stroke's own h_i (at the
// cut, s = λ = ℓ) to the common h_p = (h0 + h1) / 2 at the joint: h(s) = h_p + (h_i − h_p)·σ(s/λ), σ = v103's clamped
// smoothstep. Both centre lines are untouched. At p the widths are equal, so a forward tip exists (0° < θ < 180°) and the
// joint is built exactly as the other classes: M from the EASED outer edges' own end directions, Q on the eased inner
// edges, I1 / I2a / I2b-i on the eased edges, one region of ink, the outline from the shared extractor. θ = 180°: no
// corner, the eased widths alone. Rows: straight bands and curved strokes. Checks per cell: loops / holes against the
// input alone (the eased strokes square-ended at p), open, bad, crossings, corners shown, tip reach / limit, 12
// rotations; the widths at p; the max half-width slope from the samples; λ against each stroke's length; folds measured on the
// eased edges themselves (each segment against the centre tangent there); the inner crossings and the Q used, on the outline; the mutation —
// the same cell without easing must classify as O3. Sampled outlines: verifies the construction, not the look.
// Run: node sharp-join-O3w.mjs → O3w.svg beside it.
import { writeFileSync } from 'node:fs'
import { add, cross, dot, f, insideEO, len, mul, readingLines, regionOutline, segCross, sub } from './outline.mjs'

const unit = a => mul(a, 1 / (len(a) || 1))
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) }
const dbez = (c, t) => { const u = 1 - t; return [0, 1].map(i => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) }
const crossAt = (P1, P2, P3, P4) => { const d1 = sub(P2, P1), d2 = sub(P4, P3), den = cross(d1, d2); if (Math.abs(den) < 1e-12) return null; const w = sub(P3, P1), s = cross(w, d2) / den, t = cross(w, d1) / den; return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? add(P1, mul(d1, s)) : null }
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) } // v103 appearance.ts:15 (clamped: 1 for x ≥ 1)
/**
 * A stroke sampled from its free end (0) to the joint (N), its half width a function of the arc length s from the joint.
 * A sample is inserted on the curve exactly at arc length `cut` (dot 1791785288: the cut must be AT ℓ, so the width there
 * is exactly the stroke's own with zero slope — not the nearest sample); its index is returned as z.
 */
function sampled(c, hOf, sideSign, cut, N = 150) {
  const ts = Array.from({ length: N + 1 }, (_, i) => i / N), C0 = ts.map(t => bez(c, t))
  const S0 = new Array(N + 1).fill(0)
  for (let i = N - 1; i >= 0; i--) S0[i] = S0[i + 1] + len(sub(C0[i + 1], C0[i]))
  let i = S0.findIndex(v => v < cut) - 1 // S0[i] ≥ cut > S0[i + 1]
  if (i >= 0 && S0[i] > cut) { // bisect t in (t_i, t_i+1) so that S0[i + 1] + |C(t) − C[i + 1]| = cut
    let lo = ts[i], hi = ts[i + 1]
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (S0[i + 1] + len(sub(bez(c, m), C0[i + 1])) > cut) lo = m; else hi = m }
    ts.splice(i + 1, 0, (lo + hi) / 2)
  }
  const C = ts.map(t => bez(c, t)), T = ts.map(t => unit(dbez(c, t)))
  N = ts.length - 1
  const S = new Array(N + 1).fill(0)
  for (let k = N - 1; k >= 0; k--) S[k] = S[k + 1] + len(sub(C[k + 1], C[k]))
  const z = S.findIndex(v => Math.abs(v - cut) < 1e-9) >= 0 ? S.findIndex(v => Math.abs(v - cut) < 1e-9) : S.findIndex(v => v <= cut)
  const H = S.map(hOf), O = [], I = []
  for (let i = 0; i <= N; i++) { const n = [-T[i][1], T[i][0]]; O.push(add(C[i], mul(n, sideSign * H[i]))); I.push(sub(C[i], mul(n, sideSign * H[i]))) }
  return { C, O, I, T, S, H, N, z }
}
function sideOf(s, big = 400) {
  const inN = unit(sub(s.I[s.N], s.O[s.N])), in0 = unit(sub(s.I[0], s.O[0])), dN = unit(sub(s.O[s.N], s.O[s.N - 1])), d0 = unit(sub(s.O[1], s.O[0]))
  const fwd = add(s.O[s.N], mul(dN, big)), back = sub(s.O[0], mul(d0, big))
  return [...s.O, fwd, add(fwd, mul(inN, big)), add(back, mul(in0, big)), back]
}
function capOf(s, n = 16) {
  const c = s.C[0], h = s.H[0], a0 = Math.atan2(s.O[0][1] - c[1], s.O[0][0] - c[0]), back = mul(s.T[0], -1)
  const sg = dot([Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)], back) > 0 ? 1 : -1
  return [s.O[0], ...Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sg * Math.PI * (i + 1) / n; return add(c, [Math.cos(t) * h, Math.sin(t) * h]) }), s.I[0]]
}
function region(spec) {
  const box = q => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } return [x0, y0, x1, y1] }
  const inq = (P, q, b) => P[0] >= b[0] && P[0] <= b[2] && P[1] >= b[1] && P[1] <= b[3] && insideEO(P, q)
  const plain = spec.plain.map(q => [q, box(q)]), trims = spec.trims.map(t => [t.poly, box(t.poly), t.keep, box(t.keep)])
  const ink = P => plain.some(([q, b]) => inq(P, q, b)) || trims.some(([q, b, k, kb]) => inq(P, q, b) && inq(P, k, kb))
  return regionOutline([...spec.plain, ...spec.trims.flatMap(t => [t.poly, t.keep])], ink)
}
const mapSpec = (spec, fn) => ({ plain: spec.plain.map(q => q.map(fn)), trims: spec.trims.map(t => ({ poly: t.poly.map(fn), keep: t.keep.map(fn) })) })
const area = l => l.reduce((acc, P, i) => acc + cross(P, l[(i + 1) % l.length]), 0) / 2
function topology(u) { const big = u.loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m, u.loops[0] ?? []), sg = Math.sign(area(big)); return { loops: u.loops.length, holes: u.loops.filter(l => Math.sign(area(l)) !== sg).length } }

/** The outer class of a joint from the strokes' outer edges, extended forward along their own last segments. */
function outerOf(s0, s1, p, limit) {
  const A = s0.O[s0.N], B = s1.O[s1.N], dA = unit(sub(A, s0.O[s0.N - 1])), dB = unit(sub(B, s1.O[s1.N - 1]))
  const den = cross(dA, dB); if (Math.abs(den) < 1e-12) return { cls: 'O3', A, B, dA, dB }
  const w = sub(B, A), s = cross(w, dB) / den, t = cross(w, dA) / den
  if (!(s >= 0 && t >= 0)) return { cls: 'O3', A, B, dA, dB }
  const M = add(A, mul(dA, s))
  return { cls: len(sub(M, p)) > limit ? 'O2' : 'O1', A, B, dA, dB, M }
}

const rows = [['band', 110], ['band', 130], ['band', 150], ['band', 170], ['band', 180], ['curve', 110], ['curve', 140], ['curve', 170], ['curve', 180]]
const cols = [[1, 2, 3], [1, 3, 3], [1, 3, 6], [3, 1, 3], [3, 1, 6], [2, 1, 3]]
const W = 4, cell = 250, pad = 30, zoom = 1.2
const tally = {}
let body = ''
rows.forEach(([kind, deg], r) => cols.forEach(([k0, k1, k], c) => {
  const ox = pad + 90 + c * cell, oy = pad + 50 + r * cell, p = [ox + cell * 0.47, oy + cell * 0.25]
  const h0 = W * k0 / 2, h1 = W * k1 / 2, ell = k * 2 * Math.max(h0, h1), limit = 5 * (h0 + h1), hp = (h0 + h1) / 2, lambda = ell
  const th = Math.PI - deg * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)], L = ell + 30
  const line = (P0, P3) => [P0, add(P0, mul(sub(P3, P0), 1 / 3)), add(P0, mul(sub(P3, P0), 2 / 3)), P3]
  const inc = kind === 'band' ? line([p[0] - L, p[1]], p) : [[p[0] - L, p[1] + 14], [p[0] - L * 0.66, p[1] + 3], [p[0] - L * 0.3, p[1]], p]
  const out = kind === 'band' ? line(p, add(p, mul(dir, L))) : [p, add(p, mul(dir, L * 0.33)), add(add(p, mul(dir, L * 0.66)), [0, 7]), add(p, mul(dir, L))]
  const a = unit(dbez(inc, 1)), b = unit(dbez(out, 0)), turn = cross(a, b), side = turn > 0 ? -1 : 1
  const eased = (hi) => s => hp + (hi - hp) * smooth(s / lambda)
  const s0 = sampled(inc, eased(h0), side, ell), s1 = sampled([...out].reverse(), eased(h1), -side, ell)
  // the mutation: the same strokes at their own constant widths must classify as O3 (else O3-w is not what is drawn)
  const u0 = sampled(inc, () => h0, side, ell), u1 = sampled([...out].reverse(), () => h1, -side, ell)
  const without = deg === 180 ? 'O3 (180°)' : outerOf(u0, u1, p, limit).cls
  const z0 = s0.z, z1 = s1.z
  const bodyOf = (s, z) => [...s.O.slice(0, z + 1), ...s.I.slice(0, z + 1).reverse()], endOf = (s, z) => [...s.O.slice(z), ...s.I.slice(z).reverse()]
  const kept = [bodyOf(s0, z0), bodyOf(s1, z1), capOf(s0), capOf(s1)]
  const o = deg === 180 ? { cls: 'straight' } : outerOf(s0, s1, p, limit)
  let tipMid = []
  if (o.cls === 'O1') tipMid = [o.M]
  // No O2 branch: O3 needs θ ≥ 180° − arccos(1/r) > 90°, and after easing both half widths at p are h_p with h′ = 0,
  // so the tip is h_p / sin(θ/2) < √2·h_p, far below the limit 5 × 2h_p = 10·h_p. An O2 here would be unexpected and is
  // reported as not covered, not drawn with untested code (dot 1791785485).
  let cls, spec = null, note = '', qInfo = null
  if (!without.startsWith('O3')) { cls = `not O3 here (${without} without easing) — F applies, not drawn`; note = 'not drawn' }
  else if (o.cls === 'straight') { cls = '180°: eased widths, no corner'; spec = { plain: [...kept, endOf(s0, z0), endOf(s1, z1)], trims: [] } }
  else if (o.cls === 'O2') { cls = 'O2 after easing — UNEXPECTED, not covered'; note = 'not covered' }
  else if (o.cls === 'O3') { cls = 'O3 even after easing — not covered'; note = 'not covered' }
  else {
    let Q = null, q0 = -1, q1 = -1
    for (let i = s0.N - 1; i >= z0 && !Q; i--) for (let j = s1.N - 1; j >= z1; j--) { const x = crossAt(s0.I[i], s0.I[i + 1], s1.I[j], s1.I[j + 1]); if (x) { Q = x; q0 = i; q1 = j; break } }
    // every crossing of the two inner edges within the zones is counted; the one used is the nearest the joint along
    // S0, and it is checked on the final outline below (dot 1791785208: never take the first one as right unchecked)
    let qCount = 0
    for (let i = z0; i < s0.N; i++) for (let j = z1; j < s1.N; j++) if (crossAt(s0.I[i], s0.I[i + 1], s1.I[j], s1.I[j + 1])) qCount++
    qInfo = Q ? { Q, qCount } : null
    if (Q) { cls = `O3-w: ${o.cls} × I1`; spec = { plain: [...kept, [...s0.O.slice(z0), ...tipMid, ...s1.O.slice(z1).reverse(), ...s1.I.slice(z1, q1 + 1), Q, ...s0.I.slice(z0, q0 + 1).reverse()]], trims: [] } }
    else {
      const tip = [p, o.A, ...tipMid, o.B]
      const [sT, zT, sW, zW] = h0 <= h1 ? [s0, z0, s1, z1] : [s1, z1, s0, z0], HT = sideOf(sT)
      if (insideEO(sW.I[sW.N], HT)) { cls = `O3-w: ${o.cls} × I2a`; spec = { plain: [...kept, endOf(s0, z0), endOf(s1, z1), tip], trims: [] } }
      else {
        let i1 = -1
        for (let i = sW.N; i >= zW; i--) if (insideEO(sW.I[i], HT)) { i1 = i; break }
        if (i1 >= 0) for (let i = i1; i >= zW; i--) if (!insideEO(sW.I[i], HT)) { i1 = -1; break }
        if (i1 < 0) { cls = `O3-w: ${o.cls} × I2b-ii — not covered`; note = 'not covered' }
        else { cls = `O3-w: ${o.cls} × I2b-i`; spec = { plain: [...kept, endOf(sT, zT), tip], trims: [{ poly: endOf(sW, zW), keep: HT }] } }
      }
    }
  }
  tally[cls] = (tally[cls] ?? 0) + 1
  // the readings that do not need the outline
  const slope = Math.max(...[s0, s1].flatMap(s => s.H.slice(1).map((h, i) => Math.abs(h - s.H[i]) / (Math.abs(s.S[i] - s.S[i + 1]) || 1))))
  const folds = [s0, s1].reduce((n, s) => { for (const E of [s.O, s.I]) for (let i = 0; i < s.N; i++) if (dot(sub(E[i + 1], E[i]), s.T[i]) <= 0) n++; return n }, 0)
  const atP = `widths at p ${(2 * s0.H[s0.N]).toFixed(3)} / ${(2 * s1.H[s1.N]).toFixed(3)} · at the cuts (s = ${s0.S[z0].toFixed(6)} / ${s1.S[z1].toFixed(6)}) ${(2 * s0.H[z0]).toFixed(6)} / ${(2 * s1.H[z1]).toFixed(6)}`
  const pre = `without easing: ${without}${without.startsWith('O3') ? '' : ' (NOT O3)'} · ${atP} · max half-width slope ${slope.toFixed(3)} (formula ${(1.5 * Math.max(Math.abs(h0 - hp), Math.abs(h1 - hp)) / lambda).toFixed(3)}) · λ ${lambda} ≤ lengths ${s0.S[0].toFixed(0)} / ${s1.S[0].toFixed(0)}${lambda > Math.min(s0.S[0], s1.S[0]) ? ' TOO LONG' : ''} · eased-edge folds ${folds}`
  const view = `<clipPath id="c${r}_${c}"><rect x="${ox}" y="${oy + 18}" width="${cell - 6}" height="${cell - 100}"/></clipPath><g clip-path="url(#c${r}_${c})"><g transform="translate(${f(p)}) scale(${zoom}) translate(${f(mul(p, -1))})">`
  if (spec) {
    const { segs, loops, openChains, badVertices } = region(spec), topo = topology({ loops })
    const input = topology(region({ plain: [...kept, endOf(s0, z0), endOf(s1, z1)], trims: [] }))
    const same = u => { const t = topology(u); return t.loops === topo.loops && t.holes === topo.holes && !u.openChains.length && !u.badVertices }
    let crossings = 0
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++
    const onOutline = P => segs.some(([S0, S1]) => { const d = sub(S1, S0), t = Math.max(0, Math.min(1, dot(sub(P, S0), d) / (dot(d, d) || 1))); return len(sub(P, add(S0, mul(d, t)))) < 1e-6 })
    const shown = o.cls === 'straight' ? [] : [['C0', s0.I[s0.N]], ['C1', s1.I[s1.N]]].filter(([, P]) => onOutline(P)).map(([n]) => n)
    const rot = rr => P => { const v = sub(P, p); return add(p, [v[0] * Math.cos(rr) - v[1] * Math.sin(rr), v[0] * Math.sin(rr) + v[1] * Math.cos(rr)]) }
    const rotO = rr => P => [P[0] * Math.cos(rr) - P[1] * Math.sin(rr), P[0] * Math.sin(rr) + P[1] * Math.cos(rr)]
    const rotBad = [0.37, 0.63, 1.1, 1.9, 2.71, 4.4].flatMap(rr => [['', rot(rr)], ['O', rotO(rr)]].filter(([, fn]) => !same(region(mapSpec(spec, fn)))).map(([tag]) => tag + rr))
    const qNote = qInfo ? ` · inner edges cross ${qInfo.qCount}×, Q = the nearest the joint along S0${onOutline(qInfo.Q) ? ', on the outline' : ' — NOT ON THE OUTLINE'}` : ''
    const tipReach = tipMid.length ? Math.max(...[o.A, ...tipMid, o.B].map(P => len(sub(P, p)))) : null
    note = `loops ${topo.loops}, holes ${topo.holes} (input alone ${input.loops}, ${input.holes})${topo.loops !== input.loops || topo.holes !== input.holes ? ' DIFFERS' : ''} · open ${openChains.length} · bad ${badVertices} · crossings ${crossings} · corners shown: ${shown.length ? shown.join(', ') : 'none'}${tipReach !== null ? ` · tip ${tipReach.toFixed(1)} / ${limit}${tipReach > limit + 1e-6 ? ' OVER' : ''}` : ''} · rotations ${rotBad.length ? 'FAIL ' + rotBad.join(',') : 'ok ×12'}${qNote} · ${pre}`
    body += view + `<path d="${loops.map(l => 'M' + l.map(f).join(' L') + ' Z').join(' ')}" fill="#111"/>`
    for (const ch of openChains) body += `<path d="M${ch.map(f).join(' L')}" fill="none" stroke="#e00"/>`
    body += '</g></g>'
  } else {
    note = `${note} · ${pre}`
    body += view + [...kept, endOf(s0, z0), endOf(s1, z1)].map(q => `<path d="M${q.map(f).join(' L')} Z" fill="#111" opacity="0.35"/>`).join('') + '</g></g>'
  }
  body += `<text x="${ox + 6}" y="${oy + 14}" font-size="9" fill="${spec ? '#363' : '#a50'}">${cls}</text>`
  body += readingLines(ox + 6, oy + cell - 78, note, { maxChars: 54, fill: /FAIL|OVER|DIFFERS|NOT O3|NOT ON|TOO LONG|UNEXPECTED|open [1-9]|bad [1-9]|crossings [1-9]|shown: C|folds [1-9]/.test(note) ? '#e00' : '#555' })
  body += `<rect x="${ox}" y="${oy}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#ddd"/>`
}))
rows.forEach(([kind, deg], r) => { body += `<text x="${pad}" y="${pad + 50 + r * cell + cell / 2}" font-size="12">${kind} ${deg}°</text>` })
cols.forEach(([k0, k1, k], c) => { body += `<text x="${pad + 90 + c * cell + 6}" y="${pad + 40}" font-size="11">${k0}:${k1} · ℓ = λ = ${k}× (thin ${W}) · ×${zoom}</text>` })
const width = pad * 2 + 90 + cell * cols.length, height = Math.max(pad * 2 + 50 + cell * rows.length, width)
writeFileSync(new URL('./O3w.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${height}" height="${height}" viewBox="0 0 ${height} ${height}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${pad}" y="${pad + 6}" font-size="12">O3-w (experiment): widths eased to the average at the joint (λ = ℓ), centre lines and the corner kept — verifies the construction, not the look</text>${body}</svg>`)
console.log('wrote O3w.svg', height, JSON.stringify(tally))
