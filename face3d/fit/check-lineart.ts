// Check a generated line drawing against the exact-angle render it was made from (dot 1792513207: the generated line
// art may change direction and perspective; it is not calibrated by being made from a calibrated render). Inputs: the
// render cell and the drawing as 24-bit BMP (sips -s format bmp), same pixel size expected (else the drawing is scaled
// to the render's size and the scale is reported). Output: an overlay BMP (render faded, the drawing's dark pixels red,
// the render's mesh-contour preview blue) and numbers: how far the render's outer contour is from the drawing's lines
// (each contour sample to the nearest dark pixel), median and 90th percentile, in head-ball radii.
// Run: npx vite-node face3d/fit/check-lineart.ts <render.bmp> <drawing.bmp> <out.bmp> [yaw] [pitch]
import { readFileSync, writeFileSync } from 'node:fs'
import { contourSegments, loadVrmHead, rasterHead } from '../mesh/vrmhead'

const [renderF, drawF, outF, yawA, pitchA] = process.argv.slice(2)
const readBmp = (f: string) => {
  const b = readFileSync(f), off = b.readUInt32LE(10), W = b.readInt32LE(18), Hs = b.readInt32LE(22), H = Math.abs(Hs), bpp = b.readUInt16LE(28), row = Math.ceil((W * bpp) / 32) * 4
  const px = (x: number, y: number) => { const yy = Hs < 0 ? y : H - 1 - y, i = off + yy * row + (x * bpp) / 8; return [b[i + 2]!, b[i + 1]!, b[i]!] }
  return { W, H, px }
}
const R = readBmp(renderF!), D = readBmp(drawF!), C = R.W, S = 120, cx = C / 2, cy = C * 0.46
const k = D.W / R.W // drawing px per render px
const dark: boolean[] = []
for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const [r, g, b] = D.px(Math.min(D.W - 1, Math.round(x * k)), Math.min(D.H - 1, Math.round(y * k))); dark.push(0.299 * r + 0.587 * g + 0.114 * b < 110) }
// the render's contour, recomputed for this view
const vb = readFileSync('face3d/fit/ref/test.vrm'), data = loadVrmHead(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength))
const f = { W: C, H: C, S, cx, cy }, img = new Uint8ClampedArray(C * C * 4).fill(255), view = { yaw: Number(yawA ?? 0), pitch: Number(pitchA ?? 0) }
const segs = contourSegments(data, f, rasterHead(data, view, f, img))
// distance from contour samples to the nearest dark pixel (searched within 40 px)
const dists: number[] = []
for (const [x0, y0, x1, y1] of segs) for (const t of [0, 0.5]) {
  const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t)
  let best = 40
  for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < C && Y < C && dark[Y * C + X]) best = Math.min(best, Math.hypot(dx, dy)) }
  dists.push(best)
}
dists.sort((a, b) => a - b)
const q = (p: number) => dists[Math.floor(p * (dists.length - 1))]! / S
// overlay
const out = Buffer.alloc(54 + Math.ceil((C * 3) / 4) * 4 * C), row = Math.ceil((C * 3) / 4) * 4
out.write('BM', 0); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14); out.writeInt32LE(C, 18); out.writeInt32LE(-C, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * C, 34)
for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
  const [r, g, b] = R.px(x, y), o = 54 + y * row + 3 * x, fade = (v: number) => 255 - (255 - v) * 0.35
  let c = [fade(r), fade(g), fade(b)]
  if (dark[y * C + x]) c = [220, 30, 30]
  out[o] = c[2]!; out[o + 1] = c[1]!; out[o + 2] = c[0]!
}
for (const [x0, y0, x1, y1] of segs) for (let i = 0; i <= 8; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / 8), y = Math.round(y0 + ((y1 - y0) * i) / 8); if (x >= 0 && y >= 0 && x < C && y < C) { const o = 54 + y * row + 3 * x; out[o] = 200; out[o + 1] = 90; out[o + 2] = 20 } }
writeFileSync(outF!, out)
console.log(JSON.stringify({ view, drawingScale: k, contourSamples: dists.length, medianR: +q(0.5).toFixed(3), p90R: +q(0.9).toFixed(3), farOver40px: dists.filter(d => d >= 40).length }))
