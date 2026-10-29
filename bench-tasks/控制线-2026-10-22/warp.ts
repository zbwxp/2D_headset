// 液化 (bowen 1792638400, dot 1792638438): the generated three-view pushed onto the control heights — per panel a smooth
// vertical map (eyes and above unchanged; nose, mouth, chin onto the control lines; below the chin shifted with it) and
// local sideways pushes (90° face front back, 45° chin forward / nose back), sampled bilinearly
import { readFileSync, writeFileSync } from 'node:fs'
const DIR = '/private/tmp/claude-501/-Users-bowen-Documents-headset/87c94b45-bc1a-4505-a0ba-5c153d4e1470/scratchpad/guide3/'
function read(f: string) { const b = readFileSync(f), off = b.readUInt32LE(10), W = b.readInt32LE(18), Hs = b.readInt32LE(22), H = Math.abs(Hs), bpp = b.readUInt16LE(28), row = Math.ceil((W * bpp) / 32) * 4
  const g = new Float32Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const yy = Hs < 0 ? y : H - 1 - y, i = off + yy * row + (x * bpp) / 8; g[3 * (y * W + x)] = b[i + 2]!; g[3 * (y * W + x) + 1] = b[i + 1]!; g[3 * (y * W + x) + 2] = b[i]! }
  return { W, H, g } }
const src = read(DIR + 'gen1.bmp'), { W, H } = src
const SX = W / 4533, K = SX / 0.16550333333333334, PW = 1511 * SX, Y0 = -15.491112 - 945 * 0.16550333333333334
const REFX: Record<number, number> = { 0: 0, 45: 13.481686576394216, 90: 19.065984 }
type Push = { at: [number, number]; d: [number, number]; r: number }   // dst point, src − dst, radius
const P: Record<number, { knots: [number, number][]; pushes: Push[]; band?: { x: [number, number]; y: [number, number]; s: (y: number) => number } }> = {
  0: { knots: [[-300, -300], [12, 12], [24.4, 26.5], [38.8, 43.3], [62.3, 69.8], [300, 307.5]], pushes: [] },
  45: { knots: [[-300, -300], [12, 12], [24.4, 26.5], [38.8, 43.0], [62.3, 68.1], [300, 305.8]], pushes: [{ at: [50.45, 62.3], d: [-4.85, 0], r: 12 }, { at: [64.2, 24.4], d: [3, 0], r: 7 }] },
  90: { knots: [[-300, -300], [12, 12], [24.4, 25.6], [38.8, 43.3], [62.3, 70.6], [300, 308.3]], pushes: [],
    // the face front (nose, lips, chin) pushed back: full from x 75 forward and from y 20 down, 8.6 at the nose → 7.6 at the chin
    band: { x: [60, 75], y: [12, 20], s: y => (y < 40 ? 8.6 : y > 62 ? 7.6 : 8.6 - ((y - 40) / 22)) } },
}
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
const lin = (k: [number, number][], y: number) => { for (let i = 1; i < k.length; i++) if (y <= k[i]![0]) { const [a0, b0] = k[i - 1]!, [a1, b1] = k[i]!; return b0 + ((b1 - b0) * (y - a0)) / (a1 - a0) } return y }
const out = new Uint8Array(W * H * 3)
const sample = (x: number, y: number, c: number) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const v = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 255 : src.g[3 * (yy * W + xx) + c]!)
  return v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy }
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const j = Math.min(2, Math.floor(px / PW)), yaw = [0, 45, 90][j]!, cfg = P[yaw]!
  const cx = REFX[yaw]! - 125 + (px - j * PW) / K, cy = Y0 + py / K
  let sx = cx, sy = lin(cfg.knots, cy)
  for (const q of cfg.pushes) { const w = Math.exp(-((cx - q.at[0]) ** 2 + (cy - q.at[1]) ** 2) / (2 * q.r * q.r)); sx += w * q.d[0]; sy += w * q.d[1] }
  if (cfg.band) sx += smooth(cfg.band.x[0], cfg.band.x[1], cx) * smooth(cfg.band.y[0], cfg.band.y[1], cy) * cfg.band.s(cy)
  // stay inside the panel
  const spx = j * PW + (sx - (REFX[yaw]! - 125)) * K, spy = (sy - Y0) * K
  for (let c = 0; c < 3; c++) out[3 * (py * W + px) + c] = Math.round(spx < j * PW || spx >= (j + 1) * PW - 1 ? 255 : sample(spx, spy, c))
}
const row = Math.ceil((W * 3) / 4) * 4, bmp = Buffer.alloc(54 + row * H)
bmp.write('BM', 0); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(W, 18); bmp.writeInt32LE(-H, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(row * H, 34)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = 54 + y * row + 3 * x, i = 3 * (y * W + x); bmp[o] = out[i + 2]!; bmp[o + 1] = out[i + 1]!; bmp[o + 2] = out[i]! }
writeFileSync(DIR + 'gen1-warp.bmp', bmp); console.log('ok', W, H)
