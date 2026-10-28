// The outline as a function of the view from keyframes (bowen 1793153948): the head, the outline at a view as matched points,
// and the four-corner mix of keyframes. Shared by face3d/fit/contour-keys.ts and the viewer face3d/viewer/contourkeys.html.
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
import { flattenEars } from './flatten-ears'
export type P2 = [number, number]
type P3 = [number, number, number]
/** the head (with its neck cut at the base ring yBase, ears pressed flat) in the usual head space, from the VRoid file */
export function buildHead(ab: () => ArrayBuffer, yBase: number) {
const d0 = loadVrmHead(ab()), D = loadVrmHead(ab(), 1.3)
const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(D.P, 1), b1 = ext(D.P, 2)
const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
const P = D.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3)
const parts = D.parts.filter(p => p.kind === 'skin').map(p => { const tris: number[] = [], cornerN: number[] = []
  for (let i = 0; i < p.tris.length; i += 3) { const v = [p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!]; if (v.some(k => P[k]![1] < yBase)) continue; tris.push(...v); cornerN.push(...p.cornerN.slice(3 * i, 3 * i + 9)) }
  return { ...p, tris, cornerN } })
const skinTris = parts.flatMap(p => p.tris)
flattenEars(P, D.N.map(n => [...n]), skinTris)
return { ...D, P, parts, skinTris } as unknown as Parameters<typeof rasterHead>[0]
}
export type Head = ReturnType<typeof buildHead>
export const CENTRE: P3 = [0, -0.45, 0]
export const W = 480, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.42 }, HALF = 180

/** the outline at a view as 2·HALF points: from its top clockwise to its bottom, then on to its top, each half by arc length */
export function contourAt(HEAD: Head, yaw: number, pitch: number, img = new Uint8ClampedArray(W * W * 4)): P2[] {
  const v = { yaw, pitch }, ras = rasterHead(HEAD, v, F, img), on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null; for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 40000; n++) { const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  const raw = cells.map(([i, j]) => [(i + 0.5 - F.cx) / F.S, (F.cy - (j + 0.5)) / F.S] as P2), n = raw.length
  const q = raw.map((_, i) => { let x = 0, y = 0; for (let d = -3; d <= 3; d++) { const r = raw[(i + d + n) % n]!; x += r[0]; y += r[1] } return [x / 7, y / 7] as P2 }) // pixel steps smoothed
  // the trace runs clockwise on the screen (the inside on its right, y up); the top / bottom: where the loop crosses the vertical
  // through the head's centre, highest / lowest
  const c = rotate(CENTRE, v), cross = (pred: (y: number) => boolean) => { let bi = 0, by = pred(1) ? -Infinity : Infinity
    for (let i = 0; i < n; i++) { const a = q[i]!, b = q[(i + 1) % n]!; if ((a[0] - c[0]) * (b[0] - c[0]) > 0) continue; const y = (a[1] + b[1]) / 2; if (pred(1) ? y > by : y < by) { by = y; bi = i } } return bi }
  const iTop = cross(() => true), iBot = cross(() => false)
  const seg = (from: number, to: number) => { const out: P2[] = []; for (let k = from; ; k = (k + 1) % n) { out.push(q[k]!); if (k === to) break } return out }
  const resample = (s: P2[], m: number) => { const L = [0]; for (let i = 1; i < s.length; i++) L.push(L[i - 1]! + Math.hypot(s[i]![0] - s[i - 1]![0], s[i]![1] - s[i - 1]![1]))
    return Array.from({ length: m }, (_, k) => { const t = (k / m) * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < t) i++; const f = (t - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); return [s[i - 1]![0] + (s[i]![0] - s[i - 1]![0]) * f, s[i - 1]![1] + (s[i]![1] - s[i - 1]![1]) * f] as P2 }) }
  return [...resample(seg(iTop, iBot), HALF), ...resample(seg(iBot, iTop), HALF)].map(p => [+p[0].toFixed(4), +p[1].toFixed(4)] as P2)
}
export const STEP = 15, YS = Array.from({ length: 13 }, (_, i) => -90 + i * STEP), PS = YS
/** the keyframes' mix at any view: the four round it, bilinear */
export function mixAt(K: P2[][][], yaw: number, pitch: number): P2[] {
  const fy = Math.max(0, Math.min(11.9999, (yaw + 90) / STEP)), fp = Math.max(0, Math.min(11.9999, (pitch + 90) / STEP)), i = Math.floor(fy), j = Math.floor(fp), u = fy - i, w = fp - j
  const A = K[i]![j]!, B = K[i + 1]![j]!, Cc = K[i]![j + 1]!, Dd = K[i + 1]![j + 1]!
  return A.map((a, k) => [0, 1].map(m => (1 - u) * (1 - w) * a[m]! + u * (1 - w) * B[k]![m]! + (1 - u) * w * Cc[k]![m]! + u * w * Dd[k]![m]!) as P2)
}
