// bowen 1793024305: keep his ear shape, slide the ear tip along his ear lines to the height the rigid turn gives
// (rigid-pitch.json: 仰 34.0, 俯 −22.7). Front view, zoomed on the ear. Run: node …/ear-tip-pic.mjs → 耳尖滑动.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const H = dirname(fileURLToPath(import.meta.url)), R = JSON.parse(readFileSync(join(H, 'rigid-pitch.json'), 'utf8'))
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]) }
const load = f => { const d = JSON.parse(readFileSync(join(H, f), 'utf8')), net = d.document.network, v = net.shapes.layers.find(l => l.key === 'view:0,0'), c = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]] }
  return { c, p: v.points } }
const ROWS = [['仰45', '手调记录/12-仰45-yaw0-pitch45.第3版-耳尖.json'], ['俯45', '手调记录/13-俯45-yaw0-pitch-45.第3版-耳尖.json']]
const W = 1200, Ht = 1200, Z = 7
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" font-family="PingFang SC, sans-serif"><rect width="${W}" height="${Ht}" fill="#fff"/>`
const ts = Array.from({ length: 201 }, (_, i) => i / 200)
const pl = (c, tf, col, w) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" points="${ts.map(t => tf(bez(c, t)).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
const T = (x, y, s, col = '#333', size = 16, a = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${col}" text-anchor="${a}">${s}</text>`
ROWS.forEach(([k, f], i) => {
  const F = load(f), h = R[k].points['耳尖'].model, cx = 300 + i * 600, top = 90
  const ys = ['lear-R-1', 'lear-R-2'].flatMap(id => ts.map(t => bez(F.c[id], t)[1])), mid = (Math.min(...ys, h) + Math.max(...ys, h)) / 2
  const tf = ([x, y]) => [cx + (x + 52) * Z, 520 + (y - mid) * Z]
  svg += T(cx - 270, top - 30, `${k} · 正面看耳朵（放大）`, '#111', 22)
  svg += `<clipPath id="c${i}"><rect x="${cx - 290}" y="${top}" width="580" height="840"/></clipPath><g clip-path="url(#c${i})">`
  for (const id of ['lmv3m1am1-3', 'cmv3m1am1-6/lmv3m1am1-3', 'lm03-skb', 'lm03-chf', 'lm03-skf']) svg += pl(F.c[id], tf, '#999', 2)
  for (const id of ['lear-R-1', 'lear-R-2']) svg += pl(F.c[id], tf, '#c2185b', 3)
  const [, yh] = tf([0, h]); svg += `<line x1="${cx - 280}" x2="${cx + 280}" y1="${yh}" y2="${yh}" stroke="#d00" stroke-width="1.6" stroke-dasharray="6 4"/>` + T(cx + 278, yh - 8, `整片转算出的耳尖高度 ${h.toFixed(0)}`, '#d00', 15, 'end')
  const tip = F.p['pear-R-tip'], [tx, ty] = tf([tip.x, tip.y]); svg += `<circle cx="${tx}" cy="${ty}" r="6" fill="#111"/>` + T(tx - 10, ty + (i ? 26 : -10), `你的耳尖 ${tip.y.toFixed(0)}`, '#111', 15, 'end')
  for (const [n, id] of [['上耳点', 'pear-R-up'], ['下耳点', 'pear-R-low']]) { const q = F.p[id], [x, y] = tf([q.x, q.y]); svg += `<circle cx="${x}" cy="${y}" r="4" fill="#c2185b"/>` + T(x + 8, y + 5, n, '#c2185b', 13) }
  // where the ear line reaches that height
  const hits = []
  for (const id of ['lear-R-1', 'lear-R-2']) for (let j = 0; j < 200; j++) { const a = bez(F.c[id], ts[j]), b = bez(F.c[id], ts[j + 1]); if ((a[1] - h) * (b[1] - h) <= 0) hits.push(a) }
  if (hits.length) for (const q of hits) { const [x, y] = tf(q); svg += `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#d00" stroke-width="3"/>` + T(x - 14, y + 30, '耳尖滑到这里', '#d00', 15, 'end') }
  svg += '</g>'
  const top2 = Math.min(...ys)
  svg += T(cx - 270, 980, hits.length ? `沿下耳廓往下滑约 ${(h - tip.y).toFixed(0)}，正好落在耳朵最外侧那一点，` : `耳朵最高处是 ${top2.toFixed(0)}，算出的耳尖在它上面 ${(top2 - h).toFixed(0)}，`, '#111', 17)
  svg += T(cx - 270, 1008, hits.length ? '耳朵外形不用改。' : '在现有耳朵外形上找不到这个点：耳朵要往上长一些才对得上。', '#111', 17)
})
svg += T(20, Ht - 30, '灰 = 脸轮廓　粉 = 你的耳朵（第3版）　红虚线 = 侧脸整片转（仰 28° / 俯 18°）算出的耳尖高度　红圈 = 耳朵线上达到这个高度的位置', '#444', 15)
writeFileSync(join(H, '耳尖滑动.svg'), svg + '</svg>')
