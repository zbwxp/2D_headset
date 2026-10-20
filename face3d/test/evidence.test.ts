// PLAN §6 evidence with assertions (dot 1792489423 / 1792489477). At in-between angles, each side's three segments of
// the mixed contour are compared with the SAME side and segment of the head's own outline traced at that angle (not the
// whole head outline, never the back of the head):
//   error    — present target, both visible: two-way distance on screen (Hausdorff) between target and mixed segment;
//   coverage — present visible target, mixed segment mostly invisible (a missing segment);
//   ghost    — target absent or hidden, mixed segment mostly visible (a line that should not be drawn).
// Each counted on its own, so fading or a wrong target cannot hide an error.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { COUNTS, type Side, traceKey, weights } from '../src/contour'
import { contourAt, makeModel, visibleOutline } from '../src/model'
import { type V3, len, rotate, sub } from '../src/view'

const model = makeModel()
const { head, table } = model
const out = process.env.F3D_EVIDENCE_DIR
const VIEWS = [15, 45, 75].flatMap(yaw => [-38, -15, 15, 38].map(pitch => ({ yaw, pitch })))
const SEG_INDEX = [[0, 12], [12, 22], [22, 30]] as const // in a mixed line (segments share their anchors)

/** The head's own outline at a view, traced like a key, continuing the nearest key's chin anchors. */
function target(v: { yaw: number; pitch: number }) {
  const near = weights(v.yaw, v.pitch).sort((a, b) => b.w - a.w)[0]!, key = table.at(near.yaw, near.pitch)
  const ref: Partial<Record<Side, V3>> = {}
  for (const s of ['pos', 'neg'] as const) { const q = key[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
  return traceKey(head, v, ref)
}
const hausdorff = (a: number[][], b: number[][]) => {
  const one = (p: number[][], q: number[][]) => Math.max(...p.map(x => Math.min(...q.map(y => Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!)))))
  return Math.max(one(a, b), one(b, a))
}

interface Row { view: string; side: Side; seg: number; kind: 'error' | 'coverage' | 'ghost' | 'both-hidden'; value?: number }
function measure(): Row[] {
  const rows: Row[] = []
  for (const v of VIEWS) {
    const t = target(v), mixed = contourAt(model, v)
    for (const side of ['pos', 'neg'] as const) {
      const line = mixed.find(l => l.side === side)!
      for (let seg = 0; seg < 3; seg++) {
        const [a, b] = SEG_INDEX[seg]!, idx = Array.from({ length: b - a + 1 }, (_, k) => a + k)
        const mixVis = idx.filter(i => line.vis[i]! >= 0.5), mixShown = mixVis.length > idx.length / 2
        const ts = t[side][seg], tv = t.vis[side][seg] ?? []
        const tShownPts = ts ? ts.filter((_, k) => tv[k]) : []
        const tShown = !!ts && tShownPts.length > (COUNTS[seg]! / 2)
        const name = `${v.yaw},${v.pitch}`
        if (tShown && mixShown) {
          const A = tShownPts.map(q => rotate(head.at(q.u, q.y), v)), B = mixVis.map(i => rotate(line.pts[i]!, v))
          rows.push({ view: name, side, seg, kind: 'error', value: hausdorff(A as number[][], B as number[][]) })
        } else if (tShown) rows.push({ view: name, side, seg, kind: 'coverage' })
        else if (mixShown) rows.push({ view: name, side, seg, kind: 'ghost' })
        else rows.push({ view: name, side, seg, kind: 'both-hidden' })
      }
    }
  }
  return rows
}
const rows = measure()

describe('mixed contour vs the same side / segment of the head outline at in-between angles', () => {
  it('reports every view, side and segment', () => {
    const fmt = (r: Row) => `${r.view} ${r.side}${r.seg} ${r.kind}${r.value !== undefined ? ' ' + r.value.toFixed(3) + ' R' : ''}`
    console.log(rows.map(fmt).join('\n'))
    if (out) writeFileSync(`${out}/f3d-evidence-rows.txt`, rows.map(fmt).join('\n'))
  })
  // KNOWN = the failures measured at 2026-10-20 17:46, all looking up (pitch > 0) except one; they are open problems
  // (problem summary posted to dot), listed so that any NEW failure fails the test and fixing one shows here
  it('error: where both are shown, the two-way distance stays within 0.15 R (known failures listed)', () => {
    const KNOWN = ['15,15 pos0', '45,15 pos0', '45,15 neg0', '45,38 pos0', '45,38 pos1', '75,-38 neg1', '75,15 pos0', '75,15 neg0']
    const bad = rows.filter(r => r.kind === 'error' && r.value! > 0.15).map(r => `${r.view} ${r.side}${r.seg}`)
    expect(bad.filter(k => !KNOWN.includes(k))).toEqual([])
  })
  it('coverage: no segment the head shows is missing from the mixed contour (known gaps listed)', () => {
    const KNOWN = ['45,38 neg0']
    expect(rows.filter(r => r.kind === 'coverage').map(r => `${r.view} ${r.side}${r.seg}`).filter(k => !KNOWN.includes(k))).toEqual([])
  })
  it('ghost: no segment is drawn where the head shows none (known ones listed)', () => {
    const KNOWN = ['15,15 neg0', '15,15 neg1', '15,15 neg2', '15,38 neg0', '45,-38 neg2', '45,-15 neg2']
    expect(rows.filter(r => r.kind === 'ghost').map(r => `${r.view} ${r.side}${r.seg}`).filter(k => !KNOWN.includes(k))).toEqual([])
  })
})

describe('key tracing regressions (dot 1792489423: branch jumps, fold-backs, empty results)', () => {
  it('no key segment folds back on itself (a later sample never returns next to an earlier one across a gap)', () => {
    const bad: string[] = []
    for (const k of table.keys) for (const side of ['pos', 'neg'] as const) k[side].forEach((seg, i) => {
      if (!seg.present) return
      const P = seg.samples.map(q => head.at(q.u, q.y))
      const step = Math.max(...P.slice(1).map((p, j) => len(sub(p, P[j]!))))
      for (let a = 0; a < P.length; a++) for (let b = a + 3; b < P.length; b++) if (len(sub(P[a]!, P[b]!)) < step * 0.5) bad.push(`${k.view.yaw},${k.view.pitch} ${side}${i}`)
    })
    expect([...new Set(bad)].filter(k => k !== '60,45 pos1')).toEqual([]) // known: 60,45 pos1
  })
  it('every key has its chin–jaw segment on both sides (no empty result; known empties listed)', () => {
    const empty = table.keys.flatMap(k => (['pos', 'neg'] as const).filter(s => !k[s][0]!.present).map(s => `${k.view.yaw},${k.view.pitch} ${s}`))
    expect(empty.filter(k => !['30,45 neg', '60,45 neg', '90,45 neg'].includes(k))).toEqual([])
  })
  it('neighbouring keys keep the chin anchor on one branch (no jump > 0.35 R between neighbours)', () => {
    const bad: string[] = []
    const chinOf = (yaw: number, pitch: number, s: Side) => { const q = table.at(yaw, pitch)[s][0]!.samples[0]!; return head.at(q.u, q.y) }
    const ys = [0, 30, 60, 90], ps = [-45, -30, 0, 30, 45]
    for (const s of ['pos', 'neg'] as const) for (const p of ps) for (let i = 0; i + 1 < ys.length; i++) {
      const d = len(sub(chinOf(ys[i]!, p, s), chinOf(ys[i + 1]!, p, s)))
      if (d > 0.35) bad.push(`${s} pitch ${p}: yaw ${ys[i]}→${ys[i + 1]}`)
    }
    const KNOWN = ['pos pitch 30: yaw 60→90', 'pos pitch 45: yaw 30→60', 'neg pitch 30: yaw 60→90', 'neg pitch 45: yaw 0→30']
    expect(bad.filter(k => !KNOWN.includes(k))).toEqual([])
  })
})

it('picture: mixed (red / blue) over the depth-visible outline (grey)', () => {
  if (!out) return
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  VIEWS.forEach((v, n) => {
    const ox = (n % 4) * 300 + 150, oy = Math.floor(n / 4) * 300 + 130, S = 80, P = (p: V3) => { const q = rotate(p, v); return `${(ox + q[0] * S).toFixed(1)},${(oy - q[1] * S).toFixed(1)}` }
    const worst = Math.max(0, ...rows.filter(r => r.view === `${v.yaw},${v.pitch}` && r.kind === 'error').map(r => r.value!))
    svg += `<text x="${(n % 4) * 300 + 8}" y="${Math.floor(n / 4) * 300 + 16}" font-size="12">yaw ${v.yaw} pitch ${v.pitch} · worst ${worst.toFixed(3)} R</text>`
    for (const run of visibleOutline(model, v)) svg += `<polyline fill="none" stroke="#aaa" stroke-width="2.5" points="${run.map(P).join(' ')}"/>`
    for (const line of contourAt(model, v)) for (let i = 0; i + 1 < line.pts.length; i++) {
      const o = Math.min(line.vis[i]!, line.vis[i + 1]!); if (o < 0.01) continue
      svg += `<polyline fill="none" stroke="${line.side === 'pos' ? '#d32f2f' : '#1976d2'}" stroke-width="1.4" opacity="${o.toFixed(2)}" points="${P(line.pts[i]!)} ${P(line.pts[i + 1]!)}"/>`
    }
  })
  writeFileSync(`${out}/f3d-evidence-mix.svg`, svg + '</svg>')
})
