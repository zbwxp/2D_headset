// bowen's tuned 21 / 31 as turn-and-pitch keyframes (bowen 1793073663). Each at the angle fitted to his bones (fit-tuned.json,
// eyes + outline + ear); his bones brought into the model's frame by that fit's uniform scale + shift; stored as how far they
// are from the rules there (index.ts PitchCorner). Reads the archived first versions (手调记录). Writes
// bench-tasks/转头模型/sources/pitch-corners.json. Run: npx vite-node …/build-corners.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, bez, type ModelData, type V, type Cubic, type PitchCorner } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
delete M.pitch.corners // the rules alone
const FIT = JSON.parse(readFileSync(join(H, 'fit-tuned.json'), 'utf8')) as Record<string, { all: { yaw: number; pitch: number } }>
const OUTLINE: Record<string, string> = { farJaw: 'lmv3m1am1-3', farCheek: 'lm03-chf', farSkull: 'lm03-skf', nearJaw: 'cmv3m1am1-6/lmv3m1am1-3', nearSkull: 'lm03-skb' }
const EYE = { near: ['ley-R-0', 'ley-R-1', 'ley-R-2'], far: ['ley-L-0', 'ley-L-1', 'ley-L-2'] }, EAR: Record<string, string> = { upper: 'lear-R-1', lower: 'lear-R-2' }
const FILES = ['21-仰45转30-拟合yaw38.5pitch13.近2远3.耳朵骨线.json', '31-俯45转30-拟合yaw30pitch-38.5.近2远3.耳朵骨线.json']

const corners: PitchCorner[] = FILES.map(file => {
  const d = JSON.parse(readFileSync(join(H, '手调记录', file.replace('.json', '.第1版.json')), 'utf8')), net = d.document.network
  const v = net.shapes.layers.find((l: { key: string }) => l.key === 'view:0,0'), c: Record<string, Cubic> = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]] }
  const { yaw, pitch } = FIT[file]!.all, f = evaluate(M, yaw, undefined, pitch)
  // the fit's scale + shift (bowen ≈ s·model + t) over the same samples fit-tuned.ts used
  const T = Array.from({ length: 11 }, (_, i) => i / 10), ps: [V, V][] = []
  for (const side of ['near', 'far'] as const) f.eyes[side].forEach((e, k) => { const n = e.pts.length - 1; for (const t of T) ps.push([e.pts[Math.round(t * n)]!, bez(c[EYE[side][k]!]!, t)]) })
  for (const l of f.outline) for (const t of T) ps.push([bez(l.c, t), bez(c[OUTLINE[l.name]!]!, t)])
  f.ears.near.forEach(l => { for (const t of T) ps.push([bez(l.c, t), bez(c[EAR[l.name]!]!, t)]) })
  const n = ps.length, mm = [0, 0], mb = [0, 0]
  for (const [m, b] of ps) { mm[0] += m[0] / n; mm[1] += m[1] / n; mb[0] += b[0] / n; mb[1] += b[1] / n }
  let num = 0, den = 0
  for (const [m, b] of ps) { num += (m[0] - mm[0]) * (b[0] - mb[0]) + (m[1] - mm[1]) * (b[1] - mb[1]); den += (m[0] - mm[0]) ** 2 + (m[1] - mm[1]) ** 2 }
  const s = num / den, t: V = [mb[0] - s * mm[0], mb[1] - s * mm[1]], toModel = (q: V): V => [(q[0] - t[0]) / s, (q[1] - t[1]) / s]
  const r = (q: V): V => [+q[0].toFixed(4), +q[1].toFixed(4)], dl = (bc: Cubic, mc: Cubic) => bc.map((q, j) => { const b = toModel(q); return r([b[0] - mc[j]![0], b[1] - mc[j]![1]]) }) as [V, V, V, V]
  const lines: Record<string, [V, V, V, V]> = {}
  for (const l of f.outline) lines['outline:' + l.name] = dl(c[OUTLINE[l.name]!]!, l.c)
  for (const l of f.ears.near) lines['ear:' + l.name] = dl(c[EAR[l.name]!]!, l.c)
  const eyes = { near: [] as V[][], far: [] as V[][] }
  for (const side of ['near', 'far'] as const) f.eyes[side].forEach((e, k) => { const N = e.pts.length - 1; eyes[side].push(e.pts.map((q, i) => { const b = toModel(bez(c[EYE[side][k]!]!, i / N)); return r([b[0] - q[0], b[1] - q[1]]) })) })
  console.log(file, 'at', yaw, pitch, 'scale', s.toFixed(3))
  return { yaw, pitch, source: `bowen's ${file} (第1版), angle by fit-tuned.ts (eyes + outline + ear), his bones / ${s.toFixed(4)} − shift`, lines, eyes }
})
writeFileSync(join(REPO, 'bench-tasks/转头模型/sources/pitch-corners.json'), JSON.stringify({ note: 'turn-and-pitch keyframes from bowen\'s tuned files; built by bench-tasks/俯仰x转头-2026-10-27/build-corners.ts', corners }, null, 1))
