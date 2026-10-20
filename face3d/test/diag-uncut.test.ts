// Independent check (dot 1792493460), yaw 45 / pitch 15 and 75 / 15, x+ side: every candidate outline loop at the
// view, NOT cut at any chin anchor, split into visible and hidden by the occlusion test; the mix's first samples with
// their actual display visibility, and each sample's on-screen distance to the full VISIBLE outline and to ANY outline.
// Per sample: near visible outline → the target's cut is too short; near only hidden outline and still shown → a
// visibility error; far from every outline → anchor correspondence / mixing. Prints and draws (F3D_DIAG=1).
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { mixContour } from '../src/contour'
import { makeModel } from '../src/model'
import { candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, rotate } from '../src/view'

type P2 = [number, number]
const segDist = (p: P2, a: P2, b: P2) => { const ab: P2 = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t) }
const toRuns = (p: P2, runs: P2[][]) => { let m = Infinity; for (const r of runs) for (let j = 0; j + 1 < r.length; j++) m = Math.min(m, segDist(p, r[j]!, r[j + 1]!)); return m }

it.skipIf(!process.env.F3D_DIAG)('uncut outline, visible / hidden, against the mix\'s first samples', () => {
  const m = makeModel(), head = m.head, dir = process.env.F3D_DIAG_DIR
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) {
    const P = (p: V3): P2 => { const r = rotate(p, v); return [r[0], r[1]] }
    const occ = occluder(head, v), loops = candidates(head, v)
    // runs of consecutive visible / hidden points along every loop (a run never bridges a change of state)
    const vis: P2[][] = [], hid: P2[][] = [], all: P2[][] = []
    for (const l of loops) {
      const pts = l.closed ? [...l.pts, l.pts[0]!] : l.pts
      let run: P2[] = [], state: boolean | undefined
      for (const q of pts) {
        const h = hiddenOn(occ, q.p, q.u, q.y), p = P(q.p)
        if (state !== undefined && h !== state) { run.push(p); (state ? hid : vis).push(run); run = [] }
        state = h; run.push(p)
      }
      if (run.length > 1) (state ? hid : vis).push(run)
      all.push(pts.map(q => P(q.p)))
    }
    const line = mixContour(head, m.table, v).find(l => l.side === 'pos')!
    const rows: string[] = []
    for (let i = 0; i < 8; i++) {
      const p = P(line.pts[i]!), dv = toRuns(p, vis), da = toRuns(p, all)
      const verdict = line.vis[i]! < 0.5 ? 'not shown' : dv <= 0.02 ? 'on the visible outline' : da <= 0.02 ? 'shown, but only near HIDDEN outline' : 'shown, off every outline'
      rows.push(`  mix #${i}: shown ${line.vis[i]!.toFixed(2)}, to visible outline ${dv.toFixed(3)} R, to any outline ${da.toFixed(3)} R → ${verdict}`)
    }
    console.log(`view ${v.yaw},${v.pitch}: ${loops.length} loops, ${vis.length} visible runs, ${hid.length} hidden runs\n${rows.join('\n')}`)
    if (!dir) continue
    const c = P(line.pts[6]!), S = 420, X = (p: P2) => `${(450 + (p[0] - c[0]) * S).toFixed(1)},${(470 - (p[1] - c[1]) * S).toFixed(1)}`
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
    svg += `<text x="10" y="20" font-size="14">yaw ${v.yaw} · 仰视 ${v.pitch}：全部候选轮廓（未按下巴锚点截断）。黑实线 = 可见；浅灰虚线 = 被挡；红 = mix（粗细 = 实际显示的可见度，空心圈 = 不显示）</text>`
    for (const r of hid) svg += `<polyline fill="none" stroke="#bbb" stroke-width="1.5" stroke-dasharray="5 4" points="${r.map(X).join(' ')}"/>`
    for (const r of vis) svg += `<polyline fill="none" stroke="#000" stroke-width="2.2" points="${r.map(X).join(' ')}"/>`
    for (let i = 0; i + 1 < line.pts.length; i++) { const o = Math.min(line.vis[i]!, line.vis[i + 1]!); if (o > 0.01) svg += `<polyline fill="none" stroke="#d32f2f" stroke-width="${(0.5 + 3 * o).toFixed(1)}" points="${X(P(line.pts[i]!))} ${X(P(line.pts[i + 1]!))}"/>` }
    for (let i = 0; i < 8; i++) { const [x, y] = X(P(line.pts[i]!)).split(','); svg += `<circle cx="${x}" cy="${y}" r="4" fill="${line.vis[i]! >= 0.5 ? '#d32f2f' : 'white'}" stroke="#d32f2f"/><text x="${+x! + 5}" y="${+y! - 5}" font-size="11" fill="#d32f2f">${i}</text>` }
    writeFileSync(`${dir}/diag-uncut-${v.yaw}-${v.pitch}.svg`, svg + '</svg>')
  }
})
