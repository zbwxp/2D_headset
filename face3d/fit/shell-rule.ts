// bowen's rule for the face side below the cap (1793121297): turn 0° = the face contour line (交点2 → 上耳根 → 下耳根 → 下巴)
// seen at 0°, 30° = the 太阳穴·颧骨 line (交点1 → 太阳穴 → 颧骨 → 下巴) seen at 30°, between them the two mixed by turn / 30
// (piece for piece, control points). Checked against VRoid's outline (the right edge, row by row, from the forehead ring's
// height to 下巴). Writes face3d/viewer/ref-shell/rule-face.svg. Run: npx vite-node face3d/fit/shell-rule.ts [doc-sym.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
type P3 = [number, number, number]
const doc = JSON.parse(readFileSync(process.argv[2] ?? 'face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { id: number; name: string; p: P3 }[]; lines: { name: string; a: number; b: number; c: P3[] }[] }
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const d3 = (a: P3, c: P3) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])
const line = (n: string) => doc.lines.find(l => l.name === n)!.c.map(p => [...p] as P3)
function chainOf(names: string[]): P3[][] {
  const cs = names.map(line), f = cs[0]!, s2 = cs[1]!
  if (Math.min(d3(f[0]!, s2[0]!), d3(f[0]!, s2[3]!)) < Math.min(d3(f[3]!, s2[0]!), d3(f[3]!, s2[3]!))) f.reverse()
  for (let i = 1; i < cs.length; i++) if (d3(cs[i]![3]!, cs[i - 1]![3]!) < d3(cs[i]![0]!, cs[i - 1]![3]!)) cs[i]!.reverse()
  return cs
}
const contour = chainOf(['右线5前', '右线2', '右线4']), temple = chainOf(['右线2后', '右线1', '右线3'])
const rule = (turn: number) => { const w = Math.max(0, Math.min(1, turn / 30)); return contour.map((c, i) => c.map((p, k) => [0, 1, 2].map(j => p[j]! + (temple[i]![k]![j]! - p[j]!) * w) as P3)) }
const W = 400, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.42 }, Pn = 400, YAWS = [0, 5, 10, 15, 20, 25, 30], COLS = 3
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * Pn} ${COLS * Pn}" width="${COLS * Pn}" height="${COLS * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
YAWS.forEach((yaw, k) => {
  const v = { yaw, pitch: 0 }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), ox = (k % COLS) * Pn, oy = Math.floor(k / COLS) * Pn
  const X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
  const rows: { y: number; r: number }[] = []; for (let j = 0; j < W; j++) { let r = -1; for (let i = 0; i < W; i++) if (ras.zb[j * W + i]! > -Infinity) r = i; if (r >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  const L = rule(yaw), q = L.flatMap(c => Array.from({ length: 61 }, (_, i) => rotate(cubic(c, i / 60), v)))
  const yTop = q[0]![1], yBot = q[q.length - 1]![1]
  const at = (y: number) => { let hi = -Infinity; for (let i = 0; i + 1 < q.length; i++) { const a = q[i]!, c = q[i + 1]!; if ((a[1] - y) * (c[1] - y) > 0 || a[1] === c[1]) continue; hi = Math.max(hi, a[0] + ((y - a[1]) / (c[1] - a[1])) * (c[0] - a[0])) } return hi }
  // (rows of the ear left out: there the outline is the ear's, not the face's)
  const earY = [doc.points.find(p => p.name === '右上耳根')!.p[1], doc.points.find(p => p.name === '右下耳根')!.p[1]]
  const dd = rows.filter(r => r.y <= yTop && r.y >= yBot && !(yaw < 25 && r.y < earY[0]! + 0.03 && r.y > earY[1]! - 0.03)).map(r => Math.abs(r.r - at(r.y))).filter(Number.isFinite).sort((a, c) => a - c)
  const pl = (ps: readonly (readonly number[])[], st: string) => `<polyline fill="none" ${st} points="${ps.map(p => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
  for (const l of doc.lines) svg += pl(Array.from({ length: 41 }, (_, i) => rotate(cubic(l.c, i / 40), v)), 'stroke="#ecc" stroke-width="0.6"')
  for (const c of [...contour, ...temple]) svg += pl(Array.from({ length: 41 }, (_, i) => rotate(cubic(c, i / 40), v)), 'stroke="#c99" stroke-width="1" stroke-dasharray="3 2"')
  svg += pl(rows.map(r => [r.r, r.y]), 'stroke="#111" stroke-width="1"')
  svg += pl(q, 'stroke="#13a05a" stroke-width="2.4"')
  svg += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}° · 混合 ${(Math.min(1, yaw / 30) * 100).toFixed(0)}% 太阳穴颧骨线</text><text x="${ox + 8}" y="${oy + Pn - 10}" font-size="12">绿线 vs 真轮廓（不算耳朵那几行）：中位 ${(dd[Math.floor(dd.length / 2)] ?? NaN).toFixed(3)} · 九成 ${(dd[Math.floor(dd.length * 0.9)] ?? NaN).toFixed(3)} · 最大 ${(dd[dd.length - 1] ?? NaN).toFixed(3)}</text>`
  console.log(yaw, 'med', (dd[Math.floor(dd.length / 2)] ?? NaN).toFixed(3), 'p90', (dd[Math.floor(dd.length * 0.9)] ?? NaN).toFixed(3), 'max', (dd[dd.length - 1] ?? NaN).toFixed(3))
})
writeFileSync('face3d/viewer/ref-shell/rule-face.svg', svg + '</svg>')
