// Face-outline snapshots at yaw 0 / 15 / 30 / 45 / 60 / 75 / 90 (bowen 1792512376: "这就是未来脸轮廓的建模"), all in 2D:
//   keys = bowen's hand-tuned bench outlines put at their ESTIMATED true angles (angles.ts; candidates, dot 1792512223):
//     the front, made symmetric (averaged with its mirror); "30" and "60" (his playback corrections, +yaw side only —
//     the −yaw side is not hand-tuned); the +90 view and the −90 view mirrored, each at its own estimated angle;
//   every control (each line's end points and handle vectors, canvas px) interpolated LINEARLY over the true angle
//   between neighbouring keys (bowen 1792512406: "脸轮廓建模的本质就是几个关键帧加上线性interpolate"), read at the
//   snapshot angles (outside the keys: the nearest key); −yaw = the mirror, so the set is symmetric.
// Run: npx vite-node face3d/fit/snapshots.ts <angles.json> <out-prefix> [pitch]
import { readFileSync, writeFileSync } from 'node:fs'
import { type Model, type Pose, evaluate } from '../../../headset-core/src/evaluate/index'
import data from './ref/outline-123.json'

type V = { x: number; y: number }
type Controls = { points: Record<string, V>; lines: Record<string, { ha: V; hb: V }> }
const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('view:', ''), v]))
const model = {
  views: data.views.map(v => { const [yaw, pitch] = v.key.slice('view:'.length).split(',').map(Number); return { yaw: yaw!, pitch: pitch!, points: v.points, lines: v.lines } }),
  responses: { points: Object.fromEntries(Object.entries(data.responses.points).map(([k, v]) => [k, strip(v as Record<string, unknown>)])), handles: Object.fromEntries(Object.entries(data.responses.handles).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as Record<string, Record<string, unknown>>).map(([e, r]) => [e, strip(r)]))])) },
} as unknown as Model
export const LINES = data.lines
const partnerLine: Record<string, string> = {}
for (const l of LINES) { const m = /^([左右])(.*)$/.exec(l.name); const o = m ? LINES.find(x => x.name === (m[1] === '左' ? '右' : '左') + m[2]) : undefined; partnerLine[l.id] = o ? o.id : l.id }
const partnerPoint: Record<string, string> = {}
for (const l of LINES) { const o = LINES.find(x => x.id === partnerLine[l.id])!; partnerPoint[l.a] = o.a; partnerPoint[l.b] = o.b }

export const controlsAt = (pose: Pose): Controls => { const g = evaluate(model, pose); return { points: g.points, lines: g.lines } }
/** the mirror image: x negated, left and right exchanged (a line's handles go with its partner line) */
export const mirror = (c: Controls): Controls => ({
  points: Object.fromEntries(Object.keys(c.points).map(p => [p, { x: -c.points[partnerPoint[p] ?? p]!.x, y: c.points[partnerPoint[p] ?? p]!.y }])),
  lines: Object.fromEntries(Object.keys(c.lines).map(l => { const o = c.lines[partnerLine[l] ?? l]!; return [l, { ha: { x: -o.ha.x, y: o.ha.y }, hb: { x: -o.hb.x, y: o.hb.y } }] })),
})
const avg = (a: Controls, b: Controls): Controls => ({
  points: Object.fromEntries(Object.keys(a.points).map(p => [p, { x: (a.points[p]!.x + b.points[p]!.x) / 2, y: (a.points[p]!.y + b.points[p]!.y) / 2 }])),
  lines: Object.fromEntries(Object.keys(a.lines).map(l => [l, { ha: { x: (a.lines[l]!.ha.x + b.lines[l]!.ha.x) / 2, y: (a.lines[l]!.ha.y + b.lines[l]!.ha.y) / 2 }, hb: { x: (a.lines[l]!.hb.x + b.lines[l]!.hb.x) / 2, y: (a.lines[l]!.hb.y + b.lines[l]!.hb.y) / 2 } }])),
})
const flat = (c: Controls) => [...Object.keys(c.points).sort().flatMap(p => [c.points[p]!.x, c.points[p]!.y]), ...Object.keys(c.lines).sort().flatMap(l => [c.lines[l]!.ha.x, c.lines[l]!.ha.y, c.lines[l]!.hb.x, c.lines[l]!.hb.y])]
const unflat = (like: Controls, v: number[]): Controls => {
  let k = 0; const points: Record<string, V> = {}, lines: Record<string, { ha: V; hb: V }> = {}
  for (const p of Object.keys(like.points).sort()) points[p] = { x: v[k++]!, y: v[k++]! }
  for (const l of Object.keys(like.lines).sort()) lines[l] = { ha: { x: v[k++]!, y: v[k++]! }, hb: { x: v[k++]!, y: v[k++]! } }
  return { points, lines }
}

export interface Key { yaw: number; from: string; c: Controls }
/** the keys for one pitch row from an angle estimate */
export function keys(A: { nominal: Pose[]; angles: Pose[] }, pitch: number): Key[] {
  const est = (yaw: number) => A.angles[A.nominal.findIndex(n => n.yaw === yaw && n.pitch === pitch)]!
  const front = controlsAt({ yaw: 0, pitch })
  const out: Key[] = [{ yaw: 0, from: `bench 0,${pitch}（与镜像平均）`, c: avg(front, mirror(front)) }]
  for (const y of [30, 60]) out.push({ yaw: est(y).yaw, from: `bench 「${y}」,${pitch}`, c: controlsAt({ yaw: y, pitch }) })
  out.push({ yaw: est(90).yaw, from: `bench 90,${pitch}`, c: controlsAt({ yaw: 90, pitch }) })
  out.push({ yaw: -est(-90).yaw, from: `bench −90,${pitch}（镜像）`, c: mirror(controlsAt({ yaw: -90, pitch })) })
  return out.sort((a, b) => a.yaw - b.yaw)
}
export function snapshots(K: Key[], at: number[]): { yaw: number; c: Controls }[] {
  const cols = K.map(k => flat(k.c)), n = cols[0]!.length
  const lin = (j: number) => (yaw: number) => {
    if (yaw <= K[0]!.yaw) return cols[0]![j]!
    if (yaw >= K[K.length - 1]!.yaw) return cols[K.length - 1]![j]!
    let i = 0; while (yaw > K[i + 1]!.yaw) i++
    const t = (yaw - K[i]!.yaw) / (K[i + 1]!.yaw - K[i]!.yaw); return cols[i]![j]! * (1 - t) + cols[i + 1]![j]! * t
  }
  const fns = Array.from({ length: n }, (_, j) => lin(j))
  return at.map(yaw => ({ yaw, c: unflat(K[0]!.c, fns.map(f => f(yaw))) }))
}
export const cubicsOf = (c: Controls) => LINES.map(l => { const A = c.points[l.a]!, B = c.points[l.b]!, h = c.lines[l.id]!; return [A, { x: A.x + h.ha.x, y: A.y + h.ha.y }, { x: B.x + h.hb.x, y: B.y + h.hb.y }, B] as [V, V, V, V] })
const sample = (q: [V, V, V, V], n = 40) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n, u = 1 - t; return { x: u * u * u * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t * t * t * q[3].x, y: u * u * u * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t * t * t * q[3].y } })

if (process.argv[1]?.includes('vite-node') || process.env.SNAP) {
  const [anglesFile, prefix, pitchArg] = process.argv.slice(2)
  if (anglesFile && prefix) {
    const A = JSON.parse(readFileSync(anglesFile, 'utf8')), pitch = Number(pitchArg ?? 0), K = keys(A, pitch), AT = [0, 15, 30, 45, 60, 75, 90], S = snapshots(K, AT)
    writeFileSync(`${prefix}.json`, JSON.stringify({ pitch, angles: anglesFile, keys: K.map(k => ({ yaw: k.yaw, from: k.from })), snapshots: S }, null, 1))
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="PingFang SC, sans-serif"><rect width="100%" height="100%" fill="white"/>`
    svg += `<text x="10" y="24" font-size="16">外轮廓快照 · pitch ${pitch} · 关键帧（估计角度）：${K.map(k => `${k.from} @ ${k.yaw.toFixed(1)}°`).join('；')}</text>`
    const cw = 1500 / AT.length
    S.forEach((s, i) => {
      const ox = i * cw + cw / 2, oy = 220, sc = 1.0
      svg += `<text x="${ox - 16}" y="${oy + 170}" font-size="18">${s.yaw}°</text>`
      for (const q of cubicsOf(s.c)) svg += `<polyline fill="none" stroke="#111" stroke-width="2" points="${sample(q).map(p => `${(ox + p.x * sc).toFixed(1)},${(oy + p.y * sc).toFixed(1)}`).join(' ')}"/>`
    })
    // the keys themselves, at their angles, overlaid in red on the same strip scale (row 2)
    K.forEach((k, i) => {
      const ox = (i + 0.5) * (1500 / K.length), oy = 560
      svg += `<text x="${ox - 70}" y="${oy + 170}" font-size="14" fill="#c62828">${k.from} @ ${k.yaw.toFixed(1)}°</text>`
      for (const q of cubicsOf(k.c)) svg += `<polyline fill="none" stroke="#c62828" stroke-width="1.6" points="${sample(q).map(p => `${(ox + p.x).toFixed(1)},${(oy + p.y).toFixed(1)}`).join(' ')}"/>`
    })
    writeFileSync(`${prefix}.svg`, svg + '</svg>'); console.log('ok', K.map(k => `${k.yaw.toFixed(1)}`).join(' '))
  }
}
