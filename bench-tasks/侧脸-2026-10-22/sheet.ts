// 侧脸平片 (bowen 1792674653, 1792674994): the side face as one flat sheet in the head's middle plane, turning about the
// shared vertical axis: a sheet point is its height (kept in yaw) and its depth d (its x at 90°); at yaw its x = d·k(yaw),
// one k for every point, so the sheet stays flat. bowen's 90° is the benchmark; his 45° gives k = 0.689 (chin 50.61 / 73.42,
// nose tip and 眉心 agree within 0.002). 眉心 height = the temple's −5.67. Crown and chin are shared with the face outline
// and follow it; the lines into them keep the outline-side handle. Writes new copies; bowen's files are only read.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { open, save } from '/Users/bowen/Documents/headset-core/src/archive/index'
type V = { x: number; y: number }
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const F90 = '02-侧脸-yaw90-pitch0.近2远3.侧脸初稿.json', F45 = '03-转头45-yaw45-pitch0.近2远3.侧脸初稿.json'
const O90 = '02-侧脸-yaw90-pitch0.近2远3.侧脸平片.json', O45 = '03-转头45-yaw45-pitch0.近2远3.侧脸平片.json'
const SHEET = ['pmv6kklw1-3', 'pmv6kklw1-5', 'pmv6kklw1-7', 'pmv6kklw1-9'], CHIN = 'pmv6kklw1-2', CROWN = 'pmv6kklw1-11', BROW = 'pmv6kklw1-9', TEMPLE_Y = -5.67
const SIDE = ['lmv6kklw1-4', 'lmv6kklw1-6', 'lmv6kklw1-8', 'lmv6kklw1-10', 'lmv6kklw1-12']
for (const f of [O90, O45]) if (existsSync(D + f)) throw new Error('exists ' + f)
const t90 = readFileSync(D + F90, 'utf8'), t45 = readFileSync(D + F45, 'utf8')
const c90 = open(t90), c45 = open(t45)
const P = (c: typeof c90, id: string) => c.snapshot().points.find(p => p.id === id)!.position
const L = (c: typeof c90, id: string) => c.snapshot().lines.find(l => l.id === id)!
// 90°: only 眉心 to the temple's height (vertical move; its handles stay)
const b90 = P(c90, BROW); c90.edit(e => e.move([{ id: BROW, target: { x: b90.x, y: TEMPLE_Y } }]))
const k = P(c45, CHIN).x / P(c90, CHIN).x
const sheet = (v: V): V => ({ x: v.x * k, y: v.y })
const report: Record<string, unknown> = { k: +k.toFixed(4), angle: +(Math.asin(k) * 180 / Math.PI).toFixed(2), points: {} }
for (const id of SHEET) { const a = P(c45, id), b = sheet(P(c90, id)); (report.points as Record<string, unknown>)[id] = { bowen45: [+a.x.toFixed(2), +a.y.toFixed(2)], sheet45: [+b.x.toFixed(2), +b.y.toFixed(2)], dx: +(b.x - a.x).toFixed(2), dy: +(b.y - a.y).toFixed(2) } }
c45.edit(e => e.move(SHEET.map(id => ({ id, target: sheet(P(c90, id)) }))))
// handles: an end on the sheet (or the chin, which fits it) takes 90°'s handle squeezed by k; the crown end keeps bowen's 45°
c45.edit(e => { for (const id of SIDE) { const l90 = L(c90, id), l45 = L(c45, id)
  if (l90.a !== l45.a || l90.b !== l45.b) throw new Error('ends differ ' + id)
  if (l45.a !== CROWN) e.moveHandle(id, 'a', sheet(l90.ha)); if (l45.b !== CROWN) e.moveHandle(id, 'b', sheet(l90.hb)) } })
for (const [c, src, out] of [[c90, t90, O90], [c45, t45, O45]] as const) {
  const o = JSON.parse(save(c)); o.bench = JSON.parse(src).bench; const t = JSON.stringify(o); open(t); writeFileSync(D + out, t)
}
console.log(JSON.stringify(report, null, 1))
