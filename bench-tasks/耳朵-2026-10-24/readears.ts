import { readFileSync } from 'node:fs'
import { open } from '/Users/bowen/Documents/headset-core/src/archive/index'
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
const out: Record<string, unknown> = {}
for (const [yaw, f] of [[0, '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json'], [45, '03-转头45-yaw45-pitch0.近2远3.耳朵骨线.json'], [90, '02-侧脸-yaw90-pitch0.近2远3.耳朵骨线.json']] as const) {
  const t = readFileSync(D + f, 'utf8'), c = open(t), s = c.snapshot()
  const P = (id: string) => s.points.find(p => p.id === id)?.position
  const L = (id: string) => { const l = s.lines.find(x => x.id === id); return l && { a: l.a, b: l.b, ha: l.ha, hb: l.hb } }
  const earLayer = s.points.filter(p => (p as { layer?: string }).layer === 'layer-ear-bone-R').map(p => p.id)
  out[yaw] = { pts: Object.fromEntries(['pear-R-up', 'pear-R-tip', 'pear-R-low', 'cmv3m1am1-6/pmv3m1am1-1'].map(id => [id, P(id)])), lines: { up: L('lear-R-1'), low: L('lear-R-2') }, earLayerPts: earLayer, earLines: s.lines.filter(l => earLayer.includes(l.a) || earLayer.includes(l.b)).map(l => [l.id, l.name, l.a, l.b]), bench: JSON.parse(t).bench?.onLine, guides: ['pear-guide-tiph-a', 'pear-guide-lowh-a'].map(P) }
}
console.log(JSON.stringify(out, null, 1))
