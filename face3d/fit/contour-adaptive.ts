// How few outline keyframes are enough (bowen 1793155191 「有些角度靠附近的关键帧interpolate就足够贴合，而有些位置关键帧需要打得更密集，
// 最小分辨率是1度，你测试一下最少可以只用多少关键帧？」). The answer to match: VRoid's outline (face3d/fit/contour-keys-core.ts) at every
// whole degree, turn × tilt −90 … 90 (181² views). Keyframes start at the four corners; the views are mixed from the three keyframes
// of the triangle they lie in (Delaunay triangles over (turn, tilt); barycentric weights, point by point — no seams where the
// keyframes are denser on one side); the view worst matched gets the next keyframe; until every view is within the tolerance.
// A view's miss: the farthest any point of the mix is from VRoid's outline or any point of VRoid's outline from the mix (each
// against the other's line near the same index). Prints the keyframes needed per tolerance; writes face3d/viewer/contour-adaptive.json
// (the keyframes in the order added — the first N of them, triangulated, are the set for the N-th tolerance — with their outlines).
// Run: npx vite-node face3d/fit/contour-adaptive.ts   (the 181² outlines are kept in the system temp folder for reruns)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CENTRE, HALF, buildHead, contourAt, disorder, missed, spinOf } from './contour-keys-core'
import { rotate, screenAxes } from '../src/view'
import { delaunay } from './delaunay'

type P3 = [number, number, number]
const N = 181, M = 2 * HALF, L = 2 * M, V = (y: number, p: number) => (y + 90) * N + (p + 90)
const doc = JSON.parse(readFileSync('face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { name: string; p: P3 }[]; lines: { name: string; c: number[][] }[] }
const pt = (n: string) => doc.points.find(p => p.name === n)!.p, yBase = Math.max(pt('后颈')[1], pt('颈前')[1]) + 0.03
// PART=shell: the head with its nose and lips pressed flat; PART=nose: what was pressed off (face3d/fit/flatten-face.ts) — each its
// own keyframes (bowen 1793155916)
// NECK=0: the neck left out of the measure as well (everything below the chin's underside, 下巴底拐点 − 0.02), not just its cut
// LONG=1: the neck a long tube and every outline cut by the circle round the head (bowen 1793156407); CAP=1: no neck, the cut below
// the chin capped (bowen 1793156878) — nothing left out of the measure either way
// WIRE=1: the head cut along bowen's head–neck ring and capped, the neck its own part (PART=neck) between his two rings (bowen
// 1793156931 / 1793156971 / 1793157014)
// RIM=1 (bowen 1793157748): keyframes are the line on the head the outline touches (3D), mixed and then seen from the view — not
// the flat outline; SPIN=1: the anchors turn with the head's spin on the screen, and keyframes mix in the head's own frame (each turned back by its
// spin round its centre, mixed, turned by the view's)
const RIM = process.env.RIM === '1', SPIN = process.env.SPIN === '1', A = +(process.env.A ?? 2), PART = process.env.PART ?? 'head', NECK = process.env.NECK !== '0', LONG = process.env.LONG === '1', CAP = process.env.CAP === '1', WIRE = process.env.WIRE === '1'
const tag = `a${A}${PART === 'head' ? '' : `-${PART}`}${NECK ? '' : '-noneck'}${LONG ? '-long' : ''}${CAP ? '-cap' : ''}${WIRE ? '-wire' : ''}${SPIN ? '-spin' : ''}${RIM ? '-rim' : ''}`
const cache = join(tmpdir(), `contour-truth-1deg-${yBase.toFixed(4)}-${tag}-cut.f32`)
// T: VRoid's outline per view (flat, M points); R (RIM): the outline's places on the head (M × 3); CUT: points at the neck's cut
let T: Float32Array, CUT: Uint8Array, R = new Float32Array(0)
const nR = RIM ? N * N * M * 3 : 0
if (existsSync(cache)) { const b = readFileSync(cache), o = b.byteOffset; T = new Float32Array(b.buffer.slice(o, o + N * N * L * 4)); R = new Float32Array(b.buffer.slice(o + N * N * L * 4, o + N * N * L * 4 + nR * 4)); CUT = new Uint8Array(b.buffer.slice(o + N * N * L * 4 + nR * 4, o + b.byteLength)) }
else {
  const buf = readFileSync('face3d/fit/ref/test.vrm'), H0 = buildHead(() => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), yBase, PART === 'shell' || PART === 'nose', WIRE ? 'wire' : LONG ? 'tube' : CAP ? 'cap' : 'cut', doc.lines), H = PART === 'nose' ? H0.nose! : PART === 'neck' ? H0.neck! : H0
  T = new Float32Array(N * N * L); R = new Float32Array(nR); CUT = new Uint8Array(N * N * M)
  for (let y = -90; y <= 90; y++) { for (let p = -90; p <= 90; p++) { const cut: number[] = [], rim: number[] = []; T.set(contourAt(H, y, p, undefined, A, cut, NECK || PART === 'nose' ? undefined : pt('下巴底拐点')[1] - 0.02, SPIN, RIM ? rim : undefined).flat(), V(y, p) * L); CUT.set(cut, V(y, p) * M); if (RIM) R.set(rim, V(y, p) * M * 3) } if (y % 10 === 0) console.log('outlines at turn', y) }
  writeFileSync(cache, Buffer.concat([Buffer.from(T.buffer), Buffer.from(R.buffer), Buffer.from(CUT.buffer)])); console.log('anchors', A, 'out of order at', disorder.count, 'views; rays missing', missed.count)
}
// the miss of an outline Q (M points, flat) against VRoid's at view v: both ways, each point against the other's segments within ±W;
// the points at the neck's cut left out (bowen 1793155767 「脖子截口那里无所谓的」) — VRoid's there, and the mix's of the same index
const W = 15
function miss(Q: Float32Array, v: number) {
  const o = v * L; let worst = 0
  for (const [Aa, oa, B, ob] of [[Q, 0, T, o], [T, o, Q, 0]] as const)
    for (let k = 0; k < M; k++) { if (CUT[v * M + k]) continue; const x = Aa[oa + 2 * k]!, y = Aa[oa + 2 * k + 1]!; let best = Infinity
      for (let d = -W; d < W; d++) { const i = (k + d + M) % M, j = (i + 1) % M, ax = B[ob + 2 * i]!, ay = B[ob + 2 * i + 1]!, bx = B[ob + 2 * j]! - ax, by = B[ob + 2 * j + 1]! - ay
        const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1))), e = Math.hypot(x - ax - t * bx, y - ay - t * by); if (e < best) best = e }
      if (best > worst) worst = best }
  return worst
}
const view = (v: number) => [Math.floor(v / N) - 90, (v % N) - 90] as [number, number]
const keys: number[] = [V(-90, -90), V(90, -90), V(90, 90), V(-90, 90)]
const tri = delaunay(keys.map(view))
const err = new Float32Array(N * N), Q = new Float32Array(L)
function score(views: number[], t: [number, number, number]) {
  const [a, b, c] = t.map(i => keys[i]!) as [number, number, number], P = [a, b, c].map(v => [Math.floor(v / N) - 90, (v % N) - 90])
  const det = (P[1]![0]! - P[0]![0]!) * (P[2]![1]! - P[0]![1]!) - (P[2]![0]! - P[0]![0]!) * (P[1]![1]! - P[0]![1]!)
  for (const v of views) { const y = Math.floor(v / N) - 90, p = (v % N) - 90
    const w1 = ((y - P[0]![0]!) * (P[2]![1]! - P[0]![1]!) - (P[2]![0]! - P[0]![0]!) * (p - P[0]![1]!)) / det, w2 = ((P[1]![0]! - P[0]![0]!) * (p - P[0]![1]!) - (y - P[0]![0]!) * (P[1]![1]! - P[0]![1]!)) / det, w0 = 1 - w1 - w2
    if (RIM) { // the three keyframes' lines on the head mixed, seen from this view
      const ax = screenAxes({ yaw: y, pitch: p }), ra = a * M * 3, rb = b * M * 3, rc = c * M * 3
      for (let k = 0; k < M; k++) { let X = 0, Y = 0; for (let m = 0; m < 3; m++) { const q = w0 * R[ra + 3 * k + m]! + w1 * R[rb + 3 * k + m]! + w2 * R[rc + 3 * k + m]!; X += q * ax.right[m]!; Y += q * ax.up[m]! } Q[2 * k] = X; Q[2 * k + 1] = Y } }
    else if (!SPIN) for (let k = 0; k < L; k++) Q[k] = w0 * T[a * L + k]! + w1 * T[b * L + k]! + w2 * T[c * L + k]!
    else { // in the head's frame: each keyframe turned back by its spin round its centre, mixed, then turned by this view's
      const fr = [a, b, c].map(v => { const [yy, pp] = view(v), c0 = rotate(centre, { yaw: yy, pitch: pp }), t = -spinOf(yy, pp); return { o: v * L, c0, ct: Math.cos(t), st: Math.sin(t) } }), ws = [w0, w1, w2]
      const cm = [0, 1].map(m => fr.reduce((s, f, i) => s + ws[i]! * f.c0[m]!, 0)), t = spinOf(y, p), ct = Math.cos(t), st = Math.sin(t)
      for (let k = 0; k < M; k++) { let x = 0, yv = 0; fr.forEach((f, i) => { const dx = T[f.o + 2 * k]! - f.c0[0]!, dy = T[f.o + 2 * k + 1]! - f.c0[1]!; x += ws[i]! * (f.ct * dx - f.st * dy); yv += ws[i]! * (f.st * dx + f.ct * dy) })
        Q[2 * k] = cm[0]! + ct * x - st * yv; Q[2 * k + 1] = cm[1]! + st * x + ct * yv } }
    err[v] = miss(Q, v) }
}
// views per triangle; each insertion re-scores only the views of the triangles it replaced
const centre: P3 = PART === 'nose' ? [0, -0.95, 0.95] : PART === 'neck' ? [0, -1.45, -0.05] : CENTRE, all = // as each part's head (contour-keys-core.ts)
   Array.from({ length: N * N }, (_, v) => v)
tri.assign(all, view).forEach(([t, vs]) => score(vs, t))
const TOL = [0.05, 0.04, 0.03, 0.025, 0.02, 0.015, 0.0125, 0.01, 0.0085]
const table: { tol: number; keys: number }[] = []
for (let ti = 0; ti < TOL.length; ) {
  let wv = -1, we = -1; for (const vs of tri.views()) for (const v of vs) if (err[v]! > we) { we = err[v]!; wv = v }
  while (ti < TOL.length && we <= TOL[ti]!) { table.push({ tol: TOL[ti]!, keys: keys.length }); console.log(`最远偏差 ≤ ${TOL[ti]}：${keys.length} 个关键帧`); ti++ }
  if (ti >= TOL.length || keys.length > 6000) break
  keys.push(wv); tri.insert(view(wv)).forEach(([t, vs]) => score(vs, t))
  if (keys.length % 200 === 0) console.log(keys.length, 'keys, worst', we.toFixed(4))
}
writeFileSync(`face3d/viewer/contour-adaptive-${tag}.json`, JSON.stringify({ yBase, anchors: A, part: PART, note: "Outline keyframes added worst-first over turn × tilt −90…90 at 1° (face3d/fit/contour-adaptive.ts, bowen 1793155191); the first table[i].keys of them, Delaunay-triangulated, mix every whole-degree view within table[i].tol (the miss: farthest point either way, head units; the head ≈ 2.4 tall)", table,
  keys: keys.map(v => ({ v: view(v), c: Array.from(T.subarray(v * L, v * L + L), x => +x.toFixed(4)) })), cut: keys.map(v => Array.from(CUT.subarray(v * M, v * M + M)).join('')) }))
