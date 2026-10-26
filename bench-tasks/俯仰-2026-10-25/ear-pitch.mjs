// 俯仰 ears (bowen 1793022865 「耳朵展示一下情况」): bowen's 0° / 仰45 / 俯45 ear bones next to the outline and the eye,
// with the eye line and the 0° ear heights as guides. Run: node bench-tasks/俯仰-2026-10-25/ear-pitch.mjs → 耳朵俯仰.svg, ear-pitch.json
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const H = dirname(fileURLToPath(import.meta.url))
const load = f => { const d = JSON.parse(readFileSync(join(H, f), 'utf8')), net = d.document.network, v = net.shapes.layers.find(l => l.key === 'view:0,0'), c = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]] }
  return { c, p: v.points } }
const V = [
  ['0°', '../备份/12-仰45-yaw0-pitch45.近2远3.耳朵骨线-before-耳点线上-181018.json'],
  ['仰 45', '手调记录/12-仰45-yaw0-pitch45.第2版-放开.json'],
  ['俯 45', '手调记录/13-俯45-yaw0-pitch-45.第2版-放开.json'],
].map(([n, f]) => ({ n, ...load(f) }))
const OUT = ['lmv3m1am1-3', 'lm03-chf', 'lm03-skf', 'cmv3m1am1-6/lmv3m1am1-3', 'lm03-skb'], EYE = ['ley-R-0', 'ley-R-1', 'ley-R-2', 'ley-L-0', 'ley-L-1', 'ley-L-2'], EAR = ['lear-R-1', 'lear-R-2']
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]) }
const ts = Array.from({ length: 41 }, (_, i) => i / 40)
const P = ['pear-R-up', 'pear-R-tip', 'pear-R-low', 'pey-R-out', 'pm03-skf', 'pmv3m1am1-1', 'cmv3m1am1-6/pmv3m1am1-1', 'cmv3m1am1-6/pmv3m1am1-2', 'cmv3m1am1-6/pmv3m1am1-4']
const NAME = { 'pear-R-up': '上耳点', 'pear-R-tip': '耳尖', 'pear-R-low': '下耳点', 'pey-R-out': '外眼角', 'pm03-skf': '太阳穴点', 'pmv3m1am1-1': '颧骨点(左)', 'cmv3m1am1-6/pmv3m1am1-1': '颧骨点(右)', 'cmv3m1am1-6/pmv3m1am1-2': '下巴', 'cmv3m1am1-6/pmv3m1am1-4': '颅顶' }
const table = V.map(v => ({ view: v.n, ...Object.fromEntries(P.map(k => [NAME[k], v.p[k] ? [+v.p[k].x.toFixed(1), +v.p[k].y.toFixed(1)] : null])) }))
writeFileSync(join(H, 'ear-pitch.json'), JSON.stringify(table, null, 1))
for (const r of table) console.log(r.view, JSON.stringify(r))
const W = 1200, Ht = 1200, Z = 2.1
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" font-family="PingFang SC, sans-serif"><rect width="${W}" height="${Ht}" fill="#fff"/>`
const pl = (c, tf, col, w, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash && `stroke-dasharray="${dash}"`} points="${ts.map(t => tf(bez(c, t)).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
V.forEach((v, i) => {
  const cx = 200 + i * 400, cy = 380, tf = ([x, y]) => [cx + x * Z, cy + y * Z]
  svg += `<text x="${cx - 180}" y="60" font-size="22" fill="#222">${v.n}</text>`
  for (const [y, lab] of [[0, '眼角线 (0)'], [V[0].p['pear-R-up'].y, '0° 上耳点高'], [V[0].p['pear-R-low'].y, '0° 下耳点高']]) {
    const [, yy] = tf([0, y]); svg += `<line x1="${cx - 185}" x2="${cx + 185}" y1="${yy}" y2="${yy}" stroke="#9ab" stroke-dasharray="3 4"/><text x="${cx + 120}" y="${yy - 3}" font-size="11" fill="#789">${lab}</text>`
  }
  if (i) for (const id of EAR) svg += pl(V[0].c[id], tf, '#f3a9c4', 2)
  for (const id of OUT) svg += pl(v.c[id], tf, '#111', 2)
  for (const id of EYE) svg += pl(v.c[id], tf, '#7a3b00', 1.6)
  for (const id of EAR) svg += pl(v.c[id], tf, '#c2185b', 3)
  for (const [k, col] of [['pear-R-up', '#c2185b'], ['pear-R-low', '#c2185b'], ['pear-R-tip', '#c2185b']]) { const [x, y] = tf([v.p[k].x, v.p[k].y]); svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${col}"/><text x="${x - 58}" y="${y + 4}" font-size="12" fill="${col}">${NAME[k]} ${v.p[k].y.toFixed(0)}</text>` }
})
// the numbers under the pictures
const rows = [['', ...V.map(v => v.n)], ...['上耳点', '耳尖', '下耳点', '颧骨点(右)', '下巴', '颅顶'].map(k => [k, ...table.map(r => r[k][1].toFixed(0))]),
  ['耳高（上耳点→下耳点）', ...table.map(r => (r['下耳点'][1] - r['上耳点'][1]).toFixed(0))], ['脸高（颅顶→下巴）', ...table.map(r => (r['下巴'][1] - r['颅顶'][1]).toFixed(0))]]
rows.forEach((r, j) => r.forEach((c, k) => { svg += `<text x="${k ? 260 + k * 160 : 120}" y="${800 + j * 34}" font-size="${j ? 18 : 19}" fill="${j ? '#333' : '#000'}" ${k ? 'text-anchor="middle"' : ''}>${c}</text>` }))
svg += `<text x="20" y="${Ht - 16}" font-size="14" fill="#444">黑 = 脸轮廓　棕 = 眼　深粉 = 耳（你手调的）　浅粉 = 0° 的耳（对照）　数字 = 高度（y 向下为正，眼角线为 0）</text></svg>`
writeFileSync(join(H, '耳朵俯仰.svg'), svg)
