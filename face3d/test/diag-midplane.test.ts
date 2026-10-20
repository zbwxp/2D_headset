// Statistics only (dot 1792490777): the outline's crossings of the head's mid plane x = 0 below the mouth (y < −0.9)
// as a CANDIDATE chin anchor — how often there is none, one, several, or a stretch lying in the plane (degenerate);
// whether each crossing is visible or hidden; and how crossings appear / disappear / move between 5° neighbours.
// Replaces nothing in the algorithm. Prints and draws when F3D_DIAG_DIR is set.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { defaultShape, makeHead } from '../src/head'
import { candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, len, sub } from '../src/view'

const dir = process.env.F3D_DIAG_DIR
const head = makeHead(defaultShape)
const Y_MAX = -0.9, DEGEN_X = 0.005, DEGEN_RUN = 5, MOVE = 0.1

interface Crossing { p: V3; hidden: boolean }
interface Result { yaw: number; pitch: number; crossings: Crossing[]; degenerate: number; openEnds: number }

function measure(yaw: number, pitch: number): Result {
  const v = { yaw, pitch }, occ = occluder(head, v), crossings: Crossing[] = []
  let degenerate = 0, openEnds = 0
  const extent = (l: { pts: { p: V3 }[] }) => Math.max(...[0, 1, 2].map(k => Math.max(...l.pts.map(q => q.p[k]!)) - Math.min(...l.pts.map(q => q.p[k]!))))
  for (const l of candidates(head, v).filter(l => extent(l) >= 0.15)) {
    const P = l.pts, n = P.length, last = l.closed ? n : n - 1
    // an open chain ending next to the plane below the mouth: the outline reaches the chin pole region and the trace
    // stops at the grid's last row instead of crossing (a tracing artefact, not an absent crossing)
    if (!l.closed) for (const e of [P[0]!, P[n - 1]!]) if (Math.abs(e.p[0]) < 0.05 && e.y < Y_MAX) openEnds++
    // degenerate stretches: runs of points lying in the plane
    let run = 0
    for (const q of P) { if (Math.abs(q.p[0]) < DEGEN_X && q.y < Y_MAX) { run++; if (run === DEGEN_RUN) degenerate++ } else run = 0 }
    for (let i = 0; i < last; i++) {
      const a = P[i]!, b = P[(i + 1) % n]!
      if (a.y >= Y_MAX && b.y >= Y_MAX) continue
      if (Math.abs(a.p[0]) < DEGEN_X && Math.abs(b.p[0]) < DEGEN_X) continue // inside a degenerate stretch, not a crossing
      if ((a.p[0] < 0) === (b.p[0] < 0)) continue
      const t = a.p[0] / (a.p[0] - b.p[0]), u = a.u + (b.u - a.u) * t, y = a.y + (b.y - a.y) * t, p = head.at(u, y)
      if (y >= Y_MAX) continue
      crossings.push({ p, hidden: hiddenOn(occ, p, u, y) })
    }
  }
  return { yaw, pitch, crossings, degenerate, openEnds }
}

it('mid-plane crossings below the mouth, 5° grid', () => {
  if (!dir) return
  const yaws = Array.from({ length: 19 }, (_, i) => i * 5), pitches = Array.from({ length: 19 }, (_, i) => -45 + i * 5)
  const R = new Map<string, Result>()
  for (const yaw of yaws) for (const pitch of pitches) R.set(`${yaw},${pitch}`, measure(yaw, pitch))
  const cls = (r: Result) => (r.degenerate ? 'degenerate' : r.crossings.length === 0 ? (r.openEnds >= 2 ? 'none-open-ends' : 'none') : r.crossings.length === 1 ? 'one' : 'several')
  const count: Record<string, number> = {}, vis = { visible: 0, hidden: 0 }
  for (const r of R.values()) { count[cls(r)] = (count[cls(r)] ?? 0) + 1; for (const c of r.crossings) vis[c.hidden ? 'hidden' : 'visible']++ }
  // between 5° neighbours (yaw and pitch): crossings appearing / disappearing (count changes) and moving > MOVE
  let births = 0, deaths = 0, moves = 0
  const pair = (a: Result, b: Result) => {
    if (b.crossings.length > a.crossings.length) births += b.crossings.length - a.crossings.length
    if (b.crossings.length < a.crossings.length) deaths += a.crossings.length - b.crossings.length
    for (const c of b.crossings) { const d = Math.min(...a.crossings.map(x => len(sub(x.p, c.p)))); if (Number.isFinite(d) && d > MOVE) moves++ }
  }
  for (const yaw of yaws) for (const pitch of pitches) {
    const r = R.get(`${yaw},${pitch}`)!, ry = R.get(`${yaw + 5},${pitch}`), rp = R.get(`${yaw},${pitch + 5}`)
    if (ry) pair(r, ry); if (rp) pair(r, rp)
  }
  // a map: one cell per view, colour by class, number of crossings, hidden ones marked
  const C = 44, col: Record<string, string> = { 'none-open-ends': '#e0e0e0', none: '#ef9a9a', one: '#a5d6a7', several: '#ffe082', degenerate: '#90caf9' }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C * 19 + 120}" height="${C * 19 + 160}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  svg += `<text x="10" y="20" font-size="14">正中面交点（嘴以下）作为候选下巴锚点：绿 = 唯一，黄 = 多个，红 = 无，灰 = 无但两条开链在正中面旁的极点处断开（描线到网格末行停住），蓝 = 退化；数字 = 交点数，h = 其中被挡的个数</text>`
  pitches.slice().reverse().forEach((pitch, r) => {
    svg += `<text x="10" y="${60 + r * C + C / 2}" font-size="12">${pitch > 0 ? '仰' : pitch < 0 ? '俯' : '平'}${Math.abs(pitch)}</text>`
    yaws.forEach((yaw, c) => {
      const res = R.get(`${yaw},${pitch}`)!, x = 70 + c * C, y = 40 + r * C, h = res.crossings.filter(k => k.hidden).length
      svg += `<rect x="${x}" y="${y}" width="${C - 2}" height="${C - 2}" fill="${col[cls(res)]}"/><text x="${x + 6}" y="${y + 18}" font-size="12">${res.crossings.length}${h ? ` h${h}` : ''}</text>`
    })
  })
  yaws.forEach((yaw, c) => { svg += `<text x="${70 + c * C + 6}" y="${40 + 19 * C + 16}" font-size="12">${yaw}</text>` })
  svg += `<text x="70" y="${40 + 19 * C + 40}" font-size="12">yaw →</text>`
  writeFileSync(`${dir}/diag-midplane.svg`, svg + '</svg>')
  const text = `views ${R.size}: ${JSON.stringify(count)}\ncrossings: ${JSON.stringify(vis)}\nbetween 5° neighbours: appear ${births}, disappear ${deaths}, move > ${MOVE} R ${moves}`
  writeFileSync(`${dir}/diag-midplane.txt`, text)
  console.log(text)
}, 600000)
