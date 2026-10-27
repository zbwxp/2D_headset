// Two hand-tuning files for the front view at pitch ±45 (bowen 1793074461 「1」): a copy of bowen's 0° file whose view 0,0 bones
// start from the current model there (handles kept) with every named point moved to the derived position (derive-front.json:
// height from the side view turned 45°, across from the pitch-0 front view; the front view stays left-right symmetric, so the near
// outline point mirrors the far 颧骨点). The heights are drawn as guides on a transparent picture placed as the reference
// (uniform scale, no deformation): one colour per height, listed in GUIDES. New files only. Run: npx vite-node …/make-front45.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'
import { evaluate, type ModelData, type Cubic, type V } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..'), OUTDIR = join(REPO, '脸轮廓手调')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const BASE = JSON.parse(readFileSync(join(OUTDIR, '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json'), 'utf8'))
const D = JSON.parse(readFileSync(join(H, 'derive-front.json'), 'utf8')).heights as Record<string, Record<string, number>>
const OUTLINE: Record<string, string> = { farJaw: 'lmv3m1am1-3', farCheek: 'lm03-chf', farSkull: 'lm03-skf', nearJaw: 'cmv3m1am1-6/lmv3m1am1-3', nearSkull: 'lm03-skb' }
const SIDE = ['lmv6kklw1-4', 'lmv6kklw1-6', 'lmv6kklw1-8', 'lmv6kklw1-10', 'lmv6kklw1-12', 'lmv6kklw1-13']
const EAR = ['lear-R-1', 'lear-R-2']
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
  // start: the current model at the front view ±45 (bowen's keys), handles kept below
  for (const l of f.outline) setLine(OUTLINE[l.name]!, l.c)
  f.side.forEach((l, k) => { setLine(SIDE[k]!, l.c); lineById[SIDE[k]!].state.visible = true })
  // eyes: the 0° file's eye handles are kept; their ends move to the derived points below
  f.ears.near.forEach((l, k) => setLine(EAR[k]!, l.c))
  // the derived points: height from the side view, across from the pitch-0 front view
  const at = (id: string, x: number, y: number) => { v.points[id] = { x, y } }, q0 = f0.points, ne = f0.eyes.near, fe = f0.eyes.far
  at('cmv3m1am1-6/pmv3m1am1-4', 0, h.top!); at('pmv6kklw1-11', 0, h.top!); at('cmv3m1am1-6/pmv3m1am1-2', 0, h.chin!); at('pmv6kklw1-2', 0, h.chin!)
  at('pmv3m1am1-1', q0.zyg![0], h.zyg!); at('cmv3m1am1-6/pmv3m1am1-1', -q0.zyg![0], h.zyg!); at('pm03-skf', q0.temple![0], h.temple!)
  at('pmv6kklw1-3', 0, h.lipLow!); at('pmv6kklw1-5', 0, h.lipUp!); at('pmv6kklw1-7', 0, h.nose!); at('pmv6kklw1-9', 0, h.brow!)
  at('pey-R-in', ne[0]!.pts[0]![0], h.eyeIn!); at('pey-R-out', ne[0]!.pts[30]![0], h.eyeOut!); at('pey-R-mid', ne[1]!.pts[30]![0], h.eyeMid!)
  at('pey-L-in', fe[0]!.pts[0]![0], h.eyeIn!); at('pey-L-out', fe[0]!.pts[30]![0], h.eyeOut!); at('pey-L-mid', fe[1]!.pts[30]![0], h.eyeMid!)
  at('pear-R-up', q0.nearEarUp![0], h.earUp!); at('pear-R-tip', q0.nearEarTip![0], h.earTip!); at('pear-R-low', q0.nearEarLow![0], h.earLow!)
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
