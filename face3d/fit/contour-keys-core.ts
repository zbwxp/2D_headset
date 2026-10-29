// The outline as a function of the view from keyframes (bowen 1793153948): the head, the outline at a view as matched points,
// and the four-corner mix of keyframes. Shared by face3d/fit/contour-keys.ts and the viewer face3d/viewer/contourkeys.html.
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate, screenAxes, toCamera } from '../src/view'
import { flattenEars } from './flatten-ears'
import { flattenFace } from './flatten-face'
import { type WireLine, splitNeck } from './neck-split'
export type P2 = [number, number]
type P3 = [number, number, number]
export const CENTRE: P3 = [0, -0.45, 0], NECK_FROM = -1.5, CLIP_R = 1.47
/** the head (with its neck cut at the base ring yBase, ears pressed flat) in the usual head space, from the VRoid file; with
 * face, the nose and lips pressed flat too, and the nose part (what was pressed off) as a head of its own in .nose; with longNeck
 * (neck 'tube'; bowen 1793156407 「把脖子拉长，然后整个头画个圆把脖子截断」) the neck below the chin made a long tube (its end far off the picture) and every outline cut by the circle round the head's centre that holds the whole head from any side (radius 1.47:
 * the farthest, the back of the crown, is 1.437); with neck 'cap' (bowen 1793156878 「仰视的时候…真正重要的是下颌线…俯视应该也不需要脖子
 * 那部分」) no neck: the head cut below the chin and the cut closed by a flat cap of the neck's section; with neck 'wire' the head cut
 * along bowen's ring between head and neck and the neck a part of its own (.neck) between his two rings (face3d/fit/neck-split.ts) */
export function buildHead(ab: () => ArrayBuffer, yBase: number, face = false, neck: 'cut' | 'tube' | 'cap' | 'wire' = 'cut', wire?: WireLine[]) {
const d0 = loadVrmHead(ab()), D = loadVrmHead(ab(), 1.3)
const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(D.P, 1), b1 = ext(D.P, 2)
const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
const P = D.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3)
const parts = D.parts.filter(p => p.kind === 'skin').map(p => { const tris: number[] = [], cornerN: number[] = []
  for (let i = 0; i < p.tris.length; i += 3) { const v = [p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!]; if (v.some(k => P[k]![1] < yBase)) continue; tris.push(...v); cornerN.push(...p.cornerN.slice(3 * i, 3 * i + 9)) }
  return { ...p, tris, cornerN } })
const skinTris = parts.flatMap(p => p.tris)
const Nn = D.N.map(n => [...n]); flattenEars(P, Nn, skinTris)
type H = Parameters<typeof rasterHead>[0] & { yBase: number; centre: P3; areaCentre?: boolean; clipR?: number; nose?: H; neck?: H; cutAt?: (p: P3) => boolean }
const head = { ...D, P, N: Nn, parts, skinTris, yBase, centre: CENTRE } as unknown as H
if (neck === 'wire') {
  const { tube, nearBase } = splitNeck(P, Nn, parts, wire!); skinTris.splice(0, skinTris.length, ...parts.flatMap(p => p.tris)); head.yBase = -Infinity
  // the neck's own outline: its bottom (round the base ring) does not count (bowen 1793157014 「脖子收口线完全不重要」)
  head.neck = { ...D, P, N: Nn, parts: [{ ...parts[0]!, tris: tube, cornerN: new Array(tube.length * 3).fill(NaN) }], skinTris: tube, yBase: -Infinity, centre: [0, -1.45, -0.05], areaCentre: true, cutAt: nearBase } as unknown as H
} else if (neck !== 'cut') {
  // VRoid's neck below the chin is a low strip with holes at the throat (the face's skin ends at −1.49): everything below −1.5
  // dropped, and a tube put in its place — the neck's section (x ±0.44, z −0.46 … 0.39 between −1.68 and −1.45) as an ellipse,
  // from just inside the jaw (−1.45) far down (−30)
  for (const p of parts) { const t: number[] = [], cn: number[] = []; for (let i = 0; i < p.tris.length; i += 3) { if ([0, 1, 2].some(k => P[p.tris[i + k]!]![1] < NECK_FROM)) continue; t.push(p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!); cn.push(...p.cornerN.slice(3 * i, 3 * i + 9)) } p.tris = t; p.cornerN = cn }
  const K = 64, n0 = P.length, tube: number[] = []
  for (const y of neck === 'tube' ? [-1.45, -30] : [-1.47, -1.47]) for (let k = 0; k < K; k++) { const t = (2 * Math.PI * k) / K; P.push([0.44 * Math.cos(t), y, -0.035 + 0.425 * Math.sin(t)]); Nn.push([Math.cos(t) / 0.44, 0, Math.sin(t) / 0.425].map((v, _, a) => v / Math.hypot(a[0]!, a[2]!))) }
  if (neck === 'tube') for (let k = 0; k < K; k++) { const a = n0 + k, b = n0 + ((k + 1) % K), c = a + K, d = b + K; tube.push(a, c, b, b, c, d) }
  else { P.push([0, -1.47, -0.035]); Nn.push([0, -1, 0]); for (let k = 0; k < K; k++) tube.push(n0 + 2 * K, n0 + k, n0 + ((k + 1) % K)) } // the cap: a fan, facing down
  // wound to face out: (b − a) × (c − a) along the outward normal (the tube: away from its axis; the cap: down)
  const [a, b, c] = [tube[0]!, tube[1]!, tube[2]!].map(i => P[i]!) as [P3, P3, P3], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const out = neck === 'tube' ? (u[1]! * w[2]! - u[2]! * w[1]!) * a[0] + (u[0]! * w[1]! - u[1]! * w[0]!) * (a[2] + 0.035) : -(u[2]! * w[0]! - u[0]! * w[2]!)
  if (out < 0) for (let i = 0; i < tube.length; i += 3) [tube[i + 1], tube[i + 2]] = [tube[i + 2]!, tube[i + 1]!]
  parts.push({ ...parts[0]!, tris: tube, cornerN: new Array(tube.length * 3).fill(NaN) })
  skinTris.splice(0, skinTris.length, ...parts.flatMap(p => p.tris)); if (neck === 'tube') head.clipR = CLIP_R; head.yBase = -Infinity
}
if (!face) return head
// the nose part: the pressed patch and the patch as it was, together (no back faces dropped), outlined as one
const moved = flattenFace(P, Nn, skinTris), was = new Map(moved.map(m => [m.i, m.before as P3])), n0 = P.length
const tris: number[] = []; for (let i = 0; i < skinTris.length; i += 3) { const v = [skinTris[i]!, skinTris[i + 1]!, skinTris[i + 2]!]; if (v.some(k => was.has(k))) tris.push(...v, ...v.map(k => k + n0)) }
head.nose = { ...D, P: [...P, ...P.map((p, k) => was.get(k) ?? p)], N: [...Nn, ...Nn], parts: [{ kind: 'nosepart', color: [200, 120, 120], tris, cornerN: new Array(tris.length * 3).fill(NaN) }], skinTris: tris, yBase: -Infinity, centre: [0, -0.95, 0.95], areaCentre: true } as unknown as H
return head
}
export type Head = ReturnType<typeof buildHead>
export const W = 480, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.42 }, HALF = 180

/** how far the picture has turned on the screen (counter-clockwise, radians) from turning the head, about the line of sight: near
 * straight above or below a turn of the head spins the picture (−turn · sin tilt, measured: 19.5° for a 20° turn at tilt −89°) */
export const spinOf = (yaw: number, pitch: number) => (-yaw * Math.PI / 180) * Math.sin((pitch * Math.PI) / 180)
/** the outline at a view as 2·HALF points from its top clockwise, between A anchors each by arc length (spin: the rays to the
 * anchors turned with the head's spin, so the anchors stay on the same parts of the head; rim, when given, gets each point's place
 * on the head (x, y, z in turn): the line on the head the outline touches, taken back by the depth there — bowen 1793157748
 * 「建模的是这个角度的头环，那么简单转动就能完美fit所有这个角度的方向」); cut (when given) gets
 * 1 for each point at the neck's cut (from the head below cutBelow: its base ring's height + 0.06 unless given; or where the head's
 * own cutAt says), else 0 */
export function contourAt(HEAD: Head, yaw: number, pitch: number, img = new Uint8ClampedArray(W * W * 4), A = 2, cut?: number[], cutBelow = HEAD.yBase + 0.06, spin = false, rim?: number[]): P2[] {
  const v = { yaw, pitch }, ras = rasterHead(HEAD, v, F, img), c3 = rotate(HEAD.centre, v), R2 = (HEAD.clipR ?? Infinity) ** 2
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity && ((i + 0.5 - F.cx) / F.S - c3[0]) ** 2 + ((F.cy - (j + 0.5)) / F.S - c3[1]) ** 2 <= R2
  // only the largest connected piece is outlined (a part seen edge-on can leave specks of a pixel or two)
  const lab = new Int32Array(W * W).fill(-1), size: number[] = []
  for (let k0 = 0; k0 < W * W; k0++) { if (lab[k0] !== -1 || !inside(k0 % W, Math.floor(k0 / W))) continue; const id = size.length, st = [k0]; lab[k0] = id; let m = 0
    while (st.length) { const k = st.pop()!, i = k % W, j = Math.floor(k / W); m++; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const a = i + di, b = j + dj, kk = b * W + a; if (inside(a, b) && lab[kk] === -1) { lab[kk] = id; st.push(kk) } } }
    size.push(m) }
  const big = size.indexOf(Math.max(...size)), on = (i: number, j: number) => inside(i, j) && lab[j * W + i] === big
  // a small part (nose, neck) is anchored from the middle of what shows of it (its own centre can fall outside it on the screen)
  let c = c3; if (HEAD.areaCentre) { let sx = 0, sy = 0, m = 0; for (let k = 0; k < W * W; k++) if (lab[k] === big) { sx += (k % W) + 0.5; sy += Math.floor(k / W) + 0.5; m++ } c = [(sx / m - F.cx) / F.S, (F.cy - sy / m) / F.S, 0] }
  let s0: [number, number] | null = null; for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 40000; n++) { const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  const raw = cells.map(([i, j]) => [(i + 0.5 - F.cx) / F.S, (F.cy - (j + 0.5)) / F.S] as P2), n = raw.length
  const ax = screenAxes(v), fw = toCamera(v), raw3 = cells.map(([i, j], k) => { const z = ras.zb[j * W + i]!; return [0, 1, 2].map(m => ax.right[m]! * raw[k]![0] + ax.up[m]! * raw[k]![1] + fw[m]! * z) as P3 })
  const low = raw3.map(p => HEAD.cutAt ? HEAD.cutAt(p) : p[1] < cutBelow)
  const q = raw.map((_, i) => { let x = 0, y = 0; for (let d = -3; d <= 3; d++) { const r = raw[(((i + d) % n) + n) % n]!; x += r[0]; y += r[1] } return [x / 7, y / 7] as P2 }) // pixel steps smoothed
  // the places on the head, smoothed the same way (the depth at the edge is the least sure part)
  const q3 = raw3.map((_, i) => { const o = [0, 0, 0]; for (let d = -3; d <= 3; d++) { const r = raw3[(((i + d) % n) + n) % n]!; o[0]! += r[0]; o[1]! += r[1]; o[2]! += r[2] } return o.map(x => x / 7) as P3 })
  // the trace runs clockwise on the screen (the inside on its right, y up). Anchors: where the loop crosses the rays from the
  // head's centre on the screen, straight up then clockwise every 360/A° — the farthest crossing on each ray; between neighbouring
  // anchors the loop is resampled by arc length (A = 2: top and bottom only, as the 15° keyframes; more anchors keep a change in
  // one part of the outline from sliding the points everywhere else)
  const per = (2 * HALF) / A
  const anchor = (th: number) => { const ux = Math.cos(th), uy = Math.sin(th); let bi = -1, bs = -Infinity, bt = 0
    for (let i = 0; i < n; i++) { const a = q[i]!, b = q[(i + 1) % n]!, ex = b[0] - a[0], ey = b[1] - a[1], den = ux * ey - uy * ex; if (Math.abs(den) < 1e-12) continue
      const wx = a[0] - c[0], wy = a[1] - c[1], t = -(ux * wy - uy * wx) / den, sd = (wx * ey - wy * ex) / den; if (t < 0 || t >= 1 || sd <= 0) continue; if (sd > bs) { bs = sd; bi = i; bt = t } }
    if (bi < 0) { missed.count++; for (let i = 0; i < n; i++) { const d = (q[i]![0] - c[0]) * ux + (q[i]![1] - c[1]) * uy; if (d > bs) { bs = d; bi = i; bt = 0 } } } // the ray misses: the farthest point that way
    const a3 = q3[bi]!, b3 = q3[(bi + 1) % n]!
    return { i: bi, p: [q[bi]![0] + (q[(bi + 1) % n]![0] - q[bi]![0]) * bt, q[bi]![1] + (q[(bi + 1) % n]![1] - q[bi]![1]) * bt] as P2, p3: [0, 1, 2].map(m => a3[m]! + (b3[m]! - a3[m]!) * bt) as P3 } }
  const s0a = spin ? spinOf(yaw, pitch) : 0, an = Array.from({ length: A }, (_, k) => anchor(Math.PI / 2 - (2 * Math.PI * k) / A + s0a))
  const off = (i: number) => (i - an[0]!.i + n) % n
  if (an.some((x, k) => k > 0 && off(x.i) < off(an[k - 1]!.i))) disorder.count++
  const seg = (a: typeof an[0], b: typeof an[0]) => { const out: P2[] = [a.p], o3: P3[] = [a.p3], ix = [a.i]; for (let k = (a.i + 1) % n; k !== (b.i + 1) % n; k = (k + 1) % n) { out.push(q[k]!); o3.push(q3[k]!); ix.push(k); if (k === b.i) break } out.push(b.p); o3.push(b.p3); ix.push(b.i); return { out, o3, ix } }
  const resample = ({ out: s, o3, ix }: { out: P2[]; o3: P3[]; ix: number[] }, m: number) => { const L = [0]; for (let i = 1; i < s.length; i++) L.push(L[i - 1]! + Math.hypot(s[i]![0] - s[i - 1]![0], s[i]![1] - s[i - 1]![1]))
    return Array.from({ length: m }, (_, k) => { const t = (k / m) * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < t) i++; const f = (t - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); cut?.push(low[ix[f < 0.5 ? i - 1 : i]!]! ? 1 : 0); if (rim) for (let m3 = 0; m3 < 3; m3++) rim.push(+(o3[i - 1]![m3]! + (o3[i]![m3]! - o3[i - 1]![m3]!) * f).toFixed(4)); return [s[i - 1]![0] + (s[i]![0] - s[i - 1]![0]) * f, s[i - 1]![1] + (s[i]![1] - s[i - 1]![1]) * f] as P2 }) }
  return an.flatMap((a, k) => resample(seg(a, an[(k + 1) % A]!), per)).map(p => [+p[0].toFixed(4), +p[1].toFixed(4)] as P2)
}
/** views whose anchors came out of order round the loop (the outline folds back across a ray) */
export const disorder = { count: 0 }, missed = { count: 0 }
export const STEP = 15, YS = Array.from({ length: 13 }, (_, i) => -90 + i * STEP), PS = YS
/** the keyframes' mix at any view: the four round it, bilinear */
export function mixAt(K: P2[][][], yaw: number, pitch: number): P2[] {
  const fy = Math.max(0, Math.min(11.9999, (yaw + 90) / STEP)), fp = Math.max(0, Math.min(11.9999, (pitch + 90) / STEP)), i = Math.floor(fy), j = Math.floor(fp), u = fy - i, w = fp - j
  const A = K[i]![j]!, B = K[i + 1]![j]!, Cc = K[i]![j + 1]!, Dd = K[i + 1]![j + 1]!
  return A.map((a, k) => [0, 1].map(m => (1 - u) * (1 - w) * a[m]! + u * (1 - w) * B[k]![m]! + (1 - u) * w * Cc[k]![m]! + u * w * Dd[k]![m]!) as P2)
}
