// Generated line art against the exact-angle VRoid render (shared by check-lineart.ts and bench-task.ts): the render
// frame (cell C px, head ball radius S px, ball centre (cx, cy)), the render's mesh-contour preview at a view, and the
// drawing's registration (scale + shift found on the lower face; bowen 1792513593). Node-only (reads files).
import { readFileSync } from 'node:fs'
import { contourSegments, loadVrmHead, rasterHead, type VrmHead } from '../mesh/vrmhead'
import { type View, rotate } from '../src/view'

export const C = 420, S = 120, CX = C / 2, CY = C * 0.46
export interface Bmp { W: number; H: number; px: (x: number, y: number) => [number, number, number] }
export function readBmp(f: string): Bmp {
  const b = readFileSync(f), off = b.readUInt32LE(10), W = b.readInt32LE(18), Hs = b.readInt32LE(22), H = Math.abs(Hs), bpp = b.readUInt16LE(28), row = Math.ceil((W * bpp) / 32) * 4
  return { W, H, px: (x, y) => { const yy = Hs < 0 ? y : H - 1 - y, i = off + yy * row + (x * bpp) / 8; return [b[i + 2]!, b[i + 1]!, b[i]!] } }
}
export function writeBmp(W: number, H: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const row = Math.ceil((W * 3) / 4) * 4, out = Buffer.alloc(54 + row * H)
  out.write('BM', 0); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14); out.writeInt32LE(W, 18); out.writeInt32LE(-H, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * H, 34)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = rgb(x, y), o = 54 + y * row + 3 * x; out[o] = b; out[o + 1] = g; out[o + 2] = r }
  return out
}
let vrm: VrmHead | undefined
export const vrmHead = () => { if (!vrm) { const b = readFileSync('face3d/fit/ref/test.vrm'); vrm = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) } return vrm }
/** the render's contour segments (render px) and its chin tip (render px) at a view */
export function renderContour(view: View) {
  const data = vrmHead(), f = { W: C, H: C, S, cx: CX, cy: CY }, img = new Uint8ClampedArray(C * C * 4).fill(255)
  // the face outline leaves the ears out (bench's 脸轮廓 has none): contour edges with both ends on an ear are dropped —
  // ear = skin points beside the head at ear height (|x| > 0.86, y −0.92 … −0.28, z −0.4 … 0.1 head-ball radii; the
  // VRoid skull's side reaches |x| ≈ 0.85 there, the ears stick out to 1.06)
  const ear = (i: number) => { const p = data.P[i]!; return Math.abs(p[0]) > 0.86 && p[1] > -0.92 && p[1] < -0.28 && p[2] > -0.4 && p[2] < 0.1 }
  const ras = rasterHead(data, view, f, img), noEar = data.edges.filter(e => !(ear(e.a) && ear(e.b)))
  const segs = contourSegments({ ...data, edges: noEar }, f, ras)
  // the jaw band, defined on the head (not on the screen, so it holds when the head tilts): contour edges with both ends
  // between the cheek under the eyes and the chin (head y −1.38 … −0.6), the neck below left out
  const inBand = (i: number) => { const y = data.P[i]![1]; return y > -1.38 && y < -0.6 }
  const band = contourSegments({ ...data, edges: noEar.filter(e => inBand(e.a) && inBand(e.b)) }, f, ras)
  // the chin tip: the lowest skin point near the middle line and toward the face (head space), projected
  let tip = data.P[0]!
  for (const p of data.P) if (Math.abs(p[0]) < 0.05 && p[2] > 0.5 && p[1] < tip[1]) tip = p
  const r = rotate(tip, view)
  return { segs, band, chin: [CX + r[0] * S, CY - r[1] * S] as [number, number] }
}
/** distance transform of a drawing's dark pixels (two-pass chamfer, drawing px) */
export function darkDT(D: Bmp) {
  const W = D.W, H = D.H, dt = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = D.px(x, y); dt[y * W + x] = 0.299 * r + 0.587 * g + 0.114 * b < 110 ? 0 : 1e9 }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x > 0) dt[i] = Math.min(dt[i]!, dt[i - 1]! + 1); if (y > 0) dt[i] = Math.min(dt[i]!, dt[i - W]! + 1); if (x > 0 && y > 0) dt[i] = Math.min(dt[i]!, dt[i - W - 1]! + 1.414); if (x < W - 1 && y > 0) dt[i] = Math.min(dt[i]!, dt[i - W + 1]! + 1.414) }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (x < W - 1) dt[i] = Math.min(dt[i]!, dt[i + 1]! + 1); if (y < H - 1) dt[i] = Math.min(dt[i]!, dt[i + W]! + 1); if (x < W - 1 && y < H - 1) dt[i] = Math.min(dt[i]!, dt[i + W + 1]! + 1.414); if (x > 0 && y < H - 1) dt[i] = Math.min(dt[i]!, dt[i + W - 1]! + 1.414) }
  return { at: (x: number, y: number) => { const X = Math.round(x), Y = Math.round(y); return X < 0 || Y < 0 || X >= W || Y >= H ? 200 : Math.min(200, dt[Y * W + X]!) } }
}
export interface Reg { sc: number; dx: number; dy: number; k0: number; mean: number }
/** render px → drawing px under a registration */
export const toDrawing = (r: Reg, x: number, y: number): [number, number] => [((x - CX) * r.sc + CX + r.dx) * r.k0, ((y - CY) * r.sc + CY + r.dy) * r.k0]
/** register a drawing to the render by its lower face: the render's jaw-band contour (renderContour().band) */
export function register(D: Bmp, dt: ReturnType<typeof darkDT>, band: [number, number, number, number][]): Reg {
  const k0 = D.W / C, lower: [number, number][] = []
  for (const [x0, y0, x1, y1] of band) for (const t of [0, 0.5]) lower.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
  let best = { sc: 1, dx: 0, dy: 0, c: Infinity }
  // the scale stays in 0.9 … 1.4: the drawings are made from the render at about its size (fits 1.0 … 1.25); a wider
  // range lets a shrunk jaw settle on dense eye / bang strokes with a lower cost (seen at 0.63 … 0.72)
  for (const [range, step, srange, sstep] of [[50, 4, 0.25, 0.025], [5, 1, 0.03, 0.005]] as const) {
    const c0 = best.c === Infinity ? { sc: 1.15, dx: 0, dy: 0 } : { ...best }
    for (let sc = c0.sc - srange; sc <= c0.sc + srange + 1e-9; sc += sstep) for (let dx = c0.dx - range; dx <= c0.dx + range; dx += step) for (let dy = c0.dy - range; dy <= c0.dy + range; dy += step) {
      let c = 0; for (const [x, y] of lower) { const [X, Y] = toDrawing({ sc, dx, dy, k0, mean: 0 }, x, y); c += dt.at(X, Y) }
      if (c < best.c) best = { sc, dx, dy, c }
    }
  }
  return { sc: best.sc, dx: best.dx, dy: best.dy, k0, mean: best.c / Math.max(1, lower.length) / k0 }
}
