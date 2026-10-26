// bowen 1793024507: is dot's reference wrong? The ear the model gives, laid on the reference picture of each pitch file.
// Model ear = the turn model's yaw-0 rule (bowen's 90° ear plate, sideways offsets × cos 46.3°, roots on the outline) with
// every point turned with the head about the eye like the side face (rigid-pitch.json: 仰 27.6°, 俯 18°). The roots slide on
// bowen's outline (线上点) to the heights the turn gives. Run: node …/ear-model-overlay.mjs → 耳朵模型叠参考图.svg
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const H = dirname(fileURLToPath(import.meta.url))
const M = JSON.parse(readFileSync(join(H, '../转头模型/model.json'), 'utf8')), E = M.ear, R = JSON.parse(readFileSync(join(H, 'rigid-pitch.json'), 'utf8'))
const DE = 65.34, FACE = 46.3 * Math.PI / 180
const bez = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]) }
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const load = f => { const d = JSON.parse(readFileSync(join(H, f), 'utf8')), net = d.document.network, v = net.shapes.layers.find(l => l.key === 'view:0,0'), c = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]] }
  const im = d.document.reference.images.find(i => i.visible), asset = d.document.reference.library.find(a => a.id === im.asset)
  return { c, p: v.points, im, src: asset.src } }
/** x of the outline line at height y (the nearest crossing to the old point). */
function onLine(c, y, near) {
  let best = null
  for (let i = 0; i < 400; i++) { const a = bez(c, i / 400), b = bez(c, (i + 1) / 400); if ((a[1] - y) * (b[1] - y) <= 0) { const x = a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1); if (best === null || Math.abs(x - near) < Math.abs(best - near)) best = x } }
  return best
}
function modelEar(deg, sg, F) {
  const p = deg * Math.PI / 180, c = Math.cos(p), s = Math.sin(p)
  const T = ([d, y]) => { const dd = d - DE; return [DE + dd * c - sg * y * s, y * c + sg * dd * s] }   // → [depth, height]
  const up = E.up, tip = E.tip, low = E.low
  const raw = { up, upH: add(up, E.upLine.ha), tipH1: add(tip, E.upLine.hb), tip, tipH2: add(tip, E.lowLine.ha), lowH: add(low, E.lowLine.hb), low }
  const t = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, T(v)]))
  const upX = onLine(F.c['lm03-skb'], t.up[1], F.p['pear-R-up'].x), lowX = onLine(F.c['cmv3m1am1-6/lmv3m1am1-3'], t.low[1], F.p['pear-R-low'].x)
  const fx = (k, root, rx) => [rx + (t[k][0] - t[root][0]) * Math.cos(FACE), t[k][1]]
  const P = { up: [upX, t.up[1]], upH: fx('upH', 'up', upX), tipH1: fx('tipH1', 'up', upX), tip: fx('tip', 'up', upX), tipH2: fx('tipH2', 'up', upX), lowH: fx('lowH', 'low', lowX), low: [lowX, t.low[1]] }
  return { lines: [[P.up, P.upH, P.tipH1, P.tip], [P.tip, P.tipH2, P.lowH, P.low]], P, ok: upX !== null && lowX !== null }
}
const ROWS = [['仰45', -1, '手调记录/12-仰45-yaw0-pitch45.第3版-耳尖.json'], ['俯45', 1, '手调记录/13-俯45-yaw0-pitch-45.第3版-耳尖.json']]
const W = 1200, Ht = 1200, ts = Array.from({ length: 81 }, (_, i) => i / 80)
let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" font-family="PingFang SC, sans-serif"><rect width="${W}" height="${Ht}" fill="#fff"/>`
const pl = (c, tf, col, w, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash && `stroke-dasharray="${dash}"`} points="${ts.map(t => tf(bez(c, t)).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`
const T = (x, y, s, col = '#333', size = 16, a = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${col}" text-anchor="${a}">${s}</text>`
ROWS.forEach(([k, sg, f], i) => {
  const F = load(f), m = modelEar(R[k].angle, sg, F), Z = 5.2, ox = 300 + i * 600, oy = 470
  // view centred on the ear area
  const cx = -45, cy = (F.p['pear-R-up'].y + F.p['pear-R-low'].y) / 2
  const tf = ([x, y]) => [ox + (x - cx) * Z, oy + (y - cy) * Z]
  svg += T(ox - 280, 40, `${k} · 参考图 + 耳朵（放大）`, '#111', 22)
  svg += `<clipPath id="c${i}"><rect x="${ox - 290}" y="60" width="580" height="860"/></clipPath><g clip-path="url(#c${i})">`
  const im = F.im, w = im.width * im.scale, h = im.height * im.scale, [ix, iy] = tf([im.x - w / 2, im.y - h / 2])
  svg += `<image href="${F.src}" xlink:href="${F.src}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${(w * Z).toFixed(1)}" height="${(h * Z).toFixed(1)}" opacity="0.75" preserveAspectRatio="none"/>`
  for (const id of ['lm03-skb', 'cmv3m1am1-6/lmv3m1am1-3', 'ley-R-0', 'ley-R-1', 'ley-R-2']) svg += pl(F.c[id], tf, '#333', 1.4, '4 3')
  for (const id of ['lear-R-1', 'lear-R-2']) svg += pl(F.c[id], tf, '#c2185b', 3)
  for (const c of m.lines) svg += pl(c, tf, '#0a8f3c', 3.2)
  for (const [n, q] of [['耳尖', m.P.tip], ['上耳点', m.P.up], ['下耳点', m.P.low]]) { const [x, y] = tf(q); svg += `<circle cx="${x}" cy="${y}" r="5" fill="#0a8f3c"/>` }
  svg += '</g>'
  svg += T(ox - 280, 950, `绿 = 模型的耳朵（整片转 ${R[k].angle}°）　粉 = 你调的耳朵`, '#111', 16)
  svg += T(ox - 280, 976, `模型耳尖 (${m.P.tip[0].toFixed(0)}, ${m.P.tip[1].toFixed(0)})　你的耳尖 (${F.p['pear-R-tip'].x.toFixed(0)}, ${F.p['pear-R-tip'].y.toFixed(0)})`, '#444', 15)
  console.log(k, 'model', JSON.stringify(Object.fromEntries(Object.entries(m.P).map(([n, q]) => [n, q.map(v => +v.toFixed(1))]))))
})
svg += T(20, Ht - 30, '底图 = 这个文件里 dot 的参考图（按眼宽、眼角线对齐，未改）　虚线 = 你调的脸轮廓和眼', '#444', 15)
writeFileSync(join(H, '耳朵模型叠参考图.svg'), svg + '</svg>')
