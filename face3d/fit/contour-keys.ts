// The outline as a function of the view, f(yaw, pitch) = contour, from keyframes (bowen 1793153948 「每15度一个yaw pitch角度那么一共存
// 13*13条…当作关键帧，然后关键帧与帧之间靠三角/四角混合算法算出没有关键帧的位置…vroid模型也给出这个角度的对应contour看这样的contour
// 是不是会更平顺」). Keyframes: turn −90 … 90 × tilt −90 … 90 every 15° (169); each VRoid's outline on the screen (the head with
// its neck cut at the base ring, ears pressed flat), as a closed loop from its top (straight up from the head's centre on the
// screen) clockwise, split at its bottom (straight down) into two halves of 180 points each by arc length — the k-th point of
// every keyframe in about the same place, so keyframes mix point by point. Any view: the four keyframes round it, mixed by
// bilinear weights. Checked against VRoid's own outline at the in-between views, and how much each moves from one view to the
// next 0.5° on (a sweep): the keyframe mix against the outline worked out live.
// Writes face3d/viewer/contour-keys.json. Run: npx vite-node face3d/fit/contour-keys.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { type P2, PS, YS, buildHead, contourAt as cAt, mixAt } from './contour-keys-core'
type P3 = [number, number, number]
const doc = JSON.parse(readFileSync('face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { name: string; p: P3 }[] }
const pt = (n: string) => doc.points.find(p => p.name === n)!.p
const buf = readFileSync('face3d/fit/ref/test.vrm'), yBase = Math.max(pt('后颈')[1], pt('颈前')[1]) + 0.03
const HEAD = buildHead(() => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), yBase), contourAt = (y: number, p: number) => cAt(HEAD, y, p)
{
  const K = YS.map(y => PS.map(p => contourAt(y, p)))
  writeFileSync('face3d/viewer/contour-keys.json', JSON.stringify({ yBase, note: "VRoid's outline (neck cut at the base ring, ears pressed flat) at turn × tilt −90…90 every 15°, each 2×180 points from its top clockwise, halves split at its bottom, by arc length (face3d/fit/contour-keys.ts, bowen 1793153948). keys[i][j] = turn YS[i], tilt PS[j]", YS, PS, keys: K }))
  // how far the mix is from VRoid's own outline, half way between keyframes, and how much each jumps per 0.5° in a sweep
  const dist = (A: P2[], B: P2[]) => { const d = A.map(a => Math.min(...B.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])))).sort((x, y) => x - y); return { med: d[Math.floor(d.length / 2)]!, p90: d[Math.floor(d.length * 0.9)]!, max: d[d.length - 1]! } }
  for (const [y, p] of [[7.5, 0], [22.5, 0], [37.5, 7.5], [52.5, -22.5], [67.5, 37.5], [82.5, -52.5], [22.5, 67.5], [7.5, -82.5]] as [number, number][]) {
    const r = dist(mixAt(K, y, p), contourAt(y, p)); console.log(`转 ${y} 俯仰 ${p}: 混合 vs 真  中位 ${r.med.toFixed(4)} 九成 ${r.p90.toFixed(4)} 最大 ${r.max.toFixed(4)}`) }
  // sweep: turn 0 → 90 at tilt 10, step 0.5°: the mean move of corresponding points per step, and its roughness (second difference)
  const sweep = (f: (y: number) => P2[]) => { const S = Array.from({ length: 181 }, (_, k) => f(k * 0.5)); const mv = S.slice(1).map((s, k) => s.reduce((a, q, m) => a + Math.hypot(q[0] - S[k]![m]![0], q[1] - S[k]![m]![1]), 0) / s.length)
    const acc = S.slice(2).map((s, k) => s.reduce((a, q, m) => a + Math.hypot(q[0] - 2 * S[k + 1]![m]![0] + S[k]![m]![0], q[1] - 2 * S[k + 1]![m]![1] + S[k]![m]![1]), 0) / s.length)
    return { move: mv.reduce((a, x) => a + x, 0) / mv.length, rough: acc.reduce((a, x) => a + x, 0) / acc.length, roughMax: Math.max(...acc) } }
  const sr = sweep(y => contourAt(y, 10)), sm = sweep(y => mixAt(K, y, 10))
  console.log('转 0→90 俯仰 10，每 0.5°：真轮廓 每步平均移动', sr.move.toFixed(4), '抖动(二阶差)', sr.rough.toFixed(4), '最大', sr.roughMax.toFixed(4), '| 关键帧混合 每步平均移动', sm.move.toFixed(4), '抖动', sm.rough.toFixed(4), '最大', sm.roughMax.toFixed(4))
}
