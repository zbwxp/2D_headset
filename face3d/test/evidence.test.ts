// PLAN §6 evidence with assertions (dot 1792489423 / 1792489477 / 1792489731).
// Every check measures first; a measured failure must be in the ledger (known.ts) with a ceiling, and must not exceed
// it; a ledger entry that no longer fails must be removed (a stale exemption fails too). NaN is never exempt.
// Comparisons are per side and semantic segment against the head's own outline traced at the same angle:
//   error    — two-way distance on screen between the target's visible edges and the mixed contour's visible edges;
//   coverage — target visible edges with no mixed visible edge near them (a local gap counts, not only whole segments);
//   ghost    — mixed visible edges with no target visible edge near them;
//   crossing — the mixed line, projected, crossing itself (a fold-back) at in-between and key angles;
//   jump     — a key's chin anchor far from its yaw or pitch neighbour's (branch jump);
//   empty    — a key without its chin–jaw segment.
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { type ContourLine, PITCH_KEYS, type Side, traceKey, weights, YAW_KEYS } from '../src/contour'
import { contourAt, makeModel, visibleOutline } from '../src/model'
import { type V3, len, rotate, sub } from '../src/view'
import { KNOWN } from './known'

const model = makeModel()
const { head, table } = model
const out = process.env.F3D_EVIDENCE_DIR
const VIEWS = [15, 45, 75].flatMap(yaw => [-38, -15, 15, 38].map(pitch => ({ yaw, pitch })))
const DENSE = Array.from({ length: 13 }, (_, i) => i * 7.5).flatMap(yaw => Array.from({ length: 13 }, (_, j) => -45 + j * 7.5).map(pitch => ({ yaw, pitch })))
const SEG_INDEX = [[0, 12], [12, 22], [22, 30]] as const // in a mixed line (segments share their anchors)
const ERROR_MAX = 0.15, NEAR = 0.06, JUMP_MAX = 0.35

type Pt = readonly [number, number]
const proj = (p: V3, v: { yaw: number; pitch: number }): Pt => { const r = rotate(p, v); return [r[0], r[1]] }
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The head's own outline at a view, traced like a key, continuing the nearest key's chin anchors. */
function target(v: { yaw: number; pitch: number }) {
  const near = weights(v.yaw, v.pitch).sort((a, b) => b.w - a.w)[0]!, key = table.at(near.yaw, near.pitch)
  const ref: Partial<Record<Side, V3>> = {}
  for (const s of ['pos', 'neg'] as const) { const q = key[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
  return traceKey(head, v, ref)
}
/** visible edges of a mixed segment, as projected point pairs */
const mixedEdges = (line: ContourLine, seg: number, v: { yaw: number; pitch: number }): [Pt, Pt][] => {
  const [a, b] = SEG_INDEX[seg]!, e: [Pt, Pt][] = []
  for (let i = a; i < b; i++) if (line.vis[i]! >= 0.5 && line.vis[i + 1]! >= 0.5) e.push([proj(line.pts[i]!, v), proj(line.pts[i + 1]!, v)])
  return e
}
const targetEdges = (t: ReturnType<typeof traceKey>, side: Side, seg: number, v: { yaw: number; pitch: number }): [Pt, Pt][] => {
  const s = t[side][seg], vis = t.vis[side][seg] ?? [], e: [Pt, Pt][] = []
  if (s) for (let i = 0; i + 1 < s.length; i++) if (vis[i] && vis[i + 1]) e.push([proj(head.at(s[i]!.u, s[i]!.y), v), proj(head.at(s[i + 1]!.u, s[i + 1]!.y), v)])
  return e
}
const pts = (e: [Pt, Pt][]) => e.flatMap(x => [x[0], x[1]])
const nearest = (p: Pt, q: Pt[]) => Math.min(...q.map(x => dist(p, x)))

// ---- measure everything once ---------------------------------------------------------------------------------------
const measured = new Map<string, number>() // failing items only: key → value
const fail = (k: string, v: number) => measured.set(k, Math.max(v, measured.get(k) ?? -Infinity))
let nonFinite: string[] = []

for (const v of [...VIEWS, ...DENSE]) for (const l of contourAt(model, v)) if (l.pts.some(p => !p.every(Number.isFinite)) || l.vis.some(x => !Number.isFinite(x))) nonFinite.push(`${v.yaw},${v.pitch} ${l.side}`)
nonFinite = [...new Set(nonFinite)]

for (const v of VIEWS) {
  const t = target(v), mixed = contourAt(model, v), name = `${v.yaw},${v.pitch}`
  for (const side of ['pos', 'neg'] as const) {
    const line = mixed.find(l => l.side === side)!
    for (let seg = 0; seg < 3; seg++) {
      const M = mixedEdges(line, seg, v), T = targetEdges(t, side, seg, v)
      if (M.length && T.length) {
        const e = Math.max(...pts(M).map(p => nearest(p, pts(T))), ...pts(T).map(p => nearest(p, pts(M))))
        if (e > ERROR_MAX) fail(`error ${name} ${side}${seg}`, e)
      }
      const uncovered = T.filter(x => !M.length || nearest(mid(x[0], x[1]), M.map(y => mid(y[0], y[1]))) > NEAR).length
      if (uncovered) fail(`coverage ${name} ${side}${seg}`, uncovered)
      const ghosts = M.filter(x => !T.length || nearest(mid(x[0], x[1]), T.map(y => mid(y[0], y[1]))) > NEAR).length
      if (ghosts) fail(`ghost ${name} ${side}${seg}`, ghosts)
    }
  }
}

const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
for (const v of DENSE) for (const l of contourAt(model, v)) {
  const E: [Pt, Pt][] = []
  for (let i = 0; i + 1 < l.pts.length; i++) if (l.vis[i]! >= 0.5 && l.vis[i + 1]! >= 0.5) E.push([proj(l.pts[i]!, v), proj(l.pts[i + 1]!, v)])
  let n = 0
  for (let i = 0; i < E.length; i++) for (let j = i + 2; j < E.length; j++) if (cross(E[i]![0], E[i]![1], E[j]![0], E[j]![1])) n++
  if (n) fail(`crossing ${v.yaw},${v.pitch} ${l.side}`, n)
}

const chinOf = (yaw: number, pitch: number, s: Side) => { const q = table.at(yaw, pitch)[s][0]!.samples[0]!; return head.at(q.u, q.y) }
for (const s of ['pos', 'neg'] as const) {
  for (const p of PITCH_KEYS) for (let i = 0; i + 1 < YAW_KEYS.length; i++) {
    const d = len(sub(chinOf(YAW_KEYS[i]!, p, s), chinOf(YAW_KEYS[i + 1]!, p, s)))
    if (d > JUMP_MAX) fail(`jump ${s} pitch ${p}: yaw ${YAW_KEYS[i]}→${YAW_KEYS[i + 1]}`, d)
  }
  for (const y of YAW_KEYS) for (let j = 0; j + 1 < PITCH_KEYS.length; j++) {
    const d = len(sub(chinOf(y, PITCH_KEYS[j]!, s), chinOf(y, PITCH_KEYS[j + 1]!, s)))
    if (d > JUMP_MAX) fail(`jump ${s} yaw ${y}: pitch ${PITCH_KEYS[j]}→${PITCH_KEYS[j + 1]}`, d)
  }
}
for (const k of table.keys) for (const s of ['pos', 'neg'] as const) if (!k[s][0]!.present) fail(`empty ${k.view.yaw},${k.view.pitch} ${s}`, 1)

// ---- the checks ----------------------------------------------------------------------------------------------------
describe('face3d evidence against the ledger of known failures', () => {
  it('no NaN or infinite point anywhere (never exempt)', () => expect(nonFinite).toEqual([]))
  it('prints the measured failures (F3D_RECORD=1 prints them as a ledger)', () => {
    const lines = [...measured].sort().map(([k, v]) => `  '${k}': { max: ${+v.toFixed(4)}, tol: ${k.startsWith('error') || k.startsWith('jump') ? 0.01 : 0} },`)
    console.log(`${measured.size} failing items\n` + (process.env.F3D_RECORD ? `export const KNOWN: Record<string, { max: number; tol: number }> = {\n${lines.join('\n')}\n}` : lines.join('\n')))
  })
  it('every measured failure is in the ledger and within its ceiling', () => {
    const bad = [...measured].filter(([k, v]) => !KNOWN[k] || v > KNOWN[k]!.max + KNOWN[k]!.tol).map(([k, v]) => `${k} = ${v.toFixed(4)}${KNOWN[k] ? ` > ${KNOWN[k]!.max} + ${KNOWN[k]!.tol}` : ' (new)'}`)
    expect(bad).toEqual([])
  })
  it('every ledger entry still fails — a fixed one must be removed from the ledger', () => {
    expect(Object.keys(KNOWN).filter(k => !measured.has(k))).toEqual([])
  })
})

it('picture: mixed (red / blue) over the depth-visible outline (grey)', () => {
  if (!out) return
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  VIEWS.forEach((v, n) => {
    const ox = (n % 4) * 300 + 150, oy = Math.floor(n / 4) * 300 + 130, S = 80, P = (p: V3) => { const q = rotate(p, v); return `${(ox + q[0] * S).toFixed(1)},${(oy - q[1] * S).toFixed(1)}` }
    svg += `<text x="${(n % 4) * 300 + 8}" y="${Math.floor(n / 4) * 300 + 16}" font-size="12">yaw ${v.yaw} pitch ${v.pitch}</text>`
    for (const run of visibleOutline(model, v)) svg += `<polyline fill="none" stroke="#aaa" stroke-width="2.5" points="${run.map(P).join(' ')}"/>`
    for (const line of contourAt(model, v)) for (let i = 0; i + 1 < line.pts.length; i++) {
      const o = Math.min(line.vis[i]!, line.vis[i + 1]!); if (o < 0.01) continue
      svg += `<polyline fill="none" stroke="${line.side === 'pos' ? '#d32f2f' : '#1976d2'}" stroke-width="1.4" opacity="${o.toFixed(2)}" points="${P(line.pts[i]!)} ${P(line.pts[i + 1]!)}"/>`
    }
  })
  writeFileSync(`${out}/f3d-evidence-mix.svg`, svg + '</svg>')
})
