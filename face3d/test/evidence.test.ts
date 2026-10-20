// PLAN §6 evidence, printed and drawn (not pass / fail thresholds yet — numbers for dot's review):
// (1) mixed contour vs the rough head's own visible outline at in-between angles, on screen, in head units R;
// (2) a dense sweep of the tracing itself (not the keys): where segments appear / vanish and whether the chin anchor
//     jumps between branches.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { traceKey } from '../src/contour'
import { defaultShape, makeHead } from '../src/head'
import { contourAt, headOutline, makeModel } from '../src/model'
import { type V3, len, rotate, sub } from '../src/view'

const model = makeModel()
const head = makeHead(defaultShape)
const out = process.env.F3D_EVIDENCE_DIR

it('mixed contour vs the head outline at in-between angles', () => {
  const views = [15, 45, 75].flatMap(yaw => [15, -15, -38].map(pitch => ({ yaw, pitch })))
  const rows: string[] = []
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  views.forEach((v, n) => {
    const outline = headOutline(model, v).flat().map(p => rotate(p, v))
    const dists: number[] = []
    for (const line of contourAt(model, v)) line.pts.forEach((p, i) => {
      if (line.vis[i]! < 0.5) return
      const q = rotate(p, v)
      dists.push(Math.min(...outline.map(o => Math.hypot(o[0] - q[0], o[1] - q[1]))))
    })
    dists.sort((a, b) => a - b)
    const med = dists[Math.floor(dists.length / 2)] ?? NaN, max = dists[dists.length - 1] ?? NaN
    rows.push(`yaw ${v.yaw} pitch ${v.pitch}: ${dists.length} visible samples, median ${med.toFixed(3)} R, max ${max.toFixed(3)} R`)
    const ox = (n % 3) * 300 + 150, oy = Math.floor(n / 3) * 300 + 130, S = 80, P = (q: readonly number[]) => `${(ox + q[0]! * S).toFixed(1)},${(oy - q[1]! * S).toFixed(1)}`
    svg += `<text x="${(n % 3) * 300 + 8}" y="${Math.floor(n / 3) * 300 + 16}" font-size="12">yaw ${v.yaw} pitch ${v.pitch} · max ${max.toFixed(3)} R</text>`
    for (const run of headOutline(model, v)) svg += `<polyline fill="none" stroke="#aaa" stroke-width="2.5" points="${run.map(p => P(rotate(p, v))).join(' ')}"/>`
    for (const line of contourAt(model, v)) for (let i = 0; i + 1 < line.pts.length; i++) svg += `<line x1="${P(rotate(line.pts[i]!, v)).split(',')[0]}" y1="${P(rotate(line.pts[i]!, v)).split(',')[1]}" x2="${P(rotate(line.pts[i + 1]!, v)).split(',')[0]}" y2="${P(rotate(line.pts[i + 1]!, v)).split(',')[1]}" stroke="${line.side === 'pos' ? '#d32f2f' : '#1976d2'}" stroke-width="1.4" opacity="${(0.15 + 0.85 * Math.min(line.vis[i]!, line.vis[i + 1]!)).toFixed(2)}"/>`
  })
  console.log(rows.join('\n'))
  if (out) writeFileSync(`${out}/f3d-evidence-mix.svg`, svg + '</svg>')
})

it('dense sweep of the tracing: presence pattern and chin-anchor jumps', () => {
  const chinOf = (r: ReturnType<typeof traceKey>, s: 'pos' | 'neg'): V3 | undefined => { const q = r[s][0]?.[0]; return q ? head.at(q.u, q.y) : undefined }
  for (const pitch of [-45, -30, 0, 30, 45]) {
    let prev: ReturnType<typeof traceKey> | undefined, prevYaw = 0
    const notes: string[] = []
    for (let yaw = 0; yaw <= 90; yaw += 5) {
      const r = traceKey(head, { yaw, pitch })
      const pat = (s: 'pos' | 'neg') => r[s].map(x => (x ? '■' : '□')).join('')
      if (prev) for (const s of ['pos', 'neg'] as const) {
        const a = chinOf(prev, s), b = chinOf(r, s)
        if (a && b && len(sub(a, b)) > 0.15) notes.push(`${s} chin jump ${len(sub(a, b)).toFixed(2)} R at ${prevYaw}→${yaw}`)
        const pa = prev[s].map(x => !!x).join(), pb = r[s].map(x => !!x).join()
        if (pa !== pb) notes.push(`${s} ${prev[s].map(x => (x ? '■' : '□')).join('')}→${pat(s)} at ${prevYaw}→${yaw}`)
      }
      prev = r; prevYaw = yaw
    }
    console.log(`pitch ${pitch}: ${notes.length ? notes.join('; ') : 'no changes'}`)
  }
})
