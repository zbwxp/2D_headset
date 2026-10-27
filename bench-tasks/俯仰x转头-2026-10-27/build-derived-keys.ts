// The derived front ±45 as pitch keys (bowen 1793074773: show it in the turn model). Points: height from derive-front.json (the
// side view turned 45°), across from bowen's pitch-0 key. The near outline point is the ear root (far back on the head), the far
// one the 颧骨点 (in front). The front view is left-right symmetric, so both take the ear root's height (the jaw corner seen
// front-on sits at the ear, not at the cheek's front); the outline's shape stays his to tune.
// Handles: his pitch-0 key's (the shape is his to tune). Eyes: the shared sphere's turn, scale and shift fitted to the derived eye
// corners and lower-lid points. Writes bench-tasks/转头模型/sources/pitch-derived.json. Run: npx vite-node …/build-derived-keys.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, params, type ModelData, type V } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const D = JSON.parse(readFileSync(join(H, 'derive-front.json'), 'utf8')).heights as Record<string, Record<string, number>>
const k0 = M.pitch.keys.find(k => k.pitch === 0)!, f0 = evaluate(M, 0), E = M.pitch.eyes, P = params(M)
const keys = [-45, 0, 45].map(pitch => {
  if (pitch === 0) return { ...k0, pts: { ...k0.pts, brow: [0, M.sheet.pts.brow![1]], noseTip: [0, M.sheet.pts.noseTip![1]], lipUp: [0, M.sheet.pts.lipUp![1]], lipLow: [0, M.sheet.pts.lipLow![1]] } as Record<string, V> }
  const h = D[pitch > 0 ? '仰45' : '俯45']!, x = (n: string) => k0.pts[n]![0]
  return { pitch, pts: { crown: [x('crown'), h.top!], chin: [x('chin'), h.chin!], nearRoot: [-x('zyg'), h.nearRoot!], zyg: [x('zyg'), h.nearRoot!], temple: [x('temple'), h.nearRoot! - ((k0.pts.zyg![1] - k0.pts.temple![1]) / (k0.pts.zyg![1] - k0.pts.crown![1])) * (h.nearRoot! - h.top!)], // the near side has no 太阳穴点: the far one keeps its 0° place between the jaw corner and the head top (symmetric)
    // the ear points are moved by key − pitch-0 key from the model's own heights (earUp / earLow, the tip from the plate):
    // the keys are set so the model lands on the derived heights
    earUp: [x('earUp'), k0.pts.earUp![1] + h.earUp! - P.earUp], earLow: [x('earLow'), k0.pts.earLow![1] + h.earLow! - P.earLow],
    earTip: [x('earTip'), k0.pts.earTip![1] + (h.earUp! - P.earUp) + (h.earTip! - h.earUp! - (M.ear.tip[1] - M.ear.up[1]))],
    // the side face's points on the midline (they move only when every key carries them)
    brow: [0, h.brow!], noseTip: [0, h.nose!], lipUp: [0, h.lipUp!], lipLow: [0, h.lipLow!] } as Record<string, V>, handles: k0.handles }
})
// eyes: the sphere (centre height and radius as before) turned b, scaled s, moved oy so the 0° eye's corners and lower-lid points land on the
// derived heights while keeping their sideways places
const ne = f0.eyes.near, fe = f0.eyes.far
const src: V[] = [ne[0]!.pts[0]!, ne[0]!.pts[30]!, ne[1]!.pts[30]!, fe[0]!.pts[0]!, fe[0]!.pts[30]!, fe[1]!.pts[30]!]
const eyeKeys = E.keys.map(k => {
  if (k.pitch === 0) return k
  const h = D[k.pitch > 0 ? '仰45' : '俯45']!, dst = [h.eyeIn!, h.eyeOut!, h.eyeMid!, h.eyeIn!, h.eyeOut!, h.eyeMid!]
  const map = (q: V, b: number, s: number, oy: number) => { const qx = q[0], qy = q[1] - E.anchorY, z = Math.sqrt(E.r * E.r - qx * qx - qy * qy); return E.anchorY + oy + s * (Math.cos(b) * qy + Math.sin(b) * (E.r - z)) }
  let best = { e: Infinity, bend: 0, s: 1, oy: 0 }
  for (let bd = -80; bd <= 80; bd += 0.5) for (let s = 0.5; s <= 1.8; s += 0.01) {
    const b = (bd * Math.PI) / 180, ys = src.map(q => map(q, b, s, 0)), oy = dst.reduce((a, v, i) => a + v - ys[i]!, 0) / dst.length
    // heights to the derived ones, and across unchanged (a nod does not move anything sideways; the sphere scales x by s too)
    const e = dst.reduce((a, v, i) => a + (ys[i]! + oy - v) ** 2 + ((s - 1) * src[i]![0]) ** 2, 0); if (e < best.e) best = { e, bend: bd, s: +s.toFixed(2), oy: +oy.toFixed(2) }
  }
  console.log(k.pitch, 'eye sphere', best)
  return { pitch: k.pitch, bend: best.bend, s: best.s, oy: best.oy }
})
writeFileSync(join(REPO, 'bench-tasks/转头模型/sources/pitch-derived.json'), JSON.stringify({ note: 'front ±45 derived from the side view turned 45° (bowen 1793074250); built by bench-tasks/俯仰x转头-2026-10-27/build-derived-keys.ts', keys, eyes: { ...E, keys: eyeKeys } }, null, 1))
