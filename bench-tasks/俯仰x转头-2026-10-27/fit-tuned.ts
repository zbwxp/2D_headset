// The real angle of each hand-tuned picture (bowen 1793073426: 「参考图自身是自洽的…眼睛应该可以辅助反推出真正的参考图角度，
// 广谱的 fit」). bowen's tuned bones are the answer; the turn model is tried at every turn 0–90 and pitch −45…45 (1°, then 0.25°
// around the best), each time with the uniform scale + shift that fits best (the picture was placed by the old angle). Two
// fits: the eyes alone, and eyes + outline + ear (the side face is left out: bowen did not edit it, it still shows the old angle).
// Run: npx vite-node …/fit-tuned.ts <file in 脸轮廓手调/> …  → fit-tuned.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, bez, type ModelData, type V, type Cubic, type Frame } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const OUTLINE: Record<string, string> = { farJaw: 'lmv3m1am1-3', farCheek: 'lm03-chf', farSkull: 'lm03-skf', nearJaw: 'cmv3m1am1-6/lmv3m1am1-3', nearSkull: 'lm03-skb' }
const EYE = { near: ['ley-R-0', 'ley-R-1', 'ley-R-2'], far: ['ley-L-0', 'ley-L-1', 'ley-L-2'] }, EAR = ['lear-R-1', 'lear-R-2']
const T = Array.from({ length: 11 }, (_, i) => i / 10)

function fileCubics(file: string) {
  const d = JSON.parse(readFileSync(join(REPO, '脸轮廓手调', file), 'utf8')), net = d.document.network, v = net.shapes.layers.find((l: { key: string }) => l.key === 'view:0,0')
  const c: Record<string, Cubic> = {}
  for (const l of net.lines) { const s = v.lines[l.id], a = v.points[l.a], b = v.points[l.b]; if (s && a && b) c[l.id] = [[a.x, a.y], [a.x + s.ha.x, a.y + s.ha.y], [b.x + s.hb.x, b.y + s.hb.y], [b.x, b.y]] }
  return c
}
/** Matching samples: [model point, bowen point], for the chosen parts. */
function pairs(f: Frame, c: Record<string, Cubic>, parts: ('eyes' | 'outline' | 'ear')[]): [V, V][] {
  const out: [V, V][] = []
  if (parts.includes('eyes')) for (const side of ['near', 'far'] as const) f.eyes[side].forEach((e, k) => { const n = e.pts.length - 1; for (const t of T) out.push([e.pts[Math.round(t * n)]!, bez(c[EYE[side][k]!]!, t)]) })
  if (parts.includes('outline')) for (const l of f.outline) for (const t of T) out.push([bez(l.c, t), bez(c[OUTLINE[l.name]!]!, t)])
  if (parts.includes('ear')) f.ears.near.forEach((l, k) => { for (const t of T) out.push([bez(l.c, t), bez(c[EAR[k]!]!, t)]) })
  return out
}
/** bowen ≈ s·model + t: the best s, t and the rms left. */
function similarity(ps: [V, V][]) {
  const n = ps.length, mm = [0, 0], mb = [0, 0]
  for (const [m, b] of ps) { mm[0] += m[0] / n; mm[1] += m[1] / n; mb[0] += b[0] / n; mb[1] += b[1] / n }
  let num = 0, den = 0
  for (const [m, b] of ps) { num += (m[0] - mm[0]) * (b[0] - mb[0]) + (m[1] - mm[1]) * (b[1] - mb[1]); den += (m[0] - mm[0]) ** 2 + (m[1] - mm[1]) ** 2 }
  const s = num / den, t = [mb[0] - s * mm[0], mb[1] - s * mm[1]]
  const rms = Math.sqrt(ps.reduce((a, [m, b]) => a + (s * m[0] + t[0] - b[0]) ** 2 + (s * m[1] + t[1] - b[1]) ** 2, 0) / n)
  return { s, t, rms }
}
function search(c: Record<string, Cubic>, parts: ('eyes' | 'outline' | 'ear')[]) {
  let best = { yaw: 0, pitch: 0, rms: Infinity, s: 1 }
  const tryAt = (yaw: number, pitch: number) => {
    if (yaw < 0 || yaw > 90 || pitch < -45 || pitch > 45) return
    let f: Frame; try { f = evaluate(M, yaw, undefined, pitch) } catch { return }
    const r = similarity(pairs(f, c, parts)); if (r.rms < best.rms) best = { yaw, pitch, rms: r.rms, s: r.s }
  }
  for (let y = 0; y <= 90; y += 1) for (let p = -45; p <= 45; p += 1) tryAt(y, p)
  const b0 = { ...best }
  for (let y = b0.yaw - 1; y <= b0.yaw + 1; y += 0.25) for (let p = b0.pitch - 1; p <= b0.pitch + 1; p += 0.25) tryAt(y, p)
  return best
}
const OUT = join(H, 'fit-tuned.json'), res: Record<string, unknown> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
for (const file of process.argv.slice(2)) {
  const c = fileCubics(file), e = search(c, ['eyes']), a = search(c, ['eyes', 'outline', 'ear'])
  // the eyes' angle, then how far each part stays from bowen there
  const f = evaluate(M, e.yaw, undefined, e.pitch), sim = similarity(pairs(f, c, ['eyes']))
  const left = Object.fromEntries((['eyes', 'outline', 'ear'] as const).map(part => { const ps = pairs(f, c, [part]); return [part, +Math.sqrt(ps.reduce((acc, [m, b]) => acc + (sim.s * m[0] + sim.t[0] - b[0]) ** 2 + (sim.s * m[1] + sim.t[1] - b[1]) ** 2, 0) / ps.length).toFixed(2)] }))
  res[file] = { eyes: { yaw: e.yaw, pitch: e.pitch, rms: +e.rms.toFixed(2), scale: +e.s.toFixed(3) }, all: { yaw: a.yaw, pitch: a.pitch, rms: +a.rms.toFixed(2), scale: +a.s.toFixed(3) }, atEyeAngle: left }
  console.log(`${file}\n  只看眼睛: 转 ${e.yaw}° 俯仰 ${e.pitch}° (误差 ${e.rms.toFixed(2)}, 缩放 ${e.s.toFixed(3)})\n  眼+轮廓+耳: 转 ${a.yaw}° 俯仰 ${a.pitch}° (误差 ${a.rms.toFixed(2)})\n  眼睛角度下各部分误差: ${JSON.stringify(left)}`)
}
writeFileSync(OUT, JSON.stringify(res, null, 1))
