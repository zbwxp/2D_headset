// bowen's ear drawn on a screenshot of the wire viewer (bowen 1793101979 「这才是耳朵」, 1793102241 「这张3D图的线上画的语义点，
// 你能还原出我们模型的线应该在空间的什么位置吗」) back into 3D:
// 1. the view: the screenshot shows the viewer's head with our known 3D lines on it (eye sockets purple, meridian red, latitude
//    orange); the view (turn, pitch) and the picture's scale and shift are found where those lines' pictures lie closest to the
//    coloured pixels (each pixel to its own colour's lines; hidden parts of a line simply have no pixels);
// 2. bowen's black line, followed pixel to pixel from his 上耳根 mark, each point sent along its line of sight onto the ear: the
//    ear point nearest the eye among those that line passes through, or, when it passes beside the ear (the line drawn just
//    outside the ear's outline), the ear point nearest to it — on the outline;
// 3. the four marks (上耳根, 耳尖, 耳垂, 下耳根; bowen 1793102241 「差不多了」) → indices on that 3D line.
// The ear = the skin standing out of the head's side: |x| above a smooth side surface fitted round the ear.
// Writes face3d/viewer/ref-ear/bowen-1793101979.ear.json. Run: npx vite-node face3d/fit/ear-from-drawing.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
type V3 = [number, number, number]
type V2 = [number, number]
const REF = 'face3d/viewer/ref-ear/bowen-1793101979'
const px = JSON.parse(readFileSync(`${REF}.pixels.json`, 'utf8')) as Record<'purple' | 'red' | 'orange' | 'black', V2[]>
const wire = JSON.parse(readFileSync('face3d/viewer/vrm-wire.json', 'utf8')) as Record<'eyes' | 'meridian' | 'latitude', { curves: number[][][] }>
// the four marks on bowen's line (picture pixels), as checked by bowen (1793102241)
const MARKS: [string, V2][] = [['上耳根', [426, 534]], ['耳尖', [268, 498]], ['耳垂', [405, 846]], ['下耳根', [459, 852]]]

const cubic = (c: number[][], t: number): V3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((a, wi, j) => a + wi * c[j]![k]!, 0)) as V3 }
const samples = (curves: number[][][]) => curves.flatMap(c => Array.from({ length: 41 }, (_, i) => cubic(c, i / 40)))
const LINES = { purple: samples(wire.eyes.curves), red: samples(wire.meridian.curves), orange: samples(wire.latitude.curves) }
const every = <T>(a: T[], n: number) => a.filter((_, i) => i % n === 0)
const PIX = { purple: every(px.purple, 3), red: every(px.red, 3), orange: every(px.orange, 3) }

// ---- 1. the view ----
// for a turn and pitch, the scale k and shift (ox, oy) by alternating: match each pixel to its nearest projected line point, then
// solve u = ox + k·q0, v = oy − k·q1 in least squares
function fitView(yaw: number, pitch: number, k0 = 0, o0: V2 = [0, 0], iters = 20) {
  const proj = Object.fromEntries(Object.entries(LINES).map(([c, ps]) => [c, ps.map(p => rotate(p, { yaw, pitch }))])) as Record<keyof typeof PIX, V3[]>
  const all = Object.entries(PIX).flatMap(([c, ps]) => ps.map(p => ({ c: c as keyof typeof PIX, p })))
  // first guess: match the extents of all pixels and all line points of the visible kinds
  let k = k0, ox = o0[0], oy = o0[1]
  if (!k) { const us = all.map(a => a.p[0]), qs = Object.values(proj).flat().map(q => q[0]); k = (Math.max(...us) - Math.min(...us)) / (Math.max(...qs) - Math.min(...qs)); ox = Math.min(...us) - k * Math.min(...qs)
    const vs = all.map(a => a.p[1]), q1 = Object.values(proj).flat().map(q => q[1]); oy = Math.min(...vs) + k * Math.max(...q1) }
  let err = Infinity
  for (let it = 0; it < iters; it++) {
    let s = 0, sqx = 0, sqy = 0, su = 0, sv = 0, sqq = 0, squ = 0, n = 0; err = 0
    for (const { c, p } of all) { let bd = Infinity, bq: V3 = proj[c][0]!
      for (const q of proj[c]) { const d = (ox + k * q[0] - p[0]) ** 2 + (oy - k * q[1] - p[1]) ** 2; if (d < bd) { bd = d; bq = q } }
      err += bd; n++; sqx += bq[0]; sqy += bq[1]; su += p[0]; sv += p[1]; sqq += bq[0] * bq[0] + bq[1] * bq[1]; squ += bq[0] * p[0] - bq[1] * p[1]; s++ }
    // minimise Σ (ox + k qx − u)² + (oy − k qy − v)²
    const mqx = sqx / n, mqy = sqy / n, mu = su / n, mv = sv / n
    k = (squ / n - (mqx * mu - mqy * mv)) / (sqq / n - (mqx * mqx + mqy * mqy)); ox = mu - k * mqx; oy = mv + k * mqy
  }
  return { yaw, pitch, k, ox, oy, rms: Math.sqrt(err / all.length) }
}
let best = fitView(60, 10)
for (let yaw = 20; yaw <= 90; yaw += 5) for (let pitch = -30; pitch <= 40; pitch += 5) { const f = fitView(yaw, pitch, 0, [0, 0], 8); if (f.rms < best.rms) best = f }
for (const step of [2, 1, 0.5, 0.25]) for (let moved = true; moved;) { moved = false
  for (const [dy, dp] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) { const f = fitView(best.yaw + dy, best.pitch + dp, best.k, [best.ox, best.oy], 8); if (f.rms < best.rms - 1e-6) { best = f; moved = true } } }
best = fitView(best.yaw, best.pitch, best.k, [best.ox, best.oy], 30)
console.log('view', JSON.stringify(best))

// ---- the ear: skin standing out of the head's side (near side, x < 0) ----
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), P = D.P, T = D.skinTris
const zone = (p: V3) => p[2] > -0.38 && p[2] < 0.12 && p[1] < -0.28 && p[1] > -1.1
const ring = [...new Set(T)].map(i => P[i]!).filter(p => p[0] < -0.5 && p[2] > -0.7 && p[2] < 0.4 && p[1] < 0 && p[1] > -1.3 && !zone(p))
const basis = (y: number, z: number) => [1, y, z, y * y, y * z, z * z, y * y * y, y * y * z, y * z * z, z * z * z]
const NB = 10, A = Array.from({ length: NB }, () => new Array<number>(NB + 1).fill(0))
for (const p of ring) { const f = basis(p[1], p[2]); for (let i = 0; i < NB; i++) { for (let j = 0; j < NB; j++) A[i]![j]! += f[i]! * f[j]!; A[i]![NB]! += f[i]! * -p[0] } }
for (let i = 0; i < NB; i++) { let m = i; for (let r = i + 1; r < NB; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[m]![i]!)) m = r; [A[i], A[m]] = [A[m]!, A[i]!]
  for (let r = 0; r < NB; r++) if (r !== i) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= NB; c++) A[r]![c]! -= f * A[i]![c]! } }
const co = A.map((r, i) => r[NB]! / r[i]!), side = (y: number, z: number) => basis(y, z).reduce((a, f, i) => a + f * co[i]!, 0)
// standing out ≥ 0.03 = the ear for sure; ≥ 0.005 = also its low parts by the head (the flap at the upper root, the lobe's front)
const stand = (p: V3) => (p[0] < -0.5 && zone(p) ? -p[0] - side(p[1], p[2]) : -1)
// the ear's surface sampled densely (triangles with all corners standing out), each sample with its least corner's stand
// (each sample its own stand: the ear's big triangles reach from the ear onto the head)
const S: { p: V3; st: number }[] = []
for (let t = 0; t < T.length; t += 3) { const v = [P[T[t]!]!, P[T[t + 1]!]!, P[T[t + 2]!]!]; if (Math.max(...v.map(stand)) < -0.5) continue // round the ear
  const N = 20; for (let i = 0; i <= N; i++) for (let j = 0; i + j <= N; j++) { const a = i / N, c = j / N, e = 1 - a - c, p = [0, 1, 2].map(k => a * v[0]![k]! + c * v[1]![k]! + e * v[2]![k]!) as V3, st = stand(p); if (st > -0.5) S.push({ p, st }) } }
const view = { yaw: best.yaw, pitch: best.pitch }, SQ = S.map(s => ({ ...s, q: rotate(s.p, view) }))
const toPic = (q: V3): V2 => [best.ox + best.k * q[0], best.oy - best.k * q[1]]

// ---- 2. bowen's line, followed from 上耳根 ----
let left = [...px.black], cur: V2 = left.reduce((m, p) => (Math.hypot(p[0] - MARKS[0]![1][0], p[1] - MARKS[0]![1][1]) < Math.hypot(m[0] - MARKS[0]![1][0], m[1] - MARKS[0]![1][1]) ? p : m))
const walk: V2[] = [cur]
const END = MARKS[3]![1]
for (;;) { if (Math.hypot(cur[0] - END[0], cur[1] - END[1]) < 3) break // his line ends at 下耳根 (the stroke is thick; don't walk back along it)
  left = left.filter(p => Math.hypot(p[0] - cur[0], p[1] - cur[1]) > 4); let nx: V2 | null = null, bd = 10
  for (const p of left) { const d = Math.hypot(p[0] - cur[0], p[1] - cur[1]); if (d < bd) { bd = d; nx = p } }
  if (!nx) break; cur = nx; walk.push(cur) }
// the stroke is a few pixels thick, so the walk wobbles across it: smoothed (±3 points), ends kept
const path = walk.map((p, i) => (i === 0 || i === walk.length - 1 ? p : ([0, 1].map(k => { const w = walk.slice(Math.max(0, i - 3), i + 4); return w.reduce((a, q) => a + q[k]!, 0) / w.length }) as V2)))
// each path point onto the ear
const R = 3, onEar = path.map(([u, v]) => {
  const pic = SQ.map(s => ({ s, d: Math.hypot(toPic(s.q)[0] - u, toPic(s.q)[1] - v) }))
  // through the ear for sure, else through its low parts, else beside the ear (the ear-for-sure point nearest the line of
  // sight: the line drawn just outside the ear's outline). Never the head behind or the flap of skin at the upper root
  // (bowen 1793102726 「这个小勾并不合理」: the line on that flap made a hook)
  const front = (es: typeof pic) => es.reduce((m, e) => (e.s.q[2] > m.s.q[2] ? e : m))
  const sure = pic.filter(e => e.d < R && e.s.st >= 0.03), low = pic.filter(e => e.d < R && e.s.st >= 0.005)
  return sure.length ? { ...front(sure), tier: 'sure' } : low.length ? { ...front(low), tier: 'low' } : { ...pic.filter(e => e.s.st >= 0.03).reduce((m, e) => (e.d < m.d ? e : m)), tier: 'beside' }
})
// the line starts and ends on the ear: leading / trailing points whose line of sight misses the ear (more than R beside it) dropped,
// so 上耳根 is where bowen's line first reaches the ear
const first = onEar.findIndex(e => e.d < R), last = onEar.length - 1 - [...onEar].reverse().findIndex(e => e.d < R)
const kept = onEar.slice(first, last + 1), pts = kept.map(e => e.s.p.map(v => +v.toFixed(4)) as V3), off = kept.map(e => +e.d.toFixed(1))
// ---- 3. the marks → indices (a mark off the kept part goes to its nearest end) ----
const marks = MARKS.map(([name, m]) => ({ name, i: Math.max(0, Math.min(kept.length - 1, path.reduce((bi, p, i) => (Math.hypot(p[0] - m[0], p[1] - m[1]) < Math.hypot(path[bi]![0] - m[0], path[bi]![1] - m[1]) ? i : bi), 0) - first)) }))
writeFileSync(`${REF}.ear.json`, JSON.stringify({ note: 'bowen\'s ear line (screenshot 1793101979) back in 3D: face3d/fit/ear-from-drawing.ts', view: best, path: path.slice(first, last + 1), dropped: { start: first, end: onEar.length - 1 - last }, points: pts, offPixels: off, marks }))
console.log('path', path.length, 'ear samples', S.length, 'marks', JSON.stringify(marks), 'beside the ear (px) max', Math.max(...off), 'median', [...off].sort((x, y) => x - y)[Math.floor(off.length / 2)])
