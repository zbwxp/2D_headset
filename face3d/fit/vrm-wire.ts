// The simplest 3D head wireframe: one meridian, one latitude (bowen 1793100382 / 1793100411). From the VRoid head (neck kept):
// - the meridian = the side face line: the head cut by its plane of symmetry (x = 0); 9 cubic Béziers, joints starting at the
//   semantic points — neck front → 下巴底拐点 → 下巴 → 下唇 → 上唇 → 鼻尖 → 眉心 → 颅顶 → 后脑最凸处 → 后颈;
// - the latitude = the orange ring: where the skin's normal is level (the outline seen from straight above), the loop at the
//   forehead; 2 cubic Béziers split at the front and back of the midline.
// Each joint then slides along its line wherever the total error is lower (not every point exact, the whole as close as possible).
// Writes face3d/viewer/vrm-wire.json. Run: npx vite-node face3d/fit/vrm-wire.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead } from '../mesh/vrmhead'
type V3 = [number, number, number]
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const P = D.P, N = D.N, T = D.skinTris
const lerp = (a: V3, c: V3, t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]
const dist = (a: V3, c: V3) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])

/** the zero line of a per-vertex value on the skin, as segments */
function zeroLine(f: (i: number) => number, keep: (p: V3) => boolean = () => true): [V3, V3][] {
  const out: [V3, V3][] = []
  for (let t = 0; t < T.length; t += 3) { const ids = [T[t]!, T[t + 1]!, T[t + 2]!], pts: V3[] = []
    for (let e = 0; e < 3; e++) { const i = ids[e]!, j = ids[(e + 1) % 3]!, fi = f(i), fj = f(j); if ((fi > 0) !== (fj > 0)) pts.push(lerp(P[i]!, P[j]!, fi / (fi - fj))) }
    if (pts.length === 2 && keep(lerp(pts[0]!, pts[1]!, 0.5))) out.push([pts[0]!, pts[1]!]) }
  return out
}
/** segments → the longest chain (endpoints welded) */
function chain(segs: [V3, V3][]): V3[] {
  const key = (p: V3) => p.map(v => Math.round(v * 1e4)).join(','), adj = new Map<string, { p: V3; n: string[] }>()
  for (const [a, c] of segs) { const ka = key(a), kc = key(c); if (ka === kc) continue
    for (const [k, p, o] of [[ka, a, kc], [kc, c, ka]] as const) { const e = adj.get(k) ?? adj.set(k, { p, n: [] }).get(k)!; e.n.push(o) } }
  const seen = new Set<string>(); let best: V3[] = []
  for (const k0 of adj.keys()) { if (seen.has(k0)) continue
    // walk both ways from k0
    const walk = (start: string, from: string | null) => { const out: V3[] = []; let cur = start, prev = from
      while (true) { seen.add(cur); const e = adj.get(cur)!; const nx = e.n.find(k => k !== prev && !seen.has(k)); if (!nx) break; out.push(adj.get(nx)!.p); prev = cur; cur = nx }
      return out }
    const e0 = adj.get(k0)!, fwd = walk(k0, null), back = e0.n.length > 1 ? (() => { const o = e0.n.find(k => !seen.has(k)); return o ? [adj.get(o)!.p, ...walk(o, k0)] : [] })() : []
    const c = [...back.reverse(), e0.p, ...fwd]; if (c.length > best.length) best = c }
  return best
}
const arcs = (q: V3[]) => { const L = [0]; for (let i = 1; i < q.length; i++) L.push(L[i - 1]! + dist(q[i]!, q[i - 1]!)); return L }
/** least-squares cubic through q at chord-length t, ends fixed; and its error (squared distances at the samples) */
function fit(q: V3[]): { c: V3[]; err: number } {
  const n = q.length - 1, L = arcs(q), P0 = q[0]!, P3 = q[n]!
  if (n < 2) return { c: [P0, lerp(P0, P3, 1 / 3), lerp(P0, P3, 2 / 3), P3], err: 0 }
  let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0, 0], r2 = [0, 0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / L[n]!, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (let k = 0; k < 3; k++) { const r = q[i]![k]! - b0 * P0[k]! - b3 * P3[k]!; r1[k]! += b1 * r; r2[k]! += b2 * r } }
  const det = a11 * a22 - a12 * a12, P1 = [0, 1, 2].map(k => (r1[k]! * a22 - r2[k]! * a12) / det) as V3, P2 = [0, 1, 2].map(k => (a11 * r2[k]! - a12 * r1[k]!) / det) as V3
  const c = [P0, P1, P2, P3]
  // error: each input point to the curve (nearest of 60 samples)
  const S = Array.from({ length: 61 }, (_, i) => { const t = i / 60, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((a, wi, j) => a + wi * c[j]![k]!, 0)) as V3 })
  return { c, err: q.reduce((a, p) => a + Math.min(...S.map(s => dist(s, p))) ** 2, 0) }
}
/** fit consecutive pieces between joints (indices into q); then slide each inner joint along q while the total error falls */
function piecewise(q: V3[], joints: number[], closed = false, reach = 8) {
  const pieces = (js: number[]) => js.slice(0, closed ? js.length : -1).map((a, k) => { const e = js[(k + 1) % js.length]!; const idx = e > a ? Array.from({ length: e - a + 1 }, (_, i) => a + i) : [...Array.from({ length: q.length - a }, (_, i) => a + i), ...Array.from({ length: e + 1 }, (_, i) => i)]; return fit(idx.map(i => q[i]!)) })
  const total = (js: number[]) => pieces(js).reduce((a, p) => a + p.err, 0)
  let js = [...joints], best = total(js)
  for (let round = 0; round < 6; round++) { let moved = false
    for (let j = closed ? 0 : 1; j < (closed ? js.length : js.length - 1); j++) for (const step of [-4, -2, -1, 1, 2, 4]) {
      const t = [...js]; t[j] = t[j]! + step; if (Math.abs(t[j]! - joints[j]!) > reach) continue; const lo = closed ? -Infinity : t[j - 1]!, hi = closed ? Infinity : t[j + 1]!
      if (!closed && (t[j]! <= lo + 1 || t[j]! >= hi - 1)) continue
      if (closed) { t[j] = (t[j]! + q.length) % q.length; const sorted = [...t].sort((x, y) => x - y); if (sorted.join() !== [...t].sort((x, y) => x - y).join() || new Set(t).size < t.length) continue }
      const e = total(t); if (e < best - 1e-9) { best = e; js = t; moved = true } }
    if (!moved) break }
  const ps = pieces(js), n = q.length
  return { joints: js, curves: ps.map(p => p.c.map(v => v.map(x => +x.toFixed(4)))), rms: +Math.sqrt(best / n).toFixed(4) }
}

// ---- the meridian: x = 0 ----
// the cut falls into pieces (the skin has holes at the eyes and mouth), so instead of chaining: every cut point by its angle round
// the head's centre (in the y–z plane), the outermost one per degree, in order from the neck's front end (just after the one gap,
// the open bottom of the neck) round the face, over the crown, down the back to the neck's back end
const cutPts = zeroLine(i => P[i]![0]).flat(), CY = -0.35, CZ = 0.05, bins = new Map<number, V3>()
for (const p of cutPts) { const a = Math.floor((Math.atan2(p[1] - CY, p[2] - CZ) * 180) / Math.PI), r = Math.hypot(p[1] - CY, p[2] - CZ), o = bins.get(a); if (!o || r > Math.hypot(o[1] - CY, o[2] - CZ)) bins.set(a, p) }
const angles = [...bins.keys()].sort((x, y) => x - y); let gapAt = 0, gap = -1
for (let k = 0; k < angles.length; k++) { const g = (angles[(k + 1) % angles.length]! - angles[k]! + 360) % 360; if (g > gap) { gap = g; gapAt = k } }
const prof: V3[] = Array.from({ length: angles.length }, (_, k) => bins.get(angles[(gapAt + 1 + k) % angles.length]!)!)
const near = (pred: (p: V3, i: number) => boolean, score: (p: V3) => number) => { let bi = -1, bs = -Infinity; prof.forEach((p, i) => { if (pred(p, i) && score(p) > bs) { bs = score(p); bi = i } }); return bi }
const iCrown = near(() => true, p => p[1]), iNose = near(p => p[2] > 0.5 && p[1] > -1.2, p => p[2])
const iChin = near((p, i) => i < iNose && p[2] > 0.75, p => -p[1])
const iOcc = near((_, i) => i > iCrown, p => -p[2])
const lips = prof.map((p, i) => ({ p, i })).filter(({ i }) => i > iChin && i < iNose)
const bumps = lips.filter(({ i }) => i > 0 && prof[i - 1]![2] <= prof[i]![2] && prof[i + 1]![2] <= prof[i]![2]).sort((x, y) => y.p[2] - x.p[2]).slice(0, 2).sort((x, y) => x.i - y.i)
const iLipLow = bumps[0]?.i ?? Math.round(iChin + (iNose - iChin) / 3), iLipUp = bumps[1]?.i ?? Math.round(iChin + (2 * (iNose - iChin)) / 3)
const iNasion = near((p, i) => i > iNose && p[2] > 0.5 && p[1] < prof[iNose]![1] + 0.6, p => -p[2]), iGlab = near((p, i) => i > iNasion && p[2] > 0.5 && p[1] < prof[iNasion]![1] + 0.35, p => p[2])
// 下巴底拐点: the corner between the chin and the neck's front end (farthest from the straight line between them)
const iThroat = (() => { const a = prof[0]!, c = prof[iChin]!; let bi = 1, bd = -1; for (let i = 1; i < iChin; i++) { const p = prof[i]!, ab = [c[1] - a[1], c[2] - a[2]], ap = [p[1] - a[1], p[2] - a[2]], d = Math.abs(ab[0]! * ap[1]! - ab[1]! * ap[0]!) / Math.hypot(ab[0]!, ab[1]!); if (d > bd) { bd = d; bi = i } } return bi })()
const NAMES = ['颈前', '下巴底拐点', '下巴', '下唇', '上唇', '鼻尖', '眉心', '颅顶', '后脑', '后颈']
const start = [0, iThroat, iChin, iLipLow, iLipUp, iNose, iGlab, iCrown, iOcc, prof.length - 1]
const meridian = piecewise(prof, start)

// ---- the latitude: the normal level (N_y = 0), the loop at the forehead ----
let ring = chain(zeroLine(i => N[i]![1], p => p[1] > -0.4 && p[1] < 0.3))
const front = ring.reduce((bi, p, i) => (Math.abs(p[0]) < 0.05 && p[2] > 0 && (bi < 0 || p[2] > ring[bi]![2]) ? i : bi), -1), back = ring.reduce((bi, p, i) => (Math.abs(p[0]) < 0.05 && p[2] < 0 && (bi < 0 || p[2] < ring[bi]![2]) ? i : bi), -1)
const closedLoop = dist(ring[0]!, ring[ring.length - 1]!) < 0.05
const latitude = piecewise(ring, [front, back].sort((x, y) => x - y), true)
// ---- the ear (bowen 1793100859): its rim seen from the side, 3 cubics 上耳根 → 耳尖 → 耳垂 → 下耳根, open between the roots ----
// the ear = the skin standing out past the head's side (|x| > 0.92) behind the cheek; its rim = per 3° round the ear's centre (in
// the side view, z across, y up) the ear point farthest from it, in 3D; the roots = where the ear meets the head at its top and
// bottom (nearest the head); the tip = the rim's upper-back corner (the way an elf ear stretches); the lobe = the lowest
const EAR = [...new Set(T)].map(i => P[i]!).filter(p => p[0] < -0.92 && p[2] > -0.6 && p[2] < 0.15 && p[1] < 0 && p[1] > -1.1)
const yTop = Math.max(...EAR.map(p => p[1])), yLow = Math.min(...EAR.map(p => p[1])), nearest = (ps: V3[]) => ps.reduce((a, p) => (Math.abs(p[0]) < Math.abs(a[0]) ? p : a))
const rootUp = nearest(EAR.filter(p => p[1] > yTop - 0.08)), rootLow = nearest(EAR.filter(p => p[1] < yLow + 0.08))
const ec = [0, 1, 2].map(k => EAR.reduce((a, p) => a + p[k]!, 0) / EAR.length) as V3, ang = (p: V3) => ((Math.atan2(p[1] - ec[1], p[2] - ec[2]) * 180) / Math.PI + 360) % 360
const rimBins = new Map<number, V3>()
for (const p of EAR) { const a = Math.floor(ang(p) / 3), r = Math.hypot(p[1] - ec[1], p[2] - ec[2]), o = rimBins.get(a); if (!o || r > Math.hypot(o[1] - ec[1], o[2] - ec[2])) rimBins.set(a, p) }
// the ear is a thin plate: at each rim place take the outer face (the ear point farthest out sideways within 0.03 of it), so the
// rim does not zigzag between the plate's two faces
for (const [a, p] of rimBins) { const out = EAR.filter(q => Math.hypot(q[1] - p[1], q[2] - p[2]) < 0.03).reduce((m, q) => (q[0] < m[0] ? q : m), p); rimBins.set(a, out) }
// the rim from the upper root's angle round the back and the bottom to the lower root's (the front, where it is attached, left open)
const aUp = ang(rootUp), aLow = ang(rootLow), span = (aLow - aUp + 360) % 360
const rim: V3[] = [rootUp, ...[...rimBins.entries()].map(([k, p]) => ({ t: ((k * 3 + 1.5 - aUp + 360) % 360), p })).filter(e => e.t > 3 && e.t < span - 3).sort((x, y) => x.t - y.t).map(e => e.p), rootLow]
// the tip: the rim's upper-back corner (farthest up-and-back from the ear's centre in the side view) — where an elf ear stretches
const ub = (p: V3) => (p[1] - ec[1]) - (p[2] - ec[2]), iTip = rim.reduce((bi, p, i) => (i > 0 && i < rim.length - 1 && ub(p) > ub(rim[bi]!) ? i : bi), 1)
const iLobe = rim.reduce((bi, p, i) => (i > iTip && p[1] < rim[bi]!![1] ? i : bi), Math.min(rim.length - 2, iTip + 1))
const earFit = piecewise(rim, [0, iTip, iLobe, rim.length - 1], false, 6)
const mirror = (c: number[][]) => c.map(p => [-p[0]!, p[1]!, p[2]!])
// how close the blue crossing clusters by the ear lie to the rim
const CLe = JSON.parse(readFileSync('face3d/viewer/vrm-clusters.json', 'utf8')).clusters as { p: V3 }[]
const earCl = CLe.filter(c => c.p[0] < -0.85 && c.p[1] < -0.2 && c.p[1] > -1.0 && c.p[2] < 0.2).map(c => Math.min(...rim.map(r => dist(r, c.p))))

// how close the orange (one-turn-angle) crossing clusters lie to it
const CL = JSON.parse(readFileSync('face3d/viewer/vrm-clusters.json', 'utf8')).clusters as { p: V3; yaws: number[] }[]
const orange = CL.filter(c => c.yaws.length <= 2 && c.p[1] > -0.25 && c.p[1] < 0.1).map(c => Math.min(...ring.map(r => dist(r, c.p))))

const out = {
  note: 'the simplest head wireframe: one meridian (the plane of symmetry, 9 cubics) and one latitude (normal level at the forehead, 2 cubics); joints slid for the least total error (face3d/fit/vrm-wire.ts, bowen 1793100382 / 1793100411)',
  meridian: { names: NAMES, joints: meridian.joints.map(i => prof[i]!.map(v => +v.toFixed(4))), curves: meridian.curves, rms: meridian.rms, raw: prof.map(p => p.map(v => +v.toFixed(4))) },
  ear: { names: ['上耳根', '耳尖', '耳垂', '下耳根'], joints: earFit.joints.map(i => rim[i]!.map(v => +v.toFixed(4))), curves: [...earFit.curves, ...earFit.curves.map(mirror)], rms: earFit.rms, raw: rim.map(p => p.map(v => +v.toFixed(4))),
    clusterDistance: { n: earCl.length, median: +([...earCl].sort((x, y) => x - y)[Math.floor(earCl.length / 2)] ?? NaN).toFixed(4) } },
  latitude: { closed: closedLoop, joints: latitude.joints.map(i => ring[i]!.map(v => +v.toFixed(4))), curves: latitude.curves, rms: latitude.rms, raw: ring.map(p => p.map(v => +v.toFixed(4))), orangeDistance: { n: orange.length, median: +([...orange].sort((x, y) => x - y)[Math.floor(orange.length / 2)] ?? NaN).toFixed(4), max: +Math.max(...orange).toFixed(4) } },
}
writeFileSync('face3d/viewer/vrm-wire.json', JSON.stringify(out))
console.log('meridian points', prof.length, 'rms', meridian.rms, 'joints moved', meridian.joints.map((j, k) => j - start[k]!).join(','))
console.log('latitude points', ring.length, 'closed', closedLoop, 'rms', latitude.rms, 'orange→ring', JSON.stringify(out.latitude.orangeDistance))
console.log('ear rim points', rim.length, 'rms', earFit.rms, 'joints', out.ear.joints.map(j => j.join(',')).join(' | '), 'clusters→rim', JSON.stringify(out.ear.clusterDistance))
console.log('joints', NAMES.map((n, k) => `${n} ${out.meridian.joints[k]!.join(',')}`).join(' | '))
