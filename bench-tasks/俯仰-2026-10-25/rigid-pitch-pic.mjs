// Picture for rigid-pitch.py (bowen 1793023961 「用图例解释」): left = seen from the side (the 90° side face line and the ear,
// turned as one piece about the eye); right = seen from the front, bowen's v3 bones with the heights the turn gives.
// Run after rigid-pitch.py: node bench-tasks/俯仰-2026-10-25/rigid-pitch-pic.mjs → 侧脸整片转.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const H = dirname(fileURLToPath(import.meta.url))
const M = JSON.parse(readFileSync(join(H, '../转头模型/model.json'), 'utf8')), S = M.sheet, P = S.pts, EAR = M.ear
const R = JSON.parse(readFileSync(join(H, 'rigid-pitch.json'), 'utf8'))
const DE = 65.34
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]) }
const ts = Array.from({ length: 41 }, (_, i) => i / 40)
const cub = (a, ha, hb, b) => [a, [a[0] + ha[0], a[1] + ha[1]], [b[0] + hb[0], b[1] + hb[1]], b]
const profile = S.lines.map(l => cub(P[l.a], l.ha, l.hb, P[l.b]))
const ear = [cub(EAR.up, EAR.upLine.ha, EAR.upLine.hb, EAR.tip), cub(EAR.tip, EAR.lowLine.ha, EAR.lowLine.hb, EAR.low)]
// turn about the eye centre (DE, 0): 仰 (sg −1) brings the front up, 俯 (sg +1) down
const turn = (deg, sg) => ([d, y]) => { const p = deg * Math.PI / 180, c = Math.cos(p), s = Math.sin(p), dd = d - DE; return [DE + c * dd - sg * s * y, y * c + sg * s * dd] }
const front = f => { const d = JSON.parse(readFileSync(join(H, f), 'utf8')), net = d.document.network, v = net.shapes.layers.find(l => l.key === 'view:0,0'), c = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = cub([a.x, a.y], [s.ha.x, s.ha.y], [s.hb.x, s.hb.y], [b.x, b.y]) }
  return { c, p: v.points } }
const ROWS = [
  { k: '仰45', sg: -1, file: '手调记录/12-仰45-yaw0-pitch45.第3版-耳尖.json', word: '抬头' },
  { k: '俯45', sg: 1, file: '手调记录/13-俯45-yaw0-pitch-45.第3版-耳尖.json', word: '低头' },
]
const W = 1200, Ht = 1200
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" font-family="PingFang SC, sans-serif"><rect width="${W}" height="${Ht}" fill="#fff"/>`
const pl = (c, tf, col, w, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash && `stroke-dasharray="${dash}"`} points="${ts.map(t => tf(bez(c, t)).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
const txt = (x, y, s, col = '#333', size = 14, anchor = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${col}" text-anchor="${anchor}">${s}</text>`
const dot = ([x, y], col, r = 4) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${col}"/>`
ROWS.forEach((row, i) => {
  const r = R[row.k], deg = r.angle, T = turn(deg, row.sg), top = 40 + i * 560
  // ---- left: from the side (front of the face to the right) ----
  const Zs = 2.2, sx = 140, sy = top + 270, tfs = ([d, y]) => [sx + d * Zs, sy + y * Zs]
  svg += txt(20, top + 10, `${row.k}（${row.word}）· 从侧面看：侧脸线和耳朵当成一整片，绕眼睛转 ${deg}°`, '#111', 19)
  svg += `<line x1="${sx - 60}" x2="${sx + 120 * Zs}" y1="${sy}" y2="${sy}" stroke="#9ab" stroke-dasharray="3 4"/>` + txt(sx + 120 * Zs - 70, sy - 6, '眼角线（不动）', '#789', 12)
  for (const c of profile) svg += pl(c, tfs, '#bbb', 1.6)
  for (const c of ear) svg += pl(c, tfs, '#f3a9c4', 1.6)
  for (const c of profile) svg += pl(c.map(T), tfs, '#111', 2.4)
  for (const c of ear) svg += pl(c.map(T), tfs, '#c2185b', 2.4)
  svg += dot(tfs([DE, 0]), '#7a3b00', 5) + txt(...tfs([DE + 3, 9]), '眼', '#7a3b00', 13)
  // arc showing the turn at the nose tip
  const n0 = tfs(P.noseTip), n1 = tfs(T(P.noseTip))
  svg += `<path d="M${n0[0].toFixed(1)},${n0[1].toFixed(1)} A ${(Math.hypot(P.noseTip[0] - DE, P.noseTip[1]) * Zs).toFixed(1)} ${(Math.hypot(P.noseTip[0] - DE, P.noseTip[1]) * Zs).toFixed(1)} 0 0 ${row.sg < 0 ? 0 : 1} ${n1[0].toFixed(1)},${n1[1].toFixed(1)}" fill="none" stroke="#2a7" stroke-width="1.6" marker-end="url(#a)"/>`
  svg += txt(n0[0] + 8, n0[1] + (row.sg < 0 ? -18 : 24), `转 ${deg}°`, '#2a7', 14)
  for (const [n, p] of [['颅顶', P.crown], ['下巴', P.chin]]) svg += txt(...tfs(T(p)).map((v, j) => v + (j ? (n === '颅顶' ? -8 : 18) : -10)), n, '#555', 12)
  svg += txt(...tfs(T(EAR.tip)).map((v, j) => v + (j ? 0 : -36)), '耳尖', '#c2185b', 12)
  // ---- right: from the front, bowen's v3 with the model's heights ----
  const F = front(row.file), Zf = 2.0, fx = 860, fy = top + 270, tff = ([x, y]) => [fx + x * Zf, fy + y * Zf]
  svg += txt(620, top + 40, '从正面看：黑/粉 = 你手调的；红线 = 整片转算出的高度', '#111', 15)
  for (const id of ['lmv3m1am1-3', 'lm03-chf', 'lm03-skf', 'cmv3m1am1-6/lmv3m1am1-3', 'lm03-skb']) svg += pl(F.c[id], tff, '#111', 2)
  for (const id of ['ley-R-0', 'ley-R-1', 'ley-R-2', 'ley-L-0', 'ley-L-1', 'ley-L-2']) svg += pl(F.c[id], tff, '#7a3b00', 1.5)
  for (const id of ['lear-R-1', 'lear-R-2']) svg += pl(F.c[id], tff, '#c2185b', 2.4)
  const marks = [['颅顶', 'cmv3m1am1-6/pmv3m1am1-4', 0], ['下巴', 'cmv3m1am1-6/pmv3m1am1-2', 0], ['上耳点', 'pear-R-up', 1], ['下耳点', 'pear-R-low', 1], ['耳尖', 'pear-R-tip', 1]]
  for (const [n, id, side] of marks) {
    const q = F.p[id], m = r.points[n], bad = Math.abs(m.diff) > 6, col = bad ? '#d00' : '#e8706a'
    const [x0, yb] = tff([q.x, q.y]), [, ym] = tff([0, m.model])
    svg += `<line x1="${x0 - 26}" x2="${x0 + 26}" y1="${ym}" y2="${ym}" stroke="${col}" stroke-width="${bad ? 2.6 : 2}"/>`
    if (Math.abs(ym - yb) > 3) svg += `<line x1="${x0}" x2="${x0}" y1="${yb}" y2="${ym}" stroke="${col}" stroke-width="1" stroke-dasharray="2 2"/>`
    svg += dot([x0, yb], '#111', 3)
    const lx = side ? x0 - 32 : x0 + 32
    svg += txt(lx, ym + (n === '耳尖' ? -6 : n === '上耳点' ? -4 : 5), `${n} 差 ${Math.abs(m.diff).toFixed(0)}${bad ? '  ✗' : ''}`, col, 13, side ? 'end' : 'start')
  }
})
svg += `<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2a7"/></marker></defs>`
svg += txt(20, Ht - 46, '左：灰/浅粉 = 0° 的侧脸线和耳朵，黑/深粉 = 转过之后。转角由你的两个耳点定。右：红短线是整片转算出来的高度，黑点是你画的位置，差 > 6 标 ✗。', '#444', 14)
svg += txt(20, Ht - 22, '结论：仰 转 28° 基本都对上；俯 转 18° 耳点和颅顶对上，但你的下巴比整片转高 15（低头下巴上提是画法），耳尖两边都差 9–13。', '#111', 15)
writeFileSync(join(H, '侧脸整片转.svg'), svg + '</svg>')
