// 整体摆放 (dot 1792639356): the generated three-view moved, not deformed — one scale and one vertical shift for all three,
// a sideways shift per view: control = s·gen + t (canvas units), sampled bilinearly
import { readFileSync, writeFileSync } from 'node:fs'
const DIR = '/private/tmp/claude-501/-Users-bowen-Documents-headset/87c94b45-bc1a-4505-a0ba-5c153d4e1470/scratchpad/guide3/'
const [IN, OUT, S, TY, T0, T45, T90] = process.argv.slice(2)
function read(f: string) { const b = readFileSync(f), off = b.readUInt32LE(10), W = b.readInt32LE(18), Hs = b.readInt32LE(22), H = Math.abs(Hs), bpp = b.readUInt16LE(28), row = Math.ceil((W * bpp) / 32) * 4
  const g = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const yy = Hs < 0 ? y : H - 1 - y, i = off + yy * row + (x * bpp) / 8; g[y * W + x] = (b[i]! + b[i + 1]! + b[i + 2]!) / 3 }
  return { W, H, g } }
const src = read(DIR + IN!), { W, H } = src, s = +S!, ty = +TY!, TX: Record<number, number> = { 0: +T0!, 45: +T45!, 90: +T90! }
const SX = W / 4533, K = SX / 0.16550333333333334, PW = 1511 * SX, Y0 = -15.491112 - 945 * 0.16550333333333334, REFX: Record<number, number> = { 0: 0, 45: 13.481686576394216, 90: 19.065984 }
const out = Buffer.alloc(W * H * 3, 255)
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const j = Math.min(2, Math.floor(px / PW)), yaw = [0, 45, 90][j]!, cx = REFX[yaw]! - 125 + (px - j * PW) / K, cy = Y0 + py / K
  const gx = (cx - TX[yaw]!) / s, gy = (cy - ty) / s, sx = j * PW + (gx - (REFX[yaw]! - 125)) * K, sy = (gy - Y0) * K
  if (sx < j * PW || sx >= (j + 1) * PW - 1 || sy < 0 || sy >= H - 1) continue
  const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, v = (a: number, b: number) => src.g[b * W + a]!
  const l = v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy
  out.fill(Math.round(l), 3 * (py * W + px), 3 * (py * W + px) + 3)
}
const row = Math.ceil((W * 3) / 4) * 4, bmp = Buffer.alloc(54 + row * H)
bmp.write('BM', 0); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(W, 18); bmp.writeInt32LE(-H, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(row * H, 34)
for (let y = 0; y < H; y++) out.copy(bmp, 54 + y * row, 3 * y * W, 3 * (y + 1) * W)
writeFileSync(DIR + OUT!, bmp); console.log('ok')
