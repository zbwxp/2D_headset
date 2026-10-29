// 眼睛骨线 (bowen 1792675801): per eye 3 bone lines on 4 points — 上眼睑 inner → outer, 下眼睑 inner → middle → outer
// (one smooth arc split at its middle point). Hung on the model: every point and handle is a 3D vector (x0 at 0°,
// height, depth z), turned about the shared vertical axis: x = x0·cos yaw + z·sin yaw, height kept (orthographic, so a
// Bézier's projection is the Bézier of the projected controls). x0 / height measured on the 0° reference (ax0.png), depth on
// the 90° reference (ax90.png); the two eyes mirror x0. 45° is computed (true 45°); bowen's hand-tuning = the anime offset.
// Writes new copies; reads the 侧脸 files only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { open, save } from '/Users/bowen/Documents/headset-core/src/archive/index'
type V3 = [number, number, number]
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const jobs: [number, string, string][] = [
  [0, '01-正脸-yaw0-pitch0.近2远3.侧脸初稿.json', '01-正脸-yaw0-pitch0.近2远3.眼睛骨线.json'],
  [45, '03-转头45-yaw45-pitch0.近2远3.侧脸平片.json', '03-转头45-yaw45-pitch0.近2远3.眼睛骨线.json'],
  [90, '02-侧脸-yaw90-pitch0.近2远3.侧脸平片.json', '02-侧脸-yaw90-pitch0.近2远3.眼睛骨线.json'],
]
// the screen-left eye at 0° (x0 < 0; 右眼, the near eye in a turn to the right); canvas units
const P: Record<string, V3> = { in: [-15.47, -0.69, 73.18], out: [-45.27, 1.38, 51.2], mid: [-26.41, 14.21, 65.79] }
// handles (3D): the upper lid arches up and bulges forward 2 over the eyeball; the lower arc is smooth at its middle
const LINES: { name: string; a: string; b: string; ha: V3; hb: V3 }[] = [
  { name: '上眼睑', a: 'in', b: 'out', ha: [-9, -8.5, -4.65], hb: [9, -9.5, 9.95] },
  { name: '下眼睑内', a: 'in', b: 'mid', ha: [-1.5, 6, -2.46], hb: [5, 0, 4.05] },
  { name: '下眼睑外', a: 'mid', b: 'out', ha: [-6, 0, -4.86], hb: [3, 7, 4.86] },
]
const EYES = [{ layer: 'layer-eye-bone-R', name: '右眼骨线', m: 1, tag: 'R' }, { layer: 'layer-eye-bone-L', name: '左眼骨线', m: -1, tag: 'L' }]
for (const [, , out] of jobs) if (existsSync(D + out)) throw new Error('exists ' + out)
const report: Record<string, Record<string, [number, number]>> = {}
for (const [yaw, inp, out] of jobs) {
  const text = readFileSync(D + inp, 'utf8'), core = open(text), r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const pr = (v: V3, m: number) => ({ x: m * v[0] * c + v[2] * s, y: v[1] })
  report[yaw] = {}
  for (const E of EYES) {
    const pid = (k: string) => `pey-${E.tag}-${k}`, lid = (i: number) => `ley-${E.tag}-${i}`
    core.edit(e => {
      e.layer(E.layer, E.name)
      LINES.forEach((l, i) => {
        const end = (k: string) => (core.snapshot().points.some(p => p.id === pid(k)) || LINES.slice(0, i).some(q => q.a === k || q.b === k) ? pid(k) : { id: pid(k), layer: E.layer, position: pr(P[k]!, E.m) })
        e.line(lid(i), end(l.a), end(l.b), { ha: pr(l.ha, E.m), hb: pr(l.hb, E.m) })
      })
    })
    core.edit(e => { LINES.forEach((l, i) => e.renameLine(lid(i), l.name)) })
    core.edit(e => e.markBone(LINES.map((_, i) => lid(i))))
    for (const k of Object.keys(P)) { const q = pr(P[k]!, E.m); report[yaw]![`${E.name}·${k}`] = [+q.x.toFixed(2), +q.y.toFixed(2)] }
  }
  const o = JSON.parse(save(core)); o.bench = JSON.parse(text).bench; const t = JSON.stringify(o); open(t); writeFileSync(D + out, t)
}
console.log(JSON.stringify(report))
