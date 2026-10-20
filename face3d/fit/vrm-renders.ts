// Reference renders of bowen's VRoid head at exact angles (bowen 1792512601: "vroid调整到确定角度，截图然后作为参考生成
// 二次元线稿"): yaw 0 / 15 / 30 / 45 / 60 / 75 / 90 × pitch +45 (仰视, top row) / 0 / −45 (俯视) — same 3 × 7 layout as
// full_source (but the face turns to the RIGHT and front is on the LEFT). Every cell: the same scale and centre, the
// head ball (unit circle, centre = the cranium ball) and the cross through its centre drawn faint, so a drawing made on
// top can be checked for position and size. Shaded skin, eyes / brows / mouth as flat colours, the mesh-contour preview.
// Writes <out>.bmp (one sheet) and <out>-<yaw>_<pitch>.bmp per cell. Run: npx vite-node face3d/fit/vrm-renders.ts <vrm> <out>
import { readFileSync, writeFileSync } from 'node:fs'
import { contourSegments, loadVrmHead, rasterHead } from '../mesh/vrmhead'

const [file, out] = process.argv.slice(2)
const b = readFileSync(file!), data = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const YAWS = (process.env.YAWS ?? '0 15 30 45 60 75 90').split(' ').map(Number), PITCHES = (process.env.PITCHES ?? '45 0 -45').split(' ').map(Number), C = 420, S = 120 // cell px, px per head-ball radius

function bmp(W: number, H: number, rgba: Uint8ClampedArray): Buffer {
  const row = Math.ceil((W * 3) / 4) * 4, buf = Buffer.alloc(54 + row * H)
  buf.write('BM', 0); buf.writeUInt32LE(54 + row * H, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(-H, 22)
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * H, 34)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = 4 * (y * W + x), d = 54 + y * row + 3 * x; buf[d] = rgba[s + 2]!; buf[d + 1] = rgba[s + 1]!; buf[d + 2] = rgba[s]! }
  return buf
}
const line = (img: Uint8ClampedArray, W: number, H: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number], w = 1, alpha = 1) => {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n
    for (let dy = -w + 1; dy <= w - 1; dy++) for (let dx = -w + 1; dx <= w - 1; dx++) {
      const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue
      const q = 4 * (Y * W + X); for (let k = 0; k < 3; k++) img[q + k] = img[q + k]! * (1 - alpha) + c[k]! * alpha
    }
  }
}
// NOD=1: pitch is the head nodding (turned about its ear-to-ear axis, + = looking up) BEFORE the yaw turn, as in
// full_source's "upward / downward" rows; default: the camera tilting after the turn (face3d's view convention)
const NOD = !!process.env.NOD
const nodded = (deg: number) => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), R = (v: readonly number[]) => [v[0]!, c * v[1]! - s * v[2]!, s * v[1]! + c * v[2]!] as [number, number, number]
  return { ...data, P: data.P.map(R), N: data.N.map(R), parts: data.parts.map(pt => { const cn = pt.cornerN.slice(); for (let i = 0; i < cn.length; i += 3) if (!Number.isNaN(cn[i]!)) { const r = R([cn[i]!, cn[i + 1]!, cn[i + 2]!]); cn[i] = r[0]; cn[i + 1] = r[1]; cn[i + 2] = r[2] } return { ...pt, cornerN: cn } }) }
}
function cell(yaw: number, pitch: number): Uint8ClampedArray {
  const img = new Uint8ClampedArray(C * C * 4).fill(255), f = { W: C, H: C, S, cx: C / 2, cy: C * 0.46 }
  const d = NOD ? nodded(-pitch) : data, ras = rasterHead(d, NOD ? { yaw, pitch: 0 } : { yaw, pitch }, f, img)
  // the head ball and the cross through its centre (faint, on top so they show through the head); CLEAN=1 leaves them out
  if (!process.env.CLEAN) for (let k = 0; k < 180; k++) { const a0 = (k / 180) * 2 * Math.PI, a1 = ((k + 1) / 180) * 2 * Math.PI; line(img, C, C, f.cx + Math.cos(a0) * S, f.cy + Math.sin(a0) * S, f.cx + Math.cos(a1) * S, f.cy + Math.sin(a1) * S, [230, 60, 160], 1, 0.55) }
  if (!process.env.CLEAN) line(img, C, C, f.cx - 1.6 * S, f.cy, f.cx + 1.6 * S, f.cy, [230, 60, 160], 1, 0.35)
  if (!process.env.CLEAN) line(img, C, C, f.cx, f.cy - 1.6 * S, f.cx, f.cy + 1.7 * S, [230, 60, 160], 1, 0.35)
  for (const [x0, y0, x1, y1] of contourSegments(d, f, ras)) line(img, C, C, x0, y0, x1, y1, [20, 20, 20], 1)
  return img
}
const SW = C * YAWS.length, SH = C * PITCHES.length, sheet = new Uint8ClampedArray(SW * SH * 4).fill(255)
PITCHES.forEach((pitch, ri) => YAWS.forEach((yaw, ci) => {
  const img = cell(yaw, pitch)
  writeFileSync(`${out}-${yaw}_${pitch}.bmp`, bmp(C, C, img))
  for (let y = 0; y < C; y++) sheet.set(img.subarray(4 * y * C, 4 * (y + 1) * C), 4 * ((ri * C + y) * SW + ci * C))
  for (let k = 0; k < C; k++) { const q = [4 * ((ri * C) * SW + ci * C + k), 4 * ((ri * C + k) * SW + ci * C)]; for (const v of q) { sheet[v] = sheet[v + 1] = sheet[v + 2] = 200 } }
}))
writeFileSync(`${out}.bmp`, bmp(SW, SH, sheet))
console.log('ok', SW, SH)
