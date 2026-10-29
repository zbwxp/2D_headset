// dump bowen's tuned eye bone lines (points + handles) from the three 眼睛骨线 files
import { readFileSync, writeFileSync } from 'node:fs'
import { open } from '/Users/bowen/Documents/headset-core/src/archive/index'
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const F: Record<number, string> = { 0: '01-正脸-yaw0-pitch0.近2远3.眼睛骨线.json', 45: '03-转头45-yaw45-pitch0.近2远3.眼睛骨线.json', 90: '02-侧脸-yaw90-pitch0.近2远3.眼睛骨线.json' }
const out: Record<string, unknown> = {}
for (const [yaw, f] of Object.entries(F)) {
  const s = open(readFileSync(D + f, 'utf8')).snapshot()
  const pts = Object.fromEntries(s.points.filter(p => p.id.startsWith('pey-')).map(p => [p.id, [p.position.x, p.position.y]]))
  const lines = s.lines.filter(l => l.id.startsWith('ley-')).map(l => ({ id: l.id, name: l.name, a: l.a, b: l.b, ha: [l.ha.x, l.ha.y], hb: [l.hb.x, l.hb.y] }))
  const ref = s.points.filter(p => !p.id.startsWith('pey-')).length
  out[yaw] = { pts, lines, other: ref }
}
writeFileSync('/Users/bowen/Documents/headset-face3d/bench-tasks/眼睛-2026-10-22/bowen-2153.json', JSON.stringify(out, null, 1))
for (const [y, v] of Object.entries(out)) console.log(y, JSON.stringify((v as { pts: unknown }).pts))
