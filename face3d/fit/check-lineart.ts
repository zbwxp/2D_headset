// Check a generated line drawing against the exact-angle render it was made from (dot 1792513207: the generated line
// art may change direction and perspective; it is not calibrated by being made from a calibrated render). Inputs: the
// render cell and the drawing as 24-bit BMP (sips -s format bmp), same pixel size expected (else the drawing is scaled
// to the render's size and the scale is reported). Output: an overlay BMP (render faded, the drawing's dark pixels red,
// the render's mesh-contour preview blue) and numbers: how far the render's outer contour is from the drawing's lines
// (each contour sample to the nearest dark pixel), median and 90th percentile, in head-ball radii.
// Registration (bowen 1792513593: the first overlay was not aligned — the generator does not keep the render's framing):
// a scale and shift of the drawing, found by matching the render's LOWER-face contour (below the eyes: jaw, cheeks,
// chin — no hair there) to the drawing's dark pixels (a distance transform of the drawing, grid search), reported.
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
const k0 = D.W / R.W // drawing px per render px, before registration
// the drawing's dark pixels and their distance transform (two-pass chamfer, drawing px)
const DW = D.W, DH = D.H, dt = new Float32Array(DW * DH)
for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const [r, g, b] = D.px(x, y); dt[y * DW + x] = 0.299 * r + 0.587 * g + 0.114 * b < 110 ? 0 : 1e9 }
for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const i = y * DW + x; if (x > 0) dt[i] = Math.min(dt[i]!, dt[i - 1]! + 1); if (y > 0) dt[i] = Math.min(dt[i]!, dt[i - DW]! + 1); if (x > 0 && y > 0) dt[i] = Math.min(dt[i]!, dt[i - DW - 1]! + 1.414); if (x < DW - 1 && y > 0) dt[i] = Math.min(dt[i]!, dt[i - DW + 1]! + 1.414) }
for (let y = DH - 1; y >= 0; y--) for (let x = DW - 1; x >= 0; x--) { const i = y * DW + x; if (x < DW - 1) dt[i] = Math.min(dt[i]!, dt[i + 1]! + 1); if (y < DH - 1) dt[i] = Math.min(dt[i]!, dt[i + DW]! + 1); if (x < DW - 1 && y < DH - 1) dt[i] = Math.min(dt[i]!, dt[i + DW + 1]! + 1.414); if (x > 0 && y < DH - 1) dt[i] = Math.min(dt[i]!, dt[i + DW - 1]! + 1.414) }
const dtAt = (x: number, y: number) => { const X = Math.round(x), Y = Math.round(y); return X < 0 || Y < 0 || X >= DW || Y >= DH ? 200 : Math.min(200, dt[Y * DW + X]!) }
// the render's contour, recomputed for this view
const vb = readFileSync('face3d/fit/ref/test.vrm'), data = loadVrmHead(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength))
const f = { W: C, H: C, S, cx, cy }, img = new Uint8ClampedArray(C * C * 4).fill(255), view = { yaw: Number(yawA ?? 0), pitch: Number(pitchA ?? 0) }
const segs = contourSegments(data, f, rasterHead(data, view, f, img))
// registration: render px p → drawing px (p − c)·k·s + c·k + (dx, dy)·k, with c the head-ball centre
const lower: [number, number][] = []
for (const [x0, y0, x1, y1] of segs) for (const t of [0, 0.5]) { const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; if (y > cy + 0.3 * S) lower.push([x, y]) }
const map = (x: number, y: number, sc: number, dx: number, dy: number): [number, number] => [((x - cx) * sc + cx + dx) * k0, ((y - cy) * sc + cy + dy) * k0]
let reg = { sc: 1, dx: 0, dy: 0, c: Infinity }
for (const [range, step, srange, sstep] of [[40, 4, 0.2, 0.02], [5, 1, 0.025, 0.005]] as const) {
  const c0 = { ...reg }
  for (let sc = (c0.c === Infinity ? 1 : c0.sc) - srange; sc <= (c0.c === Infinity ? 1 : c0.sc) + srange + 1e-9; sc += sstep) for (let dx = (c0.c === Infinity ? 0 : c0.dx) - range; dx <= (c0.c === Infinity ? 0 : c0.dx) + range; dx += step) for (let dy = (c0.c === Infinity ? 0 : c0.dy) - range; dy <= (c0.c === Infinity ? 0 : c0.dy) + range; dy += step) {
    let c = 0; for (const [x, y] of lower) { const [X, Y] = map(x, y, sc, dx, dy); c += dtAt(X, Y) }
    if (c < reg.c) reg = { sc, dx, dy, c }
  }
}
// dark pixels in render coordinates after registration
const dark: boolean[] = []
for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const [X, Y] = map(x, y, reg.sc, reg.dx, reg.dy); dark.push(dtAt(X, Y) < 0.5) }
const k = k0 * reg.sc
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
console.log(JSON.stringify({ view, registration: { scale: +reg.sc.toFixed(3), shiftPx: [reg.dx, reg.dy], lowerFaceMeanPx: +(reg.c / lower.length / k0).toFixed(2) }, drawingScale: +k.toFixed(3), contourSamples: dists.length, medianR: +q(0.5).toFixed(3), p90R: +q(0.9).toFixed(3), farOver40px: dists.filter(d => d >= 40).length }))
