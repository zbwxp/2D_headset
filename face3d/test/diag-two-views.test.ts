// Diagnostic (dot 1792492800): yaw 45 / pitch 15 and 75 / 15, x+ side, side by side — for the four contributing keys
// (rebuilt in the key table's own order so each continues the same neighbour) and for the head's own trace at the view:
// candidate loops, chosen loop, start point, walk direction, anchors (and which rule reached each), the chin–jaw
// segment's ends; then the mixed segment against the view's own trace, sample by sample, with the worst sample.
// Prints only (F3D_DIAG=1); it decides nothing.
import { it } from 'vitest'
import { PITCH_KEYS, type Side, type TraceInfo, YAW_KEYS, mixContour, traceKey, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { type V3, rotate } from '../src/view'

it.skipIf(!process.env.F3D_DIAG)('45,15 and 75,15 side by side', () => {
  const m = makeModel(), head = m.head, side: Side = 'pos'
  // the key table's build order: level, then the yaw-0 column outward, then each row in yaw; each from its neighbour
  const traced = new Map<string, { r: ReturnType<typeof traceKey>; info: TraceInfo }>()
  const anchorOf = (r: ReturnType<typeof traceKey>) => { const o: Partial<Record<Side, V3>> = {}; for (const s of ['pos', 'neg'] as const) { const q = r[s][0]?.[0]; if (q) o[s] = head.at(q.u, q.y) } return o }
  const run = (yaw: number, pitch: number, ref: Partial<Record<Side, V3>>) => { const info: TraceInfo = { loops: [], side: {} }; const r = traceKey(head, { yaw, pitch }, ref, info); traced.set(`${yaw},${pitch}`, { r, info }); return r }
  run(0, 0, {})
  for (const dir of [1, -1]) { let prev = traced.get('0,0')!.r; for (const p of PITCH_KEYS.filter(p => p * dir > 0).sort((a, b) => Math.abs(a) - Math.abs(b))) prev = run(0, p, anchorOf(prev)) }
  for (const p of PITCH_KEYS) { let prev = traced.get(`0,${p}`)!.r; for (const y of YAW_KEYS.slice(1)) prev = run(y, p, anchorOf(prev)) }
  const deg = (u: number) => `${(u * 57.3).toFixed(0)}°`
  const describe = (label: string, r: ReturnType<typeof traceKey>, info: TraceInfo) => {
    const s = info.side[side], seg = r[side][0]
    return `${label}: loops [${info.loops.map(l => l.n + (l.closed ? 'c' : 'o')).join(',')}]` +
      (s ? ` · chose loop ${s.loop}, start #${s.start} (candidate ${s.tried}), dir ${s.dir > 0 ? '+' : '−'}, walk ${s.walk} pts, anchors ${s.anchors.join('/')}` : ' · no walk') +
      (seg ? ` · chin–jaw u ${deg(seg[0]!.u)}→${deg(seg[seg.length - 1]!.u)}, y ${seg[0]!.y.toFixed(3)}→${seg[seg.length - 1]!.y.toFixed(3)}` : ' · chin–jaw absent')
  }
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) {
    const W = weights(v.yaw, v.pitch), lines = [`== view ${v.yaw},${v.pitch} (x+ side), weights ${W.map(w => `${w.yaw},${w.pitch}:${w.w.toFixed(2)}`).join(' ')}`]
    for (const w of W) { const t = traced.get(`${w.yaw},${w.pitch}`)!; lines.push(describe(`  key ${w.yaw},${w.pitch}`, t.r, t.info)) }
    const near = [...W].sort((a, b) => b.w - a.w)[0]!, info: TraceInfo = { loops: [], side: {} }
    const tr = traceKey(head, v, anchorOf(traced.get(`${near.yaw},${near.pitch}`)!.r), info)
    lines.push(describe('  the head at the view itself', tr, info))
    const mixed = mixContour(head, m.table, v).find(l => l.side === side)!, target = (tr[side][0] ?? []).map(q => rotate(head.at(q.u, q.y), v))
    const d = mixed.pts.slice(0, 13).map(p => { const r = rotate(p, v); return Math.min(...target.map(q => Math.hypot(q[0] - r[0], q[1] - r[1]))) })
    const k = d.indexOf(Math.max(...d))
    lines.push(`  mixed chin–jaw vs the view's own trace, per sample (R): ${d.map(x => x.toFixed(3)).join(' ')} — worst #${k} ${d[k]!.toFixed(3)}`)
    console.log(lines.join('\n'))
  }
})
