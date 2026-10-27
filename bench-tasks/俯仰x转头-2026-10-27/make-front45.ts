// Two hand-tuning files for the front view at pitch ±45 (bowen 1793074461 「1」): a copy of bowen's 0° file whose view 0,0 bones
// are the turn model with the derived front ±45 (withDerivedPitch: heights from the side view turned 45°, across from the pitch-0
// front view; eyes on the shared sphere so they keep their shape) — v2 after bowen 1793074838: moving only the points and keeping the
// old handles twisted the shapes. The heights are drawn as guides on a transparent picture placed as the reference
// (uniform scale, no deformation): one colour per height, listed in GUIDES. New files only. Run: npx vite-node …/make-front45.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'
import { evaluate, withDerivedPitch, type ModelData, type Cubic, type V } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..'), OUTDIR = join(REPO, '脸轮廓手调')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const BASE = JSON.parse(readFileSync(join(OUTDIR, '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json'), 'utf8'))
const D = JSON.parse(readFileSync(join(H, 'derive-front.json'), 'utf8')).heights as Record<string, Record<string, number>>
const OUTLINE: Record<string, string> = { farJaw: 'lmv3m1am1-3', farCheek: 'lm03-chf', farSkull: 'lm03-skf', nearJaw: 'cmv3m1am1-6/lmv3m1am1-3', nearSkull: 'lm03-skb' }
const SIDE = ['lmv6kklw1-4', 'lmv6kklw1-6', 'lmv6kklw1-8', 'lmv6kklw1-10', 'lmv6kklw1-12', 'lmv6kklw1-13']
const EYE = { near: ['ley-R-0', 'ley-R-1', 'ley-R-2'], far: ['ley-L-0', 'ley-L-1', 'ley-L-2'] }, EAR = ['lear-R-1', 'lear-R-2']
/** One cubic through the samples (equal steps of t), ends fixed: the inner controls by least squares. */
function fitCubic(q: V[]): Cubic {
  const n = q.length - 1, P0 = q[0]!, P3 = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1: V = [0, 0], r2: V = [0, 0]
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (const k of [0, 1] as const) { const r = q[i]![k] - b0 * P0[k] - b3 * P3[k]; r1[k] += b1 * r; r2[k] += b2 * r } }
  const det = a11 * a22 - a12 * a12, P1: V = [0, 0], P2: V = [0, 0]
  for (const k of [0, 1] as const) { P1[k] = (r1[k] * a22 - r2[k] * a12) / det; P2[k] = (a11 * r2[k] - a12 * r1[k]) / det }
  return [P0, P1, P2, P3]
}
export const GUIDES: [string, string, [number, number, number]][] = [['top', '头顶', [128, 0, 200]], ['brow', '眉', [120, 120, 120]], ['eyeIn', '内眼角', [0, 90, 220]], ['eyeOut', '外眼角', [0, 170, 255]],
  ['nose', '鼻尖', [230, 120, 0]], ['lipUp', '上唇', [220, 0, 80]], ['lipLow', '下唇', [255, 110, 160]], ['chin', '下巴', [0, 150, 60]], ['earUp', '上耳点', [150, 90, 40]], ['earTip', '耳尖', [200, 160, 0]], ['earLow', '下耳点', [90, 60, 20]], ['zyg', '颧骨点', [60, 60, 60]]]

/** A transparent PNG: dashed horizontal lines at the given canvas heights. */
function guidePng(heights: [number, [number, number, number]][], x0: number, x1: number, y0: number, y1: number, ppu: number): { png: Buffer; w: number; h: number } {
  const w = Math.round((x1 - x0) * ppu), h = Math.round((y1 - y0) * ppu), px = Buffer.alloc(w * h * 4)
  for (const [y, col] of heights) { const row = Math.round((y - y0) * ppu); for (let dy = -1; dy <= 1; dy++) { const r = row + dy; if (r < 0 || r >= h) continue
    for (let x = 0; x < w; x++) if (Math.floor(x / 12) % 3 !== 2) { const i = 4 * (r * w + x); px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 230 } } }
  const raw = Buffer.alloc(h * (w * 4 + 1)); for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return { png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]), w, h }
}

const f0 = evaluate(M, 0)
for (const [pt, key, n] of [[45, '仰45', 35], [-45, '俯45', 36]] as const) {
  const h = D[key]!, f = evaluate(M, 0, undefined, pt)
  const d = structuredClone(BASE), net = d.document.network, v = net.shapes.layers.find((l: { key: string }) => l.key === 'view:0,0')
  const lineById = Object.fromEntries(net.lines.map((l: { id: string }) => [l.id, l]))
  const setLine = (id: string, c: Cubic) => { const l = lineById[id]; v.points[l.a] = { x: c[0][0], y: c[0][1] }; v.points[l.b] = { x: c[3][0], y: c[3][1] }; v.lines[id] = { ...v.lines[id], ha: { x: c[1][0] - c[0][0], y: c[1][1] - c[0][1] }, hb: { x: c[2][0] - c[3][0], y: c[2][1] - c[3][1] } } }
  const MD = withDerivedPitch(M), g0 = evaluate(MD, 0, undefined, pt)
  for (const l of g0.outline) setLine(OUTLINE[l.name]!, l.c)
  g0.side.forEach((l, k) => { setLine(SIDE[k]!, l.c); lineById[SIDE[k]!].state.visible = true })
  for (const side of ['near', 'far'] as const) g0.eyes[side].forEach((e, k) => setLine(EYE[side][k]!, fitCubic(e.pts)))
  g0.ears.near.forEach((l, k) => setLine(EAR[k]!, l.c))
  void f; void f0
  // the guides as the reference picture (canvas x −110…110, y −110…110, 4 px per unit)
  const X0 = -110, X1 = 110, Y0 = -110, Y1 = 110, PPU = 4, g = guidePng(GUIDES.map(([k, , c]) => [h[k]!, c]), X0, X1, Y0, Y1, PPU)
  const r = d.document.reference; for (const im of r.images) im.visible = false
  r.library.push({ id: 'ref-guides-' + key, name: `正脸${key} 推导高度线（侧面转45°）`, src: 'data:image/png;base64,' + g.png.toString('base64'), width: g.w, height: g.h })
  r.images.push({ id: 'img-guides-' + key, view: 'view:0,0', asset: 'ref-guides-' + key, width: g.w, height: g.h, x: (X0 + X1) / 2, y: (Y0 + Y1) / 2, scale: 1 / PPU, angle: 0, opacity: 0.9, visible: true, flipped: false, slots: [] })
  d.bench = { onLine: { 'pear-R-up': ['lm03-skb'], 'pear-R-low': ['cmv3m1am1-6/lmv3m1am1-3'] } }
  const fname = `${n}-正脸${key}-推导-yaw0pitch${pt}.近2远3.耳朵骨线.json`
  if (existsSync(join(OUTDIR, fname))) throw Error('exists ' + fname)
  writeFileSync(join(OUTDIR, fname), JSON.stringify(d)); console.log(fname)
}
