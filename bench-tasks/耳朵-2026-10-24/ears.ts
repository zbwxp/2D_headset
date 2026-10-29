// 耳朵骨线 (bowen 1792812088, 1792812123, 1792812372): the near ear only, at 0 / 45 / 90°. Two bone lines on three points:
// 上耳点 → 耳尖 → 下耳点. 上耳点 / 下耳点 are 线上点 (bench.onLine): kept on the near face outline (上 on 右颅 above the ear
// root, 下 on 右下颌 below it), never splitting it. 耳尖 free. First guesses read off bowen's references (ear-0/45/90.png);
// bowen hand-tunes. A guide layer 耳朵辅助线: 耳尖高 at the temple height −5.67 and 下耳根 at 32 (the earlobe meets the face at
// 32 / 30 / 33 on the references). 90° also takes the turn checker's two changes (bowen 1792812372): the side face's chin
// handle (侧脸·曲线6 hb.y 11.04 → −5) and the far face pulled in 5 (颧骨点, 太阳穴点 x − 5). New files; the inputs are read only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { open, save } from '/Users/bowen/Documents/headset-core/src/archive/index'
type V = { x: number; y: number }
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const UPPER = 'lm03-skb', LOWER = 'cmv3m1am1-6/lmv3m1am1-3' // 右颅 (ear root → crown), 右下颌 (ear root → chin)
const jobs = [
  { yaw: 0, inp: '01-正脸-yaw0-pitch0.近2远3.眼睛骨线.json', out: '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json', up: 1, tip: { x: -66, y: 2 }, low: 32, gx: [-80, -35] },
  { yaw: 45, inp: '03-转头45-yaw45-pitch0.近2远3.眼睛骨线.json', out: '03-转头45-yaw45-pitch0.近2远3.耳朵骨线.json', up: -3, tip: { x: -39, y: 0 }, low: 30, gx: [-50, 0] },
  { yaw: 90, inp: '02-侧脸-yaw90-pitch0.近2远3.眼睛骨线.json', out: '02-侧脸-yaw90-pitch0.近2远3.耳朵骨线.json', up: -4, tip: { x: -8, y: 0 }, low: 33, gx: [-20, 30] },
]
for (const j of jobs) if (existsSync(D + j.out)) throw new Error('exists ' + j.out)
const bez = (c: V[], t: number): V => { const u = 1 - t; return { x: u ** 3 * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t ** 3 * c[3]!.x, y: u ** 3 * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t ** 3 * c[3]!.y } }
const report: Record<number, unknown> = {}
for (const j of jobs) {
  const text = readFileSync(D + j.inp, 'utf8'), core = open(text)
  if (j.yaw === 90) core.edit(e => {
    const s = core.snapshot(), l = s.lines.find(x => x.id === 'lmv6kklw1-13')!, pos = (id: string) => s.points.find(p => p.id === id)!.position
    e.moveHandle('lmv6kklw1-13', 'b', { x: l.hb.x, y: -5 })
    e.move([{ id: 'pmv3m1am1-1', target: { x: pos('pmv3m1am1-1').x - 5, y: pos('pmv3m1am1-1').y } }, { id: 'pm03-skf', target: { x: pos('pm03-skf').x - 5, y: pos('pm03-skf').y } }])
  })
  const s = core.snapshot(), pos = (id: string) => s.points.find(p => p.id === id)!.position
  // a point of the given line at height y (its Bézier, sampled)
  const onAt = (lid: string, y: number): V => { const l = s.lines.find(x => x.id === lid)!, a = pos(l.a), b = pos(l.b), c = [a, { x: a.x + l.ha.x, y: a.y + l.ha.y }, { x: b.x + l.hb.x, y: b.y + l.hb.y }, b]
    let best = bez(c, 0); for (let i = 1; i <= 2000; i++) { const p = bez(c, i / 2000); if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p } return best }
  const up = onAt(UPPER, j.up), low = onAt(LOWER, j.low), third = (a: V, b: V) => ({ x: (b.x - a.x) / 3, y: (b.y - a.y) / 3 })
  core.edit(e => {
    e.layer('layer-ear-bone-R', '右耳骨线')
    e.line('lear-R-1', { id: 'pear-R-up', layer: 'layer-ear-bone-R', position: up }, { id: 'pear-R-tip', layer: 'layer-ear-bone-R', position: j.tip }, { ha: third(up, j.tip), hb: third(j.tip, up) })
    e.line('lear-R-2', 'pear-R-tip', { id: 'pear-R-low', layer: 'layer-ear-bone-R', position: low }, { ha: third(j.tip, low), hb: third(low, j.tip) })
    e.layer('layer-ear-guide', '耳朵辅助线')
    for (const [id, y] of [['tiph', -5.67], ['lowh', 32]] as const) {
      const a = { x: j.gx[0]!, y }, b = { x: j.gx[1]!, y }
      e.line(`lear-guide-${id}`, { id: `pear-guide-${id}-a`, layer: 'layer-ear-guide', position: a }, { id: `pear-guide-${id}-b`, layer: 'layer-ear-guide', position: b }, { ha: third(a, b), hb: third(b, a) })
    }
  })
  core.edit(e => { e.renameLine('lear-R-1', '上耳'); e.renameLine('lear-R-2', '下耳'); e.renameLine('lear-guide-tiph', '耳尖高 −5.67（太阳穴）'); e.renameLine('lear-guide-lowh', '下耳根 32') })
  core.edit(e => e.markBone(['lear-R-1', 'lear-R-2']))
  const o = JSON.parse(save(core)), bench = JSON.parse(text).bench ?? {}
  o.bench = { ...bench, onLine: { 'pear-R-up': [UPPER], 'pear-R-low': [LOWER] } }
  const t = JSON.stringify(o); open(t); writeFileSync(D + j.out, t)
  report[j.yaw] = { up: [+up.x.toFixed(2), +up.y.toFixed(2)], tip: j.tip, low: [+low.x.toFixed(2), +low.y.toFixed(2)] }
}
console.log(JSON.stringify(report))
