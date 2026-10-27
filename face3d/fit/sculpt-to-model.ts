// A copy of the VRoid head sculpted so its outline at each turn is the old turn model's face outline (bowen 1793122560
// 「复制一份vroid的副本，然后看看如果用之前的模型的脸外轮廓能反推出模型应该是怎样的捏脸形状吗？」).
// - The old model (bench-tasks/转头模型/model.json, evaluate at yaw 0…90 every 10°) draws a face mask: the far side's 3 lines
//   (颅顶 → 太阳穴 → 颧骨 → 下巴) are the head's outline at every turn; the near side's jaw (下巴 → 耳根) is its lower edge; the near
//   side's skull line (耳根 → 颅顶) is the outline only while the head is near frontal (≤ 20°) — turned further it runs inside the
//   head (the back of the skull is under the hair, not in the model). Those are the targets; the rest of the head is free.
// - Its picture (y down, its own units) is put on VRoid's screen by one scale, one height shift and one turning axis for all
//   views (fitted to the crown and chin across the turns): no view is moved on its own.
// - The copy (head without neck, ears pressed flat): each round, at every turn the head is drawn, its outline traced; each
//   outline point near a target line is pulled toward it across the outline (on the screen, as a move in 3D); the pulls of all
//   turns spread smoothly over the whole head (Gaussian, σ 0.15 head units), half applied; left and right kept mirror images.
// Writes face3d/viewer/sculpt-to-model.json (the copy's vertices) and face3d/viewer/ref-shell/sculpt-to-model.svg.
// Run: npx vite-node face3d/fit/sculpt-to-model.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { cutNeck, loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { evaluate } from '../turnmodel'
import { rotate, screenAxes, toCamera } from '../src/view'
import { flattenEars } from './flatten-ears'
type P3 = [number, number, number]
type P2 = [number, number]
const M = JSON.parse(readFileSync('bench-tasks/转头模型/model.json', 'utf8'))
const buf = readFileSync('face3d/fit/ref/test.vrm'), D = cutNeck(loadVrmHead(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
const P0 = D.P.map(p => [...p] as P3), N0 = D.N.map(n => [...n])
flattenEars(P0, N0, D.skinTris)
const SK = [...new Set(D.skinTris)].map(i => P0[i]!)
const YAWS = Array.from({ length: 10 }, (_, i) => i * 10), ROUNDS = Number(process.env.ROUNDS ?? 24), SIG = Number(process.env.SIG ?? 0.15), STEP = 0.5
const W = 400, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.42 }
const cubic2 = (c: number[][], t: number): P2 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P2 }

// ---- the old model's picture onto VRoid's screen: x = s·mx + zc·sin(yaw)… fitted to the crown and the chin ----
const crown = SK.reduce((a, p) => (p[1] > a[1] ? p : a)), chin = SK.filter(p => Math.abs(p[0]) < 0.03 && p[2] > 0.6).reduce((a, p) => (p[1] < a[1] ? p : a))
const s = (crown[1] - chin[1]) / (evaluate(M, 0).points.chin![1] - evaluate(M, 0).points.crown![1]), ty = crown[1] + s * evaluate(M, 0).points.crown![1]
// the turning axis: the model's crown and chin x across the turns against VRoid's, x_model·s = x_vroid(yaw) + a·sin(yaw)
let num = 0, den = 0
for (const y of YAWS) { const f = evaluate(M, y), sn = Math.sin((y * Math.PI) / 180); for (const [k, p] of [['crown', crown], ['chin', chin]] as const) { const xv = rotate(p, { yaw: y, pitch: 0 })[0], xm = f.points[k]![0] * s; num += (xm - xv) * sn; den += sn * sn } }
const axisShift = num / den
const toScreen = (q: number[], yaw: number): P2 => [q[0]! * s - axisShift * Math.sin((yaw * Math.PI) / 180), -q[1]! * s + ty]
console.log('picture → screen: scale', s.toFixed(5), 'height shift', ty.toFixed(3), 'turning axis shift', axisShift.toFixed(3))
const targets = YAWS.map(yaw => { const f = evaluate(M, yaw), keep = f.outline.filter(l => /^far/.test(l.name) || l.name === 'nearJaw' || (l.name === 'nearSkull' && yaw <= 20))
  return { yaw, lines: keep.map(l => ({ name: l.name, q: Array.from({ length: 61 }, (_, i) => toScreen(cubic2(l.c as unknown as number[][], i / 60), yaw)) })) } })

// ---- the copy ----
const P = P0.map(p => [...p] as P3), nV = P.length
// mirror partners (nearest vertex to the mirrored place)
const key = (p: P3) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`, grid = new Map<string, number[]>()
P0.forEach((p, i) => { const k = key(p); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i) })
const mirror = P0.map(p => { const m: P3 = [-p[0], p[1], p[2]]; let bi = -1, bd = 0.01
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get(`${Math.round(m[0] * 50) + dx},${Math.round(m[1] * 50) + dy},${Math.round(m[2] * 50) + dz}`) ?? []) { const d = Math.hypot(P0[j]![0] - m[0], P0[j]![1] - m[1], P0[j]![2] - m[2]); if (d < bd) { bd = d; bi = j } }
  return bi })
console.log('vertices', nV, 'with a mirror partner', mirror.filter(i => i >= 0).length)
const head = () => ({ ...D, P }) as unknown as Parameters<typeof rasterHead>[0]
// mesh neighbours (all parts), for smoothing the sculpt: the change from VRoid is kept smooth over the surface (no dents)
const nb: Set<number>[] = P.map(() => new Set<number>())
for (const part of D.parts) for (let t = 0; t < part.tris.length; t += 3) { const v = [part.tris[t]!, part.tris[t + 1]!, part.tris[t + 2]!]; for (const a of v) for (const b2 of v) if (a !== b2) nb[a]!.add(b2) }
const SMOOTH = Number(process.env.SMOOTH ?? 3)
function smoothChange() { for (let r = 0; r < SMOOTH; r++) { const d = P.map((p, i) => [p[0] - P0[i]![0], p[1] - P0[i]![1], p[2] - P0[i]![2]])
  P.forEach((p, i) => { const ns = [...nb[i]!]; if (!ns.length) return; const avg = [0, 1, 2].map(k => ns.reduce((a, j) => a + d[j]![k]!, 0) / ns.length); for (let k = 0; k < 3; k++) p[k] = P0[i]![k]! + 0.5 * d[i]![k]! + 0.5 * avg[k]! }) } }

/** the head's outline at a turn: screen points and their places on the head, and the outward normal across it */
function outlineAt(yaw: number) {
  const v = { yaw, pitch: 0 }, ras = rasterHead(head(), v, F, new Uint8ClampedArray(W * W * 4)), on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null
  for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 20000; n++) {
    const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  const ax = screenAxes(v), fw = toCamera(v), n = cells.length
  const q = cells.map(([i, j]) => [(i + 0.5 - F.cx) / F.S, (F.cy - (j + 0.5)) / F.S] as P2)
  const p3 = cells.map(([i, j], k) => { const z = ras.zb[j * W + i]!; return [0, 1, 2].map(m => ax.right[m]! * q[k]![0] + ax.up[m]! * q[k]![1] + fw[m]! * z) as P3 })
  // outward normal: the trace runs clockwise on the screen (y up: the inside on the right), so outward = left of the step
  const nrm = q.map((_, k) => { const a = q[(k - 4 + n) % n]!, b = q[(k + 4) % n]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l] as P2 })
  // (which side is outside: test one point against the drawn head)
  const k0 = Math.floor(n / 3), t = [q[k0]![0] + nrm[k0]![0] * 0.05, q[k0]![1] + nrm[k0]![1] * 0.05], inside = on(Math.round(F.cx + t[0]! * F.S), Math.round(F.cy - t[1]! * F.S))
  if (inside) for (const m of nrm) { m[0] = -m[0]; m[1] = -m[1] }
  return { q, p3, nrm, ax }
}
/** how far the target lines are from the head's outline at a turn (each target sample to the outline) */
function gap(yaw: number) { const o = outlineAt(yaw), T = targets.find(t => t.yaw === yaw)!
  const d = T.lines.flatMap(l => l.q.map(p => Math.min(...o.q.map(r => Math.hypot(r[0] - p[0], r[1] - p[1]))))).sort((a, b) => a - b)
  return { med: d[Math.floor(d.length / 2)]!, p90: d[Math.floor(d.length * 0.9)]!, o } }
const before = YAWS.map(y => gap(y))
console.log('before', before.map((g, i) => `${YAWS[i]}:${g.p90.toFixed(3)}`).join(' '))

for (let round = 0; round < ROUNDS; round++) {
  const C: P3[] = [], Dv: P3[] = []
  for (const T of targets) { const o = outlineAt(T.yaw), tq = T.lines.flatMap(l => l.q)
    o.q.forEach((q, k) => { let bd = Infinity, bt: P2 = q; for (const t of tq) { const d = Math.hypot(t[0] - q[0], t[1] - q[1]); if (d < bd) { bd = d; bt = t } }
      if (bd > 0.35) return // this part of the outline has no target (the back of the head)
      const n = o.nrm[k]!, along = (bt[0] - q[0]) * n[0] + (bt[1] - q[1]) * n[1] // the pull across the outline only
      C.push(o.p3[k]!); Dv.push([0, 1, 2].map(m => (o.ax.right[m]! * n[0] + o.ax.up[m]! * n[1]) * along) as P3) }) }
  // spread over the head, then half of it applied, then mirrored
  const inv = 1 / (2 * SIG * SIG), move = P.map(p => { let sx = 0, sy = 0, sz = 0, sw = 0
    for (let i = 0; i < C.length; i++) { const c = C[i]!, d2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d2 > 9 * SIG * SIG) continue; const w = Math.exp(-d2 * inv); sx += w * Dv[i]![0]; sy += w * Dv[i]![1]; sz += w * Dv[i]![2]; sw += w }
    const k = STEP / (sw + 1); return [sx * k, sy * k, sz * k] as P3 })
  P.forEach((p, i) => { p[0] += move[i]![0]; p[1] += move[i]![1]; p[2] += move[i]![2] })
  smoothChange()
  const Q = P.map(p => [...p] as P3); P.forEach((p, i) => { const j = mirror[i]!; if (j < 0) return; p[0] = (Q[i]![0] - Q[j]![0]) / 2; p[1] = (Q[i]![1] + Q[j]![1]) / 2; p[2] = (Q[i]![2] + Q[j]![2]) / 2 })
  if (round % 4 === 3 || round === ROUNDS - 1) console.log('round', round + 1, YAWS.map(y => `${y}:${gap(y).p90.toFixed(3)}`).join(' '))
}
const after = YAWS.map(y => gap(y))
const moved = P.map((p, i) => Math.hypot(p[0] - P0[i]![0], p[1] - P0[i]![1], p[2] - P0[i]![2]))
console.log('moved: max', Math.max(...moved).toFixed(3), 'median', [...moved].sort((a, b) => a - b)[Math.floor(nV / 2)]!.toFixed(4))
writeFileSync('face3d/viewer/sculpt-to-model.json', JSON.stringify({ note: "the VRoid head (no neck, ears pressed flat) sculpted so its outline at each turn is the old turn model's face outline (face3d/fit/sculpt-to-model.ts, bowen 1793122560); vertices in loadVrmHead + cutNeck order", align: { scale: s, heightShift: ty, axisShift }, P: P.map(p => p.map(x => +x.toFixed(4))) }))
// the sheet: per turn the target lines (red), VRoid's outline before (grey) and the copy's after (green)
const Pn = 360, Cc = 4
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Cc * Pn} ${Cc * Pn}" width="${Cc * Pn}" height="${Cc * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
YAWS.forEach((yaw, k) => { const ox = (k % Cc) * Pn, oy = Math.floor(k / Cc) * Pn, S = Pn / 3.4, X = (p: P2) => ox + Pn / 2 + p[0] * S, Y = (p: P2) => oy + Pn * 0.42 - p[1] * S
  const pl = (ps: P2[], st: string, close = false) => `<${close ? 'polygon' : 'polyline'} fill="none" ${st} points="${ps.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>` + pl(before[k]!.o.q, 'stroke="#999" stroke-width="1" stroke-dasharray="3 2"', true) + pl(after[k]!.o.q, 'stroke="#13a05a" stroke-width="1.6"', true)
  for (const l of targets[k]!.lines) svg += pl(l.q, 'stroke="#d0342c" stroke-width="2.2" stroke-opacity="0.75"')
  svg += `<text x="${ox + 6}" y="${oy + 16}" font-size="13">转 ${yaw}° · 红线到轮廓 九成：原 ${before[k]!.p90.toFixed(3)} → 捏后 ${after[k]!.p90.toFixed(3)}</text>` })
writeFileSync('face3d/viewer/ref-shell/sculpt-to-model.svg', svg + '</svg>')
