// Front-on ±45 derived from the side view (bowen 1793074250 / 1793074265: yaw 90 pitch ±45 is the side view turned 45°, the
// correct answer; a turn never changes a height, so the front view at ±45 has the same heights). The 90° view (pitch 0) is
// turned ±45° about the near ear and moved up/down so the eye corners keep their 0° height (the front keys' framing). Every
// named point's height is read there; across, the front view keeps the pitch-0 front positions (a nod does not move across).
// Writes 正脸俯仰推导.svg and derive-front.json. Run: npx vite-node …/derive-front.ts
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, bez, type ModelData, type V, type Cubic, type Frame, type Show } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const f90 = evaluate(M, 90), f0 = evaluate(M, 0), P = f90.points
const o: V = [(P.nearEarUp![0] + P.nearEarLow![0]) / 2, (P.nearEarUp![1] + P.nearEarLow![1]) / 2]
const e90 = { in: f90.eyes.near[0]!.pts[0]!, out: f90.eyes.near[0]!.pts[30]!, mid: f90.eyes.near[1]!.pts[30]! }
const eye0 = (f0.eyes.near[0]!.pts[0]![1] + f0.eyes.near[0]!.pts[30]![1]) / 2
const GUIDES: [string, string][] = [['top', '头顶'], ['brow', '眉'], ['eyeIn', '内眼角'], ['eyeOut', '外眼角'], ['nose', '鼻尖'], ['lipUp', '上唇'], ['lipLow', '下唇'], ['chin', '下巴'], ['earUp', '上耳点'], ['earTip', '耳尖'], ['earLow', '下耳点']]
const result: Record<string, Record<string, number>> = {}
const W = 1600, Hh = 1600, Z = 3.2
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" font-family="PingFang SC"><rect width="100%" height="100%" fill="#fff"/>`
const dpath = (c: Cubic, tf: (q: V) => V) => { const q = c.map(tf); return `M${q[0]![0].toFixed(1)},${q[0]![1].toFixed(1)} C${q.slice(1).map(v => v.map(x => x.toFixed(1)).join(',')).join(' ')}` }
const T = (x: number, y: number, s: string, col = '#333', size = 15, a = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${col}" text-anchor="${a}">${s}</text>`
function drawFrame(f: Frame, tf: (q: V) => V, col: string, w: number) {
  let s = ''
  for (const l of [...f.outline, ...f.side, ...f.ears.near]) s += `<path d="${dpath(l.c, tf)}" fill="none" stroke="${col}" stroke-width="${w}"/>`
  for (const e of [...f.eyes.near, ...f.eyes.far]) s += `<polyline fill="none" stroke="${col}" stroke-width="${w * 0.8}" points="${e.pts.map(q => tf(q).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
  return s
}
;[45, -45].forEach((pt, row) => {
  const r = (pt * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const rot0 = (q: V): V => { const dx = q[0] - o[0], dy = q[1] - o[1]; return [o[0] + c * dx + s * dy, o[1] - s * dx + c * dy] }
  const sh = eye0 - (rot0(e90.in)[1] + rot0(e90.out)[1]) / 2, rot = (q: V): V => { const v = rot0(q); return [v[0], v[1] + sh] }
  const ys = [...f90.outline, ...f90.side].flatMap(l => Array.from({ length: 81 }, (_, i) => rot(bez(l.c, i / 80))[1]))
  const h: Record<string, number> = { top: Math.min(...ys), crown: rot(P.crown!)[1], brow: rot(P.brow!)[1], eyeIn: rot(e90.in)[1], eyeOut: rot(e90.out)[1], eyeMid: rot(e90.mid)[1], nose: rot(P.noseTip!)[1], lipUp: rot(P.lipUp!)[1], lipLow: rot(P.lipLow!)[1], chin: rot(P.chin!)[1], earUp: rot(P.nearEarUp!)[1], earTip: rot(P.nearEarTip!)[1], earLow: rot(P.nearEarLow!)[1], nearRoot: rot(P.nearRoot!)[1], zyg: rot(P.zyg!)[1], temple: rot(P.temple!)[1] }
  result[pt > 0 ? '仰45' : '俯45'] = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +v.toFixed(2)]))
  const top = 60 + row * 780, cy = top + 360
  // the guides across both panels
  for (const [k, lab] of GUIDES) { const y = cy + h[k]! * Z; svg += `<line x1="20" x2="${W - 20}" y1="${y}" y2="${y}" stroke="#e8a" stroke-width="1" stroke-dasharray="5 4"/>` + T(W - 24, y - 3, `${lab} ${h[k]!.toFixed(0)}`, '#c47', 12, 'end') }
  svg += T(30, top - 18, `${pt > 0 ? '仰' : '俯'} 45　左：侧面（90° 平视整张绕耳根转 45°，标准答案）　右：现在的正脸关键帧（灰）和推出来的点（红点）`, '#111', 20)
  // left: the side view turned
  const L = (q: V): V => [380 + (q[0] - 40) * Z, cy + q[1] * Z]
  svg += drawFrame({ ...f90, outline: f90.outline.map(l => ({ ...l, c: l.c.map(rot) as Cubic })), side: f90.side.map(l => ({ ...l, c: l.c.map(rot) as Cubic })), ears: { ...f90.ears, near: f90.ears.near.map(l => ({ ...l, c: l.c.map(rot) as Cubic })) }, eyes: { near: f90.eyes.near.map(e => ({ ...e, pts: e.pts.map(rot) })), far: [] } } as Frame, L, '#111', 2.2)
  // right: the current front key, and the derived points (across from the pitch-0 front view, height from the side)
  const R = (q: V): V => [1080 + q[0] * Z, cy + q[1] * Z], fk = evaluate(M, 0, undefined, pt)
  svg += drawFrame(fk, R, '#aaa', 1.8)
  const fe = f0.eyes, q0 = f0.points
  const pts: [V, string][] = [[[0, h.top!], '头顶'], [[fe.near[0]!.pts[0]![0], h.eyeIn!], ''], [[fe.near[0]!.pts[30]![0], h.eyeOut!], ''], [[fe.far[0]!.pts[0]![0], h.eyeIn!], ''], [[fe.far[0]!.pts[30]![0], h.eyeOut!], ''],
    [[0, h.nose!], '鼻尖'], [[0, (h.lipUp! + h.lipLow!) / 2], '嘴'], [[0, h.chin!], '下巴'], [[q0.nearEarUp![0], h.earUp!], '上耳点'], [[q0.nearEarTip![0], h.earTip!], '耳尖'], [[q0.nearEarLow![0], h.earLow!], '下耳点'],
    [[q0.zyg![0], h.zyg!], '颧骨点'], [[q0.temple![0], h.temple!], '太阳穴点'], [[q0.nearRoot![0], h.nearRoot!], '耳根']]
  for (const [q, lab] of pts) { const [x, y] = R(q); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#e0103a"/>` + (lab ? T(x + 8, y + 4, lab, '#e0103a', 13) : '') }
})
svg += T(30, Hh - 24, '高度在转头时不变：正脸 ±45 各点的高度 = 侧面转 45° 后的高度（以眼角高度对齐）；左右位置用正脸平视时的。颅顶在正脸看是整颗头的最高处（头顶线）。', '#444', 15)
writeFileSync(join(H, '正脸俯仰推导.svg'), svg + '</svg>')
writeFileSync(join(H, 'derive-front.json'), JSON.stringify({ note: 'front ±45 heights derived from the side view turned 45° about the near ear, eye corners at their 0° height (bowen 1793074250)', heights: result }, null, 1))
console.log(JSON.stringify(result))
