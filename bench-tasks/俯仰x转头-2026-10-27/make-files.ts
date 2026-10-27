// 俯仰 × 转头 hand-tuning files (bowen 1793072003 「fit 一下对应大概多少度，然后给我文件去手调位置」). For each of dot's
// pictures (sample 1): a copy of bowen's 0° file (01-正脸 … 耳朵骨线, read only) whose view 0,0 bones are the turn model at the
// angle fitted to that picture (fit-angles.json, clamped to the model's range), with the picture as the visible reference, placed
// by uniform scale + shift only so its eye corners, nose, mouth and chin sit on the model's (least squares). Side face shown.
// New files only: refuses to overwrite. Run: npx vite-node bench-tasks/俯仰x转头-2026-10-27/make-files.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, bez, type ModelData, type Cubic, type V, type Frame } from '../../face3d/turnmodel/index'

const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..'), OUTDIR = join(REPO, '脸轮廓手调')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const BASE = JSON.parse(readFileSync(join(OUTDIR, '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json'), 'utf8'))
const FIT = JSON.parse(readFileSync(join(H, 'fit-angles.json'), 'utf8')) as Record<string, { yaw: number; pitch: number; rms_px: number }>
const LM = JSON.parse(readFileSync(join(H, 'landmarks.json'), 'utf8')) as Record<string, Record<string, V>>
const ORDER = ['up45-yaw0', 'up45-yaw30', 'up45-yaw60', 'up45-yaw75', 'up45-yaw90', 'zero-yaw0', 'zero-yaw30', 'zero-yaw60', 'zero-yaw75', 'zero-yaw90', 'down45-yaw0', 'down45-yaw30', 'down45-yaw60', 'down45-yaw75', 'down45-yaw90']
const LABEL: Record<string, string> = { up45: '仰45', zero: '平视', down45: '俯45' }

const OUTLINE: Record<string, string> = { farJaw: 'lmv3m1am1-3', farCheek: 'lm03-chf', farSkull: 'lm03-skf', nearJaw: 'cmv3m1am1-6/lmv3m1am1-3', nearSkull: 'lm03-skb' }
const SIDE = ['lmv6kklw1-4', 'lmv6kklw1-6', 'lmv6kklw1-8', 'lmv6kklw1-10', 'lmv6kklw1-12', 'lmv6kklw1-13'] // side1 … side6
const EYE = { near: ['ley-R-0', 'ley-R-1', 'ley-R-2'], far: ['ley-L-0', 'ley-L-1', 'ley-L-2'] } // upper, lowerIn, lowerOut
const EAR = ['lear-R-1', 'lear-R-2']

/** One cubic through the samples (equal steps of t), ends fixed: the two inner controls by least squares. */
function fitCubic(q: V[]): Cubic {
  const n = q.length - 1, P0 = q[0]!, P3 = q[n]!
  let a11 = 0, a12 = 0, a22 = 0; const r1: V = [0, 0], r2: V = [0, 0]
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t
    a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (const k of [0, 1] as const) { const r = q[i]![k] - b0 * P0[k] - b3 * P3[k]; r1[k] += b1 * r; r2[k] += b2 * r }
  }
  const det = a11 * a22 - a12 * a12, P1: V = [0, 0], P2: V = [0, 0]
  for (const k of [0, 1] as const) { P1[k] = (r1[k] * a22 - r2[k] * a12) / det; P2[k] = (a11 * r2[k] - a12 * r1[k]) / det }
  return [P0, P1, P2, P3]
}

function place(f: Frame, lm: Record<string, V>) {
  // the model's positions of the read landmarks (no iris in the model)
  const ne = f.eyes.near[0]!.pts, fe = f.eyes.far[0]!.pts, p = f.points
  const MP: Record<string, V> = { nI: ne[0]!, nO: ne[ne.length - 1]!, fI: fe[0]!, fO: fe[fe.length - 1]!, nose: p.noseTip!, mouth: [(p.lipUp![0] + p.lipLow![0]) / 2, (p.lipUp![1] + p.lipLow![1]) / 2], chin: p.chin! }
  const ks = Object.keys(lm).filter(k => MP[k])
  const mean = (vs: V[]): V => [vs.reduce((a, v) => a + v[0], 0) / vs.length, vs.reduce((a, v) => a + v[1], 0) / vs.length]
  const mu = mean(ks.map(k => lm[k]!)), mm = mean(ks.map(k => MP[k]!))
  // model = a·picture + b (uniform scale, no turn)
  let num = 0, den = 0
  for (const k of ks) { const u = lm[k]!, m = MP[k]!; num += (u[0] - mu[0]) * (m[0] - mm[0]) + (u[1] - mu[1]) * (m[1] - mm[1]); den += (u[0] - mu[0]) ** 2 + (u[1] - mu[1]) ** 2 }
  const a = num / den, b: V = [mm[0] - a * mu[0], mm[1] - a * mu[1]]
  const err = Math.sqrt(ks.reduce((s, k) => s + (a * lm[k]![0] + b[0] - MP[k]![0]) ** 2 + (a * lm[k]![1] + b[1] - MP[k]![1]) ** 2, 0) / ks.length)
  return { a, b, err, used: ks }
}

const rows: string[] = []
ORDER.forEach((name, i) => {
  const fit = FIT[name]!, yaw = Math.max(0, Math.min(90, fit.yaw)), pitch = Math.max(-45, Math.min(45, fit.pitch)) // dot's heads all turn right: a fitted −1° is 0
  const f = evaluate(M, yaw, undefined, pitch)
  const d = structuredClone(BASE), net = d.document.network, v = net.shapes.layers.find((l: { key: string }) => l.key === 'view:0,0')
  const lineById = Object.fromEntries(net.lines.map((l: { id: string }) => [l.id, l]))
  const setLine = (id: string, c: Cubic) => {
    const l = lineById[id]; if (!l) throw Error('no line ' + id)
    v.points[l.a] = { x: c[0][0], y: c[0][1] }; v.points[l.b] = { x: c[3][0], y: c[3][1] }
    v.lines[id] = { ...v.lines[id], ha: { x: c[1][0] - c[0][0], y: c[1][1] - c[0][1] }, hb: { x: c[2][0] - c[3][0], y: c[2][1] - c[3][1] } }
  }
  for (const l of f.outline) setLine(OUTLINE[l.name]!, l.c)
  f.side.forEach((l, k) => { setLine(SIDE[k]!, l.c); lineById[SIDE[k]!].state.visible = true })
  for (const side of ['near', 'far'] as const) f.eyes[side].forEach((e, k) => setLine(EYE[side][k]!, fitCubic(e.pts)))
  f.ears.near.forEach((l, k) => setLine(EAR[k]!, l.c))
  // the picture: uniform scale + shift (never deformed)
  const W = 1254, pl = place(f, LM[name]!), pic = readFileSync(join(H, 'pics', name + '-1.png')).toString('base64')
  const r = d.document.reference
  for (const im of r.images) im.visible = false
  const [key, yawLabel] = name.split('-'), title = `${LABEL[key!]} ${yawLabel!.replace('yaw', '转')}（dot 生成，拟合 转 ${fit.yaw}° 俯仰 ${fit.pitch > 0 ? '仰' : '俯'}${Math.abs(fit.pitch)}°）`
  r.library.push({ id: 'ref-' + name, name: title, src: 'data:image/png;base64,' + pic, width: W, height: W })
  r.images.push({ id: 'img-' + name, view: 'view:0,0', asset: 'ref-' + name, width: W, height: W, x: pl.a * W / 2 + pl.b[0], y: pl.a * W / 2 + pl.b[1], scale: pl.a, angle: 0, opacity: 0.85, visible: true, flipped: false, slots: [] })
  d.bench = { onLine: { 'pear-R-up': ['lm03-skb'], 'pear-R-low': ['cmv3m1am1-6/lmv3m1am1-3'] } }
  const fname = `${20 + i}-${LABEL[key!]}${yawLabel!.replace('yaw', '转')}-拟合yaw${yaw}pitch${pitch}.近2远3.耳朵骨线.json`
  if (existsSync(join(OUTDIR, fname))) throw Error('exists ' + fname)
  writeFileSync(join(OUTDIR, fname), JSON.stringify(d))
  rows.push(`${fname}\t对齐误差 ${pl.err.toFixed(1)}（点 ${pl.used.join(' ')}）`)
})
console.log(rows.join('\n'))
