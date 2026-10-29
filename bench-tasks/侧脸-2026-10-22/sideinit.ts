// 侧脸初稿 (bowen 1792671397): the side face of the drawing in bench (its 90° view; its 45° = the model's pose) carried
// into the keyframe copies, fitted by crown and chin (a similarity: their crown / chin onto ours), handles turned and
// scaled with it; 0° keeps its middle line. The background: the new reference with the turning axis; the old one hidden.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { open, save } from '/Users/bowen/Documents/headset-core/src/archive/index'
type V = { x: number; y: number }
const HERE = '/private/tmp/claude-501/-Users-bowen-Documents-headset/87c94b45-bc1a-4505-a0ba-5c153d4e1470/scratchpad/side/'
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const CR = 'cmv3m1am1-6/pmv3m1am1-4', CH = 'cmv3m1am1-6/pmv3m1am1-2', SCR = 'pmv6kklw1-11', SCH = 'pmv6kklw1-2'
const bench = JSON.parse(readFileSync(HERE + 'bench-side.json', 'utf8')), refs = JSON.parse(readFileSync(HERE + 'refs.json', 'utf8'))
const jobs: [number, string, string, string | null][] = [
  [0, '01-正脸-yaw0-pitch0.近2远3.对称.统一高度.json', '01-正脸-yaw0-pitch0.近2远3.侧脸初稿.json', null],
  [45, '03-转头45-yaw45-pitch0.近2远3.新参考.统一高度.json', '03-转头45-yaw45-pitch0.近2远3.侧脸初稿.json', 'p45'],
  [90, '02-侧脸-yaw90-pitch0.近2远3.新参考.统一高度.json', '02-侧脸-yaw90-pitch0.近2远3.侧脸初稿.json', 'v90'],
]
for (const [yaw, IN, OUT, src] of jobs) {
  if (existsSync(D + OUT)) throw new Error('exists ' + OUT)
  const text = readFileSync(D + IN, 'utf8'), core = open(text)
  if (src) {
    const B = bench[src], s = core.snapshot(), P = (id: string) => s.points.find(p => p.id === id)!.position
    const a0: V = { x: B.pts[SCR][0], y: B.pts[SCR][1] }, a1: V = { x: B.pts[SCH][0], y: B.pts[SCH][1] }, b0 = P(CR), b1 = P(CH)
    // similarity z ↦ k·z + t (complex numbers) taking a0 → b0, a1 → b1
    const da = { x: a1.x - a0.x, y: a1.y - a0.y }, db = { x: b1.x - b0.x, y: b1.y - b0.y }, n = da.x * da.x + da.y * da.y
    const k = { x: (db.x * da.x + db.y * da.y) / n, y: (db.y * da.x - db.x * da.y) / n }
    const rot = (v: V): V => ({ x: k.x * v.x - k.y * v.y, y: k.y * v.x + k.x * v.y })
    const map = (v: V): V => { const r = rot({ x: v.x - a0.x, y: v.y - a0.y }); return { x: r.x + b0.x, y: r.y + b0.y } }
    console.log(yaw, 'scale', Math.hypot(k.x, k.y).toFixed(4), 'turn', (Math.atan2(k.y, k.x) * 180 / Math.PI).toFixed(2) + '°')
    core.edit(e => e.move(Object.entries(B.pts as Record<string, [number, number]>).filter(([id]) => id !== SCR && id !== SCH).map(([id, p]) => ({ id, target: map({ x: p[0], y: p[1] }) }))))
    core.edit(e => { for (const l of B.side) { const cur = core.snapshot().lines.find(x => x.id === l.id)!
      if (cur.a !== l.a || cur.b !== l.b) throw new Error('line ends differ ' + l.id)
      e.moveHandle(l.id, 'a', rot({ x: l.ha[0], y: l.ha[1] })); e.moveHandle(l.id, 'b', rot({ x: l.hb[0], y: l.hb[1] })) } })
  }
  const out = JSON.parse(save(core)); out.bench = JSON.parse(text).bench
  const R = refs[String(yaw)], ref = out.document.reference, old = ref.images.find((i: { visible: boolean }) => i.visible) ?? ref.images[0]
  const aid = `ref-gen-axis-yaw${yaw}`
  ref.library.push({ id: aid, name: R.name, src: 'data:image/png;base64,' + readFileSync(HERE + R.png).toString('base64'), width: R.W, height: R.H })
  for (const i of ref.images) i.visible = false
  ref.images.unshift({ ...old, id: `img-gen-axis-yaw${yaw}`, asset: aid, width: R.W, height: R.H, x: R.cx, y: R.cy, scale: R.s, visible: true, opacity: 0.85 })
  const t = JSON.stringify(out); open(t); writeFileSync(D + OUT, t); console.log('written', OUT)
}
